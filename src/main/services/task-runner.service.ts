import { join } from 'path'
import log from 'electron-log'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import {
  buildOssKey,
  deriveDateScopedUploadRelativePath
} from '@shared/day-folder'
import { getTaskRepo } from '../db/task.repo'
import {
  getTaskDestinationRepo,
  type FileDestinationUploadTarget
} from '../db/task-destination.repo'
import { getSettingsRepo } from '../db/settings.repo'
import { getCloudUploadService } from './cloud-upload.service'
import type { CloudTaskUploader } from './cloud-upload.types'
import { FileFilterService } from './file-filter.service'
import { writeProcessTask } from '../utils/marker-file'
import { SpeedCalculator } from '../utils/speed-calculator'
import { getUploadSemaphore } from '../utils/upload-semaphore'
import type {
  CloudProvider,
  FileStatus,
  ProcessTaskMarker,
  Task,
  TaskProgress
} from '@shared/types'

interface ProviderRuntime {
  uploader: CloudTaskUploader
  speed: SpeedCalculator
  uploadedFiles: number
  uploadedBytes: number
  totalFiles: number
  totalBytes: number
}

export class TaskRunnerService {
  private readonly maxUploadRetries = 2

  async run(task: Task, signal?: AbortSignal): Promise<void> {
    const taskRepo = getTaskRepo()
    const destinationRepo = getTaskDestinationRepo()
    const settings = getSettingsRepo().getAll()
    const uploadConfig = settings.upload
    const filter = new FileFilterService(settings.filter)
    const semaphore = getUploadSemaphore(uploadConfig.maxConcurrentUploads || 30)
    const dateScopedUploadPath = deriveDateScopedUploadRelativePath(task.folderPath)
    if (
      dateScopedUploadPath &&
      task.status !== 'completed' &&
      task.uploadRelativePath !== dateScopedUploadPath
    ) {
      taskRepo.updateUploadRelativePath(task.id, dateScopedUploadPath)
      task.uploadRelativePath = dateScopedUploadPath
    }

    const destinations = destinationRepo.listByTask(task.id)
    if (destinations.length === 0) {
      throw new Error('任务没有配置任何上传目标')
    }

    const activeDestinations = destinations.filter(
      (destination) => destination.status === 'pending'
    )
    if (activeDestinations.length === 0) {
      const failed = destinations.filter(
        (destination) => destination.status === 'failed'
      )
      if (failed.length > 0) {
        throw new Error(
          `仍有未重试的失败云端: ${failed
            .map((destination) => destination.provider)
            .join(', ')}`
        )
      }
      return
    }
    const runtimes = new Map<CloudProvider, ProviderRuntime>()

    for (const destination of activeDestinations) {
      const validationError = getCloudUploadService().validateProvider(
        destination.provider,
        settings
      )
      if (validationError) throw new Error(validationError)
    }
    try {
      for (const destination of activeDestinations) {
        const uploader = await getCloudUploadService().createTaskUploader(
          destination.provider,
          settings,
          uploadConfig.multipartThreshold
        )
        runtimes.set(destination.provider, {
          uploader,
          speed: new SpeedCalculator(),
          uploadedFiles: 0,
          uploadedBytes: 0,
          totalFiles: 0,
          totalBytes: 0
        })
      }
    } catch (err) {
      for (const runtime of runtimes.values()) runtime.uploader.dispose()
      throw err
    }

    const abortUploaders = (): void => {
      for (const runtime of runtimes.values()) runtime.uploader.abort()
    }
    signal?.addEventListener('abort', abortUploaders, { once: true })

    try {
      if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
      taskRepo.updateStatus(task.id, 'scanning')
      for (const destination of activeDestinations) {
        destinationRepo.updateStatus(task.id, destination.provider, 'scanning')
        this.broadcastDestinationStatus(task.id, destination.provider, 'scanning')
      }

      const files = filter.scanFolder(task.folderPath)
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
      log.info(
        `任务 ${task.id}: 扫描到 ${files.length} 个文件, 目标 ${destinations
          .map((item) => item.provider)
          .join(',')}`
      )

      taskRepo.setTotals(task.id, files.length, totalBytes)
      this.registerFiles(task, files)
      destinationRepo.ensureForTaskFiles(task.id)

      for (const destination of destinations) {
        destinationRepo.setTotals(
          task.id,
          destination.provider,
          files.length,
          totalBytes
        )
      }

      if (files.length === 0) {
        this.completeEmptyTask(task, destinations.map((item) => item.provider))
        return
      }

      const allTargets = destinationRepo.listFileTargets(task.id)
      const filesById = new Map(
        taskRepo.listFiles(task.id).map((file) => [file.id, file])
      )
      const logicalCompleted = new Set(
        taskRepo
          .listFiles(task.id, 'completed')
          .map((file) => file.id)
      )
      let logicalUploadedBytes = Array.from(logicalCompleted).reduce(
        (sum, id) => sum + (filesById.get(id)?.fileSize || 0),
        0
      )

      const processMarker = this.createProcessMarker(task, files, allTargets)
      writeProcessTask(task.folderPath, processMarker)
      const targetsByProvider = this.groupTargets(allTargets)

      for (const destination of destinations) {
        const providerTargets = targetsByProvider.get(destination.provider) || []
        const completed = providerTargets.filter(
          (target) => target.status === 'completed'
        )
        const runtime = runtimes.get(destination.provider)
        if (runtime) {
          runtime.totalFiles = files.length
          runtime.totalBytes = totalBytes
          runtime.uploadedFiles = completed.length
          runtime.uploadedBytes = completed.reduce(
            (sum, target) => sum + target.fileSize,
            0
          )
          destinationRepo.updateStatus(task.id, destination.provider, 'uploading')
          this.broadcastDestinationStatus(task.id, destination.provider, 'uploading')
          destinationRepo.updateProgress(
            task.id,
            destination.provider,
            runtime.uploadedFiles,
            runtime.uploadedBytes
          )
          this.broadcastProgress(
            task.id,
            destination.provider,
            runtime,
            null
          )
        }
      }

      taskRepo.updateStatus(task.id, 'uploading')
      taskRepo.updateProgress(
        task.id,
        logicalCompleted.size,
        logicalUploadedBytes
      )

      const activeProviders = new Set(
        activeDestinations.map((destination) => destination.provider)
      )
      const jobs = allTargets.filter(
        (target) =>
          activeProviders.has(target.provider) &&
          target.status !== 'completed'
      )

      let index = 0
      let completedRequests = allTargets.filter(
        (target) => target.status === 'completed'
      ).length
      const workerCount = Math.max(
        1,
        Math.min(uploadConfig.maxFilesPerTask || 6, jobs.length || 1)
      )

      const runNext = async (): Promise<void> => {
        while (index < jobs.length && !signal?.aborted) {
          const target = jobs[index++]
          const runtime = runtimes.get(target.provider)
          const destination = destinations.find(
            (item) => item.provider === target.provider
          )
          if (!runtime || !destination) continue

          const objectKey = buildOssKey(
            destination.prefix,
            task.uploadRelativePath || task.folderName,
            target.relativePath
          )
          const localPath = join(task.folderPath, target.relativePath)
          let acquired = false

          try {
            await semaphore.acquire(signal)
            acquired = true
            destinationRepo.updateFileStatus(target.id, 'uploading')
            target.status = 'uploading'
            this.setMarkerFileStatus(
              processMarker,
              target.provider,
              target.relativePath,
              'uploading'
            )
            this.broadcastProgress(
              task.id,
              target.provider,
              runtime,
              target.relativePath
            )

            const uploadResult = await this.uploadWithRetry(
              runtime.uploader,
              localPath,
              objectKey,
              target.fileSize,
              (fraction) => {
                runtime.speed.addSample(Math.round(target.fileSize * fraction))
                this.broadcastProgress(
                  task.id,
                  target.provider,
                  runtime,
                  target.relativePath
                )
              },
              signal,
              task.id,
              target.relativePath,
              target.provider
            )

            destinationRepo.updateFileStatus(
              target.id,
              'completed',
              uploadResult.objectKey,
              uploadResult.uploadId
            )
            target.status = 'completed'
            this.setMarkerFileStatus(
              processMarker,
              target.provider,
              target.relativePath,
              'completed'
            )
            runtime.uploadedFiles++
            runtime.uploadedBytes += target.fileSize
            completedRequests++
            destinationRepo.updateProgress(
              task.id,
              target.provider,
              runtime.uploadedFiles,
              runtime.uploadedBytes
            )

            const logicalStatus = destinationRepo.recalculateLogicalFile(
              target.taskFileId
            )
            if (
              logicalStatus === 'completed' &&
              !logicalCompleted.has(target.taskFileId)
            ) {
              logicalCompleted.add(target.taskFileId)
              logicalUploadedBytes += target.fileSize
              taskRepo.updateProgress(
                task.id,
                logicalCompleted.size,
                logicalUploadedBytes
              )
            }

            this.updateMarkerAggregate(
              processMarker,
              logicalCompleted.size,
              allTargets
            )
            if (
              completedRequests % 10 === 0 ||
              completedRequests === allTargets.length
            ) {
              writeProcessTask(task.folderPath, processMarker)
            }
            this.broadcastProgress(
              task.id,
              target.provider,
              runtime,
              null
            )
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              destinationRepo.updateFileStatus(target.id, 'pending')
              target.status = 'pending'
              this.setMarkerFileStatus(
                processMarker,
                target.provider,
                target.relativePath,
                'pending'
              )
              break
            }
            const message = err instanceof Error ? err.message : String(err)
            destinationRepo.updateFileStatus(
              target.id,
              'failed',
              undefined,
              undefined,
              message
            )
            target.status = 'failed'
            destinationRepo.recalculateLogicalFile(target.taskFileId)
            this.setMarkerFileStatus(
              processMarker,
              target.provider,
              target.relativePath,
              'failed'
            )
            log.error(
              `上传失败 [${target.provider}] ${target.relativePath}:`,
              message
            )
          } finally {
            if (acquired) semaphore.release()
          }
        }
      }

      await Promise.all(
        Array.from({ length: workerCount }, () => runNext())
      )

      if (signal?.aborted) {
        processMarker.status = 'paused'
        processMarker.lastUpdated = new Date().toISOString()
        for (const destination of activeDestinations) {
          destinationRepo.updateStatus(task.id, destination.provider, 'paused')
          this.broadcastDestinationStatus(task.id, destination.provider, 'paused')
          const marker = processMarker.destinations?.[destination.provider]
          if (marker) marker.status = 'paused'
        }
        writeProcessTask(task.folderPath, processMarker)
        return
      }

      this.updateMarkerAggregate(
        processMarker,
        logicalCompleted.size,
        allTargets
      )
      const failures: string[] = []
      for (const destination of destinations) {
        if (destination.status === 'completed') continue
        const providerTargets = destinationRepo.listFileTargets(
          task.id,
          destination.provider
        )
        const failed = providerTargets.filter(
          (target) => target.status === 'failed'
        )
        const runtime = runtimes.get(destination.provider)
        const marker = processMarker.destinations?.[destination.provider]

        if (failed.length > 0) {
          const summary = `${failed.length} 个文件上传失败，例如 ${failed
            .slice(0, 3)
            .map(
              (target) =>
                `${target.relativePath}: ${target.errorMessage || 'unknown error'}`
            )
            .join(' | ')}`
          destinationRepo.updateStatus(
            task.id,
            destination.provider,
            'failed',
            summary
          )
          this.broadcastDestinationStatus(
            task.id,
            destination.provider,
            'failed',
            summary
          )
          if (marker) {
            marker.status = 'failed'
            marker.error = summary
          }
          failures.push(`${destination.provider}: ${summary}`)
        } else {
          destinationRepo.updateStatus(
            task.id,
            destination.provider,
            'completed'
          )
          this.broadcastDestinationStatus(
            task.id,
            destination.provider,
            'completed'
          )
          if (runtime) {
            destinationRepo.updateProgress(
              task.id,
              destination.provider,
              runtime.totalFiles,
              runtime.totalBytes
            )
          }
          if (marker) {
            marker.status = 'completed'
            marker.uploadedFiles = marker.totalFiles
            marker.error = null
          }
        }
      }

      processMarker.lastUpdated = new Date().toISOString()
      if (failures.length > 0) {
        processMarker.status = 'failed'
        processMarker.error = failures.join(' || ')
        writeProcessTask(task.folderPath, processMarker)
        throw new Error(processMarker.error)
      }

      processMarker.status = 'completed'
      processMarker.uploadedFiles = files.length
      processMarker.error = null
      writeProcessTask(task.folderPath, processMarker)
    } finally {
      signal?.removeEventListener('abort', abortUploaders)
      for (const runtime of runtimes.values()) runtime.uploader.dispose()
    }
  }

  private registerFiles(
    task: Task,
    files: Array<{ relativePath: string; size: number }>
  ): void {
    const taskRepo = getTaskRepo()
    const existingPaths = new Set(
      taskRepo.listFiles(task.id).map((file) => file.relativePath)
    )
    const newFiles = files.filter(
      (file) => !existingPaths.has(file.relativePath)
    )
    if (newFiles.length > 0) {
      taskRepo.bulkCreateFiles(
        task.id,
        newFiles.map((file) => ({
          relativePath: file.relativePath,
          fileSize: file.size
        }))
      )
    }
  }

  private completeEmptyTask(
    task: Task,
    providers: CloudProvider[]
  ): void {
    const taskRepo = getTaskRepo()
    const destinationRepo = getTaskDestinationRepo()
    taskRepo.updateProgress(task.id, 0, 0)
    for (const provider of providers) {
      destinationRepo.setTotals(task.id, provider, 0, 0)
      destinationRepo.updateProgress(task.id, provider, 0, 0)
      destinationRepo.updateStatus(task.id, provider, 'completed')
    }
    writeProcessTask(task.folderPath, {
      version: 2,
      taskId: task.id,
      status: 'completed',
      totalFiles: 0,
      uploadedFiles: 0,
      files: {},
      lastUpdated: new Date().toISOString(),
      error: null,
      uploadTargetMode: task.uploadTargetMode,
      destinations: Object.fromEntries(
        providers.map((provider) => [
          provider,
          {
            status: 'completed',
            totalFiles: 0,
            uploadedFiles: 0,
            files: {},
            error: null
          }
        ])
      )
    })
  }

  private createProcessMarker(
    task: Task,
    files: Array<{ relativePath: string }>,
    targets: FileDestinationUploadTarget[]
  ): ProcessTaskMarker {
    const destinations: NonNullable<ProcessTaskMarker['destinations']> = {}
    for (const destination of task.destinations) {
      const providerTargets = targets.filter(
        (target) => target.provider === destination.provider
      )
      destinations[destination.provider] = {
        status:
          destination.status === 'pending' ? 'uploading' : destination.status,
        totalFiles: files.length,
        uploadedFiles: providerTargets.filter(
          (target) => target.status === 'completed'
        ).length,
        files: Object.fromEntries(
          providerTargets.map((target) => [
            target.relativePath,
            target.status === 'uploading' ? 'pending' : target.status
          ])
        ),
        error: null
      }
    }
    return {
      version: 2,
      taskId: task.id,
      status: 'uploading',
      totalFiles: files.length,
      uploadedFiles: 0,
      files: Object.fromEntries(
        files.map((file) => [file.relativePath, 'pending'])
      ),
      lastUpdated: new Date().toISOString(),
      error: null,
      uploadTargetMode: task.uploadTargetMode,
      destinations
    }
  }

  private groupTargets(
    targets: FileDestinationUploadTarget[]
  ): Map<CloudProvider, FileDestinationUploadTarget[]> {
    const result = new Map<CloudProvider, FileDestinationUploadTarget[]>()
    for (const target of targets) {
      const list = result.get(target.provider) || []
      list.push(target)
      result.set(target.provider, list)
    }
    return result
  }

  private setMarkerFileStatus(
    marker: ProcessTaskMarker,
    provider: CloudProvider,
    relativePath: string,
    status: FileStatus
  ): void {
    const destination = marker.destinations?.[provider]
    if (destination) {
      destination.files[relativePath] = status
      destination.uploadedFiles = Object.values(destination.files).filter(
        (value) => value === 'completed'
      ).length
    }
  }

  private updateMarkerAggregate(
    marker: ProcessTaskMarker,
    uploadedFiles: number,
    allTargets: FileDestinationUploadTarget[]
  ): void {
    marker.uploadedFiles = uploadedFiles
    marker.lastUpdated = new Date().toISOString()
    const relativePaths = new Set(allTargets.map((target) => target.relativePath))
    for (const relativePath of relativePaths) {
      const targets = allTargets.filter(
        (target) => target.relativePath === relativePath
      )
      const latestStatuses = targets.map((target) => target.status)
      marker.files[relativePath] = latestStatuses.every(
        (status) => status === 'completed'
      )
        ? 'completed'
        : latestStatuses.some((status) => status === 'failed')
          ? 'failed'
          : 'pending'
    }
  }

  private broadcastProgress(
    taskId: string,
    provider: CloudProvider,
    runtime: ProviderRuntime,
    currentFile: string | null
  ): void {
    const progress: TaskProgress = {
      taskId,
      provider,
      uploadedFiles: runtime.uploadedFiles,
      totalFiles: runtime.totalFiles,
      uploadedBytes: runtime.uploadedBytes,
      totalBytes: runtime.totalBytes,
      speed: runtime.speed.getSpeed(),
      currentFile
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_PROGRESS, progress)
    }
  }

  private broadcastDestinationStatus(
    taskId: string,
    provider: CloudProvider,
    status: Task['status'],
    errorMessage?: string
  ): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_DESTINATION_CHANGE, {
        taskId,
        provider,
        status,
        errorMessage
      })
    }
  }

  private async uploadWithRetry(
    uploader: CloudTaskUploader,
    localPath: string,
    objectKey: string,
    fileSize: number,
    onProgress: (fraction: number) => void,
    signal: AbortSignal | undefined,
    taskId: string,
    relativePath: string,
    provider: CloudProvider
  ): Promise<Awaited<ReturnType<CloudTaskUploader['uploadFile']>>> {
    let attempt = 0
    while (true) {
      try {
        const result = await uploader.uploadFile(
          localPath,
          objectKey,
          fileSize,
          onProgress,
          signal
        )
        return result
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        if (!this.isRetriableUploadError(err) || attempt >= this.maxUploadRetries) {
          throw err
        }
        attempt++
        const delayMs = Math.min(5000, 500 * 2 ** (attempt - 1))
        log.warn(
          `任务 ${taskId} [${provider}] 文件重试 ${attempt}/${this.maxUploadRetries}: ${relativePath}`
        )
        await this.sleep(delayMs)
      }
    }
  }

  private isRetriableUploadError(err: unknown): boolean {
    const error = err as {
      code?: string
      status?: number
      name?: string
      message?: string
      $metadata?: { httpStatusCode?: number }
    }
    const status = error.status || error.$metadata?.httpStatusCode
    if (typeof status === 'number' && (status === 429 || status >= 500)) {
      return true
    }
    const transientCodes = new Set([
      'ECONNRESET',
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE'
    ])
    if (error.code && transientCodes.has(error.code)) return true
    const text = `${error.name || ''} ${error.message || ''}`.toLowerCase()
    return text.includes('timeout') || text.includes('temporarily unavailable')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

let instance: TaskRunnerService | null = null
export function getTaskRunnerService(): TaskRunnerService {
  if (!instance) instance = new TaskRunnerService()
  return instance
}

import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from '@shared/ipc-channels'
import { buildOssKey } from '@shared/day-folder'
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
  ProcessTaskMarker,
  Task,
  TaskProgress,
  TaskStatus
} from '@shared/types'

interface ProviderRuntime {
  uploader: CloudTaskUploader
  speed: SpeedCalculator
  uploadedFiles: number
  uploadedBytes: number
  totalFiles: number
  totalBytes: number
  queuedFiles: number
  failedFiles: number
  skippedFiles: number
  activeUploads: Map<string, number>
  transferredBytes: number
  lastBroadcastAt: number
}

interface LogicalProgress {
  completed: Set<string>
  uploadedBytes: number
}

const RETRY_DELAYS_MS = [1000, 2000, 5000, 15000, 30000]

export class TaskRunnerService {
  async run(task: Task, signal?: AbortSignal): Promise<TaskStatus> {
    const taskRepo = getTaskRepo()
    const destinationRepo = getTaskDestinationRepo()
    const settings = getSettingsRepo().getAll()
    const stableChecks =
      task.sourceType === 'local' && task.dayFolderId
        ? Math.max(2, settings.stability.checkCount || 2)
        : 1

    if (!existsSync(task.folderPath)) {
      destinationRepo.updateIncompleteStatuses(
        task.id,
        'skipped',
        '源目录已删除'
      )
      return 'skipped'
    }

    await this.reconcileBeforeUpload(task, stableChecks)
    const destinations = destinationRepo.listByTask(task.id)
    if (destinations.length === 0) {
      throw new Error('任务没有配置任何上传目标')
    }

    const jobs = destinationRepo.listReadyFileTargets(
      task.id,
      stableChecks
    )
    if (jobs.length === 0) {
      taskRepo.recalculateProgress(task.id)
      return this.updateDestinationFinalStates(task)
    }
    const jobProviders = new Set(jobs.map((job) => job.provider))
    for (const destination of destinations) {
      if (!jobProviders.has(destination.provider)) continue
      const error = getCloudUploadService().validateProvider(
        destination.provider,
        settings
      )
      if (error) throw new Error(error)
    }
    const completedLogicalFiles = taskRepo.listFiles(task.id, 'completed')
    const logicalProgress: LogicalProgress = {
      completed: new Set(completedLogicalFiles.map((file) => file.id)),
      uploadedBytes: completedLogicalFiles.reduce(
        (sum, file) => sum + file.fileSize,
        0
      )
    }

    const providers = Array.from(new Set(jobs.map((job) => job.provider)))
    const runtimes = new Map<CloudProvider, ProviderRuntime>()
    try {
      for (const provider of providers) {
        const destination = destinations.find((item) => item.provider === provider)
        if (!destination) continue
        const uploader = await getCloudUploadService().createTaskUploader(
          provider,
          settings,
          settings.upload.multipartThreshold
        )
        const providerTargets = destinationRepo.listFileTargets(task.id, provider)
        runtimes.set(provider, {
          uploader,
          speed: new SpeedCalculator(),
          uploadedFiles: providerTargets.filter(
            (target) => target.status === 'completed'
          ).length,
          uploadedBytes: providerTargets
            .filter((target) => target.status === 'completed')
            .reduce((sum, target) => sum + target.fileSize, 0),
          totalFiles: providerTargets.length,
          totalBytes: providerTargets.reduce(
            (sum, target) => sum + target.fileSize,
            0
          ),
          queuedFiles: providerTargets.filter(
            (target) => target.status === 'pending'
          ).length,
          failedFiles: providerTargets.filter(
            (target) => target.status === 'failed'
          ).length,
          skippedFiles: providerTargets.filter(
            (target) => target.status === 'skipped'
          ).length,
          activeUploads: new Map(),
          transferredBytes: 0,
          lastBroadcastAt: 0
        })
        destinationRepo.updateStatus(task.id, provider, 'uploading')
        this.broadcastDestinationStatus(task.id, provider, 'uploading')
      }
    } catch (error) {
      for (const runtime of runtimes.values()) runtime.uploader.dispose()
      throw error
    }

    const abortUploaders = (): void => {
      for (const runtime of runtimes.values()) runtime.uploader.abort()
    }
    signal?.addEventListener('abort', abortUploaders, { once: true })

    const marker = this.createCompactMarker(
      { ...task, status: 'uploading' },
      destinations
    )
    this.writeMarker(task.folderPath, marker)
    const markerTimer = setInterval(() => {
      const currentTask = taskRepo.getById(task.id)
      if (!currentTask) return
      this.writeMarker(
        task.folderPath,
        this.createCompactMarker(
          currentTask,
          destinationRepo.listByTask(task.id)
        )
      )
    }, 2000)

    const semaphore = getUploadSemaphore(
      settings.upload.maxConcurrentUploads || 24
    )
    let nextIndex = 0
    const workerCount = Math.max(
      1,
      Math.min(settings.upload.maxFilesPerTask || 12, jobs.length)
    )

    const runNext = async (): Promise<void> => {
      while (nextIndex < jobs.length && !signal?.aborted) {
        const target = jobs[nextIndex++]
        await this.uploadTarget(
          task,
          target,
          destinations,
          runtimes,
          semaphore,
          logicalProgress,
          signal
        )
      }
    }

    try {
      await Promise.all(
        Array.from({ length: workerCount }, () => runNext())
      )
    } finally {
      clearInterval(markerTimer)
      signal?.removeEventListener('abort', abortUploaders)
      for (const runtime of runtimes.values()) runtime.uploader.dispose()
    }

    if (signal?.aborted) {
      return getTaskRepo().getById(task.id)?.status || 'paused'
    }

    taskRepo.recalculateProgress(task.id)
    const finalStatus = this.updateDestinationFinalStates(task)
    const currentTask = taskRepo.getById(task.id) || task
    const finalTask = { ...currentTask, status: finalStatus }
    this.writeMarker(
      task.folderPath,
      this.createCompactMarker(finalTask, destinationRepo.listByTask(task.id))
    )
    return finalStatus
  }

  private async reconcileBeforeUpload(
    task: Task,
    stableChecks: number
  ): Promise<void> {
    const settings = getSettingsRepo().getAll()
    const files = await new FileFilterService(settings.filter).scanFolderAsync(
      task.folderPath
    )
    getTaskRepo().reconcileFiles(
      task.id,
      files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        mtimeMs: file.mtimeMs
      })),
      stableChecks
    )
  }

  private async uploadTarget(
    task: Task,
    target: FileDestinationUploadTarget,
    destinations: Task['destinations'],
    runtimes: Map<CloudProvider, ProviderRuntime>,
    semaphore: ReturnType<typeof getUploadSemaphore>,
    logicalProgress: LogicalProgress,
    signal?: AbortSignal
  ): Promise<void> {
    const taskRepo = getTaskRepo()
    const destinationRepo = getTaskDestinationRepo()
    const runtime = runtimes.get(target.provider)
    const destination = destinations.find(
      (item) => item.provider === target.provider
    )
    if (!runtime || !destination) return

    const localPath = join(task.folderPath, target.relativePath)
    if (!existsSync(localPath)) {
      destinationRepo.updateFileStatus(
        target.id,
        'skipped',
        undefined,
        undefined,
        '源文件已删除'
      )
      destinationRepo.recalculateLogicalFile(target.taskFileId)
      runtime.skippedFiles++
      runtime.queuedFiles = Math.max(0, runtime.queuedFiles - 1)
      this.broadcastProgress(task.id, target.provider, runtime, null, true)
      return
    }

    let acquired = false
    try {
      await semaphore.acquire(signal)
      acquired = true
      if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')

      const before = statSync(localPath)
      if (
        before.size !== target.fileSize ||
        before.mtimeMs !== target.mtimeMs
      ) {
        taskRepo.markFileChanged(
          target.taskFileId,
          before.size,
          before.mtimeMs
        )
        log.info('文件在进入上传前发生变化，等待重新稳定:', localPath)
        return
      }
      destinationRepo.updateFileStatus(target.id, 'uploading')
      runtime.activeUploads.set(target.id, 0)
      runtime.queuedFiles = Math.max(0, runtime.queuedFiles - 1)
      this.broadcastProgress(
        task.id,
        target.provider,
        runtime,
        target.relativePath,
        true
      )

      const objectKey = buildOssKey(
        destination.prefix,
        destination.uploadRelativePath,
        target.relativePath
      )
      let previousLoaded = 0
      const result = await runtime.uploader.uploadFile(
        localPath,
        objectKey,
        target.fileSize,
        (fraction) => {
          const loaded = Math.min(
            target.fileSize,
            Math.max(0, Math.round(target.fileSize * fraction))
          )
          const delta = Math.max(0, loaded - previousLoaded)
          previousLoaded = loaded
          runtime.transferredBytes += delta
          runtime.activeUploads.set(target.id, loaded)
          runtime.speed.addSample(runtime.transferredBytes)
          this.broadcastProgress(
            task.id,
            target.provider,
            runtime,
            target.relativePath
          )
        },
        signal
      )

      if (existsSync(localPath)) {
        const after = statSync(localPath)
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs
        ) {
          taskRepo.markFileChanged(target.taskFileId, after.size, after.mtimeMs)
          log.info('文件上传期间发生变化，重新排队:', localPath)
          return
        }
      }

      destinationRepo.updateFileStatus(
        target.id,
        'completed',
        result.objectKey,
        result.uploadId
      )
      const logicalStatus = destinationRepo.recalculateLogicalFile(
        target.taskFileId
      )
      if (logicalStatus === 'completed') {
        taskRepo.clearRetry(target.taskFileId)
        if (!logicalProgress.completed.has(target.taskFileId)) {
          logicalProgress.completed.add(target.taskFileId)
          logicalProgress.uploadedBytes += target.fileSize
          taskRepo.updateProgress(
            task.id,
            logicalProgress.completed.size,
            logicalProgress.uploadedBytes
          )
        }
      }
      runtime.uploadedFiles++
      runtime.uploadedBytes += target.fileSize
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (taskRepo.getById(task.id)?.status !== 'skipped') {
          destinationRepo.updateFileStatus(target.id, 'pending')
        }
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      if (
        this.isRetriableUploadError(error) &&
        target.retryCount < RETRY_DELAYS_MS.length
      ) {
        const delay = this.retryDelay(target.retryCount)
        const nextRetryAt = new Date(Date.now() + delay).toISOString()
        const retryCount = taskRepo.scheduleRetry(
          target.taskFileId,
          message,
          nextRetryAt
        )
        destinationRepo.updateFileStatus(
          target.id,
          'pending',
          undefined,
          undefined,
          `第 ${retryCount} 次重试等待中: ${message}`
        )
        log.warn(
          `任务 ${task.id} [${target.provider}] 将在 ${delay}ms 后重试: ${target.relativePath}`
        )
      } else {
        destinationRepo.updateFileStatus(
          target.id,
          'failed',
          undefined,
          undefined,
          message
        )
        destinationRepo.recalculateLogicalFile(target.taskFileId)
        runtime.failedFiles++
        log.error(
          `上传失败 [${target.provider}] ${target.relativePath}:`,
          message
        )
      }
    } finally {
      runtime.activeUploads.delete(target.id)
      if (acquired) semaphore.release()
      destinationRepo.updateProgress(
        task.id,
        target.provider,
        runtime.uploadedFiles,
        runtime.uploadedBytes
      )
      this.broadcastProgress(task.id, target.provider, runtime, null, true)
    }
  }

  private updateDestinationFinalStates(task: Task): TaskStatus {
    const repo = getTaskDestinationRepo()
    let taskStatus: TaskStatus =
      task.sourceType === 'local' && task.dayFolderId ? 'synced' : 'completed'

    for (const destination of repo.listByTask(task.id)) {
      const targets = repo.listFileTargets(task.id, destination.provider)
      const failed = targets.filter((target) => target.status === 'failed')
      const pending = targets.filter((target) => target.status === 'pending')
      const skipped = targets.filter((target) => target.status === 'skipped')

      if (failed.length > 0) {
        const summary = `${failed.length} 个文件上传失败，例如 ${failed
          .slice(0, 3)
          .map(
            (target) =>
              `${target.relativePath}: ${target.errorMessage || 'unknown error'}`
          )
          .join(' | ')}`
        repo.updateStatus(task.id, destination.provider, 'failed', summary)
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          'failed',
          summary
        )
        taskStatus = 'failed'
      } else if (pending.length > 0) {
        repo.updateStatus(
          task.id,
          destination.provider,
          'retrying',
          `${pending.length} 个文件等待自动重试或稳定`
        )
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          'retrying',
          `${pending.length} 个文件等待自动重试或稳定`
        )
        if (taskStatus !== 'failed') taskStatus = 'retrying'
      } else {
        const status: TaskStatus =
          task.sourceType === 'local' && task.dayFolderId
            ? 'synced'
            : 'completed'
        repo.updateStatus(
          task.id,
          destination.provider,
          status,
          skipped.length > 0 ? `${skipped.length} 个源文件已跳过` : undefined
        )
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          status,
          skipped.length > 0 ? `${skipped.length} 个源文件已跳过` : undefined
        )
      }
      repo.recalculateProgress(task.id, destination.provider)
    }

    return taskStatus
  }

  private createCompactMarker(
    task: Task,
    destinations: Task['destinations']
  ): ProcessTaskMarker {
    const destinationRepo = getTaskDestinationRepo()
    return {
      version: 3,
      taskId: task.id,
      status: task.status,
      totalFiles: task.totalFiles,
      uploadedFiles: task.uploadedFiles,
      failedFiles: taskRepoCount(task.id, 'failed'),
      skippedFiles: taskRepoCount(task.id, 'skipped'),
      lastUpdated: new Date().toISOString(),
      error:
        task.errorMessage ||
        destinations
          .map((destination) => destination.errorMessage)
          .filter(Boolean)
          .join(' || ') ||
        null,
      uploadTargetMode: task.uploadTargetMode,
      destinations: Object.fromEntries(
        destinations.map((destination) => {
          const targets = destinationRepo.listFileTargets(
            task.id,
            destination.provider
          )
          return [
            destination.provider,
            {
              status: destination.status,
              uploadRelativePath: destination.uploadRelativePath,
              totalFiles: targets.length,
              uploadedFiles: targets.filter(
                (target) => target.status === 'completed'
              ).length,
              failedFiles: targets.filter(
                (target) => target.status === 'failed'
              ).length,
              skippedFiles: targets.filter(
                (target) => target.status === 'skipped'
              ).length,
              error: destination.errorMessage
            }
          ]
        })
      )
    }
  }

  private broadcastProgress(
    taskId: string,
    provider: CloudProvider,
    runtime: ProviderRuntime,
    currentFile: string | null,
    force = false
  ): void {
    const now = Date.now()
    if (!force && now - runtime.lastBroadcastAt < 250) return
    runtime.lastBroadcastAt = now
    const inFlightBytes = Array.from(runtime.activeUploads.values()).reduce(
      (sum, bytes) => sum + bytes,
      0
    )
    const progress: TaskProgress = {
      taskId,
      provider,
      uploadedFiles: runtime.uploadedFiles,
      totalFiles: runtime.totalFiles,
      uploadedBytes: Math.min(
        runtime.totalBytes,
        runtime.uploadedBytes + inFlightBytes
      ),
      totalBytes: runtime.totalBytes,
      speed: runtime.speed.getSpeed(),
      currentFile,
      queuedFiles: runtime.queuedFiles,
      activeUploads: runtime.activeUploads.size,
      failedFiles: runtime.failedFiles,
      skippedFiles: runtime.skippedFiles,
      transferredBytes: runtime.transferredBytes
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_PROGRESS, progress)
    }
  }

  private writeMarker(folderPath: string, marker: ProcessTaskMarker): void {
    if (!existsSync(folderPath)) return
    try {
      writeProcessTask(folderPath, marker)
    } catch (error) {
      log.warn('写入任务汇总标记失败:', folderPath, error)
    }
  }

  private broadcastDestinationStatus(
    taskId: string,
    provider: CloudProvider,
    status: TaskStatus,
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

  private retryDelay(retryCount: number): number {
    const base =
      RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)]
    const jitter = 0.8 + Math.random() * 0.4
    return Math.round(base * jitter)
  }

  private isRetriableUploadError(errorValue: unknown): boolean {
    const error = errorValue as {
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
      'EPIPE',
      'ECONNREFUSED'
    ])
    if (error.code && transientCodes.has(error.code)) return true
    const text = `${error.name || ''} ${error.message || ''}`.toLowerCase()
    return (
      text.includes('timeout') ||
      text.includes('temporarily unavailable') ||
      text.includes('socket hang up')
    )
  }
}

function taskRepoCount(taskId: string, status: string): number {
  return getTaskRepo().listFiles(taskId, status).length
}

let instance: TaskRunnerService | null = null
export function getTaskRunnerService(): TaskRunnerService {
  if (!instance) instance = new TaskRunnerService()
  return instance
}

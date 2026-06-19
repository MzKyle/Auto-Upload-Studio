import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from '@shared/ipc-channels'
import { buildUploadRelativePath } from '@shared/day-folder'
import { getUploadTargetSnapshot } from '@shared/cloud-upload'
import { getTaskRepo } from '../db/task.repo'
import { getTaskDestinationRepo } from '../db/task-destination.repo'
import { getDayFolderRepo } from '../db/day-folder.repo'
import { getSettingsRepo } from '../db/settings.repo'
import { getDataCollectService } from './data-collect.service'
import { getDayFolderService } from './day-folder.service'
import { discoverDayDirectories } from './date-directory-discovery'
import {
  readProcessTask,
  readTmpUpload,
  writeProcessTask,
  writeTmpUpload
} from '../utils/marker-file'
import type {
  TmpUploadMarker,
  ScanConfig,
  StabilityConfig,
  ScannerStatus,
  DataCollectConfig,
  Task,
  UploadTargetMode,
  CloudProvider
} from '@shared/types'

interface PendingDir {
  path: string
  dayFolderId: string
  dateName: string
  folderName: string
  uploadRelativePath: string
  checks: number
  discoveredAt: string
  lastSnapshot: Map<string, { size: number; mtimeMs: number }>
  uploadTargetMode?: UploadTargetMode
  destinationPrefixes?: Partial<Record<CloudProvider, string>>
}

/**
 * 日期目录扫描服务
 * - 配置项指向数据根目录
 * - 根目录下只识别 YYYY-MM-DD 日期目录
 * - 日期目录的直接子目录分别作为上传任务
 * - 子目录稳定后注册任务，日期跨天且所有子任务完成后封账
 */
export class ScannerService {
  private timer: ReturnType<typeof setInterval> | null = null
  private stabilityTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastScanAt: string | null = null
  private nextScanAt: string | null = null
  private pendingDirs: Map<string, PendingDir> = new Map()
  private lastScanResults: ScannerStatus['lastScanResults'] = null

  start(): void {
    if (this.running) return
    this.running = true

    const settings = getSettingsRepo()
    const scanConfig = settings.get<ScanConfig>('scan')
    const intervalMs = (scanConfig?.intervalSeconds || 30) * 1000

    this.scan()
    this.timer = setInterval(() => this.scan(), intervalMs)

    const stabilityConfig = settings.get<StabilityConfig>('stability')
    const checkInterval = stabilityConfig?.checkIntervalMs || 5000
    this.stabilityTimer = setInterval(() => this.checkStability(), checkInterval)

    log.info('扫描器已启动, 间隔:', intervalMs / 1000, '秒')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.stabilityTimer) {
      clearInterval(this.stabilityTimer)
      this.stabilityTimer = null
    }
    this.running = false
    this.nextScanAt = null
    log.info('扫描器已停止')
    this.broadcastStatus()
  }

  isRunning(): boolean {
    return this.running
  }

  getStatus(): ScannerStatus {
    const settings = getSettingsRepo()
    const scanConfig = settings.get<ScanConfig>('scan')
    const stabilityConfig = settings.get<StabilityConfig>('stability')
    const requiredChecks = stabilityConfig?.checkCount || 3

    const pendingStabilityChecks: ScannerStatus['pendingStabilityChecks'] = []
    for (const pending of this.pendingDirs.values()) {
      pendingStabilityChecks.push({
        path: pending.path,
        checks: pending.checks,
        requiredChecks,
        discoveredAt: pending.discoveredAt
      })
    }

    return {
      running: this.running,
      lastScanAt: this.lastScanAt,
      nextScanAt: this.nextScanAt,
      watchedDirectories: scanConfig?.directories || [],
      pendingStabilityChecks,
      lastScanResults: this.lastScanResults
    }
  }

  triggerScan(): void {
    this.scan()
  }

  private scan(): void {
    const settings = getSettingsRepo()
    const scanConfig = settings.get<ScanConfig>('scan')
    const directories = scanConfig?.directories || []
    const intervalMs = (scanConfig?.intervalSeconds || 30) * 1000
    const seenChildPaths = new Set<string>()

    let scannedDirs = 0
    let newDirsFound = 0
    let existingDirs = 0

    for (const rootDir of directories) {
      if (!existsSync(rootDir)) {
        log.warn('扫描根目录不存在:', rootDir)
        continue
      }
      const result = this.scanRootDirectory(rootDir, seenChildPaths)
      scannedDirs += result.scanned
      newDirsFound += result.newFound
      existingDirs += result.existing
    }

    for (const pendingPath of this.pendingDirs.keys()) {
      if (!seenChildPaths.has(pendingPath)) {
        this.pendingDirs.delete(pendingPath)
      }
    }

    this.lastScanAt = new Date().toISOString()
    this.nextScanAt = new Date(Date.now() + intervalMs).toISOString()
    this.lastScanResults = {
      scannedDirs,
      newDirsFound,
      existingDirs,
      timestamp: this.lastScanAt
    }
    this.broadcastStatus()
  }

  private scanRootDirectory(
    rootDir: string,
    seenChildPaths: Set<string>
  ): { scanned: number; newFound: number; existing: number } {
    let scanned = 0
    let newFound = 0
    let existing = 0

    try {
      const dayDirectories = discoverDayDirectories(rootDir)
      for (const dayDirectory of dayDirectories) {
        const result = this.scanDayDirectory(
          dayDirectory.folderPath,
          dayDirectory.dateName,
          dayDirectory.childFolderNames,
          seenChildPaths
        )
        scanned += result.scanned
        newFound += result.newFound
        existing += result.existing
      }
    } catch (err) {
      log.error('扫描数据根目录失败:', rootDir, err)
    }

    return { scanned, newFound, existing }
  }

  private scanDayDirectory(
    dayFolderPath: string,
    dateName: string,
    discoveredChildNames: string[],
    seenChildPaths: Set<string>
  ): { scanned: number; newFound: number; existing: number } {
    const dayFolder = getDayFolderRepo().ensure(dayFolderPath, dateName)
    const childNames: string[] = []
    let scanned = 0
    let newFound = 0
    let existing = 0

    try {
      for (const childName of discoveredChildNames) {
        const childPath = join(dayFolderPath, childName)
        const uploadRelativePath = buildUploadRelativePath(dateName, childName)
        childNames.push(childName)
        seenChildPaths.add(childPath)
        scanned++

        const existingTask = getTaskRepo().getByFolderPath(childPath)
        if (existingTask) {
          this.attachTaskToDayFolder(existingTask, dayFolder.id, uploadRelativePath)
          this.pendingDirs.delete(childPath)
          existing++
          continue
        }

        const processMarker = readProcessTask(childPath)
        if (processMarker?.status === 'completed') {
          this.registerLegacyCompletedDir(
            childPath,
            childName,
            dayFolder.id,
            dateName,
            processMarker,
            readTmpUpload(childPath)
          )
          existing++
          continue
        }

        const tmpMarker = readTmpUpload(childPath)
        if (tmpMarker) {
          this.registerNewDir({
            path: childPath,
            dayFolderId: dayFolder.id,
            dateName,
            folderName: childName,
            uploadRelativePath,
            checks: 0,
            discoveredAt: tmpMarker.createdAt || new Date().toISOString(),
            lastSnapshot: new Map(),
            uploadTargetMode: tmpMarker.metadata.uploadTargetMode,
            destinationPrefixes: tmpMarker.metadata.destinationPrefixes
          })
          existing++
          continue
        }

        if (!this.pendingDirs.has(childPath)) {
          log.info('发现新焊接目录, 加入稳定性检查:', childPath)
          this.pendingDirs.set(childPath, {
            path: childPath,
            dayFolderId: dayFolder.id,
            dateName,
            folderName: childName,
            uploadRelativePath,
            checks: 0,
            discoveredAt: new Date().toISOString(),
            lastSnapshot: this.snapshotDir(childPath)
          })
          newFound++
        }
      }
    } catch (err) {
      log.error('扫描日期目录失败:', dayFolderPath, err)
    }

    getDayFolderService().refresh(dayFolder.id, childNames)
    return { scanned, newFound, existing }
  }

  private checkStability(): void {
    if (this.pendingDirs.size === 0) return

    const settings = getSettingsRepo()
    const stabilityConfig = settings.get<StabilityConfig>('stability')
    const requiredChecks = stabilityConfig?.checkCount || 3
    let changed = false

    for (const [dirPath, pending] of this.pendingDirs) {
      if (!existsSync(dirPath)) {
        this.pendingDirs.delete(dirPath)
        getDayFolderService().refresh(pending.dayFolderId)
        changed = true
        continue
      }

      const currentSnapshot = this.snapshotDir(dirPath)
      const isStable = this.compareSnapshots(pending.lastSnapshot, currentSnapshot)

      if (isStable) {
        pending.checks++
        log.info(`焊接目录稳定性检查 ${pending.checks}/${requiredChecks}:`, dirPath)

        if (pending.checks >= requiredChecks) {
          this.registerNewDir(pending)
          this.pendingDirs.delete(dirPath)
        }
        changed = true
      } else {
        pending.checks = 0
        pending.lastSnapshot = currentSnapshot
        changed = true
      }
    }

    if (changed) {
      this.broadcastStatus()
    }
  }

  private registerNewDir(pending: PendingDir): Task {
    const settings = getSettingsRepo().getAll()
    const snapshot =
      pending.uploadTargetMode && pending.destinationPrefixes
        ? {
            mode: pending.uploadTargetMode,
            prefixes: {
              aliyun: pending.destinationPrefixes.aliyun || '',
              tencent: pending.destinationPrefixes.tencent || ''
            }
          }
        : getUploadTargetSnapshot(settings)
    const marker: TmpUploadMarker = {
      version: 2,
      createdAt: new Date().toISOString(),
      folderPath: pending.path,
      metadata: {
        source: 'local',
        dayFolderId: pending.dayFolderId,
        date: pending.dateName,
        uploadRelativePath: pending.uploadRelativePath,
        uploadTargetMode: snapshot.mode,
        destinationPrefixes: snapshot.prefixes
      }
    }

    writeTmpUpload(pending.path, marker)
    const task = this.ensureTaskRegistered(
      pending.path,
      pending.folderName,
      pending.dayFolderId,
      pending.uploadRelativePath,
      snapshot
    )
    log.info('焊接目录已注册为上传任务:', pending.path)
    this.collectDataInfo(pending.path)
    getDayFolderService().refresh(pending.dayFolderId)
    return task
  }

  private registerLegacyCompletedDir(
    dirPath: string,
    folderName: string,
    dayFolderId: string,
    dateName: string,
    processMarker: NonNullable<ReturnType<typeof readProcessTask>>,
    tmpMarker: ReturnType<typeof readTmpUpload>
  ): void {
    const legacyUploadRelativePath = folderName
    const markerProviders = Object.keys(processMarker.destinations || {}) as CloudProvider[]
    const mode = processMarker.uploadTargetMode || (
      markerProviders.includes('tencent') && markerProviders.includes('aliyun')
        ? 'both'
        : markerProviders.includes('tencent')
          ? 'tencent'
          : 'aliyun'
    )
    const currentSettings = getSettingsRepo().getAll()
    const prefixes = {
      aliyun:
        tmpMarker?.metadata.destinationPrefixes?.aliyun ||
        currentSettings.oss.prefix ||
        '',
      tencent:
        tmpMarker?.metadata.destinationPrefixes?.tencent ||
        currentSettings.tencentS3.prefix ||
        ''
    }
    const task = this.ensureTaskRegistered(
      dirPath,
      folderName,
      dayFolderId,
      legacyUploadRelativePath,
      {
        mode,
        prefixes
      }
    )
    const taskRepo = getTaskRepo()
    taskRepo.setTotals(task.id, processMarker.totalFiles, 0)
    taskRepo.updateProgress(task.id, processMarker.uploadedFiles, 0)
    taskRepo.updateStatus(task.id, 'completed')
    for (const destination of getTaskDestinationRepo().listByTask(task.id)) {
      const marker = processMarker.destinations?.[destination.provider]
      getTaskDestinationRepo().setTotals(
        task.id,
        destination.provider,
        marker?.totalFiles ?? processMarker.totalFiles,
        0
      )
      getTaskDestinationRepo().updateProgress(
        task.id,
        destination.provider,
        marker?.uploadedFiles ?? processMarker.uploadedFiles,
        0
      )
      getTaskDestinationRepo().updateStatus(
        task.id,
        destination.provider,
        'completed'
      )
    }

    writeTmpUpload(dirPath, {
      version: 2,
      createdAt: new Date().toISOString(),
      folderPath: dirPath,
      metadata: {
        source: 'local',
        dayFolderId,
        date: dateName,
        uploadRelativePath: legacyUploadRelativePath,
        uploadTargetMode: mode,
        destinationPrefixes: prefixes
      }
    })
    writeProcessTask(dirPath, {
      ...processMarker,
      taskId: task.id,
      status: 'completed',
      lastUpdated: new Date().toISOString()
    })
    getDayFolderService().refresh(dayFolderId)
    log.info('信任旧完成标记并登记焊接任务:', dirPath)
  }

  private ensureTaskRegistered(
    dirPath: string,
    folderName: string,
    dayFolderId: string,
    uploadRelativePath: string,
    targetSnapshot?: {
      mode: UploadTargetMode
      prefixes: Record<CloudProvider, string>
    }
  ): Task {
    const taskRepo = getTaskRepo()
    const existing = taskRepo.getByFolderPath(dirPath)
    if (existing) {
      this.attachTaskToDayFolder(existing, dayFolderId, uploadRelativePath)
      return taskRepo.getById(existing.id)!
    }

    const settings = getSettingsRepo().getAll()
    const snapshot = targetSnapshot || getUploadTargetSnapshot(settings)
    return taskRepo.create({
      folderPath: dirPath,
      folderName,
      ossPrefix: snapshot.prefixes.aliyun,
      uploadTargetMode: snapshot.mode,
      destinationPrefixes: snapshot.prefixes,
      dayFolderId,
      uploadRelativePath,
      sourceType: 'local'
    })
  }

  private attachTaskToDayFolder(
    task: Task,
    dayFolderId: string,
    uploadRelativePath: string
  ): void {
    const targetUploadRelativePath =
      task.status === 'completed' && task.uploadRelativePath === task.folderName
        ? task.uploadRelativePath
        : uploadRelativePath

    if (
      task.dayFolderId !== dayFolderId ||
      task.uploadRelativePath !== targetUploadRelativePath
    ) {
      getTaskRepo().updateDayFolderMetadata(task.id, dayFolderId, targetUploadRelativePath)
    }
  }

  private collectDataInfo(dirPath: string): void {
    const settings = getSettingsRepo()
    const dataCollectConfig = settings.get<DataCollectConfig>('dataCollect')
    if (!dataCollectConfig?.enabled) return

    try {
      const info = getDataCollectService().collectDataInfo(dirPath)
      if (info) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.DATA_COLLECT_RESULT, info)
        }
      }
    } catch (err) {
      log.warn('数采分析失败:', dirPath, err)
    }
  }

  private broadcastStatus(): void {
    const status = this.getStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SCANNER_EVENT, status)
    }
  }

  private snapshotDir(dirPath: string): Map<string, { size: number; mtimeMs: number }> {
    const snapshot = new Map<string, { size: number; mtimeMs: number }>()
    this.walkForSnapshot(dirPath, dirPath, snapshot)
    return snapshot
  }

  private walkForSnapshot(
    basePath: string,
    currentPath: string,
    snapshot: Map<string, { size: number; mtimeMs: number }>
  ): void {
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name)
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) {
            this.walkForSnapshot(basePath, fullPath, snapshot)
          }
        } else if (entry.isFile()) {
          try {
            const stat = statSync(fullPath)
            const relPath = fullPath.slice(basePath.length + 1)
            snapshot.set(relPath, { size: stat.size, mtimeMs: stat.mtimeMs })
          } catch {
            // 文件可能在快照期间被删除
          }
        }
      }
    } catch {
      // 目录可能在扫描期间被删除或暂时不可读
    }
  }

  private compareSnapshots(
    prev: Map<string, { size: number; mtimeMs: number }>,
    curr: Map<string, { size: number; mtimeMs: number }>
  ): boolean {
    if (prev.size !== curr.size) return false
    for (const [key, prevVal] of prev) {
      const currVal = curr.get(key)
      if (!currVal) return false
      if (prevVal.size !== currVal.size || prevVal.mtimeMs !== currVal.mtimeMs) {
        return false
      }
    }
    return true
  }
}

let instance: ScannerService | null = null
export function getScannerService(): ScannerService {
  if (!instance) instance = new ScannerService()
  return instance
}

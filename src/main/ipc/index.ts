import { ipcMain, dialog, BrowserWindow, nativeImage } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { getTaskRepo } from '../db/task.repo'
import { getSettingsRepo } from '../db/settings.repo'
import { getHistoryRepo } from '../db/history.repo'
import { getScannerService } from '../services/scanner.service'
import { getTaskQueueService } from '../services/task-queue.service'
import { getSSHRsyncService } from '../services/ssh-rsync.service'
import { getOSSUploadService } from '../services/oss-upload.service'
import { getTencentS3UploadService } from '../services/tencent-s3-upload.service'
import { getCloudUploadService } from '../services/cloud-upload.service'
import { getCleanupService } from '../services/cleanup.service'
import { getDayFolderRepo } from '../db/day-folder.repo'
import { getDayFolderService } from '../services/day-folder.service'
import { getMainWindow, createAnnotationWindow } from '../index'
import { getDb } from '../db/database'
import { getDataCollectService } from '../services/data-collect.service'
import { getTaskDestinationRepo } from '../db/task-destination.repo'
import { v4 as uuid } from 'uuid'
import type { AppSettings, CloudProvider, HistoryQuery, TaskStatus, SSHMachine, SSHMachineInput, RsyncProgress, TransferMode, DiskUsageInfo, ScanConfig, DayFolderListQuery } from '@shared/types'
import { getUploadTargetSnapshot, providersForMode } from '@shared/cloud-upload'
import { resolveDirectoryUploadRelativePath } from '@shared/day-folder'
import { basename, normalize, extname, parse as pathParse, format as pathFormat, relative, join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { statfs } from 'fs/promises'
import log from 'electron-log'
import { writeTmpUpload } from '../utils/marker-file'

function rowToSSHMachine(row: Record<string, unknown>): SSHMachine {
  return {
    id: row.id as string,
    name: row.name as string,
    host: row.host as string,
    port: row.port as number,
    username: row.username as string,
    authType: row.auth_type as SSHMachine['authType'],
    privateKeyPath: (row.private_key_path as string) || null,
    remoteDir: row.remote_dir as string,
    localDir: row.local_dir as string,
    bwLimit: row.bw_limit as number,
    cpuNice: row.cpu_nice as number,
    transferMode: (row.transfer_mode as TransferMode) || 'rsync',
    enabled: Boolean(row.enabled),
    lastSyncAt: (row.last_sync_at as string) || null,
    createdAt: row.created_at as string
  }
}

export function registerAllIpc(): void {
  /** Broadcast task status change to all renderer windows */
  function broadcastStatusChange(taskId: string, newStatus: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_STATUS_CHANGE, { taskId, newStatus })
    }
  }

  // ---- 任务管理 ----
  ipcMain.handle(IPC.TASK_LIST, (_event, args?: { status?: TaskStatus }) => {
    return getTaskRepo().listByStatus(args?.status)
  })

  ipcMain.handle(IPC.TASK_GET, (_event, args: { taskId: string }) => {
    return getTaskRepo().getById(args.taskId)
  })

  ipcMain.handle(IPC.TASK_ADD_FOLDER, (_event, args: { folderPath: string }) => {
    const taskRepo = getTaskRepo()
    const settingsRepo = getSettingsRepo()
    const snapshot = getUploadTargetSnapshot(settingsRepo.getAll())
    const folderName = basename(args.folderPath)
    const uploadRelativePath = resolveDirectoryUploadRelativePath(args.folderPath)
    return taskRepo.create({
      folderPath: args.folderPath,
      folderName,
      ossPrefix: snapshot.prefixes.aliyun,
      uploadTargetMode: snapshot.mode,
      destinationPrefixes: snapshot.prefixes,
      uploadRelativePath,
      sourceType: 'manual'
    })
  })

  ipcMain.handle(IPC.TASK_PAUSE, (_event, args: { taskId: string }) => {
    getTaskQueueService().cancelRunningTask(args.taskId)
    getTaskRepo().updateStatus(args.taskId, 'paused')
    getTaskDestinationRepo().updateIncompleteStatuses(args.taskId, 'paused')
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'paused')
  })

  ipcMain.handle(IPC.TASK_RESUME, (_event, args: { taskId: string }) => {
    getTaskRepo().retry(args.taskId)
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'pending')
  })

  ipcMain.handle(IPC.TASK_CANCEL, (_event, args: { taskId: string }) => {
    getTaskQueueService().cancelRunningTask(args.taskId)
    getTaskRepo().updateStatus(args.taskId, 'failed', '用户取消')
    getTaskDestinationRepo().updateIncompleteStatuses(args.taskId, 'failed', '用户取消')
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'failed')
  })

  ipcMain.handle(IPC.TASK_RETRY, (_event, args: { taskId: string; provider?: CloudProvider }) => {
    getTaskRepo().retry(args.taskId, args.provider)
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'pending')
  })

  // ---- 扫描器 ----
  ipcMain.handle(IPC.SCANNER_STATUS, () => {
    return getScannerService().getStatus()
  })

  ipcMain.handle(IPC.SCANNER_TRIGGER, () => {
    getScannerService().triggerScan()
  })

  ipcMain.handle(IPC.SCANNER_START, () => {
    getScannerService().start()
  })

  ipcMain.handle(IPC.SCANNER_STOP, () => {
    getScannerService().stop()
  })

  // ---- 日期目录汇总 ----
  ipcMain.handle(IPC.DAY_FOLDER_LIST, (_event, query?: DayFolderListQuery) => {
    return getDayFolderRepo().list(query)
  })

  ipcMain.handle(IPC.DAY_FOLDER_DELETE, (_event, args: { id: string }) => {
    getDayFolderRepo().deleteCompleted(args.id)
  })

  // ---- 设置 ----
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    return getSettingsRepo().getAll()
  })

  ipcMain.handle(IPC.SETTINGS_SAVE, (_event, data: Partial<AppSettings>) => {
    getSettingsRepo().saveAll(data)
    if (data.cleanup !== undefined) {
      getCleanupService().scheduleCleanup()
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.SETTINGS_TEST_OSS, async (_event, config: AppSettings['oss']) => {
    return getOSSUploadService().testConnection(config)
  })

  ipcMain.handle(
    IPC.SETTINGS_TEST_TENCENT_S3,
    async (_event, config: AppSettings['tencentS3']) => {
      return getTencentS3UploadService().testConnection(config)
    }
  )

  // ---- SSH 机器 CRUD ----
  ipcMain.handle(IPC.SSH_LIST_MACHINES, () => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM ssh_machines ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map(rowToSSHMachine)
  })

  ipcMain.handle(IPC.SSH_ADD_MACHINE, (_event, input: SSHMachineInput) => {
    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO ssh_machines (id, name, host, port, username, auth_type, private_key_path, encrypted_password, remote_dir, local_dir, bw_limit, cpu_nice, transfer_mode, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.host, input.port, input.username, input.authType, input.privateKeyPath || null, input.password || null, input.remoteDir, input.localDir, input.bwLimit, input.cpuNice, input.transferMode || 'rsync', input.enabled ? 1 : 0, now)
    const row = db.prepare('SELECT * FROM ssh_machines WHERE id = ?').get(id) as Record<string, unknown>
    return rowToSSHMachine(row)
  })

  ipcMain.handle(IPC.SSH_UPDATE_MACHINE, (_event, machine: SSHMachine) => {
    const db = getDb()
    db.prepare(
      `UPDATE ssh_machines SET name=?, host=?, port=?, username=?, auth_type=?, private_key_path=?, remote_dir=?, local_dir=?, bw_limit=?, cpu_nice=?, enabled=? WHERE id=?`
    ).run(machine.name, machine.host, machine.port, machine.username, machine.authType, machine.privateKeyPath, machine.remoteDir, machine.localDir, machine.bwLimit, machine.cpuNice, machine.enabled ? 1 : 0, machine.id)
  })

  ipcMain.handle(IPC.SSH_DELETE_MACHINE, (_event, args: { id: string }) => {
    const db = getDb()
    db.prepare('DELETE FROM ssh_machines WHERE id = ?').run(args.id)
  })

  ipcMain.handle(IPC.SSH_TEST_CONNECTION, async (_event, args: { id: string }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM ssh_machines WHERE id = ?').get(args.id) as Record<string, unknown> | undefined
    if (!row) return { ok: false, error: '机器不存在' }
    const machine = rowToSSHMachine(row)
    const password = (row.encrypted_password as string) || undefined
    return getSSHRsyncService().testConnection(machine, password)
  })

  ipcMain.handle(IPC.RSYNC_START, async (_event, args: { machineId: string }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM ssh_machines WHERE id = ?').get(args.machineId) as Record<string, unknown> | undefined
    if (!row) throw new Error('机器不存在')
    const machine = rowToSSHMachine(row)
    const password = (row.encrypted_password as string) || undefined

    try {
      await getSSHRsyncService().startRsync(machine, password, (progress: RsyncProgress) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.RSYNC_PROGRESS, progress)
        }
      })
      // 更新最后同步时间
      db.prepare('UPDATE ssh_machines SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), args.machineId)

      // rsync 完成后自动注册本地目录为上传任务
      const taskRepo = getTaskRepo()
      const settingsRepo = getSettingsRepo()
      const snapshot = getUploadTargetSnapshot(settingsRepo.getAll())
      const localDir = normalize(machine.localDir).replace(/[\\/]+$/, '')
      const uploadRelativePath = resolveDirectoryUploadRelativePath(
        machine.remoteDir,
        localDir
      )
      const existing = taskRepo.getByFolderPath(localDir)
      if (!existing || existing.status === 'completed' || existing.status === 'failed') {
        taskRepo.create({
          folderPath: localDir,
          folderName: basename(localDir),
          ossPrefix: snapshot.prefixes.aliyun,
          uploadTargetMode: snapshot.mode,
          destinationPrefixes: snapshot.prefixes,
          uploadRelativePath,
          sourceType: 'rsync',
          sourceMachineId: machine.id
        })
        log.info('rsync 完成, 自动创建上传任务:', localDir)
      } else if (existing.uploadRelativePath !== uploadRelativePath) {
        taskRepo.updateUploadRelativePath(existing.id, uploadRelativePath)
      }

      // 写入标记文件，防止 scanner 重复做稳定性检查
      writeTmpUpload(localDir, {
        version: 2,
        createdAt: new Date().toISOString(),
        folderPath: localDir,
        metadata: {
          source: 'rsync',
          machineId: machine.id,
          uploadRelativePath,
          uploadTargetMode: snapshot.mode,
          destinationPrefixes: snapshot.prefixes
        }
      })
    } catch (err) {
      log.error('rsync 失败:', err)
      throw err
    }
  })

  ipcMain.handle(IPC.RSYNC_STOP, (_event, args: { machineId: string }) => {
    getSSHRsyncService().stopRsync(args.machineId)
  })

  // ---- 历史 ----
  ipcMain.handle(IPC.HISTORY_LIST, (_event, query: HistoryQuery) => {
    return getHistoryRepo().list(query)
  })

  ipcMain.handle(IPC.HISTORY_CLEAR, (_event, args?: { before?: string }) => {
    getHistoryRepo().clear(args?.before)
    getDayFolderRepo().clearCompleted(args?.before)
  })

  ipcMain.handle(IPC.HISTORY_DELETE, (_event, args: { id: string }) => {
    getHistoryRepo().deleteById(args.id)
  })

  // ---- 对话框 ----
  ipcMain.handle(IPC.DIALOG_SELECT_FOLDER, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ---- SFTP 直传 OSS ----
  ipcMain.handle(IPC.SFTP_START, async (_event, args: { machineId: string }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM ssh_machines WHERE id = ?').get(args.machineId) as Record<string, unknown> | undefined
    if (!row) throw new Error('机器不存在')
    const machine = rowToSSHMachine(row)
    const password = (row.encrypted_password as string) || undefined
    const settings = getSettingsRepo().getAll()

    try {
      const result = await getSSHRsyncService().sftpStreamToCloud(
        machine,
        password,
        settings,
        (progress) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.SFTP_PROGRESS, progress)
          }
        }
      )
      db.prepare('UPDATE ssh_machines SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), args.machineId)
      return result
    } catch (err) {
      log.error('SFTP 直传失败:', err)
      throw err
    }
  })

  ipcMain.handle(IPC.SFTP_STOP, (_event, args: { machineId: string }) => {
    getSSHRsyncService().stopRsync(args.machineId)
  })

  // ---- 数采模式 ----
  ipcMain.handle(IPC.DATA_COLLECT_LIST, () => {
    return getDataCollectService().getAll()
  })

  ipcMain.handle(IPC.DATA_COLLECT_RUN, (_event, args: { folderPath: string }) => {
    const result = getDataCollectService().collectDataInfo(args.folderPath)
    if (result) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.DATA_COLLECT_RESULT, result)
      }
    }
    return result
  })

  // ---- 磁盘用量 ----
  ipcMain.handle(IPC.DISK_USAGE, async () => {
    const settingsRepo = getSettingsRepo()
    const scanConfig = settingsRepo.get<ScanConfig>('scan')
    const db = getDb()

    // 收集所有需要检查的路径
    const paths = new Set<string>()
    if (scanConfig?.directories) {
      for (const d of scanConfig.directories) paths.add(normalize(d).replace(/[\\/]+$/, ''))
    }
    const sshRows = db.prepare('SELECT local_dir FROM ssh_machines WHERE enabled = 1').all() as Array<{ local_dir: string }>
    for (const r of sshRows) {
      paths.add(normalize(r.local_dir).replace(/[\\/]+$/, ''))
    }

    const results: DiskUsageInfo[] = []
    for (const p of paths) {
      try {
        if (!existsSync(p)) continue
        const stats = await statfs(p)
        const totalBytes = stats.bsize * stats.blocks
        const freeBytes = stats.bsize * stats.bavail
        const usedBytes = totalBytes - freeBytes
        const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
        results.push({ path: p, totalBytes, freeBytes, usedBytes, usagePercent })
      } catch (err) {
        log.warn('获取磁盘用量失败:', p, err)
      }
    }
    return results
  })

  // ---- 标注 ----
  ipcMain.handle(IPC.ANNOTATION_OPEN_WINDOW, () => {
    createAnnotationWindow()
  })

  ipcMain.handle(IPC.ANNOTATION_SELECT_IMAGE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.ANNOTATION_READ_IMAGE, (_event, args: { filePath: string }) => {
    const { filePath } = args
    const ext = extname(filePath).toLowerCase().replace('.', '')
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff'
    }
    const mime = mimeMap[ext] || 'image/png'
    const buf = readFileSync(filePath)
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    const img = nativeImage.createFromPath(filePath)
    const size = img.getSize()
    return { dataUrl, width: size.width, height: size.height }
  })

  ipcMain.handle(IPC.ANNOTATION_SAVE_EXPORT, async (event, args: { dataUrl: string; jsonString: string; defaultBaseName: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${args.defaultBaseName}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return null

    // Write PNG
    const base64Data = args.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const pngPath = result.filePath
    writeFileSync(pngPath, Buffer.from(base64Data, 'base64'))

    // Write JSON alongside PNG (same directory, same base name)
    const parsed = pathParse(pngPath)
    const jsonPath = pathFormat({ dir: parsed.dir, name: parsed.name, ext: '.json' })
    writeFileSync(jsonPath, args.jsonString, 'utf-8')

    log.info('[Annotation] Exported PNG:', pngPath)
    log.info('[Annotation] Exported JSON:', jsonPath)

    return { pngPath, jsonPath }
  })

  ipcMain.handle(IPC.ANNOTATION_UPLOAD_OSS, async (_event, args: { imagePath: string; pngPath: string; jsonPath: string }) => {
    const taskRepo = getTaskRepo()
    const settings = getSettingsRepo().getAll()
    const task = taskRepo.findTaskContainingFile(args.imagePath)
    const pngBuffer = readFileSync(args.pngPath)
    const jsonBuffer = readFileSync(args.jsonPath)
    const results = []

    for (const provider of providersForMode(settings.cloud.targetMode)) {
      const validationError = getCloudUploadService().validateProvider(provider, settings)
      if (validationError) {
        results.push({ provider, ok: false, error: validationError })
        continue
      }

      const taskDestination = task?.destinations.find(
        (destination) => destination.provider === provider
      )
      const configPrefix =
        provider === 'aliyun' ? settings.oss.prefix : settings.tencentS3.prefix
      const prefix = taskDestination?.prefix || configPrefix || ''
      let basePath: string

      if (task) {
        const relPath = relative(task.folderPath, args.imagePath).replace(/\\/g, '/')
        const relParsed = pathParse(relPath)
        const relBase = pathFormat({
          dir: relParsed.dir,
          name: relParsed.name,
          ext: ''
        })
        basePath = [
          prefix,
          task.uploadRelativePath || task.folderName,
          relBase
        ].filter(Boolean).join('/').replace(/\/+/g, '/')
      } else {
        const image = pathParse(args.imagePath)
        basePath = [prefix, image.name]
          .filter(Boolean)
          .join('/')
          .replace(/\/+/g, '/')
      }

      const pngKey = `${basePath}_annotation.png`
      const jsonKey = `${basePath}_annotation.json`
      let uploader: Awaited<ReturnType<ReturnType<typeof getCloudUploadService>['createTaskUploader']>> | null = null
      try {
        uploader = await getCloudUploadService().createTaskUploader(
          provider,
          settings,
          settings.upload.multipartThreshold
        )
        await Promise.all([
          uploader.uploadBuffer(pngBuffer, pngKey),
          uploader.uploadBuffer(jsonBuffer, jsonKey)
        ])
        results.push({ provider, ok: true, keys: [pngKey, jsonKey] })
      } catch (err) {
        log.error(`[Annotation] ${provider} upload failed:`, err)
        results.push({
          provider,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        uploader?.dispose()
      }
    }

    return {
      ok: results.every((result) => result.ok),
      results
    }
  })
}

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { getTaskRepo } from '../db/task.repo'
import { getSettingsRepo } from '../db/settings.repo'
import { getHistoryRepo } from '../db/history.repo'
import { getScannerService } from '../services/scanner.service'
import { getTaskQueueService } from '../services/task-queue.service'
import { getSSHRsyncService } from '../services/ssh-rsync.service'
import { getOSSUploadService } from '../services/oss-upload.service'
import { getTencentS3UploadService } from '../services/tencent-s3-upload.service'
import { getCleanupService } from '../services/cleanup.service'
import { getDayFolderRepo } from '../db/day-folder.repo'
import { getDayFolderService } from '../services/day-folder.service'
import { getMainWindow } from '../index'
import { getDb } from '../db/database'
import { getDataCollectService } from '../services/data-collect.service'
import { getTaskDestinationRepo } from '../db/task-destination.repo'
import { v4 as uuid } from 'uuid'
import type { AppSettings, CloudProvider, HistoryQuery, TaskStatus, SSHMachine, SSHMachineInput, RsyncProgress, TransferMode, DiskUsageInfo, DayFolderListQuery } from '@shared/types'
import { getUploadTargetSnapshot } from '@shared/cloud-upload'
import { resolveDirectoryUploadRelativePath } from '@shared/day-folder'
import { basename, normalize, join } from 'path'
import { existsSync } from 'fs'
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

  ipcMain.handle(IPC.TASK_DETAIL, (_event, args: { taskId: string }) => {
    const task = getTaskRepo().getById(args.taskId)
    if (!task) throw new Error('任务不存在')
    return {
      task,
      files: getTaskRepo().listFileDetails(args.taskId)
    }
  })

  ipcMain.handle(IPC.TASK_ADD_FOLDER, (_event, args: { folderPath: string }) => {
    const taskRepo = getTaskRepo()
    const settingsRepo = getSettingsRepo()
    const snapshot = getUploadTargetSnapshot(settingsRepo.getAll())
    const folderName = basename(args.folderPath)
    const uploadRelativePath = resolveDirectoryUploadRelativePath(args.folderPath)
    const task = taskRepo.create({
      folderPath: args.folderPath,
      folderName,
      ossPrefix: snapshot.prefixes.aliyun,
      uploadTargetMode: snapshot.mode,
      destinationPrefixes: snapshot.prefixes,
      uploadRelativePath,
      sourceType: 'manual'
    })
    getScannerService().queueReconcileTask(task)
    return getTaskRepo().getById(task.id)
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
    getTaskRepo().skip(args.taskId, '用户跳过')
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'skipped')
  })

  ipcMain.handle(IPC.TASK_SKIP, (_event, args: { taskId: string }) => {
    getTaskQueueService().cancelRunningTask(args.taskId)
    getTaskRepo().skip(args.taskId, '用户跳过')
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'skipped')
  })

  ipcMain.handle(IPC.TASK_RESTORE, (_event, args: { taskId: string }) => {
    const task = getTaskRepo().getById(args.taskId)
    if (!task) throw new Error('任务不存在')
    if (!existsSync(task.folderPath)) throw new Error('源目录不存在，无法恢复')
    getTaskRepo().restore(args.taskId)
    const restored = getTaskRepo().getById(args.taskId)
    if (restored) getScannerService().queueReconcileTask(restored)
    getDayFolderService().refreshForTask(args.taskId)
    broadcastStatusChange(args.taskId, 'scanning')
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

  ipcMain.handle(IPC.DAY_FOLDER_DELETE, (_event, args: { id: string; provider?: CloudProvider }) => {
    getDayFolderRepo().deleteCompleted(args.id, args.provider)
  })

  ipcMain.handle(IPC.DAY_FOLDER_IGNORE, (_event, args: { id: string }) => {
    const repo = getDayFolderRepo()
    repo.setIgnored(args.id, true)
    for (const task of repo.getChildTasks(args.id)) {
      if (task.status === 'completed' || task.status === 'synced') continue
      getTaskQueueService().cancelRunningTask(task.id)
      getTaskRepo().skip(task.id, '用户忽略整个日期')
      broadcastStatusChange(task.id, 'skipped')
    }
    return getDayFolderService().refresh(args.id)
  })

  ipcMain.handle(IPC.DAY_FOLDER_RESTORE, (_event, args: { id: string }) => {
    const repo = getDayFolderRepo()
    repo.setIgnored(args.id, false)
    for (const task of repo.getChildTasks(args.id)) {
      if (task.status !== 'skipped' || !existsSync(task.folderPath)) continue
      getTaskRepo().restore(task.id)
      const restored = getTaskRepo().getById(task.id)
      if (restored) getScannerService().queueReconcileTask(restored)
      broadcastStatusChange(task.id, 'scanning')
    }
    return getDayFolderService().refresh(args.id)
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
    if (data.scan !== undefined || data.stability !== undefined) {
      getScannerService().stop()
      getScannerService().start()
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
        const task = taskRepo.create({
          folderPath: localDir,
          folderName: basename(localDir),
          ossPrefix: snapshot.prefixes.aliyun,
          uploadTargetMode: snapshot.mode,
          destinationPrefixes: snapshot.prefixes,
          uploadRelativePath,
          sourceType: 'rsync',
          sourceMachineId: machine.id
        })
        getScannerService().queueReconcileTask(task)
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

  ipcMain.handle(IPC.HISTORY_CLEAR, (_event, args?: { before?: string; provider?: CloudProvider }) => {
    getHistoryRepo().clear(args?.before, args?.provider)
    getDayFolderRepo().clearCompleted(args?.before, args?.provider)
  })

  ipcMain.handle(IPC.HISTORY_DELETE, (_event, args: { id: string; provider?: CloudProvider }) => {
    getHistoryRepo().deleteById(args.id, args.provider)
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
    const scanConfig = settingsRepo.getAll().scan
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

}

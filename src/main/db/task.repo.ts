import { getDb } from './database'
import { v4 as uuid } from 'uuid'
import { normalize } from 'path'
import type {
  CloudProvider,
  Task,
  TaskFile,
  TaskFileDetail,
  TaskStatus,
  SourceType,
  UploadPathMode,
  UploadProfile,
  UploadTargetMode
} from '@shared/types'
import { getTaskDestinationRepo } from './task-destination.repo'
import { providersForMode } from '@shared/cloud-upload'

function normalizeFolderPath(p: string): string {
  return normalize(p).replace(/[\\/]+$/, '')
}

function rowToTask(row: Record<string, unknown>): Task {
  const profileSnapshot =
    typeof row.profile_snapshot_json === 'string' && row.profile_snapshot_json
      ? safeParseProfile(row.profile_snapshot_json)
      : null
  return {
    id: row.id as string,
    folderPath: row.folder_path as string,
    folderName: row.folder_name as string,
    status: row.status as TaskStatus,
    totalFiles: row.total_files as number,
    uploadedFiles: row.uploaded_files as number,
    totalBytes: row.total_bytes as number,
    uploadedBytes: row.uploaded_bytes as number,
    ossPrefix: (row.oss_prefix as string) || '',
    uploadTargetMode: (row.upload_target_mode as UploadTargetMode) || 'aliyun',
    destinations: getTaskDestinationRepo().listByTask(row.id as string),
    dayFolderId: (row.day_folder_id as string) || null,
    uploadRelativePath: (row.upload_relative_path as string | null | undefined) ?? (row.folder_name as string),
    errorMessage: (row.error_message as string) || null,
    sourceType: row.source_type as SourceType,
    sourceMachineId: (row.source_machine_id as string) || null,
    profileId: (row.profile_id as string) || null,
    profileName: (row.profile_name as string) || null,
    profileSnapshot,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) || null
  }
}

function safeParseProfile(value: string): UploadProfile | null {
  try {
    return JSON.parse(value) as UploadProfile
  } catch {
    return null
  }
}

function rowToTaskFile(row: Record<string, unknown>): TaskFile {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    relativePath: row.relative_path as string,
    fileSize: row.file_size as number,
    status: row.status as TaskFile['status'],
    ossKey: (row.oss_key as string) || null,
    uploadId: (row.upload_id as string) || null,
    errorMessage: (row.error_message as string) || null,
    mtimeMs: Number(row.mtime_ms || 0),
    lastSeenAt: (row.last_seen_at as string) || null,
    sourceStatus: (row.source_status as TaskFile['sourceStatus']) || 'present',
    stableCount: Number(row.stable_count || 0),
    retryCount: Number(row.retry_count || 0),
    nextRetryAt: (row.next_retry_at as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export class TaskRepo {
  listByStatus(status?: TaskStatus): Task[] {
    const db = getDb()
    if (status) {
      return (db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[]).map(rowToTask)
    }
    return (db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(rowToTask)
  }

  listContinuouslyMonitored(dateName: string): Task[] {
    const rows = getDb().prepare(
      `SELECT t.*
       FROM tasks t
       INNER JOIN day_folders df ON df.id = t.day_folder_id
       WHERE t.source_type = 'local'
         AND t.day_folder_id IS NOT NULL
         AND df.date_value = ?
         AND t.status NOT IN ('skipped', 'paused', 'completed')
       ORDER BY t.created_at ASC`
    ).all(dateName) as Record<string, unknown>[]
    return rows.map(rowToTask)
  }

  listRunnable(now = new Date().toISOString()): Task[] {
    const rows = getDb().prepare(
      `SELECT DISTINCT t.*
       FROM tasks t
       INNER JOIN task_files tf ON tf.task_id = t.id
       INNER JOIN task_file_destinations tfd ON tfd.task_file_id = tf.id
       WHERE t.status IN ('pending', 'retrying')
         AND tf.source_status = 'present'
         AND tf.stable_count >= CASE WHEN t.source_type = 'local' THEN 2 ELSE 1 END
         AND (tf.next_retry_at IS NULL OR tf.next_retry_at <= ?)
         AND tfd.status = 'pending'
       ORDER BY t.created_at ASC`
    ).all(now) as Record<string, unknown>[]
    return rows.map(rowToTask)
  }

  getById(id: string): Task | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToTask(row) : null
  }

  getByFolderPath(folderPath: string): Task | null {
    const db = getDb()
    const normalized = normalizeFolderPath(folderPath)
    const row = db.prepare('SELECT * FROM tasks WHERE folder_path = ? ORDER BY created_at DESC LIMIT 1').get(normalized) as Record<string, unknown> | undefined
    return row ? rowToTask(row) : null
  }

  /**
   * Find the task whose folderPath is a parent directory of the given file path.
   * Returns the most specific match (longest folderPath).
   */
  findTaskContainingFile(filePath: string): Task | null {
    const db = getDb()
    const normalized = normalize(filePath)
    const tasks = (db.prepare('SELECT * FROM tasks ORDER BY length(folder_path) DESC').all() as Record<string, unknown>[]).map(rowToTask)
    return tasks.find((t) => {
      const fp = t.folderPath
      return normalized.startsWith(fp + '/') || normalized.startsWith(fp + '\\')
    }) || null
  }

  create(params: {
    folderPath: string
    folderName: string
    ossPrefix?: string
    uploadTargetMode?: UploadTargetMode
    destinationPrefixes?: Partial<Record<CloudProvider, string>>
    destinationUploadRelativePaths?: Partial<Record<CloudProvider, string>>
    destinationPathModes?: Partial<Record<CloudProvider, UploadPathMode>>
    destinationObjectKeyTemplates?: Partial<Record<CloudProvider, string | null>>
    dayFolderId?: string
    uploadRelativePath?: string
    sourceType?: SourceType
    sourceMachineId?: string
    profileId?: string | null
    profileName?: string | null
    profileSnapshot?: UploadProfile | null
  }): Task {
    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()
    const normalizedPath = normalizeFolderPath(params.folderPath)
    const uploadTargetMode = params.uploadTargetMode || 'aliyun'
    const uploadRelativePath = params.uploadRelativePath ?? params.folderName
    const destinationUploadRelativePaths =
      params.destinationUploadRelativePaths ||
      Object.fromEntries(
        providersForMode(uploadTargetMode).map((provider) => [
          provider,
          uploadRelativePath
        ])
      )
    db.prepare(
      `INSERT INTO tasks (
        id, folder_path, folder_name, status, oss_prefix, upload_target_mode,
        day_folder_id, upload_relative_path, source_type, source_machine_id,
        profile_id, profile_name, profile_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      normalizedPath,
      params.folderName,
      params.ossPrefix || '',
      uploadTargetMode,
      params.dayFolderId || null,
      uploadRelativePath,
      params.sourceType || 'local',
      params.sourceMachineId || null,
      params.profileId || null,
      params.profileName || null,
      params.profileSnapshot ? JSON.stringify(params.profileSnapshot) : null,
      now,
      now
    )
    getTaskDestinationRepo().ensureForTask(
      id,
      uploadTargetMode,
      params.destinationPrefixes || { aliyun: params.ossPrefix || '' },
      'pending',
      destinationUploadRelativePaths,
      params.destinationPathModes,
      params.destinationObjectKeyTemplates
    )
    return this.getById(id)!
  }

  updateDayFolderId(id: string, dayFolderId: string): void {
    getDb().prepare(
      `UPDATE tasks
       SET day_folder_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(dayFolderId, new Date().toISOString(), id)
  }

  updateDayFolderMetadata(id: string, dayFolderId: string, uploadRelativePath: string): void {
    getDb().prepare(
      `UPDATE tasks
       SET day_folder_id = ?, upload_relative_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(dayFolderId, uploadRelativePath, new Date().toISOString(), id)
  }

  updateUploadRelativePath(id: string, uploadRelativePath: string): void {
    getDb().prepare(
      `UPDATE tasks
       SET upload_relative_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(uploadRelativePath, new Date().toISOString(), id)
  }

  listByDayFolder(dayFolderId: string): Task[] {
    const rows = getDb().prepare(
      'SELECT * FROM tasks WHERE day_folder_id = ? ORDER BY created_at DESC'
    ).all(dayFolderId) as Record<string, unknown>[]
    return rows.map(rowToTask)
  }

  updateStatus(id: string, status: TaskStatus, errorMessage?: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    const completedAt =
      status === 'completed' ||
      status === 'failed' ||
      status === 'skipped'
        ? now
        : null
    db.prepare(
      'UPDATE tasks SET status = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?'
    ).run(status, errorMessage || null, now, completedAt, id)
  }

  retry(id: string, provider?: CloudProvider): void {
    getTaskDestinationRepo().resetFailed(id, provider)
    getDb().prepare(
      `UPDATE task_files
       SET retry_count = 0, next_retry_at = NULL, error_message = NULL,
           status = CASE
             WHEN source_status = 'present' AND status != 'completed' THEN 'pending'
             ELSE status
           END,
           updated_at = ?
       WHERE task_id = ?`
    ).run(new Date().toISOString(), id)
    this.updateStatus(id, 'pending')
  }

  skip(id: string, reason = '用户跳过'): void {
    const db = getDb()
    const now = new Date().toISOString()
    const transaction = db.transaction(() => {
      db.prepare(
        `UPDATE tasks
         SET status = 'skipped', error_message = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(reason, now, now, id)
      db.prepare(
        `UPDATE task_destinations
         SET status = CASE WHEN status IN ('completed', 'synced') THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status IN ('completed', 'synced') THEN error_message ELSE ? END,
             completed_at = COALESCE(completed_at, ?), updated_at = ?
         WHERE task_id = ?`
      ).run(reason, now, now, id)
      db.prepare(
        `UPDATE task_file_destinations
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status = 'completed' THEN error_message ELSE ? END,
             updated_at = ?
         WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)`
      ).run(reason, now, id)
      db.prepare(
        `UPDATE task_files
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status = 'completed' THEN error_message ELSE ? END,
             next_retry_at = NULL, updated_at = ?
         WHERE task_id = ?`
      ).run(reason, now, id)
    })
    transaction()
  }

  restore(id: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    const transaction = db.transaction(() => {
      db.prepare(
        `UPDATE tasks
         SET status = 'scanning', error_message = NULL, completed_at = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, id)
      db.prepare(
        `UPDATE task_destinations
         SET status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END,
             error_message = NULL,
             completed_at = CASE WHEN status = 'skipped' THEN NULL ELSE completed_at END,
             updated_at = ?
         WHERE task_id = ?`
      ).run(now, id)
      db.prepare(
        `UPDATE task_file_destinations
         SET status = CASE
               WHEN status = 'skipped'
                AND task_file_id IN (
                  SELECT id FROM task_files
                  WHERE task_id = ? AND source_status = 'present'
                )
               THEN 'pending'
               ELSE status
             END,
             error_message = NULL, updated_at = ?
         WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)`
      ).run(id, now, id)
      db.prepare(
        `UPDATE task_files
         SET status = CASE
               WHEN status = 'skipped' AND source_status = 'present' THEN 'pending'
               ELSE status
             END,
             retry_count = 0, next_retry_at = NULL, error_message = NULL,
             updated_at = ?
         WHERE task_id = ?`
      ).run(now, id)
    })
    transaction()
  }

  updateProgress(id: string, uploadedFiles: number, uploadedBytes: number): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE tasks SET uploaded_files = ?, uploaded_bytes = ?, updated_at = ? WHERE id = ?'
    ).run(uploadedFiles, uploadedBytes, now, id)
  }

  setTotals(id: string, totalFiles: number, totalBytes: number): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE tasks SET total_files = ?, total_bytes = ?, updated_at = ? WHERE id = ?'
    ).run(totalFiles, totalBytes, now, id)
  }

  // ---- task_files ----
  createFile(
    taskId: string,
    relativePath: string,
    fileSize: number,
    mtimeMs = 0
  ): TaskFile {
    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    ).run(id, taskId, relativePath, fileSize, mtimeMs, now, now, now)
    return rowToTaskFile(db.prepare('SELECT * FROM task_files WHERE id = ?').get(id) as Record<string, unknown>)
  }

  bulkCreateFiles(
    taskId: string,
    files: Array<{ relativePath: string; fileSize: number; mtimeMs?: number }>
  ): void {
    const db = getDb()
    const now = new Date().toISOString()
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    )
    const transaction = db.transaction(() => {
      for (const f of files) {
        stmt.run(
          uuid(),
          taskId,
          f.relativePath,
          f.fileSize,
          f.mtimeMs || 0,
          now,
          now,
          now
        )
      }
    })
    transaction()
  }

  listFiles(taskId: string, status?: string): TaskFile[] {
    const db = getDb()
    if (status) {
      return (db.prepare('SELECT * FROM task_files WHERE task_id = ? AND status = ?').all(taskId, status) as Record<string, unknown>[]).map(rowToTaskFile)
    }
    return (db.prepare('SELECT * FROM task_files WHERE task_id = ?').all(taskId) as Record<string, unknown>[]).map(rowToTaskFile)
  }

  listFileDetails(taskId: string): TaskFileDetail[] {
    const files = this.listFiles(taskId)
    const destinations = getTaskDestinationRepo().listFileTargets(taskId)
    const destinationsByFile = new Map<string, typeof destinations>()
    for (const destination of destinations) {
      const list = destinationsByFile.get(destination.taskFileId) || []
      list.push(destination)
      destinationsByFile.set(destination.taskFileId, list)
    }
    return files.map((file) => ({
      ...file,
      destinations: (destinationsByFile.get(file.id) || [])
        .map(({ taskId: _taskId, relativePath: _path, fileSize: _size, ...destination }) => destination)
    }))
  }

  reconcileFiles(
    taskId: string,
    files: Array<{ relativePath: string; size: number; mtimeMs: number }>,
    requiredStableChecks: number
  ): {
    changed: boolean
    readyFiles: number
    unstableFiles: number
    failedFiles: number
    skippedFiles: number
  } {
    const db = getDb()
    const task = this.getById(taskId)
    if (!task || task.status === 'skipped' || task.status === 'paused') {
      return {
        changed: false,
        readyFiles: 0,
        unstableFiles: 0,
        failedFiles: 0,
        skippedFiles: 0
      }
    }

    const now = new Date().toISOString()
    const existingRows = db.prepare(
      'SELECT * FROM task_files WHERE task_id = ?'
    ).all(taskId) as Record<string, unknown>[]
    const existing = new Map(
      existingRows.map((row) => [row.relative_path as string, rowToTaskFile(row)])
    )
    const seen = new Set<string>()
    let changed = false

    const insert = db.prepare(
      `INSERT INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    )
    const updateChanged = db.prepare(
      `UPDATE task_files
       SET file_size = ?, mtime_ms = ?, last_seen_at = ?, source_status = 'present',
           stable_count = 1, status = 'pending', error_message = NULL,
           retry_count = 0, next_retry_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    const updateStable = db.prepare(
      `UPDATE task_files
       SET last_seen_at = ?, source_status = 'present',
           stable_count = MIN(stable_count + 1, ?), updated_at = ?
       WHERE id = ?`
    )
    const resetTargets = db.prepare(
      `UPDATE task_file_destinations
       SET status = 'pending', object_key = NULL, upload_id = NULL,
           error_message = NULL, updated_at = ?
       WHERE task_file_id = ? AND status != 'uploading'`
    )
    const markFileMissing = db.prepare(
      `UPDATE task_files
       SET source_status = 'missing',
           status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
           error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源文件已删除' END,
           next_retry_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    const markTargetsMissing = db.prepare(
      `UPDATE task_file_destinations
       SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
           error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源文件已删除' END,
           updated_at = ?
       WHERE task_file_id = ? AND status != 'uploading'`
    )

    const transaction = db.transaction(() => {
      for (const file of files) {
        seen.add(file.relativePath)
        const current = existing.get(file.relativePath)
        if (!current) {
          insert.run(
            uuid(),
            taskId,
            file.relativePath,
            file.size,
            file.mtimeMs,
            now,
            now,
            now
          )
          changed = true
          continue
        }

        const fileChanged =
          current.fileSize !== file.size ||
          current.mtimeMs !== file.mtimeMs ||
          current.sourceStatus === 'missing'
        if (fileChanged) {
          updateChanged.run(file.size, file.mtimeMs, now, now, current.id)
          resetTargets.run(now, current.id)
          changed = true
        } else if (current.stableCount < Math.max(1, requiredStableChecks)) {
          updateStable.run(
            now,
            Math.max(1, requiredStableChecks),
            now,
            current.id
          )
        }
      }

      for (const current of existing.values()) {
        if (seen.has(current.relativePath) || current.sourceStatus === 'missing') continue
        markFileMissing.run(now, current.id)
        markTargetsMissing.run(now, current.id)
        changed = true
      }
    })
    transaction()
    getTaskDestinationRepo().ensureForTaskFiles(taskId)

    const counts = db.prepare(
      `SELECT
         COUNT(*) AS total_files,
         COALESCE(SUM(file_size), 0) AS total_bytes,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS uploaded_files,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END), 0) AS uploaded_bytes,
         SUM(CASE
           WHEN source_status = 'present'
            AND stable_count >= ?
            AND status IN ('pending', 'failed')
            AND (next_retry_at IS NULL OR next_retry_at <= ?)
           THEN 1 ELSE 0 END) AS ready_files,
         SUM(CASE
           WHEN source_status = 'present' AND stable_count < ?
           THEN 1 ELSE 0 END) AS unstable_files,
         SUM(CASE
           WHEN source_status = 'present'
            AND status = 'pending'
            AND next_retry_at IS NOT NULL
            AND next_retry_at > ?
           THEN 1 ELSE 0 END) AS retry_waiting_files,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_files,
         SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_files
       FROM task_files
       WHERE task_id = ?`
    ).get(
      requiredStableChecks,
      now,
      requiredStableChecks,
      now,
      taskId
    ) as Record<string, number>

    db.prepare(
      `UPDATE tasks
       SET total_files = ?, total_bytes = ?, uploaded_files = ?, uploaded_bytes = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      counts.total_files || 0,
      counts.total_bytes || 0,
      counts.uploaded_files || 0,
      counts.uploaded_bytes || 0,
      now,
      taskId
    )
    for (const destination of getTaskDestinationRepo().listByTask(taskId)) {
      const destinationRepo = getTaskDestinationRepo()
      destinationRepo.recalculateProgress(taskId, destination.provider)
      const summary = destinationRepo.summarizeFileTargets(
        taskId,
        destination.provider,
        now
      )
      if (summary.failed > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          'failed',
          '存在需要处理的上传失败文件'
        )
      } else if (summary.pending > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          summary.retryWaiting > 0 ? 'retrying' : 'pending'
        )
      } else if (summary.total > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          task.sourceType === 'local' && task.dayFolderId
            ? 'synced'
            : 'completed'
        )
      }
    }

    const latest = this.getById(taskId)
    if (latest && latest.status !== 'uploading') {
      if ((counts.failed_files || 0) > 0) {
        this.updateStatus(taskId, 'failed', '存在需要处理的上传失败文件')
      } else if ((counts.ready_files || 0) > 0) {
        this.updateStatus(taskId, 'pending')
      } else if ((counts.retry_waiting_files || 0) > 0) {
        this.updateStatus(taskId, 'retrying')
      } else if ((counts.unstable_files || 0) > 0) {
        this.updateStatus(taskId, 'scanning')
      } else {
        this.updateStatus(
          taskId,
          task.sourceType === 'local' && task.dayFolderId ? 'synced' : 'completed'
        )
      }
    }

    return {
      changed,
      readyFiles: counts.ready_files || 0,
      unstableFiles: counts.unstable_files || 0,
      failedFiles: counts.failed_files || 0,
      skippedFiles: counts.skipped_files || 0
    }
  }

  markFileChanged(
    fileId: string,
    fileSize: number,
    mtimeMs: number
  ): void {
    const db = getDb()
    const now = new Date().toISOString()
    const transaction = db.transaction(() => {
      db.prepare(
        `UPDATE task_files
         SET file_size = ?, mtime_ms = ?, stable_count = 1,
             status = 'pending', source_status = 'present',
             error_message = NULL, retry_count = 0, next_retry_at = NULL,
             last_seen_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(fileSize, mtimeMs, now, now, fileId)
      db.prepare(
        `UPDATE task_file_destinations
         SET status = 'pending', object_key = NULL, upload_id = NULL,
             error_message = NULL, updated_at = ?
         WHERE task_file_id = ?`
      ).run(now, fileId)
    })
    transaction()
  }

  scheduleRetry(fileId: string, errorMessage: string, nextRetryAt: string): number {
    const now = new Date().toISOString()
    getDb().prepare(
      `UPDATE task_files
       SET status = 'pending', retry_count = retry_count + 1,
           next_retry_at = ?, error_message = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextRetryAt, errorMessage, now, fileId)
    const row = getDb().prepare(
      'SELECT retry_count FROM task_files WHERE id = ?'
    ).get(fileId) as { retry_count: number }
    return row.retry_count
  }

  clearRetry(fileId: string): void {
    getDb().prepare(
      `UPDATE task_files
       SET retry_count = 0, next_retry_at = NULL, error_message = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(new Date().toISOString(), fileId)
  }

  recalculateProgress(taskId: string): void {
    const row = getDb().prepare(
      `SELECT
         COUNT(*) AS total_files,
         COALESCE(SUM(file_size), 0) AS total_bytes,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS uploaded_files,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END), 0) AS uploaded_bytes
       FROM task_files
       WHERE task_id = ?`
    ).get(taskId) as Record<string, number>
    getDb().prepare(
      `UPDATE tasks
       SET total_files = ?, total_bytes = ?, uploaded_files = ?,
           uploaded_bytes = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      row.total_files || 0,
      row.total_bytes || 0,
      row.uploaded_files || 0,
      row.uploaded_bytes || 0,
      new Date().toISOString(),
      taskId
    )
  }

  updateFileStatus(fileId: string, status: string, ossKey?: string, uploadId?: string, errorMessage?: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE task_files SET status = ?, oss_key = COALESCE(?, oss_key), upload_id = COALESCE(?, upload_id), error_message = ?, updated_at = ? WHERE id = ?'
    ).run(status, ossKey || null, uploadId || null, errorMessage || null, now, fileId)
  }

  getUnfinishedTasks(): Task[] {
    const db = getDb()
    return (db.prepare(
      `SELECT * FROM tasks
       WHERE status IN ('pending', 'uploading', 'scanning', 'retrying', 'failed', 'paused')
       ORDER BY created_at ASC`
    ).all() as Record<string, unknown>[]).map(rowToTask)
  }

  getCompletedForCleanup(retentionDays: number): Task[] {
    const db = getDb()
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
    return (db.prepare(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND (source_type = 'rsync' OR (source_type = 'local' AND day_folder_id IS NULL))
         AND completed_at IS NOT NULL AND completed_at < ?
       ORDER BY completed_at ASC`
    ).all(cutoff) as Record<string, unknown>[]).map(rowToTask)
  }
}

let instance: TaskRepo | null = null
export function getTaskRepo(): TaskRepo {
  if (!instance) instance = new TaskRepo()
  return instance
}

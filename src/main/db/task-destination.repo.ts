import { v4 as uuid } from 'uuid'
import type {
  CloudProvider,
  FileStatus,
  TaskDestination,
  TaskFileDestination,
  TaskStatus,
  UploadTargetMode
} from '@shared/types'
import { providersForMode } from '@shared/cloud-upload'
import { deriveLogicalFileStatus } from '@shared/cloud-upload'
import { getDb } from './database'

export interface FileDestinationUploadTarget extends TaskFileDestination {
  taskId: string
  relativePath: string
  fileSize: number
}

function rowToDestination(row: Record<string, unknown>): TaskDestination {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    provider: row.provider as CloudProvider,
    status: row.status as TaskStatus,
    prefix: (row.prefix as string) || '',
    totalFiles: row.total_files as number,
    uploadedFiles: row.uploaded_files as number,
    totalBytes: row.total_bytes as number,
    uploadedBytes: row.uploaded_bytes as number,
    errorMessage: (row.error_message as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) || null
  }
}

function rowToFileDestination(row: Record<string, unknown>): TaskFileDestination {
  return {
    id: row.id as string,
    taskFileId: row.task_file_id as string,
    taskDestinationId: row.task_destination_id as string,
    provider: row.provider as CloudProvider,
    status: row.status as FileStatus,
    objectKey: (row.object_key as string) || null,
    uploadId: (row.upload_id as string) || null,
    errorMessage: (row.error_message as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export class TaskDestinationRepo {
  ensureForTask(
    taskId: string,
    mode: UploadTargetMode,
    prefixes: Partial<Record<CloudProvider, string>>,
    initialStatus: TaskStatus = 'pending'
  ): TaskDestination[] {
    const db = getDb()
    const now = new Date().toISOString()
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO task_destinations (
        id, task_id, provider, status, prefix, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const completedAt =
      initialStatus === 'completed' || initialStatus === 'failed' ? now : null
    const transaction = db.transaction(() => {
      for (const provider of providersForMode(mode)) {
        stmt.run(
          uuid(),
          taskId,
          provider,
          initialStatus,
          prefixes[provider] || '',
          now,
          now,
          completedAt
        )
      }
    })
    transaction()
    return this.listByTask(taskId)
  }

  listByTask(taskId: string): TaskDestination[] {
    return (
      getDb()
        .prepare('SELECT * FROM task_destinations WHERE task_id = ? ORDER BY provider')
        .all(taskId) as Record<string, unknown>[]
    ).map(rowToDestination)
  }

  get(taskId: string, provider: CloudProvider): TaskDestination | null {
    const row = getDb()
      .prepare('SELECT * FROM task_destinations WHERE task_id = ? AND provider = ?')
      .get(taskId, provider) as Record<string, unknown> | undefined
    return row ? rowToDestination(row) : null
  }

  updateStatus(
    taskId: string,
    provider: CloudProvider,
    status: TaskStatus,
    errorMessage?: string
  ): void {
    const now = new Date().toISOString()
    const completedAt =
      status === 'completed' || status === 'failed' ? now : null
    getDb()
      .prepare(
        `UPDATE task_destinations
         SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
         WHERE task_id = ? AND provider = ?`
      )
      .run(status, errorMessage || null, now, completedAt, taskId, provider)
  }

  updateIncompleteStatuses(
    taskId: string,
    status: TaskStatus,
    errorMessage?: string
  ): void {
    const now = new Date().toISOString()
    const completedAt =
      status === 'completed' || status === 'failed' ? now : null
    getDb()
      .prepare(
        `UPDATE task_destinations
         SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
         WHERE task_id = ? AND status != 'completed'`
      )
      .run(status, errorMessage || null, now, completedAt, taskId)
  }

  setTotals(taskId: string, provider: CloudProvider, totalFiles: number, totalBytes: number): void {
    getDb()
      .prepare(
        `UPDATE task_destinations
         SET total_files = ?, total_bytes = ?, updated_at = ?
         WHERE task_id = ? AND provider = ?`
      )
      .run(totalFiles, totalBytes, new Date().toISOString(), taskId, provider)
  }

  updateProgress(
    taskId: string,
    provider: CloudProvider,
    uploadedFiles: number,
    uploadedBytes: number
  ): void {
    getDb()
      .prepare(
        `UPDATE task_destinations
         SET uploaded_files = ?, uploaded_bytes = ?, updated_at = ?
         WHERE task_id = ? AND provider = ?`
      )
      .run(uploadedFiles, uploadedBytes, new Date().toISOString(), taskId, provider)
  }

  ensureForTaskFiles(taskId: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT OR IGNORE INTO task_file_destinations (
        id, task_file_id, task_destination_id, provider, status, created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))), tf.id, td.id, td.provider, 'pending', ?, ?
      FROM task_files tf
      INNER JOIN task_destinations td ON td.task_id = tf.task_id
      WHERE tf.task_id = ?`
    ).run(now, now, taskId)
  }

  listFileTargets(taskId: string, provider?: CloudProvider): FileDestinationUploadTarget[] {
    const providerCondition = provider ? 'AND tfd.provider = ?' : ''
    const params: unknown[] = [taskId]
    if (provider) params.push(provider)
    const rows = getDb()
      .prepare(
        `SELECT tfd.*, tf.task_id, tf.relative_path, tf.file_size
         FROM task_file_destinations tfd
         INNER JOIN task_files tf ON tf.id = tfd.task_file_id
         WHERE tf.task_id = ? ${providerCondition}
         ORDER BY tf.created_at, tfd.provider`
      )
      .all(...params) as Record<string, unknown>[]
    return rows.map((row) => ({
      ...rowToFileDestination(row),
      taskId: row.task_id as string,
      relativePath: row.relative_path as string,
      fileSize: row.file_size as number
    }))
  }

  updateFileStatus(
    id: string,
    status: FileStatus,
    objectKey?: string,
    uploadId?: string,
    errorMessage?: string
  ): void {
    const now = new Date().toISOString()
    getDb()
      .prepare(
        `UPDATE task_file_destinations
         SET status = ?, object_key = COALESCE(?, object_key),
           upload_id = COALESCE(?, upload_id), error_message = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, objectKey || null, uploadId || null, errorMessage || null, now, id)
  }

  recalculateLogicalFile(taskFileId: string): FileStatus {
    const rows = getDb()
      .prepare('SELECT status FROM task_file_destinations WHERE task_file_id = ?')
      .all(taskFileId) as Array<{ status: FileStatus }>
    const statuses = rows.map((row) => row.status)
    const status = deriveLogicalFileStatus(statuses)
    getDb()
      .prepare('UPDATE task_files SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), taskFileId)
    return status
  }

  resetFailed(taskId: string, provider?: CloudProvider): void {
    const db = getDb()
    const now = new Date().toISOString()
    const providerCondition = provider ? 'AND provider = ?' : ''
    const destinationParams: unknown[] = [now, taskId]
    const fileParams: unknown[] = [now, taskId]
    if (provider) {
      destinationParams.push(provider)
      fileParams.push(provider)
    }

    db.prepare(
      `UPDATE task_destinations
       SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
         error_message = NULL, completed_at = CASE WHEN status = 'completed' THEN completed_at ELSE NULL END,
         updated_at = ?
       WHERE task_id = ? ${providerCondition}`
    ).run(...destinationParams)

    db.prepare(
      `UPDATE task_file_destinations
       SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
         error_message = NULL, updated_at = ?
       WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)
       ${providerCondition}`
    ).run(...fileParams)

    const fileRows = db
      .prepare('SELECT id FROM task_files WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>
    for (const row of fileRows) this.recalculateLogicalFile(row.id)
  }
}

let instance: TaskDestinationRepo | null = null
export function getTaskDestinationRepo(): TaskDestinationRepo {
  if (!instance) instance = new TaskDestinationRepo()
  return instance
}

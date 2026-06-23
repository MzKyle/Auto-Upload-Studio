import { join, normalize } from 'path'
import { v4 as uuid } from 'uuid'
import { determineDayFolderStatus } from '@shared/day-folder'
import type { DayFolderListQuery, DayFolderSummary, Task } from '@shared/types'
import { getDb } from './database'
import { getTaskRepo } from './task.repo'

interface DayFolderRecord extends DayFolderSummary {
  childFolders: string[]
}

function normalizeFolderPath(p: string): string {
  return normalize(p).replace(/[\\/]+$/, '')
}

function rowToRecord(row: Record<string, unknown>): DayFolderRecord {
  let childFolders: string[] = []
  try {
    const parsed = JSON.parse((row.child_folders_json as string) || '[]')
    if (Array.isArray(parsed)) {
      childFolders = parsed.filter((value): value is string => typeof value === 'string')
    }
  } catch {
    childFolders = []
  }

  return {
    id: row.id as string,
    folderPath: row.folder_path as string,
    folderName: row.folder_name as string,
    date: row.date_value as string,
    status: row.status as DayFolderSummary['status'],
    totalChildren: row.total_children as number,
    completedChildren: row.completed_children as number,
    totalFiles: row.total_files as number,
    uploadedFiles: row.uploaded_files as number,
    totalBytes: row.total_bytes as number,
    uploadedBytes: row.uploaded_bytes as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) || null,
    ignored: Boolean(row.ignored),
    childFolders
  }
}

export class DayFolderRepo {
  ensure(folderPath: string, dateName: string): DayFolderSummary {
    const existing = this.getRecordByPath(folderPath)
    if (existing) return existing

    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()
    const normalizedPath = normalizeFolderPath(folderPath)
    db.prepare(
      `INSERT INTO day_folders (
        id, folder_path, folder_name, date_value, status, child_folders_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'collecting', '[]', ?, ?)`
    ).run(id, normalizedPath, dateName, dateName, now, now)
    return this.getById(id)!
  }

  getById(id: string): DayFolderSummary | null {
    const record = this.getRecordById(id)
    return record ? this.toSummary(record) : null
  }

  getByPath(folderPath: string): DayFolderSummary | null {
    const record = this.getRecordByPath(folderPath)
    return record ? this.toSummary(record) : null
  }

  list(query: DayFolderListQuery = {}): DayFolderSummary[] {
    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (query.status) {
      conditions.push('status = ?')
      params.push(query.status)
    } else if (query.includeCompleted === false) {
      conditions.push("status NOT IN ('completed', 'completed_with_skips')")
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.max(1, Math.min(query.limit || 100, 1000))
    const rows = db.prepare(
      `SELECT * FROM day_folders ${where}
       ORDER BY date_value DESC, updated_at DESC LIMIT ?`
    ).all(...params, limit) as Record<string, unknown>[]

    return rows.map((row) => this.toSummary(rowToRecord(row)))
  }

  updateDiscovery(id: string, childFolders: string[]): void {
    const db = getDb()
    const existing = this.getRecordById(id)
    const normalizedChildren = Array.from(
      new Set([...(existing?.childFolders || []), ...childFolders])
    ).sort()
    db.prepare(
      `UPDATE day_folders
       SET child_folders_json = ?, total_children = ?, updated_at = ?
       WHERE id = ?`
    ).run(JSON.stringify(normalizedChildren), normalizedChildren.length, new Date().toISOString(), id)
  }

  recalculate(id: string, now = new Date()): DayFolderSummary | null {
    const record = this.getRecordById(id)
    if (!record) return null

    const tasks = getTaskRepo().listByDayFolder(id)
    const latestByPath = new Map<string, Task>()
    for (const task of tasks) {
      const normalizedPath = normalizeFolderPath(task.folderPath)
      if (!latestByPath.has(normalizedPath)) {
        latestByPath.set(normalizedPath, task)
      }
    }

    const childTasks = record.childFolders.map((folderName) =>
      latestByPath.get(normalizeFolderPath(join(record.folderPath, folderName))) || null
    )
    const childStatuses = childTasks.map((task) => task?.status || null)
    const status = record.ignored
      ? 'completed_with_skips'
      : determineDayFolderStatus(record.date, childStatuses, now)
    const completedChildren = childTasks.filter(
      (task) =>
        task?.status === 'completed' ||
        task?.status === 'synced' ||
        task?.status === 'skipped'
    ).length
    const totalFiles = childTasks.reduce((sum, task) => sum + (task?.totalFiles || 0), 0)
    const uploadedFiles = childTasks.reduce((sum, task) => sum + (task?.uploadedFiles || 0), 0)
    const totalBytes = childTasks.reduce((sum, task) => sum + (task?.totalBytes || 0), 0)
    const uploadedBytes = childTasks.reduce((sum, task) => sum + (task?.uploadedBytes || 0), 0)
    const updatedAt = new Date().toISOString()
    const completedAt =
      status === 'completed' || status === 'completed_with_skips'
        ? record.completedAt || updatedAt
        : null

    getDb().prepare(
      `UPDATE day_folders SET
        status = ?, completed_children = ?, total_files = ?, uploaded_files = ?,
        total_bytes = ?, uploaded_bytes = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`
    ).run(
      status,
      completedChildren,
      totalFiles,
      uploadedFiles,
      totalBytes,
      uploadedBytes,
      updatedAt,
      completedAt,
      id
    )

    return this.getById(id)
  }

  getChildTasks(id: string): Task[] {
    const record = this.getRecordById(id)
    if (!record) return []

    const expectedPaths = new Set(
      record.childFolders.map((name) => normalizeFolderPath(join(record.folderPath, name)))
    )
    const latestByPath = new Map<string, Task>()
    for (const task of getTaskRepo().listByDayFolder(id)) {
      const path = normalizeFolderPath(task.folderPath)
      if (expectedPaths.has(path) && !latestByPath.has(path)) {
        latestByPath.set(path, task)
      }
    }
    return record.childFolders
      .map((name) => latestByPath.get(normalizeFolderPath(join(record.folderPath, name))))
      .filter((task): task is Task => Boolean(task))
  }

  getCompletedForCleanup(retentionDays: number): DayFolderSummary[] {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
    const rows = getDb().prepare(
      `SELECT * FROM day_folders
       WHERE status IN ('completed', 'completed_with_skips')
         AND completed_at IS NOT NULL AND completed_at < ?
       ORDER BY completed_at ASC`
    ).all(cutoff) as Record<string, unknown>[]
    return rows.map((row) => this.toSummary(rowToRecord(row)))
  }

  clearCompleted(before?: string): void {
    const db = getDb()
    if (before) {
      db.prepare(
        "DELETE FROM day_folders WHERE status IN ('completed', 'completed_with_skips') AND completed_at < ?"
      ).run(before)
    } else {
      db.prepare(
        "DELETE FROM day_folders WHERE status IN ('completed', 'completed_with_skips')"
      ).run()
    }
  }

  deleteCompleted(id: string): void {
    getDb().prepare(
      "DELETE FROM day_folders WHERE id = ? AND status IN ('completed', 'completed_with_skips')"
    ).run(id)
  }

  setIgnored(id: string, ignored: boolean): void {
    getDb().prepare(
      `UPDATE day_folders
       SET ignored = ?, updated_at = ?
       WHERE id = ?`
    ).run(ignored ? 1 : 0, new Date().toISOString(), id)
  }

  private getRecordById(id: string): DayFolderRecord | null {
    const row = getDb().prepare('SELECT * FROM day_folders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToRecord(row) : null
  }

  private getRecordByPath(folderPath: string): DayFolderRecord | null {
    const normalizedPath = normalizeFolderPath(folderPath)
    const row = getDb().prepare('SELECT * FROM day_folders WHERE folder_path = ?').get(normalizedPath) as
      | Record<string, unknown>
      | undefined
    return row ? rowToRecord(row) : null
  }

  private toSummary(record: DayFolderRecord): DayFolderSummary {
    const { childFolders: _childFolders, ...summary } = record
    return summary
  }
}

let instance: DayFolderRepo | null = null
export function getDayFolderRepo(): DayFolderRepo {
  if (!instance) instance = new DayFolderRepo()
  return instance
}

import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  runMigrations,
  setDbForTests
} from '../src/main/db/database'
import { TaskRepo } from '../src/main/db/task.repo'
import { TaskDestinationRepo } from '../src/main/db/task-destination.repo'

function createDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  setDbForTests(db)
  return db
}

function insertDayFolder(db: Database.Database, id: string): void {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO day_folders (
      id, folder_path, folder_name, date_value, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `/data/${id}`,
    id,
    '2026-06-18',
    now,
    now
  )
}

test('incremental discovery waits for stability and requeues changed files', () => {
  const db = createDatabase()
  const repo = new TaskRepo()
  const destinationRepo = new TaskDestinationRepo()
  insertDayFolder(db, 'day-1')
  const task = repo.create({
    folderPath: '/data/2026-06-18/work-1',
    folderName: 'work-1',
    dayFolderId: 'day-1',
    uploadRelativePath: '2026-06-18/work-1'
  })

  const first = repo.reconcileFiles(
    task.id,
    [{ relativePath: 'camera/1.jpg', size: 10, mtimeMs: 100 }],
    2
  )
  assert.equal(first.unstableFiles, 1)
  assert.equal(repo.getById(task.id)?.status, 'scanning')

  const second = repo.reconcileFiles(
    task.id,
    [{ relativePath: 'camera/1.jpg', size: 10, mtimeMs: 100 }],
    2
  )
  assert.equal(second.readyFiles, 1)
  assert.equal(repo.getById(task.id)?.status, 'pending')

  const target = destinationRepo.listFileTargets(task.id)[0]
  destinationRepo.updateFileStatus(target.id, 'completed', 'key')
  destinationRepo.recalculateLogicalFile(target.taskFileId)
  repo.recalculateProgress(task.id)
  repo.reconcileFiles(
    task.id,
    [{ relativePath: 'camera/1.jpg', size: 10, mtimeMs: 100 }],
    2
  )
  assert.equal(repo.getById(task.id)?.status, 'synced')

  repo.reconcileFiles(
    task.id,
    [{ relativePath: 'camera/1.jpg', size: 12, mtimeMs: 200 }],
    2
  )
  assert.equal(repo.getById(task.id)?.status, 'scanning')
  assert.equal(
    destinationRepo.listFileTargets(task.id)[0].status,
    'pending'
  )

  setDbForTests(null)
  db.close()
})

test('reconciling 10000 small files remains idempotent', () => {
  const db = createDatabase()
  const repo = new TaskRepo()
  insertDayFolder(db, 'day-2')
  const task = repo.create({
    folderPath: '/data/2026-06-18/work-2',
    folderName: 'work-2',
    dayFolderId: 'day-2',
    uploadRelativePath: '2026-06-18/work-2'
  })
  const files = Array.from({ length: 10_000 }, (_, index) => ({
    relativePath: `camera/${String(index).padStart(5, '0')}.jpg`,
    size: 1024,
    mtimeMs: 100
  }))

  repo.reconcileFiles(task.id, files, 2)
  repo.reconcileFiles(task.id, files, 2)

  const fileCount = db.prepare(
    'SELECT COUNT(*) AS count FROM task_files WHERE task_id = ?'
  ).get(task.id) as { count: number }
  const targetCount = db.prepare(
    `SELECT COUNT(*) AS count
     FROM task_file_destinations
     WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)`
  ).get(task.id) as { count: number }
  assert.equal(fileCount.count, 10_000)
  assert.equal(targetCount.count, 10_000)
  assert.equal(repo.getById(task.id)?.status, 'pending')

  setDbForTests(null)
  db.close()
})

test('retrying one cloud preserves an already synced destination', () => {
  const db = createDatabase()
  const repo = new TaskRepo()
  const destinationRepo = new TaskDestinationRepo()
  insertDayFolder(db, 'day-3')
  const task = repo.create({
    folderPath: '/data/2026-06-18/work-3',
    folderName: 'work-3',
    dayFolderId: 'day-3',
    uploadRelativePath: '2026-06-18/work-3',
    uploadTargetMode: 'both'
  })
  destinationRepo.updateStatus(task.id, 'aliyun', 'synced')
  destinationRepo.updateStatus(task.id, 'tencent', 'failed', 'network')

  repo.retry(task.id, 'tencent')

  assert.deepEqual(
    destinationRepo.listByTask(task.id).map(({ provider, status }) => ({
      provider,
      status
    })),
    [
      { provider: 'aliyun', status: 'synced' },
      { provider: 'tencent', status: 'pending' }
    ]
  )

  setDbForTests(null)
  db.close()
})

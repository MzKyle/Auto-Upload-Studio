import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/main/db/database'

function createLegacyDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_files INTEGER NOT NULL DEFAULT 0,
      uploaded_files INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      oss_prefix TEXT,
      error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'local',
      source_machine_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE task_files (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      oss_key TEXT,
      upload_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE ssh_machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'key',
      private_key_path TEXT,
      encrypted_password TEXT,
      remote_dir TEXT NOT NULL,
      local_dir TEXT NOT NULL,
      bw_limit INTEGER NOT NULL DEFAULT 5000,
      cpu_nice INTEGER NOT NULL DEFAULT 19,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT,
      created_at TEXT NOT NULL
    );
  `)
  return db
}

test('legacy migration skips completed file details and preserves unfinished progress', () => {
  const db = createLegacyDatabase()
  const now = new Date().toISOString()
  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id, folder_path, folder_name, status, total_files, uploaded_files,
      total_bytes, uploaded_bytes, oss_prefix, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertTask.run(
    'completed-task',
    '/data/2026-03-14/completed',
    'completed',
    'completed',
    2,
    2,
    30,
    30,
    'upload',
    now,
    now,
    now
  )
  insertTask.run(
    'failed-task',
    '/data/2026-03-14/failed',
    'failed',
    'failed',
    2,
    1,
    30,
    10,
    'upload',
    now,
    now,
    now
  )

  const insertFile = db.prepare(`
    INSERT INTO task_files (
      id, task_id, relative_path, file_size, status, oss_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertFile.run('completed-file-1', 'completed-task', 'a.csv', 10, 'completed', 'upload/a.csv', now, now)
  insertFile.run('completed-file-2', 'completed-task', 'b.csv', 20, 'completed', 'upload/b.csv', now, now)
  insertFile.run('failed-file-1', 'failed-task', 'a.csv', 10, 'completed', 'upload/a.csv', now, now)
  insertFile.run('failed-file-2', 'failed-task', 'b.csv', 20, 'failed', null, now, now)

  runMigrations(db)
  runMigrations(db)

  const destinations = db.prepare(
    'SELECT task_id, provider, status FROM task_destinations ORDER BY task_id'
  ).all()
  assert.deepEqual(destinations, [
    { task_id: 'completed-task', provider: 'aliyun', status: 'completed' },
    { task_id: 'failed-task', provider: 'aliyun', status: 'failed' }
  ])

  const fileDestinations = db.prepare(`
    SELECT task_file_id, provider, status
    FROM task_file_destinations
    ORDER BY task_file_id
  `).all()
  assert.deepEqual(fileDestinations, [
    { task_file_id: 'failed-file-1', provider: 'aliyun', status: 'completed' },
    { task_file_id: 'failed-file-2', provider: 'aliyun', status: 'failed' }
  ])

  const uploadPaths = db.prepare(
    'SELECT id, upload_relative_path FROM tasks ORDER BY id'
  ).all()
  assert.deepEqual(uploadPaths, [
    { id: 'completed-task', upload_relative_path: '' },
    {
      id: 'failed-task',
      upload_relative_path: '2026-03-14/failed'
    }
  ])

  db.close()
})

test('legacy rsync tasks recover the date and child package from the remote path', () => {
  const db = createLegacyDatabase()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO ssh_machines (
      id, name, host, username, remote_dir, local_dir, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'machine-1',
    'remote-machine',
    '127.0.0.1',
    'tester',
    '/remote/data/2026-03-14/17-38-09_teleop',
    '/var/cache/current-package',
    now
  )
  db.prepare(`
    INSERT INTO tasks (
      id, folder_path, folder_name, status, oss_prefix, source_type,
      source_machine_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rsync-task',
    '/var/cache/current-package',
    'current-package',
    'pending',
    'upload',
    'rsync',
    'machine-1',
    now,
    now
  )

  runMigrations(db)

  const task = db.prepare(
    'SELECT upload_relative_path FROM tasks WHERE id = ?'
  ).get('rsync-task')
  assert.deepEqual(task, {
    upload_relative_path: '2026-03-14/17-38-09_teleop'
  })

  db.close()
})

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import { deriveDateScopedUploadRelativePath } from '@shared/day-folder'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('数据库未初始化')
  }
  return db
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'uploader.db')
  log.info('数据库路径:', dbPath)

  db = new Database(dbPath)
  db.pragma('busy_timeout = 5000')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  log.info('开始检查数据库结构')
  runMigrations(db)
  log.info('数据库初始化完成')
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_folders (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL UNIQUE,
      folder_name TEXT NOT NULL,
      date_value TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'collecting',
      child_folders_json TEXT NOT NULL DEFAULT '[]',
      total_children INTEGER NOT NULL DEFAULT 0,
      completed_children INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      uploaded_files INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_files INTEGER NOT NULL DEFAULT 0,
      uploaded_files INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      oss_prefix TEXT,
      upload_target_mode TEXT NOT NULL DEFAULT 'aliyun',
      day_folder_id TEXT,
      upload_relative_path TEXT NOT NULL DEFAULT '',
      error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'local',
      source_machine_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (day_folder_id) REFERENCES day_folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_files (
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

    CREATE TABLE IF NOT EXISTS task_destinations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      prefix TEXT NOT NULL DEFAULT '',
      total_files INTEGER NOT NULL DEFAULT 0,
      uploaded_files INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(task_id, provider),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_file_destinations (
      id TEXT PRIMARY KEY,
      task_file_id TEXT NOT NULL,
      task_destination_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      object_key TEXT,
      upload_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_file_id, provider),
      FOREIGN KEY (task_file_id) REFERENCES task_files(id) ON DELETE CASCADE,
      FOREIGN KEY (task_destination_id) REFERENCES task_destinations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_files_status ON task_files(status);
    CREATE INDEX IF NOT EXISTS idx_task_destinations_task_id ON task_destinations(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_destinations_provider_status ON task_destinations(provider, status);
    CREATE INDEX IF NOT EXISTS idx_task_file_destinations_task_file_id ON task_file_destinations(task_file_id);
    CREATE INDEX IF NOT EXISTS idx_task_file_destinations_destination_id ON task_file_destinations(task_destination_id);
    CREATE INDEX IF NOT EXISTS idx_day_folders_status ON day_folders(status);

    CREATE TABLE IF NOT EXISTS ssh_machines (
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
      transfer_mode TEXT NOT NULL DEFAULT 'rsync',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const taskColumns = db.pragma('table_info(tasks)') as Array<{ name: string }>
  if (!taskColumns.some((c) => c.name === 'day_folder_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN day_folder_id TEXT REFERENCES day_folders(id) ON DELETE SET NULL`)
    log.info('迁移: tasks 表添加 day_folder_id 列')
  }
  if (!taskColumns.some((c) => c.name === 'upload_relative_path')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN upload_relative_path TEXT NOT NULL DEFAULT ''`)
    log.info('迁移: tasks 表添加 upload_relative_path 列')
  }
  if (!taskColumns.some((c) => c.name === 'upload_target_mode')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN upload_target_mode TEXT NOT NULL DEFAULT 'aliyun'`)
    log.info('迁移: tasks 表添加 upload_target_mode 列')
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_day_folder_id ON tasks(day_folder_id)`)

  const incompleteTasks = db.prepare(
    `SELECT id, folder_path, source_type, source_machine_id, upload_relative_path
     FROM tasks
     WHERE status != 'completed'`
  ).all() as Array<{
    id: string
    folder_path: string
    source_type: string
    source_machine_id: string | null
    upload_relative_path: string
  }>
  const findRemoteDirectory = db.prepare(
    'SELECT remote_dir FROM ssh_machines WHERE id = ?'
  )
  const updateUploadRelativePath = db.prepare(
    `UPDATE tasks
     SET upload_relative_path = ?, updated_at = ?
     WHERE id = ?`
  )
  let migratedDatePaths = 0
  for (const task of incompleteTasks) {
    let uploadRelativePath: string | null = null
    if (task.source_type === 'rsync' && task.source_machine_id) {
      const machine = findRemoteDirectory.get(task.source_machine_id) as
        | { remote_dir: string }
        | undefined
      uploadRelativePath = machine
        ? deriveDateScopedUploadRelativePath(machine.remote_dir)
        : null
    }
    uploadRelativePath ||= deriveDateScopedUploadRelativePath(task.folder_path)

    if (
      uploadRelativePath &&
      task.upload_relative_path !== uploadRelativePath
    ) {
      updateUploadRelativePath.run(
        uploadRelativePath,
        new Date().toISOString(),
        task.id
      )
      migratedDatePaths++
    }
  }
  if (migratedDatePaths > 0) {
    log.info(`日期层路径迁移完成: ${migratedDatePaths} 个未完成任务`)
  }

  const migratedDestinations = db.prepare(
    `INSERT OR IGNORE INTO task_destinations (
      id, task_id, provider, status, prefix, total_files, uploaded_files,
      total_bytes, uploaded_bytes, error_message, created_at, updated_at, completed_at
    )
    SELECT lower(hex(randomblob(16))), id, 'aliyun', status, COALESCE(oss_prefix, ''),
      total_files, uploaded_files, total_bytes, uploaded_bytes, error_message,
      created_at, updated_at, completed_at
    FROM tasks t
    WHERE NOT EXISTS (
      SELECT 1 FROM task_destinations existing WHERE existing.task_id = t.id
    )`
  ).run().changes

  const migratedFileDestinations = db.prepare(
    `INSERT OR IGNORE INTO task_file_destinations (
      id, task_file_id, task_destination_id, provider, status, object_key,
      upload_id, error_message, created_at, updated_at
    )
    SELECT lower(hex(randomblob(16))), tf.id, td.id, 'aliyun', tf.status,
      tf.oss_key, tf.upload_id, tf.error_message, tf.created_at, tf.updated_at
    FROM tasks t
    INNER JOIN task_files tf ON tf.task_id = t.id
    INNER JOIN task_destinations td
      ON td.task_id = t.id AND td.provider = 'aliyun'
    WHERE t.status != 'completed'
      AND NOT EXISTS (
      SELECT 1
      FROM task_file_destinations existing
      WHERE existing.task_file_id = tf.id
    )`
  ).run().changes
  if (migratedDestinations > 0 || migratedFileDestinations > 0) {
    log.info(
      `双云任务迁移完成: ${migratedDestinations} 个任务目标, ` +
      `${migratedFileDestinations} 个文件目标`
    )
  }

  // 增量迁移：为已有的 ssh_machines 表补充 transfer_mode 列
  const columns = db.pragma('table_info(ssh_machines)') as Array<{ name: string }>
  const hasTransferMode = columns.some((c) => c.name === 'transfer_mode')
  if (!hasTransferMode) {
    db.exec(`ALTER TABLE ssh_machines ADD COLUMN transfer_mode TEXT NOT NULL DEFAULT 'rsync'`)
    log.info('迁移: ssh_machines 表添加 transfer_mode 列')
  }
}

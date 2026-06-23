"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");
const log = require("electron-log");
const uuid = require("uuid");
const chokidar = require("chokidar");
const events = require("events");
const promises = require("fs/promises");
const child_process = require("child_process");
const ssh2 = require("ssh2");
const https = require("https");
const clientS3 = require("@aws-sdk/client-s3");
const libStorage = require("@aws-sdk/lib-storage");
const nodeHttpHandler = require("@smithy/node-http-handler");
const is = {
  dev: !electron.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      electron.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return electron.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      electron.app.setLoginItemSettings({
        openAtLogin: auto,
        path: process.execPath
      });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return electron.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    electron.ipcMain.on("win:invoke", (event, action) => {
      const win = electron.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
const IPC = {
  // 任务管理
  TASK_LIST: "task:list",
  TASK_GET: "task:get",
  TASK_ADD_FOLDER: "task:add-folder",
  TASK_PAUSE: "task:pause",
  TASK_RESUME: "task:resume",
  TASK_CANCEL: "task:cancel",
  TASK_RETRY: "task:retry",
  TASK_SKIP: "task:skip",
  TASK_RESTORE: "task:restore",
  TASK_DETAIL: "task:detail",
  TASK_PROGRESS: "task:progress",
  // push from main
  TASK_STATUS_CHANGE: "task:status-change",
  // push from main
  TASK_DESTINATION_CHANGE: "task:destination-change",
  // 日期目录汇总
  DAY_FOLDER_LIST: "day-folder:list",
  DAY_FOLDER_DELETE: "day-folder:delete",
  DAY_FOLDER_IGNORE: "day-folder:ignore",
  DAY_FOLDER_RESTORE: "day-folder:restore",
  DAY_FOLDER_EVENT: "day-folder:event",
  // 扫描器
  SCANNER_STATUS: "scanner:status",
  SCANNER_TRIGGER: "scanner:trigger",
  SCANNER_START: "scanner:start",
  SCANNER_STOP: "scanner:stop",
  SCANNER_EVENT: "scanner:event",
  // push from main
  // 数采模式
  DATA_COLLECT_LIST: "data-collect:list",
  DATA_COLLECT_RUN: "data-collect:run",
  DATA_COLLECT_RESULT: "data-collect:result",
  // push from main
  // 设置
  SETTINGS_GET_ALL: "settings:get-all",
  SETTINGS_SAVE: "settings:save",
  SETTINGS_TEST_OSS: "settings:test-oss",
  SETTINGS_TEST_TENCENT_S3: "settings:test-tencent-s3",
  // SSH / rsync
  SSH_LIST_MACHINES: "ssh:list-machines",
  SSH_ADD_MACHINE: "ssh:add-machine",
  SSH_UPDATE_MACHINE: "ssh:update-machine",
  SSH_DELETE_MACHINE: "ssh:delete-machine",
  SSH_TEST_CONNECTION: "ssh:test-connection",
  RSYNC_START: "rsync:start",
  RSYNC_STOP: "rsync:stop",
  RSYNC_PROGRESS: "rsync:progress",
  // push from main
  SFTP_START: "sftp:start",
  SFTP_STOP: "sftp:stop",
  SFTP_PROGRESS: "sftp:progress",
  // push from main
  // 历史
  HISTORY_LIST: "history:list",
  HISTORY_CLEAR: "history:clear",
  HISTORY_DELETE: "history:delete",
  // 磁盘用量
  DISK_USAGE: "disk:usage",
  // 窗口
  WINDOW_TOGGLE: "window:toggle",
  WINDOW_MINI_MONITOR: "window:mini-monitor",
  // 对话框
  DIALOG_SELECT_FOLDER: "dialog:select-folder",
  DIALOG_SELECT_DIRECTORY: "dialog:select-directory",
  // 标注
  ANNOTATION_OPEN_WINDOW: "annotation:open-window",
  ANNOTATION_SELECT_IMAGE: "annotation:select-image",
  ANNOTATION_READ_IMAGE: "annotation:read-image",
  ANNOTATION_SAVE_EXPORT: "annotation:save-export",
  ANNOTATION_UPLOAD_OSS: "annotation:upload-oss"
};
const DATE_FOLDER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseDateFolderName(name) {
  const match = DATE_FOLDER_PATTERN.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}
function isDateFolderName(name) {
  return parseDateFolderName(name) !== null;
}
function isDateFolderBeforeToday(name, now = /* @__PURE__ */ new Date()) {
  const folderDate = parseDateFolderName(name);
  if (!folderDate) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return folderDate.getTime() < today.getTime();
}
function determineDayFolderStatus(dateName, childStatuses, now = /* @__PURE__ */ new Date()) {
  if (childStatuses.some((status) => status === "failed" || status === "paused")) {
    return "blocked";
  }
  const allTerminal = childStatuses.length > 0 && childStatuses.every(
    (status) => status === "completed" || status === "synced" || status === "skipped"
  );
  if (allTerminal && isDateFolderBeforeToday(dateName, now)) {
    return childStatuses.some((status) => status === "skipped") ? "completed_with_skips" : "completed";
  }
  if (childStatuses.some(
    (status) => status === null || status === "pending" || status === "scanning" || status === "uploading" || status === "retrying"
  )) {
    return "processing";
  }
  return "collecting";
}
function joinOssPath(...parts) {
  return parts.flatMap((part) => (part || "").replace(/\\/g, "/").split("/")).map((part) => part.trim()).filter((part) => part.length > 0 && part !== ".").join("/");
}
function buildUploadRelativePath(dateFolder, childFolder) {
  return joinOssPath(dateFolder, childFolder);
}
function pathSegments(directoryPath) {
  return directoryPath.replace(/\\/g, "/").split("/").map((part) => part.trim()).filter((part) => part.length > 0 && part !== ".");
}
function deriveDateScopedUploadRelativePath(directoryPath) {
  const segments = pathSegments(directoryPath);
  const folderName = segments.at(-1);
  if (!folderName) return null;
  if (isDateFolderName(folderName)) {
    return folderName;
  }
  const parentName = segments.at(-2);
  if (parentName && isDateFolderName(parentName)) {
    return buildUploadRelativePath(parentName, folderName);
  }
  return null;
}
function resolveDirectoryUploadRelativePath(directoryPath, fallbackDirectoryPath) {
  const dateScopedPath = deriveDateScopedUploadRelativePath(directoryPath) || (fallbackDirectoryPath ? deriveDateScopedUploadRelativePath(fallbackDirectoryPath) : null);
  if (dateScopedPath) return dateScopedPath;
  const primaryFolderName = pathSegments(directoryPath).at(-1);
  const fallbackFolderName = fallbackDirectoryPath ? pathSegments(fallbackDirectoryPath).at(-1) : null;
  return primaryFolderName || fallbackFolderName || "";
}
function buildOssKey(prefix, uploadRelativePath, fileRelativePath) {
  return joinOssPath(prefix, uploadRelativePath, fileRelativePath);
}
let db = null;
function getDb() {
  if (!db) {
    throw new Error("数据库未初始化");
  }
  return db;
}
function initDatabase() {
  const dbPath = path.join(electron.app.getPath("userData"), "uploader.db");
  log.info("数据库路径:", dbPath);
  db = new Database(dbPath);
  db.pragma("busy_timeout = 30000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  log.info("开始检查数据库结构");
  runMigrations(db);
  reconcileStartupState(db);
  log.info("数据库初始化完成");
}
function runMigrations(db2) {
  db2.exec(`
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
      completed_at TEXT,
      ignored INTEGER NOT NULL DEFAULT 0
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
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      source_status TEXT NOT NULL DEFAULT 'present',
      stable_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
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
  `);
  const taskColumns = db2.pragma("table_info(tasks)");
  if (!taskColumns.some((c) => c.name === "day_folder_id")) {
    db2.exec(`ALTER TABLE tasks ADD COLUMN day_folder_id TEXT REFERENCES day_folders(id) ON DELETE SET NULL`);
    log.info("迁移: tasks 表添加 day_folder_id 列");
  }
  if (!taskColumns.some((c) => c.name === "upload_relative_path")) {
    db2.exec(`ALTER TABLE tasks ADD COLUMN upload_relative_path TEXT NOT NULL DEFAULT ''`);
    log.info("迁移: tasks 表添加 upload_relative_path 列");
  }
  if (!taskColumns.some((c) => c.name === "upload_target_mode")) {
    db2.exec(`ALTER TABLE tasks ADD COLUMN upload_target_mode TEXT NOT NULL DEFAULT 'aliyun'`);
    log.info("迁移: tasks 表添加 upload_target_mode 列");
  }
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_day_folder_id ON tasks(day_folder_id)`);
  const dayFolderColumns = db2.pragma("table_info(day_folders)");
  if (!dayFolderColumns.some((c) => c.name === "ignored")) {
    db2.exec(`ALTER TABLE day_folders ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0`);
    log.info("迁移: day_folders 表添加 ignored 列");
  }
  const taskFileColumns = db2.pragma("table_info(task_files)");
  const taskFileAdditions = [
    ["mtime_ms", `INTEGER NOT NULL DEFAULT 0`],
    ["last_seen_at", `TEXT`],
    ["source_status", `TEXT NOT NULL DEFAULT 'present'`],
    ["stable_count", `INTEGER NOT NULL DEFAULT 0`],
    ["retry_count", `INTEGER NOT NULL DEFAULT 0`],
    ["next_retry_at", `TEXT`]
  ];
  for (const [name, definition] of taskFileAdditions) {
    if (!taskFileColumns.some((column) => column.name === name)) {
      db2.exec(`ALTER TABLE task_files ADD COLUMN ${name} ${definition}`);
      log.info(`迁移: task_files 表添加 ${name} 列`);
    }
  }
  ensureUniqueTaskFilePathIndex(db2);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_files_retry
    ON task_files(status, next_retry_at)
  `);
  const incompleteTasks = db2.prepare(
    `SELECT id, folder_path, source_type, source_machine_id, upload_relative_path
     FROM tasks
     WHERE status != 'completed'`
  ).all();
  const findRemoteDirectory = db2.prepare(
    "SELECT remote_dir FROM ssh_machines WHERE id = ?"
  );
  const updateUploadRelativePath = db2.prepare(
    `UPDATE tasks
     SET upload_relative_path = ?, updated_at = ?
     WHERE id = ?`
  );
  let migratedDatePaths = 0;
  for (const task of incompleteTasks) {
    let uploadRelativePath = null;
    if (task.source_type === "rsync" && task.source_machine_id) {
      const machine = findRemoteDirectory.get(task.source_machine_id);
      uploadRelativePath = machine ? deriveDateScopedUploadRelativePath(machine.remote_dir) : null;
    }
    uploadRelativePath ||= deriveDateScopedUploadRelativePath(task.folder_path);
    if (uploadRelativePath && task.upload_relative_path !== uploadRelativePath) {
      updateUploadRelativePath.run(
        uploadRelativePath,
        (/* @__PURE__ */ new Date()).toISOString(),
        task.id
      );
      migratedDatePaths++;
    }
  }
  if (migratedDatePaths > 0) {
    log.info(`日期层路径迁移完成: ${migratedDatePaths} 个未完成任务`);
  }
  const migratedDestinations = db2.prepare(
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
  ).run().changes;
  const migratedFileDestinations = db2.prepare(
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
  ).run().changes;
  if (migratedDestinations > 0 || migratedFileDestinations > 0) {
    log.info(
      `双云任务迁移完成: ${migratedDestinations} 个任务目标, ${migratedFileDestinations} 个文件目标`
    );
  }
  const columns = db2.pragma("table_info(ssh_machines)");
  const hasTransferMode = columns.some((c) => c.name === "transfer_mode");
  if (!hasTransferMode) {
    db2.exec(`ALTER TABLE ssh_machines ADD COLUMN transfer_mode TEXT NOT NULL DEFAULT 'rsync'`);
    log.info("迁移: ssh_machines 表添加 transfer_mode 列");
  }
}
function ensureUniqueTaskFilePathIndex(db2) {
  const existing = db2.prepare(
    `SELECT 1
     FROM sqlite_master
     WHERE type = 'index' AND name = 'idx_task_files_task_path'`
  ).get();
  if (existing) return;
  log.info("迁移: 开始创建任务文件路径索引");
  try {
    db2.exec(`
      CREATE UNIQUE INDEX idx_task_files_task_path
      ON task_files(task_id, relative_path)
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("unique constraint failed")) {
      throw error;
    }
    log.warn("迁移: 发现重复任务文件记录，开始清理");
    const transaction = db2.transaction(() => {
      db2.exec(`
        DELETE FROM task_files
        WHERE rowid NOT IN (
          SELECT MIN(rowid)
          FROM task_files
          GROUP BY task_id, relative_path
        )
      `);
      db2.exec(`
        CREATE UNIQUE INDEX idx_task_files_task_path
        ON task_files(task_id, relative_path)
      `);
    });
    transaction();
  }
  log.info("迁移: 任务文件路径索引创建完成");
}
function reconcileStartupState(db2) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    `UPDATE task_files
     SET status = 'pending', updated_at = ?
     WHERE status = 'uploading'`
  ).run(now);
  db2.prepare(
    `UPDATE task_file_destinations
     SET status = 'pending', updated_at = ?
     WHERE status = 'uploading'`
  ).run(now);
  const unfinished = db2.prepare(
    `SELECT id, folder_path, source_type, status
     FROM tasks
     WHERE status NOT IN ('completed', 'synced', 'skipped')`
  ).all();
  const resetTask = db2.prepare(
    `UPDATE tasks
     SET status = 'pending', error_message = NULL, completed_at = NULL, updated_at = ?
     WHERE id = ?`
  );
  const resetDestinations = db2.prepare(
    `UPDATE task_destinations
     SET status = CASE
           WHEN status IN ('completed', 'synced') THEN status
           ELSE 'pending'
         END,
         error_message = NULL,
         completed_at = CASE
           WHEN status IN ('completed', 'synced') THEN completed_at
           ELSE NULL
         END,
         updated_at = ?
     WHERE task_id = ?`
  );
  const resetFiles = db2.prepare(
    `UPDATE task_files
     SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
         error_message = NULL, retry_count = 0, next_retry_at = NULL,
         updated_at = ?
     WHERE task_id = ? AND source_status = 'present'`
  );
  const resetFileDestinations = db2.prepare(
    `UPDATE task_file_destinations
     SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
         error_message = NULL, updated_at = ?
     WHERE task_file_id IN (
       SELECT id FROM task_files
       WHERE task_id = ? AND source_status = 'present'
     )`
  );
  const skipTask = db2.prepare(
    `UPDATE tasks
     SET status = 'skipped', error_message = '源目录已删除',
         completed_at = ?, updated_at = ?
     WHERE id = ?`
  );
  const skipDestinations = db2.prepare(
    `UPDATE task_destinations
     SET status = CASE
           WHEN status IN ('completed', 'synced') THEN status
           ELSE 'skipped'
         END,
         error_message = CASE
           WHEN status IN ('completed', 'synced') THEN error_message
           ELSE '源目录已删除'
         END,
         completed_at = COALESCE(completed_at, ?), updated_at = ?
     WHERE task_id = ?`
  );
  const skipFiles = db2.prepare(
    `UPDATE task_files
     SET source_status = 'missing',
         status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
         error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源目录已删除' END,
         next_retry_at = NULL, updated_at = ?
     WHERE task_id = ?`
  );
  const skipFileDestinations = db2.prepare(
    `UPDATE task_file_destinations
     SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
         error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源目录已删除' END,
         updated_at = ?
     WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)`
  );
  const transaction = db2.transaction(() => {
    for (const task of unfinished) {
      const monitorable = task.source_type === "local" || task.source_type === "rsync";
      if (monitorable && !fs.existsSync(task.folder_path)) {
        skipTask.run(now, now, task.id);
        skipDestinations.run(now, now, task.id);
        skipFiles.run(now, task.id);
        skipFileDestinations.run(now, task.id);
        continue;
      }
      resetTask.run(now, task.id);
      resetDestinations.run(now, task.id);
      resetFiles.run(now, task.id);
      resetFileDestinations.run(now, task.id);
    }
  });
  transaction();
}
function providersForMode(mode) {
  if (mode === "both") return ["aliyun", "tencent"];
  return [mode];
}
function getUploadTargetSnapshot(settings) {
  return {
    mode: settings.cloud.targetMode,
    prefixes: {
      aliyun: settings.oss.prefix || "",
      tencent: settings.tencentS3.prefix || ""
    }
  };
}
function deriveLogicalFileStatus(statuses) {
  if (statuses.length > 0 && statuses.every((status) => status === "completed")) {
    return "completed";
  }
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.length > 0 && statuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  if (statuses.some((status) => status === "uploading")) return "uploading";
  return "pending";
}
function rowToDestination(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    provider: row.provider,
    status: row.status,
    prefix: row.prefix || "",
    totalFiles: row.total_files,
    uploadedFiles: row.uploaded_files,
    totalBytes: row.total_bytes,
    uploadedBytes: row.uploaded_bytes,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}
function rowToFileDestination(row) {
  return {
    id: row.id,
    taskFileId: row.task_file_id,
    taskDestinationId: row.task_destination_id,
    provider: row.provider,
    status: row.status,
    objectKey: row.object_key || null,
    uploadId: row.upload_id || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
class TaskDestinationRepo {
  ensureForTask(taskId, mode, prefixes, initialStatus = "pending") {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const stmt = db2.prepare(
      `INSERT OR IGNORE INTO task_destinations (
        id, task_id, provider, status, prefix, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const completedAt = initialStatus === "completed" || initialStatus === "failed" || initialStatus === "skipped" ? now : null;
    const transaction = db2.transaction(() => {
      for (const provider of providersForMode(mode)) {
        stmt.run(
          uuid.v4(),
          taskId,
          provider,
          initialStatus,
          prefixes[provider] || "",
          now,
          now,
          completedAt
        );
      }
    });
    transaction();
    return this.listByTask(taskId);
  }
  listByTask(taskId) {
    return getDb().prepare("SELECT * FROM task_destinations WHERE task_id = ? ORDER BY provider").all(taskId).map(rowToDestination);
  }
  get(taskId, provider) {
    const row = getDb().prepare("SELECT * FROM task_destinations WHERE task_id = ? AND provider = ?").get(taskId, provider);
    return row ? rowToDestination(row) : null;
  }
  updateStatus(taskId, provider, status, errorMessage) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const completedAt = status === "completed" || status === "failed" || status === "skipped" ? now : null;
    getDb().prepare(
      `UPDATE task_destinations
         SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
         WHERE task_id = ? AND provider = ?`
    ).run(status, errorMessage || null, now, completedAt, taskId, provider);
  }
  updateIncompleteStatuses(taskId, status, errorMessage) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const completedAt = status === "completed" || status === "failed" || status === "skipped" ? now : null;
    getDb().prepare(
      `UPDATE task_destinations
         SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
         WHERE task_id = ? AND status NOT IN ('completed', 'synced', 'skipped')`
    ).run(status, errorMessage || null, now, completedAt, taskId);
  }
  setTotals(taskId, provider, totalFiles, totalBytes) {
    getDb().prepare(
      `UPDATE task_destinations
         SET total_files = ?, total_bytes = ?, updated_at = ?
         WHERE task_id = ? AND provider = ?`
    ).run(totalFiles, totalBytes, (/* @__PURE__ */ new Date()).toISOString(), taskId, provider);
  }
  updateProgress(taskId, provider, uploadedFiles, uploadedBytes) {
    getDb().prepare(
      `UPDATE task_destinations
         SET uploaded_files = ?, uploaded_bytes = ?, updated_at = ?
         WHERE task_id = ? AND provider = ?`
    ).run(uploadedFiles, uploadedBytes, (/* @__PURE__ */ new Date()).toISOString(), taskId, provider);
  }
  ensureForTaskFiles(taskId) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      `INSERT OR IGNORE INTO task_file_destinations (
        id, task_file_id, task_destination_id, provider, status, created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))), tf.id, td.id, td.provider, 'pending', ?, ?
      FROM task_files tf
      INNER JOIN task_destinations td ON td.task_id = tf.task_id
      WHERE tf.task_id = ?`
    ).run(now, now, taskId);
  }
  listFileTargets(taskId, provider) {
    const providerCondition = provider ? "AND tfd.provider = ?" : "";
    const params = [taskId];
    if (provider) params.push(provider);
    const rows = getDb().prepare(
      `SELECT tfd.*, tf.task_id, tf.relative_path, tf.file_size,
          tf.mtime_ms, tf.retry_count, tf.next_retry_at,
          tf.source_status, tf.stable_count
         FROM task_file_destinations tfd
         INNER JOIN task_files tf ON tf.id = tfd.task_file_id
         WHERE tf.task_id = ? ${providerCondition}
         ORDER BY tf.created_at, tfd.provider`
    ).all(...params);
    return rows.map((row) => ({
      ...rowToFileDestination(row),
      taskId: row.task_id,
      relativePath: row.relative_path,
      fileSize: row.file_size,
      mtimeMs: Number(row.mtime_ms || 0),
      retryCount: Number(row.retry_count || 0),
      nextRetryAt: row.next_retry_at || null,
      sourceStatus: row.source_status || "present",
      stableCount: Number(row.stable_count || 0)
    }));
  }
  listReadyFileTargets(taskId, requiredStableChecks, now = (/* @__PURE__ */ new Date()).toISOString()) {
    const rows = getDb().prepare(
      `SELECT tfd.*, tf.task_id, tf.relative_path, tf.file_size,
          tf.mtime_ms, tf.retry_count, tf.next_retry_at,
          tf.source_status, tf.stable_count
         FROM task_file_destinations tfd
         INNER JOIN task_files tf ON tf.id = tfd.task_file_id
         WHERE tf.task_id = ?
           AND tfd.status = 'pending'
           AND tf.source_status = 'present'
           AND tf.stable_count >= ?
           AND (tf.next_retry_at IS NULL OR tf.next_retry_at <= ?)
         ORDER BY tf.created_at, tfd.provider`
    ).all(taskId, requiredStableChecks, now);
    return rows.map((row) => ({
      ...rowToFileDestination(row),
      taskId: row.task_id,
      relativePath: row.relative_path,
      fileSize: row.file_size,
      mtimeMs: Number(row.mtime_ms || 0),
      retryCount: Number(row.retry_count || 0),
      nextRetryAt: row.next_retry_at || null,
      sourceStatus: row.source_status || "present",
      stableCount: Number(row.stable_count || 0)
    }));
  }
  summarizeFileTargets(taskId, provider, now = (/* @__PURE__ */ new Date()).toISOString()) {
    const row = getDb().prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN tfd.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN tfd.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE
           WHEN tfd.status = 'pending'
            AND tf.next_retry_at IS NOT NULL
            AND tf.next_retry_at > ?
           THEN 1 ELSE 0 END) AS retry_waiting
       FROM task_file_destinations tfd
       INNER JOIN task_files tf ON tf.id = tfd.task_file_id
       WHERE tf.task_id = ? AND tfd.provider = ?`
    ).get(now, taskId, provider);
    return {
      total: row.total || 0,
      failed: row.failed || 0,
      pending: row.pending || 0,
      retryWaiting: row.retry_waiting || 0
    };
  }
  updateFileStatus(id, status, objectKey, uploadId, errorMessage) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    getDb().prepare(
      `UPDATE task_file_destinations
         SET status = ?, object_key = COALESCE(?, object_key),
           upload_id = COALESCE(?, upload_id), error_message = ?, updated_at = ?
         WHERE id = ?`
    ).run(status, objectKey || null, uploadId || null, errorMessage || null, now, id);
  }
  recalculateLogicalFile(taskFileId) {
    const rows = getDb().prepare("SELECT status FROM task_file_destinations WHERE task_file_id = ?").all(taskFileId);
    const statuses = rows.map((row) => row.status);
    const status = deriveLogicalFileStatus(statuses);
    getDb().prepare("UPDATE task_files SET status = ?, updated_at = ? WHERE id = ?").run(status, (/* @__PURE__ */ new Date()).toISOString(), taskFileId);
    return status;
  }
  recalculateProgress(taskId, provider) {
    const row = getDb().prepare(
      `SELECT
         COUNT(*) AS total_files,
         COALESCE(SUM(tf.file_size), 0) AS total_bytes,
         SUM(CASE WHEN tfd.status = 'completed' THEN 1 ELSE 0 END) AS uploaded_files,
         COALESCE(SUM(CASE WHEN tfd.status = 'completed' THEN tf.file_size ELSE 0 END), 0) AS uploaded_bytes
       FROM task_file_destinations tfd
       INNER JOIN task_files tf ON tf.id = tfd.task_file_id
       WHERE tf.task_id = ? AND tfd.provider = ?`
    ).get(taskId, provider);
    this.setTotals(
      taskId,
      provider,
      row.total_files || 0,
      row.total_bytes || 0
    );
    this.updateProgress(
      taskId,
      provider,
      row.uploaded_files || 0,
      row.uploaded_bytes || 0
    );
  }
  resetFailed(taskId, provider) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const providerCondition = provider ? "AND provider = ?" : "";
    const destinationParams = [now, taskId];
    const fileParams = [now, taskId];
    if (provider) {
      destinationParams.push(provider);
      fileParams.push(provider);
    }
    db2.prepare(
      `UPDATE task_destinations
       SET status = CASE
             WHEN status IN ('completed', 'synced') THEN status
             ELSE 'pending'
           END,
         error_message = NULL,
         completed_at = CASE
           WHEN status IN ('completed', 'synced') THEN completed_at
           ELSE NULL
         END,
         updated_at = ?
       WHERE task_id = ? ${providerCondition}`
    ).run(...destinationParams);
    db2.prepare(
      `UPDATE task_file_destinations
       SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
         error_message = NULL, updated_at = ?
       WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)
       ${providerCondition}`
    ).run(...fileParams);
    const fileRows = db2.prepare("SELECT id FROM task_files WHERE task_id = ?").all(taskId);
    for (const row of fileRows) this.recalculateLogicalFile(row.id);
  }
}
let instance$g = null;
function getTaskDestinationRepo() {
  if (!instance$g) instance$g = new TaskDestinationRepo();
  return instance$g;
}
function normalizeFolderPath$1(p) {
  return path.normalize(p).replace(/[\\/]+$/, "");
}
function rowToTask(row) {
  return {
    id: row.id,
    folderPath: row.folder_path,
    folderName: row.folder_name,
    status: row.status,
    totalFiles: row.total_files,
    uploadedFiles: row.uploaded_files,
    totalBytes: row.total_bytes,
    uploadedBytes: row.uploaded_bytes,
    ossPrefix: row.oss_prefix || "",
    uploadTargetMode: row.upload_target_mode || "aliyun",
    destinations: getTaskDestinationRepo().listByTask(row.id),
    dayFolderId: row.day_folder_id || null,
    uploadRelativePath: row.upload_relative_path || row.folder_name,
    errorMessage: row.error_message || null,
    sourceType: row.source_type,
    sourceMachineId: row.source_machine_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}
function rowToTaskFile(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    relativePath: row.relative_path,
    fileSize: row.file_size,
    status: row.status,
    ossKey: row.oss_key || null,
    uploadId: row.upload_id || null,
    errorMessage: row.error_message || null,
    mtimeMs: Number(row.mtime_ms || 0),
    lastSeenAt: row.last_seen_at || null,
    sourceStatus: row.source_status || "present",
    stableCount: Number(row.stable_count || 0),
    retryCount: Number(row.retry_count || 0),
    nextRetryAt: row.next_retry_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
class TaskRepo {
  listByStatus(status) {
    const db2 = getDb();
    if (status) {
      return db2.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC").all(status).map(rowToTask);
    }
    return db2.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all().map(rowToTask);
  }
  listContinuouslyMonitored(dateName) {
    const rows = getDb().prepare(
      `SELECT * FROM tasks
       WHERE source_type = 'local'
         AND day_folder_id IS NOT NULL
         AND replace(upload_relative_path, '\\', '/') LIKE ?
         AND status NOT IN ('skipped', 'paused', 'completed')
       ORDER BY created_at ASC`
    ).all(`${dateName}/%`);
    return rows.map(rowToTask);
  }
  listRunnable(now = (/* @__PURE__ */ new Date()).toISOString()) {
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
    ).all(now);
    return rows.map(rowToTask);
  }
  getById(id) {
    const db2 = getDb();
    const row = db2.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? rowToTask(row) : null;
  }
  getByFolderPath(folderPath) {
    const db2 = getDb();
    const normalized = normalizeFolderPath$1(folderPath);
    const row = db2.prepare("SELECT * FROM tasks WHERE folder_path = ? ORDER BY created_at DESC LIMIT 1").get(normalized);
    return row ? rowToTask(row) : null;
  }
  /**
   * Find the task whose folderPath is a parent directory of the given file path.
   * Returns the most specific match (longest folderPath).
   */
  findTaskContainingFile(filePath) {
    const db2 = getDb();
    const normalized = path.normalize(filePath);
    const tasks = db2.prepare("SELECT * FROM tasks ORDER BY length(folder_path) DESC").all().map(rowToTask);
    return tasks.find((t) => {
      const fp = t.folderPath;
      return normalized.startsWith(fp + "/") || normalized.startsWith(fp + "\\");
    }) || null;
  }
  create(params) {
    const db2 = getDb();
    const id = uuid.v4();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const normalizedPath = normalizeFolderPath$1(params.folderPath);
    db2.prepare(
      `INSERT INTO tasks (
        id, folder_path, folder_name, status, oss_prefix, upload_target_mode,
        day_folder_id, upload_relative_path, source_type, source_machine_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      normalizedPath,
      params.folderName,
      params.ossPrefix || "",
      params.uploadTargetMode || "aliyun",
      params.dayFolderId || null,
      params.uploadRelativePath || params.folderName,
      params.sourceType || "local",
      params.sourceMachineId || null,
      now,
      now
    );
    getTaskDestinationRepo().ensureForTask(
      id,
      params.uploadTargetMode || "aliyun",
      params.destinationPrefixes || { aliyun: params.ossPrefix || "" }
    );
    return this.getById(id);
  }
  updateDayFolderMetadata(id, dayFolderId, uploadRelativePath) {
    getDb().prepare(
      `UPDATE tasks
       SET day_folder_id = ?, upload_relative_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(dayFolderId, uploadRelativePath, (/* @__PURE__ */ new Date()).toISOString(), id);
  }
  updateUploadRelativePath(id, uploadRelativePath) {
    getDb().prepare(
      `UPDATE tasks
       SET upload_relative_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(uploadRelativePath, (/* @__PURE__ */ new Date()).toISOString(), id);
  }
  listByDayFolder(dayFolderId) {
    const rows = getDb().prepare(
      "SELECT * FROM tasks WHERE day_folder_id = ? ORDER BY created_at DESC"
    ).all(dayFolderId);
    return rows.map(rowToTask);
  }
  updateStatus(id, status, errorMessage) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const completedAt = status === "completed" || status === "failed" || status === "skipped" ? now : null;
    db2.prepare(
      "UPDATE tasks SET status = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?"
    ).run(status, errorMessage || null, now, completedAt, id);
  }
  retry(id, provider) {
    getTaskDestinationRepo().resetFailed(id, provider);
    getDb().prepare(
      `UPDATE task_files
       SET retry_count = 0, next_retry_at = NULL, error_message = NULL,
           status = CASE
             WHEN source_status = 'present' AND status != 'completed' THEN 'pending'
             ELSE status
           END,
           updated_at = ?
       WHERE task_id = ?`
    ).run((/* @__PURE__ */ new Date()).toISOString(), id);
    this.updateStatus(id, "pending");
  }
  skip(id, reason = "用户跳过") {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const transaction = db2.transaction(() => {
      db2.prepare(
        `UPDATE tasks
         SET status = 'skipped', error_message = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(reason, now, now, id);
      db2.prepare(
        `UPDATE task_destinations
         SET status = CASE WHEN status IN ('completed', 'synced') THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status IN ('completed', 'synced') THEN error_message ELSE ? END,
             completed_at = COALESCE(completed_at, ?), updated_at = ?
         WHERE task_id = ?`
      ).run(reason, now, now, id);
      db2.prepare(
        `UPDATE task_file_destinations
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status = 'completed' THEN error_message ELSE ? END,
             updated_at = ?
         WHERE task_file_id IN (SELECT id FROM task_files WHERE task_id = ?)`
      ).run(reason, now, id);
      db2.prepare(
        `UPDATE task_files
         SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
             error_message = CASE WHEN status = 'completed' THEN error_message ELSE ? END,
             next_retry_at = NULL, updated_at = ?
         WHERE task_id = ?`
      ).run(reason, now, id);
    });
    transaction();
  }
  restore(id) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const transaction = db2.transaction(() => {
      db2.prepare(
        `UPDATE tasks
         SET status = 'scanning', error_message = NULL, completed_at = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, id);
      db2.prepare(
        `UPDATE task_destinations
         SET status = CASE WHEN status = 'skipped' THEN 'pending' ELSE status END,
             error_message = NULL,
             completed_at = CASE WHEN status = 'skipped' THEN NULL ELSE completed_at END,
             updated_at = ?
         WHERE task_id = ?`
      ).run(now, id);
      db2.prepare(
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
      ).run(id, now, id);
      db2.prepare(
        `UPDATE task_files
         SET status = CASE
               WHEN status = 'skipped' AND source_status = 'present' THEN 'pending'
               ELSE status
             END,
             retry_count = 0, next_retry_at = NULL, error_message = NULL,
             updated_at = ?
         WHERE task_id = ?`
      ).run(now, id);
    });
    transaction();
  }
  updateProgress(id, uploadedFiles, uploadedBytes) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      "UPDATE tasks SET uploaded_files = ?, uploaded_bytes = ?, updated_at = ? WHERE id = ?"
    ).run(uploadedFiles, uploadedBytes, now, id);
  }
  setTotals(id, totalFiles, totalBytes) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      "UPDATE tasks SET total_files = ?, total_bytes = ?, updated_at = ? WHERE id = ?"
    ).run(totalFiles, totalBytes, now, id);
  }
  // ---- task_files ----
  createFile(taskId, relativePath, fileSize, mtimeMs = 0) {
    const db2 = getDb();
    const id = uuid.v4();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      `INSERT INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    ).run(id, taskId, relativePath, fileSize, mtimeMs, now, now, now);
    return rowToTaskFile(db2.prepare("SELECT * FROM task_files WHERE id = ?").get(id));
  }
  bulkCreateFiles(taskId, files) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const stmt = db2.prepare(
      `INSERT OR IGNORE INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    );
    const transaction = db2.transaction(() => {
      for (const f of files) {
        stmt.run(
          uuid.v4(),
          taskId,
          f.relativePath,
          f.fileSize,
          f.mtimeMs || 0,
          now,
          now,
          now
        );
      }
    });
    transaction();
  }
  listFiles(taskId, status) {
    const db2 = getDb();
    if (status) {
      return db2.prepare("SELECT * FROM task_files WHERE task_id = ? AND status = ?").all(taskId, status).map(rowToTaskFile);
    }
    return db2.prepare("SELECT * FROM task_files WHERE task_id = ?").all(taskId).map(rowToTaskFile);
  }
  listFileDetails(taskId) {
    const files = this.listFiles(taskId);
    const destinations = getTaskDestinationRepo().listFileTargets(taskId);
    const destinationsByFile = /* @__PURE__ */ new Map();
    for (const destination of destinations) {
      const list = destinationsByFile.get(destination.taskFileId) || [];
      list.push(destination);
      destinationsByFile.set(destination.taskFileId, list);
    }
    return files.map((file) => ({
      ...file,
      destinations: (destinationsByFile.get(file.id) || []).map(({ taskId: _taskId, relativePath: _path, fileSize: _size, ...destination }) => destination)
    }));
  }
  reconcileFiles(taskId, files, requiredStableChecks) {
    const db2 = getDb();
    const task = this.getById(taskId);
    if (!task || task.status === "skipped" || task.status === "paused") {
      return {
        changed: false,
        readyFiles: 0,
        unstableFiles: 0,
        failedFiles: 0,
        skippedFiles: 0
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existingRows = db2.prepare(
      "SELECT * FROM task_files WHERE task_id = ?"
    ).all(taskId);
    const existing = new Map(
      existingRows.map((row) => [row.relative_path, rowToTaskFile(row)])
    );
    const seen = /* @__PURE__ */ new Set();
    let changed = false;
    const insert = db2.prepare(
      `INSERT INTO task_files (
        id, task_id, relative_path, file_size, status, mtime_ms,
        last_seen_at, source_status, stable_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 'present', 1, ?, ?)`
    );
    const updateChanged = db2.prepare(
      `UPDATE task_files
       SET file_size = ?, mtime_ms = ?, last_seen_at = ?, source_status = 'present',
           stable_count = 1, status = 'pending', error_message = NULL,
           retry_count = 0, next_retry_at = NULL, updated_at = ?
       WHERE id = ?`
    );
    const updateStable = db2.prepare(
      `UPDATE task_files
       SET last_seen_at = ?, source_status = 'present',
           stable_count = MIN(stable_count + 1, ?), updated_at = ?
       WHERE id = ?`
    );
    const resetTargets = db2.prepare(
      `UPDATE task_file_destinations
       SET status = 'pending', object_key = NULL, upload_id = NULL,
           error_message = NULL, updated_at = ?
       WHERE task_file_id = ? AND status != 'uploading'`
    );
    const markFileMissing = db2.prepare(
      `UPDATE task_files
       SET source_status = 'missing',
           status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
           error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源文件已删除' END,
           next_retry_at = NULL, updated_at = ?
       WHERE id = ?`
    );
    const markTargetsMissing = db2.prepare(
      `UPDATE task_file_destinations
       SET status = CASE WHEN status = 'completed' THEN status ELSE 'skipped' END,
           error_message = CASE WHEN status = 'completed' THEN error_message ELSE '源文件已删除' END,
           updated_at = ?
       WHERE task_file_id = ? AND status != 'uploading'`
    );
    const transaction = db2.transaction(() => {
      for (const file of files) {
        seen.add(file.relativePath);
        const current = existing.get(file.relativePath);
        if (!current) {
          insert.run(
            uuid.v4(),
            taskId,
            file.relativePath,
            file.size,
            file.mtimeMs,
            now,
            now,
            now
          );
          changed = true;
          continue;
        }
        const fileChanged = current.fileSize !== file.size || current.mtimeMs !== file.mtimeMs || current.sourceStatus === "missing";
        if (fileChanged) {
          updateChanged.run(file.size, file.mtimeMs, now, now, current.id);
          resetTargets.run(now, current.id);
          changed = true;
        } else if (current.stableCount < Math.max(1, requiredStableChecks)) {
          updateStable.run(
            now,
            Math.max(1, requiredStableChecks),
            now,
            current.id
          );
        }
      }
      for (const current of existing.values()) {
        if (seen.has(current.relativePath) || current.sourceStatus === "missing") continue;
        markFileMissing.run(now, current.id);
        markTargetsMissing.run(now, current.id);
        changed = true;
      }
    });
    transaction();
    getTaskDestinationRepo().ensureForTaskFiles(taskId);
    const counts = db2.prepare(
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
    );
    db2.prepare(
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
    );
    for (const destination of getTaskDestinationRepo().listByTask(taskId)) {
      const destinationRepo = getTaskDestinationRepo();
      destinationRepo.recalculateProgress(taskId, destination.provider);
      const summary = destinationRepo.summarizeFileTargets(
        taskId,
        destination.provider,
        now
      );
      if (summary.failed > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          "failed",
          "存在需要处理的上传失败文件"
        );
      } else if (summary.pending > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          summary.retryWaiting > 0 ? "retrying" : "pending"
        );
      } else if (summary.total > 0) {
        destinationRepo.updateStatus(
          taskId,
          destination.provider,
          task.sourceType === "local" && task.dayFolderId ? "synced" : "completed"
        );
      }
    }
    const latest = this.getById(taskId);
    if (latest && latest.status !== "uploading") {
      if ((counts.failed_files || 0) > 0) {
        this.updateStatus(taskId, "failed", "存在需要处理的上传失败文件");
      } else if ((counts.ready_files || 0) > 0) {
        this.updateStatus(taskId, "pending");
      } else if ((counts.retry_waiting_files || 0) > 0) {
        this.updateStatus(taskId, "retrying");
      } else if ((counts.unstable_files || 0) > 0) {
        this.updateStatus(taskId, "scanning");
      } else {
        this.updateStatus(
          taskId,
          task.sourceType === "local" && task.dayFolderId ? "synced" : "completed"
        );
      }
    }
    return {
      changed,
      readyFiles: counts.ready_files || 0,
      unstableFiles: counts.unstable_files || 0,
      failedFiles: counts.failed_files || 0,
      skippedFiles: counts.skipped_files || 0
    };
  }
  markFileChanged(fileId, fileSize, mtimeMs) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const transaction = db2.transaction(() => {
      db2.prepare(
        `UPDATE task_files
         SET file_size = ?, mtime_ms = ?, stable_count = 1,
             status = 'pending', source_status = 'present',
             error_message = NULL, retry_count = 0, next_retry_at = NULL,
             last_seen_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(fileSize, mtimeMs, now, now, fileId);
      db2.prepare(
        `UPDATE task_file_destinations
         SET status = 'pending', object_key = NULL, upload_id = NULL,
             error_message = NULL, updated_at = ?
         WHERE task_file_id = ?`
      ).run(now, fileId);
    });
    transaction();
  }
  scheduleRetry(fileId, errorMessage, nextRetryAt) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    getDb().prepare(
      `UPDATE task_files
       SET status = 'pending', retry_count = retry_count + 1,
           next_retry_at = ?, error_message = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextRetryAt, errorMessage, now, fileId);
    const row = getDb().prepare(
      "SELECT retry_count FROM task_files WHERE id = ?"
    ).get(fileId);
    return row.retry_count;
  }
  clearRetry(fileId) {
    getDb().prepare(
      `UPDATE task_files
       SET retry_count = 0, next_retry_at = NULL, error_message = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run((/* @__PURE__ */ new Date()).toISOString(), fileId);
  }
  recalculateProgress(taskId) {
    const row = getDb().prepare(
      `SELECT
         COUNT(*) AS total_files,
         COALESCE(SUM(file_size), 0) AS total_bytes,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS uploaded_files,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END), 0) AS uploaded_bytes
       FROM task_files
       WHERE task_id = ?`
    ).get(taskId);
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
      (/* @__PURE__ */ new Date()).toISOString(),
      taskId
    );
  }
  updateFileStatus(fileId, status, ossKey, uploadId, errorMessage) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      "UPDATE task_files SET status = ?, oss_key = COALESCE(?, oss_key), upload_id = COALESCE(?, upload_id), error_message = ?, updated_at = ? WHERE id = ?"
    ).run(status, ossKey || null, uploadId || null, errorMessage || null, now, fileId);
  }
  getUnfinishedTasks() {
    const db2 = getDb();
    return db2.prepare(
      `SELECT * FROM tasks
       WHERE status IN ('pending', 'uploading', 'scanning', 'retrying', 'failed', 'paused')
       ORDER BY created_at ASC`
    ).all().map(rowToTask);
  }
  getCompletedForCleanup(retentionDays) {
    const db2 = getDb();
    const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
    return db2.prepare(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND (source_type = 'rsync' OR (source_type = 'local' AND day_folder_id IS NULL))
         AND completed_at IS NOT NULL AND completed_at < ?
       ORDER BY completed_at ASC`
    ).all(cutoff).map(rowToTask);
  }
}
let instance$f = null;
function getTaskRepo() {
  if (!instance$f) instance$f = new TaskRepo();
  return instance$f;
}
const DEFAULT_SETTINGS = {
  scan: {
    directories: [],
    intervalSeconds: 30
  },
  upload: {
    maxConcurrentTasks: 4,
    maxFilesPerTask: 12,
    maxConcurrentUploads: 24,
    multipartThreshold: 100 * 1024 * 1024,
    // 100MB
    startAfterTime: "20:30",
    endBeforeTime: "23:59"
  },
  cloud: {
    targetMode: "aliyun"
  },
  oss: {
    endpoint: "",
    bucket: "",
    region: "",
    prefix: "",
    accessKeyId: "",
    accessKeySecret: ""
  },
  tencentS3: {
    endpoint: "",
    bucket: "",
    region: "",
    prefix: "",
    accessKeyId: "",
    accessKeySecret: "",
    allowInsecureTls: false
  },
  filter: {
    whitelist: [],
    blacklist: [],
    regex: [],
    suffixes: [".jpg", ".jpeg", ".png", ".bmp", ".csv", ".json", ".log", ".txt"]
  },
  webhook: {
    url: "",
    headers: {},
    enabled: false
  },
  hotkey: "CommandOrControl+Shift+U",
  stability: {
    checkIntervalMs: 5e3,
    checkCount: 2
  },
  log: {
    directory: "",
    // 空字符串表示使用默认 userData/logs
    maxDays: 30
  },
  dataCollect: {
    enabled: false
  },
  cleanup: {
    enabled: false,
    retentionDays: 7
  }
};
const MARKER_FILES = {
  TMP_UPLOAD: "tmp_upload.json",
  PROCESS_TASK: "process_task.json",
  DAY_UPLOAD: "day_upload.json"
};
function normalizeSuffixes(suffixes) {
  const normalized = suffixes.map((suffix) => suffix.trim().toLowerCase()).filter(Boolean).map((suffix) => suffix.startsWith(".") ? suffix : `.${suffix}`);
  const unique = Array.from(new Set(normalized));
  if (!unique.includes(".csv")) unique.push(".csv");
  return unique;
}
function normalizeScanDirectories(directories) {
  return Array.from(
    new Set(
      directories.map((directory) => path.normalize(directory).replace(/[\\/]+$/, "")).filter(Boolean).map(
        (directory) => isDateFolderName(path.basename(directory)) ? path.dirname(directory) : directory
      )
    )
  );
}
class SettingsRepo {
  get(key) {
    const db2 = getDb();
    const row = db2.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value);
      if (key === "filter" && typeof parsed === "object" && parsed !== null && "suffixes" in parsed && Array.isArray(parsed.suffixes)) {
        const filter = parsed;
        filter.suffixes = normalizeSuffixes(filter.suffixes);
      }
      if (key === "scan" && typeof parsed === "object" && parsed !== null && "directories" in parsed && Array.isArray(parsed.directories)) {
        const scan = parsed;
        scan.directories = normalizeScanDirectories(scan.directories);
      }
      return parsed;
    } catch {
      return row.value;
    }
  }
  set(key, value) {
    const db2 = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let persistedValue = value;
    if (key === "filter" && typeof value === "object" && value !== null && "suffixes" in value && Array.isArray(value.suffixes)) {
      const filter = value;
      persistedValue = {
        ...filter,
        suffixes: normalizeSuffixes(filter.suffixes)
      };
    }
    if (key === "scan" && typeof value === "object" && value !== null && "directories" in value && Array.isArray(value.directories)) {
      const scan = value;
      persistedValue = {
        ...scan,
        directories: normalizeScanDirectories(scan.directories)
      };
    }
    const serialized = typeof persistedValue === "string" ? persistedValue : JSON.stringify(persistedValue);
    db2.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?"
    ).run(key, serialized, now, serialized, now);
  }
  getAll() {
    const settings = { ...DEFAULT_SETTINGS };
    const keys = [
      { section: "scan", key: "scan" },
      { section: "upload", key: "upload" },
      { section: "cloud", key: "cloud" },
      { section: "oss", key: "oss" },
      { section: "tencentS3", key: "tencentS3" },
      { section: "filter", key: "filter" },
      { section: "webhook", key: "webhook" },
      { section: "stability", key: "stability" },
      { section: "log", key: "log" },
      { section: "dataCollect", key: "dataCollect" },
      { section: "cleanup", key: "cleanup" }
    ];
    for (const { section, key } of keys) {
      const val = this.get(key);
      if (val !== null) {
        const defaultSection = settings[section];
        if (typeof defaultSection === "object" && defaultSection !== null && typeof val === "object" && val !== null) {
          settings[section] = {
            ...defaultSection,
            ...val
          };
        } else {
          settings[section] = val;
        }
      }
    }
    const hotkey = this.get("hotkey");
    if (hotkey) settings.hotkey = hotkey;
    if (settings.filter && Array.isArray(settings.filter.suffixes)) {
      settings.filter.suffixes = normalizeSuffixes(settings.filter.suffixes);
    }
    return settings;
  }
  saveAll(partial) {
    const db2 = getDb();
    const transaction = db2.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        if (value !== void 0) {
          this.set(key, value);
        }
      }
    });
    transaction();
  }
}
let instance$e = null;
function getSettingsRepo() {
  if (!instance$e) instance$e = new SettingsRepo();
  return instance$e;
}
function rowToHistory(row) {
  return {
    id: row.id,
    provider: row.provider,
    folderName: row.folder_name,
    fileCount: row.total_files,
    totalBytes: row.total_bytes,
    durationSeconds: row.duration_seconds,
    status: row.status,
    completedAt: row.completed_at
  };
}
class HistoryRepo {
  list(query) {
    const db2 = getDb();
    const { page, pageSize, status, provider } = query;
    const offset = (page - 1) * pageSize;
    let where = "WHERE td.status IN ('completed', 'failed') AND td.completed_at IS NOT NULL";
    const params = [];
    if (provider) {
      where += " AND td.provider = ?";
      params.push(provider);
    }
    if (status) {
      where += " AND td.status = ?";
      params.push(status);
    }
    const countRow = db2.prepare(
      `SELECT COUNT(*) as cnt
         FROM task_destinations td
         INNER JOIN tasks t ON t.id = td.task_id ${where}`
    ).get(...params);
    const total = countRow.cnt;
    const rows = db2.prepare(
      `SELECT t.id, td.provider, t.folder_name, td.total_files, td.total_bytes,
          td.status, td.completed_at,
          CAST((julianday(td.completed_at) - julianday(td.created_at)) * 86400 AS INTEGER)
            as duration_seconds
         FROM task_destinations td
         INNER JOIN tasks t ON t.id = td.task_id
         ${where}
         ORDER BY td.completed_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    return { items: rows.map(rowToHistory), total };
  }
  clear(before) {
    const db2 = getDb();
    if (before) {
      db2.prepare("DELETE FROM tasks WHERE status IN ('completed', 'failed') AND completed_at < ?").run(before);
    } else {
      db2.prepare("DELETE FROM tasks WHERE status IN ('completed', 'failed')").run();
    }
  }
  deleteById(id) {
    const db2 = getDb();
    db2.prepare("DELETE FROM tasks WHERE id = ? AND status IN ('completed', 'failed')").run(id);
  }
}
let instance$d = null;
function getHistoryRepo() {
  if (!instance$d) instance$d = new HistoryRepo();
  return instance$d;
}
function normalizeFolderPath(p) {
  return path.normalize(p).replace(/[\\/]+$/, "");
}
function rowToRecord(row) {
  let childFolders = [];
  try {
    const parsed = JSON.parse(row.child_folders_json || "[]");
    if (Array.isArray(parsed)) {
      childFolders = parsed.filter((value) => typeof value === "string");
    }
  } catch {
    childFolders = [];
  }
  return {
    id: row.id,
    folderPath: row.folder_path,
    folderName: row.folder_name,
    date: row.date_value,
    status: row.status,
    totalChildren: row.total_children,
    completedChildren: row.completed_children,
    totalFiles: row.total_files,
    uploadedFiles: row.uploaded_files,
    totalBytes: row.total_bytes,
    uploadedBytes: row.uploaded_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    ignored: Boolean(row.ignored),
    childFolders
  };
}
class DayFolderRepo {
  ensure(folderPath, dateName) {
    const existing = this.getRecordByPath(folderPath);
    if (existing) return existing;
    const db2 = getDb();
    const id = uuid.v4();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const normalizedPath = normalizeFolderPath(folderPath);
    db2.prepare(
      `INSERT INTO day_folders (
        id, folder_path, folder_name, date_value, status, child_folders_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'collecting', '[]', ?, ?)`
    ).run(id, normalizedPath, dateName, dateName, now, now);
    return this.getById(id);
  }
  getById(id) {
    const record = this.getRecordById(id);
    return record ? this.toSummary(record) : null;
  }
  getByPath(folderPath) {
    const record = this.getRecordByPath(folderPath);
    return record ? this.toSummary(record) : null;
  }
  list(query = {}) {
    const db2 = getDb();
    const conditions = [];
    const params = [];
    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    } else if (query.includeCompleted === false) {
      conditions.push("status NOT IN ('completed', 'completed_with_skips')");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(query.limit || 100, 1e3));
    const rows = db2.prepare(
      `SELECT * FROM day_folders ${where}
       ORDER BY date_value DESC, updated_at DESC LIMIT ?`
    ).all(...params, limit);
    return rows.map((row) => this.toSummary(rowToRecord(row)));
  }
  updateDiscovery(id, childFolders) {
    const db2 = getDb();
    const existing = this.getRecordById(id);
    const normalizedChildren = Array.from(
      /* @__PURE__ */ new Set([...existing?.childFolders || [], ...childFolders])
    ).sort();
    db2.prepare(
      `UPDATE day_folders
       SET child_folders_json = ?, total_children = ?, updated_at = ?
       WHERE id = ?`
    ).run(JSON.stringify(normalizedChildren), normalizedChildren.length, (/* @__PURE__ */ new Date()).toISOString(), id);
  }
  recalculate(id, now = /* @__PURE__ */ new Date()) {
    const record = this.getRecordById(id);
    if (!record) return null;
    const tasks = getTaskRepo().listByDayFolder(id);
    const latestByPath = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      const normalizedPath = normalizeFolderPath(task.folderPath);
      if (!latestByPath.has(normalizedPath)) {
        latestByPath.set(normalizedPath, task);
      }
    }
    const childTasks = record.childFolders.map(
      (folderName) => latestByPath.get(normalizeFolderPath(path.join(record.folderPath, folderName))) || null
    );
    const childStatuses = childTasks.map((task) => task?.status || null);
    const status = record.ignored ? "completed_with_skips" : determineDayFolderStatus(record.date, childStatuses, now);
    const completedChildren = childTasks.filter(
      (task) => task?.status === "completed" || task?.status === "synced" || task?.status === "skipped"
    ).length;
    const totalFiles = childTasks.reduce((sum, task) => sum + (task?.totalFiles || 0), 0);
    const uploadedFiles = childTasks.reduce((sum, task) => sum + (task?.uploadedFiles || 0), 0);
    const totalBytes = childTasks.reduce((sum, task) => sum + (task?.totalBytes || 0), 0);
    const uploadedBytes = childTasks.reduce((sum, task) => sum + (task?.uploadedBytes || 0), 0);
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const completedAt = status === "completed" || status === "completed_with_skips" ? record.completedAt || updatedAt : null;
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
    );
    return this.getById(id);
  }
  getChildTasks(id) {
    const record = this.getRecordById(id);
    if (!record) return [];
    const expectedPaths = new Set(
      record.childFolders.map((name) => normalizeFolderPath(path.join(record.folderPath, name)))
    );
    const latestByPath = /* @__PURE__ */ new Map();
    for (const task of getTaskRepo().listByDayFolder(id)) {
      const path2 = normalizeFolderPath(task.folderPath);
      if (expectedPaths.has(path2) && !latestByPath.has(path2)) {
        latestByPath.set(path2, task);
      }
    }
    return record.childFolders.map((name) => latestByPath.get(normalizeFolderPath(path.join(record.folderPath, name)))).filter((task) => Boolean(task));
  }
  getCompletedForCleanup(retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
    const rows = getDb().prepare(
      `SELECT * FROM day_folders
       WHERE status IN ('completed', 'completed_with_skips')
         AND completed_at IS NOT NULL AND completed_at < ?
       ORDER BY completed_at ASC`
    ).all(cutoff);
    return rows.map((row) => this.toSummary(rowToRecord(row)));
  }
  clearCompleted(before) {
    const db2 = getDb();
    if (before) {
      db2.prepare(
        "DELETE FROM day_folders WHERE status IN ('completed', 'completed_with_skips') AND completed_at < ?"
      ).run(before);
    } else {
      db2.prepare(
        "DELETE FROM day_folders WHERE status IN ('completed', 'completed_with_skips')"
      ).run();
    }
  }
  deleteCompleted(id) {
    getDb().prepare(
      "DELETE FROM day_folders WHERE id = ? AND status IN ('completed', 'completed_with_skips')"
    ).run(id);
  }
  setIgnored(id, ignored) {
    getDb().prepare(
      `UPDATE day_folders
       SET ignored = ?, updated_at = ?
       WHERE id = ?`
    ).run(ignored ? 1 : 0, (/* @__PURE__ */ new Date()).toISOString(), id);
  }
  getRecordById(id) {
    const row = getDb().prepare("SELECT * FROM day_folders WHERE id = ?").get(id);
    return row ? rowToRecord(row) : null;
  }
  getRecordByPath(folderPath) {
    const normalizedPath = normalizeFolderPath(folderPath);
    const row = getDb().prepare("SELECT * FROM day_folders WHERE folder_path = ?").get(normalizedPath);
    return row ? rowToRecord(row) : null;
  }
  toSummary(record) {
    const { childFolders: _childFolders, ...summary } = record;
    return summary;
  }
}
let instance$c = null;
function getDayFolderRepo() {
  if (!instance$c) instance$c = new DayFolderRepo();
  return instance$c;
}
const MAX_ITEMS = 100;
class DataCollectService {
  cache = /* @__PURE__ */ new Map();
  getAll() {
    return Array.from(this.cache.values());
  }
  getByPath(folderPath) {
    return this.cache.get(folderPath) || null;
  }
  /**
   * 采集单个数据文件夹的元信息
   * 前提：文件夹中必须含有 welding_state/weld_signal.csv
   * @returns DataCollectInfo 或 null（不满足数采条件时）
   */
  collectDataInfo(folderPath) {
    const weldSignalPath = path.join(folderPath, "welding_state", "weld_signal.csv");
    if (!fs.existsSync(weldSignalPath)) {
      return null;
    }
    const folderName = path.basename(folderPath);
    const dateStr = parseDateFromPath(folderPath);
    const info = {
      folderPath,
      folderName,
      date: dateStr,
      sessionTime: folderName,
      weldSignal: {
        arcStartUs: null,
        arcEndUs: null,
        arcStartTime: null,
        arcEndTime: null,
        durationSeconds: null
      },
      cameras: [],
      robotState: {
        jointStateRows: 0,
        toolPoseRows: 0,
        hasCalibration: false
      },
      controlCmd: {
        speedRows: 0,
        freqRows: 0
      },
      pointCloudCount: 0,
      depthImageCount: 0,
      annotation: {
        hasXml: false,
        dataType: null,
        qualityType: null,
        specMin: null,
        specMax: null
      },
      totalFileCount: 0,
      totalSizeBytes: 0,
      collectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const { startTime, endTime } = readWeldSignal(weldSignalPath);
      info.weldSignal.arcStartUs = startTime;
      info.weldSignal.arcEndUs = endTime;
      info.weldSignal.arcStartTime = usToTimeStr(dateStr, startTime);
      info.weldSignal.arcEndTime = usToTimeStr(dateStr, endTime);
      if (startTime !== null && endTime !== null) {
        info.weldSignal.durationSeconds = Math.round((endTime - startTime) / 1e3) / 1e3;
      }
    } catch (err) {
      log.warn("读取焊接信号失败:", err);
    }
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("camera")).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const camPath = path.join(folderPath, entry.name);
        const { tsMin, tsMax, count } = getImageTimestampRange(camPath);
        info.cameras.push({
          name: entry.name,
          imageCount: count,
          tsMinUs: tsMin,
          tsMaxUs: tsMax,
          tsMinTime: usToTimeStr(dateStr, tsMin),
          tsMaxTime: usToTimeStr(dateStr, tsMax)
        });
      }
    } catch {
    }
    const jointCsv = path.join(folderPath, "robot_state", "joint_state.csv");
    if (fs.existsSync(jointCsv)) {
      info.robotState.jointStateRows = readCsvTimestamps(jointCsv).count;
    }
    const toolCsv = path.join(folderPath, "robot_state", "tool_pose.csv");
    if (fs.existsSync(toolCsv)) {
      info.robotState.toolPoseRows = readCsvTimestamps(toolCsv).count;
    }
    const calibCsv = path.join(folderPath, "robot_state", "calibration.csv");
    info.robotState.hasCalibration = fs.existsSync(calibCsv);
    const speedCsv = path.join(folderPath, "control_cmd", "control_speed.csv");
    if (fs.existsSync(speedCsv)) {
      info.controlCmd.speedRows = readCsvTimestamps(speedCsv).count;
    }
    const freqCsv = path.join(folderPath, "control_cmd", "control_freq.csv");
    if (fs.existsSync(freqCsv)) {
      info.controlCmd.freqRows = readCsvTimestamps(freqCsv).count;
    }
    const pcDir = path.join(folderPath, "scan_point_cloud");
    info.pointCloudCount = countFiles(pcDir, ".bin") + countFiles(pcDir, ".ply");
    const depthDir = path.join(folderPath, "camera_depth");
    info.depthImageCount = countFiles(depthDir, ".jpg") + countFiles(depthDir, ".ply");
    const xmlPath = path.join(folderPath, "annotation", "segment_timestamps.xml");
    if (fs.existsSync(xmlPath)) {
      info.annotation.hasXml = true;
      try {
        const xmlContent = fs.readFileSync(xmlPath, "utf-8");
        info.annotation.dataType = extractXmlTag(xmlContent, "data_type");
        info.annotation.qualityType = extractXmlTag(xmlContent, "quality_type");
        const specMin = extractXmlTag(xmlContent, "data_spec_min");
        const specMax = extractXmlTag(xmlContent, "data_spec_max");
        if (specMin !== null) info.annotation.specMin = parseInt(specMin);
        if (specMax !== null) info.annotation.specMax = parseInt(specMax);
      } catch {
      }
    }
    const { fileCount, totalSize } = walkDirStats(folderPath);
    info.totalFileCount = fileCount;
    info.totalSizeBytes = totalSize;
    this.cache.set(folderPath, info);
    if (this.cache.size > MAX_ITEMS) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    log.info(`[数采模式] ${folderName}: 焊接${info.weldSignal.durationSeconds ?? "N/A"}s, ${info.cameras.length}相机, ${info.totalFileCount}文件`);
    return info;
  }
}
function parseDateFromPath(path2) {
  const pat = /(\d{4}-\d{2}-\d{2})/;
  const parts = path2.replace(/\\/g, "/").split("/").reverse();
  for (const part of parts) {
    const m = pat.exec(part);
    if (m) return m[1];
  }
  return null;
}
function usToTimeStr(dateStr, microseconds) {
  if (dateStr === null || microseconds === null) return null;
  try {
    const base = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    const ms = microseconds / 1e3;
    const ts = new Date(base.getTime() + ms);
    const pad = (n, d = 2) => String(n).padStart(d, "0");
    return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.${pad(ts.getMilliseconds(), 3)}`;
  } catch {
    return String(microseconds);
  }
}
function readWeldSignal(filePath) {
  let startTime = null;
  let endTime = null;
  const content = fs.readFileSync(filePath, "utf-8");
  const pat = /^\s*(\d+)\s+[^:]*:\s*(true|false)\s*$/i;
  const tsPat = /(\d+)/;
  const boolPat = /(true|false)/i;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let ts;
    let valTrue;
    const m = pat.exec(line);
    if (m) {
      ts = parseInt(m[1]);
      valTrue = m[2].toLowerCase() === "true";
    } else {
      const tsMatch = tsPat.exec(line);
      const boolMatch = boolPat.exec(line);
      if (!tsMatch || !boolMatch) continue;
      ts = parseInt(tsMatch[1]);
      valTrue = boolMatch[1].toLowerCase() === "true";
    }
    if (valTrue) {
      if (startTime === null) startTime = ts;
    } else {
      endTime = ts;
    }
  }
  return { startTime, endTime };
}
function readCsvTimestamps(filePath) {
  let tsMin = null;
  let tsMax = null;
  let count = 0;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/[,\s]+/);
      if (!parts[0]) continue;
      const ts = parseInt(parts[0]);
      if (isNaN(ts)) continue;
      count++;
      if (tsMin === null || ts < tsMin) tsMin = ts;
      if (tsMax === null || ts > tsMax) tsMax = ts;
    }
  } catch {
  }
  return { tsMin, tsMax, count };
}
function countFiles(folderPath, ext) {
  if (!fs.existsSync(folderPath)) return 0;
  try {
    const entries = fs.readdirSync(folderPath);
    let count = 0;
    for (const entry of entries) {
      if (ext && !entry.toLowerCase().endsWith(ext)) continue;
      try {
        const stat = fs.statSync(path.join(folderPath, entry));
        if (stat.isFile()) count++;
      } catch {
      }
    }
    return count;
  } catch {
    return 0;
  }
}
function getImageTimestampRange(folderPath) {
  let tsMin = null;
  let tsMax = null;
  let count = 0;
  if (!fs.existsSync(folderPath)) return { tsMin, tsMax, count };
  try {
    const entries = fs.readdirSync(folderPath);
    for (const filename of entries) {
      if (!filename.toLowerCase().endsWith(".jpg")) continue;
      const nameNoExt = filename.slice(0, filename.lastIndexOf("."));
      const ts = parseInt(nameNoExt);
      if (isNaN(ts)) continue;
      count++;
      if (tsMin === null || ts < tsMin) tsMin = ts;
      if (tsMax === null || ts > tsMax) tsMax = ts;
    }
  } catch {
  }
  return { tsMin, tsMax, count };
}
function extractXmlTag(xml, tagName) {
  const re = new RegExp(`<${tagName}>\\s*([^<]*)\\s*</${tagName}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}
function walkDirStats(dirPath) {
  let fileCount = 0;
  let totalSize = 0;
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          fileCount++;
          try {
            totalSize += fs.statSync(fullPath).size;
          } catch {
          }
        }
      }
    } catch {
    }
  }
  walk(dirPath);
  return { fileCount, totalSize };
}
let instance$b = null;
function getDataCollectService() {
  if (!instance$b) instance$b = new DataCollectService();
  return instance$b;
}
function readTmpUpload(folderPath) {
  const filePath = path.join(folderPath, MARKER_FILES.TMP_UPLOAD);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function writeTmpUpload(folderPath, marker) {
  const filePath = path.join(folderPath, MARKER_FILES.TMP_UPLOAD);
  fs.writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf-8");
}
function readProcessTask(folderPath) {
  const filePath = path.join(folderPath, MARKER_FILES.PROCESS_TASK);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function writeProcessTask(folderPath, marker) {
  const filePath = path.join(folderPath, MARKER_FILES.PROCESS_TASK);
  fs.writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf-8");
}
function writeDayUpload(folderPath, marker) {
  const filePath = path.join(folderPath, MARKER_FILES.DAY_UPLOAD);
  fs.writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf-8");
}
function removeDayUpload(folderPath) {
  const filePath = path.join(folderPath, MARKER_FILES.DAY_UPLOAD);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}
class DayFolderService {
  refresh(dayFolderId, discoveredChildren) {
    const repo = getDayFolderRepo();
    if (discoveredChildren) {
      repo.updateDiscovery(dayFolderId, discoveredChildren);
    }
    const summary = repo.recalculate(dayFolderId);
    if (!summary) return null;
    try {
      if ((summary.status === "completed" || summary.status === "completed_with_skips") && summary.completedAt) {
        const children = repo.getChildTasks(dayFolderId);
        const marker = {
          version: 1,
          dayFolderId: summary.id,
          date: summary.date,
          folderPath: summary.folderPath,
          status: summary.status,
          totalChildren: summary.totalChildren,
          totalFiles: summary.totalFiles,
          uploadedFiles: summary.uploadedFiles,
          totalBytes: summary.totalBytes,
          uploadedBytes: summary.uploadedBytes,
          children: children.map((task) => ({
            folderName: task.folderName,
            folderPath: task.folderPath,
            taskId: task.id,
            completedAt: task.completedAt,
            destinations: task.destinations.map((destination) => ({
              provider: destination.provider,
              status: destination.status,
              completedAt: destination.completedAt
            }))
          })),
          completedAt: summary.completedAt
        };
        writeDayUpload(summary.folderPath, marker);
      } else {
        removeDayUpload(summary.folderPath);
      }
    } catch (err) {
      log.error("更新日期目录标记失败:", summary.folderPath, err);
    }
    this.broadcast(summary);
    return summary;
  }
  refreshForTask(taskId) {
    const task = getTaskRepo().getById(taskId);
    if (!task?.dayFolderId) return null;
    return this.refresh(task.dayFolderId);
  }
  broadcast(summary) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.DAY_FOLDER_EVENT, summary);
    }
  }
}
let instance$a = null;
function getDayFolderService() {
  if (!instance$a) instance$a = new DayFolderService();
  return instance$a;
}
class CleanupService {
  timer = null;
  pendingRun = null;
  running = false;
  start() {
    if (this.timer) return;
    this.scheduleCleanup(5 * 60 * 1e3);
    this.timer = setInterval(() => void this.cleanup(), 36e5);
    log.info("自动清理服务已启动");
  }
  stop() {
    if (this.pendingRun) {
      clearTimeout(this.pendingRun);
      this.pendingRun = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("自动清理服务已停止");
  }
  scheduleCleanup(delayMs = 0) {
    if (this.pendingRun) {
      clearTimeout(this.pendingRun);
    }
    this.pendingRun = setTimeout(() => {
      this.pendingRun = null;
      void this.cleanup();
    }, Math.max(0, delayMs));
  }
  async cleanup() {
    if (this.running) return;
    this.running = true;
    try {
      const settings = getSettingsRepo();
      const config = settings.get("cleanup");
      if (!config?.enabled) return;
      const retentionDays = this.normalizeRetentionDays(config);
      const taskRepo = getTaskRepo();
      const dayFolderRepo = getDayFolderRepo();
      const tasks = taskRepo.getCompletedForCleanup(retentionDays);
      const dayFolders = dayFolderRepo.getCompletedForCleanup(retentionDays);
      if (tasks.length === 0 && dayFolders.length === 0) return;
      log.info(
        `自动清理: 发现 ${dayFolders.length} 个日期目录和 ${tasks.length} 个独立任务可清理 (保留天数: ${retentionDays})`
      );
      let cleaned = 0;
      for (const dayFolder of dayFolders) {
        try {
          if (!fs.existsSync(dayFolder.folderPath)) {
            continue;
          }
          await promises.rm(dayFolder.folderPath, { recursive: true, force: true });
          cleaned++;
          log.info(
            `自动清理: 已删除日期目录 ${dayFolder.folderPath} (日期目录ID: ${dayFolder.id}, 完成于: ${dayFolder.completedAt})`
          );
        } catch (err) {
          log.error(`自动清理日期目录失败: ${dayFolder.folderPath}`, err);
        }
      }
      for (const task of tasks) {
        try {
          if (!fs.existsSync(task.folderPath)) {
            continue;
          }
          await promises.rm(task.folderPath, { recursive: true, force: true });
          cleaned++;
          log.info(`自动清理: 已删除 ${task.folderPath} (任务ID: ${task.id}, 完成于: ${task.completedAt})`);
        } catch (err) {
          log.error(`自动清理失败: ${task.folderPath}`, err);
        }
      }
      if (cleaned > 0) {
        log.info(`自动清理完成: 共删除 ${cleaned} 个文件夹`);
      }
    } catch (err) {
      log.error("自动清理服务异常:", err);
    } finally {
      this.running = false;
    }
  }
  normalizeRetentionDays(config) {
    if (!Number.isFinite(config.retentionDays)) {
      return 7;
    }
    return Math.max(0, Math.floor(config.retentionDays));
  }
}
let instance$9 = null;
function getCleanupService() {
  if (!instance$9) instance$9 = new CleanupService();
  return instance$9;
}
class TaskQueueService extends events.EventEmitter {
  runningTasks = /* @__PURE__ */ new Map();
  processTimer = null;
  initialProcessTimer = null;
  taskRunner = null;
  setTaskRunner(runner) {
    this.taskRunner = runner;
  }
  start() {
    if (this.processTimer) return;
    this.processTimer = setInterval(() => void this.processQueue(), 2e3);
    this.initialProcessTimer = setTimeout(() => {
      this.initialProcessTimer = null;
      void this.processQueue();
    }, 1500);
    log.info("任务队列已启动");
  }
  stop() {
    if (this.initialProcessTimer) {
      clearTimeout(this.initialProcessTimer);
      this.initialProcessTimer = null;
    }
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    log.info("任务队列已停止");
  }
  getRunningCount() {
    return this.runningTasks.size;
  }
  isTaskRunning(taskId) {
    return this.runningTasks.has(taskId);
  }
  cancelRunningTask(taskId) {
    const running = this.runningTasks.get(taskId);
    if (running) {
      running.cancel();
      this.runningTasks.delete(taskId);
    }
  }
  async processQueue() {
    if (!this.taskRunner) return;
    const settings = getSettingsRepo();
    const uploadConfig = settings.get("upload");
    if (!this.isWithinUploadWindow(uploadConfig?.startAfterTime, uploadConfig?.endBeforeTime)) return;
    const maxConcurrent = uploadConfig?.maxConcurrentTasks || 4;
    const taskRepo = getTaskRepo();
    const availableSlots = maxConcurrent - this.runningTasks.size;
    if (availableSlots <= 0) return;
    const pendingTasks = taskRepo.listRunnable();
    const eligibleTasks = pendingTasks.filter(
      (task) => this.isTaskEligibleForCurrentStartCycle(task, uploadConfig?.startAfterTime)
    );
    const toRun = eligibleTasks.slice(0, Math.min(availableSlots, 1));
    for (const task of toRun) {
      this.executeTask(task);
    }
  }
  async executeTask(task) {
    const taskRepo = getTaskRepo();
    const controller = new AbortController();
    this.runningTasks.set(task.id, { cancel: () => controller.abort() });
    try {
      taskRepo.updateStatus(task.id, "uploading");
      this.emit("task:status-change", {
        taskId: task.id,
        oldStatus: task.status,
        newStatus: "uploading"
      });
      const finalStatus = await this.taskRunner(task, controller.signal);
      if (!controller.signal.aborted) {
        taskRepo.updateStatus(task.id, finalStatus);
        getDayFolderService().refreshForTask(task.id);
        if (finalStatus === "completed") {
          getCleanupService().scheduleCleanup();
        }
        this.emit("task:status-change", {
          taskId: task.id,
          oldStatus: "uploading",
          newStatus: finalStatus
        });
        log.info(`任务状态更新为 ${finalStatus}:`, task.folderPath);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const errMsg = err instanceof Error ? err.message : String(err);
        taskRepo.updateStatus(task.id, "failed", errMsg);
        getTaskDestinationRepo().updateIncompleteStatuses(
          task.id,
          "failed",
          errMsg
        );
        getDayFolderService().refreshForTask(task.id);
        this.emit("task:status-change", {
          taskId: task.id,
          oldStatus: "uploading",
          newStatus: "failed"
        });
        log.error("任务失败:", task.folderPath, errMsg);
      }
    } finally {
      this.runningTasks.delete(task.id);
    }
  }
  isWithinUploadWindow(startAfterTime, endBeforeTime) {
    const startMinutes = this.parseMinutes(startAfterTime);
    const endMinutes = this.parseMinutes(endBeforeTime);
    const now = /* @__PURE__ */ new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (startMinutes === null && endMinutes === null) return true;
    if (startMinutes !== null && endMinutes === null) {
      return currentMinutes >= startMinutes;
    }
    if (startMinutes === null && endMinutes !== null) {
      return currentMinutes <= endMinutes;
    }
    if (startMinutes === null || endMinutes === null) return true;
    if (startMinutes === endMinutes) return true;
    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  parseMinutes(time) {
    if (!time || !time.trim()) return null;
    const match = time.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }
  isTaskEligibleForCurrentStartCycle(task, startAfterTime) {
    const startMinutes = this.parseMinutes(startAfterTime);
    if (startMinutes === null) return true;
    const cycleStart = this.getCurrentStartCycleStart(startMinutes, /* @__PURE__ */ new Date());
    const createdAtMs = new Date(task.createdAt).getTime();
    if (Number.isNaN(createdAtMs)) return true;
    return createdAtMs <= cycleStart.getTime();
  }
  getCurrentStartCycleStart(startMinutes, now) {
    const todayStart = new Date(now);
    todayStart.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    if (now.getTime() >= todayStart.getTime()) {
      return todayStart;
    }
    const previousStart = new Date(todayStart);
    previousStart.setDate(previousStart.getDate() - 1);
    return previousStart;
  }
}
let instance$8 = null;
function getTaskQueueService() {
  if (!instance$8) instance$8 = new TaskQueueService();
  return instance$8;
}
class FileFilterService {
  rules;
  constructor(rules) {
    this.rules = rules;
  }
  updateRules(rules) {
    this.rules = rules;
  }
  /**
   * 判断单个文件是否应该被包含
   * @param relativePath 文件相对路径
   * @returns true = 包含, false = 排除
   */
  shouldInclude(relativePath) {
    const fileName = path.basename(relativePath);
    const ext = path.extname(relativePath).toLowerCase();
    if (this.rules.whitelist.length > 0) {
      for (const pattern of this.rules.whitelist) {
        if (this.matchPattern(fileName, relativePath, pattern)) {
          return true;
        }
      }
    }
    if (this.rules.blacklist.length > 0) {
      for (const pattern of this.rules.blacklist) {
        if (this.matchPattern(fileName, relativePath, pattern)) {
          return false;
        }
      }
    }
    if (this.rules.regex.length > 0) {
      for (const pattern of this.rules.regex) {
        try {
          const re = new RegExp(pattern);
          if (re.test(relativePath) || re.test(fileName)) {
            return false;
          }
        } catch {
        }
      }
    }
    if (this.rules.suffixes.length > 0) {
      return this.rules.suffixes.some((suffix) => ext === this.normalizeSuffix(suffix));
    }
    return true;
  }
  /**
   * 递归扫描文件夹，返回过滤后的文件列表
   */
  scanFolder(folderPath) {
    const results = [];
    this.walkDir(folderPath, folderPath, results);
    return results;
  }
  async scanFolderAsync(folderPath) {
    const results = [];
    await this.walkDirAsync(folderPath, folderPath, results);
    return results;
  }
  walkDir(basePath, currentPath, results) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        this.walkDir(basePath, fullPath, results);
      } else if (entry.isFile()) {
        const relativePath = fullPath.slice(basePath.length + 1);
        if (entry.name === "tmp_upload.json" || entry.name === "process_task.json" || entry.name === "day_upload.json") continue;
        if (this.shouldInclude(relativePath)) {
          const stat2 = fs.statSync(fullPath);
          results.push({
            relativePath,
            absolutePath: fullPath,
            size: stat2.size,
            mtimeMs: stat2.mtimeMs
          });
        }
      }
    }
  }
  async walkDirAsync(basePath, currentPath, results) {
    const entries = await promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        await this.walkDirAsync(basePath, fullPath, results);
      } else if (entry.isFile()) {
        const relativePath = fullPath.slice(basePath.length + 1);
        if (entry.name === "tmp_upload.json" || entry.name === "process_task.json" || entry.name === "day_upload.json") continue;
        if (!this.shouldInclude(relativePath)) continue;
        try {
          const fileStat = await promises.stat(fullPath);
          results.push({
            relativePath,
            absolutePath: fullPath,
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs
          });
        } catch {
        }
      }
    }
  }
  matchPattern(fileName, relativePath, pattern) {
    if (fileName === pattern) return true;
    if (pattern.startsWith(".") && path.extname(fileName).toLowerCase() === pattern.toLowerCase()) return true;
    if (pattern.includes("*")) {
      const regexStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
      try {
        const re = new RegExp(regexStr, "i");
        if (re.test(fileName) || re.test(relativePath)) return true;
      } catch {
      }
    }
    return false;
  }
  normalizeSuffix(suffix) {
    const trimmed = suffix.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  }
}
function discoverDayDirectories(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".") && isDateFolderName(entry.name)
  ).map((entry) => {
    const folderPath = path.join(rootDir, entry.name);
    const childFolderNames = fs.readdirSync(folderPath, { withFileTypes: true }).filter((child) => child.isDirectory() && !child.name.startsWith(".")).map((child) => child.name).sort();
    return {
      dateName: entry.name,
      folderPath,
      childFolderNames
    };
  }).sort((a, b) => a.dateName.localeCompare(b.dateName));
}
class ScannerService {
  timer = null;
  stabilityTimer = null;
  running = false;
  lastScanAt = null;
  nextScanAt = null;
  pendingDirs = /* @__PURE__ */ new Map();
  lastScanResults = null;
  watcher = null;
  scanDebounceTimer = null;
  watcherErrorHandled = false;
  lastWatcherWarningAt = 0;
  start() {
    if (this.running) return;
    this.running = true;
    const settings = getSettingsRepo();
    const scanConfig = settings.get("scan");
    const directories = scanConfig?.directories || [];
    const intervalMs = (scanConfig?.intervalSeconds || 30) * 1e3;
    this.startWatcher(directories);
    this.timer = setInterval(() => this.scan(), intervalMs);
    this.scheduleFullScan();
    const stabilityConfig = settings.get("stability");
    const checkInterval = stabilityConfig?.checkIntervalMs || 5e3;
    this.stabilityTimer = setInterval(() => this.checkStability(), checkInterval);
    log.info("扫描器已启动, 间隔:", intervalMs / 1e3, "秒");
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stabilityTimer) {
      clearInterval(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    if (this.scanDebounceTimer) {
      clearTimeout(this.scanDebounceTimer);
      this.scanDebounceTimer = null;
    }
    this.running = false;
    this.nextScanAt = null;
    log.info("扫描器已停止");
    this.broadcastStatus();
  }
  isRunning() {
    return this.running;
  }
  getStatus() {
    const settings = getSettingsRepo();
    const scanConfig = settings.get("scan");
    const stabilityConfig = settings.get("stability");
    const requiredChecks = stabilityConfig?.checkCount || 3;
    const pendingStabilityChecks = [];
    for (const pending of this.pendingDirs.values()) {
      pendingStabilityChecks.push({
        path: pending.path,
        checks: pending.checks,
        requiredChecks,
        discoveredAt: pending.discoveredAt
      });
    }
    return {
      running: this.running,
      lastScanAt: this.lastScanAt,
      nextScanAt: this.nextScanAt,
      watchedDirectories: scanConfig?.directories || [],
      pendingStabilityChecks,
      lastScanResults: this.lastScanResults
    };
  }
  triggerScan() {
    this.scan();
  }
  scan() {
    const settings = getSettingsRepo();
    const scanConfig = settings.get("scan");
    const directories = scanConfig?.directories || [];
    const intervalMs = (scanConfig?.intervalSeconds || 30) * 1e3;
    const seenChildPaths = /* @__PURE__ */ new Set();
    let scannedDirs = 0;
    let newDirsFound = 0;
    let existingDirs = 0;
    for (const rootDir of directories) {
      if (!fs.existsSync(rootDir)) {
        log.warn("扫描根目录不存在:", rootDir);
        continue;
      }
      const result = this.scanRootDirectory(rootDir, seenChildPaths);
      scannedDirs += result.scanned;
      newDirsFound += result.newFound;
      existingDirs += result.existing;
    }
    for (const pendingPath of this.pendingDirs.keys()) {
      if (!seenChildPaths.has(pendingPath)) {
        this.pendingDirs.delete(pendingPath);
      }
    }
    this.reconcileDeletedTasks(seenChildPaths, directories);
    this.lastScanAt = (/* @__PURE__ */ new Date()).toISOString();
    this.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
    this.lastScanResults = {
      scannedDirs,
      newDirsFound,
      existingDirs,
      timestamp: this.lastScanAt
    };
    this.broadcastStatus();
  }
  scanRootDirectory(rootDir, seenChildPaths) {
    let scanned = 0;
    let newFound = 0;
    let existing = 0;
    try {
      const dayDirectories = discoverDayDirectories(rootDir);
      for (const dayDirectory of dayDirectories) {
        const result = this.scanDayDirectory(
          dayDirectory.folderPath,
          dayDirectory.dateName,
          dayDirectory.childFolderNames,
          seenChildPaths
        );
        scanned += result.scanned;
        newFound += result.newFound;
        existing += result.existing;
      }
    } catch (err) {
      log.error("扫描数据根目录失败:", rootDir, err);
    }
    return { scanned, newFound, existing };
  }
  scanDayDirectory(dayFolderPath, dateName, discoveredChildNames, seenChildPaths) {
    const dayFolder = getDayFolderRepo().ensure(dayFolderPath, dateName);
    const childNames = [];
    let scanned = 0;
    let newFound = 0;
    let existing = 0;
    try {
      for (const childName of discoveredChildNames) {
        const childPath = path.join(dayFolderPath, childName);
        const uploadRelativePath = buildUploadRelativePath(dateName, childName);
        childNames.push(childName);
        seenChildPaths.add(childPath);
        scanned++;
        const existingTask = getTaskRepo().getByFolderPath(childPath);
        if (existingTask) {
          this.attachTaskToDayFolder(existingTask, dayFolder.id, uploadRelativePath);
          this.pendingDirs.delete(childPath);
          if (dayFolder.ignored && existingTask.status !== "completed" && existingTask.status !== "synced") {
            getTaskRepo().skip(existingTask.id, "用户忽略整个日期");
            this.broadcastTaskStatus(
              existingTask.id,
              existingTask.status,
              "skipped"
            );
          }
          existing++;
          continue;
        }
        const processMarker = readProcessTask(childPath);
        if (processMarker?.status === "completed") {
          this.registerLegacyCompletedDir(
            childPath,
            childName,
            dayFolder.id,
            dateName,
            processMarker,
            readTmpUpload(childPath)
          );
          existing++;
          continue;
        }
        const tmpMarker = readTmpUpload(childPath);
        if (tmpMarker) {
          const task = this.registerNewDir({
            path: childPath,
            dayFolderId: dayFolder.id,
            dateName,
            folderName: childName,
            uploadRelativePath,
            checks: 0,
            discoveredAt: tmpMarker.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
            lastSnapshot: /* @__PURE__ */ new Map(),
            uploadTargetMode: tmpMarker.metadata.uploadTargetMode,
            destinationPrefixes: tmpMarker.metadata.destinationPrefixes
          });
          if (dayFolder.ignored) {
            getTaskRepo().skip(task.id, "用户忽略整个日期");
            this.broadcastTaskStatus(task.id, task.status, "skipped");
          } else {
            this.reconcileTask(task);
          }
          existing++;
          continue;
        }
        if (!this.pendingDirs.has(childPath)) {
          log.info("发现新焊接目录, 注册持续同步任务:", childPath);
          const pending = {
            path: childPath,
            dayFolderId: dayFolder.id,
            dateName,
            folderName: childName,
            uploadRelativePath,
            checks: 0,
            discoveredAt: (/* @__PURE__ */ new Date()).toISOString(),
            lastSnapshot: this.snapshotDir(childPath)
          };
          const task = this.registerNewDir(pending);
          if (dayFolder.ignored) {
            getTaskRepo().skip(task.id, "用户忽略整个日期");
            this.broadcastTaskStatus(task.id, task.status, "skipped");
          } else {
            this.reconcileTask(task);
          }
          newFound++;
        }
      }
    } catch (err) {
      log.error("扫描日期目录失败:", dayFolderPath, err);
    }
    getDayFolderService().refresh(dayFolder.id, childNames);
    return { scanned, newFound, existing };
  }
  checkStability() {
    const today = this.formatLocalDate(/* @__PURE__ */ new Date());
    for (const task of getTaskRepo().listContinuouslyMonitored(today)) {
      this.reconcileTask(task);
    }
    this.broadcastStatus();
  }
  formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  registerNewDir(pending) {
    const settings = getSettingsRepo().getAll();
    const snapshot = pending.uploadTargetMode && pending.destinationPrefixes ? {
      mode: pending.uploadTargetMode,
      prefixes: {
        aliyun: pending.destinationPrefixes.aliyun || "",
        tencent: pending.destinationPrefixes.tencent || ""
      }
    } : getUploadTargetSnapshot(settings);
    const marker = {
      version: 2,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      folderPath: pending.path,
      metadata: {
        source: "local",
        dayFolderId: pending.dayFolderId,
        date: pending.dateName,
        uploadRelativePath: pending.uploadRelativePath,
        uploadTargetMode: snapshot.mode,
        destinationPrefixes: snapshot.prefixes
      }
    };
    writeTmpUpload(pending.path, marker);
    const task = this.ensureTaskRegistered(
      pending.path,
      pending.folderName,
      pending.dayFolderId,
      pending.uploadRelativePath,
      snapshot
    );
    log.info("焊接目录已注册为上传任务:", pending.path);
    this.collectDataInfo(pending.path);
    getDayFolderService().refresh(pending.dayFolderId);
    return task;
  }
  startWatcher(directories) {
    if (this.watcher) void this.watcher.close();
    this.watcherErrorHandled = false;
    const existingDirectories = directories.filter(
      (directory) => fs.existsSync(directory)
    );
    if (existingDirectories.length === 0) return;
    this.watcher = chokidar.watch(existingDirectories, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: false,
      // 只监听 根目录/日期目录/工作次目录 的目录结构。
      // 文件变化由稳定性检查和 30 秒全量校准处理，避免大量小文件耗尽 inotify。
      depth: 2,
      ignored: (path2, stats) => {
        const normalized = path2.replace(/\\/g, "/");
        return stats?.isFile() === true || normalized.includes("/.git/") || normalized.endsWith("/tmp_upload.json") || normalized.endsWith("/process_task.json") || normalized.endsWith("/day_upload.json");
      }
    });
    this.watcher.on("addDir", () => this.scheduleFullScan()).on("unlinkDir", () => this.scheduleFullScan()).on("error", (error) => this.handleWatcherError(error));
  }
  scheduleFullScan() {
    if (this.scanDebounceTimer) clearTimeout(this.scanDebounceTimer);
    this.scanDebounceTimer = setTimeout(() => {
      this.scanDebounceTimer = null;
      this.scan();
    }, 500);
  }
  handleWatcherError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const isResourceLimit = message.includes("ENOSPC") || message.includes("EMFILE") || message.includes("file watchers");
    if (isResourceLimit && !this.watcherErrorHandled) {
      this.watcherErrorHandled = true;
      log.warn(
        "目录事件监控达到系统资源上限，已关闭事件监听并回退到周期扫描:",
        message
      );
      const watcher = this.watcher;
      this.watcher = null;
      if (watcher) void watcher.close();
      return;
    }
    const now = Date.now();
    if (now - this.lastWatcherWarningAt >= 6e4) {
      this.lastWatcherWarningAt = now;
      log.warn("目录事件监控异常，周期扫描仍会继续:", message);
    }
  }
  reconcileTask(task) {
    if (task.status === "skipped" || task.status === "paused" || task.status === "completed") {
      return;
    }
    if (!fs.existsSync(task.folderPath)) {
      if (task.status !== "synced") {
        getTaskQueueService().cancelRunningTask(task.id);
        getTaskRepo().skip(task.id, "源目录已删除");
        getDayFolderService().refreshForTask(task.id);
        this.broadcastTaskStatus(task.id, task.status, "skipped");
      }
      return;
    }
    try {
      const settings = getSettingsRepo().getAll();
      const files = new FileFilterService(settings.filter).scanFolder(task.folderPath);
      const stableChecks = task.sourceType === "local" && task.dayFolderId ? Math.max(2, settings.stability.checkCount || 2) : 1;
      getTaskRepo().reconcileFiles(
        task.id,
        files.map((file) => ({
          relativePath: file.relativePath,
          size: file.size,
          mtimeMs: file.mtimeMs
        })),
        stableChecks
      );
      const updated = getTaskRepo().getById(task.id);
      if (updated && updated.status !== task.status) {
        this.broadcastTaskStatus(task.id, task.status, updated.status);
      }
      getDayFolderService().refreshForTask(task.id);
    } catch (err) {
      if (!fs.existsSync(task.folderPath)) {
        getTaskQueueService().cancelRunningTask(task.id);
        getTaskRepo().skip(task.id, "源目录已删除");
        getDayFolderService().refreshForTask(task.id);
        this.broadcastTaskStatus(task.id, task.status, "skipped");
        return;
      }
      log.warn("持续同步校准失败:", task.folderPath, err);
    }
  }
  reconcileDeletedTasks(seenChildPaths, watchedDirectories) {
    const normalizedRoots = watchedDirectories.map(
      (directory) => directory.replace(/[\\/]+$/, "")
    );
    for (const task of getTaskRepo().listByStatus()) {
      if (task.sourceType !== "local" || !task.dayFolderId) continue;
      if (!normalizedRoots.some(
        (root) => task.folderPath === root || task.folderPath.startsWith(`${root}/`) || task.folderPath.startsWith(`${root}\\`)
      )) {
        continue;
      }
      if (seenChildPaths.has(task.folderPath) || fs.existsSync(task.folderPath)) continue;
      if (task.status === "completed" || task.status === "synced" || task.status === "skipped") {
        continue;
      }
      getTaskQueueService().cancelRunningTask(task.id);
      getTaskRepo().skip(task.id, "源目录已删除");
      getDayFolderService().refreshForTask(task.id);
      this.broadcastTaskStatus(task.id, task.status, "skipped");
    }
  }
  broadcastTaskStatus(taskId, oldStatus, newStatus) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_STATUS_CHANGE, {
        taskId,
        oldStatus,
        newStatus
      });
    }
  }
  registerLegacyCompletedDir(dirPath, folderName, dayFolderId, dateName, processMarker, tmpMarker) {
    const legacyUploadRelativePath = folderName;
    const markerProviders = Object.keys(processMarker.destinations || {});
    const mode = processMarker.uploadTargetMode || (markerProviders.includes("tencent") && markerProviders.includes("aliyun") ? "both" : markerProviders.includes("tencent") ? "tencent" : "aliyun");
    const currentSettings = getSettingsRepo().getAll();
    const prefixes = {
      aliyun: tmpMarker?.metadata.destinationPrefixes?.aliyun || currentSettings.oss.prefix || "",
      tencent: tmpMarker?.metadata.destinationPrefixes?.tencent || currentSettings.tencentS3.prefix || ""
    };
    const task = this.ensureTaskRegistered(
      dirPath,
      folderName,
      dayFolderId,
      legacyUploadRelativePath,
      {
        mode,
        prefixes
      }
    );
    const taskRepo = getTaskRepo();
    taskRepo.setTotals(task.id, processMarker.totalFiles, 0);
    taskRepo.updateProgress(task.id, processMarker.uploadedFiles, 0);
    taskRepo.updateStatus(task.id, "completed");
    for (const destination of getTaskDestinationRepo().listByTask(task.id)) {
      const marker = processMarker.destinations?.[destination.provider];
      getTaskDestinationRepo().setTotals(
        task.id,
        destination.provider,
        marker?.totalFiles ?? processMarker.totalFiles,
        0
      );
      getTaskDestinationRepo().updateProgress(
        task.id,
        destination.provider,
        marker?.uploadedFiles ?? processMarker.uploadedFiles,
        0
      );
      getTaskDestinationRepo().updateStatus(
        task.id,
        destination.provider,
        "completed"
      );
    }
    writeTmpUpload(dirPath, {
      version: 2,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      folderPath: dirPath,
      metadata: {
        source: "local",
        dayFolderId,
        date: dateName,
        uploadRelativePath: legacyUploadRelativePath,
        uploadTargetMode: mode,
        destinationPrefixes: prefixes
      }
    });
    writeProcessTask(dirPath, {
      ...processMarker,
      taskId: task.id,
      status: "completed",
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
    });
    getDayFolderService().refresh(dayFolderId);
    log.info("信任旧完成标记并登记焊接任务:", dirPath);
  }
  ensureTaskRegistered(dirPath, folderName, dayFolderId, uploadRelativePath, targetSnapshot) {
    const taskRepo = getTaskRepo();
    const existing = taskRepo.getByFolderPath(dirPath);
    if (existing) {
      this.attachTaskToDayFolder(existing, dayFolderId, uploadRelativePath);
      return taskRepo.getById(existing.id);
    }
    const settings = getSettingsRepo().getAll();
    const snapshot = targetSnapshot || getUploadTargetSnapshot(settings);
    return taskRepo.create({
      folderPath: dirPath,
      folderName,
      ossPrefix: snapshot.prefixes.aliyun,
      uploadTargetMode: snapshot.mode,
      destinationPrefixes: snapshot.prefixes,
      dayFolderId,
      uploadRelativePath,
      sourceType: "local"
    });
  }
  attachTaskToDayFolder(task, dayFolderId, uploadRelativePath) {
    const targetUploadRelativePath = task.status === "completed" && task.uploadRelativePath === task.folderName ? task.uploadRelativePath : uploadRelativePath;
    if (task.dayFolderId !== dayFolderId || task.uploadRelativePath !== targetUploadRelativePath) {
      getTaskRepo().updateDayFolderMetadata(task.id, dayFolderId, targetUploadRelativePath);
    }
  }
  collectDataInfo(dirPath) {
    const settings = getSettingsRepo();
    const dataCollectConfig = settings.get("dataCollect");
    if (!dataCollectConfig?.enabled) return;
    try {
      const info = getDataCollectService().collectDataInfo(dirPath);
      if (info) {
        for (const win of electron.BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.DATA_COLLECT_RESULT, info);
        }
      }
    } catch (err) {
      log.warn("数采分析失败:", dirPath, err);
    }
  }
  broadcastStatus() {
    const status = this.getStatus();
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SCANNER_EVENT, status);
    }
  }
  snapshotDir(dirPath) {
    const snapshot = /* @__PURE__ */ new Map();
    this.walkForSnapshot(dirPath, dirPath, snapshot);
    return snapshot;
  }
  walkForSnapshot(basePath, currentPath, snapshot) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) {
            this.walkForSnapshot(basePath, fullPath, snapshot);
          }
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const relPath = fullPath.slice(basePath.length + 1);
            snapshot.set(relPath, { size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
          }
        }
      }
    } catch {
    }
  }
  compareSnapshots(prev, curr) {
    if (prev.size !== curr.size) return false;
    for (const [key, prevVal] of prev) {
      const currVal = curr.get(key);
      if (!currVal) return false;
      if (prevVal.size !== currVal.size || prevVal.mtimeMs !== currVal.mtimeMs) {
        return false;
      }
    }
    return true;
  }
}
let instance$7 = null;
function getScannerService() {
  if (!instance$7) instance$7 = new ScannerService();
  return instance$7;
}
class OSSUploadService {
  client = null;
  config = null;
  multipartThreshold = 100 * 1024 * 1024;
  // 100MB
  minPartSize = 1024 * 1024;
  // 1MB
  maxMultipartParts = 1e4;
  configure(config, multipartThreshold) {
    this.config = config;
    if (multipartThreshold) this.multipartThreshold = multipartThreshold;
    this.client = null;
  }
  async getClient() {
    if (this.client) return this.client;
    if (!this.config) throw new Error("OSS 未配置");
    const OSS = (await import("ali-oss")).default;
    this.client = new OSS({
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint || void 0
    });
    return this.client;
  }
  /**
   * 创建任务级独立 OSS 客户端
   * 每个任务使用自己的客户端，cancel() 不会影响其他任务
   */
  async createTaskClient() {
    if (!this.config) throw new Error("OSS 未配置");
    const OSS = (await import("ali-oss")).default;
    return new OSS({
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint || void 0
    });
  }
  async createTaskUploader(config, multipartThreshold) {
    this.configure(config, multipartThreshold);
    const client = await this.createTaskClient();
    const threshold = multipartThreshold || this.multipartThreshold;
    return {
      provider: "aliyun",
      uploadFile: (filePath, objectKey, fileSize, onProgress, signal) => this.uploadFileWithClient(
        client,
        filePath,
        objectKey,
        fileSize,
        threshold,
        onProgress,
        signal
      ).then((key) => ({ objectKey: key })),
      uploadBuffer: async (buffer, objectKey, signal) => {
        if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
        await client.put(objectKey, buffer);
        return objectKey;
      },
      abort: () => client.cancel(),
      dispose: () => {
      }
    };
  }
  /**
   * 上传单个文件到 OSS
   * @param filePath 本地文件绝对路径
   * @param ossKey OSS 对象 key
   * @param fileSize 文件大小
   * @param onProgress 进度回调 (0-1)
   * @param signal 取消信号
   * @param taskClient 任务级 OSS 客户端（可选，默认使用共享客户端）
   * @returns OSS key
   */
  async uploadFile(filePath, ossKey, fileSize, onProgress, signal, taskClient) {
    if (signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    const client = taskClient || await this.getClient();
    return this.uploadFileWithClient(
      client,
      filePath,
      ossKey,
      fileSize,
      this.multipartThreshold,
      onProgress,
      signal
    );
  }
  async uploadFileWithClient(client, filePath, ossKey, fileSize, multipartThreshold, onProgress, signal) {
    if (signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    if (fileSize > multipartThreshold) {
      try {
        const partSize = this.getPartSizeForMultipart(fileSize);
        await client.multipartUpload(ossKey, filePath, {
          partSize,
          progress: (percentage) => {
            onProgress?.(percentage);
          }
        });
      } catch (err) {
        if (signal?.aborted || err && typeof err === "object" && "name" in err && err.name === "cancel") {
          throw new DOMException("Upload aborted", "AbortError");
        }
        throw err;
      }
    } else {
      const stream = fs.createReadStream(filePath);
      const onAbort = () => {
        stream.destroy();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await client.put(ossKey, stream);
        onProgress?.(1);
      } catch (err) {
        if (signal?.aborted) {
          throw new DOMException("Upload aborted", "AbortError");
        }
        throw err;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        stream.destroy();
      }
    }
    return ossKey;
  }
  getPartSizeForMultipart(fileSize) {
    const minPartSizeByCount = Math.ceil(fileSize / (this.maxMultipartParts - 1));
    const partSize = Math.max(this.minPartSize, minPartSizeByCount);
    const step = 1024 * 1024;
    return Math.ceil(partSize / step) * step;
  }
  /**
   * 上传 Buffer 到 OSS（用于 SFTP 直传场景）
   */
  async uploadBuffer(buffer, ossKey) {
    const client = await this.getClient();
    await client.put(ossKey, buffer);
    return ossKey;
  }
  async testConnection(config) {
    const endpoint = config.endpoint.trim();
    const region = config.region.trim();
    const bucket = config.bucket.trim();
    const accessKeyId = config.accessKeyId.trim();
    const accessKeySecret = config.accessKeySecret.trim();
    if (!region) return { ok: false, error: "Region 不能为空" };
    if (!bucket) return { ok: false, error: "Bucket 不能为空" };
    if (!accessKeyId) return { ok: false, error: "AccessKey ID 不能为空" };
    if (!accessKeySecret) return { ok: false, error: "AccessKey Secret 不能为空" };
    try {
      const OSS = (await import("ali-oss")).default;
      const client = new OSS({
        region,
        accessKeyId,
        accessKeySecret,
        bucket,
        endpoint: endpoint || void 0,
        timeout: "10s",
        secure: true
      });
      const result = await client.list({ "max-keys": 1 });
      const statusCode = result?.res?.status;
      if (typeof statusCode === "number" && statusCode >= 200 && statusCode < 300) {
        return { ok: true };
      }
      return { ok: false, error: `桶连接校验失败，HTTP 状态码: ${statusCode ?? "unknown"}` };
    } catch (err) {
      const e = err;
      const parts = [
        e.code || e.name,
        typeof e.status === "number" ? `status=${e.status}` : void 0,
        e.message
      ].filter(Boolean);
      return { ok: false, error: parts.join(", ") || String(err) };
    }
  }
}
let instance$6 = null;
function getOSSUploadService() {
  if (!instance$6) instance$6 = new OSSUploadService();
  return instance$6;
}
class TencentS3UploadService {
  createTaskUploader(config, multipartThreshold = 100 * 1024 * 1024) {
    const client = this.createClient(config);
    const activeControllers = /* @__PURE__ */ new Set();
    const activeUploads = /* @__PURE__ */ new Set();
    let aborted = false;
    const createController = (signal) => {
      const controller = new AbortController();
      activeControllers.add(controller);
      if (aborted || signal?.aborted) controller.abort();
      signal?.addEventListener("abort", () => controller.abort(), { once: true });
      return controller;
    };
    return {
      provider: "tencent",
      uploadFile: async (filePath, objectKey, fileSize, onProgress, signal) => {
        const controller = createController(signal);
        let uploadId;
        try {
          if (fileSize > multipartThreshold) {
            const upload = new libStorage.Upload({
              client,
              params: {
                Bucket: config.bucket,
                Key: objectKey,
                Body: fs.createReadStream(filePath),
                ContentType: "application/octet-stream"
              },
              queueSize: 4,
              partSize: this.getPartSize(fileSize),
              leavePartsOnError: false,
              abortController: controller
            });
            activeUploads.add(upload);
            upload.on("httpUploadProgress", (progress) => {
              if (typeof progress.loaded === "number" && fileSize > 0) {
                onProgress?.(Math.min(1, progress.loaded / fileSize));
              }
            });
            try {
              await upload.done();
              uploadId = upload.uploadId;
            } finally {
              activeUploads.delete(upload);
            }
          } else {
            await client.send(
              new clientS3.PutObjectCommand({
                Bucket: config.bucket,
                Key: objectKey,
                Body: fs.createReadStream(filePath),
                ContentType: "application/octet-stream",
                ContentLength: fileSize
              }),
              { abortSignal: controller.signal }
            );
            onProgress?.(1);
          }
          return { objectKey, uploadId };
        } catch (err) {
          if (controller.signal.aborted) {
            throw new DOMException("Upload aborted", "AbortError");
          }
          throw err;
        } finally {
          activeControllers.delete(controller);
        }
      },
      uploadBuffer: async (buffer, objectKey, signal) => {
        const controller = createController(signal);
        try {
          await client.send(
            new clientS3.PutObjectCommand({
              Bucket: config.bucket,
              Key: objectKey,
              Body: buffer,
              ContentType: "application/octet-stream",
              ContentLength: buffer.length
            }),
            { abortSignal: controller.signal }
          );
          return objectKey;
        } catch (err) {
          if (controller.signal.aborted) {
            throw new DOMException("Upload aborted", "AbortError");
          }
          throw err;
        } finally {
          activeControllers.delete(controller);
        }
      },
      abort: () => {
        aborted = true;
        for (const controller of activeControllers) controller.abort();
        for (const upload of activeUploads) void upload.abort();
        client.destroy();
      },
      dispose: () => client.destroy()
    };
  }
  async testConnection(config) {
    const validationError = this.validateConfig(config);
    if (validationError) return { ok: false, error: validationError };
    const client = this.createClient(config, 1e4);
    try {
      await client.send(
        new clientS3.ListObjectsV2Command({
          Bucket: config.bucket,
          MaxKeys: 1
        })
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: this.formatError(err) };
    } finally {
      client.destroy();
    }
  }
  validateConfig(config) {
    if (!config.endpoint.trim()) return "Endpoint 不能为空";
    if (!config.region.trim()) return "Region 不能为空";
    if (!config.bucket.trim()) return "Bucket 不能为空";
    if (!config.accessKeyId.trim()) return "AccessKey ID 不能为空";
    if (!config.accessKeySecret.trim()) return "AccessKey Secret 不能为空";
    return null;
  }
  createClient(config, requestTimeout = 3e5) {
    const requestHandler = config.allowInsecureTls ? new nodeHttpHandler.NodeHttpHandler({
      connectionTimeout: 3e4,
      requestTimeout,
      httpsAgent: new https.Agent({
        keepAlive: true,
        rejectUnauthorized: false
      })
    }) : new nodeHttpHandler.NodeHttpHandler({
      connectionTimeout: 3e4,
      requestTimeout
    });
    return new clientS3.S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.accessKeySecret
      },
      requestHandler,
      maxAttempts: 1
    });
  }
  getPartSize(fileSize) {
    const minimum = 5 * 1024 * 1024;
    const byPartCount = Math.ceil(fileSize / 9999);
    const raw = Math.max(minimum, byPartCount);
    const step = 1024 * 1024;
    return Math.ceil(raw / step) * step;
  }
  formatError(err) {
    const error = err;
    return [
      error.Code || error.name,
      error.$metadata?.httpStatusCode ? `status=${error.$metadata.httpStatusCode}` : void 0,
      error.message
    ].filter(Boolean).join(", ") || String(err);
  }
}
let instance$5 = null;
function getTencentS3UploadService() {
  if (!instance$5) instance$5 = new TencentS3UploadService();
  return instance$5;
}
class CloudUploadService {
  async createTaskUploader(provider, settings, multipartThreshold) {
    if (provider === "aliyun") {
      return getOSSUploadService().createTaskUploader(settings.oss, multipartThreshold);
    }
    return getTencentS3UploadService().createTaskUploader(
      settings.tencentS3,
      multipartThreshold
    );
  }
  validateProvider(provider, settings) {
    if (provider === "aliyun") {
      if (!settings.oss.region.trim()) return "阿里云 Region 不能为空";
      if (!settings.oss.bucket.trim()) return "阿里云 Bucket 不能为空";
      if (!settings.oss.accessKeyId.trim()) return "阿里云 AccessKey ID 不能为空";
      if (!settings.oss.accessKeySecret.trim()) return "阿里云 AccessKey Secret 不能为空";
      return null;
    }
    const error = getTencentS3UploadService().validateConfig(settings.tencentS3);
    return error ? `腾讯云 ${error}` : null;
  }
}
let instance$4 = null;
function getCloudUploadService() {
  if (!instance$4) instance$4 = new CloudUploadService();
  return instance$4;
}
class SSHRsyncService {
  runningProcesses = /* @__PURE__ */ new Map();
  /**
   * 测试 SSH 连接
   */
  async testConnection(machine, password) {
    return new Promise((resolve) => {
      const client = new ssh2.Client();
      const timeout = setTimeout(() => {
        client.end();
        resolve({ ok: false, error: "连接超时 (10s)" });
      }, 1e4);
      client.on("ready", () => {
        clearTimeout(timeout);
        client.end();
        resolve({ ok: true });
      });
      client.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });
      const connectOpts = {
        host: machine.host,
        port: machine.port,
        username: machine.username
      };
      if (machine.authType === "key" && machine.privateKeyPath) {
        try {
          connectOpts.privateKey = fs.readFileSync(machine.privateKeyPath);
        } catch (err) {
          resolve({ ok: false, error: `无法读取密钥文件: ${err}` });
          return;
        }
      } else if (password) {
        connectOpts.password = password;
      }
      client.connect(connectOpts);
    });
  }
  /**
   * 执行 rsync 拉取
   */
  async startRsync(machine, password, onProgress) {
    if (this.runningProcesses.has(machine.id)) {
      throw new Error("该机器已有传输进程在运行");
    }
    return new Promise((resolve, reject) => {
      const args = this.buildRsyncArgs(machine);
      const env = { ...process.env };
      let cmd;
      let cmdArgs;
      if (machine.authType === "password" && password) {
        cmd = "sshpass";
        cmdArgs = ["-p", password, "rsync", ...args];
      } else {
        cmd = "rsync";
        cmdArgs = args;
      }
      log.info(`rsync 启动: ${cmd} ${cmdArgs.join(" ")}`);
      const proc = child_process.spawn(cmd, cmdArgs, { env });
      this.runningProcesses.set(machine.id, proc);
      let stderr = "";
      proc.stdout?.on("data", (data) => {
        const line = data.toString();
        const progress = this.parseRsyncProgress(machine.id, line);
        if (progress && onProgress) {
          onProgress(progress);
        }
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        this.runningProcesses.delete(machine.id);
        if (code === 0) {
          log.info(`rsync 完成: ${machine.name}`);
          resolve();
        } else {
          const err = `rsync 退出码 ${code}: ${stderr}`;
          log.error(err);
          reject(new Error(err));
        }
      });
      proc.on("error", (err) => {
        this.runningProcesses.delete(machine.id);
        reject(err);
      });
    });
  }
  /**
   * SFTP 流式直传到当前选择的云端（不落盘）
   */
  async sftpStreamToCloud(machine, password, settings, onProgress) {
    if (this.runningProcesses.has(machine.id)) {
      throw new Error("该机器已有传输进程在运行");
    }
    const providers = providersForMode(settings.cloud.targetMode);
    const uploaders = /* @__PURE__ */ new Map();
    try {
      for (const provider of providers) {
        const validationError = getCloudUploadService().validateProvider(provider, settings);
        if (validationError) throw new Error(validationError);
        uploaders.set(
          provider,
          await getCloudUploadService().createTaskUploader(
            provider,
            settings,
            settings.upload.multipartThreshold
          )
        );
      }
    } catch (err) {
      for (const uploader of uploaders.values()) uploader.dispose();
      throw err;
    }
    const client = new ssh2.Client();
    this.runningProcesses.set(machine.id, client);
    return new Promise((resolve, reject) => {
      const connectOpts = {
        host: machine.host,
        port: machine.port,
        username: machine.username
      };
      if (machine.authType === "key" && machine.privateKeyPath) {
        try {
          connectOpts.privateKey = fs.readFileSync(machine.privateKeyPath);
        } catch (err) {
          this.runningProcesses.delete(machine.id);
          reject(new Error(`无法读取密钥文件: ${err}`));
          return;
        }
      } else if (password) {
        connectOpts.password = password;
      }
      client.on("error", (err) => {
        this.runningProcesses.delete(machine.id);
        reject(err);
      });
      client.on("ready", () => {
        client.sftp(async (err, sftp) => {
          if (err) {
            client.end();
            this.runningProcesses.delete(machine.id);
            reject(err);
            return;
          }
          try {
            const result = await this.sftpUploadDir(
              sftp,
              machine,
              settings,
              uploaders,
              onProgress
            );
            client.end();
            this.runningProcesses.delete(machine.id);
            for (const uploader of uploaders.values()) uploader.dispose();
            resolve(result);
          } catch (uploadErr) {
            client.end();
            this.runningProcesses.delete(machine.id);
            for (const uploader of uploaders.values()) uploader.dispose();
            reject(uploadErr);
          }
        });
      });
      client.connect(connectOpts);
    });
  }
  async sftpUploadDir(sftp, machine, settings, uploaders, onProgress) {
    const files = await this.sftpListFiles(sftp, machine.remoteDir, machine.remoteDir);
    log.info(`SFTP 发现 ${files.length} 个文件`);
    const uploadRelativePath = resolveDirectoryUploadRelativePath(machine.remoteDir);
    let uploadedCount = 0;
    const providerResults = /* @__PURE__ */ new Map();
    for (const provider of uploaders.keys()) {
      providerResults.set(provider, { provider, ok: true, keys: [] });
    }
    for (const remoteFile of files) {
      const relativePath = remoteFile.slice(machine.remoteDir.length).replace(/^\//, "");
      onProgress?.({
        machineId: machine.id,
        totalFiles: files.length,
        uploadedFiles: uploadedCount,
        currentFile: relativePath,
        speed: ""
      });
      await new Promise((res, rej) => {
        const readStream = sftp.createReadStream(remoteFile);
        const chunks = [];
        readStream.on("data", (chunk) => {
          chunks.push(chunk);
        });
        readStream.on("end", async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const active = Array.from(uploaders.entries()).filter(([provider]) => {
              return providerResults.get(provider)?.ok;
            });
            await Promise.all(
              active.map(async ([provider, uploader]) => {
                const prefix = provider === "aliyun" ? settings.oss.prefix : settings.tencentS3.prefix;
                const objectKey = buildOssKey(
                  prefix,
                  uploadRelativePath,
                  relativePath
                );
                try {
                  await uploader.uploadBuffer(buffer, objectKey);
                  providerResults.get(provider)?.keys?.push(objectKey);
                } catch (err) {
                  providerResults.set(provider, {
                    provider,
                    ok: false,
                    error: err instanceof Error ? err.message : String(err)
                  });
                }
              })
            );
            if (Array.from(providerResults.values()).every((result) => result.ok)) {
              uploadedCount++;
            }
            res();
          } catch (e) {
            rej(e);
          }
        });
        readStream.on("error", rej);
      });
    }
    onProgress?.({
      machineId: machine.id,
      totalFiles: files.length,
      uploadedFiles: uploadedCount,
      currentFile: "",
      speed: ""
    });
    log.info(`SFTP 直传完成: ${uploadedCount}/${files.length} 个文件`);
    const results = Array.from(providerResults.values());
    return {
      ok: results.every((result) => result.ok),
      results
    };
  }
  sftpListFiles(sftp, basePath, currentPath) {
    return new Promise((resolve, reject) => {
      sftp.readdir(currentPath, async (err, list) => {
        if (err) {
          reject(err);
          return;
        }
        const files = [];
        for (const item of list) {
          if (item.filename.startsWith(".")) continue;
          const fullPath = path.posix.join(currentPath, item.filename);
          if (item.attrs.isDirectory()) {
            const subFiles = await this.sftpListFiles(sftp, basePath, fullPath);
            files.push(...subFiles);
          } else if (item.attrs.isFile()) {
            files.push(fullPath);
          }
        }
        resolve(files);
      });
    });
  }
  stopRsync(machineId) {
    const running = this.runningProcesses.get(machineId);
    if (running) {
      if (running instanceof ssh2.Client) {
        running.end();
      } else {
        running.kill("SIGTERM");
      }
      this.runningProcesses.delete(machineId);
      log.info("传输已停止:", machineId);
    }
  }
  buildRsyncArgs(machine) {
    const args = [
      "-avz",
      "--partial",
      "--progress",
      `--bwlimit=${machine.bwLimit}`
    ];
    const sshCmd = machine.authType === "key" && machine.privateKeyPath ? `ssh -i ${machine.privateKeyPath} -p ${machine.port} -o StrictHostKeyChecking=no` : `ssh -p ${machine.port} -o StrictHostKeyChecking=no`;
    const remoteRsync = `nice -n ${machine.cpuNice} ionice -c 3 rsync`;
    args.push(`--rsync-path=${remoteRsync}`);
    args.push("-e", sshCmd);
    const remotePath = machine.remoteDir.endsWith("/") ? machine.remoteDir : machine.remoteDir + "/";
    const source = `${machine.username}@${machine.host}:${remotePath}`;
    const dest = machine.localDir.endsWith("/") ? machine.localDir : machine.localDir + "/";
    args.push(source, dest);
    return args;
  }
  parseRsyncProgress(machineId, line) {
    const match = line.match(/(\d+)%\s+([\d.]+\w+\/s)/);
    if (match) {
      return {
        machineId,
        percent: parseInt(match[1]),
        speed: match[2],
        file: line.trim().split("\n")[0] || ""
      };
    }
    return null;
  }
}
let instance$3 = null;
function getSSHRsyncService() {
  if (!instance$3) instance$3 = new SSHRsyncService();
  return instance$3;
}
function rowToSSHMachine(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    privateKeyPath: row.private_key_path || null,
    remoteDir: row.remote_dir,
    localDir: row.local_dir,
    bwLimit: row.bw_limit,
    cpuNice: row.cpu_nice,
    transferMode: row.transfer_mode || "rsync",
    enabled: Boolean(row.enabled),
    lastSyncAt: row.last_sync_at || null,
    createdAt: row.created_at
  };
}
function registerAllIpc() {
  function broadcastStatusChange(taskId, newStatus) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_STATUS_CHANGE, { taskId, newStatus });
    }
  }
  electron.ipcMain.handle(IPC.TASK_LIST, (_event, args) => {
    return getTaskRepo().listByStatus(args?.status);
  });
  electron.ipcMain.handle(IPC.TASK_GET, (_event, args) => {
    return getTaskRepo().getById(args.taskId);
  });
  electron.ipcMain.handle(IPC.TASK_DETAIL, (_event, args) => {
    const task = getTaskRepo().getById(args.taskId);
    if (!task) throw new Error("任务不存在");
    return {
      task,
      files: getTaskRepo().listFileDetails(args.taskId)
    };
  });
  electron.ipcMain.handle(IPC.TASK_ADD_FOLDER, (_event, args) => {
    const taskRepo = getTaskRepo();
    const settingsRepo = getSettingsRepo();
    const snapshot = getUploadTargetSnapshot(settingsRepo.getAll());
    const folderName = path.basename(args.folderPath);
    const uploadRelativePath = resolveDirectoryUploadRelativePath(args.folderPath);
    const task = taskRepo.create({
      folderPath: args.folderPath,
      folderName,
      ossPrefix: snapshot.prefixes.aliyun,
      uploadTargetMode: snapshot.mode,
      destinationPrefixes: snapshot.prefixes,
      uploadRelativePath,
      sourceType: "manual"
    });
    getScannerService().reconcileTask(task);
    return getTaskRepo().getById(task.id);
  });
  electron.ipcMain.handle(IPC.TASK_PAUSE, (_event, args) => {
    getTaskQueueService().cancelRunningTask(args.taskId);
    getTaskRepo().updateStatus(args.taskId, "paused");
    getTaskDestinationRepo().updateIncompleteStatuses(args.taskId, "paused");
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "paused");
  });
  electron.ipcMain.handle(IPC.TASK_RESUME, (_event, args) => {
    getTaskRepo().retry(args.taskId);
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "pending");
  });
  electron.ipcMain.handle(IPC.TASK_CANCEL, (_event, args) => {
    getTaskQueueService().cancelRunningTask(args.taskId);
    getTaskRepo().skip(args.taskId, "用户跳过");
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "skipped");
  });
  electron.ipcMain.handle(IPC.TASK_SKIP, (_event, args) => {
    getTaskQueueService().cancelRunningTask(args.taskId);
    getTaskRepo().skip(args.taskId, "用户跳过");
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "skipped");
  });
  electron.ipcMain.handle(IPC.TASK_RESTORE, (_event, args) => {
    const task = getTaskRepo().getById(args.taskId);
    if (!task) throw new Error("任务不存在");
    if (!fs.existsSync(task.folderPath)) throw new Error("源目录不存在，无法恢复");
    getTaskRepo().restore(args.taskId);
    const restored = getTaskRepo().getById(args.taskId);
    if (restored) getScannerService().reconcileTask(restored);
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "scanning");
  });
  electron.ipcMain.handle(IPC.TASK_RETRY, (_event, args) => {
    getTaskRepo().retry(args.taskId, args.provider);
    getDayFolderService().refreshForTask(args.taskId);
    broadcastStatusChange(args.taskId, "pending");
  });
  electron.ipcMain.handle(IPC.SCANNER_STATUS, () => {
    return getScannerService().getStatus();
  });
  electron.ipcMain.handle(IPC.SCANNER_TRIGGER, () => {
    getScannerService().triggerScan();
  });
  electron.ipcMain.handle(IPC.SCANNER_START, () => {
    getScannerService().start();
  });
  electron.ipcMain.handle(IPC.SCANNER_STOP, () => {
    getScannerService().stop();
  });
  electron.ipcMain.handle(IPC.DAY_FOLDER_LIST, (_event, query) => {
    return getDayFolderRepo().list(query);
  });
  electron.ipcMain.handle(IPC.DAY_FOLDER_DELETE, (_event, args) => {
    getDayFolderRepo().deleteCompleted(args.id);
  });
  electron.ipcMain.handle(IPC.DAY_FOLDER_IGNORE, (_event, args) => {
    const repo = getDayFolderRepo();
    repo.setIgnored(args.id, true);
    for (const task of repo.getChildTasks(args.id)) {
      if (task.status === "completed" || task.status === "synced") continue;
      getTaskQueueService().cancelRunningTask(task.id);
      getTaskRepo().skip(task.id, "用户忽略整个日期");
      broadcastStatusChange(task.id, "skipped");
    }
    return getDayFolderService().refresh(args.id);
  });
  electron.ipcMain.handle(IPC.DAY_FOLDER_RESTORE, (_event, args) => {
    const repo = getDayFolderRepo();
    repo.setIgnored(args.id, false);
    for (const task of repo.getChildTasks(args.id)) {
      if (task.status !== "skipped" || !fs.existsSync(task.folderPath)) continue;
      getTaskRepo().restore(task.id);
      const restored = getTaskRepo().getById(task.id);
      if (restored) getScannerService().reconcileTask(restored);
      broadcastStatusChange(task.id, "scanning");
    }
    return getDayFolderService().refresh(args.id);
  });
  electron.ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    return getSettingsRepo().getAll();
  });
  electron.ipcMain.handle(IPC.SETTINGS_SAVE, (_event, data) => {
    getSettingsRepo().saveAll(data);
    if (data.cleanup !== void 0) {
      getCleanupService().scheduleCleanup();
    }
    if (data.scan !== void 0 || data.stability !== void 0) {
      getScannerService().stop();
      getScannerService().start();
    }
    return { ok: true };
  });
  electron.ipcMain.handle(IPC.SETTINGS_TEST_OSS, async (_event, config) => {
    return getOSSUploadService().testConnection(config);
  });
  electron.ipcMain.handle(
    IPC.SETTINGS_TEST_TENCENT_S3,
    async (_event, config) => {
      return getTencentS3UploadService().testConnection(config);
    }
  );
  electron.ipcMain.handle(IPC.SSH_LIST_MACHINES, () => {
    const db2 = getDb();
    const rows = db2.prepare("SELECT * FROM ssh_machines ORDER BY created_at DESC").all();
    return rows.map(rowToSSHMachine);
  });
  electron.ipcMain.handle(IPC.SSH_ADD_MACHINE, (_event, input) => {
    const db2 = getDb();
    const id = uuid.v4();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db2.prepare(
      `INSERT INTO ssh_machines (id, name, host, port, username, auth_type, private_key_path, encrypted_password, remote_dir, local_dir, bw_limit, cpu_nice, transfer_mode, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.host, input.port, input.username, input.authType, input.privateKeyPath || null, input.password || null, input.remoteDir, input.localDir, input.bwLimit, input.cpuNice, input.transferMode || "rsync", input.enabled ? 1 : 0, now);
    const row = db2.prepare("SELECT * FROM ssh_machines WHERE id = ?").get(id);
    return rowToSSHMachine(row);
  });
  electron.ipcMain.handle(IPC.SSH_UPDATE_MACHINE, (_event, machine) => {
    const db2 = getDb();
    db2.prepare(
      `UPDATE ssh_machines SET name=?, host=?, port=?, username=?, auth_type=?, private_key_path=?, remote_dir=?, local_dir=?, bw_limit=?, cpu_nice=?, enabled=? WHERE id=?`
    ).run(machine.name, machine.host, machine.port, machine.username, machine.authType, machine.privateKeyPath, machine.remoteDir, machine.localDir, machine.bwLimit, machine.cpuNice, machine.enabled ? 1 : 0, machine.id);
  });
  electron.ipcMain.handle(IPC.SSH_DELETE_MACHINE, (_event, args) => {
    const db2 = getDb();
    db2.prepare("DELETE FROM ssh_machines WHERE id = ?").run(args.id);
  });
  electron.ipcMain.handle(IPC.SSH_TEST_CONNECTION, async (_event, args) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT * FROM ssh_machines WHERE id = ?").get(args.id);
    if (!row) return { ok: false, error: "机器不存在" };
    const machine = rowToSSHMachine(row);
    const password = row.encrypted_password || void 0;
    return getSSHRsyncService().testConnection(machine, password);
  });
  electron.ipcMain.handle(IPC.RSYNC_START, async (_event, args) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT * FROM ssh_machines WHERE id = ?").get(args.machineId);
    if (!row) throw new Error("机器不存在");
    const machine = rowToSSHMachine(row);
    const password = row.encrypted_password || void 0;
    try {
      await getSSHRsyncService().startRsync(machine, password, (progress) => {
        for (const win of electron.BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.RSYNC_PROGRESS, progress);
        }
      });
      db2.prepare("UPDATE ssh_machines SET last_sync_at = ? WHERE id = ?").run((/* @__PURE__ */ new Date()).toISOString(), args.machineId);
      const taskRepo = getTaskRepo();
      const settingsRepo = getSettingsRepo();
      const snapshot = getUploadTargetSnapshot(settingsRepo.getAll());
      const localDir = path.normalize(machine.localDir).replace(/[\\/]+$/, "");
      const uploadRelativePath = resolveDirectoryUploadRelativePath(
        machine.remoteDir,
        localDir
      );
      const existing = taskRepo.getByFolderPath(localDir);
      if (!existing || existing.status === "completed" || existing.status === "failed") {
        const task = taskRepo.create({
          folderPath: localDir,
          folderName: path.basename(localDir),
          ossPrefix: snapshot.prefixes.aliyun,
          uploadTargetMode: snapshot.mode,
          destinationPrefixes: snapshot.prefixes,
          uploadRelativePath,
          sourceType: "rsync",
          sourceMachineId: machine.id
        });
        getScannerService().reconcileTask(task);
        log.info("rsync 完成, 自动创建上传任务:", localDir);
      } else if (existing.uploadRelativePath !== uploadRelativePath) {
        taskRepo.updateUploadRelativePath(existing.id, uploadRelativePath);
      }
      writeTmpUpload(localDir, {
        version: 2,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        folderPath: localDir,
        metadata: {
          source: "rsync",
          machineId: machine.id,
          uploadRelativePath,
          uploadTargetMode: snapshot.mode,
          destinationPrefixes: snapshot.prefixes
        }
      });
    } catch (err) {
      log.error("rsync 失败:", err);
      throw err;
    }
  });
  electron.ipcMain.handle(IPC.RSYNC_STOP, (_event, args) => {
    getSSHRsyncService().stopRsync(args.machineId);
  });
  electron.ipcMain.handle(IPC.HISTORY_LIST, (_event, query) => {
    return getHistoryRepo().list(query);
  });
  electron.ipcMain.handle(IPC.HISTORY_CLEAR, (_event, args) => {
    getHistoryRepo().clear(args?.before);
    getDayFolderRepo().clearCompleted(args?.before);
  });
  electron.ipcMain.handle(IPC.HISTORY_DELETE, (_event, args) => {
    getHistoryRepo().deleteById(args.id);
  });
  electron.ipcMain.handle(IPC.DIALOG_SELECT_FOLDER, async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await electron.dialog.showOpenDialog(win, {
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await electron.dialog.showOpenDialog(win, {
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle(IPC.SFTP_START, async (_event, args) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT * FROM ssh_machines WHERE id = ?").get(args.machineId);
    if (!row) throw new Error("机器不存在");
    const machine = rowToSSHMachine(row);
    const password = row.encrypted_password || void 0;
    const settings = getSettingsRepo().getAll();
    try {
      const result = await getSSHRsyncService().sftpStreamToCloud(
        machine,
        password,
        settings,
        (progress) => {
          for (const win of electron.BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.SFTP_PROGRESS, progress);
          }
        }
      );
      db2.prepare("UPDATE ssh_machines SET last_sync_at = ? WHERE id = ?").run((/* @__PURE__ */ new Date()).toISOString(), args.machineId);
      return result;
    } catch (err) {
      log.error("SFTP 直传失败:", err);
      throw err;
    }
  });
  electron.ipcMain.handle(IPC.SFTP_STOP, (_event, args) => {
    getSSHRsyncService().stopRsync(args.machineId);
  });
  electron.ipcMain.handle(IPC.DATA_COLLECT_LIST, () => {
    return getDataCollectService().getAll();
  });
  electron.ipcMain.handle(IPC.DATA_COLLECT_RUN, (_event, args) => {
    const result = getDataCollectService().collectDataInfo(args.folderPath);
    if (result) {
      for (const win of electron.BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.DATA_COLLECT_RESULT, result);
      }
    }
    return result;
  });
  electron.ipcMain.handle(IPC.DISK_USAGE, async () => {
    const settingsRepo = getSettingsRepo();
    const scanConfig = settingsRepo.get("scan");
    const db2 = getDb();
    const paths = /* @__PURE__ */ new Set();
    if (scanConfig?.directories) {
      for (const d of scanConfig.directories) paths.add(path.normalize(d).replace(/[\\/]+$/, ""));
    }
    const sshRows = db2.prepare("SELECT local_dir FROM ssh_machines WHERE enabled = 1").all();
    for (const r of sshRows) {
      paths.add(path.normalize(r.local_dir).replace(/[\\/]+$/, ""));
    }
    const results = [];
    for (const p of paths) {
      try {
        if (!fs.existsSync(p)) continue;
        const stats = await promises.statfs(p);
        const totalBytes = stats.bsize * stats.blocks;
        const freeBytes = stats.bsize * stats.bavail;
        const usedBytes = totalBytes - freeBytes;
        const usagePercent = totalBytes > 0 ? Math.round(usedBytes / totalBytes * 100) : 0;
        results.push({ path: p, totalBytes, freeBytes, usedBytes, usagePercent });
      } catch (err) {
        log.warn("获取磁盘用量失败:", p, err);
      }
    }
    return results;
  });
  electron.ipcMain.handle(IPC.ANNOTATION_OPEN_WINDOW, () => {
    createAnnotationWindow();
  });
  electron.ipcMain.handle(IPC.ANNOTATION_SELECT_IMAGE, async (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await electron.dialog.showOpenDialog(win, {
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "tiff", "tif"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle(IPC.ANNOTATION_READ_IMAGE, (_event, args) => {
    const { filePath } = args;
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const mimeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      bmp: "image/bmp",
      tiff: "image/tiff",
      tif: "image/tiff"
    };
    const mime = mimeMap[ext] || "image/png";
    const buf = fs.readFileSync(filePath);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    const img = electron.nativeImage.createFromPath(filePath);
    const size = img.getSize();
    return { dataUrl, width: size.width, height: size.height };
  });
  electron.ipcMain.handle(IPC.ANNOTATION_SAVE_EXPORT, async (event, args) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await electron.dialog.showSaveDialog(win, {
      defaultPath: `${args.defaultBaseName}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }]
    });
    if (result.canceled || !result.filePath) return null;
    const base64Data = args.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const pngPath = result.filePath;
    fs.writeFileSync(pngPath, Buffer.from(base64Data, "base64"));
    const parsed = path.parse(pngPath);
    const jsonPath = path.format({ dir: parsed.dir, name: parsed.name, ext: ".json" });
    fs.writeFileSync(jsonPath, args.jsonString, "utf-8");
    log.info("[Annotation] Exported PNG:", pngPath);
    log.info("[Annotation] Exported JSON:", jsonPath);
    return { pngPath, jsonPath };
  });
  electron.ipcMain.handle(IPC.ANNOTATION_UPLOAD_OSS, async (_event, args) => {
    const taskRepo = getTaskRepo();
    const settings = getSettingsRepo().getAll();
    const task = taskRepo.findTaskContainingFile(args.imagePath);
    const pngBuffer = fs.readFileSync(args.pngPath);
    const jsonBuffer = fs.readFileSync(args.jsonPath);
    const results = [];
    for (const provider of providersForMode(settings.cloud.targetMode)) {
      const validationError = getCloudUploadService().validateProvider(provider, settings);
      if (validationError) {
        results.push({ provider, ok: false, error: validationError });
        continue;
      }
      const taskDestination = task?.destinations.find(
        (destination) => destination.provider === provider
      );
      const configPrefix = provider === "aliyun" ? settings.oss.prefix : settings.tencentS3.prefix;
      const prefix = taskDestination?.prefix || configPrefix || "";
      let basePath;
      if (task) {
        const relPath = path.relative(task.folderPath, args.imagePath).replace(/\\/g, "/");
        const relParsed = path.parse(relPath);
        const relBase = path.format({
          dir: relParsed.dir,
          name: relParsed.name,
          ext: ""
        });
        basePath = [
          prefix,
          task.uploadRelativePath || task.folderName,
          relBase
        ].filter(Boolean).join("/").replace(/\/+/g, "/");
      } else {
        const image = path.parse(args.imagePath);
        basePath = [prefix, image.name].filter(Boolean).join("/").replace(/\/+/g, "/");
      }
      const pngKey = `${basePath}_annotation.png`;
      const jsonKey = `${basePath}_annotation.json`;
      let uploader = null;
      try {
        uploader = await getCloudUploadService().createTaskUploader(
          provider,
          settings,
          settings.upload.multipartThreshold
        );
        await Promise.all([
          uploader.uploadBuffer(pngBuffer, pngKey),
          uploader.uploadBuffer(jsonBuffer, jsonKey)
        ]);
        results.push({ provider, ok: true, keys: [pngKey, jsonKey] });
      } catch (err) {
        log.error(`[Annotation] ${provider} upload failed:`, err);
        results.push({
          provider,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        uploader?.dispose();
      }
    }
    return {
      ok: results.every((result) => result.ok),
      results
    };
  });
}
class SpeedCalculator {
  samples = [];
  windowMs;
  constructor(windowMs = 5e3) {
    this.windowMs = windowMs;
  }
  addSample(totalBytes) {
    const now = Date.now();
    this.samples.push({ time: now, bytes: totalBytes });
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.time >= cutoff);
  }
  getSpeed() {
    if (this.samples.length < 2) return 0;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = this.samples.filter((s) => s.time >= cutoff);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const timeDiff = (last.time - first.time) / 1e3;
    if (timeDiff <= 0) return 0;
    return Math.max(0, (last.bytes - first.bytes) / timeDiff);
  }
  reset() {
    this.samples = [];
  }
}
class UploadSemaphore {
  constructor(max) {
    this.max = max;
  }
  current = 0;
  waiting = [];
  setMax(max) {
    this.max = max;
    this.drain();
  }
  getMax() {
    return this.max;
  }
  getCurrent() {
    return this.current;
  }
  async acquire(signal) {
    if (signal?.aborted) {
      throw new DOMException("Semaphore acquire aborted", "AbortError");
    }
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve, reject) => {
      const id = Symbol();
      const entry = {
        resolve: () => {
          this.current++;
          cleanup();
          resolve();
        },
        id
      };
      const onAbort = () => {
        const idx = this.waiting.findIndex((w) => w.id === id);
        if (idx !== -1) this.waiting.splice(idx, 1);
        cleanup();
        reject(new DOMException("Semaphore acquire aborted", "AbortError"));
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }
  release() {
    this.current--;
    this.drain();
  }
  drain() {
    while (this.waiting.length > 0 && this.current < this.max) {
      const next = this.waiting.shift();
      next.resolve();
    }
  }
}
let instance$2 = null;
function getUploadSemaphore(max) {
  if (!instance$2) {
    instance$2 = new UploadSemaphore(max ?? 30);
  } else if (max !== void 0) {
    instance$2.setMax(max);
  }
  return instance$2;
}
const RETRY_DELAYS_MS = [1e3, 2e3, 5e3, 15e3, 3e4];
class TaskRunnerService {
  async run(task, signal) {
    const taskRepo = getTaskRepo();
    const destinationRepo = getTaskDestinationRepo();
    const settings = getSettingsRepo().getAll();
    const stableChecks = task.sourceType === "local" && task.dayFolderId ? Math.max(2, settings.stability.checkCount || 2) : 1;
    if (!fs.existsSync(task.folderPath)) {
      destinationRepo.updateIncompleteStatuses(
        task.id,
        "skipped",
        "源目录已删除"
      );
      return "skipped";
    }
    const dateScopedUploadPath = deriveDateScopedUploadRelativePath(task.folderPath);
    if (dateScopedUploadPath && task.uploadRelativePath !== dateScopedUploadPath && task.status !== "completed") {
      taskRepo.updateUploadRelativePath(task.id, dateScopedUploadPath);
      task.uploadRelativePath = dateScopedUploadPath;
    }
    await this.reconcileBeforeUpload(task, stableChecks);
    const destinations = destinationRepo.listByTask(task.id);
    if (destinations.length === 0) {
      throw new Error("任务没有配置任何上传目标");
    }
    const jobs = destinationRepo.listReadyFileTargets(
      task.id,
      stableChecks
    );
    if (jobs.length === 0) {
      taskRepo.recalculateProgress(task.id);
      return this.updateDestinationFinalStates(task);
    }
    const jobProviders = new Set(jobs.map((job) => job.provider));
    for (const destination of destinations) {
      if (!jobProviders.has(destination.provider)) continue;
      const error = getCloudUploadService().validateProvider(
        destination.provider,
        settings
      );
      if (error) throw new Error(error);
    }
    const completedLogicalFiles = taskRepo.listFiles(task.id, "completed");
    const logicalProgress = {
      completed: new Set(completedLogicalFiles.map((file) => file.id)),
      uploadedBytes: completedLogicalFiles.reduce(
        (sum, file) => sum + file.fileSize,
        0
      )
    };
    const providers = Array.from(new Set(jobs.map((job) => job.provider)));
    const runtimes = /* @__PURE__ */ new Map();
    try {
      for (const provider of providers) {
        const destination = destinations.find((item) => item.provider === provider);
        if (!destination) continue;
        const uploader = await getCloudUploadService().createTaskUploader(
          provider,
          settings,
          settings.upload.multipartThreshold
        );
        const providerTargets = destinationRepo.listFileTargets(task.id, provider);
        runtimes.set(provider, {
          uploader,
          speed: new SpeedCalculator(),
          uploadedFiles: providerTargets.filter(
            (target) => target.status === "completed"
          ).length,
          uploadedBytes: providerTargets.filter((target) => target.status === "completed").reduce((sum, target) => sum + target.fileSize, 0),
          totalFiles: providerTargets.length,
          totalBytes: providerTargets.reduce(
            (sum, target) => sum + target.fileSize,
            0
          ),
          queuedFiles: providerTargets.filter(
            (target) => target.status === "pending"
          ).length,
          failedFiles: providerTargets.filter(
            (target) => target.status === "failed"
          ).length,
          skippedFiles: providerTargets.filter(
            (target) => target.status === "skipped"
          ).length,
          activeUploads: /* @__PURE__ */ new Map(),
          transferredBytes: 0,
          lastBroadcastAt: 0
        });
        destinationRepo.updateStatus(task.id, provider, "uploading");
        this.broadcastDestinationStatus(task.id, provider, "uploading");
      }
    } catch (error) {
      for (const runtime of runtimes.values()) runtime.uploader.dispose();
      throw error;
    }
    const abortUploaders = () => {
      for (const runtime of runtimes.values()) runtime.uploader.abort();
    };
    signal?.addEventListener("abort", abortUploaders, { once: true });
    const marker = this.createCompactMarker(
      { ...task, status: "uploading" },
      destinations
    );
    this.writeMarker(task.folderPath, marker);
    const markerTimer = setInterval(() => {
      const currentTask2 = taskRepo.getById(task.id);
      if (!currentTask2) return;
      this.writeMarker(
        task.folderPath,
        this.createCompactMarker(
          currentTask2,
          destinationRepo.listByTask(task.id)
        )
      );
    }, 2e3);
    const semaphore = getUploadSemaphore(
      settings.upload.maxConcurrentUploads || 24
    );
    let nextIndex = 0;
    const workerCount = Math.max(
      1,
      Math.min(settings.upload.maxFilesPerTask || 12, jobs.length)
    );
    const runNext = async () => {
      while (nextIndex < jobs.length && !signal?.aborted) {
        const target = jobs[nextIndex++];
        await this.uploadTarget(
          task,
          target,
          destinations,
          runtimes,
          semaphore,
          logicalProgress,
          signal
        );
      }
    };
    try {
      await Promise.all(
        Array.from({ length: workerCount }, () => runNext())
      );
    } finally {
      clearInterval(markerTimer);
      signal?.removeEventListener("abort", abortUploaders);
      for (const runtime of runtimes.values()) runtime.uploader.dispose();
    }
    if (signal?.aborted) {
      return getTaskRepo().getById(task.id)?.status || "paused";
    }
    taskRepo.recalculateProgress(task.id);
    const finalStatus = this.updateDestinationFinalStates(task);
    const currentTask = taskRepo.getById(task.id) || task;
    const finalTask = { ...currentTask, status: finalStatus };
    this.writeMarker(
      task.folderPath,
      this.createCompactMarker(finalTask, destinationRepo.listByTask(task.id))
    );
    return finalStatus;
  }
  async reconcileBeforeUpload(task, stableChecks) {
    const settings = getSettingsRepo().getAll();
    const files = await new FileFilterService(settings.filter).scanFolderAsync(
      task.folderPath
    );
    getTaskRepo().reconcileFiles(
      task.id,
      files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        mtimeMs: file.mtimeMs
      })),
      stableChecks
    );
  }
  async uploadTarget(task, target, destinations, runtimes, semaphore, logicalProgress, signal) {
    const taskRepo = getTaskRepo();
    const destinationRepo = getTaskDestinationRepo();
    const runtime = runtimes.get(target.provider);
    const destination = destinations.find(
      (item) => item.provider === target.provider
    );
    if (!runtime || !destination) return;
    const localPath = path.join(task.folderPath, target.relativePath);
    if (!fs.existsSync(localPath)) {
      destinationRepo.updateFileStatus(
        target.id,
        "skipped",
        void 0,
        void 0,
        "源文件已删除"
      );
      destinationRepo.recalculateLogicalFile(target.taskFileId);
      runtime.skippedFiles++;
      runtime.queuedFiles = Math.max(0, runtime.queuedFiles - 1);
      this.broadcastProgress(task.id, target.provider, runtime, null, true);
      return;
    }
    let acquired = false;
    try {
      await semaphore.acquire(signal);
      acquired = true;
      if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
      const before = fs.statSync(localPath);
      if (before.size !== target.fileSize || before.mtimeMs !== target.mtimeMs) {
        taskRepo.markFileChanged(
          target.taskFileId,
          before.size,
          before.mtimeMs
        );
        log.info("文件在进入上传前发生变化，等待重新稳定:", localPath);
        return;
      }
      destinationRepo.updateFileStatus(target.id, "uploading");
      runtime.activeUploads.set(target.id, 0);
      runtime.queuedFiles = Math.max(0, runtime.queuedFiles - 1);
      this.broadcastProgress(
        task.id,
        target.provider,
        runtime,
        target.relativePath,
        true
      );
      const objectKey = buildOssKey(
        destination.prefix,
        task.uploadRelativePath || task.folderName,
        target.relativePath
      );
      let previousLoaded = 0;
      const result = await runtime.uploader.uploadFile(
        localPath,
        objectKey,
        target.fileSize,
        (fraction) => {
          const loaded = Math.min(
            target.fileSize,
            Math.max(0, Math.round(target.fileSize * fraction))
          );
          const delta = Math.max(0, loaded - previousLoaded);
          previousLoaded = loaded;
          runtime.transferredBytes += delta;
          runtime.activeUploads.set(target.id, loaded);
          runtime.speed.addSample(runtime.transferredBytes);
          this.broadcastProgress(
            task.id,
            target.provider,
            runtime,
            target.relativePath
          );
        },
        signal
      );
      if (fs.existsSync(localPath)) {
        const after = fs.statSync(localPath);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          taskRepo.markFileChanged(target.taskFileId, after.size, after.mtimeMs);
          log.info("文件上传期间发生变化，重新排队:", localPath);
          return;
        }
      }
      destinationRepo.updateFileStatus(
        target.id,
        "completed",
        result.objectKey,
        result.uploadId
      );
      const logicalStatus = destinationRepo.recalculateLogicalFile(
        target.taskFileId
      );
      if (logicalStatus === "completed") {
        taskRepo.clearRetry(target.taskFileId);
        if (!logicalProgress.completed.has(target.taskFileId)) {
          logicalProgress.completed.add(target.taskFileId);
          logicalProgress.uploadedBytes += target.fileSize;
          taskRepo.updateProgress(
            task.id,
            logicalProgress.completed.size,
            logicalProgress.uploadedBytes
          );
        }
      }
      runtime.uploadedFiles++;
      runtime.uploadedBytes += target.fileSize;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (taskRepo.getById(task.id)?.status !== "skipped") {
          destinationRepo.updateFileStatus(target.id, "pending");
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (this.isRetriableUploadError(error) && target.retryCount < RETRY_DELAYS_MS.length) {
        const delay = this.retryDelay(target.retryCount);
        const nextRetryAt = new Date(Date.now() + delay).toISOString();
        const retryCount = taskRepo.scheduleRetry(
          target.taskFileId,
          message,
          nextRetryAt
        );
        destinationRepo.updateFileStatus(
          target.id,
          "pending",
          void 0,
          void 0,
          `第 ${retryCount} 次重试等待中: ${message}`
        );
        log.warn(
          `任务 ${task.id} [${target.provider}] 将在 ${delay}ms 后重试: ${target.relativePath}`
        );
      } else {
        destinationRepo.updateFileStatus(
          target.id,
          "failed",
          void 0,
          void 0,
          message
        );
        destinationRepo.recalculateLogicalFile(target.taskFileId);
        runtime.failedFiles++;
        log.error(
          `上传失败 [${target.provider}] ${target.relativePath}:`,
          message
        );
      }
    } finally {
      runtime.activeUploads.delete(target.id);
      if (acquired) semaphore.release();
      destinationRepo.updateProgress(
        task.id,
        target.provider,
        runtime.uploadedFiles,
        runtime.uploadedBytes
      );
      this.broadcastProgress(task.id, target.provider, runtime, null, true);
    }
  }
  updateDestinationFinalStates(task) {
    const repo = getTaskDestinationRepo();
    let taskStatus = task.sourceType === "local" && task.dayFolderId ? "synced" : "completed";
    for (const destination of repo.listByTask(task.id)) {
      const targets = repo.listFileTargets(task.id, destination.provider);
      const failed = targets.filter((target) => target.status === "failed");
      const pending = targets.filter((target) => target.status === "pending");
      const skipped = targets.filter((target) => target.status === "skipped");
      if (failed.length > 0) {
        const summary = `${failed.length} 个文件上传失败，例如 ${failed.slice(0, 3).map(
          (target) => `${target.relativePath}: ${target.errorMessage || "unknown error"}`
        ).join(" | ")}`;
        repo.updateStatus(task.id, destination.provider, "failed", summary);
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          "failed",
          summary
        );
        taskStatus = "failed";
      } else if (pending.length > 0) {
        repo.updateStatus(
          task.id,
          destination.provider,
          "retrying",
          `${pending.length} 个文件等待自动重试或稳定`
        );
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          "retrying",
          `${pending.length} 个文件等待自动重试或稳定`
        );
        if (taskStatus !== "failed") taskStatus = "retrying";
      } else {
        const status = task.sourceType === "local" && task.dayFolderId ? "synced" : "completed";
        repo.updateStatus(
          task.id,
          destination.provider,
          status,
          skipped.length > 0 ? `${skipped.length} 个源文件已跳过` : void 0
        );
        this.broadcastDestinationStatus(
          task.id,
          destination.provider,
          status,
          skipped.length > 0 ? `${skipped.length} 个源文件已跳过` : void 0
        );
      }
      repo.recalculateProgress(task.id, destination.provider);
    }
    return taskStatus;
  }
  createCompactMarker(task, destinations) {
    const destinationRepo = getTaskDestinationRepo();
    return {
      version: 3,
      taskId: task.id,
      status: task.status,
      totalFiles: task.totalFiles,
      uploadedFiles: task.uploadedFiles,
      failedFiles: taskRepoCount(task.id, "failed"),
      skippedFiles: taskRepoCount(task.id, "skipped"),
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
      error: task.errorMessage || destinations.map((destination) => destination.errorMessage).filter(Boolean).join(" || ") || null,
      uploadTargetMode: task.uploadTargetMode,
      destinations: Object.fromEntries(
        destinations.map((destination) => {
          const targets = destinationRepo.listFileTargets(
            task.id,
            destination.provider
          );
          return [
            destination.provider,
            {
              status: destination.status,
              totalFiles: targets.length,
              uploadedFiles: targets.filter(
                (target) => target.status === "completed"
              ).length,
              failedFiles: targets.filter(
                (target) => target.status === "failed"
              ).length,
              skippedFiles: targets.filter(
                (target) => target.status === "skipped"
              ).length,
              error: destination.errorMessage
            }
          ];
        })
      )
    };
  }
  broadcastProgress(taskId, provider, runtime, currentFile, force = false) {
    const now = Date.now();
    if (!force && now - runtime.lastBroadcastAt < 250) return;
    runtime.lastBroadcastAt = now;
    const inFlightBytes = Array.from(runtime.activeUploads.values()).reduce(
      (sum, bytes) => sum + bytes,
      0
    );
    const progress = {
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
    };
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_PROGRESS, progress);
    }
  }
  writeMarker(folderPath, marker) {
    if (!fs.existsSync(folderPath)) return;
    try {
      writeProcessTask(folderPath, marker);
    } catch (error) {
      log.warn("写入任务汇总标记失败:", folderPath, error);
    }
  }
  broadcastDestinationStatus(taskId, provider, status, errorMessage) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.TASK_DESTINATION_CHANGE, {
        taskId,
        provider,
        status,
        errorMessage
      });
    }
  }
  retryDelay(retryCount) {
    const base = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.round(base * jitter);
  }
  isRetriableUploadError(errorValue) {
    const error = errorValue;
    const status = error.status || error.$metadata?.httpStatusCode;
    if (typeof status === "number" && (status === 429 || status >= 500)) {
      return true;
    }
    const transientCodes = /* @__PURE__ */ new Set([
      "ECONNRESET",
      "ETIMEDOUT",
      "ESOCKETTIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "EPIPE",
      "ECONNREFUSED"
    ]);
    if (error.code && transientCodes.has(error.code)) return true;
    const text = `${error.name || ""} ${error.message || ""}`.toLowerCase();
    return text.includes("timeout") || text.includes("temporarily unavailable") || text.includes("socket hang up");
  }
}
function taskRepoCount(taskId, status) {
  return getTaskRepo().listFiles(taskId, status).length;
}
let instance$1 = null;
function getTaskRunnerService() {
  if (!instance$1) instance$1 = new TaskRunnerService();
  return instance$1;
}
class WebhookService {
  async notify(config, payload) {
    if (!config.enabled || !config.url) return;
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(config.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...config.headers
          },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          log.info(`Webhook 通知成功: ${config.url}`);
          return;
        }
        log.warn(`Webhook 响应异常: ${response.status} ${response.statusText}`);
      } catch (err) {
        log.warn(`Webhook 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, err);
      }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    log.error(`Webhook 通知最终失败: ${config.url}`);
  }
}
let instance = null;
function getWebhookService() {
  if (!instance) instance = new WebhookService();
  return instance;
}
let logDir = "";
let levelFileHookInstalled = false;
const LEVEL_LOG_MAX_SIZE = 10 * 1024 * 1024;
const LEVEL_LOG_DISCARD_SIZE = 50 * 1024 * 1024;
function initLogger(config) {
  logDir = config?.directory || path.join(electron.app.getPath("userData"), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  log.transports.file.resolvePathFn = () => {
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const dir = path.join(logDir, date);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, "info.log");
  };
  log.transports.file.level = "info";
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
  log.transports.file.maxSize = 10 * 1024 * 1024;
  prepareCurrentLevelLogs();
  if (!levelFileHookInstalled) {
    log.hooks.push((message) => {
      if (!logDir) return message;
      const level = message.level;
      if (level === "error" || level === "warn") {
        try {
          const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          const dir = path.join(logDir, date);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const fileName = level === "error" ? "error.log" : "warn.log";
          const text = message.data?.map((d) => String(d)).join(" ") || "";
          const ts = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 23);
          const line = `[${ts}] [${level}] ${text}
`;
          const filePath = path.join(dir, fileName);
          rotateLevelLog(filePath);
          fs.appendFileSync(filePath, line);
        } catch {
        }
      }
      return message;
    });
    levelFileHookInstalled = true;
  }
  const maxDays = config?.maxDays || 30;
  cleanOldLogs(logDir, maxDays);
  log.info("日志系统初始化完成, 目录:", logDir);
}
function prepareCurrentLevelLogs() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const dir = path.join(logDir, date);
  if (!fs.existsSync(dir)) return;
  rotateLevelLog(path.join(dir, "warn.log"));
  rotateLevelLog(path.join(dir, "error.log"));
}
function rotateLevelLog(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const size = fs.statSync(filePath).size;
  if (size < LEVEL_LOG_MAX_SIZE) return;
  if (size >= LEVEL_LOG_DISCARD_SIZE) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  const oldPath = filePath.replace(/\.log$/, ".old.log");
  fs.rmSync(oldPath, { force: true });
  fs.renameSync(filePath, oldPath);
}
function cleanOldLogs(dir, maxDays) {
  try {
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1e3;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          log.info("已清理过期日志目录:", entry);
        }
      } catch {
      }
    }
  } catch {
  }
}
let mainWindow = null;
let annotationWindow = null;
let startupWindow = null;
let tray = null;
let servicesStarted = false;
const hasSingleInstanceLock = electron.app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  electron.app.quit();
}
electron.app.on("second-instance", () => {
  const window = mainWindow || startupWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
async function createStartupWindow() {
  startupWindow = new electron.BrowserWindow({
    width: 460,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: "数据采集上传工具正在启动",
    backgroundColor: "#f8fafc",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  startupWindow.once("ready-to-show", () => startupWindow?.show());
  const html = `<!doctype html>
    <html lang="zh-CN">
      <head><meta charset="utf-8"><title>正在启动</title></head>
      <body style="margin:0;font-family:sans-serif;background:#f8fafc;color:#0f172a">
        <main style="height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:18px;font-weight:600">数据采集上传工具正在启动</div>
          <div style="margin-top:14px;font-size:14px;color:#475569">正在检查和升级本地数据库，请勿重复启动或强制关机。</div>
          <div style="margin-top:8px;font-size:12px;color:#64748b">历史文件较多时首次升级可能需要几分钟。</div>
        </main>
      </body>
    </html>`;
  await startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "数据采集上传工具",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    startupWindow?.destroy();
    startupWindow = null;
    mainWindow?.show();
    if (!servicesStarted) {
      servicesStarted = true;
      setTimeout(() => {
        try {
          startServices();
        } catch (error) {
          log.error("后台服务启动失败:", error);
        }
      }, 500);
    }
  });
  mainWindow.on("close", (e) => {
    if (!electron.app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function createTray() {
  const icon = electron.nativeImage.createEmpty();
  tray = new electron.Tray(icon.isEmpty() ? electron.nativeImage.createFromBuffer(Buffer.alloc(0)) : icon);
  const contextMenu = electron.Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        electron.app.isQuitting = true;
        electron.app.quit();
      }
    }
  ]);
  tray.setToolTip("数据采集上传工具");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}
function registerHotkey() {
  try {
    const settingsRepo = getSettingsRepo();
    const hotkey = settingsRepo.get("hotkey") || "CommandOrControl+Shift+U";
    electron.globalShortcut.register(hotkey, () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    log.error("注册快捷键失败:", err);
  }
}
function startServices() {
  const taskQueue = getTaskQueueService();
  const taskRunner = getTaskRunnerService();
  const webhookService = getWebhookService();
  const taskRepo = getTaskRepo();
  const settingsRepo = getSettingsRepo();
  taskQueue.setTaskRunner(async (task, signal) => {
    const finalStatus = await taskRunner.run(task, signal);
    if (signal.aborted) return finalStatus;
    const webhookConfig = settingsRepo.get("webhook");
    if (webhookConfig?.enabled && finalStatus === "completed") {
      const updatedTask = taskRepo.getById(task.id);
      if (updatedTask) {
        const createdAt = new Date(updatedTask.createdAt).getTime();
        const now = Date.now();
        const durationSeconds = Math.round((now - createdAt) / 1e3);
        webhookService.notify(webhookConfig, {
          event: "task_completed",
          taskId: updatedTask.id,
          folderName: updatedTask.folderName,
          fileCount: updatedTask.totalFiles,
          totalBytes: updatedTask.totalBytes,
          durationSeconds,
          status: "completed",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    return finalStatus;
  });
  taskQueue.on("task:status-change", (event) => {
    if (event.newStatus === "failed") {
      const webhookConfig = settingsRepo.get("webhook");
      if (webhookConfig?.enabled) {
        const task = taskRepo.getById(event.taskId);
        if (task) {
          webhookService.notify(webhookConfig, {
            event: "task_failed",
            taskId: task.id,
            folderName: task.folderName,
            fileCount: task.totalFiles,
            totalBytes: task.totalBytes,
            durationSeconds: 0,
            status: "failed",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
    }
    for (const win of electron.BrowserWindow.getAllWindows()) {
      win.webContents.send("task:status-change", event);
    }
  });
  const unfinished = taskRepo.getUnfinishedTasks();
  if (unfinished.length > 0) {
    log.info(`发现 ${unfinished.length} 个未完成任务，等待后台队列分批恢复`);
  }
  taskQueue.start();
  const scanner = getScannerService();
  scanner.start();
  getCleanupService().start();
  log.info("所有服务已启动");
}
electron.app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  electronApp.setAppUserModelId("com.uploader.app");
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  initLogger();
  process.on("uncaughtException", (error) => {
    log.error("主进程未捕获异常:", error);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("主进程未处理 Promise 异常:", reason);
  });
  electron.app.on("render-process-gone", (_event, webContents, details) => {
    log.error("渲染进程异常退出:", {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL()
    });
  });
  electron.app.on("child-process-gone", (_event, details) => {
    log.error("Electron 子进程异常退出:", details);
  });
  await createStartupWindow();
  initDatabase();
  const logConfig = getSettingsRepo().get("log");
  if (logConfig?.directory) {
    initLogger(logConfig);
  }
  registerAllIpc();
  createWindow();
  createTray();
  registerHotkey();
  log.info("应用界面初始化完成，后台服务将在窗口显示后启动");
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error("应用启动失败:", error);
  startupWindow?.destroy();
  startupWindow = null;
  electron.dialog.showErrorBox(
    "数据采集上传工具启动失败",
    message.includes("database is locked") ? "数据库正在被另一个程序进程使用。请结束旧的数据采集上传工具进程后重试。" : `${message}

请查看 ~/.config/electron-uploader/logs 下的日志。`
  );
  electron.app.quit();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
  getScannerService().stop();
  getTaskQueueService().stop();
  getCleanupService().stop();
});
electron.app.isQuitting = false;
electron.app.on("before-quit", () => {
  electron.app.isQuitting = true;
});
function getMainWindow() {
  return mainWindow;
}
function createAnnotationWindow() {
  if (annotationWindow && !annotationWindow.isDestroyed()) {
    annotationWindow.focus();
    return;
  }
  annotationWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "图像标注",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  annotationWindow.on("closed", () => {
    annotationWindow = null;
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    annotationWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "#/annotation");
  } else {
    annotationWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "annotation" });
  }
}
exports.createAnnotationWindow = createAnnotationWindow;
exports.getMainWindow = getMainWindow;

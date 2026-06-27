import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  getActiveScanRoots,
  normalizeScanConfig
} from '../src/shared/scan-config'
import { runMigrations, setDbForTests } from '../src/main/db/database'
import { getDayFolderRepo } from '../src/main/db/day-folder.repo'
import { getHistoryRepo } from '../src/main/db/history.repo'
import { getTaskDestinationRepo } from '../src/main/db/task-destination.repo'
import { getTaskRepo } from '../src/main/db/task.repo'
import { ScannerService } from '../src/main/services/scanner.service'
import type { CloudProvider, Task, UploadTargetMode } from '../src/shared/types'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  setDbForTests(db)
  return db
}

function closeTestDb(db: Database.Database): void {
  setDbForTests(null)
  db.close()
}

test('migrates legacy scan directories according to target mode', () => {
  const scan = normalizeScanConfig(
    {
      directories: ['/data/2026-06-27', '/extra'],
      providerDirectories: { aliyun: [], tencent: [] },
      intervalSeconds: 30
    },
    'both'
  )

  assert.deepEqual(scan.providerDirectories.aliyun, ['/data', '/extra'])
  assert.deepEqual(scan.providerDirectories.tencent, ['/data', '/extra'])
  assert.deepEqual(scan.directories, ['/data', '/extra'])
})

test('builds active scan roots by target mode and merges duplicate provider directories', () => {
  const scan = normalizeScanConfig(
    {
      directories: [],
      providerDirectories: {
        aliyun: ['/data/a', '/data/shared'],
        tencent: ['/data/shared', '/data/t']
      },
      intervalSeconds: 30
    },
    'both'
  )

  assert.deepEqual(getActiveScanRoots(scan, 'aliyun'), [
    { directory: '/data/a', providers: ['aliyun'] },
    { directory: '/data/shared', providers: ['aliyun'] }
  ])
  assert.deepEqual(getActiveScanRoots(scan, 'tencent'), [
    { directory: '/data/shared', providers: ['tencent'] },
    { directory: '/data/t', providers: ['tencent'] }
  ])
  assert.deepEqual(getActiveScanRoots(scan, 'both'), [
    { directory: '/data/a', providers: ['aliyun'] },
    { directory: '/data/shared', providers: ['aliyun', 'tencent'] },
    { directory: '/data/t', providers: ['tencent'] }
  ])
})

test('scanner task registration creates provider-specific destinations', () => {
  const db = createTestDb()
  try {
    const dayFolder = getDayFolderRepo().ensure('/data/2026-06-27', '2026-06-27')
    const scanner = new ScannerService() as unknown as {
      ensureTaskRegistered: (
        dirPath: string,
        folderName: string,
        dayFolderId: string,
        uploadRelativePath: string,
        targetSnapshot: {
          mode: UploadTargetMode
          prefixes: Record<CloudProvider, string>
        }
      ) => Task
    }

    const aliyunTask = scanner.ensureTaskRegistered(
      '/data/2026-06-27/a',
      'a',
      dayFolder.id,
      '2026-06-27/a',
      { mode: 'aliyun', prefixes: { aliyun: 'ali/', tencent: 'ten/' } }
    )
    const tencentTask = scanner.ensureTaskRegistered(
      '/data/2026-06-27/t',
      't',
      dayFolder.id,
      '2026-06-27/t',
      { mode: 'tencent', prefixes: { aliyun: 'ali/', tencent: 'ten/' } }
    )
    const bothTask = scanner.ensureTaskRegistered(
      '/data/2026-06-27/both',
      'both',
      dayFolder.id,
      '2026-06-27/both',
      { mode: 'both', prefixes: { aliyun: 'ali/', tencent: 'ten/' } }
    )

    assert.deepEqual(
      getTaskDestinationRepo().listByTask(aliyunTask.id).map((item) => item.provider),
      ['aliyun']
    )
    assert.deepEqual(
      getTaskDestinationRepo().listByTask(tencentTask.id).map((item) => item.provider),
      ['tencent']
    )
    assert.deepEqual(
      getTaskDestinationRepo().listByTask(bothTask.id).map((item) => item.provider),
      ['aliyun', 'tencent']
    )
  } finally {
    closeTestDb(db)
  }
})

test('history delete and clear are scoped to the selected provider', () => {
  const db = createTestDb()
  try {
    const task = getTaskRepo().create({
      folderPath: '/data/both',
      folderName: 'both',
      ossPrefix: 'ali/',
      uploadTargetMode: 'both',
      destinationPrefixes: { aliyun: 'ali/', tencent: 'ten/' },
      uploadRelativePath: 'both',
      sourceType: 'manual'
    })
    getTaskDestinationRepo().updateStatus(task.id, 'aliyun', 'completed')
    getTaskDestinationRepo().updateStatus(task.id, 'tencent', 'completed')

    assert.equal(getHistoryRepo().list({ page: 1, pageSize: 20, provider: 'aliyun' }).total, 1)
    assert.equal(getHistoryRepo().list({ page: 1, pageSize: 20, provider: 'tencent' }).total, 1)

    getHistoryRepo().deleteById(task.id, 'aliyun')
    assert.deepEqual(
      getTaskDestinationRepo().listByTask(task.id).map((item) => item.provider),
      ['tencent']
    )
    assert.equal(getTaskRepo().getById(task.id)?.id, task.id)

    getHistoryRepo().deleteById(task.id, 'tencent')
    assert.equal(getTaskRepo().getById(task.id), null)

    const aliyunOnly = getTaskRepo().create({
      folderPath: '/data/aliyun-only',
      folderName: 'aliyun-only',
      ossPrefix: 'ali/',
      uploadTargetMode: 'aliyun',
      destinationPrefixes: { aliyun: 'ali/' },
      uploadRelativePath: 'aliyun-only',
      sourceType: 'manual'
    })
    const tencentOnly = getTaskRepo().create({
      folderPath: '/data/tencent-only',
      folderName: 'tencent-only',
      ossPrefix: '',
      uploadTargetMode: 'tencent',
      destinationPrefixes: { tencent: 'ten/' },
      uploadRelativePath: 'tencent-only',
      sourceType: 'manual'
    })
    getTaskDestinationRepo().updateStatus(aliyunOnly.id, 'aliyun', 'completed')
    getTaskDestinationRepo().updateStatus(tencentOnly.id, 'tencent', 'completed')

    getHistoryRepo().clear(undefined, 'aliyun')
    assert.equal(getTaskRepo().getById(aliyunOnly.id), null)
    assert.equal(getTaskRepo().getById(tencentOnly.id)?.id, tencentOnly.id)
  } finally {
    closeTestDb(db)
  }
})

test('day folder summaries can be filtered and deleted by provider', () => {
  const db = createTestDb()
  try {
    const dayFolder = getDayFolderRepo().ensure('/data/2026-06-27', '2026-06-27')
    const task = getTaskRepo().create({
      folderPath: '/data/2026-06-27/both',
      folderName: 'both',
      ossPrefix: 'ali/',
      uploadTargetMode: 'both',
      destinationPrefixes: { aliyun: 'ali/', tencent: 'ten/' },
      dayFolderId: dayFolder.id,
      uploadRelativePath: '2026-06-27/both',
      sourceType: 'local'
    })
    getTaskDestinationRepo().updateStatus(task.id, 'aliyun', 'synced')
    getTaskDestinationRepo().updateStatus(task.id, 'tencent', 'synced')
    db.prepare(
      "UPDATE day_folders SET status = 'completed', completed_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), dayFolder.id)

    assert.equal(getDayFolderRepo().list({ provider: 'aliyun' }).length, 1)
    assert.equal(getDayFolderRepo().list({ provider: 'tencent' }).length, 1)

    getDayFolderRepo().deleteCompleted(dayFolder.id, 'aliyun')
    assert.equal(getDayFolderRepo().list({ provider: 'aliyun' }).length, 0)
    assert.equal(getDayFolderRepo().list({ provider: 'tencent' }).length, 1)
    assert.equal(getDayFolderRepo().getById(dayFolder.id)?.id, dayFolder.id)

    getDayFolderRepo().deleteCompleted(dayFolder.id, 'tencent')
    assert.equal(getDayFolderRepo().getById(dayFolder.id), null)
  } finally {
    closeTestDb(db)
  }
})

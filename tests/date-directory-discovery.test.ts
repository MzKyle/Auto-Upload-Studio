import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverDayDirectories } from '../src/main/services/date-directory-discovery'

test('discovers only valid date folders and their direct visible child folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'uploader-scan-'))

  try {
    const validDay = join(root, '2026-06-18')
    mkdirSync(validDay)
    mkdirSync(join(validDay, '04-39-04'))
    mkdirSync(join(validDay, '05-06-52'))
    mkdirSync(join(validDay, '.working'))
    mkdirSync(join(validDay, '04-39-04', 'camera'))
    writeFileSync(join(validDay, 'root-file.txt'), 'ignored')

    mkdirSync(join(root, '2026-02-29'))
    mkdirSync(join(root, 'test_data'))
    mkdirSync(join(root, '.hidden-day'))
    writeFileSync(join(root, '2026-06-17'), 'not a directory')

    assert.deepEqual(discoverDayDirectories(root), [
      {
        dateName: '2026-06-18',
        folderPath: validDay,
        childFolderNames: ['04-39-04', '05-06-52']
      }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

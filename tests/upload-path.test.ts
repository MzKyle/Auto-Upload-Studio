import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOssKey } from '../src/shared/day-folder'
import {
  normalizeUploadPathConfig,
  resolveUploadRelativePath
} from '../src/shared/upload-path'

test('target-root uploads directly below the provider prefix', () => {
  const uploadRelativePath = resolveUploadRelativePath(
    { pathMode: 'target-root', pathSegmentCount: 2 },
    { sourcePath: '/data/2026-06-27/04-39-04' }
  )

  assert.equal(uploadRelativePath, '')
  assert.equal(buildOssKey('', uploadRelativePath, 'camera/1.jpg'), 'camera/1.jpg')
  assert.equal(buildOssKey('upload/', uploadRelativePath, 'camera/1.jpg'), 'upload/camera/1.jpg')
})

test('date-workdir restores the legacy date and work directory path', () => {
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'date-workdir', pathSegmentCount: 2 },
      {
        sourcePath: '/data/current',
        dateName: '2026-06-27',
        workDirName: '04-39-04'
      }
    ),
    '2026-06-27/04-39-04'
  )
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'date-workdir', pathSegmentCount: 2 },
      {
        sourcePath: '/cache/current-package',
        fallbackDirectoryPath: '/remote/data/2026-03-14/17-38-09'
      }
    ),
    '2026-03-14/17-38-09'
  )
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'date-workdir', pathSegmentCount: 2 },
      { sourcePath: '/cache/current-package' }
    ),
    'current-package'
  )
})

test('keep-source preserves a path relative to the scan root or selected parent', () => {
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'keep-source', pathSegmentCount: 2 },
      {
        sourcePath: '/data/root/2026-06-27/04-39-04',
        basePath: '/data/root'
      }
    ),
    '2026-06-27/04-39-04'
  )
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'keep-source', pathSegmentCount: 2 },
      { sourcePath: '/manual/packages/current' }
    ),
    'current'
  )
})

test('last-segments keeps the requested number of source path segments', () => {
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'last-segments', pathSegmentCount: 3 },
      { sourcePath: '/data/root/2026-06-27/04-39-04' }
    ),
    'root/2026-06-27/04-39-04'
  )
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'last-segments', pathSegmentCount: 2 },
      { sourcePath: 'D:\\data\\2026-06-27\\04-39-04' }
    ),
    '2026-06-27/04-39-04'
  )
  assert.equal(
    resolveUploadRelativePath(
      { pathMode: 'last-segments', pathSegmentCount: 0 },
      { sourcePath: '/data/root/2026-06-27/04-39-04' }
    ),
    ''
  )
})

test('invalid upload path config falls back to target-root defaults', () => {
  assert.deepEqual(
    normalizeUploadPathConfig({
      pathMode: 'bad-value',
      pathSegmentCount: -1
    }),
    {
      pathMode: 'target-root',
      pathSegmentCount: 0
    }
  )
})

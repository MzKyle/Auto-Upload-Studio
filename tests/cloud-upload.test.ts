import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveLogicalFileStatus,
  deriveTaskStatus,
  providersForMode
} from '../src/shared/cloud-upload'

test('expands upload target modes into locked provider sets', () => {
  assert.deepEqual(providersForMode('aliyun'), ['aliyun'])
  assert.deepEqual(providersForMode('tencent'), ['tencent'])
  assert.deepEqual(providersForMode('both'), ['aliyun', 'tencent'])
})

test('requires every selected cloud to complete a logical file', () => {
  assert.equal(
    deriveLogicalFileStatus(['completed', 'completed']),
    'completed'
  )
  assert.equal(
    deriveLogicalFileStatus(['completed', 'failed']),
    'failed'
  )
  assert.equal(
    deriveLogicalFileStatus(['completed', 'pending']),
    'pending'
  )
})

test('keeps the logical task failed until all selected clouds complete', () => {
  assert.equal(deriveTaskStatus(['completed']), 'completed')
  assert.equal(deriveTaskStatus(['completed', 'completed']), 'completed')
  assert.equal(deriveTaskStatus(['completed', 'failed']), 'failed')
  assert.equal(deriveTaskStatus(['completed', 'uploading']), 'uploading')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPathTree,
  buildPathTreeFromPaths,
  splitPathSegments
} from '../src/renderer/lib/path-tree'

test('merges directories that share the same parent', () => {
  const tree = buildPathTreeFromPaths(['/data/a', '/data/b'])

  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, '/data')
  assert.deepEqual(
    tree[0].children.map((node) => node.label),
    ['a', 'b']
  )
  assert.equal(tree[0].children[0].items[0].originalPath, '/data/a')
  assert.equal(tree[0].children[1].items[0].originalPath, '/data/b')
})

test('splits Windows and Linux paths into directory levels', () => {
  const windowsSegments = splitPathSegments('C:\\data\\a')
  const linuxSegments = splitPathSegments('/data/a')

  assert.deepEqual(
    windowsSegments.map((segment) => segment.label),
    ['C:', 'data', 'a']
  )
  assert.deepEqual(
    linuxSegments.map((segment) => segment.label),
    ['/data', 'a']
  )
})

test('preserves original paths for item actions', () => {
  const originalPath = 'C:\\data\\a'
  const tree = buildPathTree([
    {
      id: 'dir-1',
      path: originalPath,
      value: { deletePath: originalPath }
    }
  ])
  const leaf = tree[0].children[0].children[0]

  assert.equal(leaf.items[0].originalPath, originalPath)
  assert.equal(leaf.items[0].value.deletePath, originalPath)
})

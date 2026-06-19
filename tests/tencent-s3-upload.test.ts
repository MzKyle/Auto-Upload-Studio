import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { TencentS3UploadService } from '../src/main/services/tencent-s3-upload.service'

test('uses path-style S3 V4 requests for Tencent TurboS3', async () => {
  const requests: Array<{
    method: string
    url: string
    authorization: string
  }> = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method || '',
      url: request.url || '',
      authorization: request.headers.authorization || ''
    })
    request.resume()
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end(
        '<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><KeyCount>0</KeyCount></ListBucketResult>'
      )
      return
    }
    response.writeHead(200, { ETag: '"test"' })
    response.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const config = {
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: 'bucket',
    region: 'us-east-1',
    prefix: 'upload/user/',
    accessKeyId: 'test-key',
    accessKeySecret: 'test-secret',
    allowInsecureTls: false
  }
  const service = new TencentS3UploadService()

  try {
    assert.deepEqual(await service.testConnection(config), { ok: true })
    const uploader = service.createTaskUploader(config)
    await uploader.uploadBuffer(
      Buffer.from('test'),
      'upload/user/2026-06-18/04-39-04/a.csv'
    )
    uploader.dispose()
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }

  assert.equal(requests[0].method, 'GET')
  assert.match(requests[0].url, /^\/bucket\/\?/)
  assert.equal(requests[1].method, 'PUT')
  assert.equal(
    requests[1].url,
    '/bucket/upload/user/2026-06-18/04-39-04/a.csv?x-id=PutObject'
  )
  assert.match(requests[1].authorization, /^AWS4-HMAC-SHA256 /)
})

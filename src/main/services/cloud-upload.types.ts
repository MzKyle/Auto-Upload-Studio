import type { CloudProvider } from '@shared/types'

export interface CloudFileUploadResult {
  objectKey: string
  uploadId?: string
}

export interface CloudTaskUploader {
  provider: CloudProvider
  uploadFile: (
    filePath: string,
    objectKey: string,
    fileSize: number,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal
  ) => Promise<CloudFileUploadResult>
  uploadBuffer: (buffer: Buffer, objectKey: string, signal?: AbortSignal) => Promise<string>
  abort: () => void
  dispose: () => void
}

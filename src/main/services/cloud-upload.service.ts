import type { AppSettings, CloudProvider } from '@shared/types'
import { getOSSUploadService } from './oss-upload.service'
import { getTencentS3UploadService } from './tencent-s3-upload.service'
import type { CloudTaskUploader } from './cloud-upload.types'

export class CloudUploadService {
  async createTaskUploader(
    provider: CloudProvider,
    settings: AppSettings,
    multipartThreshold?: number
  ): Promise<CloudTaskUploader> {
    if (provider === 'aliyun') {
      return getOSSUploadService().createTaskUploader(settings.oss, multipartThreshold)
    }
    return getTencentS3UploadService().createTaskUploader(
      settings.tencentS3,
      multipartThreshold
    )
  }

  validateProvider(provider: CloudProvider, settings: AppSettings): string | null {
    if (provider === 'aliyun') {
      if (!settings.oss.region.trim()) return '阿里云 Region 不能为空'
      if (!settings.oss.bucket.trim()) return '阿里云 Bucket 不能为空'
      if (!settings.oss.accessKeyId.trim()) return '阿里云 AccessKey ID 不能为空'
      if (!settings.oss.accessKeySecret.trim()) return '阿里云 AccessKey Secret 不能为空'
      return null
    }
    const error = getTencentS3UploadService().validateConfig(settings.tencentS3)
    return error ? `腾讯云 ${error}` : null
  }
}

let instance: CloudUploadService | null = null
export function getCloudUploadService(): CloudUploadService {
  if (!instance) instance = new CloudUploadService()
  return instance
}

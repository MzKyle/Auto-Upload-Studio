import type {
  AppSettings,
  CloudProvider,
  FileStatus,
  TaskStatus,
  UploadTargetMode
} from './types'

export function providersForMode(mode: UploadTargetMode): CloudProvider[] {
  if (mode === 'both') return ['aliyun', 'tencent']
  return [mode]
}

export function modeForProviders(providers: CloudProvider[]): UploadTargetMode {
  const set = new Set(providers)
  if (set.has('aliyun') && set.has('tencent')) return 'both'
  return set.has('tencent') ? 'tencent' : 'aliyun'
}

export function getUploadTargetSnapshot(settings: AppSettings): {
  mode: UploadTargetMode
  prefixes: Record<CloudProvider, string>
} {
  return {
    mode: settings.cloud.targetMode,
    prefixes: {
      aliyun: settings.oss.prefix || '',
      tencent: settings.tencentS3.prefix || ''
    }
  }
}

export function progressKey(taskId: string, provider: CloudProvider): string {
  return `${taskId}:${provider}`
}

export function deriveLogicalFileStatus(statuses: FileStatus[]): FileStatus {
  if (statuses.length > 0 && statuses.every((status) => status === 'completed')) {
    return 'completed'
  }
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'uploading')) return 'uploading'
  return 'pending'
}

export function deriveTaskStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.length > 0 && statuses.every((status) => status === 'completed')) {
    return 'completed'
  }
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'paused')) return 'paused'
  if (statuses.some((status) => status === 'uploading')) return 'uploading'
  if (statuses.some((status) => status === 'scanning')) return 'scanning'
  return 'pending'
}

import type {
  AppSettings,
  CloudProvider,
  FileStatus,
  TaskStatus,
  UploadPathMode,
  UploadProfile,
  UploadTargetMode
} from './types'
import {
  firstProviderUploadRelativePath,
  resolveProviderUploadRelativePaths,
  type UploadPathResolveContext
} from './upload-path'

export interface UploadTargetSnapshot {
  mode: UploadTargetMode
  prefixes: Record<CloudProvider, string>
  uploadRelativePaths: Partial<Record<CloudProvider, string>>
  uploadRelativePath: string
  profileId?: string
  profileName?: string
  profileSnapshot?: UploadProfile
  pathModes?: Partial<Record<CloudProvider, UploadPathMode>>
  objectKeyTemplates?: Partial<Record<CloudProvider, string | null>>
}

export function providersForMode(mode: UploadTargetMode): CloudProvider[] {
  if (mode === 'both') return ['aliyun', 'tencent']
  return [mode]
}

export function modeForProviders(providers: CloudProvider[]): UploadTargetMode {
  const set = new Set(providers)
  if (set.has('aliyun') && set.has('tencent')) return 'both'
  return set.has('tencent') ? 'tencent' : 'aliyun'
}

export function getUploadTargetSnapshot(
  settings: AppSettings,
  context?: UploadPathResolveContext
): UploadTargetSnapshot {
  return getUploadTargetSnapshotForProviders(
    providersForMode(settings.cloud.targetMode),
    settings,
    context
  )
}

export function getUploadTargetSnapshotForProviders(
  providers: CloudProvider[],
  settings: AppSettings,
  context?: UploadPathResolveContext
): UploadTargetSnapshot {
  const uploadRelativePaths = context
    ? resolveProviderUploadRelativePaths(settings, providers, context)
    : {}

  return {
    mode: modeForProviders(providers),
    prefixes: {
      aliyun: settings.oss.prefix || '',
      tencent: settings.tencentS3.prefix || ''
    },
    uploadRelativePaths,
    uploadRelativePath: firstProviderUploadRelativePath(
      providers,
      uploadRelativePaths,
      ''
    ),
    pathModes: {
      aliyun: settings.oss.pathMode,
      tencent: settings.tencentS3.pathMode
    },
    objectKeyTemplates: {}
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
  if (statuses.length > 0 && statuses.every((status) => status === 'skipped')) {
    return 'skipped'
  }
  if (statuses.some((status) => status === 'uploading')) return 'uploading'
  return 'pending'
}

export function deriveTaskStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.length > 0 && statuses.every((status) => status === 'completed')) {
    return 'completed'
  }
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'paused')) return 'paused'
  if (statuses.some((status) => status === 'retrying')) return 'retrying'
  if (statuses.some((status) => status === 'uploading')) return 'uploading'
  if (statuses.some((status) => status === 'scanning')) return 'scanning'
  if (statuses.length > 0 && statuses.every((status) => status === 'skipped')) {
    return 'skipped'
  }
  if (
    statuses.length > 0 &&
    statuses.every((status) => status === 'synced' || status === 'completed')
  ) {
    return 'synced'
  }
  return 'pending'
}

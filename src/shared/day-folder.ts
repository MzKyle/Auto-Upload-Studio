import type { DayFolderStatus, TaskStatus } from './types'

const DATE_FOLDER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateFolderName(name: string): Date | null {
  const match = DATE_FOLDER_PATTERN.exec(name)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  parsed.setHours(0, 0, 0, 0)
  return parsed
}

export function isDateFolderName(name: string): boolean {
  return parseDateFolderName(name) !== null
}

export function isDateFolderBeforeToday(name: string, now = new Date()): boolean {
  const folderDate = parseDateFolderName(name)
  if (!folderDate) return false

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return folderDate.getTime() < today.getTime()
}

export function determineDayFolderStatus(
  dateName: string,
  childStatuses: Array<TaskStatus | null>,
  now = new Date()
): DayFolderStatus {
  if (childStatuses.some((status) => status === 'failed' || status === 'paused')) {
    return 'blocked'
  }

  const allTerminal =
    childStatuses.length > 0 &&
    childStatuses.every(
      (status) =>
        status === 'completed' ||
        status === 'synced' ||
        status === 'skipped'
    )

  if (allTerminal && isDateFolderBeforeToday(dateName, now)) {
    return childStatuses.some((status) => status === 'skipped')
      ? 'completed_with_skips'
      : 'completed'
  }

  if (
    childStatuses.some(
      (status) =>
        status === null ||
        status === 'pending' ||
        status === 'scanning' ||
        status === 'uploading' ||
        status === 'retrying'
    )
  ) {
    return 'processing'
  }

  return 'collecting'
}

export function joinOssPath(...parts: Array<string | null | undefined>): string {
  return parts
    .flatMap((part) => (part || '').replace(/\\/g, '/').split('/'))
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.')
    .join('/')
}

export function buildUploadRelativePath(dateFolder: string, childFolder: string): string {
  return joinOssPath(dateFolder, childFolder)
}

function pathSegments(directoryPath: string): string[] {
  return directoryPath
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.')
}

export function deriveDateScopedUploadRelativePath(
  directoryPath: string
): string | null {
  const segments = pathSegments(directoryPath)
  const folderName = segments.at(-1)
  if (!folderName) return null

  if (isDateFolderName(folderName)) {
    return folderName
  }

  const parentName = segments.at(-2)
  if (parentName && isDateFolderName(parentName)) {
    return buildUploadRelativePath(parentName, folderName)
  }

  return null
}

export function resolveDirectoryUploadRelativePath(
  directoryPath: string,
  fallbackDirectoryPath?: string
): string {
  const dateScopedPath =
    deriveDateScopedUploadRelativePath(directoryPath) ||
    (fallbackDirectoryPath
      ? deriveDateScopedUploadRelativePath(fallbackDirectoryPath)
      : null)
  if (dateScopedPath) return dateScopedPath

  const primaryFolderName = pathSegments(directoryPath).at(-1)
  const fallbackFolderName = fallbackDirectoryPath
    ? pathSegments(fallbackDirectoryPath).at(-1)
    : null
  return primaryFolderName || fallbackFolderName || ''
}

export function buildOssKey(
  prefix: string,
  uploadRelativePath: string,
  fileRelativePath: string
): string {
  return joinOssPath(prefix, uploadRelativePath, fileRelativePath)
}

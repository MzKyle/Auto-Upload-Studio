import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { MARKER_FILES } from '@shared/constants'
import type { TmpUploadMarker, ProcessTaskMarker, DayUploadMarker } from '@shared/types'

export function readTmpUpload(folderPath: string): TmpUploadMarker | null {
  const filePath = join(folderPath, MARKER_FILES.TMP_UPLOAD)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function writeTmpUpload(folderPath: string, marker: TmpUploadMarker): void {
  const filePath = join(folderPath, MARKER_FILES.TMP_UPLOAD)
  writeFileSync(filePath, JSON.stringify(marker, null, 2), 'utf-8')
}

export function readProcessTask(folderPath: string): ProcessTaskMarker | null {
  const filePath = join(folderPath, MARKER_FILES.PROCESS_TASK)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function writeProcessTask(folderPath: string, marker: ProcessTaskMarker): void {
  const filePath = join(folderPath, MARKER_FILES.PROCESS_TASK)
  writeFileSync(filePath, JSON.stringify(marker, null, 2), 'utf-8')
}

export function readDayUpload(folderPath: string): DayUploadMarker | null {
  const filePath = join(folderPath, MARKER_FILES.DAY_UPLOAD)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function writeDayUpload(folderPath: string, marker: DayUploadMarker): void {
  const filePath = join(folderPath, MARKER_FILES.DAY_UPLOAD)
  writeFileSync(filePath, JSON.stringify(marker, null, 2), 'utf-8')
}

export function removeDayUpload(folderPath: string): void {
  const filePath = join(folderPath, MARKER_FILES.DAY_UPLOAD)
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

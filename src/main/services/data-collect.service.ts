import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import log from 'electron-log'
import type { DataCollectInfo } from '@shared/types'

const MAX_ITEMS = 100

/**
 * 数采模式服务
 * 移植自 clean.py 的 collect_data_info / collect_all_data_info
 * 只读取数据，不修改/删除文件
 */
export class DataCollectService {
  private cache: Map<string, DataCollectInfo> = new Map()

  getAll(): DataCollectInfo[] {
    return Array.from(this.cache.values())
  }

  getByPath(folderPath: string): DataCollectInfo | null {
    return this.cache.get(folderPath) || null
  }

  /**
   * 采集单个数据文件夹的元信息
   * 前提：文件夹中必须含有 welding_state/weld_signal.csv
   * @returns DataCollectInfo 或 null（不满足数采条件时）
   */
  collectDataInfo(folderPath: string): DataCollectInfo | null {
    const weldSignalPath = join(folderPath, 'welding_state', 'weld_signal.csv')
    if (!existsSync(weldSignalPath)) {
      return null
    }

    const folderName = basename(folderPath)
    const dateStr = parseDateFromPath(folderPath)

    const info: DataCollectInfo = {
      folderPath,
      folderName,
      date: dateStr,
      sessionTime: folderName,
      weldSignal: {
        arcStartUs: null,
        arcEndUs: null,
        arcStartTime: null,
        arcEndTime: null,
        durationSeconds: null
      },
      cameras: [],
      robotState: {
        jointStateRows: 0,
        toolPoseRows: 0,
        hasCalibration: false
      },
      controlCmd: {
        speedRows: 0,
        freqRows: 0
      },
      pointCloudCount: 0,
      depthImageCount: 0,
      totalFileCount: 0,
      totalSizeBytes: 0,
      collectedAt: new Date().toISOString()
    }

    // --- 焊接信号 ---
    try {
      const { startTime, endTime } = readWeldSignal(weldSignalPath)
      info.weldSignal.arcStartUs = startTime
      info.weldSignal.arcEndUs = endTime
      info.weldSignal.arcStartTime = usToTimeStr(dateStr, startTime)
      info.weldSignal.arcEndTime = usToTimeStr(dateStr, endTime)
      if (startTime !== null && endTime !== null) {
        info.weldSignal.durationSeconds = Math.round((endTime - startTime) / 1000) / 1000
      }
    } catch (err) {
      log.warn('读取焊接信号失败:', err)
    }

    // --- 相机目录 ---
    try {
      const entries = readdirSync(folderPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('camera'))
        .sort((a, b) => a.name.localeCompare(b.name))

      for (const entry of entries) {
        const camPath = join(folderPath, entry.name)
        const { tsMin, tsMax, count } = getImageTimestampRange(camPath)
        info.cameras.push({
          name: entry.name,
          imageCount: count,
          tsMinUs: tsMin,
          tsMaxUs: tsMax,
          tsMinTime: usToTimeStr(dateStr, tsMin),
          tsMaxTime: usToTimeStr(dateStr, tsMax)
        })
      }
    } catch {
      // ignore
    }

    // --- 机器人状态 ---
    const jointCsv = join(folderPath, 'robot_state', 'joint_state.csv')
    if (existsSync(jointCsv)) {
      info.robotState.jointStateRows = readCsvTimestamps(jointCsv).count
    }
    const toolCsv = join(folderPath, 'robot_state', 'tool_pose.csv')
    if (existsSync(toolCsv)) {
      info.robotState.toolPoseRows = readCsvTimestamps(toolCsv).count
    }
    const calibCsv = join(folderPath, 'robot_state', 'calibration.csv')
    info.robotState.hasCalibration = existsSync(calibCsv)

    // --- 控制指令 ---
    const speedCsv = join(folderPath, 'control_cmd', 'control_speed.csv')
    if (existsSync(speedCsv)) {
      info.controlCmd.speedRows = readCsvTimestamps(speedCsv).count
    }
    const freqCsv = join(folderPath, 'control_cmd', 'control_freq.csv')
    if (existsSync(freqCsv)) {
      info.controlCmd.freqRows = readCsvTimestamps(freqCsv).count
    }

    // --- 点云 ---
    const pcDir = join(folderPath, 'scan_point_cloud')
    info.pointCloudCount = countFiles(pcDir, '.bin') + countFiles(pcDir, '.ply')

    // --- 深度图 ---
    const depthDir = join(folderPath, 'camera_depth')
    info.depthImageCount = countFiles(depthDir, '.jpg') + countFiles(depthDir, '.ply')

    // --- 统计总文件数和总大小 ---
    const { fileCount, totalSize } = walkDirStats(folderPath)
    info.totalFileCount = fileCount
    info.totalSizeBytes = totalSize

    // 存入缓存（LRU）
    this.cache.set(folderPath, info)
    if (this.cache.size > MAX_ITEMS) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    log.info(`[数采模式] ${folderName}: 焊接${info.weldSignal.durationSeconds ?? 'N/A'}s, ${info.cameras.length}相机, ${info.totalFileCount}文件`)
    return info
  }
}

// ---- 辅助函数 ----

function parseDateFromPath(path: string): string | null {
  const pat = /(\d{4}-\d{2}-\d{2})/
  const parts = path.replace(/\\/g, '/').split('/').reverse()
  for (const part of parts) {
    const m = pat.exec(part)
    if (m) return m[1]
  }
  return null
}

function usToTimeStr(dateStr: string | null, microseconds: number | null): string | null {
  if (dateStr === null || microseconds === null) return null
  try {
    const base = new Date(dateStr + 'T00:00:00')
    const ms = microseconds / 1000
    const ts = new Date(base.getTime() + ms)
    const pad = (n: number, d = 2) => String(n).padStart(d, '0')
    return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.${pad(ts.getMilliseconds(), 3)}`
  } catch {
    return String(microseconds)
  }
}

function readWeldSignal(filePath: string): { startTime: number | null; endTime: number | null } {
  let startTime: number | null = null
  let endTime: number | null = null

  const content = readFileSync(filePath, 'utf-8')
  const pat = /^\s*(\d+)\s+[^:]*:\s*(true|false)\s*$/i
  const tsPat = /(\d+)/
  const boolPat = /(true|false)/i

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    let ts: number
    let valTrue: boolean

    const m = pat.exec(line)
    if (m) {
      ts = parseInt(m[1])
      valTrue = m[2].toLowerCase() === 'true'
    } else {
      const tsMatch = tsPat.exec(line)
      const boolMatch = boolPat.exec(line)
      if (!tsMatch || !boolMatch) continue
      ts = parseInt(tsMatch[1])
      valTrue = boolMatch[1].toLowerCase() === 'true'
    }

    if (valTrue) {
      if (startTime === null) startTime = ts
    } else {
      endTime = ts
    }
  }

  return { startTime, endTime }
}

function readCsvTimestamps(filePath: string): { tsMin: number | null; tsMax: number | null; count: number } {
  let tsMin: number | null = null
  let tsMax: number | null = null
  let count = 0

  try {
    const content = readFileSync(filePath, 'utf-8')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      const parts = line.split(/[,\s]+/)
      if (!parts[0]) continue
      const ts = parseInt(parts[0])
      if (isNaN(ts)) continue
      count++
      if (tsMin === null || ts < tsMin) tsMin = ts
      if (tsMax === null || ts > tsMax) tsMax = ts
    }
  } catch {
    // ignore
  }

  return { tsMin, tsMax, count }
}

function countFiles(folderPath: string, ext?: string): number {
  if (!existsSync(folderPath)) return 0
  try {
    const entries = readdirSync(folderPath)
    let count = 0
    for (const entry of entries) {
      if (ext && !entry.toLowerCase().endsWith(ext)) continue
      try {
        const stat = statSync(join(folderPath, entry))
        if (stat.isFile()) count++
      } catch {
        // ignore
      }
    }
    return count
  } catch {
    return 0
  }
}

function getImageTimestampRange(folderPath: string): { tsMin: number | null; tsMax: number | null; count: number } {
  let tsMin: number | null = null
  let tsMax: number | null = null
  let count = 0

  if (!existsSync(folderPath)) return { tsMin, tsMax, count }

  try {
    const entries = readdirSync(folderPath)
    for (const filename of entries) {
      if (!filename.toLowerCase().endsWith('.jpg')) continue
      const nameNoExt = filename.slice(0, filename.lastIndexOf('.'))
      const ts = parseInt(nameNoExt)
      if (isNaN(ts)) continue
      count++
      if (tsMin === null || ts < tsMin) tsMin = ts
      if (tsMax === null || ts > tsMax) tsMax = ts
    }
  } catch {
    // ignore
  }

  return { tsMin, tsMax, count }
}

function walkDirStats(dirPath: string): { fileCount: number; totalSize: number } {
  let fileCount = 0
  let totalSize = 0

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile()) {
          fileCount++
          try {
            totalSize += statSync(fullPath).size
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  walk(dirPath)
  return { fileCount, totalSize }
}

let instance: DataCollectService | null = null
export function getDataCollectService(): DataCollectService {
  if (!instance) instance = new DataCollectService()
  return instance
}

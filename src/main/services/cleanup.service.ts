import { existsSync, rmSync } from 'fs'
import log from 'electron-log'
import { getTaskRepo } from '../db/task.repo'
import { getDayFolderRepo } from '../db/day-folder.repo'
import { getSettingsRepo } from '../db/settings.repo'
import type { CleanupConfig } from '@shared/types'

/**
 * 自动清理服务
 * 定期删除已完成上传的本地文件夹，释放磁盘空间
 * 仅清理 sourceType 为 'local'（自动扫描）或 'rsync' 的任务
 * 手动添加的文件夹（sourceType='manual'）不参与清理
 */
export class CleanupService {
  private timer: ReturnType<typeof setInterval> | null = null
  private pendingRun: ReturnType<typeof setTimeout> | null = null
  private running = false

  start(): void {
    if (this.timer) return
    // 启动时延迟 30 秒执行第一次，之后每小时执行
    this.scheduleCleanup(30000)
    this.timer = setInterval(() => this.cleanup(), 3600000)
    log.info('自动清理服务已启动')
  }

  stop(): void {
    if (this.pendingRun) {
      clearTimeout(this.pendingRun)
      this.pendingRun = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    log.info('自动清理服务已停止')
  }

  scheduleCleanup(delayMs = 0): void {
    if (this.pendingRun) {
      clearTimeout(this.pendingRun)
    }

    this.pendingRun = setTimeout(() => {
      this.pendingRun = null
      this.cleanup()
    }, Math.max(0, delayMs))
  }

  cleanup(): void {
    if (this.running) return
    this.running = true

    try {
      const settings = getSettingsRepo()
      const config = settings.get<CleanupConfig>('cleanup')
      if (!config?.enabled) return

      const retentionDays = this.normalizeRetentionDays(config)
      const taskRepo = getTaskRepo()
      const dayFolderRepo = getDayFolderRepo()
      const tasks = taskRepo.getCompletedForCleanup(retentionDays)
      const dayFolders = dayFolderRepo.getCompletedForCleanup(retentionDays)

      if (tasks.length === 0 && dayFolders.length === 0) return

      log.info(
        `自动清理: 发现 ${dayFolders.length} 个日期目录和 ${tasks.length} 个独立任务可清理 ` +
        `(保留天数: ${retentionDays})`
      )

      let cleaned = 0
      for (const dayFolder of dayFolders) {
        try {
          if (!existsSync(dayFolder.folderPath)) {
            continue
          }
          rmSync(dayFolder.folderPath, { recursive: true, force: true })
          cleaned++
          log.info(
            `自动清理: 已删除日期目录 ${dayFolder.folderPath} ` +
            `(日期目录ID: ${dayFolder.id}, 完成于: ${dayFolder.completedAt})`
          )
        } catch (err) {
          log.error(`自动清理日期目录失败: ${dayFolder.folderPath}`, err)
        }
      }

      for (const task of tasks) {
        try {
          if (!existsSync(task.folderPath)) {
            continue
          }
          rmSync(task.folderPath, { recursive: true, force: true })
          cleaned++
          log.info(`自动清理: 已删除 ${task.folderPath} (任务ID: ${task.id}, 完成于: ${task.completedAt})`)
        } catch (err) {
          log.error(`自动清理失败: ${task.folderPath}`, err)
        }
      }

      if (cleaned > 0) {
        log.info(`自动清理完成: 共删除 ${cleaned} 个文件夹`)
      }
    } catch (err) {
      log.error('自动清理服务异常:', err)
    } finally {
      this.running = false
    }
  }

  private normalizeRetentionDays(config: CleanupConfig): number {
    if (!Number.isFinite(config.retentionDays)) {
      return 7
    }

    return Math.max(0, Math.floor(config.retentionDays))
  }
}

let instance: CleanupService | null = null
export function getCleanupService(): CleanupService {
  if (!instance) instance = new CleanupService()
  return instance
}

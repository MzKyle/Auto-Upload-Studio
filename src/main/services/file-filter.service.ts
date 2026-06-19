import { readdirSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import type { FilterRules } from '@shared/types'

/**
 * 文件过滤规则引擎
 * 优先级：白名单 > 黑名单 > 正则排除 > 后缀匹配
 */
export class FileFilterService {
  private rules: FilterRules

  constructor(rules: FilterRules) {
    this.rules = rules
  }

  updateRules(rules: FilterRules): void {
    this.rules = rules
  }

  /**
   * 判断单个文件是否应该被包含
   * @param relativePath 文件相对路径
   * @returns true = 包含, false = 排除
   */
  shouldInclude(relativePath: string): boolean {
    const fileName = basename(relativePath)
    const ext = extname(relativePath).toLowerCase()

    // 1. 白名单（最高优先级）：匹配则直接包含
    if (this.rules.whitelist.length > 0) {
      for (const pattern of this.rules.whitelist) {
        if (this.matchPattern(fileName, relativePath, pattern)) {
          return true
        }
      }
    }

    // 2. 黑名单：匹配则排除
    if (this.rules.blacklist.length > 0) {
      for (const pattern of this.rules.blacklist) {
        if (this.matchPattern(fileName, relativePath, pattern)) {
          return false
        }
      }
    }

    // 3. 正则排除：匹配则排除
    if (this.rules.regex.length > 0) {
      for (const pattern of this.rules.regex) {
        try {
          const re = new RegExp(pattern)
          if (re.test(relativePath) || re.test(fileName)) {
            return false
          }
        } catch {
          // 无效正则，跳过
        }
      }
    }

    // 4. 后缀匹配：如果配置了后缀列表，只包含匹配的
    if (this.rules.suffixes.length > 0) {
      return this.rules.suffixes.some((suffix) => ext === this.normalizeSuffix(suffix))
    }

    // 未配置任何后缀规则时默认包含
    return true
  }

  /**
   * 递归扫描文件夹，返回过滤后的文件列表
   */
  scanFolder(folderPath: string): Array<{ relativePath: string; absolutePath: string; size: number }> {
    const results: Array<{ relativePath: string; absolutePath: string; size: number }> = []
    this.walkDir(folderPath, folderPath, results)
    return results
  }

  private walkDir(
    basePath: string,
    currentPath: string,
    results: Array<{ relativePath: string; absolutePath: string; size: number }>
  ): void {
    const entries = readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        // 跳过隐藏目录
        if (entry.name.startsWith('.')) continue
        this.walkDir(basePath, fullPath, results)
      } else if (entry.isFile()) {
        const relativePath = fullPath.slice(basePath.length + 1)
        // 跳过标记文件
        if (
          entry.name === 'tmp_upload.json' ||
          entry.name === 'process_task.json' ||
          entry.name === 'day_upload.json'
        ) continue
        if (this.shouldInclude(relativePath)) {
          const stat = statSync(fullPath)
          results.push({ relativePath, absolutePath: fullPath, size: stat.size })
        }
      }
    }
  }

  private matchPattern(fileName: string, relativePath: string, pattern: string): boolean {
    // 完全匹配文件名
    if (fileName === pattern) return true
    // 后缀匹配（如 .jpg）
    if (pattern.startsWith('.') && extname(fileName).toLowerCase() === pattern.toLowerCase()) return true
    // 通配符简单匹配（如 *.log, data_*.csv）
    if (pattern.includes('*')) {
      const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      try {
        const re = new RegExp(regexStr, 'i')
        if (re.test(fileName) || re.test(relativePath)) return true
      } catch {
        // 无效模式
      }
    }
    return false
  }

  private normalizeSuffix(suffix: string): string {
    const trimmed = suffix.trim().toLowerCase()
    if (!trimmed) return ''
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
  }
}

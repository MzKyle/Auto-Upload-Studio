import { getDb } from './database'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { basename, dirname, normalize } from 'path'
import { isDateFolderName } from '@shared/day-folder'

function normalizeSuffixes(suffixes: string[]): string[] {
  const normalized = suffixes
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean)
    .map((suffix) => (suffix.startsWith('.') ? suffix : `.${suffix}`))

  const unique = Array.from(new Set(normalized))
  if (!unique.includes('.csv')) unique.push('.csv')
  return unique
}

function normalizeScanDirectories(directories: string[]): string[] {
  return Array.from(
    new Set(
      directories
        .map((directory) => normalize(directory).replace(/[\\/]+$/, ''))
        .filter(Boolean)
        .map((directory) =>
          isDateFolderName(basename(directory)) ? dirname(directory) : directory
        )
    )
  )
}

export class SettingsRepo {
  get<T>(key: string): T | null {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return null
    try {
      const parsed = JSON.parse(row.value) as T
      if (
        key === 'filter' &&
        typeof parsed === 'object' &&
        parsed !== null &&
        'suffixes' in (parsed as Record<string, unknown>) &&
        Array.isArray((parsed as Record<string, unknown>).suffixes)
      ) {
        const filter = parsed as Record<string, unknown>
        filter.suffixes = normalizeSuffixes(filter.suffixes as string[])
      }
      if (
        key === 'scan' &&
        typeof parsed === 'object' &&
        parsed !== null &&
        'directories' in (parsed as Record<string, unknown>) &&
        Array.isArray((parsed as Record<string, unknown>).directories)
      ) {
        const scan = parsed as Record<string, unknown>
        scan.directories = normalizeScanDirectories(scan.directories as string[])
      }
      return parsed
    } catch {
      return row.value as unknown as T
    }
  }

  set(key: string, value: unknown): void {
    const db = getDb()
    const now = new Date().toISOString()
    let persistedValue = value

    if (
      key === 'filter' &&
      typeof value === 'object' &&
      value !== null &&
      'suffixes' in (value as Record<string, unknown>) &&
      Array.isArray((value as Record<string, unknown>).suffixes)
    ) {
      const filter = value as Record<string, unknown>
      persistedValue = {
        ...filter,
        suffixes: normalizeSuffixes(filter.suffixes as string[])
      }
    }
    if (
      key === 'scan' &&
      typeof value === 'object' &&
      value !== null &&
      'directories' in (value as Record<string, unknown>) &&
      Array.isArray((value as Record<string, unknown>).directories)
    ) {
      const scan = value as Record<string, unknown>
      persistedValue = {
        ...scan,
        directories: normalizeScanDirectories(scan.directories as string[])
      }
    }

    const serialized = typeof persistedValue === 'string' ? persistedValue : JSON.stringify(persistedValue)
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
    ).run(key, serialized, now, serialized, now)
  }

  getAll(): AppSettings {
    const settings = { ...DEFAULT_SETTINGS }

    const keys: Array<{ section: keyof AppSettings; key: string }> = [
      { section: 'scan', key: 'scan' },
      { section: 'upload', key: 'upload' },
      { section: 'cloud', key: 'cloud' },
      { section: 'oss', key: 'oss' },
      { section: 'tencentS3', key: 'tencentS3' },
      { section: 'filter', key: 'filter' },
      { section: 'webhook', key: 'webhook' },
      { section: 'stability', key: 'stability' },
      { section: 'log', key: 'log' },
      { section: 'dataCollect', key: 'dataCollect' },
      { section: 'cleanup', key: 'cleanup' }
    ]

    for (const { section, key } of keys) {
      const val = this.get(key)
      if (val !== null) {
        const defaultSection = (settings as Record<string, unknown>)[section]
        if (
          typeof defaultSection === 'object' &&
          defaultSection !== null &&
          typeof val === 'object' &&
          val !== null
        ) {
          ; (settings as Record<string, unknown>)[section] = {
            ...(defaultSection as Record<string, unknown>),
            ...(val as Record<string, unknown>)
          }
        } else {
          ; (settings as Record<string, unknown>)[section] = val
        }
      }
    }

    const hotkey = this.get<string>('hotkey')
    if (hotkey) settings.hotkey = hotkey

    if (settings.filter && Array.isArray(settings.filter.suffixes)) {
      settings.filter.suffixes = normalizeSuffixes(settings.filter.suffixes)
    }

    return settings
  }

  saveAll(partial: Partial<AppSettings>): void {
    const db = getDb()
    const transaction = db.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) {
          this.set(key, value)
        }
      }
    })
    transaction()
  }
}

let instance: SettingsRepo | null = null
export function getSettingsRepo(): SettingsRepo {
  if (!instance) instance = new SettingsRepo()
  return instance
}

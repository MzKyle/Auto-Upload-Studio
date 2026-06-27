import { getDb } from './database'
import { DEFAULT_SETTINGS } from '@shared/constants'
import {
  normalizeScanConfig,
  normalizeScanDirectories,
  normalizeProviderDirectories
} from '@shared/scan-config'
import { normalizeUploadPathConfig } from '@shared/upload-path'
import type { AppSettings, CloudConfig, ScanConfig } from '@shared/types'

function normalizeSuffixes(suffixes: string[]): string[] {
  const normalized = suffixes
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean)
    .map((suffix) => (suffix.startsWith('.') ? suffix : `.${suffix}`))

  const unique = Array.from(new Set(normalized))
  if (!unique.includes('.csv')) unique.push('.csv')
  return unique
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
        if (
          'providerDirectories' in scan &&
          typeof scan.providerDirectories === 'object' &&
          scan.providerDirectories !== null
        ) {
          scan.providerDirectories = normalizeProviderDirectories(
            scan.providerDirectories as Partial<ScanConfig['providerDirectories']>
          )
        }
      }
      if (
        (key === 'oss' || key === 'tencentS3') &&
        typeof parsed === 'object' &&
        parsed !== null
      ) {
        return normalizeUploadPathConfig(
          parsed as unknown as Record<string, unknown>
        ) as T
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
      const cloud = this.get<CloudConfig>('cloud')
      persistedValue = {
        ...scan,
        ...normalizeScanConfig(
          {
            ...(DEFAULT_SETTINGS.scan as ScanConfig),
            ...(scan as Partial<ScanConfig>)
          },
          cloud?.targetMode || DEFAULT_SETTINGS.cloud.targetMode
        )
      }
    }
    if (
      (key === 'oss' || key === 'tencentS3') &&
      typeof value === 'object' &&
      value !== null
    ) {
      persistedValue = normalizeUploadPathConfig(
        value as unknown as Record<string, unknown>
      )
    }

    const serialized = typeof persistedValue === 'string' ? persistedValue : JSON.stringify(persistedValue)
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
    ).run(key, serialized, now, serialized, now)
  }

  getAll(): AppSettings {
    const settings = { ...DEFAULT_SETTINGS } as AppSettings
    const settingsRecord = settings as unknown as Record<string, unknown>

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
        const defaultSection = settingsRecord[section]
        if (
          typeof defaultSection === 'object' &&
          defaultSection !== null &&
          typeof val === 'object' &&
          val !== null
        ) {
          ; settingsRecord[section] = {
            ...(defaultSection as Record<string, unknown>),
            ...(val as Record<string, unknown>)
          }
        } else {
          ; settingsRecord[section] = val
        }
      }
    }

    const hotkey = this.get<string>('hotkey')
    if (hotkey) settings.hotkey = hotkey

    if (settings.filter && Array.isArray(settings.filter.suffixes)) {
      settings.filter.suffixes = normalizeSuffixes(settings.filter.suffixes)
    }
    settings.oss = normalizeUploadPathConfig(
      settings.oss as unknown as Record<string, unknown>
    ) as unknown as AppSettings['oss']
    settings.tencentS3 = normalizeUploadPathConfig(
      settings.tencentS3 as unknown as Record<string, unknown>
    ) as unknown as AppSettings['tencentS3']
    settings.scan = normalizeScanConfig(
      settings.scan,
      settings.cloud.targetMode
    )

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

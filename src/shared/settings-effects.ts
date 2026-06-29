import type { AppSettings } from './types'

type ScannerRelevantSettings = Pick<
  AppSettings,
  'scan' | 'stability' | 'profiles' | 'activeProfileId'
>

export function shouldRestartScannerAfterSettingsSave(
  data: Partial<ScannerRelevantSettings>
): boolean {
  return (
    data.scan !== undefined ||
    data.stability !== undefined ||
    data.profiles !== undefined ||
    data.activeProfileId !== undefined
  )
}

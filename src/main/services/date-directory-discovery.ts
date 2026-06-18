import { readdirSync } from 'fs'
import { join } from 'path'
import { isDateFolderName } from '@shared/day-folder'

export interface DiscoveredDayDirectory {
  dateName: string
  folderPath: string
  childFolderNames: string[]
}

export function discoverDayDirectories(rootDir: string): DiscoveredDayDirectory[] {
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        isDateFolderName(entry.name)
    )
    .map((entry) => {
      const folderPath = join(rootDir, entry.name)
      const childFolderNames = readdirSync(folderPath, { withFileTypes: true })
        .filter((child) => child.isDirectory() && !child.name.startsWith('.'))
        .map((child) => child.name)
        .sort()

      return {
        dateName: entry.name,
        folderPath,
        childFolderNames
      }
    })
    .sort((a, b) => a.dateName.localeCompare(b.dateName))
}

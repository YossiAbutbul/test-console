/**
 * Central registry of persistent storage keys.
 * Keep all keys here so we don't sprinkle string literals across the app.
 * Bump a key's version (e.g. `v2`) when its shape changes incompatibly.
 */
export const STORAGE_KEYS = {
  themePref: 'app-theme-pref',
  nicknames: 'mac-nicknames-v1',
  logWidth: 'log-panel-width-v1',
  activePage: 'active-page-v1',
  pathLossDb: 'path-loss-db-v1',
  pathLossTable: 'path-loss-table-v1',
  deviceType: 'device-type-v1',
  dcSupplyEnabled: 'dc-supply-enabled-v1',
  dcSupplyVoltage: 'dc-supply-voltage-v1',
  powerPage: 'power-page-snapshot-v1',
  lteCwPage: 'lte-cw-page-snapshot-v1',
  lteBands: 'lte-bands-v1',
  loadPullPage: 'load-pull-page-snapshot-v1',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

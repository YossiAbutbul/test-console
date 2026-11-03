/**
 * Central registry of persistent storage keys.
 * Keep all keys here so we don't sprinkle string literals across the app.
 * Bump a key's version (e.g. `v2`) when its shape changes incompatibly.
 */
export const STORAGE_KEYS = {
  themePref: 'app-theme-pref',
  selectOnFocus: 'select-on-focus-v1',
  nicknames: 'mac-nicknames-v1',
  logWidth: 'log-panel-width-v1',
  activePage: 'active-page-v1',
  pathLossDb: 'path-loss-db-v1',
  pathLossTable: 'path-loss-table-v1',
  deviceType: 'device-type-v1',
  dcSupplyEnabled: 'dc-supply-enabled-v1',
  dcSupplyVoltage: 'dc-supply-voltage-v1',
  powerPage: 'power-page-snapshot-v1',
  modulatedPage: 'modulated-page-snapshot-v1',
  lteCwPage: 'lte-cw-page-snapshot-v1',
  lteModulatedPage: 'lte-modulated-page-snapshot-v1',
  lteBands: 'lte-bands-v1',
  lteChannelUnit: 'lte-channel-unit-v1',
  loadPullPage: 'load-pull-page-snapshot-v1',
  // Its own snapshot, not the LoRa one: the two pages are mounted together,
  // and a channel spec typed in EARFCNs is not a LoRa frequency.
  lteLoadPullPage: 'lte-load-pull-page-snapshot-v1',
  smithStyle: 'smith-chart-style-v1',
  smithArea: 'smith-working-area-v1',
  smithDelay: 'smith-cable-delay-v1',
  smithAreaView: 'smith-area-view-v1',
  // v2: the continuous interval's default moved from 1000 ms to 400 ms, and a
  // stored v1 value would have shadowed it forever -- a default only applies
  // when nothing is saved.
  powerMeterPage: 'power-meter-page-snapshot-v2',
  signalGeneratorPage: 'signal-generator-page-snapshot-v1',
  dcAnalyzerPage: 'dc-analyzer-page-snapshot-v1',
  spectrumPage: 'spectrum-page-snapshot-v1',
  powerSweepPage: 'power-sweep-page-snapshot-v1',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

/**
 * Central registry of persistent storage keys.
 * Keep all keys here so we don't sprinkle string literals across the app.
 * Bump a key's version (e.g. `v2`) when its shape changes incompatibly.
 */
export const STORAGE_KEYS = {
  themePref: 'app-theme-pref',
  nicknames: 'mac-nicknames-v1',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

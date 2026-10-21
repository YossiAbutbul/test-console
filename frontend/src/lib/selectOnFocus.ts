/**
 * Whether focusing a field selects its text, so typing replaces the value.
 *
 * Off by default, at the operator's ask: clicking into a field to nudge one
 * digit selected the whole number, and the next keystroke wiped it. A
 * setting rather than a removal, since replacing a value outright is the
 * faster habit for some. Read from storage on every focus, so the toggle
 * applies at once to fields already on screen without threading it through
 * every page.
 */
import type { FocusEvent } from 'react'
import { storage, usePersistedState } from '../store/persistent'
import { STORAGE_KEYS } from '../store/keys'

const DEFAULT = false

/** Focus handler for any input: selects its text when the setting is on. */
export function selectOnFocus(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement | Element>): void {
  if (!storage.get<boolean>(STORAGE_KEYS.selectOnFocus, DEFAULT)) return
  // Only HTMLInputElement / HTMLTextAreaElement expose .select() -- guard for
  // the rest (a select's hidden input, a contenteditable).
  const t = e.target as Partial<HTMLInputElement>
  if (typeof t.select === 'function') t.select()
}

/** The setting itself, for the Settings menu. */
export function useSelectOnFocusSetting() {
  return usePersistedState<boolean>(STORAGE_KEYS.selectOnFocus, DEFAULT)
}

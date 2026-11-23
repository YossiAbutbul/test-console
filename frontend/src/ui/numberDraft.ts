import { useState, type ChangeEvent, type FocusEvent } from 'react'

type El = HTMLInputElement | HTMLTextAreaElement

/**
 * Lets a number field be emptied while the operator types over it.
 *
 * A field whose state is a number cannot hold "nothing": clearing it ran
 * `Number('')`, which is 0, and the 0 appeared in the box the moment it was
 * emptied -- so typing "5" over "20" gave "05", and a field clamped to a floor
 * (`|| 1`) could not be cleared at all.
 *
 * While the box is empty (or not yet a number, "-" on the way to "-5") the
 * change is held back here and the box shows empty; the parent keeps its last
 * value. Leaving the field empty puts that value back. A field whose state is
 * already a string handles empty itself (an optional bound, a validated
 * entry) and is passed through untouched.
 */
export function useNumberDraft(
  value: unknown,
  onChange?: (e: ChangeEvent<El>) => void,
  onBlur?: (e: FocusEvent<El>) => void,
) {
  const [empty, setEmpty] = useState(false)
  if (typeof value !== 'number') return { value, onChange, onBlur }
  return {
    value: empty ? '' : value,
    onChange: (e: ChangeEvent<El>) => {
      const text = e.target.value.trim()
      if (text === '' || !Number.isFinite(Number(text))) {
        setEmpty(true)
        return
      }
      setEmpty(false)
      onChange?.(e)
    },
    onBlur: (e: FocusEvent<El>) => {
      setEmpty(false)
      onBlur?.(e)
    },
  }
}

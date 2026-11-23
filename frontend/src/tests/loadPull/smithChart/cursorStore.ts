/**
 * The grid cell under the cursor, kept out of React state: it changes on
 * every mouse move, and as dialog state each move redrew the whole dialog.
 * Only the readout that shows it subscribes.
 */
export function createCursorStore() {
  let cell: number | null = null
  const subs = new Set<() => void>()
  return {
    get: () => cell,
    set: (c: number | null) => {
      if (c === cell) return
      cell = c
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => {
      subs.add(f)
      return () => { subs.delete(f) }
    },
  }
}
export type CursorStore = ReturnType<typeof createCursorStore>

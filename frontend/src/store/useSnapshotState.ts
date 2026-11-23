import { useEffect, useEffectEvent, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * `useState` mirrored into a page snapshot (store/makePageStore.ts).
 *
 * Replaces the three-part pattern every page field repeated -- read the
 * snapshot for the initial value, hold it in state, write it back from an
 * effect -- about seventy times across the sweep panels and Load Pull:
 *
 *   const [rows, setRows] = useSnapshotState(
 *     () => snap().rows ?? DEFAULT_ROWS,
 *     (v) => { snap().rows = v; persistPowerPage() },
 *   )
 *
 * The write stays in an effect, exactly as before: it runs after the render
 * that produced the value (including the first, so a normalised value read
 * back from storage is written back normalised), and `save` may close over
 * anything without being a dependency.
 */
export function useSnapshotState<T>(
  init: () => T,
  save: (value: T) => void,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(init)
  const write = useEffectEvent(save)
  useEffect(() => { write(value) }, [value])
  return [value, setValue]
}

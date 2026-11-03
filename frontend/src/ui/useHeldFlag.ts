import { useEffect, useRef, useState } from 'react'

/**
 * `flag`, shown at once and then held for at least `minMs` from when it
 * rose, however soon it drops.
 *
 * For busy indicators on work the operator asked for. A result that lands in
 * a tenth of a second otherwise flashes its spinner for a frame or two, or --
 * hidden behind a delay instead -- shows nothing at all, and the press seems
 * to have done nothing. Held, the indicator is seen, says the work happened,
 * and leaves.
 */
export function useHeldFlag(flag: boolean, minMs = 450): boolean {
  const [hold, setHold] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (flag) {
      since.current = performance.now()
      const t = window.setTimeout(() => setHold(true), 0)
      return () => window.clearTimeout(t)
    }
    const left = minMs - (performance.now() - since.current)
    const t = window.setTimeout(() => setHold(false), Math.max(0, left))
    return () => window.clearTimeout(t)
  }, [flag, minMs])
  return flag || hold
}

import { Suspense, createElement, useState, type ComponentType } from 'react'
import { lazyNamed } from './lazyNamed'

/**
 * A dialog whose code loads the first time it opens, for the results graphs:
 * recharts is a large share of the start-up bundle, and the graphs are opened
 * after a run, if at all. The first open waits for the chunk (a local fetch);
 * after that the dialog stays mounted, so closing it still animates.
 */
export function lazyOnOpen<P extends { open: boolean }, K extends string>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
) {
  const Lazy = lazyNamed(load, name)
  return function LazyDialog(props: P) {
    const [wanted, setWanted] = useState(props.open)
    // Derived from a prop while rendering, as React documents for it.
    if (props.open && !wanted) setWanted(true)
    if (!wanted) return null
    return createElement(Suspense, { fallback: null }, createElement(Lazy, props))
  }
}

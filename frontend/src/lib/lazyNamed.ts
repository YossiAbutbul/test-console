import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * `React.lazy` for a module's named export -- the codebase exports components
 * by name, and `lazy` wants a default.
 *
 * Used to keep the heaviest dependencies out of the start-up bundle: before,
 * everything shipped as one 4.4 MB chunk, about 3.5 MB of it FortuneSheet
 * (Reports page only) and recharts (Spectrum page and the results graphs),
 * all parsed before the first paint. A lazy component still has to sit under
 * a `<Suspense>`; pages get one in App's PageSlot.
 */
export function lazyNamed<P, K extends string>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => load().then((m) => ({ default: m[name] })))
}

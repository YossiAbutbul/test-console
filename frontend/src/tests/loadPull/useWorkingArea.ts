import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFields, computeArea, type AreaResult, type Quantity } from './areaCompute'
import type { AreaJob } from './areaWorker'
import type { Limits, Sample } from './workingArea'

let worker: Worker | null = null
const getWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null
  worker ??= new Worker(new URL('./areaWorker.ts', import.meta.url), { type: 'module' })
  return worker
}

/**
 * The samples' content as a short key (FNV-1a over the rounded values), so
 * two arrays holding the same points are the same work. Keyed on identity
 * instead, every reopen of the dialog -- which rebuilds the arrays from the
 * same rows -- started again from nothing.
 */
const sampleKeys = new WeakMap<Sample[][], string>()
export function samplesKey(samples: Sample[][]): string {
  const known = sampleKeys.get(samples)
  if (known) return known
  let h = 0x811c9dc5
  const mix = (v: number) => {
    h ^= Math.round(v * 1e5) | 0
    h = Math.imul(h, 0x01000193)
  }
  for (const field of samples) {
    mix(field.length)
    for (const s of field) { mix(s.gr); mix(s.gi); mix(s.pout); mix(s.icc); mix(s.eff) }
  }
  const key = `${samples.length}:${(h >>> 0).toString(36)}`
  sampleKeys.set(samples, key)
  return key
}

/**
 * Recent results by everything they depend on -- samples, limits, and what
 * the figure is for -- so going back to inputs already worked out (reopening
 * the dialog, undoing a limit, toggling a frequency back) is shown at once:
 * no worker round trip and no loading state. A handful only: each holds a
 * few MB of grid.
 */
const RESULT_CACHE = 6
const results = new Map<string, unknown>()
const remember = (key: string, view: unknown) => {
  results.delete(key)
  results.set(key, view)
  if (results.size > RESULT_CACHE) results.delete(results.keys().next().value as string)
}

/** Which samples the worker holds grids for, newest last; it keeps as many
 *  (see areaWorker), so they are sent again only when it has let them go. */
const workerHolds: string[] = []
const WORKER_FIELD_SETS = 2
const workerTook = (key: string) => {
  const i = workerHolds.indexOf(key)
  if (i >= 0) workerHolds.splice(i, 1)
  workerHolds.push(key)
  if (workerHolds.length > WORKER_FIELD_SETS) workerHolds.shift()
}

let nextJob = 1

/**
 * The working area for `samples` under `limits`, computed in a worker.
 *
 * `samples` null means the tab is not showing: nothing is computed and the
 * last result is kept, so coming back shows it at once. The result arrives
 * a moment after the inputs change; until then the previous one stands,
 * rather than the figure blanking on every keystroke.
 */
export function useWorkingArea<M extends { contourKey: Quantity }>(
  samples: Sample[][] | null, limits: Limits, meta: M,
): { view: (AreaResult & { meta: M }) | null; pending: boolean } {
  type View = AreaResult & { meta: M }
  const sk = useMemo(() => (samples ? samplesKey(samples) : null), [samples])
  // Everything the result depends on, as one string: the cache key, and how
  // a result is matched to the inputs it answers.
  const key = useMemo(
    () => (sk ? `${sk}|${JSON.stringify(limits)}|${JSON.stringify(meta)}` : null),
    [sk, limits, meta],
  )
  const [state, setState] = useState<{ key: string; view: View } | null>(null)
  const latest = useRef(0)

  // The answer for these inputs if there is one -- just computed, or
  // remembered from before -- else the last one shown, standing in.
  const cached = key ? (results.get(key) as View | undefined) : undefined
  const current = key != null && state?.key === key ? state.view : cached
  const view = current ?? state?.view ?? null
  const pending = key != null && current == null

  useEffect(() => {
    if (!samples || !key || results.has(key)) return
    // What the samples stand for (frequencies, plane, power), handed back
    // with the result they produced, so a title never describes newer
    // inputs than the picture under it.
    const jobMeta = meta
    const done = (r: AreaResult) => {
      const v = { ...r, meta: jobMeta } as View
      remember(key, v)
      setState({ key, view: v })
    }
    const w = getWorker()
    if (!w) {
      // No Worker (the tests): computed here, delivered as the worker's
      // answer would be, after this render.
      let live = true
      queueMicrotask(() => { if (live) done(computeArea(buildFields(samples), limits, meta.contourKey)) })
      return () => { live = false }
    }
    const id = nextJob++
    latest.current = id
    const sid = sk!
    const post = (withSamples: boolean) => {
      const job: AreaJob = {
        id, samplesId: sid, limits, contourKey: meta.contourKey, samples: withSamples ? samples : undefined,
      }
      // The worker touches what it uses as it goes; so does this mirror.
      workerTook(sid)
      w.postMessage(job)
    }
    const onMessage = (e: MessageEvent<{ id: number; need?: boolean; result?: AreaResult }>) => {
      if (e.data.id !== id) return
      if (e.data.need) { post(true); return }
      if (latest.current === id && e.data.result) done(e.data.result)
    }
    w.addEventListener('message', onMessage)
    post(!workerHolds.includes(sid))
    return () => w.removeEventListener('message', onMessage)
  }, [key, sk, samples, limits, meta])

  return { view, pending }
}

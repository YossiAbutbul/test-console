/**
 * Runs the working area off the page's thread. The grids are a few hundred
 * thousand cells per frequency; built on the page, every keystroke in a
 * limit, every new delay and every row of a live run held the whole app.
 *
 * The fields are kept between jobs, the last WORKER_FIELD_SETS sets by the
 * samples' content key: a change of limits only re-runs the cheap part,
 * switching back to recent samples (a frequency toggled back) builds
 * nothing, and the samples are sent only when they are new here.
 */
import { buildFields, computeArea } from './areaCompute'
import type { Quantity } from './areaCompute'
import type { FieldGrid, Limits, Sample } from './workingArea'

export interface AreaJob {
  id: number
  /** The samples' content key (samplesKey). */
  samplesId: string
  /** Absent when the worker already holds this `samplesId`. */
  samples?: Sample[][]
  limits: Limits
  contourKey: Quantity
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<AreaJob>) => void) | null
  postMessage: (msg: unknown, transfer: Transferable[]) => void
}

// Newest last; the page mirrors this order (useWorkingArea), so keep the
// two in step: the same size, and touched on every job.
const held: Array<{ id: string; fields: FieldGrid[] }> = []
const FIELD_SETS = 2

ctx.onmessage = (e) => {
  const job = e.data
  let i = held.findIndex((h) => h.id === job.samplesId)
  if (i < 0 && job.samples) {
    held.push({ id: job.samplesId, fields: buildFields(job.samples) })
    i = held.length - 1
  }
  // A job for samples it no longer has (the page's mirror drifted): say so,
  // and the page sends them again.
  if (i < 0) {
    ctx.postMessage({ id: job.id, need: true }, [])
    return
  }
  const [entry] = held.splice(i, 1)
  held.push(entry)
  if (held.length > FIELD_SETS) held.shift()
  const result = computeArea(entry.fields, job.limits, job.contourKey)
  const a = result.area
  ctx.postMessage(
    { id: job.id, result },
    a ? [a.measured.buffer, a.ok.buffer, a.pout.buffer, a.icc.buffer, a.eff.buffer] : [],
  )
}

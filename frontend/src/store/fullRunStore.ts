/**
 * The Test Sequence page's snapshot (folder and key still `fullRun`): its plan, the bench setups, and the last run.
 *
 * Kept in localStorage like the other page stores (makePageStore), so a plan
 * built once survives a reload and a restart of the app.
 */
import type { SetupId } from '../tests/engine/sweepTest'
import type { StepOutcome } from '../tests/fullRun/runSuite'
import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

/** One step of the plan. */
export interface FullRunStep {
  /** Stable across reorders, so a result stays with its step. */
  uid: string
  /** The test's registry id ("power"); see `fullRun/catalog.ts`. */
  testId: string
  /**
   * The step's own settings, in the shape that test's page snapshot stores
   * them (rows as typed, settle, power source, ...). Copied from the page
   * when the step is added, then edited here; the page is never touched.
   */
  settings: Record<string, unknown>
  /** The operator's own name for the step ("LoRa CW high power"); the test's
   *  label when blank. */
  name?: string
  /** A line of their own about it. */
  note?: string
  /** False to keep a step in the plan but leave it out of the run. Absent
   *  means on, so plans saved before this existed run as they did. */
  enabled?: boolean
}

/** What the operator is told about a bench setup. */
export interface SetupText {
  name: string
  /** What to re-cable, shown in the prompt before a step on this setup. */
  instructions: string
}

/** How a step's last run went, and what it measured. */
export interface StepResult {
  outcome: StepOutcome
  rows: unknown[]
  /**
   * The step's settings as they ran, resolved (`planKey`): a result stays
   * with its step until what the step would do changes, not merely how its
   * settings are written. Absent on results saved before it existed.
   */
  planKey?: string
}

export interface FullRunSnapshot {
  steps?: FullRunStep[]
  /** The setup the bench was last confirmed on, or null when not known. */
  bench?: SetupId | null
  /** Each step's last result, by step uid. */
  results?: Record<string, StepResult>
  /** When the last run started (epoch ms). */
  lastRunAt?: number
}

/** Set one field of a step's settings (the channel unit, the LTE bands). */
export function setStepSetting(step: FullRunStep, key: string, value: unknown): void {
  step.settings[key] = value
}

const store = makePageStore<FullRunSnapshot>(STORAGE_KEYS.fullRun, {})

export const fullRunSnapshot = store.snapshot
export const persistFullRun = store.persist
export const flushFullRun = store.flush

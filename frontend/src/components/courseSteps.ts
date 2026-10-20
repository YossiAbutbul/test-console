import type { ReactNode } from 'react'
import { formatDuration } from '../lib/async'
import type { CheckState } from '../ui'

/** A page's own check, after the DUT, instruments and path loss. */
export interface CourseStep {
  id: string
  label: string
  state: CheckState
  summary?: ReactNode
  /** Opened below the rail when the step is clicked. */
  detail?: ReactNode
  /** Or: the element the step scrolls to when clicked (its DOM id). */
  targetId?: string
}

/** What the Settings and Run checks need from an automation panel. */
interface PlanState {
  running: boolean
  canRun: boolean
  progress: string
  totalPoints: number
  plannedMs: number
}

/** The Settings check: is there a plan, and how long it will take. */
export function planStep(ctl: PlanState, label = 'Settings'): CourseStep {
  return {
    id: 'plan',
    label,
    state: ctl.totalPoints === 0 || (!ctl.canRun && !ctl.running) ? 'block' : 'ok',
    summary: ctl.totalPoints === 0
      ? 'No points yet: fill in a row'
      : !ctl.canRun && !ctl.running
        ? 'A row has a mistake: check it'
        : `${ctl.totalPoints} point${ctl.totalPoints === 1 ? '' : 's'} · ≈ ${formatDuration(ctl.plannedMs)}`,
  }
}

/** The Run check: waiting, ready, or how far a run has got. */
export function runStep(ctl: PlanState, gated: boolean): CourseStep {
  return {
    id: 'run',
    label: 'Run',
    state: ctl.running ? 'busy' : gated ? 'block' : ctl.canRun ? 'todo' : 'block',
    summary: ctl.running
      ? `Running ${ctl.progress}`
      : gated ? 'Waiting for the DUT' : ctl.canRun ? 'Ready to run' : 'Waiting for Settings',
  }
}

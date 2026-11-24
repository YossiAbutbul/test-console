/**
 * The backend's run state, shared by every page that shows or starts a run.
 *
 * One query per question, so the five sweep panels -- all mounted, each on its
 * own page -- poll once between them, not five times over.
 */
import { useQuery } from '@tanstack/react-query'
import { runsApi, sequenceApi } from '../api/sequence'

/** While a run goes; and while none does, to notice one started elsewhere. */
export const POLL_RUNNING_MS = 1000
export const POLL_IDLE_MS = 4000

export const SEQUENCE_STATUS_KEY = ['sequence', 'status'] as const

/** The Test Sequence runner's status. A sweep page's run is a one-step
 *  sequence, so this is that run's status too. */
export function useSequenceStatus() {
  return useQuery({
    queryKey: SEQUENCE_STATUS_KEY,
    queryFn: sequenceApi.status,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? POLL_RUNNING_MS : POLL_IDLE_MS),
    // A run keeps going whether or not anyone is watching; so does its poll.
    refetchIntervalInBackground: true,
  }).data
}

/**
 * The run holding the rig, of any kind ("Test Sequence", "Load Pull",
 * "Mode Sweep", "Frequency Accuracy"), or null. The backend refuses a second
 * run and a manual DUT command while one goes; this is for saying so before
 * the operator presses anything.
 */
export function useActiveRun(): string | null {
  return useQuery({
    queryKey: ['runs', 'active'],
    queryFn: runsApi.active,
    refetchInterval: (q) => (q.state.data?.run ? POLL_RUNNING_MS : POLL_IDLE_MS),
  }).data?.run ?? null
}

import { lazyOnOpen } from '../../lib/lazyOnOpen'

/** `SweepResultsModal`, loaded on first open: it pulls in recharts. */
export const SweepResultsModal = lazyOnOpen(() => import('./SweepResultsModal'), 'SweepResultsModal')

import { lazyOnOpen } from '../../lib/lazyOnOpen'

export type { GraphableRow } from './graphSeries'

/** `ResultsGraphModal`, loaded on first open: it pulls in recharts. */
export const ResultsGraphModal = lazyOnOpen(() => import('./ResultsGraphModal'), 'ResultsGraphModal')

import { createElement } from 'react'
import TrackChangesIcon from '@mui/icons-material/TrackChangesRounded'
import type { TestModule } from '../types'
import { LoadPullPage } from './LoadPullPage'

/**
 * Load Pull keyed with LTE CW instead of LoRa. The same page: only the TX
 * step differs, and the page branches on `protocol` for it.
 */
export const lteLoadPullModule: TestModule = {
  id: 'lte-load-pull',
  label: 'Load Pull Test',
  protocol: 'LTE',
  group: 'Other',
  icon: createElement(TrackChangesIcon, { fontSize: 'small' }),
  Page: LoadPullPage,
  requiresConnection: false,
  requiresInstruments: true,
}

import { createElement } from 'react'
import TrackChangesIcon from '@mui/icons-material/TrackChangesRounded'
import type { TestModule } from '../types'
import { LteFreqAccuracyPage } from './FreqAccuracyPage'

/** The LoRa page's twin on the LTE CW command; see FreqAccuracyPage. */
export const lteFreqAccuracyModule: TestModule = {
  id: 'lte-freq-accuracy',
  label: 'Frequency accuracy',
  protocol: 'LTE',
  group: 'TX',
  icon: createElement(TrackChangesIcon, { fontSize: 'small' }),
  Page: LteFreqAccuracyPage,
  requiresConnection: true,
}

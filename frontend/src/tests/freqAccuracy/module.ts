import { createElement } from 'react'
import TrackChangesIcon from '@mui/icons-material/TrackChangesRounded'
import type { TestModule } from '../types'
import { FreqAccuracyPage } from './FreqAccuracyPage'

export const freqAccuracyModule: TestModule = {
  id: 'freq-accuracy',
  label: 'Frequency accuracy',
  protocol: 'LoRa',
  group: 'TX',
  icon: createElement(TrackChangesIcon, { fontSize: 'small' }),
  Page: FreqAccuracyPage,
  requiresConnection: true,
}

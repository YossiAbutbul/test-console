import { createElement } from 'react'
import TrackChangesIcon from '@mui/icons-material/TrackChangesRounded'
import type { TestModule } from '../types'
import { LoadPullPage } from './LoadPullPage'

export const loadPullModule: TestModule = {
  id: 'load-pull',
  label: 'Load Pull Test',
  protocol: 'LoRa',
  group: 'Other',
  icon: createElement(TrackChangesIcon, { fontSize: 'small' }),
  Page: LoadPullPage,
  requiresConnection: false,
  requiresInstruments: true,
}

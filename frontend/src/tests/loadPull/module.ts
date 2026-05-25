import { createElement } from 'react'
import TuneIcon from '@mui/icons-material/Tune'
import type { TestModule } from '../types'
import { LoadPullPage } from './LoadPullPage'

export const loadPullModule: TestModule = {
  id: 'load-pull',
  label: 'Load Pull',
  protocol: 'LoRa',
  group: 'Other',
  icon: createElement(TuneIcon, { fontSize: 'small' }),
  Page: LoadPullPage,
  requiresConnection: true,
}

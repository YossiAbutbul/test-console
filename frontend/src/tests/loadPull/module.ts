import { createElement } from 'react'
import ScienceIcon from '@mui/icons-material/Science'
import type { TestModule } from '../types'
import { LoadPullPage } from './LoadPullPage'

export const loadPullModule: TestModule = {
  id: 'load-pull',
  label: 'Load Pull Test',
  protocol: 'LoRa',
  icon: createElement(ScienceIcon, { fontSize: 'small' }),
  Page: LoadPullPage,
  requiresConnection: false,
}

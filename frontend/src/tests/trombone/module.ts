import { createElement } from 'react'
import TuneIcon from '@mui/icons-material/Tune'
import type { TestModule } from '../types'
import { TrombonePage } from './TrombonePage'

export const tromboneModule: TestModule = {
  id: 'trombone',
  label: 'Trombone',
  protocol: 'LoRa',
  group: 'Other',
  icon: createElement(TuneIcon, { fontSize: 'small' }),
  Page: TrombonePage,
  requiresConnection: false,
}

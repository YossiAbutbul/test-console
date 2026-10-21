import { createElement } from 'react'
import StraightenIcon from '@mui/icons-material/StraightenRounded'
import type { TestModule } from '../types'
import { TrombonePage } from './TrombonePage'

export const tromboneModule: TestModule = {
  id: 'trombone',
  label: 'Trombone',
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(StraightenIcon, { fontSize: 'small' }),
  Page: TrombonePage,
  requiresConnection: false,
  requiresInstruments: true,
}

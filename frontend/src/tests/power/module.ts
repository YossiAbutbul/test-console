import { createElement } from 'react'
import BoltIcon from '@mui/icons-material/Bolt'
import type { TestModule } from '../types'
import { PowerPage } from './PowerPage'

export const powerModule: TestModule = {
  id: 'power',
  label: 'CW',
  protocol: 'LoRa',
  group: 'TX',
  icon: createElement(BoltIcon, { fontSize: 'small' }),
  Page: PowerPage,
  requiresConnection: true,
}

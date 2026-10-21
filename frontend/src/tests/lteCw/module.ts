import { createElement } from 'react'
import BoltIcon from '@mui/icons-material/BoltRounded'
import type { TestModule } from '../types'
import { LteCwPage } from './LteCwPage'

export const lteCwModule: TestModule = {
  id: 'lte-cw',
  label: 'CW',
  protocol: 'LTE',
  group: 'TX',
  icon: createElement(BoltIcon, { fontSize: 'small' }),
  Page: LteCwPage,
  requiresConnection: true,
}

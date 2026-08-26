import { createElement } from 'react'
import CellTowerIcon from '@mui/icons-material/CellTower'
import type { TestModule } from '../types'
import { LteCwPage } from './LteCwPage'

export const lteCwModule: TestModule = {
  id: 'lte-cw',
  label: 'CW',
  protocol: 'LTE',
  group: 'TX',
  icon: createElement(CellTowerIcon, { fontSize: 'small' }),
  Page: LteCwPage,
  requiresConnection: true,
}

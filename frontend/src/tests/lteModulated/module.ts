import { createElement } from 'react'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import type { TestModule } from '../types'
import { LteModulatedPage } from './LteModulatedPage'

export const lteModulatedModule: TestModule = {
  id: 'lte-modulated',
  label: 'Modulated',
  protocol: 'LTE',
  group: 'TX',
  icon: createElement(GraphicEqIcon, { fontSize: 'small' }),
  Page: LteModulatedPage,
  requiresConnection: true,
}

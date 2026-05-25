import { createElement } from 'react'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import type { TestModule } from '../types'
import { ModulatedPage } from './ModulatedPage'

export const modulatedModule: TestModule = {
  id: 'modulated',
  label: 'Modulated',
  protocol: 'LoRa',
  group: 'TX',
  icon: createElement(GraphicEqIcon, { fontSize: 'small' }),
  Page: ModulatedPage,
  requiresConnection: true,
}

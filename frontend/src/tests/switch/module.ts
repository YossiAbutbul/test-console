import { createElement } from 'react'
import AltRouteIcon from '@mui/icons-material/AltRouteRounded'
import type { TestModule } from '../types'
import { SwitchPage } from './SwitchPage'

export const switchModule: TestModule = {
  id: 'switch',
  label: 'Switch',
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(AltRouteIcon, { fontSize: 'small' }),
  Page: SwitchPage,
  requiresConnection: false,
  requiresInstruments: true,
}

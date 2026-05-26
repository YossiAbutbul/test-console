import { createElement } from 'react'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import type { TestModule } from '../types'
import { SwitchPage } from './SwitchPage'

export const switchModule: TestModule = {
  id: 'switch',
  label: 'Switch',
  protocol: 'LoRa',
  group: 'Other',
  icon: createElement(SwapHorizIcon, { fontSize: 'small' }),
  Page: SwitchPage,
  requiresConnection: false,
}

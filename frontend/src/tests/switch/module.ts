import { createElement } from 'react'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import type { TestModule } from '../types'
import { SwitchPage } from './SwitchPage'

export const switchModule: TestModule = {
  id: 'switch',
  label: 'Switch',
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(SwapHorizIcon, { fontSize: 'small' }),
  Page: SwitchPage,
  requiresConnection: false,
}

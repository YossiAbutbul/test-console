import { createElement } from 'react'
import BoltIcon from '@mui/icons-material/BoltRounded'
import type { TestModule } from '../types'
import { BleCwPage } from './BleCwPage'

export const bleCwModule: TestModule = {
  id: 'ble-cw',
  label: 'CW',
  protocol: 'BLE',
  group: 'TX',
  icon: createElement(BoltIcon, { fontSize: 'small' }),
  Page: BleCwPage,
  requiresConnection: true,
}

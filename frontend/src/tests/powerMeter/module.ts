import { createElement } from 'react'
import SpeedIcon from '@mui/icons-material/Speed'
import type { TestModule } from '../types'
import { PowerMeterPage } from './PowerMeterPage'

export const powerMeterModule: TestModule = {
  id: 'power-meter',
  label: 'Power Meter',
  // Filed at the root under Components: it drives an instrument, not a DUT,
  // so it belongs to the rig rather than to one protocol's menu. `protocol`
  // is still required by the type and is not used for placement here.
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(SpeedIcon, { fontSize: 'small' }),
  Page: PowerMeterPage,
  // Reads the sensor over VISA; nothing here talks to the DUT.
  requiresConnection: false,
}

import { createElement } from 'react'
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull'
import type { TestModule } from '../types'
import { DcAnalyzerPage } from './DcAnalyzerPage'

export const dcAnalyzerModule: TestModule = {
  id: 'dc-analyzer',
  label: 'DC Analyzer',
  // Filed at the root under Components: it drives an instrument, not a DUT,
  // so it belongs to the rig rather than to one protocol's menu. `protocol`
  // is still required by the type and is not used for placement here.
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(BatteryChargingFullIcon, { fontSize: 'small' }),
  Page: DcAnalyzerPage,
  // Talks to the analyzer over VISA; nothing here talks to the DUT.
  requiresConnection: false,
  requiresInstruments: true,
}

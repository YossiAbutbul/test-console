import { createElement } from 'react'
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntennaRounded'
import type { TestModule } from '../types'
import { SignalGeneratorPage } from './SignalGeneratorPage'

export const signalGeneratorModule: TestModule = {
  id: 'signal-generator',
  label: 'Signal Generator',
  // Filed at the root under Components: it drives an instrument, not a DUT,
  // so it belongs to the rig rather than to one protocol's menu. `protocol`
  // is still required by the type and is not used for placement here.
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(SettingsInputAntennaIcon, { fontSize: 'small' }),
  Page: SignalGeneratorPage,
  // Drives the generator over RS-232; nothing here talks to the DUT.
  requiresConnection: false,
  requiresInstruments: true,
}

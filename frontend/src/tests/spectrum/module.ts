import { createElement } from 'react'
import SsidChartIcon from '@mui/icons-material/SsidChart'
import type { TestModule } from '../types'
import { SpectrumPage } from './SpectrumPage'

export const spectrumModule: TestModule = {
  id: 'spectrum',
  label: 'Spectrum Analyzer',
  // Filed at the root under Components: it drives an instrument, not a DUT,
  // so it belongs to the rig rather than to one protocol's menu. `protocol`
  // is still required by the type and is not used for placement here.
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(SsidChartIcon, { fontSize: 'small' }),
  Page: SpectrumPage,
  // Talks to the analyzer over LAN; nothing here talks to the DUT.
  requiresConnection: false,
  requiresInstruments: true,
}

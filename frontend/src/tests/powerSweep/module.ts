import { createElement } from 'react'
import StackedLineChartIcon from '@mui/icons-material/StackedLineChartRounded'
import type { TestModule } from '../types'
import { PowerSweepPage } from './PowerSweepPage'

export const powerSweepModule: TestModule = {
  id: 'power-sweep',
  label: 'Mode Sweep',
  protocol: 'LoRa',
  group: 'TX',
  icon: createElement(StackedLineChartIcon, { fontSize: 'small' }),
  Page: PowerSweepPage,
  requiresConnection: true,
  requiresInstruments: true,
}

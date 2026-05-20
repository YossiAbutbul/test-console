import { createElement } from 'react'
import SsidChartIcon from '@mui/icons-material/SsidChart'
import type { TestModule } from '../types'
import { PowerSweepPage } from './PowerSweepPage'

export const powerSweepModule: TestModule = {
  id: 'power-sweep',
  label: 'Power Sweep',
  icon: createElement(SsidChartIcon, { fontSize: 'small' }),
  Page: PowerSweepPage,
  requiresConnection: true,
}

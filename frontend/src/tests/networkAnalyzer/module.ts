import { createElement } from 'react'
import MultilineChartIcon from '@mui/icons-material/MultilineChartRounded'
import type { TestModule } from '../types'
import { NetworkAnalyzerPage } from './NetworkAnalyzerPage'

export const networkAnalyzerModule: TestModule = {
  id: 'network-analyzer',
  label: 'Network Analyzer',
  protocol: 'LoRa',
  root: true,
  group: 'Components',
  icon: createElement(MultilineChartIcon, { fontSize: 'small' }),
  Page: NetworkAnalyzerPage,
  requiresConnection: false,
  requiresInstruments: true,
}

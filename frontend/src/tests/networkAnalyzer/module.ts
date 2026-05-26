import { createElement } from 'react'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import type { TestModule } from '../types'
import { NetworkAnalyzerPage } from './NetworkAnalyzerPage'

export const networkAnalyzerModule: TestModule = {
  id: 'network-analyzer',
  label: 'Network Analyzer',
  protocol: 'LoRa',
  group: 'Other',
  icon: createElement(GraphicEqIcon, { fontSize: 'small' }),
  Page: NetworkAnalyzerPage,
  requiresConnection: false,
}

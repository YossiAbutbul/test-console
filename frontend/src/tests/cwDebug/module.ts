import { createElement } from 'react'
import BugReportIcon from '@mui/icons-material/BugReportRounded'
import type { TestModule } from '../types'
import { CwDebugPage } from './CwDebugPage'

export const cwDebugModule: TestModule = {
  id: 'cw-debug',
  label: 'Debug',
  protocol: 'LoRa',
  group: 'TX',
  icon: createElement(BugReportIcon, { fontSize: 'small' }),
  Page: CwDebugPage,
  requiresConnection: true,
}

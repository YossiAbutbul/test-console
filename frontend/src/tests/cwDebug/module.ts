import { createElement } from 'react'
import WifiTetheringIcon from '@mui/icons-material/WifiTethering'
import type { TestModule } from '../types'
import { CwDebugPage } from './CwDebugPage'

export const cwDebugModule: TestModule = {
  id: 'cw-debug',
  label: 'CW Debug',
  icon: createElement(WifiTetheringIcon, { fontSize: 'small' }),
  Page: CwDebugPage,
  requiresConnection: true,
}

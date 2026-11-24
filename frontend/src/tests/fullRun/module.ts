import { createElement } from 'react'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlayRounded'
import type { TestModule } from '../types'
import { FullRunPage } from './FullRunPage'

/**
 * Several tests chained into one run. Filed beside Product reports, where a
 * session's testing starts and ends: it belongs to the rig, not to one
 * protocol's menu.
 */
export const fullRunModule: TestModule = {
  id: 'full-run',
  label: 'Test Sequence',
  protocol: 'LoRa',
  group: 'Runs & Reports',
  root: true,
  icon: createElement(PlaylistPlayIcon, { fontSize: 'small' }),
  Page: FullRunPage,
  requiresConnection: true,
}

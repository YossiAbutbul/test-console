import { createElement } from 'react'
import DescriptionIcon from '@mui/icons-material/DescriptionRounded'
import type { TestModule } from '../types'
import { ReportsPage } from './ReportsPage'

/** Rig-level, like the instrument pages: a report spans protocols and tests.
 *  `protocol` is required by the type and means nothing here. */
export const reportsModule: TestModule = {
  id: 'reports',
  label: 'Product reports',
  protocol: 'LoRa',
  group: 'Reports',
  root: true,
  icon: createElement(DescriptionIcon, { fontSize: 'small' }),
  Page: ReportsPage,
  requiresConnection: false,
}

import { createElement } from 'react'
import BoltIcon from '@mui/icons-material/Bolt'
import WifiTetheringIcon from '@mui/icons-material/WifiTethering'
import SsidChartIcon from '@mui/icons-material/SsidChart'
import { cwDebugModule } from './cwDebug/module'
import { powerModule } from './power/module'
import { powerSweepModule } from './powerSweep/module'
import { CwDebugPage } from './cwDebug/CwDebugPage'
import { PowerPage } from './power/PowerPage'
import { PowerSweepPage } from './powerSweep/PowerSweepPage'
import type { Protocol, TestModule } from './types'

function makeTrio(protocol: Protocol): TestModule[] {
  const proto = protocol.toLowerCase()
  return [
    {
      id: `${proto}-power`,
      label: 'Power',
      protocol,
      group: 'TX',
      icon: createElement(BoltIcon, { fontSize: 'small' }),
      Page: PowerPage,
      requiresConnection: true,
    },
    {
      id: `${proto}-debug`,
      label: 'Debug',
      protocol,
      group: 'TX',
      icon: createElement(WifiTetheringIcon, { fontSize: 'small' }),
      Page: CwDebugPage,
      requiresConnection: true,
    },
    {
      id: `${proto}-mode-sweep`,
      label: 'Mode Sweep',
      protocol,
      group: 'TX',
      icon: createElement(SsidChartIcon, { fontSize: 'small' }),
      Page: PowerSweepPage,
      requiresConnection: true,
    },
  ]
}

export const testRegistry: TestModule[] = [
  powerModule,
  cwDebugModule,
  powerSweepModule,
  ...makeTrio('BLE'),
  ...makeTrio('LTE'),
]

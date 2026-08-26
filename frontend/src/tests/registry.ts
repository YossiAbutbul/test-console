import { cwDebugModule } from './cwDebug/module'
import { lteCwModule } from './lteCw/module'
import { powerModule } from './power/module'
import { powerSweepModule } from './powerSweep/module'
import { modulatedModule } from './modulated/module'
import { loadPullModule } from './loadPull/module'
import { tromboneModule } from './trombone/module'
import { switchModule } from './switch/module'
import { networkAnalyzerModule } from './networkAnalyzer/module'
import type { TestModule } from './types'

export const testRegistry: TestModule[] = [
  powerModule,
  modulatedModule,
  cwDebugModule,
  lteCwModule,
  powerSweepModule,
  loadPullModule,
  tromboneModule,
  switchModule,
  networkAnalyzerModule,
]

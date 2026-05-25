import { cwDebugModule } from './cwDebug/module'
import { powerModule } from './power/module'
import { powerSweepModule } from './powerSweep/module'
import { modulatedModule } from './modulated/module'
import { loadPullModule } from './loadPull/module'
import type { TestModule } from './types'

export const testRegistry: TestModule[] = [
  powerModule,
  modulatedModule,
  cwDebugModule,
  powerSweepModule,
  loadPullModule,
]

import { cwDebugModule } from './cwDebug/module'
import { powerSweepModule } from './powerSweep/module'
import type { TestModule } from './types'

export const testRegistry: TestModule[] = [cwDebugModule, powerSweepModule]

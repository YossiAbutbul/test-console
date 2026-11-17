import { cwDebugModule } from './cwDebug/module'
import { lteCwModule } from './lteCw/module'
import { lteModulatedModule } from './lteModulated/module'
import { bleCwModule } from './bleCw/module'
import { powerModule } from './power/module'
import { powerSweepModule } from './powerSweep/module'
import { freqAccuracyModule } from './freqAccuracy/module'
import { lteFreqAccuracyModule } from './freqAccuracy/lteModule'
import { modulatedModule } from './modulated/module'
import { loadPullModule } from './loadPull/module'
import { lteLoadPullModule } from './loadPull/lteModule'
import { tromboneModule } from './trombone/module'
import { switchModule } from './switch/module'
import { networkAnalyzerModule } from './networkAnalyzer/module'
import { powerMeterModule } from './powerMeter/module'
import { signalGeneratorModule } from './signalGenerator/module'
import { dcAnalyzerModule } from './dcAnalyzer/module'
import { spectrumModule } from './spectrum/module'
import { reportsModule } from './reports/module'
import type { TestModule } from './types'

export const testRegistry: TestModule[] = [
  powerModule,
  modulatedModule,
  cwDebugModule,
  freqAccuracyModule,
  lteCwModule,
  lteModulatedModule,
  lteFreqAccuracyModule,
  lteLoadPullModule,
  bleCwModule,
  powerSweepModule,
  loadPullModule,
  tromboneModule,
  switchModule,
  networkAnalyzerModule,
  powerMeterModule,
  signalGeneratorModule,
  dcAnalyzerModule,
  spectrumModule,
  reportsModule,
]

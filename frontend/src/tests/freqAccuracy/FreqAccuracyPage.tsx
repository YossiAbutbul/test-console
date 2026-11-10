/**
 * Frequency accuracy (LoRa): key a CW carrier and find its frequency to the hertz.
 *
 * Spectrum analyzer only. The backend (backend/api/freq_accuracy.py) zooms in
 * stage by stage: peak marker on the tone, re-centre on the marker, narrower
 * span and RBW, again. Manual measures one carrier; Automation measures a plan
 * of frequencies, which may cross bands, one point after another. Both share
 * the Measure settings, and the backend stops the DUT after every point.
 */
import { Box, Tab, Tooltip } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import { usePersistedState } from '../../store/persistent'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { STORAGE_KEYS } from '../../store/keys'
import type { FreqAccuracyStatus, FreqPointStatus } from '../../api/freqAccuracy'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { TestPageProps } from '../types'
import { DenseTabs, PageBody, RunControls } from '../../ui'
import {
  DEFAULT_ROWS, DEFAULT_STAGES, limitOf, limitValid, planPoints, settleValid, stageProblems,
  type PlanRow,
} from './stages'
import type { MeasureSettings } from './MeasureSection'
import { ManualPanel, type ManualSettings } from './ManualPanel'
import { AutomationPanel, type AutoResult } from './AutomationPanel'
import { useFreqRun, type RunOrigin } from './useFreqRun'

type TabId = 'manual' | 'automation'

interface Saved {
  tab: TabId
  manual: ManualSettings
  measure: MeasureSettings
  rows: PlanRow[]
  results: AutoResult[]
}

const DEFAULTS: Saved = {
  tab: 'manual',
  // PA mode Auto, as on the CW page. Off was the default here, and a first
  // run at 14 dBm came back from the DUT with status 255.
  manual: { freqMhz: 902.3, power: 14, paMode: 2 },
  measure: { stages: DEFAULT_STAGES, settleMs: String(DEFAULT_SETTLE_MS), limitPpm: '20' },
  rows: DEFAULT_ROWS,
  results: [],
}

function toResult(p: FreqPointStatus): AutoResult {
  const last = p.stages[p.stages.length - 1]
  return {
    freqMhz: p.freq_hz / 1e6,
    power: p.power_dbm,
    paMode: p.pa_mode,
    measuredHz: p.result?.measured_hz ?? null,
    errorHz: p.result?.error_hz ?? null,
    errorPpm: p.result?.error_ppm ?? null,
    levelDbm: last?.level_dbm ?? null,
    note: p.error ?? p.warnings.join(' '),
  }
}

/** The points of a run that have an outcome, in plan order. */
function landed(st: FreqAccuracyStatus): AutoResult[] {
  return st.points.filter((p) => p.state === 'done' || p.state === 'error').map(toResult)
}

export function FreqAccuracyPage({ protocol, group }: TestPageProps) {
  const [savedRaw, setSaved] = usePersistedState<Partial<Saved>>(STORAGE_KEYS.freqAccuracyPage, {})
  const saved: Saved = {
    ...DEFAULTS, ...savedRaw,
    manual: { ...DEFAULTS.manual, ...savedRaw.manual },
    measure: { ...DEFAULTS.measure, ...savedRaw.measure },
  }
  const set = (patch: Partial<Saved>) => setSaved((prev) => ({ ...prev, ...patch }))
  const { tab, manual, measure, rows } = saved

  const run = useFreqRun((st: FreqAccuracyStatus, origin: RunOrigin) => {
    // Kept between visits, as the CW page's automation results are. Only the
    // automation run's: a manual reading is a one-off and lives on screen.
    if (origin === 'automation') set({ results: landed(st) })
  })
  const preflight = useInstrumentPreflight(['spectrum'])
  const { status, running } = run
  const live = status && run.origin

  const limitPpm = limitOf(measure.limitPpm)
  const measureProblems = [
    ...(!settleValid(measure.settleMs) ? [`Settle must be ${MIN_SETTLE_MS}–10000 ms`] : []),
    ...(!limitValid(measure.limitPpm) ? ['Pass limit must be a positive number of ppm, or blank'] : []),
    ...stageProblems(measure.stages),
  ]
  const plan = planPoints(rows)
  const problems = tab === 'manual'
    ? [...(!(manual.freqMhz > 0) ? ['Frequency must be positive'] : []), ...measureProblems]
    : [...(plan.length === 0 ? ['Add a frequency to the sweep'] : []), ...measureProblems]

  const onRun = async () => {
    if (!(await preflight.run())) return
    const points = tab === 'manual'
      ? [{ freq_hz: Math.round(manual.freqMhz * 1e6), power_dbm: manual.power, pa_mode: manual.paMode }]
      : plan.map((p) => ({ freq_hz: Math.round(p.freqMhz * 1e6), power_dbm: p.power, pa_mode: p.paMode }))
    if (tab === 'automation') set({ results: [] })
    await run.start({
      points,
      stages: measure.stages,
      settle_ms: clampSettleMs(Number(measure.settleMs)),
    }, tab)
  }

  // Progress on the run key: stages for one point, points for a plan.
  const progress = !running || !status ? undefined
    : status.points.length === 1
      ? `${status.points[0].stages.length}/${status.stage_count}`
      : `${status.points.filter((p) => p.state === 'done' || p.state === 'error').length}/${status.points.length}`

  const manualPoint = live && run.origin === 'manual' ? status.points[0] ?? null : null
  const manualOutcome = run.origin !== 'manual' ? null
    : run.startError ?? status?.error ?? (status?.state === 'cancelled' ? 'Cancelled' : null)
  const autoResults = live && run.origin === 'automation' && running ? landed(status) : saved.results

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Frequency accuracy"
        actions={
          <Tooltip title={running ? '' : problems[0] ?? ''}>
            <span>
              <RunControls
                running={running}
                starting={run.starting}
                stopping={run.stopping}
                canRun={problems.length === 0}
                runLabel={tab === 'manual' ? 'Measure' : 'Run sweep'}
                progress={progress}
                onRun={() => void onRun()}
                onStop={run.stop}
              />
            </span>
          </Tooltip>
        }
      />

      <DenseTabs value={tab} onChange={(_, v: TabId) => set({ tab: v })}>
        <Tab value="manual" label="Manual" />
        <Tab value="automation" label="Automation" />
      </DenseTabs>

      {/* Taller than the window, as Mode Sweep is: the scrolling body keeps
          a margin under the last card instead of running it into the edge. */}
      <PageBody width="fluid" scroll>
        {tab === 'manual' ? (
          <ManualPanel
            value={manual}
            onChange={(m) => set({ manual: m })}
            measure={measure}
            onMeasureChange={(m) => set({ measure: m })}
            limitPpm={limitPpm}
            point={manualPoint}
            phase={running && run.origin === 'manual' ? status?.phase ?? null : null}
            outcome={manualOutcome}
            failed={run.origin === 'manual' && !!(run.startError || status?.error)}
            disabled={running}
          />
        ) : (
          <AutomationPanel
            rows={rows}
            onRowsChange={(r) => set({ rows: r })}
            measure={measure}
            onMeasureChange={(m) => set({ measure: m })}
            limitPpm={limitPpm}
            results={autoResults}
            planned={running && run.origin === 'automation' ? status?.points.length : undefined}
            onClear={() => set({ results: [] })}
            disabled={running}
          />
        )}
      </PageBody>

      {preflight.dialog}
    </Box>
  )
}

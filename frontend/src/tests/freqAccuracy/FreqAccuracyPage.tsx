/**
 * Frequency accuracy (LoRa, LTE): key a CW carrier and find its frequency to the hertz.
 *
 * Spectrum analyzer only. The backend (backend/api/freq_accuracy.py) zooms in
 * stage by stage: peak marker on the tone, re-centre on the marker, narrower
 * span and RBW, again. Manual measures one carrier; Automation measures a plan
 * of frequencies, which may cross bands, one point after another. Both share
 * the Measure settings, and the backend stops the DUT after every point.
 *
 * One page for both radios. LTE keys the LTE CW page's command, reads its
 * channels as EARFCNs or MHz like every LTE page (lte/channel.ts), and has no
 * PA mode; the backend owns the modem for the run.
 */
import { useState } from 'react'
import { Box, IconButton, Stack, Tab, Tooltip } from '@mui/material'
import TuneIcon from '@mui/icons-material/FilterListRounded'
import { PageHeader } from '../../components/PageHeader'
import { usePersistedState } from '../../store/persistent'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { STORAGE_KEYS } from '../../store/keys'
import type { FreqAccuracyStatus, FreqPointStatus } from '../../api/freqAccuracy'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { TestPageProps } from '../types'
import { DenseTabs, PageBody, RunControls, SegmentedChoice } from '../../ui'
import { BandsModal } from '../lte/BandsModal'
import { useLteBands, useLteChannelUnit, type ChannelUnit } from '../lte/channel'
import {
  DEFAULT_ROWS, DEFAULT_STAGES, DEFAULT_TOL_PPM, limitOf, limitValid, normaliseRow, planPoints, stagePpm,
  stageTols, settleValid, stageProblems, type PlanRow,
} from './stages'
import { LORA, LTE_MAX_POWER_DBM, convertSpec, manualChannel, powersOf, type Radio, type RadioId } from './radio'
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
  /** LTE: the unit the saved channels were typed in. The unit is shared by
   *  every LTE page, so it can change while this page is not on screen. */
  specUnit?: ChannelUnit
}

const MEASURE_DEFAULTS: MeasureSettings = { stages: DEFAULT_STAGES, settleMs: String(DEFAULT_SETTLE_MS) }

const DEFAULTS: Record<RadioId, Saved> = {
  LoRa: {
    tab: 'manual',
    // PA mode Auto, as on the CW page. Off was the default here, and a first
    // run at 14 dBm came back from the DUT with status 255.
    manual: { freqMhz: 902.3, power: 14, paMode: 2 },
    measure: MEASURE_DEFAULTS,
    rows: DEFAULT_ROWS,
    results: [],
  },
  LTE: {
    tab: 'manual',
    // Band 2 at the modem's full power, as the LTE CW page starts.
    manual: { freqMhz: 0, power: LTE_MAX_POWER_DBM, paMode: 0, channel: '1880' },
    measure: MEASURE_DEFAULTS,
    rows: ['1860', '1880', '1900'].map((freq) => ({ freq, power: String(LTE_MAX_POWER_DBM), paMode: 0, tolPpm: DEFAULT_TOL_PPM })),
    results: [],
    specUnit: 'mhz',
  },
}

function toResult(p: FreqPointStatus, limitPpm: number | null, stageLimits: (number | null)[]): AutoResult {
  const last = p.stages[p.stages.length - 1]
  return {
    freqMhz: p.freq_hz / 1e6,
    earfcn: p.earfcn ?? null,
    power: p.power_dbm,
    paMode: p.pa_mode,
    limitPpm,
    stagePpm: p.stages.map((s) => stagePpm(s.marker_hz, p.freq_hz)),
    stageLimits,
    measuredHz: p.result?.measured_hz ?? null,
    errorHz: p.result?.error_hz ?? null,
    errorPpm: p.result?.error_ppm ?? null,
    levelDbm: last?.level_dbm ?? null,
    note: p.error ?? p.warnings.join(' '),
  }
}

/** The points of a run that have an outcome, in plan order, each with the
 *  tolerance of the row it came from (`limits`, by point index). */
function landed(st: FreqAccuracyStatus, limits: RunLimits): AutoResult[] {
  return st.points
    .map((p, i) => ({ p, lim: limits.points[i] ?? null }))
    .filter(({ p }) => p.state === 'done' || p.state === 'error')
    .map(({ p, lim }) => toResult(p, lim, limits.stages))
}

/** The tolerances a run was started with: each point's, and each stage's. */
interface RunLimits {
  points: (number | null)[]
  stages: (number | null)[]
}

export function FreqAccuracyPage(props: TestPageProps) {
  return <FreqAccuracy {...props} radioId="LoRa" />
}

export function LteFreqAccuracyPage(props: TestPageProps) {
  return <FreqAccuracy {...props} radioId="LTE" />
}

function FreqAccuracy({ protocol, group, radioId }: TestPageProps & { radioId: RadioId }) {
  const lte = radioId === 'LTE'
  const defaults = DEFAULTS[radioId]
  const [savedRaw, setSaved] = usePersistedState<Partial<Saved>>(
    lte ? STORAGE_KEYS.lteFreqAccuracyPage : STORAGE_KEYS.freqAccuracyPage, {},
  )
  // Shared with the other LTE pages; the LoRa page reads neither.
  const [unit, setUnit] = useLteChannelUnit()
  const [bands, setBands] = useLteBands()
  const [bandsOpen, setBandsOpen] = useState(false)
  const radio: Radio = lte ? { id: 'LTE', unit, bands } : LORA

  const saved: Saved = {
    ...defaults, ...savedRaw,
    manual: { ...defaults.manual, ...savedRaw.manual },
    measure: { ...defaults.measure, ...savedRaw.measure },
  }
  // Channels saved in the other unit are read converted, not rewritten here:
  // the next edit stores them in this unit (see `set`).
  const specUnit = saved.specUnit ?? 'mhz'
  const inUnit = (spec: string) => (lte ? convertSpec(spec, specUnit, unit, bands) : spec)
  const { tab, measure } = saved
  const manual: ManualSettings = lte
    ? { ...saved.manual, channel: inUnit(saved.manual.channel ?? '') }
    : saved.manual
  const rows = saved.rows.map(normaliseRow).map((r) => (lte ? { ...r, freq: inUnit(r.freq) } : r))
  const set = (patch: Partial<Saved>) => setSaved((prev) => ({
    ...prev,
    // Every write stores the channels in the unit on screen, with that unit.
    ...(lte ? { rows, manual, specUnit: unit } : {}),
    ...patch,
  }))

  // Each point's tolerance as planned when the run started: the rows may be
  // edited while it runs, and a point is judged by what it was run with.
  const [runLimits, setRunLimits] = useState<RunLimits>({ points: [], stages: [] })
  const stageTolRaw = stageTols(measure.stageTolPpm, measure.stages.length)

  const run = useFreqRun((st: FreqAccuracyStatus, origin: RunOrigin) => {
    // Kept between visits, as the CW page's automation results are. Only the
    // automation run's: a manual reading is a one-off and lives on screen.
    if (origin === 'automation') set({ results: landed(st, runLimits) })
  })
  const preflight = useInstrumentPreflight(['spectrum'])
  const { status, running } = run
  const live = status && run.origin

  const tolProblem = 'Tolerance must be a positive number of ppm, or blank'
  const measureProblems = [
    ...(!settleValid(measure.settleMs) ? [`Settle must be ${MIN_SETTLE_MS}–10000 ms`] : []),
    ...stageProblems(measure.stages),
    ...(stageTolRaw.some((t) => !limitValid(t)) ? [tolProblem] : []),
  ]
  const plan = planPoints(rows, radio)
  const { channel: manualCh, issue: channelIssue } = manualChannel(manual, radio)
  const powerOk = powersOf(String(manual.power), radio)?.length === 1
  const problems = tab === 'manual'
    ? [
        ...(lte
          ? (channelIssue ? [`Channel: ${channelIssue}`] : [])
          : (!(manual.freqMhz > 0) ? ['Frequency must be positive'] : [])),
        ...(!powerOk ? [lte ? `Power must be 0–${LTE_MAX_POWER_DBM} dBm` : 'Power must be a whole dBm, 0–255'] : []),
        ...measureProblems,
      ]
    : [
        ...(plan.length === 0 ? ['Add a frequency to the sweep'] : []),
        ...(rows.some((r) => !limitValid(r.tolPpm)) ? [tolProblem] : []),
        ...measureProblems,
      ]

  const onRun = async () => {
    if (!(await preflight.run())) return
    const points = tab === 'manual'
      ? [{
          freq_hz: Math.round((manualCh?.freqMhz ?? 0) * 1e6), earfcn: manualCh?.earfcn ?? null,
          power_dbm: manual.power, pa_mode: manual.paMode,
        }]
      : plan.map((p) => ({
          freq_hz: Math.round(p.freqMhz * 1e6), earfcn: p.earfcn ?? null, power_dbm: p.power, pa_mode: p.paMode,
        }))
    if (tab === 'automation') {
      set({ results: [] })
      setRunLimits({ points: plan.map((p) => p.limitPpm), stages: stageTolRaw.map(limitOf) })
    }
    await run.start({
      points,
      stages: measure.stages,
      settle_ms: clampSettleMs(Number(measure.settleMs)),
      radio: radioId,
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
  const autoResults = live && run.origin === 'automation' && running ? landed(status, runLimits) : saved.results

  // LTE: how channels are read, in the heading of whichever section types them,
  // as on the LTE CW page.
  const channelControls = lte ? (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <SegmentedChoice
        value={unit}
        options={[
          { value: 'mhz', label: 'MHz' },
          { value: 'earfcn', label: 'EARFCN' },
        ]}
        onChange={(next: ChannelUnit) => {
          // Written in the unit on screen first, so the switch converts from it.
          set({})
          setUnit(next)
        }}
      />
      <Tooltip title="Bands in use">
        <IconButton size="small" aria-label="Bands in use" onClick={() => setBandsOpen(true)}>
          <TuneIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  ) : undefined

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
            radio={radio}
            transmitAction={channelControls}
            value={manual}
            onChange={(m) => set({ manual: m })}
            measure={measure}
            onMeasureChange={(m) => set({ measure: m })}
            point={manualPoint}
            phase={running && run.origin === 'manual' ? status?.phase ?? null : null}
            outcome={manualOutcome}
            failed={run.origin === 'manual' && !!(run.startError || status?.error)}
            disabled={running}
          />
        ) : (
          <AutomationPanel
            radio={radio}
            sweepAction={channelControls}
            rows={rows}
            onRowsChange={(r) => set({ rows: r })}
            measure={measure}
            onMeasureChange={(m) => set({ measure: m })}
            results={autoResults}
            planned={running && run.origin === 'automation' ? status?.points.length : undefined}
            onClear={() => set({ results: [] })}
            disabled={running}
          />
        )}
      </PageBody>

      {lte && (
        <BandsModal open={bandsOpen} onClose={() => setBandsOpen(false)} bands={bands} onSave={setBands} />
      )}
      {preflight.dialog}
    </Box>
  )
}

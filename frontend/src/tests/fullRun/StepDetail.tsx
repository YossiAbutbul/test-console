/**
 * One step, opened in place under its row, in three tabs: its sweep, what
 * measures it, and its name, test and note. One at a time, so an open step
 * stays a few rows tall.
 *
 * The editor is the panel the test's page uses, in its editor mode -- the same
 * rows, Settle, tone and power source -- so a step is set up exactly as the
 * page would be. Edits land in the step as they are typed; the page is never
 * touched.
 */
import { useState } from 'react'
import { Box, MenuItem, Stack, Tab } from '@mui/material'
import { DenseTabs, MiniAction } from '../../ui'
import CopyIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded'
import { LabeledField } from '../../components/LabeledField'
import { setStepSetting, type FullRunStep } from '../../store/fullRunStore'
import type { BleChannelUnit } from '../../store/bleCwPageStore'
import { DEFAULT_BANDS } from '../../lib/earfcn'
import { BleAutomationPanel } from '../bleCw/BleAutomationPanel'
import { LteAutomationPanel } from '../lteCw/LteAutomationPanel'
import { AutomationPanel as LteModulatedPanel } from '../lteModulated/AutomationPanel'
import { AutomationPanel as ModulatedPanel } from '../modulated/AutomationPanel'
import { AutomationPanel as LoraCwPanel } from '../power/AutomationPanel'
import { BandsModal } from '../lte/BandsModal'
import type { ChannelUnit } from '../lte/channel'
import type { BleLink } from '../ble/useBleLink'
import type { LteModem } from '../lte/useLteModem'
import type { SweepSettingsStore } from '../engine/sweepTest'
import { SweepActionsSlot } from '../engine/automationLayout'
import { SUITE_TESTS, suiteTest } from './catalog'
import { StepResults } from './StepResults'
import { FreqStepEditor } from './FreqStepEditor'
import type { JudgedRow } from '../engine/sweepTest'

interface Props {
  step: FullRunStep
  link: BleLink
  modem: LteModem
  /** The step's settings changed (they are edited in place). */
  onSettings: () => void
  /** Its name, note or test changed. */
  onPatch: (patch: Partial<Pick<FullRunStep, 'name' | 'note' | 'testId' | 'settings'>>) => void
  onDuplicate: () => void
  onRemove: () => void
  /** What its last run measured (or this run, so far), if it has run. */
  results: JudgedRow[] | null
  /** A sequence is running: the step can be looked at, not changed. */
  running: boolean
  /** It is the step in flight. */
  live: boolean
  /** The tab this step was last left on; it reopens there. */
  tab: StepView
  onTab: (v: StepView) => void
}

export type StepView = 'results' | 'sweep' | 'measure' | 'step'
type View = StepView

/** The tab control: equal segments, 100 px each. */
const TAB_W = 100
/** Every tab at rest is a line of labels over a line of 32 px controls:
 *  19.5 + 4 + 32 = 55.5 px (measured on the sweep). A taller sweep grows. */
const BODY_MIN_H = 56

export function StepDetail({
  step, link, modem, onSettings, onPatch, onDuplicate, onRemove, results, running, live, tab, onTab,
}: Props) {
  const test = suiteTest(step.testId)!
  // Each step reopens on the tab it was left on -- Results only where there
  // are results, else Sweep. A run only lets the step be looked at: its
  // settings are in use.
  const view: View = running ? 'results' : tab === 'results' && !results ? 'sweep' : tab
  // Results always there, last, so the tabs never shift; greyed out until
  // the step has run.
  const tabs: Array<[View, string]> = [
    ['sweep', 'Sweep'], ['measure', 'Measure'], ['step', 'Name & test'], ['results', 'Results'],
  ]
  // The tab row's right end, where the Sweep tab's keys (points, settings,
  // Add) sit, so they share the tabs' line rather than taking their own.
  const [keys, setKeys] = useState<HTMLElement | null>(null)
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ minHeight: 32 }}>
        {/* Equal segments, as a segmented control: the tabs keep their
            places whichever label is longest. */}
        <DenseTabs
          size="sm"
          value={view}
          onChange={(_, v: View) => onTab(v)}
          aria-label="Step settings"
          sx={{
            width: TAB_W * tabs.length,
            '& .MuiTabs-scroller, & .MuiTabs-flexContainer': { width: '100%' },
            '& .MuiTab-root': { flex: '1 1 0' },
          }}
        >
          {tabs.map(([v, label]) => (
            <Tab
              key={v}
              value={v}
              label={label}
              disabled={v === 'results' ? !results : running}
            />
          ))}
        </DenseTabs>
        <Box ref={setKeys} sx={{ display: 'flex', alignItems: 'center' }} />
      </Stack>

      {/* Every tab's body starts at the same place and is at least the same
          height, so switching tabs does not move the step's edges. */}
      <Box sx={{ minHeight: BODY_MIN_H, display: 'flex', flexDirection: 'column' }}>
        {view === 'results' ? (
          <StepResults test={test} rows={results ?? []} live={live} />
        ) : view === 'step' ? (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'minmax(140px, 1fr) minmax(150px, 0.8fr) minmax(160px, 1.4fr) auto' }}>
            <LabeledField
              label="Name"
              value={step.name ?? ''}
              placeholder={test.label}
              onChange={(e) => onPatch({ name: e.target.value })}
            />
            <LabeledField
              select
              label="Test"
              value={step.testId}
              onChange={(e) => {
                const next = suiteTest(e.target.value)
                // A test's settings mean nothing to another, so a swap starts
                // from the new test's page, as adding it would.
                if (next) onPatch({ testId: next.id, settings: next.fromPage() as Record<string, unknown> })
              }}
            >
              {SUITE_TESTS.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
            </LabeledField>
            <LabeledField
              label="Note"
              value={step.note ?? ''}
              placeholder="Optional"
              onChange={(e) => onPatch({ note: e.target.value })}
            />
            {/* What else can be done to the step as a whole, on the fields'
                input line. */}
            <Stack direction="row" spacing={0.5} sx={{ alignSelf: 'end', height: 32, alignItems: 'center' }}>
              <MiniAction startIcon={<CopyIcon />} onClick={onDuplicate}>Duplicate</MiniAction>
              <MiniAction tone="destructive" startIcon={<DeleteIcon />} onClick={onRemove}>Remove</MiniAction>
            </Stack>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <SweepActionsSlot.Provider value={keys}>
              <Panel key={step.testId} step={step} view={view as 'sweep' | 'measure'} link={link} modem={modem} onChange={onSettings} />
            </SweepActionsSlot.Provider>
          </Box>
        )}
      </Box>
    </Stack>
  )
}

function Panel({ step, view, link, modem, onChange }: {
  step: FullRunStep
  view: 'sweep' | 'measure'
  link: BleLink
  modem: LteModem
  onChange: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each panel reads its own test's shape
  const store: SweepSettingsStore<any> = { snap: () => step.settings, persist: onChange }
  const s = step.settings as { unit?: string; bands?: number[] }
  const [unit, setUnit] = useState(s.unit)
  const [bands, setBands] = useState<number[]>(s.bands ?? DEFAULT_BANDS)
  const [bandsOpen, setBandsOpen] = useState(false)
  const changeUnit = <U extends string>(u: U) => { setStepSetting(step, 'unit', u); setUnit(u); onChange() }
  const saveBands = (b: number[]) => { setStepSetting(step, 'bands', b); setBands(b); onChange() }

  switch (step.testId) {
    case 'power':
      return <LoraCwPanel protocol="LoRa" store={store} editor editorView={view} />
    case 'modulated':
      return <ModulatedPanel protocol="LoRa" store={store} editor editorView={view} />
    case 'ble-cw':
      return (
        <BleAutomationPanel
          link={link} unit={(unit as BleChannelUnit) ?? 'channel'}
          onUnitChange={changeUnit} store={store} editor editorView={view}
        />
      )
    case 'lte-cw':
    case 'lte-modulated': {
      const P = step.testId === 'lte-cw' ? LteAutomationPanel : LteModulatedPanel
      return (
        <>
          <P
            modem={modem} unit={(unit as ChannelUnit) ?? 'mhz'} bands={bands}
            onUnitChange={changeUnit} onEditBands={() => setBandsOpen(true)}
            store={store} editor editorView={view}
          />
          <BandsModal open={bandsOpen} onClose={() => setBandsOpen(false)} bands={bands} onSave={saveBands} />
        </>
      )
    }
    case 'freq-accuracy':
    case 'lte-freq-accuracy':
      return <FreqStepEditor step={step} view={view} onChange={onChange} />
    default:
      return null
  }
}

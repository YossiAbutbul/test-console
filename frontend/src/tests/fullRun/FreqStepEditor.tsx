/**
 * A frequency accuracy step's settings, edited in place: the Frequency
 * accuracy page's own plan table (Sweep tab) and zoom stages (Measure tab),
 * without their cards -- the step is the card -- and with their keys on the
 * step's tab row, where the other tests' editors put theirs.
 */
import { useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import TuneIcon from '@mui/icons-material/FilterListRounded'
import { MiniAction, SegmentedChoice } from '../../ui'
import { setStepSetting, type FullRunStep } from '../../store/fullRunStore'
import { SweepActionsSlot } from '../engine/automationLayout'
import { BandsModal } from '../lte/BandsModal'
import type { ChannelUnit } from '../lte/channel'
import { FreqSweepTable } from '../freqAccuracy/AutomationPanel'
import { MeasureSection } from '../freqAccuracy/MeasureSection'
import { PlanCompact } from '../freqAccuracy/planCompact'
import { convertSpec } from '../freqAccuracy/radio'
import { DEFAULT_ROWS, planPoints, type PlanRow } from '../freqAccuracy/stages'
import { loraFreqAccuracyTest, lteFreqAccuracyTest, type FreqRaw } from '../freqAccuracy/sweepTest'

export function FreqStepEditor({ step, view, onChange }: {
  step: FullRunStep
  view: 'sweep' | 'measure'
  onChange: () => void
}) {
  const lte = step.testId === 'lte-freq-accuracy'
  const test = lte ? lteFreqAccuracyTest : loraFreqAccuracyTest
  const raw = step.settings as FreqRaw
  // Resolved on every render from the step's own settings, which this edits
  // in place; `bump` only re-renders after a write.
  const [, setBump] = useState(0)
  const s = test.resolve(raw)
  const slot = useContext(SweepActionsSlot)
  const [bandsOpen, setBandsOpen] = useState(false)

  const write = (key: keyof FreqRaw, value: unknown) => {
    setStepSetting(step, key, value)
    setBump((n) => n + 1)
    onChange()
  }
  const setRows = (rows: PlanRow[]) => write('rows', rows)

  if (view === 'measure') {
    return (
      <PlanCompact.Provider value>
        <MeasureSection bare slot={slot} value={s.measure} onChange={(m) => write('measure', m)} />
      </PlanCompact.Provider>
    )
  }

  const total = planPoints(s.rows, s.radio).length
  const unit: ChannelUnit = s.radio.id === 'LTE' ? s.radio.unit : 'mhz'
  const bands = s.radio.id === 'LTE' ? s.radio.bands : []
  const keys = (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {total} point{total === 1 ? '' : 's'}
      </Typography>
      {lte && (
        <>
          <SegmentedChoice
            value={unit}
            options={[{ value: 'mhz', label: 'MHz' }, { value: 'earfcn', label: 'EARFCN' }]}
            onChange={(next: ChannelUnit) => {
              // The channels keep meaning the same ones in the other unit.
              setStepSetting(step, 'rows', s.rows.map((r) => ({ ...r, freq: convertSpec(r.freq, unit, next, bands) })))
              write('unit', next)
            }}
          />
          <Tooltip title="Bands in use">
            <IconButton size="small" aria-label="Bands in use" onClick={() => setBandsOpen(true)}>
              <TuneIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </>
      )}
      <MiniAction
        startIcon={<AddIcon />}
        onClick={() => setRows([...s.rows, { ...(s.rows[s.rows.length - 1] ?? DEFAULT_ROWS[0]), freq: '' }])}
      >
        Add
      </MiniAction>
    </Stack>
  )
  return (
    <>
      {slot ? createPortal(keys, slot) : keys}
      <PlanCompact.Provider value>
        <FreqSweepTable radio={s.radio} rows={s.rows} onRowsChange={setRows} disabled={false} />
      </PlanCompact.Provider>
      {lte && (
        <BandsModal open={bandsOpen} onClose={() => setBandsOpen(false)} bands={bands} onSave={(b) => write('bands', b)} />
      )}
    </>
  )
}

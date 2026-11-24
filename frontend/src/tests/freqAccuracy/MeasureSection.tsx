import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, IconButton, InputAdornment, Stack, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import RestartIcon from '@mui/icons-material/RestartAltRounded'
import type { FreqStage } from '../../api/freqAccuracy'
import { selectOnFocus } from '../../lib/selectOnFocus'
import { MiniAction, Section } from '../../ui'
import { MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { DEFAULT_STAGES, MAX_STAGES, formatHz, limitValid, settleValid, stageTols } from './stages'
import { CellField, ColHead, HeadField, PlanFooter, PlanGrid, PlanRow } from './planTable'

export interface MeasureSettings {
  stages: FreqStage[]
  /** ms the carrier is keyed before the first sweep of each point. A string
   *  so the field can be cleared while typing; the floor is applied on blur. */
  settleMs: string
  /** Each stage's peak must be within ± this many ppm of nominal, one per
   *  stage; blank: that stage is not judged. Kept beside `stages`, not in
   *  them, because the stages go to the backend as they are. */
  stageTolPpm?: string[]
}

// Number, span, RBW, VBW, tolerance, remove. The fields fill the row, but not
// in equal shares: span runs to "1000" and a Hz readout, so it gets the
// larger one, a tolerance of a couple of digits the smallest. Capped widths
// left a gap across the card.
const COLS = '20px minmax(110px, 1.5fr) minmax(80px, 1fr) minmax(80px, 1fr) minmax(104px, 0.6fr) 32px'
// The columns' minimums and gaps: a table narrower than its own grid scrolled
// inside the box that scrolls, two bars for one overflow.
const MIN_TABLE_W = 20 + 110 + 80 + 80 + 104 + 32 + 5 * 8 + 16

/**
 * The zoom stages and settle -- one set for both tabs, so a plan measured on
 * Automation is measured exactly as a Manual check. Laid out as the Sweep
 * table: settle is run-wide, so it sits in the heading, not in the rows. The
 * pass limit is not here: it belongs to what is transmitted (each sweep row,
 * or the Manual tab's Transmit), as the power page's tolerance does.
 */
export function MeasureSection({ value, onChange, disabled, bare, slot }: {
  value: MeasureSettings
  onChange: (next: MeasureSettings) => void
  disabled?: boolean
  /**
   * Inside something that is already a card (a Test Sequence step): no card,
   * heading or footer; Settle, Add and Defaults go to `slot` (the step's tab
   * row) when one is given, else above the stages.
   */
  bare?: boolean
  slot?: HTMLElement | null
}) {
  const { stages } = value
  const tols = stageTols(value.stageTolPpm, stages.length)
  const set = (patch: Partial<MeasureSettings>) => onChange({ ...value, ...patch })
  const setStage = (i: number, patch: Partial<FreqStage>) =>
    set({ stages: stages.map((st, k) => (k === i ? { ...st, ...patch } : st)) })

  const defaults = (
    <MiniAction startIcon={<RestartIcon />} disabled={disabled}
      onClick={() => set({ stages: DEFAULT_STAGES, stageTolPpm: [] })}>
      Defaults
    </MiniAction>
  )
  const controls = (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      {/* Raised to the floor on blur, not per keystroke, so "4" can
          still be typed on the way to "450". */}
      <HeadField label="Settle" unit="ms" type="number"
        value={value.settleMs}
        disabled={disabled} error={!settleValid(value.settleMs)}
        inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
        onFocus={selectOnFocus}
        onBlur={() => set({ settleMs: String(clampSettleMs(Number(value.settleMs))) })}
        onChange={(e) => set({ settleMs: e.target.value })} />
      <MiniAction startIcon={<AddIcon />} disabled={disabled || stages.length >= MAX_STAGES}
        onClick={() => {
          const last = stages[stages.length - 1] ?? DEFAULT_STAGES[0]
          set({
            stages: [...stages, { span_hz: last.span_hz / 10, rbw_hz: Math.max(1, last.rbw_hz / 10), vbw_hz: Math.max(1, last.vbw_hz / 10) }],
            stageTolPpm: [...tols, tols[tols.length - 1] ?? ''],
          })
        }}>
        Add
      </MiniAction>
      {/* Bare, Defaults joins the keys -- there is no footer to hold it --
          as a key of its own size: the step's tab row has little room. */}
      {bare && (
        <Tooltip title="Default stages">
          <span>
            <IconButton size="small" aria-label="Default stages" disabled={disabled}
              onClick={() => set({ stages: DEFAULT_STAGES, stageTolPpm: [] })}>
              <RestartIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Stack>
  )
  const grid = (
    <PlanGrid cols={COLS} minWidth={MIN_TABLE_W} maxRows={3} heads={<>
      <span />
      <ColHead label="Span" hint="kHz" />
      <ColHead label="RBW" hint="kHz" />
      <ColHead label="VBW" hint="kHz" />
      <ColHead label="Tolerance" hint="± ppm" />
      <span />
    </>}>
      {stages.map((st, i) => (
        <PlanRow key={i} cols={COLS} n={i + 1} removeLabel="Remove stage"
          onRemove={() => set({
            stages: stages.filter((_, k) => k !== i),
            stageTolPpm: tols.filter((_, k) => k !== i),
          })}
          removeDisabled={disabled || stages.length <= 1}>
          <KhzField hz={st.span_hz} disabled={disabled} onChange={(hz) => setStage(i, { span_hz: hz })} />
          <KhzField hz={st.rbw_hz} disabled={disabled} onChange={(hz) => setStage(i, { rbw_hz: hz })} />
          <KhzField hz={st.vbw_hz} disabled={disabled} onChange={(hz) => setStage(i, { vbw_hz: hz })} />
          {/* No "±" in the field: the heading already says "± ppm". */}
          <CellField type="number" value={tols[i]} disabled={disabled}
            error={!limitValid(tols[i])} onFocus={selectOnFocus}
            inputProps={{ min: 0, step: 1 }}
            title={!limitValid(tols[i]) ? 'A tolerance in ppm above 0, or blank for no verdict' : undefined}
            onChange={(e) => set({ stageTolPpm: tols.map((t, k) => (k === i ? e.target.value : t)) })} />
        </PlanRow>
      ))}
    </PlanGrid>
  )

  if (bare) {
    return (
      <>
        {slot ? createPortal(controls, slot) : <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>{controls}</Box>}
        {grid}
      </>
    )
  }
  return (
    <Section title="Measure" panel action={controls}>
      {grid}
      <PlanFooter hint="Each stage centres on the last peak, then narrows · Tolerance: that stage's peak, ± ppm of nominal · blank = no verdict">
        {defaults}
      </PlanFooter>
    </Section>
  )
}

/** Hz as kHz for a field: 0.3 for 300 Hz, 1000 for 1 MHz, no float dust. */
function khzText(hz: number): string {
  return String(Number((hz / 1000).toPrecision(9)))
}

/**
 * A span or bandwidth typed in kHz, kept in Hz everywhere else (the wire, the
 * saved settings). The text is held while the field is focused: a controlled
 * number fed back from Hz turned "0." into "0", so 0.01 kHz could not be typed.
 * Values that read awkwardly in kHz are spelled out inside the field -- 0.01
 * kHz is 10 Hz.
 */
function KhzField({ hz, onChange, disabled }: {
  hz: number
  onChange: (hz: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const plain = hz >= 1000 && hz < 1_000_000
  return (
    <CellField
      type="number"
      value={draft ?? khzText(hz)}
      disabled={disabled}
      inputProps={{ step: 'any', min: 0 }}
      InputProps={plain ? undefined : {
        endAdornment: (
          <InputAdornment position="end" sx={{ '& p': { fontSize: 12, color: 'text.secondary' } }}>
            {formatHz(hz)}
          </InputAdornment>
        ),
      }}
      onFocus={(e) => { setDraft(khzText(hz)); selectOnFocus(e) }}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = Number(e.target.value)
        // Whole hertz: the analyzer takes FREQ:SPAN / BAND:RES as integers.
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(Math.round(v * 1000))
      }}
    />
  )
}

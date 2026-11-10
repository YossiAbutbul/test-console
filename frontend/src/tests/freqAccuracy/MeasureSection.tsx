import { useState } from 'react'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import RestartIcon from '@mui/icons-material/RestartAltRounded'
import CloseIcon from '@mui/icons-material/CloseRounded'
import { LabeledField } from '../../components/LabeledField'
import type { FreqStage } from '../../api/freqAccuracy'
import { FieldGrid, MiniAction, Section, TEXT } from '../../ui'
import { MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { DEFAULT_STAGES, MAX_STAGES, formatHz, limitValid, settleValid } from './stages'

export interface MeasureSettings {
  stages: FreqStage[]
  /** ms the carrier is keyed before the first sweep of each point. A string
   *  so the field can be cleared while typing; the floor is applied on blur. */
  settleMs: string
  /** Pass within ± this many ppm. Blank: measured, not judged. */
  limitPpm: string
}

/**
 * The zoom stages, settle and pass limit -- one set for both tabs,
 * so a plan measured on Automation is measured exactly as a Manual check.
 */
export function MeasureSection({ value, onChange, disabled }: {
  value: MeasureSettings
  onChange: (next: MeasureSettings) => void
  disabled?: boolean
}) {
  const { stages } = value
  const set = (patch: Partial<MeasureSettings>) => onChange({ ...value, ...patch })
  const setStage = (i: number, patch: Partial<FreqStage>) =>
    set({ stages: stages.map((st, k) => (k === i ? { ...st, ...patch } : st)) })

  return (
    <Section
      title="Measure"
      panel
      action={
        <Stack direction="row" spacing={0.5}>
          <MiniAction startIcon={<AddIcon />} disabled={disabled || stages.length >= MAX_STAGES}
            onClick={() => {
              const last = stages[stages.length - 1] ?? DEFAULT_STAGES[0]
              set({ stages: [...stages, { span_hz: last.span_hz / 10, rbw_hz: Math.max(1, last.rbw_hz / 10), vbw_hz: Math.max(1, last.vbw_hz / 10) }] })
            }}>
            Add stage
          </MiniAction>
          <MiniAction startIcon={<RestartIcon />} disabled={disabled}
            onClick={() => set({ stages: DEFAULT_STAGES })}>
            Defaults
          </MiniAction>
        </Stack>
      }
    >
      <Stack spacing={1.25}>
        {stages.map((st, i) => (
          <Stack key={i} direction="row" spacing={1.5} alignItems="flex-end">
            <Typography sx={{ ...TEXT.label, color: 'text.secondary', width: 56, pb: 1 }}>Stage {i + 1}</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <FieldGrid>
                <KhzField label="Span" hz={st.span_hz} disabled={disabled}
                  onChange={(hz) => setStage(i, { span_hz: hz })} />
                <KhzField label="RBW" hz={st.rbw_hz} disabled={disabled}
                  onChange={(hz) => setStage(i, { rbw_hz: hz })} />
                <KhzField label="VBW" hz={st.vbw_hz} disabled={disabled}
                  onChange={(hz) => setStage(i, { vbw_hz: hz })} />
              </FieldGrid>
            </Box>
            <IconButton size="small" aria-label={`Remove stage ${i + 1}`} sx={{ mb: 0.5 }}
              disabled={disabled || stages.length <= 1}
              onClick={() => set({ stages: stages.filter((_, k) => k !== i) })}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        {/* Indented to the stage fields' column, so the two settings that
            are not per stage read as belonging to the whole measurement. */}
        <Stack direction="row" spacing={1.5} sx={{ pl: '68px' }}>
          <Box sx={{ width: 240 }}>
            {/* Raised to the floor on blur, not per keystroke, so "4" can
                still be typed on the way to "450". */}
            <LabeledField label="Settle" hint={`ms · min ${MIN_SETTLE_MS}`} type="number"
              value={value.settleMs}
              disabled={disabled} error={!settleValid(value.settleMs)}
              inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
              onBlur={() => set({ settleMs: String(clampSettleMs(Number(value.settleMs))) })}
              onChange={(e) => set({ settleMs: e.target.value })} />
          </Box>
          <Box sx={{ width: 240 }}>
            <LabeledField label="Pass within" hint="± ppm"
              value={value.limitPpm}
              disabled={disabled} error={!limitValid(value.limitPpm)}
              onChange={(e) => set({ limitPpm: e.target.value })} />
          </Box>
        </Stack>
      </Stack>
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
 * The hint spells out values that read awkwardly in kHz -- 0.01 kHz is 10 Hz.
 */
function KhzField({ label, hz, onChange, disabled }: {
  label: string
  hz: number
  onChange: (hz: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const plain = hz >= 1000 && hz < 1_000_000
  return (
    <LabeledField
      label={label}
      hint={plain ? 'kHz' : `kHz · ${formatHz(hz)}`}
      type="number"
      value={draft ?? khzText(hz)}
      disabled={disabled}
      inputProps={{ step: 'any', min: 0 }}
      onFocus={() => setDraft(khzText(hz))}
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

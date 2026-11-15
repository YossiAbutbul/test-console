import type { ReactNode } from 'react'
import { Box, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { LabeledField } from '../../components/LabeledField'
import type { FreqPointStatus } from '../../api/freqAccuracy'
import {
  FieldGrid, HeadCell, MONO, NUM_CELL_SX, Section, StatRow, StatTile, TEXT, VerdictMark,
} from '../../ui'
import { MeasureSection, type MeasureSettings } from './MeasureSection'
import { uplinkFromEarfcn } from '../../lib/earfcn'
import { LTE_MAX_POWER_DBM, manualChannel, powersOf, type Radio } from './radio'
import {
  combineVerdicts, formatErrorHz, formatHz, formatMhzToHz, limitOf, mhzToHz, ppmVerdict, stagePpm,
  stageTols,
} from './stages'

const bandOf = (earfcn?: number) => (earfcn != null ? uplinkFromEarfcn(earfcn)?.band ?? '' : '')

export interface ManualSettings {
  freqMhz: number
  power: number
  paMode: number
  /** LTE: the channel as typed, an EARFCN or MHz as the unit reads it. */
  channel?: string
}

/**
 * One carrier, measured once: what to transmit, how to measure it, then the
 * answer and how each stage got there -- top-down, as on the CW page.
 */
export function ManualPanel({
  radio, transmitAction, value, onChange, measure, onMeasureChange, point, phase, outcome, failed, disabled,
}: {
  radio: Radio
  /** LTE: the channel unit and bands, in Transmit's heading. */
  transmitAction?: ReactNode
  value: ManualSettings
  onChange: (next: ManualSettings) => void
  measure: MeasureSettings
  onMeasureChange: (next: MeasureSettings) => void
  /** This tab's last (or current) point, null before the first. */
  point: FreqPointStatus | null
  /** What the run is doing, while it runs. */
  phase: string | null
  /** How it ended, when it did not end with a reading. */
  outcome: string | null
  failed: boolean
  disabled: boolean
}) {
  const set = (patch: Partial<ManualSettings>) => onChange({ ...value, ...patch })
  const result = point?.result ?? null
  const done = point?.stages ?? []
  const stageCount = Math.max(measure.stages.length, done.length)
  const nominal = result?.nominal_hz ?? point?.freq_hz ?? 0
  const stageLimits = stageTols(measure.stageTolPpm, stageCount).map(limitOf)
  const stageVerdicts = done.map((r, i) => ppmVerdict(stagePpm(r.marker_hz, nominal), stageLimits[i]))
  // Judged by the stages' tolerances alone: a single carrier has no row of
  // its own to carry one, and the last stage's peak is the reading.
  const verdict = result ? combineVerdicts(stageVerdicts) : null
  const failedStage = stageVerdicts.indexOf('fail')
  const last = done[done.length - 1]
  const status = phase ?? outcome ?? point?.warnings[0] ?? null
  const lte = radio.id === 'LTE'
  const byEarfcn = radio.id === 'LTE' && radio.unit === 'earfcn'
  const { channel, issue } = manualChannel(value, radio)
  const badPower = powersOf(String(value.power), radio)?.length !== 1

  return (
    <>
      <Section title="Transmit" panel action={transmitAction}>
        <FieldGrid>
          {lte ? (
            // What the channel resolves to, as on the LTE CW page: the other
            // unit and the band, or why it does not resolve.
            <LabeledField label={byEarfcn ? 'EARFCN' : 'Frequency'} type="number"
              hint={issue ?? (byEarfcn
                ? `${channel!.freqMhz.toFixed(1)} MHz · Band ${bandOf(channel!.earfcn)}`
                : `EARFCN ${channel!.earfcn} · Band ${bandOf(channel!.earfcn)}`)}
              value={value.channel ?? ''} error={!!issue && (value.channel ?? '').trim() !== ''}
              disabled={disabled}
              onChange={(e) => set({ channel: e.target.value })} />
          ) : (
            <LabeledField label="Frequency" hint="MHz" type="number" value={value.freqMhz}
              disabled={disabled} inputProps={{ step: 0.1 }}
              onChange={(e) => set({ freqMhz: Number(e.target.value) })} />
          )}
          <LabeledField label="Power" hint={lte ? `dBm · max ${LTE_MAX_POWER_DBM}` : 'dBm'} type="number"
            value={value.power} error={badPower}
            inputProps={lte ? { min: 0, max: LTE_MAX_POWER_DBM, step: 0.5 } : undefined}
            disabled={disabled} onChange={(e) => set({ power: Number(e.target.value) })} />
          {!lte && (
            <LabeledField label="PA mode" select value={value.paMode} disabled={disabled}
              onChange={(e) => set({ paMode: Number(e.target.value) })}>
              <MenuItem value={2}>Auto</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={0}>Off</MenuItem>
            </LabeledField>
          )}
        </FieldGrid>
      </Section>

      <MeasureSection value={measure} onChange={onMeasureChange} disabled={disabled} />

      <Section title="Measurement" panel
        action={
          <Typography role="status" title={status ?? undefined} sx={{
            ...TEXT.hint, fontWeight: 600,
            color: failed ? 'error.main' : !phase && point?.warnings.length ? 'warning.main' : 'text.secondary',
            minWidth: 0, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {status}
          </Typography>
        }
      >
        <StatRow inCard minTile={150}>
          <StatTile primary label="Measured" unit="MHz"
            value={result ? formatMhzToHz(result.measured_hz) : '—'}
            sub={result ? `nominal ${(result.nominal_hz / 1e6).toFixed(6)} MHz` : 'not measured yet'} />
          <StatTile label="Frequency error" unit="Hz"
            value={result ? formatErrorHz(result.error_hz) : '—'}
            tone={verdict === 'fail' ? 'bad' : verdict === 'pass' ? 'ok' : undefined}
            sub={result ? `≈ ${formatHz(last.span_hz / 1000)} per trace bin` : ' '} />
          <StatTile label="Error in ppm" unit="ppm"
            value={result ? `${result.error_ppm >= 0 ? '+' : '−'}${Math.abs(result.error_ppm).toFixed(3)}` : '—'}
            tone={verdict === 'fail' ? 'bad' : verdict === 'pass' ? 'ok' : undefined}
            sub={failedStage >= 0 ? `stage ${failedStage + 1} outside ± ${stageLimits[failedStage]} ppm`
              : verdict === 'pass' ? 'every judged stage within' : ' '} />
          <StatTile label="Level at analyzer" unit="dBm"
            value={last?.level_dbm != null ? last.level_dbm.toFixed(1) : '—'}
            sub={result ? `ref level ${result.ref_level_dbm} dBm` : ' '} />
        </StatRow>
      </Section>

      <Section title="Stages measured" panel>
        {/* No rule under the last row: the card's own edge closes the table,
            and a hairline just above it read as a second border. */}
        {/* Scrolls inside its card when the pane is narrow: a table wider
            than the page pushed the whole page sideways. No Centre column:
            each stage is centred on the peak of the one before. */}
        <Box sx={{ overflowX: 'auto' }}>
        {/* Tighter cells than the theme's: eight columns at its padding were
            wider than a narrow pane's card. */}
        <Table size="small" sx={{
          '& tbody tr:last-of-type td': { borderBottom: 0 },
          '& th, & td': { px: 1 },
          '& th:first-of-type, & td:first-of-type': { pl: 0 },
          '& th:last-of-type, & td:last-of-type': { pr: 0 },
        }}>
          <TableHead>
            <TableRow>
              <HeadCell label="Stage" />
              <HeadCell label="Span" numeric />
              <HeadCell label="RBW" numeric />
              <HeadCell label="Peak" unit="MHz" numeric />
              <HeadCell label="Moved" unit="Hz" numeric />
              <HeadCell label="Level" unit="dBm" numeric />
              <HeadCell label="Error" unit="ppm" numeric />
              <HeadCell label="Verdict" />
            </TableRow>
          </TableHead>
          <TableBody>
            {/* One row per stage whether measured yet or not, so the table
                does not grow as the run fills it in. */}
            {Array.from({ length: stageCount }, (_, i) => {
              const r = done[i]
              const plan = measure.stages[i]
              return (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{formatHz(r?.span_hz ?? plan?.span_hz ?? 0)}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{formatHz(r?.rbw_hz ?? plan?.rbw_hz ?? 0)}</TableCell>
                  <TableCell sx={{ ...NUM_CELL_SX, fontFamily: MONO, color: r?.at_edge ? 'warning.main' : undefined }}>
                    {r ? mhzToHz(r.marker_hz) : ''}
                  </TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r ? formatErrorHz(r.shift_hz) : ''}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r?.level_dbm != null ? r.level_dbm.toFixed(1) : ''}</TableCell>
                  <TableCell sx={NUM_CELL_SX}>{r && nominal ? stagePpm(r.marker_hz, nominal).toFixed(3) : ''}</TableCell>
                  <TableCell>{r ? <VerdictMark verdict={stageVerdicts[i]} /> : ''}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </Box>
      </Section>
    </>
  )
}

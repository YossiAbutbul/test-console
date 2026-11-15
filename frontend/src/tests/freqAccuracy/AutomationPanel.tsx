import { useState, type ReactNode } from 'react'
import {
  Box, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import { useConnection } from '../../context/ConnectionContext'
import { formatDuration } from '../../lib/async'
import { downloadCsv, exportName } from '../../lib/download'
import { clampSettleMs } from '../../lib/settle'
import { selectOnFocus } from '../../lib/selectOnFocus'
import { parseRangeSpec } from '../../lib/numericList'
import { channelIssues, shortChannelIssue } from '../../lib/earfcn'
import {
  FAIL_ROW_SX, HeadCell, MONO, MiniAction, NUM_CELL_SX, Section, TEXT, VerdictMark, VerdictTally,
  type VerdictFilter,
} from '../../ui'
import { MeasureSection, type MeasureSettings } from './MeasureSection'
import { CellField, ColHead, PlanFooter, PlanGrid, PlanRow } from './planTable'
import {
  DEFAULT_ROWS, PA_MODE_LABEL, estimateRunMs, formatErrorHz, limitValid, mhzToHz, planPoints, pointVerdict,
  rowChannels, rowPointCount, rowPowers, type PlanRow as PlanRowSpec,
} from './stages'
import { LTE_MAX_POWER_DBM, type Radio } from './radio'

/** One measured point, as kept between visits and exported. */
export interface AutoResult {
  freqMhz: number
  /** LTE: the channel keyed. */
  earfcn?: number | null
  power: number
  paMode: number
  /** The row's tolerance it was judged by; null (or absent, in results kept
   *  from before the tolerance moved onto the row) is not judged. */
  limitPpm?: number | null
  /** Each stage's peak in ppm of nominal, and the tolerance it was judged by
   *  (absent in results kept from before stages had one). */
  stagePpm?: number[]
  stageLimits?: (number | null)[]
  measuredHz: number | null
  errorHz: number | null
  errorPpm: number | null
  levelDbm: number | null
  /** Why there is no reading, or what to be wary of in the one there is. */
  note: string
}

// Number, frequency, power, PA mode, tolerance, the row's point count, remove:
// the Sweep table's columns on the power page. They fill the row, but not in
// equal shares: a frequency spec runs long, a power list less, PA mode and a
// tolerance of a couple of digits are fixed.
const COLS = '20px minmax(160px, 2fr) minmax(120px, 1.3fr) 116px 112px 64px 32px'
// The columns' minimums and gaps, so only the outer box ever scrolls sideways.
const MIN_TABLE_W = 20 + 160 + 120 + 116 + 112 + 64 + 32 + 6 * 8
// LTE has no PA mode: the modem has none to set.
const LTE_COLS = '20px minmax(160px, 2fr) minmax(120px, 1.3fr) 112px 64px 32px'
const LTE_MIN_TABLE_W = 20 + 160 + 120 + 112 + 64 + 32 + 5 * 8

const CSV_TAIL = ['Tolerance [± ppm]', 'Measured [MHz]', 'Error [Hz]', 'Error [ppm]', 'Level [dBm]', 'Verdict', 'Note']
const CSV_HEADER = ['Frequency [MHz]', 'Power [dBm]', 'PA mode', ...CSV_TAIL]
const LTE_CSV_HEADER = ['EARFCN', 'Frequency [MHz]', 'Power [dBm]', ...CSV_TAIL]

export function AutomationPanel({
  radio, sweepAction, rows, onRowsChange, measure, onMeasureChange, results, planned, onClear, disabled,
}: {
  radio: Radio
  /** LTE: the channel unit and bands, beside Add. */
  sweepAction?: ReactNode
  rows: PlanRowSpec[]
  onRowsChange: (next: PlanRowSpec[]) => void
  measure: MeasureSettings
  onMeasureChange: (next: MeasureSettings) => void
  /** Measured so far, in plan order. */
  results: AutoResult[]
  /** Points in the run filling `results` in, while one is. */
  planned?: number
  onClear: () => void
  disabled: boolean
}) {
  const { status: bleStatus } = useConnection()
  const [filter, setFilter] = useState<VerdictFilter>('all')
  const lte = radio.id === 'LTE'
  const cols = lte ? LTE_COLS : COLS
  const total = planPoints(rows, radio).length
  const byEarfcn = radio.id === 'LTE' && radio.unit === 'earfcn'
  const update = (i: number, patch: Partial<PlanRowSpec>) =>
    onRowsChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  const verdicts = results.map((r) =>
    pointVerdict(r.errorPpm, r.limitPpm ?? null, r.stagePpm ?? [], r.stageLimits ?? []))
  const pass = verdicts.filter((v) => v === 'pass').length
  const fail = verdicts.filter((v) => v === 'fail').length
  const shown = results
    .map((r, i) => ({ r, v: verdicts[i], i }))
    .filter(({ v }) => filter === 'all' || v === filter)

  const exportCsv = () => {
    const mac = bleStatus?.address ?? null
    void downloadCsv(lte ? LTE_CSV_HEADER : CSV_HEADER, results.map((r, i) => [
      ...(lte ? [r.earfcn ?? '', r.freqMhz, r.power] : [r.freqMhz, r.power, PA_MODE_LABEL[r.paMode] ?? r.paMode]),
      r.limitPpm ?? '',
      r.measuredHz != null ? mhzToHz(r.measuredHz) : '',
      r.errorHz != null ? Math.round(r.errorHz) : '',
      r.errorPpm != null ? r.errorPpm.toFixed(4) : '',
      r.levelDbm != null ? r.levelDbm.toFixed(2) : '',
      verdicts[i] ?? '', r.note,
    ]), exportName(lte ? 'lte-frequency-accuracy' : 'frequency-accuracy', mac, 'csv'), {
      test: `${radio.id} frequency accuracy`, dut_mac: mac,
      stages: measure.stages.map((s) => `${s.span_hz}/${s.rbw_hz}/${s.vbw_hz} Hz`).join(' > '),
    })
  }

  return (
    <>
      <Section
        title="Sweep"
        panel
        action={
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {total} point{total === 1 ? '' : 's'}
            </Typography>
            {sweepAction}
            <MiniAction startIcon={<AddIcon />} disabled={disabled}
              onClick={() => onRowsChange([...rows, { ...(rows[rows.length - 1] ?? DEFAULT_ROWS[0]), freq: '' }])}>
              Add
            </MiniAction>
          </Stack>
        }
      >
        <PlanGrid cols={cols} minWidth={lte ? LTE_MIN_TABLE_W : MIN_TABLE_W} heads={<>
          <span />
          {byEarfcn ? <ColHead label="EARFCN" /> : <ColHead label="Freq" hint="MHz" />}
          <ColHead label="Power" hint="dBm" />
          {!lte && <ColHead label="PA mode" />}
          <ColHead label="Tolerance" hint="± ppm" />
          <span />
          <span />
        </>}>
          {rows.map((r, i) => {
            const badFreq = rowChannels(r, radio) === null
            const badPower = rowPowers(r, radio) === null
            const badTol = !limitValid(r.tolPpm)
            const n = rowPointCount(r, radio)
            // Names the bands, so the fix (which to untick, or tick) is in it.
            const freqHelp = !badFreq ? undefined
              : radio.id === 'LTE'
                ? shortChannelIssue(channelIssues(parseRangeSpec(r.freq), byEarfcn, radio.bands))
                  || (byEarfcn ? 'Try 18900 or 18700-19100:200' : 'Try 1880 or 1860-1900:20')
                : 'Try 915, 902.3,915 or 902.3-927.5:0.2'
            return (
              <PlanRow key={i} cols={cols} n={i + 1}
                readout={`${n} point${n === 1 ? '' : 's'}`}
                onRemove={() => onRowsChange(rows.filter((_, k) => k !== i))}
                removeDisabled={disabled || rows.length <= 1}>
                <CellField value={r.freq} disabled={disabled}
                  placeholder={!lte ? '915 or 900-930' : byEarfcn ? '18900 or 18700-19100:200' : '1880 or 1860-1900:20'}
                  error={badFreq} onFocus={selectOnFocus} title={freqHelp}
                  onChange={(e) => update(i, { freq: e.target.value })} />
                <CellField value={r.power} placeholder={lte ? '23 or 10,23' : '14 or 0,16,30'} disabled={disabled}
                  error={badPower} onFocus={selectOnFocus}
                  title={!badPower ? undefined : lte
                    ? `0 to ${LTE_MAX_POWER_DBM} dBm: 23, 10,23 or 10-20:5`
                    : 'Whole dBm, 0 to 255: 14, 0,16,30 or 10-20:5'}
                  onChange={(e) => update(i, { power: e.target.value })} />
                {!lte && (
                  <CellField select value={r.paMode} disabled={disabled}
                    onChange={(e) => update(i, { paMode: Number(e.target.value) })}>
                    <MenuItem value={2}>Auto</MenuItem>
                    <MenuItem value={1}>On</MenuItem>
                    <MenuItem value={0}>Off</MenuItem>
                  </CellField>
                )}
                {/* No "±" in the field: the heading already says "± ppm". */}
                <CellField type="number" value={r.tolPpm} disabled={disabled}
                  error={badTol} onFocus={selectOnFocus}
                  inputProps={{ min: 0, step: 1 }}
                  title={badTol ? 'A tolerance in ppm above 0, or blank for no verdict' : undefined}
                  onChange={(e) => update(i, { tolPpm: e.target.value })} />
              </PlanRow>
            )
          })}
        </PlanGrid>

        <PlanFooter hint={!lte
          ? 'Freq / Power: "915" · "900-930:5" · "902.3,915" · Tolerance blank = no verdict'
          : byEarfcn
            ? 'EARFCN / Power: "18900" · "18700-19100:200" · "18700,19100" · Tolerance blank = no verdict'
            : 'MHz / Power: "1880" · "1860-1900:20" · "1860,1900" · Tolerance blank = no verdict'}>
          {/* A long settle looks like a hung run; say the cost up front. */}
          {total > 0 && (
            <Typography sx={{ ...TEXT.micro, whiteSpace: 'nowrap', flexShrink: 0, color: 'text.secondary' }}>
              ≈ {formatDuration(estimateRunMs(total, measure.stages, clampSettleMs(Number(measure.settleMs))))}
            </Typography>
          )}
        </PlanFooter>
      </Section>

      <MeasureSection value={measure} onChange={onMeasureChange} disabled={disabled} />

      <Section
        title="Results"
        panel
        action={
          <Stack direction="row" spacing={0.5}>
            <MiniAction startIcon={<DownloadIcon />} disabled={results.length === 0} onClick={exportCsv}>
              Export
            </MiniAction>
            <MiniAction tone="destructive" startIcon={<DeleteSweepIcon />}
              disabled={disabled || results.length === 0}
              onClick={() => { setFilter('all'); onClear() }}>
              Clear
            </MiniAction>
          </Stack>
        }
      >
        <Box sx={{ mb: 1 }}>
          <VerdictTally pass={pass} fail={fail} na={results.length - pass - fail}
            measured={results.length} planned={planned} filter={filter} onFilter={setFilter} />
        </Box>
        <Table size="small" sx={{ '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
          <TableHead>
            <TableRow>
              <HeadCell label="#" />
              <HeadCell label="Frequency" unit="MHz" numeric />
              <HeadCell label="Power" unit="dBm" numeric />
              {lte ? <HeadCell label="EARFCN" numeric /> : <HeadCell label="PA" />}
              <HeadCell label="Measured" unit="MHz" numeric />
              <HeadCell label="Error" unit="Hz" numeric />
              <HeadCell label="Error" unit="ppm" numeric />
              <HeadCell label="Level" unit="dBm" numeric />
              <HeadCell label="Verdict" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ ...TEXT.hint, color: 'text.secondary', py: 2 }}>
                  {results.length === 0 ? 'Run the sweep to measure each frequency.' : 'No rows match the filter.'}
                </TableCell>
              </TableRow>
            )}
            {shown.map(({ r, v, i }) => (
              <TableRow key={i} sx={v === 'fail' ? FAIL_ROW_SX : undefined} title={r.note || undefined}>
                <TableCell>{i + 1}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.freqMhz.toFixed(4)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.power}</TableCell>
                {lte
                  ? <TableCell sx={NUM_CELL_SX}>{r.earfcn ?? ''}</TableCell>
                  : <TableCell>{PA_MODE_LABEL[r.paMode] ?? r.paMode}</TableCell>}
                <TableCell sx={{ ...NUM_CELL_SX, fontFamily: MONO }}>
                  {r.measuredHz != null ? mhzToHz(r.measuredHz) : ''}
                </TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.errorHz != null ? formatErrorHz(r.errorHz) : ''}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.errorPpm != null ? r.errorPpm.toFixed(3) : ''}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{r.levelDbm != null ? r.levelDbm.toFixed(1) : ''}</TableCell>
                <TableCell>
                  {r.measuredHz == null
                    ? <Box component="span" sx={{ color: 'error.main', fontSize: 12.5 }}>{r.note || 'Failed'}</Box>
                    : <VerdictMark verdict={v} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  )
}

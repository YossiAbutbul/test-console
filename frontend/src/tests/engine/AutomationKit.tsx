/**
 * The layout half of a sweep panel, shared by the five automation panels:
 * the Sweep card (plan rows, Settle, Add, the syntax line and the estimate)
 * and the Results card (tally, table, Graph / Export / Report / Import /
 * Clear). The run half is `useAutomationRun`.
 *
 * Each panel still owns what is its own: the columns of its sweep rows and
 * results table, extra header controls (unit, bands, tone), and the
 * estimate's wording.
 */
import { memo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Box, Divider, IconButton, Stack, Table, TableBody, TableHead, TableRow,
  Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import ShowChartIcon from '@mui/icons-material/ShowChartRounded'
import UploadIcon from '@mui/icons-material/UploadRounded'
import WarningAmberIcon from '@mui/icons-material/WarningAmberRounded'
import { AddToReport } from '../../components/reports/AddToReport'
import type { ReportEntryDraft } from '../../api/reports'
import { TopProgress } from '../../components/TopProgress'
import { formatDuration } from '../../lib/async'
import { MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { tallyVerdicts } from '../../lib/verdict'
import {
  CONTROL_H, FollowLatest, MiniAction, Section, TEXT, VerdictTally, useFollowBottom,
  type VerdictFilter,
} from '../../ui'
import { RunTiming } from '../../ui/RunTiming'
import type { JudgedRow } from './useAutomationRun'
import { LONG_SETTLE_MS, PANEL_HEIGHT, PANEL_MIN_HEIGHT } from './automationLayout'
import { NumberField } from '../../ui/NumberField'

/** Column heading, in the same shape as `LabeledField`: name, then a quieter
 *  unit or range beside it. */
export function ColHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 13, fontWeight: 500, color: 'text.primary',
        // Truncate rather than run into the next column. A hint that outgrew
        // its column used to sit on top of the heading beside it.
        display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
      {hint && (
        <Box
          component="span"
          sx={{ ml: 0.5, fontSize: 12, fontWeight: 400, color: 'text.secondary' }}
        >
          {hint}
        </Box>
      )}
    </Typography>
  )
}

/** A small labelled number field for the Sweep card's heading: Settle, Tone. */
export function HeaderField({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
      {children}
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{unit}</Typography>
    </Stack>
  )
}

/**
 * Settle, in the Sweep card's heading. It is the one thing there that is
 * genuinely run-wide: it is about instrument timing, not about the signal or
 * the channel, so it stays out of the table.
 */
export function SettleField({ value, onChange, disabled }: {
  value: number
  onChange: (update: number | ((v: number) => number)) => void
  disabled: boolean
}) {
  return (
    <HeaderField label="Settle" unit="ms">
      <NumberField
        size="small"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        // Clamped once the operator leaves the field, not while typing: a
        // value below the floor is a step on the way to a larger one.
        onBlur={() => onChange((v) => clampSettleMs(v))}
        disabled={disabled}
        inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
        // The heading's one control height, shared with the segmented
        // choice and the text actions beside it; the theme's small input
        // is 32.
        sx={{ width: 84, '& .MuiInputBase-root': { height: CONTROL_H.sm } }}
      />
    </HeaderField>
  )
}

/** The plan's cost before it runs: settle dominates, so a long one is
 *  flagged -- it looks identical to a hung run. */
export function SettleEstimate({ ms, settleMs, suffix }: { ms: number; settleMs: number; suffix?: string }) {
  const long = settleMs >= LONG_SETTLE_MS
  return (
    <Typography
      sx={{
        ...TEXT.micro,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        color: long ? 'warning.main' : 'text.secondary',
      }}
    >
      {long && <WarningAmberIcon sx={{ fontSize: 14, verticalAlign: '-2px', mr: 0.5 }} />}
      ≈ {formatDuration(ms)}{suffix}
    </Typography>
  )
}

/** One plan row: its number, the panel's fields, its point count, Remove. */
export function SweepRowShell({ index, cols, points, readout, onRemove, disabled, children }: {
  index: number
  cols: string
  points: number
  /** In place of the plain point count, for a row that also states what its
   *  first value resolved to. */
  readout?: ReactNode
  onRemove: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, alignItems: 'center' }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right' }}>
        {index + 1}.
      </Typography>
      {children}
      {readout ?? (
        // "points", the heading's word for the same count.
        <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {points} point{points === 1 ? '' : 's'}
        </Typography>
      )}
      {/* Pinned to the right edge, on the card's own fill, so when a narrow
          panel scrolls the row sideways the key that removes it stays in
          reach. */}
      <Box sx={{ display: 'flex', position: 'sticky', right: 0, zIndex: 1, bgcolor: 'background.paper' }}>
        <Tooltip title="Remove row">
          <span>
            <IconButton
              size="small"
              aria-label={`Remove row ${index + 1}`}
              onClick={onRemove}
              disabled={disabled}
            >
              <DeleteIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}

/**
 * The Sweep card: heading (point count, the panel's controls, Add), column
 * headings, rows, and a footer with the syntax line and the run's cost.
 */
export function SweepCard({
  running, totalPoints, completedPoints, plannedRunMs, controls, onAdd,
  cols, minTableW, heads, bodyRef, syntaxHint, syntaxLine, estimate, children,
}: {
  running: boolean
  totalPoints: number
  completedPoints: number
  plannedRunMs: number
  /** Between the point count and Add: unit, bands, Settle, Tone. */
  controls: ReactNode
  onAdd: () => void
  /** One grid template shared by the header and every row, so the two
   *  cannot drift apart the way per-cell fixed widths do. */
  cols: string
  minTableW: number
  /** The column headings, without the leading index and trailing two cells. */
  heads: ReactNode
  bodyRef: RefObject<HTMLDivElement | null>
  /** The range-spec syntax, whole, for the tooltip on the footer line. */
  syntaxHint: ReactNode
  /** The same, cut down so it fits a 1440 window with the inspector open. */
  syntaxLine: string
  /** The cost before a run, or null to show nothing. */
  estimate: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        maxHeight: PANEL_HEIGHT, minHeight: PANEL_MIN_HEIGHT,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}
    >
      {/* Same bar the Mode Sweep pins under the top bar. Fixed, so it takes
          no room here, and it disappears with the tab or page it is on. */}
      <TopProgress
        pct={totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0}
        hidden={!running}
      />
      <Section
        title="Sweep"
        panel
        grow
        action={
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {totalPoints} point{totalPoints === 1 ? '' : 's'}
            </Typography>
            {controls}
            <MiniAction startIcon={<AddIcon />} onClick={onAdd} disabled={running}>
              Add
            </MiniAction>
          </Stack>
        }
      >
        <Box ref={bodyRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
          <Box sx={{ minWidth: minTableW }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, alignItems: 'end', mb: 0.75 }}>
              <Box />
              {heads}
              <Box />
              <Box />
            </Box>
            <Stack spacing={0.75}>{children}</Stack>
          </Box>
        </Box>

        <Stack
          direction="row"
          justifyContent="space-between"
          spacing={2}
          sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}
        >
          {/* Shrinks and ellipsizes rather than pushing the estimate out of the
              panel: both used to be nowrap in a fixed-height box, and the
              estimate was the one that got clipped. The full text is on hover. */}
          <Tooltip title={syntaxHint} placement="top-start">
            <Typography
              sx={{
                fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap',
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {syntaxLine}
            </Typography>
          </Tooltip>
          {/* A long run looks identical to a hung one, so state the cost up
              front rather than letting the operator guess. */}
          {running ? (
            <RunTiming
              running={running}
              completed={completedPoints}
              total={totalPoints}
              plannedTotalMs={plannedRunMs}
              sx={{ flexShrink: 0 }}
            />
          ) : estimate}
        </Stack>
      </Section>
    </Box>
  )
}

/** A results row, memoised: a run appends one row at a time to a table
 *  that can hold hundreds. */
const ResultRow = memo(function ResultRow<Row>({ r, i, render }: {
  r: Row
  i: number
  render: (r: Row, i: number) => ReactNode
}) {
  return <>{render(r, i)}</>
}) as <Row>(p: { r: Row; i: number; render: (r: Row, i: number) => ReactNode }) => ReactNode

/**
 * The Results card: actions, the verdict tally (which also filters), and the
 * table, following the newest row unless the operator has scrolled up.
 */
export function ResultsCard<Row extends JudgedRow>({
  results, running, totalPoints, onGraph, onExport, report, onImport, onClear,
  minWidth, colWidths, heads, renderRow,
}: {
  results: Row[]
  running: boolean
  totalPoints: number
  /** Absent on a panel without a graph. */
  onGraph?: () => void
  onExport: () => void
  /** The table as Export writes it, into a product's report. */
  report: () => ReportEntryDraft
  onImport: (f: File) => void
  onClear: () => void
  /** The width under which the table scrolls sideways rather than cut a
   *  heading or a value. */
  minWidth: number
  /** One per column, `#` first: px, or a share of the table. */
  colWidths: Array<number | string>
  heads: ReactNode
  /** One `<TableRow>`. Must be stable (module-level), or every row
   *  re-renders on every point. */
  renderRow: (r: Row, i: number) => ReactNode
}) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Follow the newest row, unless the operator has scrolled up to read one.
  const follow = useFollowBottom(scrollRef, results.length)

  // The tally's keys filter the table. A filter whose rows are all gone --
  // Clear, a new run -- falls back to everything rather than leaving an
  // empty table with a key still lit.
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const t = tallyVerdicts(results)
  const shown: VerdictFilter = verdictFilter !== 'all' && t[verdictFilter as 'pass' | 'fail'] === 0
    ? 'all'
    : verdictFilter

  const empty = results.length === 0
  return (
    <Section
      title="Results"
      panel
      grow
      action={
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          {onGraph && (
            <MiniAction startIcon={<ShowChartIcon />} onClick={onGraph} disabled={empty}>
              Graph
            </MiniAction>
          )}
          <MiniAction startIcon={<DownloadIcon />} onClick={onExport} disabled={empty}>
            Export
          </MiniAction>
          <AddToReport disabled={empty || running} build={report} />
          <MiniAction
            startIcon={<UploadIcon />}
            onClick={() => fileInput.current?.click()}
            disabled={running}
          >
            Import
          </MiniAction>
          {/* Clear last and apart: it is the one action here that throws
              results away, and it used to sit between Import and Graph. */}
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
          <MiniAction
            tone="destructive"
            startIcon={<DeleteSweepIcon />}
            onClick={onClear}
            disabled={empty || running}
          >
            Clear
          </MiniAction>
        </Stack>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept=".csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Reset first: re-picking the same file fires no change event
          // otherwise, so a second import would look ignored.
          e.target.value = ''
          if (f) onImport(f)
        }}
      />

      {/* Shown with zeros before the first result too, so the first row of
          a run lands in a table that is already where it will stay. */}
      <VerdictTally
        pass={t.pass}
        fail={t.fail}
        na={results.length - t.total}
        measured={results.length}
        planned={running ? totalPoints : undefined}
        filter={shown}
        onFilter={setVerdictFilter}
      />

      {/* No "no data yet" line: the table itself, header and an empty body,
          so the panel looks the same before the first row as after. */}
      <Box ref={scrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
        <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%', minWidth }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <TableHead>
            <TableRow>{heads}</TableRow>
          </TableHead>
          <TableBody>
            {/* Filtered by the tally's keys; each row keeps its own index,
                so "#7" is still the seventh point. */}
            {results.map((r, i) => (shown === 'all' || r.verdict === shown) && (
              <ResultRow key={i} r={r} i={i} render={renderRow} />
            ))}
          </TableBody>
        </Table>
        <FollowLatest follow={follow} />
      </Box>
    </Section>
  )
}

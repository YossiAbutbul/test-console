import type { ReactNode } from 'react'
import { Box, ButtonBase, CircularProgress, Typography } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded'
import { useAppPalette } from '../context/ThemeModeContext'
import { PANEL_SX } from './tokens'

/**
 * Where one check on a page's course stands.
 *
 * - `ok`: done; nothing to do here.
 * - `block`: stops Send or Run until it is dealt with.
 * - `warn`: worth a look, but does not stop anything (a frequency with no
 *   measured loss, which runs on the default).
 * - `todo`: not done yet, and nothing wrong with that (an instrument the
 *   preflight will connect on its own).
 * - `error`: something failed and says why.
 * - `busy`: in progress (connecting, running).
 */
export type CheckState = 'ok' | 'block' | 'warn' | 'todo' | 'error' | 'busy'

/** The word each mark stands for, for assistive tech and the tooltip. A mark
 *  is never the only carrier: the label and summary beside it say it too. */
const STATE_WORD: Record<CheckState, string> = {
  ok: 'Done',
  block: 'Blocking',
  warn: 'Check',
  todo: 'Not done yet',
  error: 'Error',
  busy: 'In progress',
}

/**
 * The status mark. Shape changes with state as well as colour, so the course
 * reads the same to someone who cannot tell the amber from the green:
 *
 * - done: a filled disc with a tick;
 * - blocking: a filled disc with "!";
 * - check: an open ring with "!";
 * - error: an open ring with a cross;
 * - not done yet: an empty ring;
 * - in progress: a spinner.
 *
 * Filled means settled one way or the other -- done, or must be dealt with --
 * which is what the eye scans the rail for.
 */
export function CheckMark({ state, size = 24 }: { state: CheckState; size?: number }) {
  const p = useAppPalette()
  const glyph = Math.round(size * 0.66)
  const ring = {
    ok: p.data.ok,
    block: p.data.warn,
    warn: p.data.warn,
    error: p.data.bad,
    todo: p.sidebar.textDim,
    busy: p.sidebar.textDim,
  }[state]
  const filled = state === 'ok' || state === 'block'
  return (
    <Box
      component="span"
      role="img"
      aria-label={STATE_WORD[state]}
      sx={{
        width: size, height: size, borderRadius: '50%', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `2px solid ${ring}`,
        bgcolor: filled ? ring : 'transparent',
        // The same near-black-on-bright rule as the action fills: white on
        // these lamp colours does not clear 4.5:1 in Mid and Dark.
        color: filled ? p.actions.connect.fg : ring,
      }}
    >
      {state === 'ok' && <CheckRoundedIcon sx={{ fontSize: glyph }} />}
      {(state === 'block' || state === 'warn') && <PriorityHighRoundedIcon sx={{ fontSize: glyph }} />}
      {state === 'error' && <CloseRoundedIcon sx={{ fontSize: glyph }} />}
      {state === 'busy' && <CircularProgress size={size - 8} thickness={5} sx={{ color: ring }} />}
    </Box>
  )
}

interface CheckStepProps {
  state: CheckState
  /** What is being checked, in one or two words: "DUT", "Path loss". */
  label: string
  /** Where it stands, in one short line: "Sonata 2 IL · D4:A1:B2". */
  summary?: ReactNode
  /** Its detail is open below the rail. */
  selected?: boolean
  /** Opens the step's detail, or takes the operator to the part of the page
   *  that settles it. Omit for a step that only reports. */
  onClick?: () => void
}

/** One check on the rail: mark, label, and a one-line summary. */
export function CheckStep({ state, label, summary, selected, onClick }: CheckStepProps) {
  const p = useAppPalette()
  const summaryColor = state === 'block' || state === 'warn'
    ? p.data.warn
    : state === 'error' ? p.data.bad : 'text.secondary'
  return (
    <ButtonBase
      disabled={!onClick}
      onClick={onClick}
      aria-expanded={onClick ? !!selected : undefined}
      aria-label={`${label}: ${STATE_WORD[state]}`}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25,
        minWidth: 0, px: 1.5, py: 1.1, textAlign: 'left',
        bgcolor: selected ? p.sidebar.accentSoft : 'transparent',
        transition: 'background-color 0.15s',
        '&:hover': onClick ? { bgcolor: selected ? p.sidebar.accentSoftHover : p.sidebar.hover } : undefined,
        '&.Mui-focusVisible': { outline: `2px solid ${p.sidebar.text}`, outlineOffset: -2 },
        // Report-only steps are not controls; drop the disabled look MUI would
        // otherwise give them.
        '&.Mui-disabled': { color: 'inherit' },
      }}
    >
      <CheckMark state={state} />
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'text.primary' }}>
          {label}
        </Typography>
        {summary != null && (
          <Typography
            noWrap
            className="check-summary"
            sx={{ fontSize: 12.5, lineHeight: 1.3, color: summaryColor }}
          >
            {summary}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  )
}

/**
 * The course: a page's checks on one hairline strip, in the order they are
 * done. Below a narrow container the summaries drop out before anything wraps,
 * so the marks and labels keep one line at a 1280 px laptop width.
 */
export function CheckRail({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ ...PANEL_SX, overflow: 'hidden', containerType: 'inline-size' }}>
      {/* Same hairline trick as StatRow: every cell draws its own left and top
          rule and the grid is pulled one pixel outside the frame, so the
          dividers are right at any wrap point. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          ml: '-1px', mt: '-1px',
          '& > *': { borderLeft: 1, borderTop: 1, borderColor: 'divider' },
          '@container (max-width: 760px)': { '& .check-summary': { display: 'none' } },
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** The detail of the step that is open, directly under the rail. */
export function CheckDetail({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ ...PANEL_SX, p: 1.5, containerType: 'inline-size' }}>
      {children}
    </Box>
  )
}

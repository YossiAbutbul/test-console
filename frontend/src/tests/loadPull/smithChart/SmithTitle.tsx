import { memo, useState } from 'react'
import {
  Box, ButtonBase, DialogTitle, IconButton, Popover, Stack, Switch, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ContentCopyIcon from '@mui/icons-material/ContentCopyRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import TuneIcon from '@mui/icons-material/TuneRounded'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { MiniAction, PRESS_SX, SegmentedChoice, TEXT } from '../../../ui'
import { Z0 } from '../smith'
import { STYLE_DEFAULT, type SmithStyle } from './model'

/**
 * One titled group of a settings sheet: a caption over a tinted, rounded
 * block whose rows are parted by hairlines inset to the label's edge.
 */
function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const pal = useAppPalette()
  return (
    <Box sx={{ '& + &': { mt: 1.5 } }}>
      <Typography
        sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', color: 'text.secondary', px: 1, mb: 0.5 }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          borderRadius: '10px', bgcolor: alpha(pal.sidebar.text, 0.045),
          '& > * + *': {
            position: 'relative',
            '&::before': {
              content: '""', position: 'absolute', top: 0, left: 12, right: 0,
              height: '1px', bgcolor: alpha(pal.sidebar.text, 0.08),
            },
          },
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** A sheet row: label left, control right, one height whatever the control.
 *  With `htmlFor` the whole row is the label, so the text toggles a switch. */
function SheetRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <Box
      component={htmlFor ? 'label' : 'div'}
      htmlFor={htmlFor}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
        minHeight: 40, pl: 1.5, pr: 1, cursor: htmlFor ? 'pointer' : 'default',
      }}
    >
      <Typography sx={{ fontSize: 13 }}>{label}</Typography>
      {children}
    </Box>
  )
}

const TAB_OPTIONS = [{ value: 'points' as const, label: 'Points' }, { value: 'area' as const, label: 'Working area' }]
const DOT_OPTIONS = [{ value: 's' as const, label: 'S' }, { value: 'm' as const, label: 'M' }, { value: 'l' as const, label: 'L' }]
const COLOUR_BY_OPTIONS = [
  { value: 'eff' as const, label: 'Efficiency' },
  { value: 'pout' as const, label: 'Pout' },
  { value: 'att' as const, label: 'Att' },
]

/**
 * The dialog's title bar: name, point count, the tab switch, graph options
 * and Copy chart. Memoised, with stable callbacks: it redrew with every
 * change in the dialog -- a hover, a live row, a style switch -- at 10-15 ms
 * a time in development, for a bar that changes only with its own props.
 */
export const SmithTitle = memo(function SmithTitle({
  nPoints, tauPs, tab, onTab, style, onStyle, attsCount, copied, onCopy, onClose,
}: {
  nPoints: number
  tauPs: number
  tab: 'points' | 'area'
  onTab: (v: 'points' | 'area') => void
  style: SmithStyle
  onStyle: (next: SmithStyle | ((prev: SmithStyle) => SmithStyle)) => void
  attsCount: number
  copied: 'idle' | 'done' | 'failed'
  onCopy: () => void
  onClose: () => void
}) {
  const pal = useAppPalette()
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null)
  const isDefaultStyle = (Object.keys(STYLE_DEFAULT) as Array<keyof SmithStyle>)
    .every((k) => style[k] === STYLE_DEFAULT[k])
  const setStyleOpt = <K extends keyof SmithStyle>(k: K, v: SmithStyle[K]) =>
    onStyle((p) => ({ ...STYLE_DEFAULT, ...p, [k]: v }))
  return (
  <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1.5 }}>
    <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
      <Typography sx={TEXT.dialog}>Smith chart</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {nPoints} point{nPoints === 1 ? '' : 's'} · Z₀ = {Z0} Ω
        {tauPs ? ` · at the PA, τ = ${tauPs} ps` : ''}
      </Typography>
    </Stack>
    <Box sx={{ ml: 2.5 }}>
      <SegmentedChoice
        text aria-label="View" value={tab}
        options={TAB_OPTIONS}
        onChange={onTab}
      />
    </Box>
    <Box sx={{ flexGrow: 1 }} />
    {/* The dialog's one action, so accent; fixed width so the three
        labels it cycles through never move the close key beside it. */}
    <Tooltip title="Graph options">
      <IconButton
        size="small" onClick={(e) => setStyleAnchor(e.currentTarget)}
        aria-label="Graph options" sx={{ mr: 0.5 }}
      >
        <TuneIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
    {/* A settings sheet in the macOS manner: inset groups of uniform
        rows, the label on the left and its control on the right, so the
        eye runs down one edge for names and the other for values. It was
        switches glued to their labels on the left and the pickers on the
        right, two alignments in one short list. Grows from the key that
        opened it. */}
    <Popover
      open={!!styleAnchor}
      anchorEl={styleAnchor}
      onClose={() => setStyleAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            mt: 0.75, width: 300, p: 1.5, borderRadius: '12px',
            border: 1, borderColor: 'divider',
            boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
          },
        },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 0.5, mb: 1.25 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Graph options</Typography>
        {/* Quiet, and only live when there is something to reset. */}
        <ButtonBase
          onClick={() => onStyle(STYLE_DEFAULT)}
          disabled={isDefaultStyle}
          sx={{
            ...PRESS_SX, fontSize: 12, fontWeight: 500, borderRadius: '6px', px: 0.75, py: 0.25,
            color: 'primary.main', '&.Mui-disabled': { color: 'text.disabled' },
            '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.06) },
          }}
        >
          Reset
        </ButtonBase>
      </Stack>

      <SheetGroup title="Display">
        <SheetRow label="Connecting lines" htmlFor="smith-opt-lines">
          <Switch
            id="smith-opt-lines" size="small" checked={style.lines}
            onChange={(_e, c) => setStyleOpt('lines', c)}
          />
        </SheetRow>
        <SheetRow label="Grid" htmlFor="smith-opt-grid">
          <Switch
            id="smith-opt-grid" size="small" checked={style.grid}
            onChange={(_e, c) => setStyleOpt('grid', c)}
          />
        </SheetRow>
      </SheetGroup>

      <SheetGroup title="Points">
        <SheetRow label="Size">
          <SegmentedChoice
            text aria-label="Dot size" value={style.dot}
            options={DOT_OPTIONS}
            onChange={(v) => setStyleOpt('dot', v)}
          />
        </SheetRow>
        {/* Attenuator only means something on a run that swept it, so it is
            offered only then; efficiency and Pout always. */}
        <SheetRow label="Colour by">
          <SegmentedChoice
            text aria-label="Colour by"
            value={style.color === 'att' && attsCount < 2 ? 'eff' : style.color}
            options={attsCount > 1 ? COLOUR_BY_OPTIONS : COLOUR_BY_OPTIONS.filter((o) => o.value !== 'att')}
            onChange={(v) => setStyleOpt('color', v)}
          />
        </SheetRow>
      </SheetGroup>
    </Popover>
    <MiniAction
      startIcon={copied === 'done' ? <CheckRoundedIcon /> : <ContentCopyIcon />}
      onClick={onCopy}
      disabled={nPoints === 0}
      color={copied === 'failed' ? 'error' : 'primary'}
      sx={{ mr: 1, width: 112, justifyContent: 'flex-start' }}
    >
      {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy chart'}
    </MiniAction>
    <IconButton size="small" onClick={onClose} aria-label="Close">
      <CloseIcon sx={{ fontSize: 18 }} />
    </IconButton>
  </DialogTitle>
  )
})

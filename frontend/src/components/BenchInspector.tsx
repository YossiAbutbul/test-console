import { useMemo, type ReactNode } from 'react'
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { DutControls, PathLossField } from './ConnectionPanel'
import { useConnection } from '../context/ConnectionContext'
import { useDutLink } from '../context/dutLink'
import { useNicknames } from '../context/NicknamesContext'
import { usePathLoss } from '../context/PathLossContext'
import {
  useInstrumentsActions, useInstrumentsState, type InstrumentStatus,
} from '../context/InstrumentsContext'
import { useInstrumentsUnavailableReason } from '../context/CapabilitiesContext'
import { useAppPalette, useThemeMode } from '../context/ThemeModeContext'

/**
 * One inspector group: a small heading and an inset list, as in a macOS
 * inspector or System Settings. The heading names the object; the rows under
 * it are its state and its controls.
 */
/**
 * A titled block of rows. `plain` drops the grouped fill: for a group that
 * holds a field, whose own border already marks it, where the fill put a
 * bordered box on a grey slab.
 */
function Group({ title, trailing, plain, children }: { title: string; trailing?: ReactNode; plain?: boolean; children: ReactNode }) {
  const p = useAppPalette()
  const { mode } = useThemeMode()
  return (
    <Box component="section" aria-label={title} sx={{ mb: 2.5 }}>
      <Stack direction="row" alignItems="baseline" sx={{ px: 0.5, mb: 0.75, gap: 1 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flexGrow: 1 }}>
          {title}
        </Typography>
        {trailing}
      </Stack>
      <Box
        sx={{
          // A step off the pane: lighter than it on the dark grounds, the
          // grouped grey on Light's white pane.
          bgcolor: plain ? 'transparent' : (mode === 'light' ? p.contentBg : p.paper),
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** A row of an inspector group, hairline between rows. */
function Row({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label?: string }) {
  const p = useAppPalette()
  const sx = {
    display: 'flex', alignItems: 'center', gap: 1,
    minHeight: 34, px: 1.5, width: '100%',
    fontSize: 13, textAlign: 'left' as const, color: 'text.primary',
    '& + &': { borderTop: `1px solid ${p.appBarBorder}` },
  }
  return onClick
    ? (
      // Answers on the press, not the release: the darker fill lands on
      // pointer-down with no ripple to wait for, and the chevron leans the way
      // the row goes. A row that only lit on hover read as a status line, not
      // as something to press.
      <ButtonBase
        onClick={onClick}
        aria-label={label}
        disableRipple
        sx={{
          ...sx,
          transition: 'background-color 120ms ease-out',
          '& .row-chevron': { transition: 'transform 160ms ease-out, color 120ms ease-out' },
          '&:hover': { bgcolor: p.sidebar.hover },
          '&:hover .row-chevron': { color: 'text.secondary', transform: 'translateX(2px)' },
          '&.Mui-focusVisible': { bgcolor: p.sidebar.hover, outline: `2px solid ${p.sidebar.accent}`, outlineOffset: -2 },
          '&:active': { bgcolor: p.sidebar.accentSoftHover, transition: 'none' },
          '@media (prefers-reduced-motion: reduce)': {
            '&:hover .row-chevron': { transform: 'none' },
          },
        }}
      >
        {children}
      </ButtonBase>
    )
    : <Box sx={sx}>{children}</Box>
}

/** An 8 px status dot. The words beside it carry the state as well, so a dot
 *  is never the only thing saying it. */
function Dot({ color }: { color: string }) {
  return <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
}

// The words the Instruments panel and each page's instrument bar use, so one
// instrument is not "Ready" here and "Connected" a click away.
const STATUS_WORD: Record<InstrumentStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  error: 'Error',
  disconnected: 'Not connected',
}

function DutGroup() {
  const p = useAppPalette()
  const { status } = useConnection()
  const { scanning } = useDutLink()
  const nicknames = useNicknames()
  const connected = !!status?.connected
  const addr = status?.address ?? null
  const name = connected
    ? (addr && nicknames.get(addr)) || status?.name || 'Connected device'
    : 'No device'
  const word = connected
    ? (status?.transport_ready ? 'Connected' : 'Linking…')
    : scanning ? 'Scanning…' : 'Not connected'
  return (
    <Group title="Device under test">
      <Row>
        <Dot color={connected ? p.data.ok : p.sidebar.successOff} />
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1, minWidth: 0 }}>{name}</Typography>
        <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary', flexShrink: 0 }}>{word}</Typography>
      </Row>
      <Box sx={{ px: 1.5, py: 1.5, borderTop: `1px solid ${p.appBarBorder}` }}>
        <DutControls stacked />
      </Box>
    </Group>
  )
}

/** A value in the Default field's column, right-aligned flush with the
 *  field's right edge. It used to stop 15 px short, under the field's tune
 *  glyph; now that the field has a visible border, that border is the line
 *  the eye follows, so the values end on it. Numbers in a column line up by
 *  their end. */
const VALUE_COL_SX = {
  width: 104, flexShrink: 0, textAlign: 'right', pr: 0,
  fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'text.primary',
} as const

/** Calibrated frequencies visible before the list scrolls. */
const POINTS_VISIBLE = 4

function PathLossGroup() {
  const p = useAppPalette()
  const { points } = usePathLoss()
  return (
    <Group title="Path loss, DUT to sensor" plain>
      {/* Label left, value right, as a settings row: the stacked label above
          the field wrapped onto two lines in a 280 px pane. */}
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 48, px: 1.5, '& > *': { flexGrow: 1, justifyContent: 'space-between' } }}>
        <PathLossField compact label="Default" />
      </Box>
      {/* The calibrated frequencies themselves, each with its loss, rather
          than a count: "2" said there was a table without saying whether the
          frequency under test was in it. Values sit in the Default field's
          column -- same width, text starting where the field's does. */}
      {points.length === 0 ? (
        <Row>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', flexGrow: 1 }}>
            Calibrated frequencies
          </Typography>
          <Typography sx={{ ...VALUE_COL_SX, color: p.data.warn }}>None</Typography>
        </Row>
      ) : (
        // Every point, in a box that scrolls past four rows with its
        // scrollbar hidden (wheel, trackpad and keyboard still scroll it), so
        // a long calibration never pushes the instruments list down the pane.
        <Box
          sx={{
            maxHeight: POINTS_VISIBLE * 34,
            overflowY: 'auto',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            '& > * + *': { borderTop: `1px solid ${p.appBarBorder}` },
            borderTop: `1px solid ${p.appBarBorder}`,
          }}
        >
          {[...points].sort((x, y) => x.freqMhz - y.freqMhz).map((pt) => (
            <Box key={pt.freqMhz} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 34, px: 1.5 }}>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', flexGrow: 1, fontVariantNumeric: 'tabular-nums' }}>
                {pt.freqMhz} MHz
              </Typography>
              <Typography sx={VALUE_COL_SX}>{pt.db} dB</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Group>
  )
}

function InstrumentsGroup() {
  const p = useAppPalette()
  const { instruments } = useInstrumentsState()
  const { setOpen, openInstrument } = useInstrumentsActions()
  const noInstruments = useInstrumentsUnavailableReason()
  const rig = useMemo(
    () => Object.values(instruments).filter((i) => !i.placeholder),
    [instruments],
  )
  const up = rig.filter((i) => i.status === 'connected').length
  const dot = (st: InstrumentStatus) => (
    st === 'connected' ? p.data.ok
      : st === 'error' ? p.data.bad
        : st === 'connecting' ? p.data.warn
          : p.sidebar.successOff
  )
  if (noInstruments) {
    return (
      <Group title="Instruments">
        <Row><Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{noInstruments}</Typography></Row>
      </Group>
    )
  }
  return (
    <Group
      title={`Instruments · ${up} of ${rig.length}`}
      trailing={(
        // A tinted key rather than bare text, so it reads as one beside the
        // heading. It opens the whole panel; a row opens its own instrument.
        <Button
          size="small"
          variant="text"
          onClick={() => setOpen(true)}
          aria-label="Manage all instruments"
          disableRipple
          sx={{
            minWidth: 0, height: 22, px: 1, mr: -0.5, borderRadius: '11px',
            fontSize: 12, fontWeight: 600, lineHeight: 1,
            bgcolor: alpha(p.sidebar.accent, 0.12), color: p.sidebar.accent,
            transition: 'background-color 120ms ease-out',
            '&:hover': { bgcolor: alpha(p.sidebar.accent, 0.18) },
            '&:active': { bgcolor: alpha(p.sidebar.accent, 0.24), transform: 'scale(0.97)', transition: 'none' },
          }}
        >
          Manage
        </Button>
      )}
    >
      {/* Each row opens the Instruments panel at that instrument -- scrolled
          to, marked, its key focused -- where connecting happens. Manage opens
          the panel as a whole. The inspector only reports: a connect key per
          row here would be a second place to drive the same sessions (see the
          per-instrument bus). */}
      {rig.map((i) => (
        <Row
          key={i.id}
          onClick={() => openInstrument(i.id)}
          label={`${i.label}: ${STATUS_WORD[i.status]}. Open in Instruments.`}
        >
          <Dot color={dot(i.status)} />
          <Typography noWrap sx={{ fontSize: 13, flexGrow: 1, minWidth: 0 }}>{i.label}</Typography>
          <Typography
            noWrap
            title={i.status === 'error' ? i.failure?.title : undefined}
            sx={{ fontSize: 13, flexShrink: 0, color: i.status === 'error' ? p.data.bad : 'text.secondary' }}
          >
            {STATUS_WORD[i.status]}
          </Typography>
          <ChevronRightRoundedIcon className="row-chevron" sx={{ fontSize: 16, color: 'text.disabled', mr: -0.5 }} />
        </Row>
      ))}
    </Group>
  )
}

/**
 * The bench, on every page: the DUT link and its settings, the path loss, and
 * each instrument's state. What the top bar, its lamp and the Instruments
 * count used to say in three places, in one column that does not move.
 */
export function BenchPane() {
  return (
    // Scrolls when the window is short, with no visible bar: a scrollbar
    // appearing along the pane's edge took width from every group in it and
    // shifted their contents. Wheel, trackpad and keyboard still scroll.
    <Box
      sx={{
        overflowY: 'auto', flex: 1, minHeight: 0, px: 2, pt: 0.5, pb: 2,
        scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      <DutGroup />
      <PathLossGroup />
      <InstrumentsGroup />
    </Box>
  )
}

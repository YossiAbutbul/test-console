import { memo, useEffect, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, CircularProgress, IconButton, InputAdornment,
  LinearProgress, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import RefreshIcon from '@mui/icons-material/RefreshRounded'
import WarningAmberIcon from '@mui/icons-material/WarningAmberRounded'
import {
  pickCandidate,
  useInstrumentsModal, useInstrumentsActions, useInstrumentsState,
  type InstrumentId, type InstrumentState,
} from '../context/InstrumentsContext'
import type { DiscoverCandidate } from '../api/instruments'
import { filterCandidates } from '../lib/instrumentCandidates'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { CONTROL_H, KeySpinner, MONO, ModalShell, TEXT } from '../ui'
import { FailureNote } from './FailureNote'

interface CategoryGroup {
  label: string
  ids: InstrumentId[]
}

/** All categories shown on one page (no tabs). */
const GROUPS: CategoryGroup[] = [
  { label: 'RF measurement', ids: ['power-sensor', 'spectrum', 'network-analyzer'] },
  { label: 'DC supply', ids: ['dc-analyzer'] },
  { label: 'Signal source', ids: ['signal-generator'] },
  { label: 'Switching', ids: ['rf-switch'] },
  { label: 'Motion', ids: ['rf-trombone'] },
  { label: 'Attenuation', ids: ['attenuator'] },
]

function fieldPlaceholder(id: InstrumentId, placeholder?: boolean): string {
  if (placeholder) return 'Not wired yet'
  if (id === 'power-sensor') return 'Serial — e.g., MY50000200'
  if (id === 'rf-switch') return 'COM port — the USB-serial one, e.g. COM4'
  if (id === 'rf-trombone') return 'Device index — 0'
  if (id === 'spectrum') return 'LAN — 172.16.10.1:5555'
  return 'VISA — USB0::0x...::INSTR'
}

/** State words, the same ones the Bench inspector uses for the same states. */
const STATUS_WORD: Record<InstrumentState['status'], string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  error: 'Error',
  disconnected: 'Not connected',
}

/** The part of an IDN the row does not already say.
 *
 *  A SCPI `*IDN?` is maker, model, serial, firmware; the row already names
 *  the model, so repeating the whole string under it said it twice. Only the
 *  serial and firmware are news. A non-SCPI string (the serial devices
 *  describe themselves) is shown as it is. */
function idnDetail(idn: string): string | null {
  const parts = idn.split(',').map((x) => x.trim())
  if (parts.length < 3) return idn.trim() || null
  const extra = parts.slice(2).filter((x) => x && x !== '0')
  return extra.length ? extra.join(' · ') : null
}

/** Fixed track for the row's one key, Connect/Disconnect. Re-scan lives in
 *  the address field it fills, and Required/Soon are said in the row's
 *  status line, so the 88 px chip slot that sat empty on most rows is gone.
 *  Fixed, not `auto`, so every row's field ends on the same line. */
const ACTIONS_W = 120

interface RowProps {
  id: InstrumentId
  inst: InstrumentState
  required?: boolean
  discoverKey: string
}

/** Per-row component. Receives its `inst` as a prop so wrapping with
 *  React.memo lets sibling rows re-render without us re-rendering too. */
const InstrumentRow = memo(function InstrumentRow({ id, inst, required, discoverKey }: RowProps) {
  const { setAddress, setChannel, connect, disconnect, discover } = useInstrumentsActions()
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const [candidates, setCandidates] = useState<DiscoverCandidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const lastAutoKey = useRef<string | null>(null)
  const busy = inst.status === 'connecting'
  const connected = inst.status === 'connected'
  const highlight = required && !connected

  const runDiscover = async (opts: { focus?: boolean } = {}) => {
    if (inst.placeholder) return
    setScanning(true)
    try {
      const list = filterCandidates(id, await discover(id))
      setCandidates(list)
      // Helpful default: if user hasn't typed anything and we found a sensible
      // candidate, pre-fill it. Prefers the model-matched device (e.g. N6705B
      // for dc-analyzer, E5061B for network-analyzer) to avoid mis-mapping
      // when multiple VISA instruments are present.
      const pick = pickCandidate(id, list)
      if (pick && !inst.address.trim() && !connected) {
        setAddress(id, pick.resource)
      }
      if (opts.focus) setTimeout(() => inputRef.current?.focus(), 0)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (lastAutoKey.current === discoverKey) return
    lastAutoKey.current = discoverKey
    // Don't fire scans while the modal is closing (key transitions to
    // 'closed' before unmount and would spam the backend with N requests).
    if (!discoverKey.startsWith('open')) return
    if (inst.placeholder || connected || busy) return
    void runDiscover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverKey])

  const showChannel = id === 'dc-analyzer'
  const idn = inst.idn ? idnDetail(inst.idn) : null

  return (
    <Box
      sx={{
        position: 'relative',
        // A row of its group's panel, as in System Settings: each instrument
        // used to be its own bordered card on the grey, nine boxes stacked
        // with gaps, which read as clutter before any of them was read.
        px: 1.5, py: 1,
        // Amber wash like the Required word it carries: needed-but-missing is
        // a warning, and red here means a failed connect (and is Disconnect's).
        bgcolor: highlight ? alpha(p.data.warn, 0.07) : 'transparent',
        transition: 'background-color 0.2s',
      }}
    >
      {/* Main row: 3 logical columns — label / address+ch / actions */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `minmax(200px, 250px) minmax(0, 1fr) ${ACTIONS_W}px` },
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 1,
        }}
      >
        {/* Col 1: status dot + label, then the state in words beside the
            model. The app's 8 px dot, in the Bench pane's colours, so a device
            reads the same here as in the list that opened this -- the 20 px
            check disc was a third indicator nothing else used. The dot is not
            alone: the state is said in words under the name, so grey "off"
            and red "error" never rest on hue. A spinner while connecting. */}
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
          <Box sx={{ width: 10, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            {busy
              ? <CircularProgress size={10} thickness={6} sx={{ color: p.data.warn }} />
              : (
                <Box
                  sx={{
                    width: 8, height: 8, borderRadius: '50%',
                    bgcolor: connected ? p.data.ok
                      : inst.status === 'error' ? p.data.bad
                        : p.sidebar.successOff,
                    transition: 'background-color .2s',
                  }}
                />
              )}
          </Box>
          <Box sx={{ minWidth: 0, height: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inst.label}
            </Typography>
            {/* State in the UI face and sentence case, as everywhere else it
                is said; only the model is an identifier, so only it is mono.
                Serial and firmware join it here once connected, rather than
                on a line of their own that made connected rows taller than
                the rest. The full IDN is the line's tooltip. */}
            <Typography
              sx={{
                fontSize: 12, color: 'text.secondary',
                lineHeight: 1.2,
                minHeight: 14,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              <Box
                component="span"
                sx={{
                  fontWeight: 600,
                  color: inst.status === 'error' ? 'error.main'
                    : inst.status === 'connected' ? 'success.main' : 'text.secondary',
                }}
              >
                {inst.placeholder ? 'Not wired yet' : STATUS_WORD[inst.status]}
              </Box>
              {highlight && (
                <Box component="span" sx={{ fontWeight: 600, color: 'warning.main' }}>
                  {' · Required'}
                </Box>
              )}
              {(inst.model || (connected && idn)) && (
                <Tooltip title={connected && inst.idn ? inst.idn : ''}>
                  <Box component="span" sx={{ fontFamily: MONO }}>
                    {' · '}
                    {[inst.model, connected ? idn : null].filter(Boolean).join(' · ')}
                  </Box>
                </Tooltip>
              )}
            </Typography>
          </Box>
        </Stack>

        {/* Col 2: address + channel — uniform input style */}
        <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Autocomplete
              size="small"
              freeSolo
              disableClearable
              openOnFocus
              options={candidates ?? []}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.resource)}
              isOptionEqualToValue={(o, v) => {
                const a = typeof o === 'string' ? o : o.resource
                const b = typeof v === 'string' ? v : v.resource
                return a === b
              }}
              value={inst.address}
              onChange={(_e, v) => {
                if (v == null) return
                setAddress(id, typeof v === 'string' ? v : v.resource)
              }}
              onInputChange={(_e, v) => setAddress(id, v ?? '')}
              disabled={connected || busy || inst.placeholder}
              renderOption={(props, o) => {
                if (typeof o === 'string') return <li {...props} key={o}>{o}</li>
                return (
                  <li {...props} key={o.resource} style={{ display: 'block', padding: '6px 12px' }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.3 }}>
                      {o.resource}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 12,
                        color: o.idn || o.detail ? 'text.secondary' : 'text.disabled',
                        fontStyle: o.idn || o.detail ? 'normal' : 'italic',
                        lineHeight: 1.2,
                      }}
                    >
                      {o.idn ?? o.detail ?? 'no IDN response'}
                    </Typography>
                  </li>
                )
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  inputRef={inputRef}
                  // A device that connected without an address typed in was
                  // found on its own; the example address there read as if it
                  // were the one in use.
                  placeholder={connected && !inst.address
                    ? 'Auto-detected'
                    : fieldPlaceholder(id, inst.placeholder)}
                  InputProps={{
                    ...params.InputProps,
                    // Re-scan inside the field it fills, at its end, as a
                    // search field's own control. Hidden (not removed) once
                    // connected, so the field keeps its text width.
                    endAdornment: (
                      <>
                        {params.InputProps.endAdornment}
                        {/* Tooltip on a span: a disabled button fires no
                            pointer events, so a `title` on it never showed
                            when it was most wanted. */}
                        <Tooltip title="Re-scan">
                          <span style={{ visibility: connected || inst.placeholder ? 'hidden' : 'visible', display: 'flex' }}>
                            <IconButton
                              size="small"
                              aria-label={`Re-scan for ${inst.label}`}
                              onClick={() => runDiscover({ focus: true })}
                              disabled={connected || busy || inst.placeholder}
                              sx={{ width: 24, height: 24, mr: -0.75 }}
                            >
                              <RefreshIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </>
                    ),
                    sx: { fontFamily: MONO, fontSize: 12.5, height: CONTROL_H.md },
                  }}
                />
              )}
            />
          </Box>
          {showChannel && (
            <TextField
              size="small"
              type="number"
              value={inst.channel ?? 1}
              onChange={(e) => setChannel(id, Number(e.target.value))}
              // aria-label rather than a visible `label`: a floating MUI label
              // notches the outline and lifts this box off the baseline of the
              // unlabelled address field beside it, which is what made the row
              // look crooked. The prefix below says the same thing in place.
              inputProps={{ min: 1, max: 4, 'aria-label': 'DC analyzer channel' }}
              disabled={connected || busy}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start" sx={{ mr: 0.5 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.disabled' }}>
                      Ch
                    </Typography>
                  </InputAdornment>
                ),
              }}
              sx={{
                width: 78,
                flexShrink: 0,
                '& .MuiInputBase-root': { height: CONTROL_H.md, fontSize: 12.5 },
                // Centred: a 1-4 value in a narrow box. (The number spinners,
                // which left almost no room for the digit at this width, are
                // hidden app-wide by the theme now.)
                '& input': { textAlign: 'center' },
              }}
            />
          )}
        </Stack>

        {/* Col 3: the key */}
        <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
          {/* Outlined: the footer's Connect all is the one filled key here.
              The label holds while connecting -- the spinner says it -- so
              the word does not jump inside the key. */}
          <Button
            size="small"
            variant="outlined"
            color={connected ? 'inherit' : 'primary'}
            onClick={() => (connected ? disconnect(id) : connect(id))}
            disabled={inst.placeholder || (!connected && !inst.address.trim()) || busy}
            startIcon={busy ? <KeySpinner /> : undefined}
            // Fixed: Connect and Disconnect share one box.
            sx={{ width: 120, minWidth: 120, height: 32, fontSize: 12.5, whiteSpace: 'nowrap' }}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </Button>
        </Stack>
      </Box>

      {/* Footer line: the explained failure, only when there is one -- a
          reserved empty line under every row made the list half blank space.
          Indented 20 px, the dot's slot (10) plus its gap (10), so it starts under
          the label. */}
      {inst.failure ? (
        <Box sx={{ mt: 0.75, pl: '20px' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'error.main' }}>
            {inst.failure.title}
          </Typography>
          <FailureNote failure={inst.failure} />
        </Box>
      ) : null}

      {/* Subtle scanning indicator — thin bar at the bottom edge of the row */}
      {scanning && (
        <LinearProgress
          sx={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            height: 2,
            '& .MuiLinearProgress-bar': { transition: 'transform 0.2s linear' },
          }}
        />
      )}
    </Box>
  )
})

type AllMode = 'connect' | 'disconnect'

/** One white panel per group with hairlines between its rows, on the
 *  dialog's grey ground -- the inset grouped list of System Settings. */
const GROUP_SX = {
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  borderRadius: '10px',
  overflow: 'hidden',
  '& > * + *': { borderTop: 1, borderColor: 'divider' },
} as const

export function InstrumentsModal() {
  const { open, setOpen, required } = useInstrumentsModal()
  const { instruments } = useInstrumentsState()
  const { connect, disconnect } = useInstrumentsActions()
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const missing = required.filter((id) => instruments[id].status !== 'connected')
  const discoverKey = open ? `open-${open}` : 'closed'

  // Eligible = live, has an address, not already connected.
  const eligible = (Object.values(instruments) as InstrumentState[]).filter(
    (i) => !i.placeholder && i.status !== 'connected' && i.address.trim().length > 0,
  )
  const connectedList = (Object.values(instruments) as InstrumentState[]).filter(
    (i) => i.status === 'connected',
  )
  const [connectingAll, setConnectingAll] = useState(false)
  const [disconnectingAll, setDisconnectingAll] = useState(false)
  const busyAll = connectingAll || disconnectingAll
  const connectAll = async () => {
    setConnectingAll(true)
    try {
      // Sequential to avoid VISA / driver races between concurrent opens.
      for (const i of eligible) {
        await connect(i.id)
      }
    } finally {
      setConnectingAll(false)
    }
  }
  const disconnectAll = async () => {
    setDisconnectingAll(true)
    try {
      for (const i of connectedList) {
        await disconnect(i.id)
      }
    } finally {
      setDisconnectingAll(false)
    }
  }

  // One button toggles by mode: if anything is connected we offer
  // disconnect-all; otherwise we offer connect-all.
  const idleMode: AllMode = connectedList.length > 0 ? 'disconnect' : 'connect'
  const idleKey = {
    mode: idleMode,
    count: idleMode === 'disconnect' ? connectedList.length : eligible.length,
  }
  // Held from the click while the sequence runs, so the key neither flips to
  // "Disconnect all" after the first connect nor counts down under the
  // spinner. The label stays as pressed; the spinner says it is working.
  const [pressedKey, setPressedKey] = useState<typeof idleKey | null>(null)
  const allKey = busyAll && pressedKey ? pressedKey : idleKey

  // Pull placeholder devices out of their original groups into a single
  // bottom "Coming soon" section so the live ones are grouped tightly.
  const liveGroups = GROUPS.map((g) => ({
    label: g.label,
    ids: g.ids.filter((id) => !instruments[id]?.placeholder),
  })).filter((g) => g.ids.length > 0)
  const soonIds = GROUPS.flatMap((g) => g.ids).filter(
    (id) => instruments[id]?.placeholder,
  )

  return (
    <ModalShell
      open={open}
      onClose={() => setOpen(false)}
      title="Instruments"
      maxWidth="md"
      dividers
      // Height follows the content; the cap only matters on a short screen,
      // where DialogContent scrolls.
      paperSx={{ maxHeight: '88vh' }}
      // The footer rule stays over scrolling content; the bottom padding is
      // so the last row clears it at the end of the scroll instead of ending
      // mid-glyph against it.
      contentSx={{ py: 0, pb: 1, overflowY: 'auto', bgcolor: 'action.hover' }}
      footer={{
        primary: (
          <Button
            variant={allKey.mode === 'disconnect' ? 'outlined' : 'contained'}
            color={allKey.mode === 'disconnect' ? 'inherit' : 'primary'}
            onClick={() => {
              setPressedKey(idleKey)
              void (idleKey.mode === 'disconnect' ? disconnectAll() : connectAll())
            }}
            disabled={allKey.count === 0 || busyAll}
            startIcon={busyAll ? <KeySpinner /> : undefined}
            sx={{ width: 188, minWidth: 188, height: CONTROL_H.md, fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {allKey.mode === 'disconnect'
              ? `Disconnect all (${allKey.count})`
              : `Connect all (${allKey.count})`}
          </Button>
        ),
      }}
    >
      {/* Reserved whenever the opening test names instruments: the warning
          mounting and unmounting moved every row under it on each connect.
          It turns into a quiet confirmation instead of going away. */}
      {required.length > 0 && (
        <Box sx={{ mt: 2, minHeight: 48, display: 'flex', alignItems: 'stretch' }}>
          {missing.length > 0 ? (
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ flexGrow: 1 }}>
              This test requires {missing.map((id) => instruments[id].label).join(' and ')} to be connected.
            </Alert>
          ) : (
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 2 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.data.ok }} />
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                All required instruments connected
              </Typography>
            </Stack>
          )}
        </Box>
      )}
      <Stack spacing={2} sx={{ py: 1.5 }}>
        {liveGroups.map((g) => (
          <Box key={g.label}>
            <Typography
              sx={{
                fontSize: 12, fontWeight: 600,
                color: 'text.secondary',
                mb: 1,
              }}
            >
              {g.label}
            </Typography>
            <Box sx={GROUP_SX}>
              {g.ids.map((id) => (
                <InstrumentRow
                  key={id}
                  id={id}
                  inst={instruments[id]}
                  required={required.includes(id)}
                  discoverKey={discoverKey}
                />
              ))}
            </Box>
          </Box>
        ))}
        {soonIds.length > 0 && (
          <Box>
            <Typography
              sx={{
                fontSize: 12, fontWeight: 600,
                color: 'text.secondary',
                mb: 1,
              }}
            >
              Coming soon
            </Typography>
            {/* No dimming wrapper: the disabled fields and the status line
                already say it, and a faded row failed contrast. */}
            <Box sx={GROUP_SX}>
              {soonIds.map((id) => (
                <InstrumentRow
                  key={id}
                  id={id}
                  inst={instruments[id]}
                  required={required.includes(id)}
                  discoverKey={discoverKey}
                />
              ))}
            </Box>
          </Box>
        )}
      </Stack>
    </ModalShell>
  )
}

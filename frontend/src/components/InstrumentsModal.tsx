import { memo, useEffect, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, LinearProgress, Stack, TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import {
  pickCandidate,
  useInstrumentsModal, useInstrumentsActions, useInstrumentsState,
  type InstrumentId, type InstrumentState,
} from '../context/InstrumentsContext'
import type { DiscoverCandidate } from '../api/instruments'
import { filterCandidates } from '../lib/instrumentCandidates'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { CheckMark, MONO } from '../ui'
import { FailureNote } from './FailureNote'

interface CategoryGroup {
  label: string
  ids: InstrumentId[]
}

/** All categories shown on one page (no tabs). */
const GROUPS: CategoryGroup[] = [
  { label: 'RF Measurement', ids: ['power-sensor', 'spectrum', 'network-analyzer'] },
  { label: 'DC Supply', ids: ['dc-analyzer'] },
  { label: 'Signal Source', ids: ['signal-generator'] },
  { label: 'Switching', ids: ['rf-switch'] },
  { label: 'Motion', ids: ['rf-trombone'] },
  { label: 'Attenuation', ids: ['attenuator'] },
]

function fieldPlaceholder(id: InstrumentId, placeholder?: boolean): string {
  if (placeholder) return 'not wired yet'
  if (id === 'power-sensor') return 'Serial — e.g., MY50000200'
  if (id === 'rf-switch') return 'COM port — the USB-serial one, e.g. COM4'
  if (id === 'rf-trombone') return 'Device index — 0'
  if (id === 'spectrum') return 'LAN — 172.16.10.1:5555'
  return 'VISA — USB0::0x...::INSTR'
}

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

  return (
    <Box
      sx={{
        position: 'relative',
        px: 1.5, py: 0.75,
        borderRadius: 1.25,
        border: 1,
        borderColor: highlight ? p.actions.disconnect.bg : 'divider',
        bgcolor: highlight ? `${p.actions.disconnect.bg}0A` : 'background.paper',
        transition: 'border-color 0.2s, background-color 0.2s',
      }}
    >
      {/* Main row: 3 logical columns — label / address+ch / actions */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(180px, 220px) minmax(0, 1fr) auto' },
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 1,
        }}
      >
        {/* Col 1: status mark + label, then the state in words beside the
            model. A 9 px dot was the only sign of state on each row, and grey
            "off" and red "error" differ by hue alone. */}
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
          <CheckMark
            size={20}
            state={
              inst.status === 'connected' ? 'ok'
                : inst.status === 'error' ? 'error'
                  : inst.status === 'connecting' ? 'busy' : 'todo'
            }
          />
          <Box sx={{ minWidth: 0, height: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inst.label}
            </Typography>
            <Typography
              sx={{
                fontSize: 12, color: 'text.secondary',
                fontFamily: MONO, lineHeight: 1.2,
                minHeight: 14,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              <Box
                component="span"
                sx={{
                  fontFamily: 'inherit', fontWeight: 600,
                  color: inst.status === 'error' ? 'error.main'
                    : inst.status === 'connected' ? 'success.main' : 'text.secondary',
                }}
              >
                {inst.placeholder
                  ? 'not wired yet'
                  : { connected: 'connected', connecting: 'connecting…', error: 'error', disconnected: 'off' }[inst.status]}
              </Box>
              {inst.model ? ` · ${inst.model}` : ''}
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
                  placeholder={fieldPlaceholder(id, inst.placeholder)}
                  InputProps={{
                    ...params.InputProps,
                    sx: { fontFamily: MONO, fontSize: 12.5, height: 34 },
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
                '& .MuiInputBase-root': { height: 34, fontSize: 12.5 },
                // The spinners leave almost nothing for the digit at this
                // width, and a 1-4 value is quicker to type than to step.
                '& input': {
                  textAlign: 'center',
                  '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0,
                  },
                  MozAppearance: 'textfield',
                },
              }}
            />
          )}
        </Stack>

        {/* Col 3: actions */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexShrink: 0 }}>
          <IconButton
            size="small"
            onClick={() => runDiscover({ focus: true })}
            disabled={connected || busy || inst.placeholder}
            title="Re-scan"
            sx={{ width: 30, height: 30 }}
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Button
            size="small"
            variant={connected ? 'outlined' : 'contained'}
            color={connected ? 'inherit' : 'primary'}
            onClick={() => (connected ? disconnect(id) : connect(id))}
            disabled={inst.placeholder || (!connected && !inst.address.trim()) || busy}
            // Fixed: Connect, Connecting… and Disconnect share one box.
            sx={{ width: 120, minWidth: 120, height: 32, fontSize: 12.5, whiteSpace: 'nowrap' }}
          >
            {busy ? 'Connecting…' : connected ? 'Disconnect' : 'Connect'}
          </Button>
          {inst.placeholder && (
            <Chip size="small" label="Soon" sx={{ height: 20, fontSize: 12, fontWeight: 600, fontStyle: 'italic' }} />
          )}
          {required && !connected && (
            <Chip
              size="small"
              icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
              label="Required"
              variant="outlined"
              // Amber, not the Disconnect red: missing-but-needed is a
              // warning, and red in this panel already means a failed connect.
              sx={{ height: 20, fontSize: 12, fontWeight: 600, color: 'warning.main', borderColor: 'warning.main', '& .MuiChip-icon': { color: 'warning.main' } }}
            />
          )}
        </Stack>
      </Box>

      {/* Footer line: IDN, or the explained failure. Only drawn when there is
          one -- a reserved empty line under every row made the list half
          blank space. The row grows once on connect, which reads as the
          result arriving rather than as a jump. */}
      {inst.failure ? (
        <Box sx={{ mt: 0.75, pl: 2.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'error.main' }}>
            {inst.failure.title}
          </Typography>
          <FailureNote failure={inst.failure} />
        </Box>
      ) : connected && inst.idn ? (
        <Typography
          sx={{
            mt: 0.5, pl: 2.5,
            fontSize: 12,
            fontFamily: MONO,
            color: 'text.secondary',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {inst.idn}
        </Typography>
      ) : null}

      {/* Subtle scanning indicator — thin bar at the bottom edge of the row */}
      {scanning && (
        <LinearProgress
          sx={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            height: 2,
            borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
            '& .MuiLinearProgress-bar': { transition: 'transform 0.2s linear' },
          }}
        />
      )}
    </Box>
  )
})

export function InstrumentsModal() {
  const { open, setOpen, required } = useInstrumentsModal()
  const { instruments } = useInstrumentsState()
  const { connect, disconnect } = useInstrumentsActions()
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

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="md"
      fullWidth
      transitionDuration={{ enter: 200, exit: 0 }}
      // Height follows the content; the cap only matters on a short screen,
      // where DialogContent scrolls.
      slotProps={{ paper: { sx: { borderRadius: 2, maxHeight: '88vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, pb: 1 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Instruments</Typography>
        <IconButton size="small" onClick={() => setOpen(false)}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ py: 0, overflowY: 'auto', bgcolor: 'action.hover' }}>
        {missing.length > 0 && (
          <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 2 }}>
            This test requires {missing.map((id) => instruments[id].label).join(' and ')} to be connected.
          </Alert>
        )}
        {(() => {
          // Pull placeholder devices out of their original groups into a single
          // bottom "Coming Soon" section so the live ones are grouped tightly.
          const liveGroups = GROUPS.map((g) => ({
            label: g.label,
            ids: g.ids.filter((id) => !instruments[id]?.placeholder),
          })).filter((g) => g.ids.length > 0)
          const soonIds = GROUPS.flatMap((g) => g.ids).filter(
            (id) => instruments[id]?.placeholder,
          )
          return (
            <Stack spacing={2} sx={{ py: 1.5 }}>
              {liveGroups.map((g) => (
                <Box key={g.label}>
                  <Typography
                    sx={{
                      fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
                      textTransform: 'uppercase', color: 'text.secondary',
                      mb: 1,
                    }}
                  >
                    {g.label}
                  </Typography>
                  <Stack spacing={0.75}>
                    {g.ids.map((id) => (
                      <InstrumentRow
                        key={id}
                        id={id}
                        inst={instruments[id]}
                        required={required.includes(id)}
                        discoverKey={discoverKey}
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
              {soonIds.length > 0 && (
                <Box>
                  <Typography
                    sx={{
                      fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
                      textTransform: 'uppercase', color: 'text.disabled',
                      mb: 1,
                    }}
                  >
                    Coming Soon
                  </Typography>
                  <Stack spacing={0.75} sx={{ opacity: 0.7 }}>
                    {soonIds.map((id) => (
                      <InstrumentRow
                        key={id}
                        id={id}
                        inst={instruments[id]}
                        required={required.includes(id)}
                        discoverKey={discoverKey}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )
        })()}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        {(() => {
          // One button toggles by mode: if anything is connected we offer
          // disconnect-all; otherwise we offer connect-all.
          const mode: 'disconnect' | 'connect' =
            connectedList.length > 0 ? 'disconnect' : 'connect'
          const count = mode === 'disconnect' ? connectedList.length : eligible.length
          const onClick = mode === 'disconnect' ? disconnectAll : connectAll
          const busy = mode === 'disconnect' ? disconnectingAll : connectingAll
          const label = busy
            ? mode === 'disconnect' ? 'Disconnecting…' : 'Connecting…'
            : mode === 'disconnect' ? `Disconnect all (${count})` : `Connect all (${count})`
          return (
            <Button
              variant={mode === 'disconnect' ? 'outlined' : 'contained'}
              color={mode === 'disconnect' ? 'inherit' : 'primary'}
              onClick={onClick}
              disabled={count === 0 || busyAll}
              sx={{ width: 188, minWidth: 188, height: 34, fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {label}
            </Button>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}

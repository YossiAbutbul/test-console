import { memo, useEffect, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, LinearProgress, Stack, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import {
  useInstrumentsModal, useInstrumentsActions, useInstrumentsState,
  type InstrumentId, type InstrumentState,
} from '../context/InstrumentsContext'
import type { DiscoverCandidate } from '../api/instruments'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { MONO } from '../ui'
import { FailureNote } from './FailureNote'

interface CategoryGroup {
  label: string
  ids: InstrumentId[]
}

/** All categories shown on one page (no tabs). */
const GROUPS: CategoryGroup[] = [
  { label: 'RF Measurement', ids: ['power-sensor', 'spectrum', 'network-analyzer'] },
  { label: 'DC Supply', ids: ['dc-analyzer'] },
  { label: 'Switching', ids: ['rf-switch'] },
  { label: 'Motion', ids: ['rf-trombone'] },
  { label: 'Attenuation', ids: ['attenuator'] },
]

function statusColor(s: InstrumentState['status'], p: ReturnType<typeof getAppPalette>) {
  switch (s) {
    case 'connected': return p.sidebar.success
    case 'connecting': return p.sidebar.textDim
    case 'error': return '#EF4444'
    default: return p.sidebar.successOff
  }
}

function fieldPlaceholder(id: InstrumentId, placeholder?: boolean): string {
  if (placeholder) return 'not wired yet'
  if (id === 'power-sensor') return 'Serial — e.g., MY50000200'
  if (id === 'rf-switch') return 'COM port — e.g., COM3'
  if (id === 'rf-trombone') return 'Device index — 0'
  return 'VISA — USB0::0x...::INSTR'
}

/** Substring to look for in the discovered IDN to pre-select the right
 *  resource. Without this, discovery would just pick the first candidate
 *  which can be the wrong instrument when several VISA devices are present. */
const EXPECTED_MODEL: Partial<Record<InstrumentId, string>> = {
  'dc-analyzer': 'N6705',
  'network-analyzer': 'E5061',
  spectrum: 'FSW',
}

/** Drop candidates that clearly belong to a *different* known instrument.
 *  Keeps the model-matched device plus any with no IDN (still unidentified),
 *  so the network-analyzer picker won't list the DC analyzer (N6705) etc. */
function filterCandidates(id: InstrumentId, list: DiscoverCandidate[]): DiscoverCandidate[] {
  const want = EXPECTED_MODEL[id]?.toLowerCase()
  if (!want) return list
  const others = Object.entries(EXPECTED_MODEL)
    .filter(([k]) => k !== id)
    .map(([, v]) => v.toLowerCase())
  return list.filter((c) => {
    const idn = c.idn?.toLowerCase()
    if (!idn) return true // unidentified — keep selectable
    if (idn.includes(want)) return true
    return !others.some((o) => idn.includes(o)) // exclude known-other models
  })
}

function pickDefault(id: InstrumentId, list: DiscoverCandidate[]): DiscoverCandidate | null {
  if (list.length === 0) return null
  const want = EXPECTED_MODEL[id]
  if (want) {
    const m = list.find((c) => c.idn?.toLowerCase().includes(want.toLowerCase()))
    if (m) return m
  }
  return list[0]
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
  const sColor = statusColor(inst.status, p)
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
      const pick = pickDefault(id, list)
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
        px: 2, py: 1.25,
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
        {/* Col 1: status dot + label/model */}
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 9, height: 9, borderRadius: '50%',
              bgcolor: sColor,
              boxShadow: connected ? `0 0 0 3px ${sColor}26` : 'none',
              flexShrink: 0,
            }}
          />
          <Box sx={{ minWidth: 0, height: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inst.label}
            </Typography>
            <Typography
              sx={{
                fontSize: 10.5, color: 'text.secondary',
                fontFamily: 'ui-monospace, monospace', lineHeight: 1.2,
                minHeight: 14,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {inst.model ?? ' '}
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
                    <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.3 }}>
                      {o.resource}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: o.idn ? 'text.secondary' : 'text.disabled',
                        fontStyle: o.idn ? 'normal' : 'italic',
                        lineHeight: 1.2,
                      }}
                    >
                      {o.idn ?? 'no IDN response'}
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
                    sx: { fontFamily: 'ui-monospace, monospace', fontSize: 12.5, height: 34 },
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
              inputProps={{ min: 1, max: 4 }}
              disabled={connected || busy}
              label="Ch"
              InputLabelProps={{ sx: { fontSize: 11 } }}
              sx={{ width: 60, flexShrink: 0, '& .MuiInputBase-root': { height: 34, fontSize: 12.5 } }}
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
            sx={{ minWidth: 116, height: 32, fontSize: 12.5 }}
          >
            {busy ? 'Connecting…' : connected ? 'Disconnect' : 'Connect'}
          </Button>
          {inst.placeholder && (
            <Chip size="small" label="Soon" sx={{ height: 20, fontSize: 10.5, fontWeight: 600, fontStyle: 'italic' }} />
          )}
          {required && !connected && (
            <Chip
              size="small"
              icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
              label="Required"
              sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: `${p.actions.disconnect.bg}1F`, color: p.actions.disconnect.bg }}
            />
          )}
        </Stack>
      </Box>

      {/* Footer line: IDN, or the explained failure. Height is reserved either
          way so the row doesn't jump when a connect resolves. */}
      {inst.failure ? (
        <Box sx={{ mt: 0.75, pl: 2.5 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: 'error.main' }}>
            {inst.failure.title}
          </Typography>
          <FailureNote failure={inst.failure} />
        </Box>
      ) : (
        <Typography
          sx={{
            mt: 0.75, pl: 2.5,
            minHeight: 14,
            fontSize: 10.5,
            fontFamily: MONO,
            color: 'text.secondary',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {connected ? inst.idn ?? ' ' : ' '}
        </Typography>
      )}

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
      slotProps={{ paper: { sx: { borderRadius: 2, height: 560, maxHeight: '88vh' } } }}
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
            <Stack spacing={2.5} sx={{ py: 2 }}>
              {liveGroups.map((g) => (
                <Box key={g.label}>
                  <Typography
                    sx={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
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
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
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
              sx={{ minWidth: 180, height: 34, fontSize: 13 }}
            >
              {label}
            </Button>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}

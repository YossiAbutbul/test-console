import { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton,
  MenuItem, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useInstruments, type InstrumentId, type InstrumentState } from '../context/InstrumentsContext'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'

function statusColor(s: InstrumentState['status'], p: ReturnType<typeof getAppPalette>) {
  switch (s) {
    case 'connected': return p.sidebar.success
    case 'connecting': return p.sidebar.textDim
    case 'error': return '#EF4444'
    default: return p.sidebar.successOff
  }
}

function statusLabel(s: InstrumentState['status']) {
  return { disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', error: 'Error' }[s]
}

function InstrumentRow({ id, required }: { id: InstrumentId; required?: boolean }) {
  const { instruments, setAddress, setChannel, connect, disconnect, discover } = useInstruments()
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const inst = instruments[id]
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const busy = inst.status === 'connecting'
  const connected = inst.status === 'connected'

  const onDiscover = async () => {
    setDiscovering(true)
    try {
      const list = await discover(id)
      setCandidates(list)
    } finally {
      setDiscovering(false)
    }
  }

  const onPick = (v: string) => {
    setAddress(id, v)
    setCandidates(null)
  }

  const sColor = statusColor(inst.status, p)
  const highlight = required && !connected
  return (
    <Box
      sx={{
        py: 2,
        px: 2,
        mx: -2,
        borderLeft: highlight ? `3px solid ${p.actions.disconnect.bg}` : '3px solid transparent',
        bgcolor: highlight ? `${p.actions.disconnect.bg}0F` : 'transparent',
        transition: 'background-color 0.2s',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.25 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{inst.label}</Typography>
          {inst.model && (
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
              {inst.model}
            </Typography>
          )}
        </Box>
        {inst.placeholder && (
          <Chip
            size="small"
            label="Coming soon"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, fontStyle: 'italic' }}
          />
        )}
        {required && !connected && (
          <Chip
            size="small"
            icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
            label="Required"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: `${p.actions.disconnect.bg}1F`, color: p.actions.disconnect.bg }}
          />
        )}
        <Chip
          size="small"
          label={statusLabel(inst.status)}
          icon={
            inst.status === 'connecting'
              ? <CircularProgress size={10} sx={{ color: `${sColor} !important` }} />
              : <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: sColor, ml: 0.5 }} />
          }
          sx={{
            height: 22,
            fontSize: 11.5,
            fontWeight: 600,
            color: sColor,
            bgcolor: `${sColor}1A`,
            border: `1px solid ${sColor}33`,
            '& .MuiChip-icon': { ml: 0.75, mr: -0.25 },
          }}
        />
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="flex-end">
        <Box sx={{ flexGrow: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>
            {id === 'power-sensor' ? 'Serial' : 'VISA resource'}
          </Typography>
          {candidates ? (
            <Select
              size="small"
              fullWidth
              autoFocus
              open
              value=""
              onChange={(e) => onPick(String(e.target.value))}
              onClose={() => setCandidates(null)}
              displayEmpty
            >
              {candidates.length === 0 && (
                <MenuItem disabled value="">No devices found</MenuItem>
              )}
              {candidates.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          ) : (
            <TextField
              size="small"
              fullWidth
              value={inst.address}
              onChange={(e) => setAddress(id, e.target.value)}
              disabled={connected || busy || inst.placeholder}
              placeholder={
                inst.placeholder
                  ? 'not wired yet'
                  : id === 'power-sensor'
                    ? 'e.g., MY50000200'
                    : 'USB0::0x...::INSTR'
              }
              InputProps={{ sx: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } }}
            />
          )}
        </Box>

        {id === 'dc-analyzer' && (
          <Box sx={{ width: 100 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>Channel</Typography>
            <TextField
              size="small"
              fullWidth
              type="number"
              value={inst.channel ?? 1}
              onChange={(e) => setChannel(id, Number(e.target.value))}
              inputProps={{ min: 1, max: 4 }}
              disabled={connected || busy}
            />
          </Box>
        )}

        <Button
          variant="outlined"
          onClick={onDiscover}
          disabled={discovering || connected || busy || inst.placeholder}
          startIcon={discovering ? <CircularProgress size={14} color="inherit" /> : <SearchIcon sx={{ fontSize: 16 }} />}
          sx={{ height: 36, minWidth: 110 }}
        >
          Discover
        </Button>

        <Button
          variant="contained"
          onClick={() => (connected ? disconnect(id) : connect(id))}
          disabled={inst.placeholder || (!connected && !inst.address.trim()) || busy}
          endIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ height: 36, minWidth: 120 }}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </Button>
      </Stack>

      <Box sx={{ mt: 1, minHeight: 18 }}>
        {inst.error ? (
          <Typography sx={{ fontSize: 12, color: 'error.main' }}>{inst.error}</Typography>
        ) : (
          <Typography
            sx={{
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              color: 'text.secondary',
              visibility: inst.idn && connected ? 'visible' : 'hidden',
            }}
          >
            {inst.idn ?? 'placeholder'}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

type TabKey = 'general' | 'load-pull'

const TAB_INSTRUMENTS: Record<TabKey, InstrumentId[]> = {
  general: ['power-sensor', 'dc-analyzer', 'spectrum'],
  'load-pull': ['spectrum', 'network-analyzer', 'rf-switch', 'rf-trombone', 'dc-analyzer', 'attenuator'],
}

export function InstrumentsModal() {
  const { open, setOpen, required, instruments } = useInstruments()
  const [tab, setTab] = useState<TabKey>('general')
  const missing = required.filter((id) => instruments[id].status !== 'connected')
  const ids = TAB_INSTRUMENTS[tab]
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2, height: 620, maxHeight: '90vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, pb: 0 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Instruments</Typography>
        <IconButton size="small" onClick={() => setOpen(false)}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, py: 0.5, fontSize: 13, textTransform: 'none', fontWeight: 600 } }}
        >
          <Tab value="general" label="General" />
          <Tab value="load-pull" label="Load Pull" />
        </Tabs>
      </Box>
      <DialogContent dividers sx={{ py: 0, overflowY: 'auto' }}>
        {missing.length > 0 && (
          <Alert
            severity="warning"
            icon={<WarningAmberIcon />}
            sx={{ mt: 2, mb: 1 }}
          >
            This test requires {missing.map((id) => instruments[id].label).join(' and ')} to be connected.
          </Alert>
        )}
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
          {ids.map((id) => (
            <InstrumentRow key={`${tab}-${id}`} id={id} required={required.includes(id)} />
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

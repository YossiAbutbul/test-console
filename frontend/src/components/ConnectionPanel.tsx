import { useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, CircularProgress, FormControl, IconButton, MenuItem, Select, Stack,
  TextField, Tooltip, Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useNicknames } from '../context/NicknamesContext'
import { usePathLoss } from '../context/PathLossContext'
import { MeterInfoModal } from './MeterInfoModal'
import { NicknameModal } from './NicknameModal'
import { PathLossModal } from './PathLossModal'
import { useConnection } from '../context/ConnectionContext'
import { useDutLink } from '../context/dutLink'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { MONO } from '../ui'

function actionSx(
  c: { bg: string; bgHover: string; fg: string },
  disabled: { bg: string; fg: string },
) {
  return {
    bgcolor: c.bg,
    color: c.fg,
    border: `1px solid ${c.bg}`,
    '&:hover': { bgcolor: c.bgHover, borderColor: c.bgHover },
    // The theme's disabled look, not the button's own colour at half opacity:
    // a 50 % green Connect read as a pale but working key.
    '&.Mui-disabled': {
      bgcolor: disabled.bg,
      color: disabled.fg,
      borderColor: disabled.bg,
      pointerEvents: 'none',
    },
  } as const
}


const NAME_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CATM2', label: 'CAT-M 2' },
  { value: 'Sonata2IL', label: 'Sonata 2 IL' },
  { value: 'int2g', label: 'Interpreter G2' },
]

/** A MAC with its `:`/`-` separators and spaces removed, for matching. */
function stripMac(v: string): string {
  return v.replace(/[\s:-]/g, '')
}

/**
 * The DUT link controls: scan duration, device type, the MAC picker, meter
 * info, Scan and Connect.
 *
 * Shown in each test page's DUT step and in the top bar's DUT popover. Every
 * copy drives the same scan through `useDutLink`, so they never disagree.
 */
export function DutControls() {
  const { selectedAddr, setSelectedAddr } = useConnection()
  const {
    duration, setDuration, nameFilter, setNameFilter, filteredDevices, scanning,
    toggleScan, isConnected, busy, isKnownDevice, canConnect, toggleConnect,
  } = useDutLink()
  const { mode } = useThemeMode()
  const pal = getAppPalette(mode)
  const a = pal.actions
  const off = { bg: pal.appBarBorder, fg: pal.textDisabled }
  const nicknames = useNicknames()
  const [infoOpen, setInfoOpen] = useState(false)
  const [editMac, setEditMac] = useState<string | null>(null)
  // Per instance: each copy of the controls opens its own device list, so the
  // list drops from the field the operator is actually looking at.
  const [acOpen, setAcOpen] = useState(false)
  const acInputRef = useRef<HTMLInputElement>(null)

  const startScan = () => {
    if (!scanning) {
      setAcOpen(true)
      acInputRef.current?.focus()
    }
    toggleScan()
  }
  const toggle = toggleConnect

  const [copied, setCopied] = useState(false)
  const onCopyMac = async () => {
    if (!selectedAddr) return
    try {
      await navigator.clipboard.writeText(selectedAddr.replace(/:/g, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  const fieldLabel = (text: string) => (
    <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>{text}</Typography>
  )

  return (
    <Box sx={{ width: '100%' }}>
      {/* Flex with an explicit `gap` rather than a `Stack` with `spacing`:
          spacing lays out as margins on the children, which a wrapped row does
          not get on its second line -- at half-screen width the buttons ended
          up flush against the fields above them. The basis/grow pairs below
          decide the order things give way in: the numbers hold their size, the
          device picker gives a little, and the MAC field -- the only one whose
          content is long -- absorbs the rest. */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 1.5,
        }}
      >
        <Box sx={{ flex: '0 1 110px', minWidth: 96 }}>
          {fieldLabel('Duration (sec)')}
          <TextField
            type="number"
            size="small"
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            inputProps={{ min: 1, max: 30 }}
            fullWidth
            disabled={isConnected || scanning}
          />
        </Box>

        <Box sx={{ flex: '1 1 150px', minWidth: 130, maxWidth: 220 }}>
          {fieldLabel('Device type')}
          <FormControl size="small" fullWidth disabled={isConnected || scanning}>
            <Select
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              displayEmpty
              renderValue={(v) =>
                NAME_FILTERS.find((o) => o.value === v)?.label ?? 'All'
              }
            >
              {NAME_FILTERS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ flex: '6 1 220px', minWidth: 190, position: 'relative' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 0.5, gap: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500 }}>MAC Address</Typography>
            {(() => {
              const nick = selectedAddr ? nicknames.get(selectedAddr) : undefined
              if (!nick || !selectedAddr) return null
              const color = nicknames.colorFor(selectedAddr)
              return (
                <Box
                  component="span"
                  sx={{
                    px: 0.85, py: 0.1, borderRadius: 0.75,
                    fontSize: 12, fontWeight: 600, lineHeight: 1.4,
                    bgcolor: color.bg, color: color.fg,
                  }}
                >
                  {nick}
                </Box>
              )
            })()}
            <Box sx={{ flexGrow: 1 }} />
            {selectedAddr && !isConnected && (
              <Typography
                component="button"
                type="button"
                onClick={() => setSelectedAddr(null)}
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  p: 0,
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
              >
                Clear
              </Typography>
            )}
          </Stack>
          <Autocomplete
          size="small"
          freeSolo
          disableClearable
          disabled={isConnected}
          open={acOpen && filteredDevices.length > 0}
          onOpen={() => setAcOpen(true)}
          onClose={() => setAcOpen(false)}
          options={filteredDevices}
          getOptionLabel={(opt) =>
            typeof opt === 'string' ? opt : opt.address
          }
          value={selectedAddr ?? ''}
          onChange={(_, v) => {
            if (!v) setSelectedAddr(null)
            else if (typeof v === 'string') setSelectedAddr(v)
            else setSelectedAddr(v.address)
          }}
          onInputChange={(_, v, reason) => {
            if (reason === 'input') setSelectedAddr(v || null)
          }}
          filterOptions={(opts, state) => {
            const q = state.inputValue.toLowerCase()
            // The address is matched with its separators taken out on both
            // sides, so "7054" finds 70:54:... -- nobody types the colons
            // when reading a MAC off a label.
            const qHex = stripMac(q)
            const filtered = !q ? opts : opts.filter(
              (o) =>
                o.address.toLowerCase().includes(q) ||
                (qHex !== '' && stripMac(o.address.toLowerCase()).includes(qHex)) ||
                (o.name ?? '').toLowerCase().includes(q) ||
                (nicknames.get(o.address) ?? '').toLowerCase().includes(q),
            )
            // Tagged devices first, then by RSSI strength (already sorted in scan)
            return [...filtered].sort((a, b) => {
              const ta = nicknames.get(a.address) ? 1 : 0
              const tb = nicknames.get(b.address) ? 1 : 0
              return tb - ta
            })
          }}
          renderOption={(props, opt) => {
            const nick = nicknames.get(opt.address)
            const color = nicknames.colorFor(opt.address)
            return (
              <Box component="li" {...props} key={opt.address} sx={{ py: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Box sx={{ fontWeight: 500, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {opt.name ?? '(unnamed)'}
                      </Box>
                      {nick && (
                        <Box
                          component="span"
                          sx={{
                            px: 0.85, py: 0.15, borderRadius: 0.75,
                            fontSize: 12, fontWeight: 600, lineHeight: 1.4,
                            bgcolor: color.bg, color: color.fg,
                            flexShrink: 0,
                          }}
                        >
                          {nick}
                        </Box>
                      )}
                    </Box>
                    <Box sx={{ fontFamily: MONO, fontSize: 12.5, color: 'text.secondary' }}>
                      {opt.address}
                    </Box>
                  </Box>
                  <Box sx={{ fontFamily: MONO, fontSize: 12.5, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {opt.rssi ?? '—'} dBm
                  </Box>
                </Box>
              </Box>
            )
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Pick from scan or type MAC"
              inputRef={acInputRef}
              InputProps={{
                ...params.InputProps,
                sx: { fontFamily: MONO, fontSize: 13 },
                endAdornment: (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    {selectedAddr && isKnownDevice && (
                      <Tooltip title="Edit nickname" placement="top">
                        <IconButton
                          size="small"
                          onClick={() => setEditMac(selectedAddr)}
                          sx={{ p: 0.5, '&:hover': { bgcolor: 'transparent' } }}
                        >
                          <EditOutlinedIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={!selectedAddr ? '' : copied ? 'Copied!' : 'Copy MAC'} placement="top">
                      <span>
                        <IconButton
                          size="small"
                          onClick={onCopyMac}
                          disabled={!selectedAddr}
                          sx={{
                            p: 0.5,
                            '&:hover': { bgcolor: 'transparent' },
                            '&.Mui-disabled': { opacity: 0.4 },
                          }}
                        >
                          {copied
                            ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
                            : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    {params.InputProps.endAdornment}
                  </Box>
                ),
              }}
            />
          )}
          fullWidth
        />
        </Box>

        {/* The three actions travel as one block. Left to the row's own
            wrapping they broke up -- the info button stranded on the field
            line, Scan and Connect on a line of their own -- which read as
            three unrelated controls instead of one place to act. `ml: auto`
            keeps them against the right edge on whichever line they land on,
            and `flexWrap: nowrap` keeps them from splitting again. */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{ gap: 1.5, flexWrap: 'nowrap', ml: 'auto', flexShrink: 0 }}
        >
        <Tooltip title={isConnected ? 'Meter information' : 'Connect to a unit first'}>
          <span>
            <IconButton
              disabled={!isConnected}
              onClick={() => setInfoOpen(true)}
              aria-label="Meter information"
              sx={{
                width: 36, height: 36, borderRadius: 1,
                border: '1px solid', borderColor: 'divider',
                '&.Mui-disabled': { borderColor: 'divider', opacity: 0.5 },
              }}
            >
              <InfoOutlinedIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </span>
        </Tooltip>

        <Button
          variant="contained"
          onClick={startScan}
          disabled={isConnected}
          sx={{ width: 96, minWidth: 96, height: 36, ...actionSx(scanning ? a.danger : a.scan, off) }}
        >
          {scanning ? 'Stop' : 'Scan'}
        </Button>

        <Button
          variant="contained"
          disabled={isConnected ? busy : !canConnect}
          onClick={toggle}
          endIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          // Fixed width: Connect, the spinner and Disconnect all fit one box.
          sx={{ width: 124, minWidth: 124, height: 36, whiteSpace: 'nowrap', ...actionSx(isConnected ? a.disconnect : a.connect, off) }}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </Button>
        </Stack>

      </Box>
      <MeterInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
      <NicknameModal mac={editMac} onClose={() => setEditMac(null)} />
    </Box>
  )
}

/**
 * The default path-loss figure, with the per-frequency table behind its tune
 * button.
 *
 * Shown in the Path loss step of the test pages and on the Power Meter page --
 * the places whose numbers it changes -- now that it no longer rides in a row
 * at the top of every page.
 */
export function PathLossField({ label = 'Path loss', unit = 'dB' }: { label?: string; unit?: string }) {
  const { pathLossDb, setPathLossDb, points } = usePathLoss()
  const [pathLossOpen, setPathLossOpen] = useState(false)
  // Label then a quieter unit, the LabeledField style used everywhere else.
  const fieldLabel = (text: string) => (
    <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>
      {text}
      <Box component="span" sx={{ ml: 0.5, fontWeight: 400, color: 'text.secondary' }}>{unit}</Box>
    </Typography>
  )
  return (
    <>
      <Box sx={{ width: 150 }}>
          {fieldLabel(label)}
          <TextField
            type="number"
            size="small"
            value={pathLossDb}
            onChange={(e) => setPathLossDb(Number(e.target.value) || 0)}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            inputProps={{ step: 0.1 }}
            fullWidth
            InputProps={{
              // In the field rather than beside it: this number and the table
              // behind it are the same setting, and a separate control would
              // read as an unrelated one.
              endAdornment: (
                <Tooltip title={
                  points.length
                    ? `Per-frequency path loss - ${points.length} calibrated`
                    : 'Per-frequency path loss'
                }>
                  <IconButton
                    size="small"
                    edge="end"
                    onClick={() => setPathLossOpen(true)}
                    aria-label="Edit path loss per frequency"
                    sx={{ mr: -0.5, color: points.length ? 'primary.main' : 'text.disabled' }}
                  >
                    <TuneIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              ),
            }}
          />
        </Box>

      <PathLossModal open={pathLossOpen} onClose={() => setPathLossOpen(false)} />
    </>
  )
}

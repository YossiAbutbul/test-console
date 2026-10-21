import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { useConnection } from '../context/ConnectionContext'
import {
  useInstrumentsActions, useInstrumentsState, type InstrumentId,
} from '../context/InstrumentsContext'
import { usePathLoss } from '../context/PathLossContext'
import { useNicknames } from '../context/NicknamesContext'
import { CheckDetail, CheckMark, CheckRail, CheckStep, GRID_GAP, MONO, type CheckState } from '../ui'
import { DutControls, PathLossField } from './ConnectionPanel'
import type { CourseStep } from './courseSteps'

interface Props {
  /** Show the DUT step. Off only for a page that never talks to the DUT. */
  dut?: boolean
  /** The instruments this page reads. Omit to leave the step out. */
  instruments?: InstrumentId[]
  /** What starts the instruments on their own: "Send", "Run". */
  connectsOn?: string
  /** Frequencies this page measures at, for the Path loss step. Omit to leave
   *  the step out. */
  freqsMhz?: number[]
  steps?: CourseStep[]
  /** Step ids in the order the rail shows them, when the page's own steps
   *  belong between the built-in ones. Unlisted steps keep their place after. */
  order?: string[]
}

/** First few values of a list, then a count of the rest. */
function listShort(values: string[], max = 3): string {
  return values.length <= max
    ? values.join(', ')
    : `${values.slice(0, max).join(', ')} +${values.length - max}`
}

/**
 * The check course at the top of a test page: what the page needs, in the
 * order it is done, each with its state -- and, below the rail, the detail of
 * whichever check is open.
 *
 * Replaces the DUT connection row that sat above every page. The same
 * controls now live in the DUT step, open on first load while the DUT is not
 * connected; closing it leaves a connected bench costing one row.
 *
 * Marked `data-ungated`: connecting the DUT, editing path loss and opening the
 * Instruments panel all have to work on a page that is waiting for the DUT --
 * they are how it stops waiting.
 */
export function BenchCourse({
  dut = true, instruments, connectsOn = 'Send', freqsMhz, steps = [], order,
}: Props) {
  const { status } = useConnection()
  const nicknames = useNicknames()
  const { instruments: all } = useInstrumentsState()
  const { setOpen: openInstruments } = useInstrumentsActions()
  const { lossAt, defaultDb } = usePathLoss()

  const dutReady = !!(status?.connected && status?.transport_ready)

  // Which detail is open. Decided once, when the page first draws: the DUT
  // step starts open if the DUT is not connected yet. After that only a click
  // opens or closes a detail. It used to fold itself away on connect and open
  // again when the link dropped, and a panel that changes height on its own
  // moves everything under it -- the page jumped the moment Connect worked.
  // Connecting now changes the panel's content (Scan / Connect become
  // Disconnect) without changing its size.
  const [openId, setOpenId] = useState<string | null>(() => (dut && !dutReady ? 'dut' : null))
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id))

  const items: (CourseStep & { builtin?: boolean })[] = []

  if (dut) {
    const name = status?.address ? nicknames.get(status.address) ?? status?.name : null
    items.push({
      id: 'dut',
      label: 'DUT',
      state: dutReady ? 'ok' : status?.connected ? 'busy' : 'block',
      summary: dutReady
        ? <Box component="span" sx={{ fontFamily: MONO }}>{[name, status?.address].filter(Boolean).join(' · ')}</Box>
        : status?.connected ? 'Connecting…' : 'Not connected',
      detail: (
        <Stack spacing={1}>
          {/* Always one line, whichever state: a hint that vanished on
              connect took the controls below it up with it. */}
          <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary' }}>
            {dutReady
              ? 'Connected. Disconnect here before swapping the unit on the bench.'
              : 'Scan, pick the unit and connect. Send and Run wait for the DUT; results, import and export already work.'}
          </Typography>
          <DutControls />
        </Stack>
      ),
    })
  }

  if (instruments && instruments.length) {
    const rows = instruments.map((id) => all[id])
    const connected = rows.filter((r) => r.status === 'connected')
    const failed = rows.filter((r) => r.status === 'error')
    const connecting = rows.some((r) => r.status === 'connecting')
    const state: CheckState = failed.length
      ? 'error'
      : connected.length === rows.length ? 'ok' : connecting ? 'busy' : 'todo'
    items.push({
      id: 'instruments',
      label: 'Instruments',
      state,
      summary: failed.length
        ? `${failed[0].label}: ${failed[0].failure?.title ?? 'error'}`
        : connected.length === rows.length
          ? listShort(rows.map((r) => r.label))
          // Short enough to survive a rail of seven steps; the detail says it
          // in full.
          : `${connected.length}/${rows.length} up · rest on ${connectsOn}`,
      detail: (
        <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 2 }}>
          {rows.map((r) => (
            <Stack key={r.id} direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
              <CheckMark
                size={20}
                state={
                  r.status === 'connected' ? 'ok'
                    : r.status === 'error' ? 'error'
                      : r.status === 'connecting' ? 'busy' : 'todo'
                }
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{r.label}</Typography>
                <Typography
                  sx={{ fontSize: 12.5, color: r.status === 'error' ? 'error.main' : 'text.secondary' }}
                >
                  {r.status === 'error'
                    ? `${r.failure?.title ?? 'Error'} · ${r.failure?.hint ?? ''}`
                    : r.status === 'connected' ? 'connected' : r.status === 'connecting' ? 'connecting…' : 'not connected'}
                </Typography>
              </Box>
            </Stack>
          ))}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<TuneIcon sx={{ fontSize: 16 }} />}
            onClick={() => openInstruments(true)}
            sx={{ height: 36, borderColor: 'divider' }}
          >
            Open Instruments
          </Button>
        </Stack>
      ),
    })
  }

  if (freqsMhz) {
    const uniq = [...new Set(freqsMhz.filter((f) => Number.isFinite(f)))]
    const missing = uniq.filter((f) => !lossAt(f).calibrated)
    const one = uniq.length === 1 ? lossAt(uniq[0]) : null
    items.push({
      id: 'path-loss',
      label: 'Path loss',
      state: uniq.length === 0 ? 'todo' : missing.length ? 'warn' : 'ok',
      summary: uniq.length === 0
        ? `default ${defaultDb} dB`
        : missing.length
          ? missing.length === 1
            ? `${missing[0]} MHz on default ${defaultDb} dB`
            : `${missing.length} of ${uniq.length} on default ${defaultDb} dB`
          : one ? `${one.db} dB at ${uniq[0]} MHz` : `calibrated at all ${uniq.length} frequencies`,
      detail: (
        <Stack direction="row" alignItems="flex-end" sx={{ flexWrap: 'wrap', gap: 2 }}>
          <PathLossField label="Default (dB)" />
          {uniq.slice(0, 8).map((f) => {
            const l = lossAt(f)
            return (
              <Box key={f} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>{f} MHz</Typography>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ height: 36 }}>
                  <CheckMark size={18} state={l.calibrated ? 'ok' : 'warn'} />
                  <Typography
                    sx={{ fontFamily: MONO, fontSize: 13.5, color: l.calibrated ? 'text.primary' : 'warning.main' }}
                  >
                    {l.calibrated ? `${l.db} dB` : `${l.db} dB default`}
                  </Typography>
                </Stack>
              </Box>
            )
          })}
          {uniq.length > 8 && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', pb: 1 }}>
              +{uniq.length - 8} more
            </Typography>
          )}
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', pb: 1, flexBasis: '100%' }}>
            Readings are sensor + path loss = power at the DUT. A frequency with no table entry uses the default.
          </Typography>
        </Stack>
      ),
    })
  }

  items.push(...steps)
  if (order) {
    const rank = (id: string) => {
      const i = order.indexOf(id)
      return i < 0 ? order.length : i
    }
    items.sort((x, y) => rank(x.id) - rank(y.id))
  }
  const open = items.find((s) => s.id === openId && s.detail)

  return (
    <Box data-ungated sx={{ display: 'flex', flexDirection: 'column', gap: `${GRID_GAP}px`, mb: 1.5 }}>
      <CheckRail>
        {items.map((s) => (
          <CheckStep
            key={s.id}
            state={s.state}
            label={s.label}
            summary={s.summary}
            selected={openId === s.id && !!s.detail}
            onClick={
              s.detail
                ? () => toggle(s.id)
                : s.targetId
                  ? () => document.getElementById(s.targetId!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  : undefined
            }
          />
        ))}
      </CheckRail>
      {open && <CheckDetail>{open.detail}</CheckDetail>}
    </Box>
  )
}


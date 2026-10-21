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
 * The DUT step reports the link; the controls for it, and the default path
 * loss, are in the top bar. Marked `data-ungated`: opening a check's detail
 * and the Instruments panel have to work on a page that is waiting for the
 * DUT.
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

  // Which detail is open: only ever changed by a click. The DUT step has no
  // detail -- its controls are in the top bar, always in view.
  const [openId, setOpenId] = useState<string | null>(null)
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id))

  const items: (CourseStep & { builtin?: boolean })[] = []

  if (dut) {
    const name = status?.address ? nicknames.get(status.address) ?? status?.name : null
    items.push({
      id: 'dut',
      label: 'DUT',
      state: dutReady ? 'ok' : status?.connected ? 'busy' : 'block',
      summary: dutReady
        // A string, so the rail can put the whole line in a hover title
        // when a seven-step rail cuts it short.
        ? [name, status?.address].filter(Boolean).join(' · ')
        : status?.connected ? 'Connecting…' : 'Not connected',
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


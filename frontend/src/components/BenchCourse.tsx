import { useState } from 'react'
import {
  useInstrumentsActions, useInstrumentsState, type InstrumentId,
} from '../context/InstrumentsContext'
import { usePathLoss } from '../context/PathLossContext'
import { CheckRail, CheckStep, type CheckState } from '../ui'
import { PathLossModal } from './PathLossModal'
import type { CourseStep } from './courseSteps'

interface Props {
  /** The instruments this page reads. Omit to leave the step out. */
  instruments?: InstrumentId[]
  /** What starts the instruments on their own: "Send", "Run". */
  connectsOn?: string
  /** Frequencies this page measures at, for the Path loss step. Omit to leave
   *  the step out. */
  freqsMhz?: number[]
  /** A page's own checks (Load Pull's RF path, test point, trombone). */
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
 * The checks at the top of a test page that are not already on screen
 * somewhere else.
 *
 * It used to carry DUT, Settings and Run steps too, and a detail panel that
 * opened under the rail. Each of those repeated something the page already
 * shows -- the DUT connection is in the top bar, the plan size is on the
 * sweep panel, and the Run key says what holds it -- so they went. What is
 * left is a strip of status that doubles as shortcuts: Instruments opens the
 * Instruments panel, Path loss opens the per-frequency table, and a page's own
 * steps scroll to the section that settles them. Nothing opens or closes
 * under the rail, so nothing below it moves.
 *
 * Marked `data-ungated`: both shortcuts have to work on a page that is waiting
 * for the DUT.
 */
export function BenchCourse({
  instruments, connectsOn = 'Send', freqsMhz, steps = [], order,
}: Props) {
  const { instruments: all } = useInstrumentsState()
  const { setOpen: openInstruments } = useInstrumentsActions()
  const { lossAt, defaultDb } = usePathLoss()
  const [tableOpen, setTableOpen] = useState(false)

  const items: CourseStep[] = []

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
          // Short enough to survive a rail of six steps; the panel the step
          // opens says it in full.
          : `${connected.length}/${rows.length} up · rest on ${connectsOn}`,
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

  const onStep = (s: CourseStep) => {
    if (s.id === 'instruments') return () => openInstruments(true)
    if (s.id === 'path-loss') return () => setTableOpen(true)
    if (s.targetId) {
      const id = s.targetId
      return () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    return undefined
  }

  if (items.length === 0) return null

  return (
    <div data-ungated style={{ marginBottom: 12 }}>
      <CheckRail>
        {items.map((s) => (
          <CheckStep key={s.id} state={s.state} label={s.label} summary={s.summary} onClick={onStep(s)} />
        ))}
      </CheckRail>
      <PathLossModal open={tableOpen} onClose={() => setTableOpen(false)} />
    </div>
  )
}

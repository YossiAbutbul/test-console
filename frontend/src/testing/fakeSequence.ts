/**
 * A stand-in for the backend's Test Sequence runner (backend/sequence), as
 * `installFakeBackend` routes.
 *
 * The real runner is tested against the rig's call order in
 * backend/tests/test_sequence_runner.py; this one only has to behave like it
 * from the page's side -- the status it reports, the prompt it raises before a
 * step on another setup, the rows it hands back, and what Stop does -- so the
 * page's tests can check what the page sends and shows.
 *
 * It runs on, without timers, to the next re-cable prompt or the end each
 * time it is asked, unless `stepwise`: then one point per status poll, for a
 * test that needs to look at a run mid-way.
 */
import type {
  SequenceIn, SequenceNote, SequenceStatus, SequenceStepIn, SequenceStepOutcome,
} from '../api/sequence'
import type { Handler } from './fakeBackend'

type Row = Record<string, unknown>

export interface FakeSequenceOptions {
  /** One point's row. Judged as the backend would from `verdict`. */
  measure?: (step: SequenceStepIn, point: Record<string, unknown>, index: number) => Row
  stepwise?: boolean
}

/** LoRa CW's row at 14 dBm, judged against the point's power and margin. */
export function loraRow(measured: number) {
  return (_s: SequenceStepIn, p: Record<string, unknown>): Row => {
    const margin = p.margin_db as number | null
    const verdict = margin == null ? null
      : Math.abs(measured - (p.power_dbm as number)) <= margin ? 'pass' : 'fail'
    return {
      freq_mhz: p.freq_mhz, set_power_dbm: p.power_dbm, measured_dbm: measured, verdict, ok: true, error: null,
    }
  }
}

export function fakeSequence(opts: FakeSequenceOptions = {}) {
  const measure = opts.measure ?? loraRow(14)
  let run: {
    seq: SequenceIn
    status: SequenceStatus
    rows: Map<string, Row[]>
    /** The step in hand, and its next point. */
    step: number
    point: number
    /** The step at `step` has cleared its re-cable. */
    cabled: boolean
  } | null = null
  let started = 0
  const bodies: SequenceIn[] = []

  const note = (message: string, level: SequenceNote['level'] = 'info') => {
    const notes = run!.status.notes
    notes.push({ seq: (notes.at(-1)?.seq ?? 0) + 1, message, level })
  }

  const finish = (state: SequenceStatus['state'], ended: SequenceStatus['ended'] = null) => {
    const r = run!
    r.status = { ...r.status, state, ended, current: null, prompt: null, finished_at: Date.now() / 1000 }
    note('rig left idle')
  }

  /** Run on: one point, or until it blocks. */
  const advance = (once: boolean) => {
    const r = run
    if (!r || r.status.state !== 'running' || r.status.prompt) return
    for (;;) {
      const step = r.seq.steps[r.step]
      if (!step) { finish('done'); return }
      if (!r.cabled) {
        if (step.setup !== r.status.bench) {
          r.status.prompt = { seq: r.step + 1, step_uid: step.uid, from_setup: r.status.bench, to_setup: step.setup }
          return
        }
        r.cabled = true
      }
      const out = r.status.steps[r.step]
      out.verdict = 'running'
      const rows = r.rows.get(step.uid) ?? []
      r.rows.set(step.uid, rows)
      const p = step.points[r.point]
      if (p) {
        r.status.current = { uid: step.uid, index: r.step, done: r.point, total: step.points.length }
        const row = measure(step, p, r.point)
        rows.push(row)
        out.measured = rows.length
        out.passed = rows.filter((x) => x.verdict === 'pass').length
        out.failed = rows.filter((x) => x.verdict === 'fail').length
        out.errors = rows.filter((x) => !!x.error).length
        r.point++
      }
      if (r.point >= step.points.length) {
        out.verdict = out.failed ? 'fail' : out.errors ? 'error' : out.passed ? 'pass' : 'na'
        r.step++
        r.point = 0
        r.cabled = false
      }
      if (once) return
    }
  }

  const status = (): SequenceStatus => run?.status ?? {
    state: 'idle', steps: [], current: null, prompt: null, bench: null, notes: [],
    started_at: null, finished_at: null, error: null, ended: null,
  }
  const copy = () => structuredClone(status())

  const routes: Record<string, Handler> = {
    'POST /sequence/run': (c) => {
      const seq = c.body as SequenceIn
      bodies.push(seq)
      run = {
        seq, rows: new Map(), step: 0, point: 0, cabled: false,
        status: {
          state: 'running', bench: seq.bench, notes: [], current: null, prompt: null,
          steps: seq.steps.map((s): SequenceStepOutcome => ({
            uid: s.uid, verdict: 'not-run', passed: 0, failed: 0, measured: 0,
            planned: s.points.length, errors: 0, ms: 0, message: null,
          })),
          started_at: ++started, finished_at: null, error: null, ended: null,
        },
      }
      if (!opts.stepwise) advance(false)
      return copy()
    },
    'GET /sequence/status': () => {
      advance(!!opts.stepwise)
      return copy()
    },
    'GET /sequence/rows': (c) => {
      const rows = run?.rows.get(c.query.get('step') ?? '') ?? []
      return rows.slice(Number(c.query.get('since') ?? 0))
    },
    'POST /sequence/recable': (c) => {
      const { seq, ok } = c.body as { seq: number; ok: boolean }
      const r = run
      if (r?.status.prompt?.seq === seq) {
        r.status.prompt = null
        if (!ok) finish('cancelled', 'declined')
        else {
          r.status.bench = r.seq.steps[r.step].setup
          r.cabled = true
          if (!opts.stepwise) advance(false)
        }
      }
      return copy()
    },
    'POST /sequence/cancel': () => {
      if (run?.status.state === 'running') finish('cancelled', 'stopped')
      return copy()
    },
    'GET /runs/active': () => ({ run: run?.status.state === 'running' ? 'Test Sequence' : null }),
  }

  return {
    routes,
    /** Every start body the page sent. */
    bodies,
    /** The run's status as the backend holds it now. */
    status,
  }
}

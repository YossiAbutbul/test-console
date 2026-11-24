import { describe, expect, it } from 'vitest'
import type { SetupId } from '../engine/sweepTest'
import { recablePoints, runSuite, stepVerdict, type SuiteStep } from './runSuite'

interface Step extends SuiteStep { name: string; power?: number }

const step = (uid: string, setup: SetupId, power?: number): Step => ({ uid, setup, name: uid, power })

const ok = (pass = 2) => ({ verdict: 'pass' as const, pass, fail: 0, measured: pass, planned: pass, errors: 0 })

/** A run that records what it did, in order. */
function harness(opts: { answer?: boolean; failAt?: string; throwAt?: string } = {}) {
  const events: string[] = []
  return {
    events,
    confirmSetup: async (from: SetupId | null, to: SetupId, s: Step) => {
      events.push(`recable ${from ?? '?'}→${to} before ${s.uid}`)
      return opts.answer ?? true
    },
    runStep: async (s: Step) => {
      events.push(`run ${s.uid}${s.power == null ? '' : `@${s.power}`}`)
      if (s.uid === opts.throwAt) throw new Error('DUT did not come back')
      if (s.uid === opts.failAt) return { verdict: 'fail' as const, pass: 1, fail: 1, measured: 2, planned: 2, errors: 0 }
      return ok()
    },
  }
}

describe('runSuite', () => {
  it('runs every step in order, repeats included, each with its own settings', async () => {
    const h = harness()
    const steps = [step('cw', 'main', 14), step('cw-2', 'main', 20), step('mod', 'main')]
    const r = await runSuite({ steps, bench: 'main', abort: new AbortController(), ...h })
    expect(h.events).toEqual(['run cw@14', 'run cw-2@20', 'run mod'])
    expect(r.completed).toBe(true)
    expect(r.outcomes.map((o) => o.verdict)).toEqual(['pass', 'pass', 'pass'])
  })

  it('pauses to re-cable only where the setup changes', async () => {
    const h = harness()
    const steps = [step('cw', 'main'), step('ble', 'ble'), step('ble-2', 'ble'), step('lte', 'main')]
    const benches: SetupId[] = []
    await runSuite({ steps, bench: 'main', abort: new AbortController(), ...h, onBench: (b) => benches.push(b) })
    expect(h.events).toEqual([
      'run cw',
      'recable main→ble before ble', 'run ble', 'run ble-2',
      'recable ble→main before lte', 'run lte',
    ])
    expect(benches).toEqual(['ble', 'main'])
  })

  it('asks before the first step only when the bench is not on its setup', async () => {
    const onMain = harness()
    await runSuite({ steps: [step('cw', 'main')], bench: 'main', abort: new AbortController(), ...onMain })
    expect(onMain.events).toEqual(['run cw'])

    const unknown = harness()
    await runSuite({ steps: [step('cw', 'main')], bench: null, abort: new AbortController(), ...unknown })
    expect(unknown.events).toEqual(['recable ?→main before cw', 'run cw'])
  })

  it('ends the run when the operator declines to re-cable', async () => {
    const h = harness({ answer: false })
    const r = await runSuite({ steps: [step('cw', 'main'), step('ble', 'ble')], bench: 'main', abort: new AbortController(), ...h })
    expect(h.events).toEqual(['run cw', 'recable main→ble before ble'])
    expect(r.ended).toBe('declined')
    expect(r.outcomes.map((o) => o.verdict)).toEqual(['pass', 'not-run'])
  })

  it('carries on past a failing step', async () => {
    const h = harness({ failAt: 'cw' })
    const r = await runSuite({ steps: [step('cw', 'main'), step('mod', 'main')], bench: 'main', abort: new AbortController(), ...h })
    expect(h.events).toEqual(['run cw', 'run mod'])
    expect(r.completed).toBe(true)
    expect(r.outcomes.map((o) => o.verdict)).toEqual(['fail', 'pass'])
  })

  it('ends the run when a step cannot go on', async () => {
    const h = harness({ throwAt: 'ble' })
    const steps = [step('ble', 'ble'), step('ble-2', 'ble')]
    const r = await runSuite({ steps, bench: 'ble', abort: new AbortController(), ...h })
    expect(h.events).toEqual(['run ble'])
    expect(r.ended).toBe('error')
    expect(r.outcomes[0]).toMatchObject({ verdict: 'error', message: 'DUT did not come back' })
    expect(r.outcomes[1].verdict).toBe('not-run')
  })

  it('Stop during a step ends the run there', async () => {
    const abort = new AbortController()
    const events: string[] = []
    const r = await runSuite({
      steps: [step('cw', 'main'), step('mod', 'main')],
      bench: 'main',
      abort,
      confirmSetup: async () => true,
      runStep: async (s) => {
        events.push(`run ${s.uid}`)
        abort.abort()
        return { verdict: 'pass', pass: 1, fail: 0, measured: 1, planned: 3, errors: 0 }
      },
    })
    expect(events).toEqual(['run cw'])
    expect(r.ended).toBe('stopped')
    expect(r.outcomes.map((o) => o.verdict)).toEqual(['stopped', 'not-run'])
    // What it measured before the Stop is kept.
    expect(r.outcomes[0].pass).toBe(1)
  })

  it('Stop during a re-cable prompt ends the run without running the step', async () => {
    const abort = new AbortController()
    const events: string[] = []
    const r = await runSuite({
      steps: [step('cw', 'main'), step('ble', 'ble')],
      bench: 'main',
      abort,
      confirmSetup: (_f, _t, _s, _i, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(false))
        abort.abort()
      }),
      runStep: async (s) => { events.push(`run ${s.uid}`); return ok() },
    })
    expect(events).toEqual(['run cw'])
    expect(r.ended).toBe('stopped')
    expect(r.outcomes.map((o) => o.verdict)).toEqual(['pass', 'not-run'])
  })
})

describe('plan helpers', () => {
  const steps = [step('a', 'main'), step('b', 'ble'), step('c', 'main'), step('d', 'ble')]

  it('finds where the setup changes', () => {
    expect(recablePoints(steps, 'main')).toEqual([1, 2, 3])
    expect(recablePoints(steps, null)).toEqual([0, 1, 2, 3])
  })

  it('leads the verdict with FAIL', () => {
    expect(stepVerdict({ pass: 3, fail: 1, errors: 1, measured: 5 })).toBe('fail')
    expect(stepVerdict({ pass: 3, fail: 0, errors: 1, measured: 5 })).toBe('error')
    expect(stepVerdict({ pass: 3, fail: 0, errors: 0, measured: 3 })).toBe('pass')
    expect(stepVerdict({ pass: 0, fail: 0, errors: 0, measured: 3 })).toBe('na')
  })
})

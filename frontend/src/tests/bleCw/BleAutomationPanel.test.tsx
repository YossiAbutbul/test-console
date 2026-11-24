// @vitest-environment happy-dom
/**
 * The BLE CW sweep page's run, handed to the backend; see
 * power/AutomationPanel.test. The page's own radio is a fake `BleLink`, which
 * a run must not touch: the backend drives the DUT's radio itself.
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, rigTrace } from '../../testing/fakeBackend'
import { fakeSequence } from '../../testing/fakeSequence'
import { renderWithApp } from '../../testing/renderWithApp'
import { bleCwPageSnapshot } from '../../store/bleCwPageStore'
import type { BleLink } from '../ble/useBleLink'
import { BleAutomationPanel, type AutomationControls } from './BleAutomationPanel'

function fakeLink(trace: string[]): BleLink {
  return {
    phase: { kind: 'idle' } as BleLink['phase'],
    power: null,
    busy: false,
    readPower: async () => null,
    setPower: async (p: number) => { trace.push(`setPower ${p}`); return {} as never },
    ensurePower: async (p: number) => { trace.push(`ensurePower ${p}`); return true },
    tone: async (req: unknown) => {
      trace.push(`tone ${JSON.stringify(req)}`)
      return { acknowledged: false, status: null } as never
    },
    finishTone: async () => { trace.push('finishTone') },
    onAirUntil: () => Date.now() + 60_000,
    forget: () => {},
  } as BleLink
}

describe('BLE CW automation panel', () => {
  let controls: AutomationControls | null = null
  beforeEach(() => {
    controls = null
    bleCwPageSnapshot.automation = {
      rows: [
        { channel: '0,39', power: '31', minDbm: '0', maxDbm: '10' },
        { channel: '19', power: '20', minDbm: '', maxDbm: '' },
      ],
      settleMs: 400,
      toneFixedSeconds: '',
      results: [],
    }
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('hands the backend its channels and powers, and takes the judged rows back', async () => {
    const seq = fakeSequence({
      measure: (_s, p) => {
        const m = p.channel === 0 ? 5 : 12
        const lo = p.min_dbm as number | null
        const hi = p.max_dbm as number | null
        return {
          ...p, power_param: p.power, measured_dbm: m, measured_dbm_raw: m, current_a: 0.1, voltage_v: 3.6,
          ok: true, status: 0, error: null,
          verdict: lo == null && hi == null ? null : (lo == null || m >= lo) && (hi == null || m <= hi) ? 'pass' : 'fail',
        }
      },
    })
    const backend = installFakeBackend(seq.routes)
    const trace: string[] = []
    const link = fakeLink(trace)
    renderWithApp(
      <BleAutomationPanel
        link={link} unit="channel" onUnitChange={() => {}}
        onControlsChange={(c) => { controls = c }}
      />,
    )
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(3)

    act(() => controls!.onRun())
    await waitFor(() => expect(seq.bodies).toHaveLength(1))
    expect(seq.bodies[0]).toMatchSnapshot()
    await waitFor(() => expect(bleCwPageSnapshot.automation?.results?.map((r) => [r.channel, r.verdict]))
      .toEqual([[0, 'pass'], [39, 'fail'], [19, null]]), { timeout: 8000 })
    expect(trace).toEqual([])
    expect(rigTrace(backend.calls)).toEqual([])
  }, 15000)
})

// @vitest-environment happy-dom
/**
 * Characterisation test for the BLE CW sweep; see power/AutomationPanel.test.
 * The radio is a fake `BleLink`: the real one waits out each tone in real
 * time, and what is pinned here is the order the panel drives it in.
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, measured } from '../../testing/fakeBackend'
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

  it('sets power per change, tones, measures and relinks each point', async () => {
    const backend = installFakeBackend({
      'POST /instruments/measure': (c) => measured(c.query.get('freq_hz') === '2402000000' ? 5 : 12),
    })
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
    await waitFor(() => expect(controls?.running).toBe(true))
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(trace).toMatchSnapshot()
    expect(backend.to('POST', '/instruments/measure').map((c) => c.query.get('freq_hz')))
      .toEqual(['2402000000', '2480000000', '2440000000'])
    expect(bleCwPageSnapshot.automation?.results?.map((r) => [r.channel, r.verdict]))
      .toEqual([[0, 'pass'], [39, 'fail'], [19, null]])
  }, 15000)
})

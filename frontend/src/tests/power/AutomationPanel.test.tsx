// @vitest-environment happy-dom
/**
 * Characterisation test for the LoRa CW sweep: what a run sends the DUT and
 * the instruments, in what order, and what lands in the results table.
 * Written before the panels were folded onto a shared hook, to hold that
 * refactor to the behaviour they had.
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, installFakeBackend, measured } from '../../testing/fakeBackend'
import { renderWithApp } from '../../testing/renderWithApp'
import { powerPageSnapshot } from '../../store/powerPageStore'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'

describe('LoRa CW automation panel', () => {
  beforeEach(() => {
    powerPageSnapshot.automation = {
      rows: [{ freq: '902.3,915', power: '14', paMode: 1, marginDb: '1' }],
      settleMs: 400,
      results: [],
    }
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keys, measures and stops the DUT at each point, then judges it', async () => {
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      // 915 MHz comes back 3 dB short: outside its 1 dB tolerance.
      'POST /instruments/measure': (c) => measured(c.query.get('freq_hz') === '915000000' ? 11 : 13.8),
    })
    let controls: AutomationControls | null = null
    renderWithApp(<AutomationPanel protocol="LoRa" onControlsChange={(c) => { controls = c }} />)

    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)
    expect(controls!.freqsMhz).toEqual([902.3, 915])

    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(backend.to('POST', '/device/lora-power').map((c) => c.body)).toEqual([
      { timeout: 5, freq_hz: 902_300_000, power_dbm: 14, pa_mode: 1 },
      { timeout: 5, freq_hz: 915_000_000, power_dbm: 14, pa_mode: 1 },
    ])
    expect(backend.to('POST', '/instruments/measure').map((c) => c.query.get('freq_hz')))
      .toEqual(['902300000', '915000000'])
    // Keyed down after every point and once more at the end of the run.
    const order = backend.calls
      .filter((c) => c.method === 'POST' && c.path.startsWith('/device/'))
      .map((c) => c.path)
    expect(order).toEqual([
      '/device/lora-power', '/device/stop', '/device/lora-power', '/device/stop', '/device/stop',
    ])

    const rows = [...document.querySelectorAll('table tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('902.300')
    expect(rows[0].textContent).toContain('13.80')
    expect(rows[1].textContent).toContain('11.00')
    expect(powerPageSnapshot.automation?.results?.map((r) => r.verdict)).toEqual(['pass', 'fail'])
  }, 15000)

  it('stops the DUT when the run is stopped mid-point', async () => {
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
    let controls: AutomationControls | null = null
    renderWithApp(<AutomationPanel protocol="LoRa" onControlsChange={(c) => { controls = c }} />)
    await waitFor(() => expect(controls?.canRun).toBe(true))

    act(() => controls!.onRun())
    await waitFor(() => expect(backend.to('POST', '/device/lora-power')).toHaveLength(1))
    expect(controls!.running).toBe(true)
    act(() => controls!.onStop())
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    // Never keyed the second point, and told the DUT to stop.
    expect(backend.to('POST', '/device/lora-power')).toHaveLength(1)
    expect(backend.to('POST', '/device/stop').length).toBeGreaterThanOrEqual(1)
  }, 15000)
})

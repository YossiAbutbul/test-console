// @vitest-environment happy-dom
/**
 * The LoRa CW sweep page against a fake backend: the run it hands the
 * backend (a one-step Test Sequence), the rows it takes back into its table,
 * Stop, a run picked back up after the page reloads, and Run held off while
 * another run has the rig. What the backend sends the rig for these points is
 * pinned in backend/tests/test_sequence_runner.py.
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, rigTrace } from '../../testing/fakeBackend'
import { fakeSequence } from '../../testing/fakeSequence'
import { renderWithApp } from '../../testing/renderWithApp'
import { powerPageSnapshot } from '../../store/powerPageStore'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'

/** 915 MHz comes back 3 dB short: outside its 1 dB tolerance. */
const measure = (_s: unknown, p: Record<string, unknown>) => {
  const m = p.freq_mhz === 915 ? 11 : 13.8
  return {
    freq_mhz: p.freq_mhz, set_power_dbm: p.power_dbm, pa_mode: p.pa_mode,
    measured_dbm: m, measured_dbm_raw: m, current_a: 0.1, voltage_v: 3.6, margin_db: p.margin_db,
    verdict: Math.abs(m - (p.power_dbm as number)) <= (p.margin_db as number) ? 'pass' : 'fail',
    ok: true, status: 0, error: null,
  }
}

describe('LoRa CW automation panel', () => {
  let controls: AutomationControls | null = null
  const render = () => renderWithApp(<AutomationPanel protocol="LoRa" onControlsChange={(c) => { controls = c }} />)

  beforeEach(() => {
    controls = null
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

  it('hands the backend its points, then fills the table from the run', async () => {
    const seq = fakeSequence({ measure })
    const backend = installFakeBackend(seq.routes)
    render()

    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)
    expect(controls!.freqsMhz).toEqual([902.3, 915])

    act(() => controls!.onRun())
    await waitFor(() => expect(seq.bodies).toHaveLength(1))
    expect(seq.bodies[0]).toMatchSnapshot()
    await waitFor(() => expect(powerPageSnapshot.automation?.results?.map((r) => r.verdict)).toEqual(['pass', 'fail']),
      { timeout: 8000 })
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    // Nothing keyed from the page.
    expect(rigTrace(backend.calls)).toEqual([])
    const rows = [...document.querySelectorAll('table tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('902.300')
    expect(rows[0].textContent).toContain('13.80')
    expect(rows[1].textContent).toContain('11.00')
  }, 15000)

  it('stops the backend run', async () => {
    const seq = fakeSequence({ measure, stepwise: true })
    const backend = installFakeBackend(seq.routes)
    render()
    await waitFor(() => expect(controls?.canRun).toBe(true))

    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))
    act(() => controls!.onStop())
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(backend.to('POST', '/sequence/cancel')).toHaveLength(1)
    expect(seq.status().ended).toBe('stopped')
  }, 15000)

  it('picks its run back up after the page reloads', async () => {
    const seq = fakeSequence({ measure, stepwise: true })
    installFakeBackend(seq.routes)
    render()
    await waitFor(() => expect(controls?.canRun).toBe(true))
    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))

    cleanup()
    controls = null
    render()
    await waitFor(() => expect(controls?.running).toBe(true), { timeout: 8000 })
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })
    await waitFor(() => expect(powerPageSnapshot.automation?.results).toHaveLength(2))
    expect(seq.bodies).toHaveLength(1)
  }, 20000)

  it('holds Run off while another run has the rig', async () => {
    installFakeBackend({ ...fakeSequence().routes, 'GET /runs/active': () => ({ run: 'Load Pull' }) })
    render()
    await waitFor(() => expect(controls).not.toBeNull())
    await new Promise((r) => setTimeout(r, 200))
    expect(controls!.canRun).toBe(false)
  }, 15000)
})

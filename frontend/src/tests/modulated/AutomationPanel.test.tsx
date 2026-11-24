// @vitest-environment happy-dom
/** The LoRa modulated sweep page's run, handed to the backend; see power/AutomationPanel.test. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, rigTrace } from '../../testing/fakeBackend'
import { fakeSequence } from '../../testing/fakeSequence'
import { renderWithApp } from '../../testing/renderWithApp'
import { modulatedPageSnapshot } from '../../store/modulatedPageStore'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'

describe('LoRa modulated automation panel', () => {
  beforeEach(() => {
    modulatedPageSnapshot.automation = {
      rows: [
        { freq: '915', power: '14', modem: 1, bandwidth: 1, datarate: 9, marginDb: '1' },
        { freq: '868', power: '10', modem: 0, bandwidth: 2, datarate: 50000, marginDb: '' },
      ],
      settleMs: 400,
      results: [],
    }
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('hands the backend each row signal, and takes the judged rows back', async () => {
    const seq = fakeSequence({
      measure: (_s, p) => {
        const m = p.freq_mhz === 915 ? 13.5 : 9.0
        const margin = p.margin_db as number | null
        return {
          freq_mhz: p.freq_mhz, set_power_dbm: p.power_dbm, modem: p.modem, bandwidth: p.bandwidth,
          datarate: p.datarate, measured_dbm: m, measured_dbm_raw: m, current_a: 0.1, voltage_v: 3.6,
          margin_db: margin, ok: true, status: 0, error: null,
          verdict: margin == null ? null : Math.abs(m - (p.power_dbm as number)) <= margin ? 'pass' : 'fail',
        }
      },
    })
    const backend = installFakeBackend(seq.routes)
    let controls: AutomationControls | null = null
    renderWithApp(<AutomationPanel protocol="LoRa" onControlsChange={(c) => { controls = c }} />)
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)

    act(() => controls!.onRun())
    await waitFor(() => expect(seq.bodies).toHaveLength(1))
    expect(seq.bodies[0]).toMatchSnapshot()
    await waitFor(() => expect(modulatedPageSnapshot.automation?.results?.map((r) => [r.measured_dbm, r.verdict]))
      .toEqual([[13.5, 'pass'], [9, null]]), { timeout: 8000 })
    expect(rigTrace(backend.calls)).toEqual([])
    expect(document.querySelectorAll('table tbody tr')).toHaveLength(2)
  }, 15000)
})

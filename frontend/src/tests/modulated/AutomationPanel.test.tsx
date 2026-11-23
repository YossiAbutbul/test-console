// @vitest-environment happy-dom
/** Characterisation test for the LoRa modulated sweep; see power/AutomationPanel.test. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, installFakeBackend, measured, rigTrace } from '../../testing/fakeBackend'
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

  it('sends each row signal, measures, stops, and judges', async () => {
    const backend = installFakeBackend({
      'POST /device/lora-modulated': () => command(),
      'POST /instruments/measure': (c) => measured(c.query.get('freq_hz') === '915000000' ? 13.5 : 9.0),
    })
    let controls: AutomationControls | null = null
    renderWithApp(<AutomationPanel protocol="LoRa" onControlsChange={(c) => { controls = c }} />)
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)

    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(rigTrace(backend.calls)).toMatchSnapshot()
    expect(modulatedPageSnapshot.automation?.results?.map((r) => [r.measured_dbm, r.verdict]))
      .toEqual([[13.5, 'pass'], [9, null]])
    expect(document.querySelectorAll('table tbody tr')).toHaveLength(2)
  }, 15000)
})

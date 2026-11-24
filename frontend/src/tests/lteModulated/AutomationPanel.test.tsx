// @vitest-environment happy-dom
/** The LTE modulated sweep page's run, handed to the backend; see power/AutomationPanel.test. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, rigTrace } from '../../testing/fakeBackend'
import { fakeSequence } from '../../testing/fakeSequence'
import { renderWithApp } from '../../testing/renderWithApp'
import { lteModulatedPageSnapshot } from '../../store/lteModulatedPageStore'
import { useLteModem } from '../lte/useLteModem'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'

let controls: AutomationControls | null = null

function Harness() {
  const modem = useLteModem({ pageId: 'lte-modulated' })
  return (
    <AutomationPanel
      modem={modem} unit="earfcn" bands={[2]}
      onUnitChange={() => {}} onEditBands={() => {}}
      onControlsChange={(c) => { controls = c }}
    />
  )
}

describe('LTE modulated automation panel', () => {
  beforeEach(() => {
    controls = null
    lteModulatedPageSnapshot.automation = {
      rows: [{ earfcn: '18900', power: '20,23', marginDb: '1' }],
      settleMs: 400,
      results: [],
    }
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('hands the backend its points and takes the judged rows back', async () => {
    const seq = fakeSequence({
      measure: (_s, p) => {
        const m = 20.2
        return {
          ...p, set_power_dbm: p.power_dbm, measured_dbm: m, measured_dbm_raw: m, current_a: 0.1, voltage_v: 3.6,
          ok: true, status: 0, error: null,
          verdict: Math.abs(m - (p.power_dbm as number)) <= (p.margin_db as number) ? 'pass' : 'fail',
        }
      },
    })
    const backend = installFakeBackend(seq.routes)
    renderWithApp(<Harness />)
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)

    act(() => controls!.onRun())
    await waitFor(() => expect(seq.bodies).toHaveLength(1))
    expect(seq.bodies[0]).toMatchSnapshot()
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })
    await waitFor(() => expect(lteModulatedPageSnapshot.automation?.results).toHaveLength(2))
    // The modem is the backend's for the run.
    expect(rigTrace(backend.calls)).toEqual([])
    expect(lteModulatedPageSnapshot.automation?.results?.map((r) => [r.set_power_dbm, r.verdict]))
      .toEqual([[20, 'pass'], [23, 'fail']])
  }, 15000)
})

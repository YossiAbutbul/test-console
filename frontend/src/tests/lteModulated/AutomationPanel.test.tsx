// @vitest-environment happy-dom
/** Characterisation test for the LTE modulated sweep; see power/AutomationPanel.test. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, installFakeBackend, measured, rigTrace } from '../../testing/fakeBackend'
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

  it('cycles the modem once, then starts, measures and aborts each point', async () => {
    const backend = installFakeBackend({
      'POST /device/lte/modem-off': () => command(),
      'POST /device/lte/modem-on': () => command(),
      'POST /device/lte/modulated': () => command(),
      'POST /instruments/measure': () => measured(20.2),
    })
    renderWithApp(<Harness />)
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)

    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(rigTrace(backend.calls)).toMatchSnapshot()
    expect(lteModulatedPageSnapshot.automation?.results?.map((r) => [r.set_power_dbm, r.verdict]))
      .toEqual([[20, 'pass'], [23, 'fail']])
  }, 15000)
})

// @vitest-environment happy-dom
/** Characterisation test for the LTE CW sweep; see power/AutomationPanel.test. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, installFakeBackend, measured, rigTrace } from '../../testing/fakeBackend'
import { renderWithApp } from '../../testing/renderWithApp'
import { lteCwPageSnapshot } from '../../store/lteCwPageStore'
import { useLteModem } from '../lte/useLteModem'
import { LteAutomationPanel, type AutomationControls } from './LteAutomationPanel'

let controls: AutomationControls | null = null

function Harness() {
  const modem = useLteModem({ pageId: 'lte-cw' })
  return (
    <LteAutomationPanel
      modem={modem} unit="earfcn" bands={[2]}
      onUnitChange={() => {}} onEditBands={() => {}}
      onControlsChange={(c) => { controls = c }}
    />
  )
}

describe('LTE CW automation panel', () => {
  beforeEach(() => {
    controls = null
    lteCwPageSnapshot.automation = {
      rows: [{ earfcn: '18900,19000', power: '20', marginDb: '1' }],
      settleMs: 400,
      results: [],
    }
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('cycles the modem once, then starts, measures and aborts CW per channel', async () => {
    const backend = installFakeBackend({
      'POST /device/lte/modem-off': () => command(),
      'POST /device/lte/modem-on': () => command(),
      'POST /device/lte/cw': () => command(),
      'POST /instruments/measure': (c) => measured(c.query.get('freq_hz') === '1880000000' ? 19.6 : 17),
    })
    renderWithApp(<Harness />)
    await waitFor(() => expect(controls?.canRun).toBe(true))
    expect(controls!.totalPoints).toBe(2)

    act(() => controls!.onRun())
    await waitFor(() => expect(controls?.running).toBe(true))
    await waitFor(() => expect(controls?.running).toBe(false), { timeout: 8000 })

    expect(rigTrace(backend.calls)).toMatchSnapshot()
    expect(lteCwPageSnapshot.automation?.results?.map((r) => [r.earfcn, r.measured_dbm, r.verdict]))
      .toEqual([[18900, 19.6, 'pass'], [19000, 17, 'fail']])
  }, 15000)
})

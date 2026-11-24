// @vitest-environment happy-dom
/**
 * The Full Run page against a fake backend: what it sends the backend's
 * sequence runner, where the run stops to re-cable, what Stop does, and a
 * run picked back up by a page that was closed. What the runner sends the rig
 * is backend/tests/test_sequence_runner.py's business.
 *
 * The BLE radio is a fake `BleLink`, as in the BLE panel's own test: the real
 * one waits out each tone in real time.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend, rigTrace } from '../../testing/fakeBackend'
import { fakeSequence } from '../../testing/fakeSequence'
import { renderWithApp } from '../../testing/renderWithApp'
import { PageActiveContext, ToolbarSlotContext } from '../../ui'
import { fullRunSnapshot, type FullRunStep } from '../../store/fullRunStore'
import type { BleLink } from '../ble/useBleLink'
import { FullRunPage } from './FullRunPage'
import { sequenceToFile } from './sequenceFile'

const bleTrace: string[] = []

vi.mock('../ble/useBleLink', () => ({
  useBleLink: (): BleLink => ({
    phase: { kind: 'idle' } as BleLink['phase'],
    power: null,
    busy: false,
    readPower: async () => null,
    setPower: async (p: number) => { bleTrace.push(`setPower ${p}`); return {} as never },
    ensurePower: async (p: number) => { bleTrace.push(`ensurePower ${p}`); return true },
    tone: async (req: unknown) => {
      bleTrace.push(`tone ${JSON.stringify(req)}`)
      return { acknowledged: false, status: null } as never
    },
    finishTone: async () => { bleTrace.push('finishTone') },
    onAirUntil: () => Date.now() + 60_000,
    forget: () => {},
  }),
}))

const loraCw = (uid: string, power: string): FullRunStep => ({
  uid, testId: 'power',
  settings: { rows: [{ freq: '915', power, paMode: 1, marginDb: '1' }], settleMs: 400 },
})
const bleCw = (uid: string): FullRunStep => ({
  uid, testId: 'ble-cw',
  settings: { rows: [{ channel: '19', power: '31', minDbm: '', maxDbm: '' }], settleMs: 400, toneFixedSeconds: '', unit: 'channel' },
})

function renderPage() {
  const actions = document.createElement('div')
  document.body.appendChild(actions)
  renderWithApp(
    <ToolbarSlotContext.Provider value={{ bar: null, title: null, actions }}>
      <PageActiveContext.Provider value>
        <FullRunPage />
      </PageActiveContext.Provider>
    </ToolbarSlotContext.Provider>,
  )
}

/** The header's Run key, by its label: its accessible name is the tooltip's. */
const runButton = () => {
  const b = [...document.querySelectorAll('button')].find((x) => /Run sequence|Running|Needs|Not ready|Rig busy/.test(x.textContent ?? ''))
  if (!b) throw new Error('no Run key')
  return b
}
const stopButton = () => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Stop')!

describe('Full Run page', () => {
  beforeEach(() => {
    bleTrace.length = 0
    for (const k of Object.keys(fullRunSnapshot)) delete (fullRunSnapshot as Record<string, unknown>)[k]
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('sends the steps in order, each with its own points, and pauses once to re-cable', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), loraCw('b', '20'), bleCw('c')]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence()
    const backend = installFakeBackend(seq.routes)
    renderPage()

    // The plan shows where it will stop to re-cable, before anything runs.
    expect(screen.getAllByText('re-cable from Main')).toHaveLength(1)

    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })

    // The backend runs both LoRa steps, then waits at the cable.
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })
    expect(seq.bodies).toHaveLength(1)
    expect(seq.bodies[0]).toMatchSnapshot()

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cabled — continue' })) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    expect(backend.to('POST', '/sequence/recable').map((c) => c.body)).toEqual([{ seq: 3, ok: true }])
    // Nothing keyed from the page: the backend drives the rig.
    expect(rigTrace(backend.calls)).toEqual([])
    expect(bleTrace).toEqual([])
    expect(fullRunSnapshot.bench).toBe('ble')
    await waitFor(() => expect(Object.fromEntries(Object.entries(fullRunSnapshot.results ?? {})
      .map(([k, r]) => [k, r.outcome.verdict]))).toEqual({ a: 'pass', b: 'fail', c: 'na' }))
    expect(fullRunSnapshot.results?.b?.rows).toHaveLength(1)
  }, 20000)

  it('runs a frequency accuracy step with its stages, and shows its errors in ppm', async () => {
    fullRunSnapshot.steps = [{
      uid: 'f', testId: 'freq-accuracy',
      settings: {
        rows: [{ freq: '902.3,915', power: '14', paMode: 2, tolPpm: '30' }],
        measure: { stages: [{ span_hz: 1_000_000, rbw_hz: 10_000, vbw_hz: 10_000 }], settleMs: '400', stageTolPpm: [''] },
      },
    }]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence({
      measure: (_s, p) => {
        const err = p.freq_mhz === 915 ? 40_000 : 4
        const ppm = err / ((p.freq_mhz as number) * 1e6) * 1e6
        return {
          freqMhz: p.freq_mhz, earfcn: null, power: p.power_dbm, paMode: p.pa_mode, limitPpm: p.limit_ppm,
          stagePpm: [ppm], stageLimits: [null], measuredHz: (p.freq_mhz as number) * 1e6 + err,
          errorHz: err, errorPpm: ppm, levelDbm: -20, note: '',
          verdict: Math.abs(ppm) <= (p.limit_ppm as number) ? 'pass' : 'fail', error: null,
        }
      },
    })
    const up = { connected: true, idn: 'FAKE,1' }
    installFakeBackend({
      ...seq.routes,
      // The zoom needs the analyzer; nothing else.
      'GET /instruments/status': () => ({
        power_sensor: up, dc_analyzer: up, spectrum: up,
        network_analyzer: { connected: false, idn: null }, signal_generator: { connected: false, idn: null },
      }),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.f?.outcome.verdict).toBe('fail'), { timeout: 8000 })

    expect(seq.bodies[0].steps[0]).toMatchObject({
      test: 'freq-accuracy', setup: 'main', settle_ms: 400,
      points: [
        { freq_mhz: 902.3, earfcn: null, power_dbm: 14, pa_mode: 2, limit_ppm: 30 },
        { freq_mhz: 915, earfcn: null, power_dbm: 14, pa_mode: 2, limit_ppm: 30 },
      ],
      freq: { stages: [{ span_hz: 1_000_000, rbw_hz: 10_000, vbw_hz: 10_000 }], stage_limits_ppm: [null] },
    })
    // The step's Results tab reads the page's columns: the error, in Hz and ppm.
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })
    fireEvent.click(screen.getByRole('button', { name: 'Edit step 1', hidden: true }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Results', hidden: true }))
    expect(await screen.findByText('43.7158')).toBeTruthy()
  }, 20000)

  it('offers frequency accuracy under LoRa and LTE in the library', async () => {
    installFakeBackend()
    renderPage()
    expect(screen.getByRole('button', { name: 'Add LoRa frequency accuracy' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add LTE frequency accuracy' }))
    await waitFor(() => expect(fullRunSnapshot.steps?.map((x) => x.testId)).toEqual(['lte-freq-accuracy']))
    // Opened, its Sweep tab is the page's plan table, and Measure its stages.
    fireEvent.click(screen.getByRole('button', { name: 'Edit step 1' }))
    expect(await screen.findByDisplayValue('1880')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Measure' }))
    expect(await screen.findByText('Span')).toBeTruthy()
  }, 20000)

  it('Stop at the re-cable prompt ends the run with the rest not run', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), bleCw('c'), loraCw('d', '14')]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence()
    const backend = installFakeBackend(seq.routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Stop run' })) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    // Grouped by protocol, both LoRa steps are sent before the BLE one.
    expect(seq.bodies[0].steps.map((x) => x.uid)).toEqual(['a', 'd', 'c'])
    expect(backend.to('POST', '/sequence/cancel')).toHaveLength(1)
    await waitFor(() => expect(Object.keys(fullRunSnapshot.results ?? {}).sort()).toEqual(['a', 'd']))
    // The bench did not move.
    expect(fullRunSnapshot.bench).toBe('main')
  }, 20000)

  it('Stop during a step stops the run and runs nothing after it', async () => {
    fullRunSnapshot.steps = [
      { ...loraCw('a', '14'), settings: { rows: [{ freq: '902.3,915', power: '14', paMode: 1, marginDb: '1' }], settleMs: 400 } },
      loraCw('b', '20'),
    ]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence({ stepwise: true })
    const backend = installFakeBackend(seq.routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.a?.rows).toHaveLength(1), { timeout: 8000 })
    act(() => { fireEvent.click(stopButton()) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    expect(backend.to('POST', '/sequence/cancel')).toHaveLength(1)
    expect(seq.status().ended).toBe('stopped')
    expect(fullRunSnapshot.results?.b).toBeUndefined()
  }, 20000)

  it('builds a sequence from the library with repeats, reorders it, and keeps it in the store', async () => {
    installFakeBackend()
    renderPage()
    const add = (label: string) => fireEvent.click(screen.getByRole('button', { name: `Add ${label}` }))

    add('LoRa CW'); add('BLE CW'); add('LoRa CW')
    // + keeps the sequence grouped by setup: the second LoRa CW lands after
    // the first, not after the BLE step, so it costs no re-cable.
    await waitFor(() => expect(fullRunSnapshot.steps?.map((s) => s.testId)).toEqual(['power', 'power', 'ble-cw']))
    // Two copies of one test are two steps, each with its own settings.
    const [first, second] = fullRunSnapshot.steps!
    expect(first.uid).not.toBe(second.uid)
    expect(first.settings).not.toBe(second.settings)

    // ↑ on a step's handle moves it up within its protocol's group...
    const [u1, u2] = fullRunSnapshot.steps!.map((s) => s.uid)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move step 2' }), { key: 'ArrowUp' })
    await waitFor(() => expect(fullRunSnapshot.steps?.slice(0, 2).map((s) => s.uid)).toEqual([u2, u1]))
    // ...but not out of it: the sequence stays grouped by protocol.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move step 3' }), { key: 'ArrowUp' })
    expect(fullRunSnapshot.steps?.map((s) => s.testId)).toEqual(['power', 'power', 'ble-cw'])

    // The row's right-click menu, as on a Mac list.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Edit step 1' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(fullRunSnapshot.steps).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    await waitFor(() => expect(fullRunSnapshot.steps).toHaveLength(3))
  }, 20000)

  it('names, notes, swaps and switches off a step in place', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), loraCw('b', '20')]
    installFakeBackend()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Edit step 2' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Name & test' }))
    const name = await screen.findByPlaceholderText('LoRa CW')
    fireEvent.change(name, { target: { value: 'High power' } })
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'PA hot' } })
    await waitFor(() => expect(fullRunSnapshot.steps?.[1]).toMatchObject({ name: 'High power', note: 'PA hot' }))
    expect(screen.getByRole('listitem', { name: 'Step 2: High power' })).toBeTruthy()

    // Swapping the test keeps the step's place and name, with the new
    // test's settings.
    fireEvent.mouseDown(screen.getAllByRole('combobox').find((e) => e.textContent === 'LoRa CW')!)
    fireEvent.click(await screen.findByRole('option', { name: 'BLE CW' }))
    await waitFor(() => expect(fullRunSnapshot.steps?.map((s) => s.testId)).toEqual(['power', 'ble-cw']))
    expect(fullRunSnapshot.steps?.[1]).toMatchObject({ uid: 'b', name: 'High power' })
    expect(screen.getAllByText('re-cable from Main')).toHaveLength(1)

    // Off: kept in the sequence, left out of the run and its re-cabling.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run step 2' }))
    await waitFor(() => expect(fullRunSnapshot.steps?.[1].enabled).toBe(false))
    expect(screen.queryAllByText('re-cable from Main')).toHaveLength(0)
    expect(screen.getByText('Skipped')).toBeTruthy()
  }, 20000)

  it('leaves a switched-off step out of the run', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), { ...bleCw('c'), enabled: false }]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence()
    installFakeBackend(seq.routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.a?.outcome.verdict).toBe('pass'), { timeout: 8000 })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })
    // Not sent, so no re-cable prompt.
    expect(seq.bodies[0].steps.map((x) => x.uid)).toEqual(['a'])
    expect(screen.queryByText('Re-cable the bench')).toBeNull()
  }, 20000)

  it("shows a failed step's points mid-run without stopping the run", async () => {
    fullRunSnapshot.steps = [
      loraCw('a', '20'),
      { ...loraCw('b', '14'), settings: { rows: [{ freq: '902.3,915,927.5', power: '14', paMode: 1, marginDb: '1' }], settleMs: 400 } },
    ]
    fullRunSnapshot.bench = 'main'
    // Step a asks for 20 dBm and gets 14: a FAIL.
    const seq = fakeSequence({ stepwise: true })
    installFakeBackend(seq.routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })

    // Step a has failed; step b is under way.
    const capsule = await screen.findByRole('button', { name: /1 FAIL.*see the points/ }, { timeout: 8000 })
    expect(seq.status().state).toBe('running')
    act(() => { fireEvent.click(capsule) })

    // Its failed point, with the run still going.
    expect(await screen.findByText(/1 point · 1 failed/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Results', selected: true })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Sweep' }).hasAttribute('disabled')
      || screen.getByRole('tab', { name: 'Sweep' }).getAttribute('aria-disabled') === 'true').toBe(true)
    expect(runButton().textContent).toMatch(/Running/)

    // And the run finishes every step.
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 10000 })
    await waitFor(() => expect(fullRunSnapshot.results?.b?.rows).toHaveLength(3))
  }, 20000)

  it('picks a running sequence back up after the page is closed and reopened', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), bleCw('c')]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence()
    installFakeBackend(seq.routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })

    // The tab goes; the run, parked at its prompt, does not.
    cleanup()
    document.body.innerHTML = ''
    delete fullRunSnapshot.results
    renderPage()

    // The new page finds it on its first poll: the prompt is back, and step
    // a's rows with it.
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })
    await waitFor(() => expect(fullRunSnapshot.results?.a?.outcome.verdict).toBe('pass'))
    expect(runButton().textContent).toMatch(/Running/)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cabled — continue' })) })
    await waitFor(() => expect(seq.status().state).toBe('done'), { timeout: 8000 })
    expect(seq.bodies).toHaveLength(1)
  }, 20000)

  it("leaves a sweep page's own run to that page, and holds Run off meanwhile", async () => {
    fullRunSnapshot.steps = [loraCw('a', '14')]
    fullRunSnapshot.bench = 'main'
    const seq = fakeSequence({ stepwise: true })
    installFakeBackend({ ...seq.routes, 'GET /runs/active': () => ({ run: 'LoRa CW' }) })
    // The LoRa CW page's sweep: a one-step sequence named after the page.
    seq.routes['POST /sequence/run']({
      method: 'POST', path: '/sequence/run', query: new URLSearchParams(),
      body: { bench: 'main', path_loss: { default_db: 0, points: [] }, steps: [{ uid: 'run:power', test: 'power', setup: 'main', label: 'LoRa CW', points: [{ freq_mhz: 915, power_dbm: 14, pa_mode: 1, margin_db: 1 }, { freq_mhz: 915, power_dbm: 14, pa_mode: 1, margin_db: 1 }], settle_ms: 400, power: { source: 'sensor' } }] },
    })
    renderPage()
    await waitFor(() => expect(runButton().textContent).toBe('Rig busy'))
    expect(Object.keys(fullRunSnapshot.results ?? {})).toEqual([])
  }, 20000)

  it('does not look as if it ran when the backend will not start it', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14')]
    fullRunSnapshot.bench = 'main'
    installFakeBackend()
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await new Promise((r) => setTimeout(r, 300))
    expect(runButton().textContent).not.toMatch(/Running/)
    expect(Object.keys(fullRunSnapshot.results ?? {})).toEqual([])
  }, 20000)

  it('keeps + grouped by protocol, in the sidebar order', async () => {
    installFakeBackend()
    renderPage()
    const add = (label: string) => fireEvent.click(screen.getByRole('button', { name: `Add ${label}` }))
    add('BLE CW'); add('LTE CW'); add('LoRa CW'); add('LTE modulated')
    // Double-click adds, as + does.
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Add LoRa modulated' }).closest('[draggable]')!)
    await waitFor(() => expect(fullRunSnapshot.steps?.map((s) => s.testId))
      .toEqual(['power', 'modulated', 'lte-cw', 'lte-modulated', 'ble-cw']))
  }, 20000)

  it('marks the step added last as New, and only that one', async () => {
    installFakeBackend()
    renderPage()
    const add = (label: string) => fireEvent.click(screen.getByRole('button', { name: `Add ${label}` }))
    const isNew = (name: string) => !!within(screen.getByRole('listitem', { name })).queryByRole('img', { name: 'New' })
    add('LoRa CW')
    await waitFor(() => expect(isNew('Step 1: CW')).toBe(true))
    // Another add moves it: the BLE step is now the new one, and only it.
    add('BLE CW')
    await waitFor(() => expect(isNew('Step 2: CW')).toBe(true))
    expect(screen.getAllByRole('img', { name: 'New' })).toHaveLength(1)
    // Opening it is seeing it: it stops being new.
    fireEvent.click(screen.getByRole('button', { name: 'Edit step 2' }))
    await waitFor(() => expect(screen.queryAllByRole('img', { name: 'New' })).toHaveLength(0))
  }, 20000)

  it('loads a saved sequence in place of the current one, and Undo brings it back', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14')]
    installFakeBackend()
    renderPage()
    const text = sequenceToFile([
      { ...loraCw('x', '20'), name: 'High power' },
      bleCw('y'),
    ])
    const input = screen.getByLabelText('Sequence file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([text], 'plan.json', { type: 'application/json' })] } })
    await waitFor(() => expect(fullRunSnapshot.steps?.map((s) => s.testId)).toEqual(['power', 'ble-cw']))
    expect(fullRunSnapshot.steps?.[0]).toMatchObject({ name: 'High power' })
    // Fresh ids: the file's steps are new steps.
    expect(fullRunSnapshot.steps?.map((s) => s.uid)).not.toContain('x')

    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    await waitFor(() => expect(fullRunSnapshot.steps?.map((s) => s.uid)).toEqual(['a']))
  }, 20000)

  it('keeps a step’s result when it is only looked at, and drops it on a real change', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14')]
    fullRunSnapshot.bench = 'main'
    installFakeBackend(fakeSequence().routes)
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.a?.outcome.verdict).toBe('pass'), { timeout: 8000 })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    // The end-of-run summary is a modal; the page behind it is still there.
    // Opening the step mounts its editor, which writes the settings back
    // tidied -- that is not an edit.
    fireEvent.click(screen.getByRole('button', { name: 'Edit step 1', hidden: true }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Measure', hidden: true }))
    fireEvent.click(screen.getByRole('tab', { name: 'Sweep', hidden: true }))
    await new Promise((r) => setTimeout(r, 400))
    expect(fullRunSnapshot.results?.a).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Results', hidden: true }))
    expect(await screen.findByText(/1 point · nothing went wrong/)).toBeTruthy()

    // A real change to what the step does drops the result it no longer
    // describes.
    fireEvent.click(screen.getByRole('tab', { name: 'Sweep', hidden: true }))
    fireEvent.change(await screen.findByDisplayValue('915'), { target: { value: '902.3' } })
    await waitFor(() => expect(fullRunSnapshot.results?.a).toBeUndefined())
  }, 20000)

  it('reopens each step on the tab it was left on', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), loraCw('b', '20')]
    installFakeBackend()
    renderPage()
    const open = (n: number) => fireEvent.click(screen.getByRole('button', { name: `Edit step ${n}` }))
    const selected = () => screen.getByRole('tab', { selected: true }).textContent

    open(1)
    fireEvent.click(await screen.findByRole('tab', { name: 'Measure' }))
    open(2)
    await waitFor(() => expect(selected()).toBe('Sweep'))
    fireEvent.click(screen.getByRole('tab', { name: 'Name & test' }))
    open(1)
    await waitFor(() => expect(selected()).toBe('Measure'))
    open(2)
    await waitFor(() => expect(selected()).toBe('Name & test'))
  }, 20000)
})

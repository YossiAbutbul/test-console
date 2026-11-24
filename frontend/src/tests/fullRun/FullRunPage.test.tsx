// @vitest-environment happy-dom
/**
 * The Full Run page against a fake backend: what a run of several steps sends
 * the DUT and the instruments, in what order, where it stops to re-cable, and
 * what Stop leaves undone.
 *
 * The BLE radio is a fake `BleLink`, as in the BLE panel's own test: the real
 * one waits out each tone in real time.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command, installFakeBackend, measured, rigTrace } from '../../testing/fakeBackend'
import { renderWithApp } from '../../testing/renderWithApp'
import { PageActiveContext, ToolbarSlotContext } from '../../ui'
import { fullRunSnapshot, type FullRunStep } from '../../store/fullRunStore'
import { resetRunLocks } from '../../lib/runLock'
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
  const b = [...document.querySelectorAll('button')].find((x) => /Run sequence|Running|Needs|Not ready/.test(x.textContent ?? ''))
  if (!b) throw new Error('no Run key')
  return b
}
const stopButton = () => [...document.querySelectorAll('button')].find((x) => x.textContent === 'Stop')!

describe('Full Run page', () => {
  beforeEach(() => {
    bleTrace.length = 0
    resetRunLocks()
    for (const k of Object.keys(fullRunSnapshot)) delete (fullRunSnapshot as Record<string, unknown>)[k]
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('runs the steps in order, repeats with their own settings, and pauses once to re-cable', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), loraCw('b', '20'), bleCw('c')]
    fullRunSnapshot.bench = 'main'
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': (c) => measured(c.query.get('freq_hz') === '915000000' ? 14 : 8),
    })
    renderPage()

    // The plan shows where it will stop to re-cable, before anything runs.
    expect(screen.getAllByText('re-cable from Main')).toHaveLength(1)

    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })

    // Both LoRa steps run, then it waits at the cable.
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })
    expect(backend.to('POST', '/device/lora-power').map((c) => (c.body as { power_dbm: number }).power_dbm))
      .toEqual([14, 20])
    expect(bleTrace).toEqual([])

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cabled — continue' })) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    expect(rigTrace(backend.calls)).toMatchSnapshot()
    expect(bleTrace).toMatchSnapshot()
    // Only one prompt: the two LoRa steps share a setup.
    expect(fullRunSnapshot.bench).toBe('ble')
    expect(Object.fromEntries(Object.entries(fullRunSnapshot.results ?? {}).map(([k, r]) => [k, r.outcome.verdict])))
      .toEqual({ a: 'pass', b: 'fail', c: 'na' })
  }, 20000)

  it('Stop at the re-cable prompt ends the run with the rest not run', async () => {
    fullRunSnapshot.steps = [loraCw('a', '14'), bleCw('c'), loraCw('d', '14')]
    fullRunSnapshot.bench = 'main'
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await screen.findByText('Re-cable the bench', undefined, { timeout: 8000 })

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Stop run' })) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    // Grouped by protocol, both LoRa steps run before the BLE one's prompt.
    expect(backend.to('POST', '/device/lora-power')).toHaveLength(2)
    expect(bleTrace).toEqual([])
    expect(Object.keys(fullRunSnapshot.results ?? {}).sort()).toEqual(['a', 'd'])
    // The bench did not move.
    expect(fullRunSnapshot.bench).toBe('main')
  }, 20000)

  it('Stop during a step stops the DUT and runs nothing after it', async () => {
    fullRunSnapshot.steps = [
      { ...loraCw('a', '14'), settings: { rows: [{ freq: '902.3,915', power: '14', paMode: 1, marginDb: '1' }], settleMs: 400 } },
      loraCw('b', '20'),
    ]
    fullRunSnapshot.bench = 'main'
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(backend.to('POST', '/device/lora-power')).toHaveLength(1), { timeout: 8000 })
    act(() => { fireEvent.click(stopButton()) })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })

    expect(backend.to('POST', '/device/lora-power')).toHaveLength(1)
    expect(backend.to('POST', '/device/stop').length).toBeGreaterThanOrEqual(1)
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
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.a?.outcome.verdict).toBe('pass'), { timeout: 8000 })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })
    // No re-cable prompt, nothing sent to the BLE radio.
    expect(screen.queryByText('Re-cable the bench')).toBeNull()
    expect(bleTrace).toEqual([])
    expect(backend.to('POST', '/device/lora-power')).toHaveLength(1)
  }, 20000)

  it("shows a failed step's points mid-run without stopping the run", async () => {
    fullRunSnapshot.steps = [
      loraCw('a', '20'),
      { ...loraCw('b', '14'), settings: { rows: [{ freq: '902.3,915,927.5', power: '14', paMode: 1, marginDb: '1' }], settleMs: 400 } },
    ]
    fullRunSnapshot.bench = 'main'
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      // Step a asks for 20 dBm and gets 14: a FAIL.
      'POST /instruments/measure': () => measured(14),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })

    // Step a has failed; step b is under way.
    const capsule = await screen.findByRole('button', { name: /1 FAIL.*see the points/ }, { timeout: 8000 })
    expect(backend.to('POST', '/device/lora-power').length).toBeLessThan(4)
    act(() => { fireEvent.click(capsule) })

    // Its failed point, with the run still going.
    expect(await screen.findByText(/1 point · 1 failed/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Results', selected: true })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Sweep' }).hasAttribute('disabled')
      || screen.getByRole('tab', { name: 'Sweep' }).getAttribute('aria-disabled') === 'true').toBe(true)
    expect(runButton().textContent).toMatch(/Running/)

    // And the run finishes every step.
    await waitFor(() => expect(backend.to('POST', '/device/lora-power')).toHaveLength(4), { timeout: 8000 })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 8000 })
  }, 20000)

  it('leaves the rig idle at the end: the LTE modem powered off, LoRa stopped', async () => {
    fullRunSnapshot.steps = [
      loraCw('a', '14'),
      {
        uid: 'l', testId: 'lte-cw',
        settings: { rows: [{ earfcn: '18900', power: '20', marginDb: '1' }], settleMs: 400, unit: 'earfcn', bands: [2] },
      },
    ]
    fullRunSnapshot.bench = 'main'
    const backend = installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /device/lte/modem-off': () => command(),
      'POST /device/lte/modem-on': () => command(),
      'POST /device/lte/cw': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
    renderPage()
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false))
    act(() => { fireEvent.click(runButton()) })
    await waitFor(() => expect(fullRunSnapshot.results?.l).toBeTruthy(), { timeout: 15000 })
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(false), { timeout: 15000 })

    // The LTE step leaves the modem on, as the LTE pages do; the sequence's
    // end switches it off, and stops LoRa once more.
    const rig = backend.calls
      .filter((c) => c.method === 'POST' && c.path.startsWith('/device/'))
      .map((c) => c.path)
    expect(rig.slice(-2)).toEqual(['/device/stop', '/device/lte/modem-off'])
  }, 30000)

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
    installFakeBackend({
      'POST /device/lora-power': () => command(),
      'POST /instruments/measure': () => measured(14),
    })
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

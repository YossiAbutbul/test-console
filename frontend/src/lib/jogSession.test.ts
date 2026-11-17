import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let releaseStart: () => void = () => {}

vi.mock('../api/motor', () => ({
  motor: {
    jogStart: vi.fn(() => new Promise<void>((res) => {
      calls.push('start-sent')
      releaseStart = () => { calls.push('start-answered'); res() }
    })),
    jogStop: vi.fn(async () => { calls.push('stop') }),
    jogKeepalive: vi.fn(async () => { calls.push('keepalive') }),
  },
}))

const { startJogSession } = await import('./jogSession')

beforeEach(() => {
  calls.length = 0
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('startJogSession', () => {
  it('sends stop only after its start has answered, however quick the click', async () => {
    const s = startJogSession(true, 800, () => {})
    const stopped = s.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).not.toContain('stop')
    releaseStart()
    await stopped
    expect(calls.indexOf('stop')).toBeGreaterThan(calls.indexOf('start-answered'))
  })

  it('keeps the deadman fed while held, and stops feeding it on release', async () => {
    const s = startJogSession(true, 800, () => {})
    await vi.advanceTimersByTimeAsync(0)
    releaseStart()
    await vi.advanceTimersByTimeAsync(600)
    const beats = calls.filter((c) => c === 'keepalive').length
    expect(beats).toBeGreaterThanOrEqual(2)
    await s.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.filter((c) => c === 'keepalive').length).toBe(beats)
  })

  it('a reversed jog starts only after the previous stop', async () => {
    const first = startJogSession(true, 800, () => {})
    await vi.advanceTimersByTimeAsync(0)
    releaseStart()
    const firstStop = first.stop()
    startJogSession(false, 800, () => {}, firstStop)
    await vi.advanceTimersByTimeAsync(0)
    const order = calls.filter((c) => c !== 'keepalive')
    expect(order).toEqual(['start-sent', 'start-answered', 'stop', 'start-sent'])
  })
})

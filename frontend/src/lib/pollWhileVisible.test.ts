import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollWhileVisible } from './pollWhileVisible'

class FakeDocument {
  hidden = false
  private listeners = new Set<() => void>()
  addEventListener(_: string, fn: () => void) { this.listeners.add(fn) }
  removeEventListener(_: string, fn: () => void) { this.listeners.delete(fn) }
  setHidden(h: boolean) {
    this.hidden = h
    this.listeners.forEach((fn) => fn())
  }
  get listenerCount() { return this.listeners.size }
}

describe('pollWhileVisible', () => {
  let doc: FakeDocument
  beforeEach(() => {
    vi.useFakeTimers()
    doc = new FakeDocument()
    vi.stubGlobal('document', doc)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls every period while visible', () => {
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)
    stop()
  })

  it('skips ticks while hidden and catches up on showing again', () => {
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    doc.setHidden(true)
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
    doc.setHidden(false)
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops and unhooks on cleanup', () => {
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    stop()
    vi.advanceTimersByTime(3000)
    doc.setHidden(false)
    expect(fn).not.toHaveBeenCalled()
    expect(doc.listenerCount).toBe(0)
  })
})

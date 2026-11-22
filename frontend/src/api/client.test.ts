import { afterEach, describe, expect, it, vi } from 'vitest'
import { http } from './client'

function capture() {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{}', { status: 200 })
  })
  return calls
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

describe('http', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends JSON by default when there is a body', async () => {
    const calls = capture()
    await http('/x', { method: 'POST', body: '{}' })
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json')
  })

  it('keeps the default type alongside a caller header', async () => {
    const calls = capture()
    await http('/x', { method: 'POST', body: '{}', headers: { 'X-Trace': '1' } })
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json')
    expect(header(calls[0].init, 'X-Trace')).toBe('1')
  })

  it("lets the caller's own type win", async () => {
    const calls = capture()
    await http('/x', { method: 'POST', body: 'png', headers: { 'Content-Type': 'image/png' } })
    expect(header(calls[0].init, 'Content-Type')).toBe('image/png')
  })

  it('sends no type on a bodiless request', async () => {
    const calls = capture()
    await http('/x')
    expect(header(calls[0].init, 'Content-Type')).toBeNull()
  })
})

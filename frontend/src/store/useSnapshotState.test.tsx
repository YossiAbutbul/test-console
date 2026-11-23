// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSnapshotState } from './useSnapshotState'

describe('useSnapshotState', () => {
  it('starts from the snapshot and writes every change back', () => {
    const snap: { n?: number } = { n: 3 }
    const writes: number[] = []
    const { result } = renderHook(() => useSnapshotState(
      () => snap.n ?? 0,
      (v) => { snap.n = v; writes.push(v) },
    ))
    expect(result.current[0]).toBe(3)
    act(() => result.current[1]((v) => v + 1))
    expect(result.current[0]).toBe(4)
    expect(snap.n).toBe(4)
    // The mount writes too, as the hand-written effects did.
    expect(writes).toEqual([3, 4])
  })

  it('uses the latest save without re-running on its identity', () => {
    const writes: string[] = []
    const { result, rerender } = renderHook(({ tag }) => useSnapshotState(
      () => 'a',
      (v) => { writes.push(`${tag}:${v}`) },
    ), { initialProps: { tag: 'first' } })
    rerender({ tag: 'second' })
    expect(writes).toEqual(['first:a'])
    act(() => result.current[1]('b'))
    expect(writes).toEqual(['first:a', 'second:b'])
  })
})

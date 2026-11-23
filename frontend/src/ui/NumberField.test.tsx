// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { NumberField } from './NumberField'
import { LabeledField } from '../components/LabeledField'

function Harness({ spy, labeled }: { spy: (v: number) => void; labeled?: boolean }) {
  const [v, setV] = useState(20)
  const onChange = (e: { target: { value: string } }) => { const n = Number(e.target.value); spy(n); setV(n) }
  return labeled
    ? <LabeledField label="Power" type="number" value={v} onChange={onChange} />
    : <NumberField value={v} onChange={onChange} />
}

describe.each([false, true])('number field (labeled: %s)', (labeled) => {
  it('can be emptied without a 0 appearing', () => {
    const spy = vi.fn()
    const { container } = render(<Harness spy={spy} labeled={labeled} />)
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(spy).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '5' } })
    expect(input.value).toBe('5')
    expect(spy).toHaveBeenLastCalledWith(5)
  })

  it('puts the last value back when left empty', () => {
    const spy = vi.fn()
    const { container } = render(<Harness spy={spy} labeled={labeled} />)
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('20')
    expect(spy).not.toHaveBeenCalled()
  })
})

it('passes a string-valued field through, empty included', () => {
  const spy = vi.fn()
  const { container } = render(
    <LabeledField label="Y min" type="number" value="" onChange={(e) => spy(e.target.value)} />,
  )
  fireEvent.change(container.querySelector('input')!, { target: { value: '3' } })
  expect(spy).toHaveBeenCalledWith('3')
})

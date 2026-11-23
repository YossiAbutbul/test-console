import { TextField, type TextFieldProps } from '@mui/material'
import { useNumberDraft } from './numberDraft'

/**
 * `<TextField type="number">` that can be emptied while typing.
 *
 * A drop-in: same props, same `onChange(e)`. The difference is only that an
 * empty box no longer reaches `onChange` as 0 -- see `useNumberDraft`.
 */
export function NumberField({ value, onChange, onBlur, ...rest }: Omit<TextFieldProps, 'type'>) {
  const draft = useNumberDraft(value, onChange, onBlur)
  return <TextField {...rest} type="number" value={draft.value} onChange={draft.onChange} onBlur={draft.onBlur} />
}

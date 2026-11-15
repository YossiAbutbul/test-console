/**
 * Words on the paper that edit in place and take formatting: the selected
 * words made bold or coloured from the format bar (FormatBar.tsx), which
 * appears over any of these while it has the cursor.
 *
 * A contenteditable rather than an input, because an input holds one style.
 * It is kept in step with its value only when the two differ: re-setting it
 * on every keystroke would throw the caret back to the start.
 */
import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { fromDom, plain, serialize, toHtml } from './rich'
import { PAPER } from './paperStyle'

export function RichText({
  value, onChange, onBlur, placeholder, multiline, align, sx, label, autoFocus, inline,
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: (v: string) => void
  placeholder?: string
  /** Enter starts a new line; otherwise Enter just leaves the field. */
  multiline?: boolean
  align?: 'left' | 'center'
  sx?: SxProps<Theme>
  /** The accessible name. */
  label?: string
  autoFocus?: boolean
  /** As wide as its words, in a line of other words. */
  inline?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && serialize(fromDom(el)) !== value) el.innerHTML = toHtml(value)
  }, [value])

  useLayoutEffect(() => {
    if (autoFocus) ref.current?.focus()
    // Only on mount: a new empty block takes the cursor once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const read = () => (ref.current ? serialize(fromDom(ref.current)) : value)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (multiline && !e.ctrlKey && !e.metaKey) document.execCommand('insertLineBreak')
      else ref.current?.blur()
      return
    }
    // The format bar's Bold, Italic and Underline, from the keyboard too.
    const cmd = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]
    if ((e.ctrlKey || e.metaKey) && !e.altKey && cmd) {
      e.preventDefault()
      document.execCommand(cmd)
      // The selection did not move, so tell the format bar to look again.
      document.dispatchEvent(new Event('selectionchange'))
    }
  }

  // Words only from the clipboard: another program's fonts and colours do
  // not come in with them. A picture goes on to the page's paste handler.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    document.execCommand('insertText', false, multiline ? text : text.replace(/\s*\n\s*/g, ' '))
  }

  return (
    <Box
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      spellCheck={false}
      data-rich=""
      data-empty={plain(value) ? undefined : ''}
      data-placeholder={placeholder}
      onInput={() => onChange(read())}
      onBlur={() => onBlur?.(read())}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      // Clicks in the words edit them; they must not start a block drag.
      onPointerDown={(e) => e.stopPropagation()}
      sx={{
        ...(sx as object),
        display: inline ? 'inline-block' : 'block',
        minWidth: inline ? '0.5em' : undefined,
        width: inline ? undefined : '100%',
        textAlign: align ?? 'left',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        outline: 'none',
        cursor: 'text',
        borderRadius: '4px',
        mx: -0.5,
        px: 0.5,
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'rgba(0, 113, 227, 0.06)' },
        '&:focus': { bgcolor: 'rgba(0, 113, 227, 0.09)' },
        // An empty field keeps its line, and shows its hint without moving
        // the caret off the start.
        minHeight: '1lh',
        '&[data-empty]::before': {
          content: 'attr(data-placeholder)', color: PAPER.muted, opacity: 0.6, pointerEvents: 'none',
          position: 'absolute', left: 4, right: 4, textAlign: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden',
        },
        '&[data-empty]': { position: 'relative' },
        '&[data-empty] > br': { display: 'none' },
      }}
    />
  )
}

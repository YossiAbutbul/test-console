/**
 * Words on the paper that edit in place and take formatting: the selected
 * words made bold or coloured from the format bar (FormatBar.tsx), which
 * appears over any of these while it has the cursor.
 *
 * A TipTap editor (richEditor.ts) rather than a bare contenteditable: the
 * browser's own editing commands (execCommand) are deprecated, and wrote
 * formatting each browser its own way, which then had to be read back out
 * of the page. Here the words and their formatting are a document the
 * editor owns, turned to and from the stored form (rich.ts) directly.
 *
 * It is set from its value only when the two differ: re-setting it on every
 * keystroke would throw the caret back to the start.
 */
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { Box, type SxProps, type Theme } from '@mui/material'
import { fromDoc, toDoc, type DocNode } from './rich'
import { extensions, RICH_UPDATE } from './richEditor'
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
  // The editor is made once; what it reads of the props, it reads from here.
  const props = useRef({ onChange, onBlur, multiline, placeholder, label })
  useEffect(() => { props.current = { onChange, onBlur, multiline, placeholder, label } })

  const editor = useEditor({
    extensions: extensions(),
    content: toDoc(value),
    autofocus: autoFocus ? 'end' : false,
    // Built in the first render, not after it: a page of fields that each
    // came up a frame late would flicker in.
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => props.current.onChange(fromDoc(editor.getJSON() as DocNode)),
    onBlur: ({ editor }) => props.current.onBlur?.(fromDoc(editor.getJSON() as DocNode)),
    onTransaction: () => document.dispatchEvent(new Event(RICH_UPDATE)),
    editorProps: {
      attributes: (state) => {
        const p = props.current
        const empty = state.doc.textContent === '' && state.doc.firstChild?.childCount === 0
        return {
          'aria-label': p.label ?? '',
          ...(p.multiline ? { 'aria-multiline': 'true' } : {}),
          spellcheck: 'false',
          'data-rich': '',
          'data-placeholder': p.placeholder ?? '',
          ...(empty ? { 'data-empty': '' } : {}),
        }
      },
      handleKeyDown: (view, e) => {
        if (e.key !== 'Enter') return false
        e.preventDefault()
        if (props.current.multiline && !e.ctrlKey && !e.metaKey) {
          const br = view.state.schema.nodes.hardBreak.create()
          view.dispatch(view.state.tr.replaceSelectionWith(br, true).scrollIntoView())
        } else {
          (view.dom as HTMLElement).blur()
        }
        return true
      },
      // Words only from the clipboard: another program's fonts and colours do
      // not come in with them, but the words take the formatting where they
      // land. A picture goes on to the page's paste handler.
      handlePaste: (view, e) => {
        const text = e.clipboardData?.getData('text/plain')
        if (!text) return false
        e.preventDefault()
        insertPlain(view, props.current.multiline ? text : text.replace(/\s*\n\s*/g, ' '))
        return true
      },
    },
  })

  // Kept in step with the value when it changes from outside: an undo of the
  // report, another field's edit of the same words.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (fromDoc(editor.getJSON() as DocNode) === value) return
    editor.commands.setContent(toDoc(value), { emitUpdate: false })
  }, [editor, value])

  // Label and placeholder are attributes of the editor's element: set them
  // again when they change.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.setProps({})
  }, [editor, label, placeholder, multiline])

  return (
    <Box
      // Clicks in the words edit them; they must not start a block drag.
      onPointerDown={(e) => e.stopPropagation()}
      sx={{
        ...(sx as object),
        display: inline ? 'inline-block' : 'block',
        minWidth: inline ? '0.5em' : undefined,
        width: inline ? undefined : '100%',
        textAlign: align ?? 'left',
        borderRadius: '4px',
        mx: -0.5,
        px: 0.5,
        cursor: 'text',
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'rgba(0, 113, 227, 0.06)' },
        '&:focus-within': { bgcolor: 'rgba(0, 113, 227, 0.09)' },
        '& .ProseMirror': {
          outline: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          // An empty field keeps its line, and shows its hint without moving
          // the caret off the start.
          minHeight: '1lh',
          position: 'relative',
        },
        '& .ProseMirror[data-empty]::before': {
          content: 'attr(data-placeholder)', color: PAPER.muted, opacity: 0.6, pointerEvents: 'none',
          position: 'absolute', left: 0, right: 0, textAlign: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden',
        },
      }}
    >
      <EditorContent editor={editor} />
    </Box>
  )
}

/** Plain words in at the cursor, lines as line breaks, in the formatting
 *  the cursor has. */
function insertPlain(view: EditorView, text: string) {
  const { state } = view
  const { schema } = state
  const marks = state.storedMarks ?? state.selection.$from.marks()
  const nodes = text.split(/\r?\n/).flatMap((line, i) => [
    ...(i ? [schema.nodes.hardBreak.create()] : []),
    ...(line ? [schema.text(line, marks)] : []),
  ])
  view.dispatch(state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView())
}

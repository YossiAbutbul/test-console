/**
 * The TipTap side of the formatted words: the editor's schema, and the
 * commands the format bar (FormatBar.tsx) and the keys share. RichText.tsx
 * makes one editor per field.
 *
 * The schema is exactly what the stored form can say (rich.ts): one line of
 * words with line breaks, and bold, not-bold, italic, underline and colour.
 * Anything richer pasted or dropped in is cut down to that on the way.
 */
import { Mark, Node, mergeAttributes, type Editor, type TiptapEditorHTMLElement } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { UndoRedo } from '@tiptap/extensions'

/** The editor of an editable element (TipTap keeps it on the element): the
 *  format bar acts on whichever one has the cursor. */
export const editorOf = (el: HTMLElement) => (el as TiptapEditorHTMLElement).editor ?? null

/** The format bar's cue to look again: the editor's state changed without
 *  the page's selection moving (Ctrl+B, an undo). */
export const RICH_UPDATE = 'rich-update'

/** One line of words. A div, not a <p>: these fields sit inside the page's
 *  own paragraphs and table cells. */
const Line = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML: () => [{ tag: 'p' }, { tag: 'div' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes), 0],
})

/** Explicitly not bold -- a word in a heading taken out of its bold. Stored
 *  as <span style="font-weight:400">. */
const Weight = Mark.create({
  name: 'weight',
  excludes: 'bold',
  parseHTML: () => [{ style: 'font-weight', getAttrs: (v) => (/^(normal|lighter|[1-5]\d\d)$/.test(String(v)) ? null : false) }],
  renderHTML: () => ['span', { style: 'font-weight:400' }, 0],
})

/** Is the place itself bold -- a heading, a table's head -- before any
 *  formatting? Read from the field, which takes the place's weight. */
function boldPlace(editor: Editor) {
  return Number(getComputedStyle(editor.view.dom).fontWeight) >= 600
}

/** Bold as you see it: a word is bold by its own mark, or by the place it
 *  is in unless taken out of it. */
export function isBold(editor: Editor) {
  if (editor.isActive('weight')) return false
  return editor.isActive('bold') || boldPlace(editor)
}

/** Bold on or off as you see it: in a bold place, off is "not bold". */
export function toggleBold(editor: Editor) {
  const place = boldPlace(editor)
  const chain = editor.chain().focus().unsetMark('weight').unsetMark('bold')
  if (isBold(editor)) {
    if (place) chain.setMark('weight')
  } else if (!place) {
    chain.setMark('bold')
  }
  return chain.run()
}

export function extensions() {
  return [
    Document.extend({ content: 'paragraph' }),
    Line,
    Text,
    // A value may hold a line break wherever it was typed; which fields take
    // a new one from Enter is RichText's call, so no keys of its own.
    HardBreak.extend({ addKeyboardShortcuts: () => ({}) }),
    Bold.extend({
      addKeyboardShortcuts() {
        return { 'Mod-b': () => toggleBold(this.editor), 'Mod-B': () => toggleBold(this.editor) }
      },
    }),
    Weight,
    Italic,
    Underline,
    TextStyle,
    Color,
    UndoRedo,
  ]
}

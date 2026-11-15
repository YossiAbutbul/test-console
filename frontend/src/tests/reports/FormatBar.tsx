/**
 * The format bar: floats over the words being edited, anywhere on the
 * report, for as long as one of them has the cursor. Bold, italic, underline
 * and a text colour act on the selected words (or on what is typed next); in
 * a table, the row's fill colours the whole row.
 *
 * Compact, as the system's own text bars are: the styles, then one key for
 * the text colour and one for the row fill, each showing its colour and
 * opening a small panel of swatches away from the words, then Clear.
 *
 * Nothing in it takes the focus (pointer-down is cancelled), so the words
 * stay selected while they are formatted.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, ButtonBase, Portal, Tooltip, Typography } from '@mui/material'
import BoldIcon from '@mui/icons-material/FormatBoldRounded'
import ItalicIcon from '@mui/icons-material/FormatItalicRounded'
import UnderlineIcon from '@mui/icons-material/FormatUnderlinedRounded'
import ClearIcon from '@mui/icons-material/FormatClearRounded'
import FillIcon from '@mui/icons-material/FormatColorFillRounded'
import ChevronIcon from '@mui/icons-material/ExpandMoreRounded'

/** Text colours: the inks, the report's navy and blues, Office's standard
 *  colours, and the report's own pass green. */
const TEXT_COLORS: Array<[string, string]> = [
  ['#000000', 'Black'], ['#595959', 'Dark grey'], ['#002060', 'Navy'], ['#4472C4', 'Blue'],
  ['#00B0F0', 'Light blue'], ['#7030A0', 'Purple'],
  ['#C00000', 'Red'], ['#ED7D31', 'Orange'], ['#FFC000', 'Gold'], ['#00B050', 'Green'],
  ['#1E7F3C', 'Pass green'], ['#7F7F7F', 'Grey'],
]
/** Row fills: Office's light tints, the report's header blue first. */
const ROW_FILLS: Array<[string, string]> = [
  ['#D9E2F3', 'Blue'], ['#E2EFDA', 'Green'], ['#FFF2CC', 'Yellow'],
  ['#FCE4D6', 'Orange'], ['#FBE9E9', 'Red'], ['#EDEDED', 'Grey'],
]

const INK = '#1D1D1F'
const ACCENT = '#0071E3'
const MATERIAL = {
  bgcolor: 'rgba(250, 250, 252, 0.86)',
  backdropFilter: 'blur(20px) saturate(180%)',
  border: '0.5px solid rgba(0, 0, 0, 0.12)',
  '@media (prefers-reduced-transparency: reduce)': { bgcolor: '#FAFAFC', backdropFilter: 'none' },
} as const

interface Target {
  /** The field being edited. */
  el: HTMLElement
  /** Where to stand: over the selection, or the field when nothing is selected. */
  rect: DOMRect
  bold: boolean
  italic: boolean
  underline: boolean
  color: string | null
  row: null | { blockId: string; key: string }
}

function rgbHex(c: string): string | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase() : null
}

function read(): Target | null {
  const sel = document.getSelection()
  const node = sel?.anchorNode
  const at = node instanceof HTMLElement ? node : node?.parentElement
  const el = at?.closest<HTMLElement>('[data-rich]')
  if (!el || !sel || document.activeElement !== el) return null
  // Over the selected words; with only a caret, over the whole field, so the
  // bar never hides the lines being typed.
  let rect = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).getBoundingClientRect() : null
  if (!rect || (rect.width === 0 && rect.height === 0)) rect = el.getBoundingClientRect()
  const tr = el.closest<HTMLElement>('tr[data-fill-key]')
  const block = el.closest<HTMLElement>('[data-block-id]')
  return {
    el, rect,
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    color: rgbHex(String(document.queryCommandValue('foreColor'))),
    row: tr && block ? { blockId: block.dataset.blockId!, key: tr.dataset.fillKey! } : null,
  }
}

const BAR_H = 34

export function FormatBar({ fillOf, onFill }: {
  /** A table row's fill now: a colour, 'none', or '' for the row's own. */
  fillOf: (blockId: string, key: string) => string
  /** A table row's fill: a colour, 'none' for no fill, '' for the row's own. */
  onFill: (blockId: string, key: string, color: string) => void
}) {
  const [t, setT] = useState<Target | null>(null)
  const [panel, setPanel] = useState<null | 'text' | 'fill'>(null)
  // While the system colour picker is open the field loses the focus; the
  // selection is kept here to give back to it.
  const saved = useRef<{ el: HTMLElement; range: Range } | null>(null)
  const [picking, setPicking] = useState(false)
  const field = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let raf = 0
    let late = 0
    const look = () => {
      const next = read()
      // The system colour picker has the focus: keep the bar as it was.
      if (!next && picking) return
      // Another field, or none: the swatch panel closes with it.
      if (next?.el !== field.current) setPanel(null)
      field.current = next?.el ?? null
      setT(next)
    }
    const update = () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(late)
      raf = requestAnimationFrame(look)
      // Once more when the page has settled: right after a formatting
      // command Chrome can still report the state from before it.
      late = window.setTimeout(look, 120)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    document.addEventListener('input', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(late)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
      document.removeEventListener('input', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [picking])

  if (!t) return null

  const act = (fn: () => void) => () => {
    fn()
    setT(read())
  }
  const setColor = (c: string) => {
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand('foreColor', false, c)
  }
  const pick = (c: string) => act(() => { setColor(c); setPanel(null) })

  const row = t.row
  const fill = row ? fillOf(row.blockId, row.key).toUpperCase() : ''
  const width = row ? 262 : 222
  const center = t.rect.left + t.rect.width / 2
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, center - width / 2))
  const above = t.rect.top - BAR_H - 8 > 72
  const top = above ? t.rect.top - BAR_H - 8 : t.rect.bottom + 8

  return (
    <Portal>
      <Box
        role="toolbar"
        aria-label="Format"
        // Never the focus: the words stay selected.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        sx={{
          position: 'fixed', top, left, zIndex: 1400, height: BAR_H,
          display: 'flex', alignItems: 'center', gap: '1px', px: '3px',
          borderRadius: '10px', ...MATERIAL,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.13), 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0.5px 0 rgba(255, 255, 255, 0.7)',
          transformOrigin: above ? '50% 100%' : '50% 0%',
          animation: 'fmtIn 150ms cubic-bezier(0.2, 0.9, 0.3, 1)',
          '@keyframes fmtIn': { from: { opacity: 0, transform: 'scale(0.96)' }, to: { opacity: 1, transform: 'none' } },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Key label="Bold (Ctrl+B)" on={t.bold} onClick={act(() => document.execCommand('bold'))}>
          <BoldIcon sx={{ fontSize: 18 }} />
        </Key>
        <Key label="Italic (Ctrl+I)" on={t.italic} onClick={act(() => document.execCommand('italic'))}>
          <ItalicIcon sx={{ fontSize: 18 }} />
        </Key>
        <Key label="Underline (Ctrl+U)" on={t.underline} onClick={act(() => document.execCommand('underline'))}>
          <UnderlineIcon sx={{ fontSize: 18 }} />
        </Key>
        <Sep />
        <Key label="Text colour" wide on={panel === 'text'} expanded={panel === 'text'}
          onClick={() => setPanel(panel === 'text' ? null : 'text')}>
          <Glyph bar={t.color ?? '#000000'}>
            <Typography component="span" sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: INK }}>A</Typography>
          </Glyph>
          <ChevronIcon sx={{ fontSize: 14, color: '#8E8E93', ml: '-1px' }} />
        </Key>
        {row && (
          <Key label="Row fill" wide on={panel === 'fill'} expanded={panel === 'fill'}
            onClick={() => setPanel(panel === 'fill' ? null : 'fill')}>
            <Glyph bar={fill && fill !== 'NONE' ? fill : null}>
              <FillIcon sx={{ fontSize: 16, color: INK }} />
            </Glyph>
            <ChevronIcon sx={{ fontSize: 14, color: '#8E8E93', ml: '-1px' }} />
          </Key>
        )}
        <Sep />
        <Key label="Clear formatting" onClick={act(() => document.execCommand('removeFormat'))}>
          <ClearIcon sx={{ fontSize: 17 }} />
        </Key>

        {panel && (
          // Opens away from the words: up when the bar is above them.
          <Box sx={{
            position: 'absolute', left: 0, zIndex: 1,
            ...(above ? { bottom: `calc(100% + 6px)` } : { top: `calc(100% + 6px)` }),
            width: 222, p: 0.75, borderRadius: '12px', ...MATERIAL,
            // Over a busy page a lighter glass loses its words: this one is
            // nearly solid.
            bgcolor: 'rgba(252, 252, 253, 0.97)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08)',
            transformOrigin: above ? '20% 100%' : '20% 0%',
            animation: 'fmtPanel 150ms cubic-bezier(0.2, 0.9, 0.3, 1)',
            '@keyframes fmtPanel': { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'none' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}>
            {panel === 'text' ? (
              <>
                <Option label="Automatic" on={!t.color || t.color === '#000000'}
                  swatch={<Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#000' }} />}
                  onClick={pick('inherit')} />
                <Grid>
                  {TEXT_COLORS.map(([c, name]) => (
                    <Swatch key={c} color={c} label={name} on={t.color === c} onClick={pick(c)} />
                  ))}
                </Grid>
                <Box component="label"
                  onPointerDown={() => {
                    const sel = document.getSelection()
                    if (sel?.rangeCount) saved.current = { el: t.el, range: sel.getRangeAt(0).cloneRange() }
                    setPicking(true)
                  }}
                  sx={{
                    position: 'relative', display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, px: 0.75, height: 28,
                    borderRadius: '7px', cursor: 'pointer', fontSize: 12.5, color: INK,
                    '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.05)' },
                  }}>
                  <Box sx={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: 'conic-gradient(#FF3B30, #FFCC00, #34C759, #00C7BE, #007AFF, #AF52DE, #FF2D55, #FF3B30)',
                  }} />
                  Other colour…
                  <input type="color" aria-label="Other text colour"
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                    onChange={(e) => {
                      const s = saved.current
                      if (!s) return
                      s.el.focus()
                      const sel = document.getSelection()
                      sel?.removeAllRanges()
                      sel?.addRange(s.range)
                      setColor(e.target.value)
                      if (sel?.rangeCount) saved.current = { el: s.el, range: sel.getRangeAt(0).cloneRange() }
                    }}
                    onBlur={() => { setPicking(false); setPanel(null) }} />
                </Box>
              </>
            ) : row && (
              <>
                <Option label="Automatic" hint="table's own" on={!fill}
                  swatch={<Box sx={{ width: 14, height: 14, borderRadius: '4px', background: 'linear-gradient(135deg, #D9E2F3 50%, #FBE9E9 50%)', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.2)' }} />}
                  onClick={act(() => { onFill(row.blockId, row.key, ''); setPanel(null) })} />
                <Option label="No fill" on={fill === 'NONE'}
                  swatch={<Box sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: '#FFF', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.3)', background: 'linear-gradient(to top right, #fff calc(50% - 0.75px), #FF3B30 50%, #fff calc(50% + 0.75px))' }} />}
                  onClick={act(() => { onFill(row.blockId, row.key, 'none'); setPanel(null) })} />
                <Grid>
                  {ROW_FILLS.map(([c, name]) => (
                    <Swatch key={c} color={c} label={name} square on={fill === c}
                      onClick={act(() => { onFill(row.blockId, row.key, c); setPanel(null) })} />
                  ))}
                </Grid>
              </>
            )}
          </Box>
        )}
      </Box>
    </Portal>
  )
}

function Sep() {
  return <Box sx={{ width: '1px', height: 18, mx: '3px', bgcolor: 'rgba(0, 0, 0, 0.1)', flexShrink: 0 }} />
}

function Key({ label, on, onClick, children, wide, expanded }: {
  label: string; on?: boolean; onClick: () => void; children: ReactNode; wide?: boolean; expanded?: boolean
}) {
  return (
    <Tooltip title={expanded ? '' : label} placement="top" disableInteractive enterDelay={400}>
      <ButtonBase aria-label={label} aria-pressed={expanded === undefined ? on : undefined}
        aria-expanded={expanded} onClick={onClick} disableRipple sx={{
          height: 28, minWidth: 28, px: wide ? '5px' : 0, borderRadius: '7px', flexShrink: 0,
          color: on ? ACCENT : INK,
          bgcolor: on ? 'rgba(0, 113, 227, 0.12)' : 'transparent',
          transition: 'background-color 120ms ease, transform 100ms ease',
          '&:hover': { bgcolor: on ? 'rgba(0, 113, 227, 0.16)' : 'rgba(0, 0, 0, 0.06)' },
          '&:active': { transform: 'scale(0.92)' },
        }}>
        {children}
      </ButtonBase>
    </Tooltip>
  )
}

/** A key's glyph with its colour as a bar under it, as Pages and Word show it. */
function Glyph({ bar, children }: { bar: string | null; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: '2px', width: 18 }}>
      {children}
      <Box sx={{
        width: 16, height: 3.5, borderRadius: '2px', bgcolor: bar ?? 'transparent',
        boxShadow: bar ? 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.18)' : 'inset 0 0 0 0.75px rgba(0, 0, 0, 0.3)',
      }} />
    </Box>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', mt: 0.5, px: '2px' }}>{children}</Box>
}

function Option({ label, hint, on, swatch, onClick }: {
  label: string; hint?: string; on: boolean; swatch: ReactNode; onClick: () => void
}) {
  return (
    <ButtonBase onClick={onClick} disableRipple aria-pressed={on} sx={{
      width: '100%', justifyContent: 'flex-start', gap: 1, px: 0.75, height: 28, borderRadius: '7px',
      fontSize: 12.5, color: INK, bgcolor: on ? 'rgba(0, 113, 227, 0.1)' : 'transparent',
      '&:hover': { bgcolor: on ? 'rgba(0, 113, 227, 0.14)' : 'rgba(0, 0, 0, 0.05)' },
    }}>
      {swatch}
      <span>{label}</span>
      {hint && <Box component="span" sx={{ color: '#8E8E93', fontSize: 11.5, ml: 'auto', whiteSpace: 'nowrap' }}>{hint}</Box>}
    </ButtonBase>
  )
}

function Swatch({ color, label, on, onClick, square }: {
  color: string; label: string; on: boolean; onClick: () => void; square?: boolean
}) {
  return (
    <Tooltip title={label} placement="top" disableInteractive enterDelay={400}>
      <ButtonBase aria-label={label} aria-pressed={on} onClick={onClick} disableRipple sx={{
        width: 30, height: 30, borderRadius: '8px', justifySelf: 'center',
        transition: 'transform 100ms ease, background-color 120ms ease',
        '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.05)' },
        '&:active': { transform: 'scale(0.88)' },
      }}>
        <Box sx={{
          width: 20, height: 20, borderRadius: square ? '5px' : '50%', bgcolor: color,
          // The chosen one: a ring clear of the colour, in the accent.
          boxShadow: on
            ? `0 0 0 2px #FAFAFC, 0 0 0 3.5px ${ACCENT}`
            : 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.2)',
          transition: 'box-shadow 140ms ease',
        }} />
      </ButtonBase>
    </Tooltip>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, ClickAwayListener, InputBase, Stack, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { testRegistry } from '../tests/registry'

interface Props {
  activeId: string
  onSelect: (id: string) => void
}

interface Hit {
  kind: 'page'
  id: string
  label: string
  group?: string
}

export function SearchBar({ activeId, onSelect }: Props) {
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const isFocused = document.activeElement === inputRef.current
        if (isFocused || open) {
          setOpen(false)
          inputRef.current?.blur()
        } else {
          setOpen(true)
          inputRef.current?.focus()
          inputRef.current?.select()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase()
    const all: Hit[] = testRegistry.map((m) => ({
      kind: 'page',
      id: m.id,
      label: m.label,
      group: m.group,
    }))
    if (!needle) return all
    return all.filter((h) => {
      const hay = `${h.group ?? ''} ${h.label}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [q])

  useEffect(() => { setCursor(0) }, [q])

  const pick = (h: Hit) => {
    onSelect(h.id)
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return }
    if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); pick(hits[cursor]); return }
  }

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box sx={{ position: 'relative', width: 'min(420px, 50%)' }}>
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            height: 32,
            px: 1.25,
            gap: 1,
            bgcolor: p.sidebar.bg,
            border: `1px solid ${p.appBarBorder}`,
            borderRadius: 1,
            color: p.sidebar.textDim,
            '&:focus-within': { borderColor: p.sidebar.border },
          }}
        >
          <SearchIcon sx={{ fontSize: 16 }} />
          <InputBase
            inputRef={inputRef}
            placeholder="Search pages"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            sx={{
              flexGrow: 1,
              fontSize: 13,
              color: p.sidebar.text,
              '& input::placeholder': { color: p.sidebar.textDim, opacity: 1 },
            }}
          />
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
            <Box
              component="kbd"
              sx={{
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                px: 0.75,
                py: 0.1,
                minWidth: 22,
                textAlign: 'center',
                color: p.sidebar.textDim,
                bgcolor: p.sidebar.bg,
                border: `1px solid ${p.appBarBorder}`,
                borderRadius: 0.75,
                boxShadow: `0 1px 0 ${p.appBarBorder}`,
                lineHeight: 1.4,
              }}
            >
              Ctrl
            </Box>
            <Box component="span" sx={{ fontSize: 11, color: p.sidebar.textDim }}>+</Box>
            <Box
              component="kbd"
              sx={{
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                px: 0.75,
                py: 0.1,
                minWidth: 18,
                textAlign: 'center',
                color: p.sidebar.textDim,
                bgcolor: p.sidebar.bg,
                border: `1px solid ${p.appBarBorder}`,
                borderRadius: 0.75,
                boxShadow: `0 1px 0 ${p.appBarBorder}`,
                lineHeight: 1.4,
              }}
            >
              K
            </Box>
          </Stack>
        </Stack>
        {open && (
          <Box
            sx={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              bgcolor: p.sidebar.bg,
              border: `1px solid ${p.sidebar.border}`,
              borderRadius: 1,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              maxHeight: 360,
              overflowY: 'auto',
              zIndex: 1400,
            }}
          >
            <Typography sx={{ px: 1.5, pt: 1, pb: 0.5, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: p.sidebar.textDim }}>
              Pages
            </Typography>
            {hits.length === 0 && (
              <Box sx={{ px: 1.5, py: 1, fontSize: 12, color: p.sidebar.textDim }}>
                No matches
              </Box>
            )}
            {hits.map((h, i) => {
              const sel = i === cursor
              const isCur = h.id === activeId
              return (
                <Stack
                  key={h.id}
                  direction="row"
                  alignItems="center"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(h)}
                  sx={{
                    px: 1.5, py: 0.85,
                    cursor: 'pointer',
                    bgcolor: sel ? p.sidebar.accentSoft : 'transparent',
                    color: p.sidebar.text,
                    gap: 1,
                  }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: isCur ? 600 : 500, flexGrow: 1 }}>
                    {h.label}
                  </Typography>
                  {h.group && (
                    <Typography sx={{ fontSize: 11, color: p.sidebar.textDim }}>
                      {h.group}
                    </Typography>
                  )}
                </Stack>
              )
            })}
          </Box>
        )}
      </Box>
    </ClickAwayListener>
  )
}

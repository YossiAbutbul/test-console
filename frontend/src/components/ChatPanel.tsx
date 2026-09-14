import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box, Checkbox, Chip, CircularProgress, Divider, IconButton, LinearProgress,
  MenuItem, Popover, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import SendIcon from '@mui/icons-material/Send'
import { useChat, type PageSource } from '../context/ChatContext'
import { detex } from '../lib/chatText'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'

/**
 * The assistant, docked beside the log.
 *
 * What it sends is deliberately visible: the chips above the input are exactly
 * what travels with the question, and either can be switched off. A panel that
 * quietly attached the wrong run's results would produce answers that look
 * right and are about something else.
 */

const ACCEPT = '.xlsx,.xlsm,.csv,.tsv'

/** One picker row. Four are visible and the rest scroll, enough to read the
 *  list without the popover covering the conversation behind it. */
const PICK_ROW_H = 34
const PICK_VISIBLE_ROWS = 4

/** 1234 -> "1.2k". Four digits of tokens tells nobody anything the rounded
 *  figure does not, and the counter has one line to say it in. */
function short(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

/**
 * What is left of the free tier: questions, and the per-minute token ceiling.
 *
 * Both are shown because they run out for different reasons: the question
 * count goes down one at a time, the token budget goes down by however wide
 * the table was. On the free tier it is usually the tokens that bite first,
 * which is not obvious until it happens, hence the bar.
 */
function QuotaWidget() {
  const { status, quota } = useChat()
  if (!status) return null
  if (!status.configured) {
    return (
      <Typography sx={{ fontSize: 11.5, color: 'warning.main' }}>
        No API key on this machine. See README, "Assistant".
      </Typography>
    )
  }
  if (!quota) return null
  const {
    day_remaining, day_limit, minute_remaining, minute_limit,
    token_limit_minute, tokens_minute, tokens_remaining_minute, tokens_day,
  } = quota
  const lowDay = day_remaining <= Math.max(5, day_limit * 0.1)
  const waiting = Math.ceil(quota.retry_after_s)
  // Fills from the right as budget is spent: a full bar is a full minute's
  // allowance. Drawing the spend instead leaves the bar empty whenever the
  // rig has been quiet for a minute, which reads as a broken widget rather
  // than as "nothing to worry about".
  const pct = token_limit_minute
    ? Math.max(0, Math.min(100, (tokens_remaining_minute / token_limit_minute) * 100))
    : 0
  const lowTokens = pct <= 20
  // The dock is narrow and the operator can drag it narrower. Everything here
  // is one short line that does not wrap: the model name and the exact figures
  // live in the tooltip, where there is room for them.
  return (
    <Stack spacing={0.35} sx={{ width: '100%', minWidth: 0 }}>
      {/* While something is refusing, the counters are not the headline: a
          budget of "8/8 this minute" beside a refused question is the widget
          telling the operator something it cannot know. Only this backend's
          own spend is visible to it, and anything else using the same key
          shows up as Google's refusal and nothing else. */}
      {waiting > 0 ? (
        <Tooltip
          title={
            quota.blocked_upstream
              ? 'Google refused the last question for quota. Its counter is not '
                + 'this one: another program, or another machine, can be spending '
                + 'the same key.'
              : 'The local budget for this minute is spent. It refills as the '
                + 'window rolls.'
          }
        >
          <Typography noWrap sx={{ fontSize: 11.5, color: 'warning.main' }}>
            {quota.blocked_upstream ? 'Google rate-limited' : 'Local limit reached'}
            {', retry in '}{waiting} s
          </Typography>
        </Tooltip>
      ) : (
        <Tooltip title={`Model: ${status.model}`}>
          <Typography
            noWrap
            sx={{ fontSize: 11.5, color: lowDay ? 'warning.main' : 'text.secondary' }}
          >
            {day_remaining}/{day_limit} today · {minute_remaining}/{minute_limit} this min
          </Typography>
        </Tooltip>
      )}
      {token_limit_minute > 0 && (
        <Tooltip
          title={
            `${tokens_minute.toLocaleString()} of ${token_limit_minute.toLocaleString()} tokens `
            + `used in the last minute · ${tokens_day.toLocaleString()} today · ${status.model}. `
            + 'Tokens are charged once an answer comes back, so a long question '
            + 'is never refused; the next one waits for the window to clear. '
            + 'Counted from what this backend spent; Google keeps its own tally.'
          }
        >
          <Stack spacing={0.25}>
            <LinearProgress
              variant="determinate"
              value={pct}
              color={lowTokens ? 'warning' : 'inherit'}
              sx={{ height: 3, borderRadius: 2, opacity: 0.75 }}
            />
            <Typography noWrap sx={{ fontSize: 10.5, color: lowTokens ? 'warning.main' : 'text.disabled' }}>
              {short(tokens_remaining_minute)} tokens left
              {tokens_day > 0 && ` · ${short(tokens_day)} today`}
            </Typography>
          </Stack>
        </Tooltip>
      )}
    </Stack>
  )
}

/**
 * The small amount of markdown the model actually emits, rendered.
 *
 * It bolds figures ("**30.5087 dBm**") and opens lines with "* " or "- "
 * whatever the prompt asks, and a chat that prints the asterisks reads worse
 * than one with no formatting at all. This handles bold, inline `code` and
 * leading bullets. Deliberately not a markdown parser, because anything it
 * does not recognise must come out as the plain text the model wrote rather
 * than disappear.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Split on **bold** and `code`, keeping the delimiters' contents.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|[_^]\{[^{}]+\})/g)
  parts.forEach((part, i) => {
    if (!part) return
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>)
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(
        <Box
          key={key}
          component="code"
          sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.92em' }}
        >
          {part.slice(1, -1)}
        </Box>,
      )
    } else if (/^[_^]\{[^{}]+\}$/.test(part)) {
      // V_{DC} and the like, left behind by detex. Braced only: a bare
      // underscore belongs to a column name (power_dbm) and stays text.
      const body = part.slice(2, -1)
      out.push(
        part[0] === '_'
          ? <Box key={key} component="sub" sx={{ fontSize: '0.8em' }}>{body}</Box>
          : <Box key={key} component="sup" sx={{ fontSize: '0.8em' }}>{body}</Box>,
      )
    } else {
      out.push(<span key={key}>{part}</span>)
    }
  })
  return out
}

function Markdownish({ text }: { text: string }) {
  return (
    <>
      {text.split(/\r?\n/).map((line, i) => {
        const bullet = /^\s*[*-]\s+/.exec(line)
        if (bullet) {
          return (
            <Box key={i} sx={{ display: 'flex', gap: 0.75, pl: 0.5 }}>
              <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
              <Box component="span" sx={{ flex: 1 }}>
                {inline(line.slice(bullet[0].length), String(i))}
              </Box>
            </Box>
          )
        }
        // A blank line is a paragraph break and has to keep its height.
        if (!line.trim()) return <Box key={i} sx={{ height: '0.5em' }} />
        return <Box key={i}>{inline(line, String(i))}</Box>
      })}
    </>
  )
}

function Turn({ role, content, error, ts }: { role: string; content: string; error?: boolean; ts: string }) {
  const mine = role === 'user'
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const [copied, setCopied] = useState(false)
  // Held in a variable because the copy button borrows it: a button in its own
  // colour reads as something sitting on the message rather than part of it.
  const bubbleBg = error
    ? 'rgba(211,47,47,0.12)'
    : mine ? p.sidebar.accentSoft : 'background.paper'

  // The raw text, not the rendered version: a figure pasted into a report
  // should carry the model's own characters.
  const copy = () => {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      },
      () => { /* clipboard blocked; the tick simply does not appear */ },
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        mb: 1,
        // The button only exists on hover, so it never sits between the eye
        // and the numbers.
        '&:hover .turn-copy': { opacity: 1 },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          maxWidth: '92%',
          px: 1.25,
          py: 0.85,
          borderRadius: 1.5,
          bgcolor: bubbleBg,
          border: `1px solid ${p.appBarBorder}`,
          color: error ? 'error.main' : 'text.primary',
        }}
      >
        <Typography
          component="div"
          sx={{
            fontSize: 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            // Your own text is shown exactly as typed, line breaks included,
            // and asterisks as asterisks. Only the model's side is rendered.
            whiteSpace: mine ? 'pre-wrap' : 'normal',
          }}
        >
          {mine ? content : <Markdownish text={detex(content)} />}
        </Typography>
        <Typography sx={{ fontSize: 10, color: 'text.disabled', mt: 0.25, pr: 2.5 }}>{ts}</Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <IconButton
            className="turn-copy"
            size="small"
            onClick={copy}
            sx={{
              position: 'absolute',
              bottom: 2,
              right: 2,
              p: 0.25,
              opacity: 0,
              transition: 'opacity 0.12s',
              bgcolor: bubbleBg,
              '&:hover': { bgcolor: bubbleBg },
            }}
          >
            {copied
              ? <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} />
              : <ContentCopyIcon sx={{ fontSize: 13 }} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}

export function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    turns, busy, ask, attach, attachments, removeAttachment, toggleAttachment,
    clear, pages, readPages, selectedPages, setSelectedPages, effectivePages,
    quota,
  } = useChat()
  // Seconds until Gemini will take another question. Comes from the backend's
  // counter, which knows both our own budget and the wait Google asked for.
  const coolingS = Math.ceil(quota?.retry_after_s ?? 0)
  const [pageMenu, setPageMenu] = useState<HTMLElement | null>(null)
  // Snapshotted when the picker opens, so the row counts shown are the ones
  // that were true at that moment rather than at the last render.
  const [menuPages, setMenuPages] = useState<PageSource[]>([])
  const [draft, setDraft] = useState('')
  const [attachError, setAttachError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, busy])

  const send = () => {
    const q = draft.trim()
    if (!q || busy || coolingS > 0) return
    setDraft('')
    void ask(q)
  }

  const activePage = pages.find((p) => p.active) ?? null

  /** Ticking a page switches off "follow the page I'm on": an explicit pick
   *  has to stay picked when you navigate, or it was not a pick. */
  const togglePage = (label: string) => {
    const current = effectivePages
    const next = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label]
    setSelectedPages(next)
  }

  const pageChipLabel = (() => {
    if (effectivePages.length === 0) return 'No page attached'
    if (selectedPages === null) return `This page (${activePage?.label ?? 'none'})`
    if (effectivePages.length === 1) return effectivePages[0]
    return `${effectivePages.length} pages`
  })()

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setAttachError(null)
    try {
      await attach(file)
    } catch (e) {
      setAttachError((e as Error).message.replace(/^HTTP \d+: /, ''))
    }
  }

  return (
    <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={1}
        sx={{ flexShrink: 0, mb: 0.5, minWidth: 0, '& > :first-of-type': { minWidth: 0 } }}
      >
        {embedded ? <QuotaWidget /> : <Typography variant="h6">Assistant</Typography>}
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={`Attach results (${ACCEPT})`}>
            <span>
              <IconButton size="small" onClick={() => fileRef.current?.click()}>
                <AttachFileIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear conversation">
            <span>
              <IconButton size="small" onClick={clear} disabled={turns.length === 0}>
                <DeleteOutlineIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          void onPick(e.target.files?.[0])
          e.target.value = '' // so the same file can be re-attached after a change
        }}
      />

      {/* The only part that gives: everything else below is flexShrink 0, so a
          growing draft eats into the transcript rather than squashing the
          chips row into the input on top of it. */}
      <Box sx={{ flex: '1 1 0', minHeight: 40, overflowY: 'auto', pr: 0.5 }}>
        {turns.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 1 }}>
            Ask about the results on this page: "where does the power flatten out?",
            "which points look wrong?". Or attach an exported workbook.
          </Typography>
        )}
        {turns.map((t, i) => (
          <Turn key={i} role={t.role} content={t.content} error={t.error} ts={t.ts} />
        ))}
        {busy && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
            <CircularProgress size={13} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Reading the numbers…</Typography>
          </Stack>
        )}
        <div ref={endRef} />
      </Box>

      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 0.5, py: 0.75 }}>
        <Tooltip title="Choose which pages' results go with the question">
          <Chip
            size="small"
            icon={<LayersOutlinedIcon sx={{ fontSize: 14 }} />}
            label={pageChipLabel}
            variant={effectivePages.length ? 'filled' : 'outlined'}
            onClick={(e) => { setMenuPages(readPages()); setPageMenu(e.currentTarget) }}
            // The delete cross appears only on an explicit pick, where it
            // means "go back to following the page I'm on". On the default it
            // would have nothing to undo.
            onDelete={selectedPages === null ? undefined : () => setSelectedPages(null)}
            deleteIcon={<CloseIcon sx={{ fontSize: 13 }} />}
            sx={{ fontSize: 11, height: 22, maxWidth: '100%', '& .MuiChip-icon': { ml: 0.6 } }}
          />
        </Tooltip>
        {attachments.map((a) => (
          <Chip
            key={a.id}
            size="small"
            icon={<DescriptionOutlinedIcon sx={{ fontSize: 14 }} />}
            label={`${a.name} · ${Math.round(a.chars / 100) / 10}k`}
            variant={a.enabled ? 'filled' : 'outlined'}
            onClick={() => toggleAttachment(a.id)}
            onDelete={() => removeAttachment(a.id)}
            deleteIcon={<CloseIcon sx={{ fontSize: 13 }} />}
            sx={{ fontSize: 11, height: 22, maxWidth: '100%', '& .MuiChip-icon': { ml: 0.6 } }}
          />
        ))}
      </Stack>
      {/* Opens upward: the chip sits one row above the input at the bottom of
          the dock, so a menu dropping down would be off-screen. */}
      <Popover
        anchorEl={pageMenu}
        open={pageMenu !== null}
        onClose={() => setPageMenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 264, mb: 0.75, overflow: 'hidden' } } }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ pl: 1.5, pr: 0.5, py: 0.5 }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, opacity: 0.7 }}>
            RESULTS TO ATTACH
          </Typography>
          <IconButton size="small" onClick={() => setPageMenu(null)}>
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Stack>
        <Divider />

        <MenuItem
          dense
          onClick={() => { setSelectedPages(null); setPageMenu(null) }}
          sx={{ minHeight: PICK_ROW_H, height: PICK_ROW_H }}
        >
          <Checkbox size="small" checked={selectedPages === null} sx={{ p: 0.25, mr: 0.75 }} />
          <Typography sx={{ fontSize: 12.5, flex: 1 }}>Follow the page I&apos;m on</Typography>
          <Typography noWrap sx={{ fontSize: 11, color: 'text.disabled', maxWidth: 96 }}>
            {activePage ? activePage.label : 'none'}
          </Typography>
        </MenuItem>
        <Divider />

        <Box sx={{ maxHeight: PICK_ROW_H * PICK_VISIBLE_ROWS, overflowY: 'auto' }}>
          {menuPages.length === 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 1.5, py: 1 }}>
              No page is holding results yet.
            </Typography>
          )}
          {menuPages.map((p) => {
            const on = effectivePages.includes(p.label)
            return (
              <MenuItem
                key={p.label}
                dense
                selected={on}
                onClick={() => togglePage(p.label)}
                sx={{ minHeight: PICK_ROW_H, height: PICK_ROW_H }}
              >
                <Checkbox size="small" checked={on} sx={{ p: 0.25, mr: 0.75 }} />
                <Typography noWrap sx={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>
                  {p.label}
                </Typography>
                {/* The row count, not just the name: two pages can both be a
                    sweep, and the count is what says which holds the run. */}
                <Typography
                  noWrap
                  sx={{ fontSize: 11, color: p.rows ? 'text.secondary' : 'text.disabled' }}
                >
                  {p.rows ? `${p.rows} rows` : 'empty'}
                </Typography>
              </MenuItem>
            )
          })}
        </Box>
      </Popover>

      {attachError && (
        <Typography sx={{ fontSize: 11.5, color: 'error.main', pb: 0.5 }}>{attachError}</Typography>
      )}

      <Stack direction="row" spacing={0.75} alignItems="flex-end" sx={{ flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={coolingS > 0 ? `Rate limited, ${coolingS} s` : 'Ask about these results…'}
          disabled={coolingS > 0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. The questions are one
            // or two lines and reaching for a button every time gets old.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          // Nothing but the font size. The wrapper has to keep MUI's own
          // alignment and overflow: `alignItems: flex-start` on it stops the
          // textarea stretching it, so the wrapper stays one row tall while
          // the textarea grows to four and hangs outside, which with the row
          // aligned to flex-end paints upward over the chips. maxRows
          // already caps the growth; MUI handles the scrolling past it.
          slotProps={{ input: { sx: { fontSize: 13 } } }}
        />
        <IconButton size="small" onClick={send} disabled={busy || coolingS > 0 || !draft.trim()}>
          <SendIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>
      {!embedded && <QuotaWidget />}
    </Stack>
  )
}

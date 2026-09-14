import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef,
  useState, type ReactNode,
} from 'react'
import {
  askChat, attachFile, getChatStatus,
  type ChatContextBlock, type ChatQuota, type ChatStatus,
} from '../api/chat'
import { ApiError } from '../api/client'

/**
 * State for the assistant panel.
 *
 * Two things worth knowing about the shape:
 *
 * 1. Pages publish their results through `useChatSource` rather than the panel
 *    reaching into them. Every page stays mounted (see TestArea), so every page
 *    with results is registered all the time and the picker can offer a run you
 *    have navigated away from. What travels is only what is selected.
 * 2. What a page publishes is pulled *at send time*, not stored. A run that is
 *    still going would otherwise be answered from whatever the table held when
 *    the panel last rendered.
 */

const STORAGE_KEY = 'chat-messages-v1'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** Set on an assistant turn that failed; rendered as an error, not an answer. */
  error?: boolean
  ts: string
}

export interface Attachment {
  id: string
  name: string
  /** Backend-made compact text. This, not the file, is what gets sent. */
  digest: string
  chars: number
  /** Unticked attachments stay in the list but cost nothing. */
  enabled: boolean
}

type SourceFn = () => ChatContextBlock | ChatContextBlock[] | null

/** A page offering its results, as the picker lists it. */
export interface PageSource {
  /** Short page name, as the sidebar spells it. Also the registry key. */
  label: string
  /** True for the page currently on screen. */
  active: boolean
  /** Rows it would contribute right now. 0 means it has nothing to say yet. */
  rows: number
}

interface ChatCtx {
  /** False until the backend says the assistant is switched on. The dock
   *  shows no Assistant tab at all while this is false. */
  available: boolean
  turns: ChatTurn[]
  busy: boolean
  status: ChatStatus | null
  quota: ChatQuota | null
  attachments: Attachment[]
  /** Every registered page, and which one is on screen. */
  pages: { label: string; active: boolean }[]
  /**
   * The same list with a live row count each. A function rather than a value
   * because counting means calling into the pages, which may only happen in an
   * event handler, and because a count read when the picker opens is the
   * only one that is true: a run in progress changes it between renders.
   */
  readPages: () => PageSource[]
  /**
   * Which pages the next question carries. `null` means "whichever page is on
   * screen", which is what it does until someone picks explicitly. Navigating
   * then moves the context with you instead of silently keeping the old
   * page's table attached.
   */
  selectedPages: string[] | null
  setSelectedPages: (labels: string[] | null) => void
  /** The labels that would actually be sent right now, picked or implied. */
  effectivePages: string[]
  ask: (question: string) => Promise<void>
  attach: (file: File) => Promise<void>
  removeAttachment: (id: string) => void
  toggleAttachment: (id: string) => void
  clear: () => void
  registerSource: (label: string, active: boolean, fn: SourceFn) => () => void
}

const Ctx = createContext<ChatCtx | null>(null)

/** Turns kept on screen and in storage. The backend trims what it sends on. */
const MAX_TURNS = 60

/** How often the quota counter re-reads. Slow enough to be invisible, fast
 *  enough that a backend restart repairs the panel on its own. */
const STATUS_POLL_MS = 20_000

/** While a rate-limit window is closed, so the countdown stays honest. */
const COOLDOWN_POLL_MS = 2_000

/** While the feature is switched off. Slow, but not never: turning it on
 *  should not need a page reload to be noticed. */
const OFF_POLL_MS = 60_000

function now(): string {
  return new Date().toLocaleTimeString([], { hour12: false })
}

function asBlocks(v: ChatContextBlock | ChatContextBlock[] | null): ChatContextBlock[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as ChatTurn[]) : []
    } catch {
      return []
    }
  })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [quota, setQuota] = useState<ChatQuota | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedPages, setSelectedPages] = useState<string[] | null>(null)
  const sources = useRef(new Map<string, { active: boolean; fn: SourceFn }>())
  // Mirrored into state so the picker re-renders when a page registers or the
  // active one changes. The map itself stays a ref: it is read at send time,
  // not at render time, and its entries close over live page state.
  const [pageList, setPageList] = useState<{ label: string; active: boolean }[]>([])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns))
    } catch {
      /* quota / private mode */
    }
  }, [turns])

  // Polled, not read once. A single read at mount is wrong in the one case
  // that actually happens on this rig: the backend is restarted while the app
  // stays open, the read lands on the dead (or still-booting) process, and the
  // counter then stays blank forever with no way back short of a reload.
  // It costs nothing: /chat/status is local and never touches Gemini.
  const cooling = (quota?.retry_after_s ?? 0) > 0
  // Once the backend says the feature is off there is nothing to watch. One
  // slow poll stays, so switching it on shows up without a page reload.
  const off = status?.enabled === false
  useEffect(() => {
    let alive = true
    const read = () => {
      getChatStatus()
        .then((s) => { if (alive) { setStatus(s); setQuota(s.quota) } })
        .catch(() => { /* backend down or restarting; the next tick retries */ })
    }
    read()
    // Faster while a window is closed, so the countdown the panel shows is
    // roughly true and the send button comes back when it actually can.
    const period = off ? OFF_POLL_MS : cooling ? COOLDOWN_POLL_MS : STATUS_POLL_MS
    const timer = setInterval(read, period)
    return () => { alive = false; clearInterval(timer) }
  }, [cooling, off])

  const publish = useCallback(() => {
    setPageList(
      [...sources.current.entries()].map(([label, v]) => ({ label, active: v.active })),
    )
  }, [])

  const registerSource = useCallback((label: string, active: boolean, fn: SourceFn) => {
    sources.current.set(label, { active, fn })
    publish()
    return () => {
      // Drop the entry only if it is still ours. A re-register from the same
      // page, whose `active` flipped as you navigated, has already replaced
      // it, and deleting then would take the live one with it.
      if (sources.current.get(label)?.fn === fn) {
        sources.current.delete(label)
        publish()
      }
    }
  }, [publish])

  const blocksFor = useCallback((labels: string[]): ChatContextBlock[] => {
    const out: ChatContextBlock[] = []
    for (const label of labels) {
      const src = sources.current.get(label)
      if (!src) continue
      try {
        out.push(...asBlocks(src.fn()))
      } catch {
        // A page mid-render must not be able to break the send.
      }
    }
    return out.filter((b) => (b.rows?.length ?? 0) > 0 || !!b.text)
  }, [])

  const activeLabel = useMemo(
    () => pageList.find((p) => p.active)?.label ?? null,
    [pageList],
  )

  const effectivePages = useMemo(
    () => selectedPages ?? (activeLabel ? [activeLabel] : []),
    [activeLabel, selectedPages],
  )

  const readPages = useCallback((): PageSource[] => pageList.map(({ label, active }) => {
    let rows = 0
    try {
      for (const b of asBlocks(sources.current.get(label)?.fn() ?? null)) {
        rows += b.rows?.length ?? 0
      }
    } catch { /* a page that throws counts as empty */ }
    return { label, active, rows }
  }), [pageList])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    const context: ChatContextBlock[] = [
      ...blocksFor(effectivePages),
      ...attachments.filter((a) => a.enabled).map((a) => ({ title: a.name, text: a.digest })),
    ]
    // History goes up before the answer so the user sees their own line land.
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }))
    setTurns((prev) => [...prev, { role: 'user' as const, content: q, ts: now() }].slice(-MAX_TURNS))
    setBusy(true)
    try {
      const res = await askChat({ question: q, history, context })
      setQuota(res.quota)
      setTurns((prev) => [...prev, { role: 'assistant' as const, content: res.reply, ts: now() }].slice(-MAX_TURNS))
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : (e as Error).message
      setTurns((prev) => [...prev, { role: 'assistant' as const, content: msg, error: true, ts: now() }].slice(-MAX_TURNS))
      // A 429 carries the refreshed counters in its message only, so re-read
      // the real ones rather than guessing what is left.
      getChatStatus().then((s) => { setStatus(s); setQuota(s.quota) }).catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [attachments, blocksFor, busy, effectivePages, turns])

  const attach = useCallback(async (file: File) => {
    const res = await attachFile(file)
    setAttachments((prev) => [
      ...prev.filter((a) => a.name !== res.filename),
      { id: `${res.filename}-${Date.now()}`, name: res.filename, digest: res.digest, chars: res.chars, enabled: true },
    ])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const toggleAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)))
  }, [])

  const clear = useCallback(() => {
    setTurns([])
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const value = useMemo<ChatCtx>(() => ({
    available: status?.enabled === true,
    turns, busy, status, quota, attachments, pages: pageList, readPages,
    selectedPages, setSelectedPages, effectivePages, ask, attach,
    removeAttachment, toggleAttachment, clear, registerSource,
  }), [
    ask, attach, attachments, busy, clear, effectivePages, pageList, quota,
    readPages, registerSource, removeAttachment, selectedPages, status,
    toggleAttachment, turns,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChat(): ChatCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be inside ChatProvider')
  return v
}

/**
 * Publish this page's results to the assistant.
 *
 * `source` is read at send time, so it may close over live state and be passed
 * as a fresh inline closure on every render: the latest one is kept in a ref
 * and the registration itself never churns.
 *
 * `label` is the page's name as the sidebar spells it: it keys the picker, so
 * it must be unique and recognisable. `active` comes from TestPageProps and
 * decides only which page is attached by default. Every page stays registered
 * either way, so a run you have navigated away from can still be asked about.
 */
export function useChatSource(label: string, active: boolean, source: SourceFn): void {
  const { registerSource } = useChat()
  const latest = useRef(source)
  // Assigned in an effect rather than during render: the source is only ever
  // invoked on send, which is well after the commit that updated it.
  useEffect(() => { latest.current = source })
  useEffect(
    () => registerSource(label, active, () => latest.current()),
    [active, label, registerSource],
  )
}

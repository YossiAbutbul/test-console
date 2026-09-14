import { http } from './client'

/**
 * The assistant panel's backend.
 *
 * The Gemini key never reaches the browser and neither does the rate limit:
 * one key means one shared free-tier budget, so the counter that matters is
 * the backend's. `quota` comes back on every answer so the panel can show
 * what is left without a second round-trip.
 */

export interface ChatQuota {
  minute_limit: number
  minute_remaining: number
  day_limit: number
  day_remaining: number
  /**
   * Per-minute token ceiling, and what has been spent against it. Tokens are
   * charged after an answer comes back, so a question that overshoots is
   * not refused; the next one waits. 0 means no ceiling is configured.
   */
  token_limit_minute: number
  tokens_minute: number
  tokens_remaining_minute: number
  /** Cumulative for the day. Informational: the day limit is on requests. */
  tokens_day: number
  /** Seconds until the next question is allowed. 0 when one is allowed now. */
  retry_after_s: number
  day_resets_in_s: number
  /**
   * True when the wait is Google's rather than ours. The two are separate
   * counters: this one can only see what this backend spent, so anything else
   * using the same key is invisible to it and shows up only as a refusal.
   */
  blocked_upstream: boolean
}

export interface ChatStatus {
  /** False when there is no API key. The panel says so rather than failing on send. */
  configured: boolean
  model: string
  quota: ChatQuota
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Something the assistant may look at. Either `rows` (a page's live results,
 * sent as records and compacted by the backend) or `text` (the digest of an
 * attached file, which the backend produced earlier; handing it back is far
 * cheaper than re-uploading and re-parsing the workbook on every follow-up).
 */
export interface ChatContextBlock {
  title: string
  rows?: Record<string, unknown>[]
  columns?: string[]
  text?: string
}

export interface AskResponse {
  reply: string
  model: string
  prompt_tokens: number
  output_tokens: number
  quota: ChatQuota
}

export interface AttachResponse {
  filename: string
  /** Compact text the model reads. Kept client-side and re-sent as context. */
  digest: string
  chars: number
}

export function getChatStatus(): Promise<ChatStatus> {
  // `no-store`, because this one is uncacheable in a way the browser cannot
  // know: when the route is missing (backend not restarted yet, or a dev
  // server without the /chat proxy rule) the SPA fallback answers 200 with
  // index.html, and the browser then serves that HTML from cache for the rest
  // of the session. The panel's counter stays blank long after the backend is
  // fixed, with nothing in the network tab to say why.
  return http<ChatStatus>('/chat/status', { cache: 'no-store' })
}

export function askChat(body: {
  question: string
  history: ChatMessage[]
  context: ChatContextBlock[]
}): Promise<AskResponse> {
  return http<AskResponse>('/chat/ask', { method: 'POST', body: JSON.stringify(body) })
}

/** Read a File as base64. The backend takes uploads in JSON, not multipart. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const result = String(reader.result)
      // strip the "data:<type>;base64," prefix
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

export async function attachFile(file: File): Promise<AttachResponse> {
  const content_b64 = await toBase64(file)
  return http<AttachResponse>('/chat/attach', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content_b64 }),
  })
}

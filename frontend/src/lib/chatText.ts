/**
 * LaTeX out of the assistant's answers.
 *
 * Ask a model about efficiency and it writes maths the way a paper does,
 * `$$\text{PAE} = \frac{P_{out} - P_{in}}{V_{DC} \times I_{DC}}$$`, which in a
 * plain chat panel is unreadable. The prompt asks for plain formulas; this is
 * the net under it, because one instruction in a system prompt is not a
 * guarantee and a wall of backslashes is worse than no formula at all.
 *
 * Deliberately not a LaTeX engine. It handles what actually turns up in
 * answers about RF measurements (fractions, subscripts, the handful of
 * operators and Greek letters) and anything it does not recognise keeps its
 * text and loses only the backslash. Nothing is ever dropped: a formula that
 * comes out slightly clumsy is recoverable, one with a missing term is not.
 *
 * Subscripts and superscripts survive as `_{...}` / `^{...}` for the renderer
 * to turn into <sub>/<sup>; everything else here is plain text.
 */

/** Commands carrying no meaning of their own: sizing and spacing hints. They
 *  have to vanish rather than fall through to the "keep the name as text" rule,
 *  which is what renders \left( as the word "left(". */
const DROP = new Set([
  'left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big',
  'displaystyle', 'textstyle', 'limits', 'nolimits', '!',
])

/** Operators and symbols, spelled as the instruments' own units would be. */
const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  approx: '≈', neq: '≠', leq: '≤', geq: '≥', le: '≤', ge: '≥',
  ll: '≪', gg: '≫', propto: '∝', infty: '∞',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε',
  eta: 'η', theta: 'θ', lambda: 'λ', mu: 'µ', pi: 'π', rho: 'ρ',
  sigma: 'σ', phi: 'φ', omega: 'ω', Omega: 'Ω',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒',
  ldots: '…', dots: '…', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '%': '%',
}

/** Matches a `{...}` group starting at `from`, honouring nesting. */
function group(src: string, from: number): { body: string; end: number } | null {
  if (src[from] !== '{') return null
  let depth = 0
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { body: src.slice(from + 1, i), end: i + 1 }
    }
  }
  return null // unbalanced, so the caller leaves the text alone
}

/** `\frac{a}{b}` -> `(a) / (b)`, innermost first so nested fractions work.
 *  Parentheses are kept even on single terms: `P/V × I` reads as a different
 *  formula from `P/(V × I)`, and that difference is the whole answer. */
function fractions(s: string): string {
  let out = s
  for (let guard = 0; guard < 12; guard++) {
    const at = out.lastIndexOf('\\frac')
    if (at < 0) break
    const num = group(out, at + 5)
    if (!num) break
    const den = group(out, num.end)
    if (!den) break
    const wrap = (b: string) => (/^[\w.]+$/.test(b.trim()) ? b.trim() : `(${b.trim()})`)
    out = out.slice(0, at) + `${wrap(num.body)} / ${wrap(den.body)}` + out.slice(den.end)
  }
  return out
}

function sqrt(s: string): string {
  let out = s
  for (let guard = 0; guard < 12; guard++) {
    const at = out.lastIndexOf('\\sqrt')
    if (at < 0) break
    const arg = group(out, at + 5)
    if (!arg) break
    out = `${out.slice(0, at)}√(${arg.body.trim()})${out.slice(arg.end)}`
  }
  return out
}

/** `\text{...}`, `\mathrm{...}` and friends: keep the contents, drop the wrapper. */
function unwrap(s: string): string {
  let out = s
  for (const cmd of ['text', 'mathrm', 'mathbf', 'textbf', 'operatorname', 'mathit']) {
    for (let guard = 0; guard < 20; guard++) {
      const at = out.indexOf(`\\${cmd}{`)
      if (at < 0) break
      const arg = group(out, at + cmd.length + 1)
      if (!arg) break
      out = out.slice(0, at) + arg.body + out.slice(arg.end)
    }
  }
  return out
}

export function detex(input: string): string {
  // Nothing that looks like maths? Leave it completely alone. The common
  // case is prose, and prose must not be walked through a rewriter.
  if (!/[\\$]/.test(input)) return input

  let s = input
  // Delimiters first. `$$...$$` is a display block and becomes its own line;
  // `$...$` is inline and just loses the dollars. A lone `$` (a price, a shell
  // prompt) is left alone by requiring a closing partner.
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body) => `\n${String(body).trim()}\n`)
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, body) => String(body).trim())

  s = unwrap(s)
  s = fractions(s)
  s = sqrt(s)

  // Characters LaTeX escapes. The model writes power\_dbm for a column really
  // called power_dbm, and the backslash must not survive into a name the
  // operator might paste back into a search box.
  s = s.replace(/\\([_{}&#%$])/g, '$1')

  // `\times` and the rest. Longest-match on the name stops `\to` from eating
  // the start of `\theta`.
  s = s.replace(/\\([A-Za-z]+|[,;%!])/g, (_m, name: string) => {
    if (DROP.has(name)) return ''
    const sym = SYMBOLS[name]
    if (sym !== undefined) return sym
    // Unknown command: keep its name as text rather than deleting a term.
    return name
  })

  // Unbraced `_x` is deliberately NOT normalised into `_{x}`. Every column in
  // this app is snake_case (power_dbm, current_a, pos_mm) and a rule that
  // turned a single underscore into a subscript would rewrite the column
  // names the answer is quoting. Braced subscripts are what LaTeX actually emits.

  // LaTeX line break. The surrounding spaces go with it, or the line arrives
  // with a trailing space and the next one starts indented.
  s = s.replace(/[ \t]*\\\\[ \t]*/g, '\n')
  s = s.replace(/[ \t]{2,}/g, ' ')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

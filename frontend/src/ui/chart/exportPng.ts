/**
 * Save a rendered Recharts chart as a PNG.
 *
 * Serialises the chart's SVG, draws it onto a canvas and downloads the result.
 * Three things the naive version got wrong, each of which shaped this:
 *
 *  - The background was hardcoded white. On the mid and dark themes the axis
 *    text is light, so the export came out as pale grey on white. The caller
 *    passes the background of the surface the chart is actually drawn on.
 *  - Recharts renders its legend as HTML *beside* the SVG, so it never made it
 *    into the image — a multi-series graph exported with no way to tell the
 *    lines apart. The caller passes the legend and it is drawn onto the canvas.
 *  - Text in a serialised SVG loses the page's CSS, so it fell back to a serif
 *    face. The computed font family is inlined on the clone.
 */

export interface LegendItem {
  label: string
  color: string
}

export interface ExportPngOptions {
  filename: string
  /** Fill behind the chart — the colour of the surface it sits on. */
  background: string
  /** Colour for the drawn legend's text. */
  textColor: string
  /** Series to name in the image. Empty or omitted draws no legend. */
  legend?: LegendItem[]
}

// 2× upscale so the export stays crisp when pasted into a report.
const SCALE = 2
const LEGEND_FONT_PX = 12
const LEGEND_ROW_H = 20
const LEGEND_PAD = 8
const SWATCH_W = 16
const ITEM_GAP = 18

interface LegendLayout {
  rows: { items: LegendItem[]; width: number }[]
  height: number
}

/** Wrap legend entries into right-aligned rows no wider than the chart, the
 *  way the on-screen legend sits top-right. */
function layoutLegend(
  ctx: CanvasRenderingContext2D, items: LegendItem[], maxWidth: number,
): LegendLayout {
  const rows: LegendLayout['rows'] = []
  let cur: LegendItem[] = []
  let curW = 0
  for (const it of items) {
    const w = SWATCH_W + 6 + ctx.measureText(it.label).width
    const add = cur.length === 0 ? w : ITEM_GAP + w
    if (cur.length > 0 && curW + add > maxWidth - 2 * LEGEND_PAD) {
      rows.push({ items: cur, width: curW })
      cur = [it]
      curW = w
    } else {
      cur.push(it)
      curW += add
    }
  }
  if (cur.length) rows.push({ items: cur, width: curW })
  return { rows, height: rows.length ? rows.length * LEGEND_ROW_H + LEGEND_PAD : 0 }
}

/** Find the chart's SVG inside `root`, render it to PNG and download it. */
export async function downloadChartPng(
  root: HTMLElement | null, opts: ExportPngOptions,
): Promise<void> {
  // The first svg is the chart surface; Recharts' legend icons are later,
  // smaller svgs inside the HTML legend.
  const svg = root?.querySelector<SVGSVGElement>('svg.recharts-surface')
    ?? root?.querySelector<SVGSVGElement>('svg')
  if (!svg) return
  const w = svg.clientWidth || 1000
  const h = svg.clientHeight || 600
  const font = getComputedStyle(svg).fontFamily || 'sans-serif'

  // Clone so we can inline width/height (some browsers need explicit dims)
  // without disturbing the live chart.
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.style.fontFamily = font
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('svg image load failed'))
      el.src = url
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d ctx unavailable')
    const legendFont = `${LEGEND_FONT_PX}px ${font}`
    ctx.font = legendFont
    const legend = layoutLegend(ctx, opts.legend ?? [], w)

    // Resizing a canvas resets its context state, so size first, then style.
    canvas.width = w * SCALE
    canvas.height = (h + legend.height) * SCALE
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, w, h + legend.height)

    ctx.font = legendFont
    ctx.textBaseline = 'middle'
    legend.rows.forEach((row, i) => {
      let x = w - LEGEND_PAD - row.width
      const y = LEGEND_PAD + i * LEGEND_ROW_H + LEGEND_ROW_H / 2
      for (const it of row.items) {
        ctx.fillStyle = it.color
        ctx.fillRect(x, y - 1.5, SWATCH_W, 3)
        x += SWATCH_W + 6
        ctx.fillStyle = opts.textColor
        ctx.fillText(it.label, x, y)
        x += ctx.measureText(it.label).width + ITEM_GAP
      }
    })
    ctx.drawImage(img, 0, legend.height)

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png')
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(png)
    a.download = opts.filename
    a.click()
    URL.revokeObjectURL(a.href)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Filesystem-safe UTC timestamp suffix, e.g. `2026-10-18T11-51-29`. */
export function fileTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

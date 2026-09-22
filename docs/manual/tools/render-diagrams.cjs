/**
 * Renders every ```mermaid block in source/*.md to img/diagram-<n>.png, in
 * document order, so the Word build can embed them (Word cannot draw mermaid).
 * The build script replaces the n-th mermaid block with the n-th image, so
 * keep the two in step by re-running this after editing a diagram.
 *
 * Usage: node docs\manual\tools\render-diagrams.cjs   (NODE_PATH as for the
 * other tools; needs network access to cdn.jsdelivr.net for mermaid itself).
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'source')
const OUT = path.join(ROOT, 'img')

function diagrams() {
  const out = []
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8')
    for (const m of text.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) out.push(m[1])
  }
  return out
}

;(async () => {
  const list = diagrams()
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } })
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="d"></div></body></html>')
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' })
  await page.evaluate(() => window.mermaid.initialize({
    startOnLoad: false, theme: 'neutral',
    themeVariables: { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: '15px' },
    flowchart: { htmlLabels: true, curve: 'basis' },
  }))
  for (let i = 0; i < list.length; i++) {
    await page.evaluate(async ({ src, id }) => {
      const { svg } = await window.mermaid.render(id, src)
      document.getElementById('d').innerHTML = `<div style="display:inline-block;padding:16px;background:#fff">${svg}</div>`
    }, { src: list[i], id: `m${i}` })
    const file = path.join(OUT, `diagram-${i + 1}.png`)
    await page.locator('#d > div').screenshot({ path: file })
    console.log('ok  ', path.basename(file))
  }
  await browser.close()
})()

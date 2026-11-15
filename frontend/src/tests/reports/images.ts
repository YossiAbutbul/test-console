/**
 * Pictures for a report, made ready for the Word file before they are sent.
 *
 * Word embeds PNG and JPEG (and GIF/BMP), so anything else -- a WebP from a
 * browser, an AVIF -- is redrawn as PNG. A screenshot from a 4K screen or a
 * phone photo is scaled to 2400 px on its long side: printed at most 26 cm
 * wide, more only makes the .docx heavier.
 */
const MAX_SIDE = 2400

export async function prepareImage(f: Blob): Promise<Blob> {
  const native = f.type === 'image/png' || f.type === 'image/jpeg'
  const bmp = await createImageBitmap(f)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  if (native && scale === 1) {
    bmp.close()
    return f
  }
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  // A photo stays a JPEG; everything else (screenshots, diagrams) is PNG,
  // which keeps text and lines sharp.
  const type = f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the picture'))), type, 0.9)
  })
}

/** The pictures in a paste or a drop, files first, then clipboard items. */
export function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const files = [...dt.files].filter((f) => f.type.startsWith('image/'))
  if (files.length) return files
  return [...dt.items]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f)
}

/** Whether a drag carries files, before they can be read (dragover). */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && [...dt.types].includes('Files')
}

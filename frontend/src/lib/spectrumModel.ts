/**
 * Which spectrum analyzer a row is about. Two are supported by the one driver
 * (backend/spectrum/): the R&S FSC3 over LAN ("172.16.10.1:5555") and the
 * R&S FSV3004 over GPIB through a USB adapter ("GPIB0::20::INSTR"). The
 * address decides the link, as `is_visa_address` in backend/spectrum/link.py
 * does; the IDN, once connected, names the model.
 */

export function isVisaAddress(address: string | null | undefined): boolean {
  return (address ?? '').includes('::')
}

/** "R&S FSV3004" from the IDN when connected, else a guess from the address. */
export function spectrumModelName(idn: string | null | undefined, address: string | null | undefined): string {
  const model = (idn ?? '').split(',')[1]?.trim()
  if (model) return `R&S ${model}`
  return isVisaAddress(address) ? 'R&S FSV3004' : 'R&S FSC3'
}

/** The model and how it is reached, for a page's instrument bar. */
export function spectrumModelLine(idn: string | null | undefined, address: string | null | undefined): string {
  return `${spectrumModelName(idn, address)} · ${isVisaAddress(address) ? 'GPIB' : 'LAN'} SCPI`
}

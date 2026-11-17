import type { BleWrite, CommandResponse } from '../../types/models'

/**
 * A BLE radio write in the shape the kit's frame views take.
 *
 * The backend reports these writes as hex strings only; the reply's opcode
 * and payload are split back out of `rx_hex` here (`[opcode:2][len:2][…]`),
 * so Last frame reads the same as on every other DUT page.
 */
export function asFrame(w: BleWrite): CommandResponse {
  const rx = w.rx_hex.trim() === '' ? [] : w.rx_hex.trim().split(/\s+/)
  return {
    ok: w.ok,
    status: w.status,
    tx_hex: w.tx_hex,
    rx_hex: w.rx_hex || '—',
    reply_opcode_hex: rx.slice(0, 2).join(' ') || '—',
    reply_payload_hex: rx.slice(4).join(' ') || '—',
  }
}

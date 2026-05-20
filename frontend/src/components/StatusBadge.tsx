import Chip from '@mui/material/Chip'
import { useConnection } from '../context/ConnectionContext'

export function StatusBadge() {
  const { status } = useConnection()
  if (!status) return <Chip size="small" label="unknown" />
  if (!status.connected) return <Chip size="small" color="default" label="disconnected" />
  if (!status.transport_ready) {
    return <Chip size="small" color="warning" label={`connected (no transport: ${status.transport_error ?? '?'})`} />
  }
  return <Chip size="small" color="success" label={`connected: ${status.name ?? status.address}`} />
}

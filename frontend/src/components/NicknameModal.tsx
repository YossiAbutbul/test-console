import { useEffect, useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useNicknames } from '../context/NicknamesContext'
import { ModalShell, MONO } from '../ui'

interface Props {
  mac: string | null
  onClose: () => void
}

export function NicknameModal({ mac, onClose }: Props) {
  const { get, set, remove, colorFor } = useNicknames()
  const [name, setName] = useState('')
  // The last unit opened, held after `mac` goes null so the dialog can fade
  // out with its content in place. Returning null on close unmounted it
  // mid-frame: no exit motion, just gone.
  const [shown, setShown] = useState<string | null>(mac)
  if (mac && mac !== shown) setShown(mac)

  useEffect(() => {
    if (mac) setName(get(mac) ?? '')
  }, [mac, get])

  if (!shown) return null
  const color = colorFor(shown)

  const onSave = () => {
    set(shown, name)
    onClose()
  }
  const onRemove = () => {
    remove(shown)
    onClose()
  }

  return (
    <ModalShell
      open={!!mac}
      onClose={onClose}
      title="Edit nickname"
      maxWidth="xs"
      footer={{
        leading: get(shown)
          ? <Button color="error" onClick={onRemove}>Remove</Button>
          : undefined,
        secondary: <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>,
        primary: <Button variant="contained" onClick={onSave} disabled={!name.trim()}>Save</Button>,
      }}
    >
      <Stack spacing={2}>
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary' }}>
          {shown}
        </Typography>
        <TextField
          autoFocus
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Lab unit #3"
          onKeyDown={(e) => { if (e.key === 'Enter') onSave() }}
        />
        {/* Reserved while the field is empty, so typing the first letter
            does not grow the dialog under the pointer. */}
        <Box sx={{ visibility: name.trim() ? 'visible' : 'hidden' }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>Preview</Typography>
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              px: 1.25,
              py: 0.25,
              borderRadius: 1,
              fontSize: 12,
              fontWeight: 600,
              bgcolor: color.bg,
              color: color.fg,
            }}
          >
            {name.trim() || ' '}
          </Box>
        </Box>
      </Stack>
    </ModalShell>
  )
}

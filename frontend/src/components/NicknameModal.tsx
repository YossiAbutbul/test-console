import { useEffect, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Stack, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useNicknames } from '../context/NicknamesContext'

interface Props {
  mac: string | null
  onClose: () => void
}

export function NicknameModal({ mac, onClose }: Props) {
  const { get, set, remove, colorFor } = useNicknames()
  const [name, setName] = useState('')

  useEffect(() => {
    if (mac) setName(get(mac) ?? '')
  }, [mac, get])

  if (!mac) return null
  const color = colorFor(mac)

  const onSave = () => {
    set(mac, name)
    onClose()
  }
  const onRemove = () => {
    remove(mac)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700 }}>Edit nickname</Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'text.secondary' }}>
            {mac}
          </Typography>
          <TextField
            autoFocus
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Lab unit #3"
            onKeyDown={(e) => { if (e.key === 'Enter') onSave() }}
          />
          {name.trim() && (
            <Box>
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
                {name.trim()}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {get(mac) && (
          <Button onClick={onRemove} sx={{ mr: 'auto' }}>Remove</Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={!name.trim()}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

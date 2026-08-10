import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import setupDiagram from '../../assets/load-pull-setup.png'
import { TEXT } from '../../ui'

/**
 * How the bench is cabled for a load pull.
 *
 * Confirming the RF path is the one precondition the app cannot check for
 * itself, and until now the only description of it was a one-line sentence.
 * This is the diagram that sentence is short for.
 *
 * Imported rather than served from `public/`: Vite then fingerprints it, so a
 * changed diagram cannot be masked by a cached copy of the old one.
 */
export function SetupDiagramModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Test setup</Typography>
          <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
            what the RF path should look like
          </Typography>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'action.hover' }}>
        <Box
          component="img"
          src={setupDiagram}
          alt="Load pull test setup: network analyzer and DUT into the RF switch,
               through the bi-directional coupler to the trombone and attenuator,
               with the spectrum analyzer on the coupler tap and the DC analyzer
               on the DUT supply."
          sx={{
            display: 'block',
            width: '100%',
            height: 'auto',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            // The diagram is drawn on a light canvas, so it keeps its own
            // background in dark mode rather than being tinted by the dialog.
            bgcolor: '#fff',
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

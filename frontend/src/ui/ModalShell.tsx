import { useId, type ReactNode } from 'react'
import {
  Box, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography,
  type Breakpoint,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { TEXT } from './tokens'

/** The three places a dialog key can sit. Each slot takes the key itself, so a
 *  caller keeps its own spinner, hazard glyph or disabled rule:
 *
 *  - `leading`, alone on the left: the way out sideways ("Open instruments",
 *    "Reset"), or a destructive one as a `color="error"` text button.
 *  - `secondary`, right: the step back, a grey `variant="outlined"` key.
 *  - `primary`, rightmost: the one `variant="contained"` key. */
export interface ModalFooter {
  leading?: ReactNode
  secondary?: ReactNode
  primary?: ReactNode
}

interface ModalShellProps {
  open: boolean
  /** Omit to make the dialog undismissable for now (the close key stays in
   *  place, disabled, so the title bar does not change shape). */
  onClose?: () => void
  title: ReactNode
  /** One static line under the title. */
  subtitle?: ReactNode
  /** Icon keys before the close key ("Re-read"). */
  headerActions?: ReactNode
  maxWidth: Breakpoint
  /** Rules above and below the content, for a body that scrolls. */
  dividers?: boolean
  contentSx?: SxProps<Theme>
  paperSx?: SxProps<Theme>
  children: ReactNode
  footer?: ModalFooter
}

/**
 * One dialog frame for the app: a title bar, a body and a footer row.
 *
 * Every dialog used to build its own title bar -- 16 to 18 px titles, the
 * close key with or without a label, footers padded four different ways --
 * so two dialogs side by side never looked like one app. Radius, scrim and
 * the open/close motion come from the theme, not from here.
 */
export function ModalShell({
  open, onClose, title, subtitle, headerActions, maxWidth, dividers,
  contentSx, paperSx, children, footer,
}: ModalShellProps) {
  const titleId = useId()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      aria-labelledby={titleId}
      slotProps={paperSx ? { paper: { sx: paperSx } } : undefined}
    >
      <DialogTitle
        component="div"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          // Fixed, so a title that changes wording (Preflight) never moves
          // the body. A subtitle is static, so it may add its line once.
          minHeight: 52, height: subtitle ? 'auto' : 52,
          py: subtitle ? 1.25 : 0, pl: 3, pr: 1.5,
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography id={titleId} component="h2" sx={{ ...TEXT.dialog, lineHeight: 1.3 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {headerActions}
        <IconButton size="small" aria-label="Close" onClick={onClose} disabled={!onClose}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers={dividers} sx={contentSx}>
        {children}
      </DialogContent>

      {footer && (
        // Spaced by gap: MUI's own sibling margin would also push the key
        // after an empty leading slot.
        <DialogActions disableSpacing sx={{ px: 3, py: 1.5, gap: 1 }}>
          <Box sx={{ mr: 'auto', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {footer.leading}
          </Box>
          {footer.secondary}
          {footer.primary}
        </DialogActions>
      )}
    </Dialog>
  )
}

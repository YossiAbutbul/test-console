/**
 * FortuneSheet's chrome restyled after Excel: Segoe UI for the toolbar,
 * formula bar and tabs (Excel's own UI face), Calibri in the cells, the
 * selection in Excel green, and sheet tabs that read as Excel's.
 *
 * Scoped under the grid's box, so the library's global stylesheet is
 * overridden only here. Selectors are one class deeper than the library's,
 * which wins without `!important` except where it uses inline sizes.
 */
import { SHEET_FONT } from './sheetView'

const UI_FONT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif'
/** Excel's accent: the selection, the active tab. */
const GREEN = '#107C41'
const CHROME_BG = '#F8F8F8'
const RULE = '#E1E1E1'
const INK = '#242424'
const MUTED = '#616161'
const HOVER = 'rgba(0, 0, 0, 0.06)'

export const EXCEL_SX = {
  // Rounded with the box around it, which no longer clips (see SheetGrid).
  '& .fortune-container': { fontFamily: UI_FONT, color: INK, borderRadius: '8px' },

  // --- toolbar --------------------------------------------------------------
  '& .fortune-toolbar': {
    bgcolor: CHROME_BG, borderBottom: `1px solid ${RULE}`, padding: '4px 8px', minHeight: 40,
    boxSizing: 'border-box', borderRadius: '8px 8px 0 0',
  },
  '& .fortune-toolbar-button, & .fortune-toolbar-combo': {
    margin: '0 1px', borderRadius: '4px', minWidth: 28, height: 28, boxSizing: 'border-box',
    justifyContent: 'center', color: INK, transition: 'background-color 100ms ease',
  },
  '& .fortune-toolbar-button:hover, & .fortune-toolbar-combo:hover, & .fortune-toolbar-combo-arrow:hover': {
    bgcolor: HOVER,
  },
  '& .fortune-toolbar-button:active, & .fortune-toolbar-combo:active': { bgcolor: 'rgba(0, 0, 0, 0.1)' },
  '& .fortune-toolbar-divider': { height: 20, margin: '0 6px', bgcolor: RULE },
  '& .fortune-toolbar-combo-button, & .fortune-toolbar-combo-text': { fontSize: 13, fontFamily: UI_FONT },
  '& .fortune-toolbar-select, & .fortune-toolbar-color-picker, & .fortune-toolbar-more-container': {
    borderRadius: '8px', border: `1px solid ${RULE}`,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  '& .fortune-toolbar-select-option': { fontSize: 13, fontFamily: UI_FONT, padding: '6px 14px' },
  '& .fortune-toolbar-select-option:hover': { bgcolor: '#F0F0F0' },

  // Tooltips: under their button and centred on it, above everything in the
  // grid (they were drawn at the toolbar's z-index and clipped by the box).
  '& .fortune-tooltip': {
    top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 2000,
    bgcolor: '#FFFFFF', color: INK, border: `1px solid ${RULE}`, borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.16)', fontFamily: UI_FONT, fontSize: 12, padding: '4px 8px',
    pointerEvents: 'none',
  },
  '& .fortune-toolbar-button, & .fortune-toolbar-combo, & .fortune-toobar-combo-container': { position: 'relative' },

  // --- formula bar ----------------------------------------------------------
  '& .fortune-fx-editor': { height: 30, borderBottom: `1px solid ${RULE}`, bgcolor: '#FFFFFF' },
  '& .fortune-name-box-container': { width: 104, borderRight: `1px solid ${RULE}`, fontSize: 13 },
  '& .fortune-name-box': { fontFamily: UI_FONT, color: INK },
  '& .fortune-fx-icon': { margin: '0 10px', color: MUTED },
  '& .fortune-fx-input': { fontFamily: `${SHEET_FONT}, ${UI_FONT}`, fontSize: 14, color: INK },

  // --- the grid -------------------------------------------------------------
  '& .luckysheet-cell-selected': { borderColor: GREEN, borderWidth: '2px', bgcolor: 'rgba(16, 124, 65, 0.06)' },
  // The filter's range shares the selection's class; Excel marks it only by
  // the header's drop-downs.
  '& .luckysheet-cell-selected.luckysheet-filter-selected': { borderColor: 'transparent', bgcolor: 'transparent' },
  '& .luckysheet-cs-fillhandle': { bgcolor: GREEN },
  '& .fortune-col-header-selected': { borderBottom: `2px solid ${GREEN}`, bgcolor: 'rgba(16, 124, 65, 0.12)' },
  '& .fortune-row-header-selected': { borderRight: `2px solid ${GREEN}`, bgcolor: 'rgba(16, 124, 65, 0.12)' },
  // Excel's grey filter drop-downs, not the library's violet; green once a
  // column is filtered.
  '& .luckysheet-filter-options': { color: MUTED, borderColor: '#C8C8C8', bgcolor: '#FFFFFF', borderRadius: '2px' },
  '& .luckysheet-filter-options .caret.down': { borderTopColor: MUTED },
  '& .luckysheet-filter-options:hover': { bgcolor: '#F0F0F0', borderColor: '#A0A0A0', color: INK },
  '& .luckysheet-filter-options:hover .caret.down': { borderTopColor: INK },
  '& .luckysheet-filter-options-active, & .luckysheet-filter-options-active:hover': {
    bgcolor: GREEN, borderColor: GREEN, color: '#FFFFFF',
  },
  // The cell editor in the cells' face, not Arial.
  '& .luckysheet-input-box, & .luckysheet-input-box-inner, & .luckysheet-cell-input': {
    fontFamily: `${SHEET_FONT}, ${UI_FONT}`,
  },
  // "Add 100 more rows": a sheet of results has the rows it has.
  '& .luckysheet-bottom-controll-row': { display: 'none' },

  // --- sheet tabs -----------------------------------------------------------
  '& .luckysheet-sheet-area': { bgcolor: CHROME_BG, borderTop: `1px solid ${RULE}`, paddingLeft: '8px' },
  // Add-sheet and all-sheets: the sheets are the report's test types.
  '& .fortune-sheettab-button': { display: 'none' },
  // Each tab's menu arrow opened an empty menu.
  '& .luckysheet-sheets-item-function, & .luckysheet-sheets-item-menu': { display: 'none' },
  '& .luckysheet-sheet-area div.luckysheet-sheets-item': {
    bgcolor: 'transparent', color: MUTED, fontFamily: UI_FONT, fontSize: 13, padding: '0 14px',
    border: 0, borderBottom: '2px solid transparent', marginRight: '2px', height: 30, lineHeight: '28px',
    // One weight for every tab, chosen or not: a bold active tab widened
    // itself and moved the rest along.
    fontWeight: 600,
  },
  '& .luckysheet-sheet-area div.luckysheet-sheets-item:hover': { bgcolor: HOVER, color: INK },
  '& .luckysheet-sheet-area div.luckysheet-sheets-item-active, & .luckysheet-sheet-area div.luckysheet-sheets-item-active:hover': {
    bgcolor: '#FFFFFF', color: GREEN, borderBottomColor: GREEN,
  },
  '& .fortune-sheettab-container .boundary': { bgcolor: CHROME_BG },
  '& .fortune-zoom-ratio, & .luckysheet-sheet-selection-calInfo': { fontFamily: UI_FONT, fontSize: 12, color: MUTED },
  '& .fortune-stat-area': { bgcolor: CHROME_BG, borderRadius: '0 0 8px 8px' },
} as const

/**
 * Shared UI helpers. Implementation lives in js/ui/layout.js so menu
 * screens and app.js stay free of circular imports.
 */
export {
  drawCornerBrackets,
  drawBackButton,
  drawMenuButton,
  drawPanel,
  layoutOf,
  paintBackdrop,
  paintScreenBackdrop,
  footerPairRects,
  footerNavRects,
  fearUpgradeRects,
  setMenuPointer,
  menuCursor,
  menuHit,
  menuPointerPos,
  applyMenuHitTransform,
  paintMenuGlow,
  drawHeaderDollars,
  drawHeaderCog,
  clearHeaderCog,
  lastHeaderCogRect,
  drawFooterStrip,
  drawCursorTooltip,
  drawOsWindow,
  WINDOW_TITLE_H,
} from './ui/layout.js';

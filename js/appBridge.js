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
  fearUpgradeRects,
  setMenuPointer,
  menuCursor,
  menuHit,
  applyMenuHitTransform,
  paintMenuGlow,
} from './ui/layout.js';

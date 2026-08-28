/**
 * Faux-3D camera projection — two-factor model (D + V).
 * Ported from Tower Defence project, adapted for top-down helicopter view.
 *
 * D (depth factor) = cos(pitch)^1.5 — ground plane foreshortening
 * V (vertical factor) = 0.72 + 0.92 * sin(pitch) — height dimensions
 */

import { PITCH_DEG } from './config.js';

export const VIEW25 = {
  pitchDeg: PITCH_DEG,
  trap: 0.42,
  yScale: 0.79,
  farScale: 0.62,
  nearScale: 1,
  deckRatio: 0.79,
  shadowSkew: 0.02,
  boxSkew: 0.14,
  rise: 0.24,
  vExag: 1.09,
  depthFog: 0.22,
};

export function setPitch(deg) {
  VIEW25.pitchDeg = Math.max(8, Math.min(58, deg));
  syncCamera();
}

function syncCamera() {
  const p = (VIEW25.pitchDeg * Math.PI) / 180;
  const cos = Math.cos(p);
  const sin = Math.sin(p);
  const D = Math.max(0.42, Math.pow(cos, 1.5));
  VIEW25.yScale = D;
  VIEW25.deckRatio = D;
  VIEW25.farScale = Math.max(0.35, 1 - sin * VIEW25.trap);
  VIEW25.nearScale = 1;
  VIEW25.vExag = 0.72 + 0.92 * sin;
  VIEW25.rise = 0.13 + 0.28 * sin;
  VIEW25.boxSkew = 0.1 + 0.14 * sin;
  VIEW25.shadowSkew = 0.012 + 0.05 * sin;
  VIEW25.depthFog = 0.12 + 0.38 * sin;
}

syncCamera();

/** Deck ellipse ry from rx. */
export function deckRy(rx) {
  return rx * VIEW25.deckRatio;
}

/** Ground-plane basis vectors from a world angle. */
export function groundBasis(angle) {
  const D = VIEW25.yScale;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle) * D;
  const pl = Math.hypot(Math.sin(angle), D * Math.cos(angle)) || 1;
  return {
    D,
    V: VIEW25.vExag,
    ax,
    ay,
    px: -Math.sin(angle) / pl,
    py: (D * Math.cos(angle)) / pl,
    len: Math.hypot(ax, ay),
    depth: Math.max(0, Math.min(1, -Math.sin(angle))),
  };
}

/** Ellipse params for a circle lying across a ground tube. */
export function capEllipse(basis, r) {
  const a = basis.px * basis.px;
  const c = basis.px * basis.py * basis.D;
  const b = basis.py * basis.py * basis.D * basis.D + basis.V * basis.V;
  const tr = a + b;
  const disc = Math.sqrt(Math.max(0, (a - b) * (a - b) + 4 * c * c));
  const l1 = (tr + disc) / 2;
  const l2 = Math.max(1e-6, (tr - disc) / 2);
  return {
    rx: r * Math.sqrt(l1),
    ry: r * Math.sqrt(l2),
    rot: 0.5 * Math.atan2(2 * c, a - b),
  };
}

export function aimToDrawAngle(aimAngle) {
  return Number.isFinite(aimAngle) ? aimAngle : -Math.PI / 2;
}

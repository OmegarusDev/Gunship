/**
 * world/parcels.js — parcel subdivision + building footprints for street-based settlements.
 * Takes a StreetGraph + bbox and produces Parcel[] and BuildingFootprint[].
 * See docs/STREETS_SPEC.md §5 Steps 2-3.
 */

import { mulberry32, randInt } from '../rng.js';

/**
 * Subdivide the settlement bbox around the street graph into parcels.
 * Simple strip method: for each building slot, slice the largest parcel.
 * Ensures every parcel touches a street edge.
 * @param {object} streetGraph - { nodes, edges, bbox }
 * @param {object} bbox - { x0, y0, x1, y1, w, h }
 * @param {number} buildingCount - desired parcels
 * @param {number} seed - site seed
 * @returns {Array<Parcel>}
 */
export function subdivideParcels(streetGraph, bbox, buildingCount, seed) {
  const rng = mulberry32(seed >>> 0);
  const parcels = [];

  // Start with one big parcel covering the bbox inset from streets
  const inset = 4; // sidewalk
  const initial = {
    id: 'p0',
    x0: bbox.x0 + inset,
    y0: bbox.y0 + inset,
    x1: bbox.x1 - inset,
    y1: bbox.y1 - inset,
    streetFrontage: streetGraph.edges[0]?.id || null,
  };
  parcels.push(initial);

  // Iteratively split the largest parcel until we have buildingCount
  let pid = 1;
  while (parcels.length < buildingCount) {
    // Find largest by area
    parcels.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    const target = parcels[0];
    const w = target.x1 - target.x0;
    const h = target.y1 - target.y0;
    if (w < 16 && h < 16) break; // too small to split

    // Split along longest axis
    const horizontal = w > h;
    const ratio = 0.4 + rng() * 0.2; // 40-60%
    if (horizontal) {
      const splitX = target.x0 + w * ratio;
      const left = { id: `p${pid++}`, x0: target.x0, y0: target.y0, x1: splitX - 1, y1: target.y1, streetFrontage: target.streetFrontage };
      const right = { id: `p${pid++}`, x0: splitX + 1, y0: target.y0, x1: target.x1, y1: target.y1, streetFrontage: target.streetFrontage };
      parcels.shift();
      parcels.push(left, right);
    } else {
      const splitY = target.y0 + h * ratio;
      const top = { id: `p${pid++}`, x0: target.x0, y0: target.y0, x1: target.x1, y1: splitY - 1, streetFrontage: target.streetFrontage };
      const bottom = { id: `p${pid++}`, x0: target.x0, y0: splitY + 1, x1: target.x1, y1: target.y1, streetFrontage: target.streetFrontage };
      parcels.shift();
      parcels.push(top, bottom);
    }
  }

  // Assign street frontage to each parcel: find nearest street edge
  for (const p of parcels) {
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
    let best = null, bestDist = Infinity;
    for (const e of streetGraph.edges) {
      const an = streetGraph.nodes.find(n => n.id === e.a);
      const bn = streetGraph.nodes.find(n => n.id === e.b);
      if (!an || !bn) continue;
      // Distance from parcel center to edge segment
      const dx = bn.x - an.x, dy = bn.y - an.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((cx - an.x) * dx + (cy - an.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = an.x + t * dx, py = an.y + t * dy;
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestDist) { bestDist = d; best = e.id; }
    }
    p.streetFrontage = best;
    // Convert to polygon for rendering/debugging (rect)
    p.polygon = [
      { x: p.x0, y: p.y0 },
      { x: p.x1, y: p.y0 },
      { x: p.x1, y: p.y1 },
      { x: p.x0, y: p.y1 },
    ];
    p.kind = 'residential';
  }

  return parcels.slice(0, buildingCount);
}

/**
 * Turn parcels into building footprints (one building per parcel, inset).
 * @param {Array} parcels - from subdivideParcels
 * @param {string} archetype - rural/town/camp/base
 * @param {number} seed - site seed
 * @returns {Array} footprints [{ x, y, type, polygon, doorDir, parcelId }]
 */
export function footprintsFromParcels(parcels, archetype, seed) {
  const rng = mulberry32(seed >>> 0);
  const out = [];

  // Archetype building type pools (same as world.js ARCHETYPES)
  const pools = {
    rural: ['hut', 'hut', 'sandbag', 'crate_stack'],
    town: ['hut', 'depot', 'tower', 'sandbag', 'barracks'],
    camp: ['sandbag', 'depot', 'tower', 'barracks', 'crate_stack'],
    base: ['bunker', 'barracks', 'depot', 'tower', 'garage', 'sandbag', 'crate_stack'],
  };
  const pool = pools[archetype] || pools.rural;

  for (const p of parcels) {
    const pw = p.x1 - p.x0, ph = p.y1 - p.y0;
    // Inset for yard/setback: 2-4 front (street side), 2 other sides
    const frontSetback = 3 + rng() * 2;
    const sideSetback = 2;
    // For simplicity, inset uniformly (we don't know front side without street geometry, so inset all)
    const bx0 = p.x0 + sideSetback;
    const by0 = p.y0 + sideSetback;
    const bx1 = p.x1 - sideSetback;
    const by1 = p.y1 - sideSetback;
    // Clamp to at least 8x8
    const bw = Math.max(8, bx1 - bx0);
    const bh = Math.max(8, by1 - by0);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;

    // Pick type constrained by parcel size
    let type = pool[Math.floor(rng() * pool.length)];
    // Towers and bunkers need larger parcels
    if ((type === 'bunker' || type === 'tower') && (pw < 14 || ph < 14)) {
      type = 'hut';
    }
    if (type === 'barracks' && (pw < 14 || ph < 10)) {
      type = 'hut';
    }

    // Door faces the street frontage edge (approx: direction from parcel center to street)
    // For now, random door dir biased toward parcel center to street
    const doorDir = rng() * Math.PI * 2;

    const poly = [
      { x: cx - bw / 2, y: cy - bh / 2 },
      { x: cx + bw / 2, y: cy - bh / 2 },
      { x: cx + bw / 2, y: cy + bh / 2 },
      { x: cx - bw / 2, y: cy + bh / 2 },
    ];

    out.push({
      x: cx, y: cy,
      type,
      polygon: poly,
      doorDir,
      parcelId: p.id,
      w: bw, h: bh,
    });
  }

  return out;
}

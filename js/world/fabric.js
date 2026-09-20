/**
 * Seed-and-accrete civilian fabric.
 *
 * Buildings are the primitive. Local lanes are leftover gaps between
 * houses, not authored spines. Military/industrial grids do not use this.
 */
import {
  distance,
  localToWorld,
  orientedRectangle,
  polygonIntersectsPolygon,
  worldToLocal,
} from './geometry.js';

const SIDES = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];

export const GAP_MIX = Object.freeze({
  town: {
    weights: [
      ['party', 0.7],
      ['sikka', 0.24],
      ['yard', 0.06],
    ],
    party: [1.3, 2.3],
    sikka: [3.4, 5.6],
    yard: [6.6, 9.6],
    blobAlong: 176,
    blobAcross: 148,
  },
  village: {
    weights: [
      ['party', 0.52],
      ['sikka', 0.36],
      ['yard', 0.12],
    ],
    party: [1.5, 2.6],
    sikka: [3.6, 6],
    yard: [7, 11.5],
    blobAlong: 98,
    blobAcross: 82,
  },
  compound: {
    weights: [
      ['party', 0.8],
      ['sikka', 0.16],
      ['yard', 0.04],
    ],
    party: [1.3, 2.2],
    sikka: [3.4, 5.2],
    yard: [6.4, 9.6],
    blobAlong: 78,
    blobAcross: 66,
  },
  farm: {
    weights: [
      ['party', 0.16],
      ['sikka', 0.3],
      ['yard', 0.54],
    ],
    party: [1.7, 2.9],
    sikka: [4.4, 7.2],
    yard: [8.6, 15],
    blobAlong: 108,
    blobAcross: 92,
  },
  roadside_service: {
    weights: [
      ['party', 0.2],
      ['sikka', 0.4],
      ['yard', 0.4],
    ],
    party: [1.7, 2.9],
    sikka: [4, 6.4],
    yard: [7, 12.5],
    blobAlong: 72,
    blobAcross: 54,
  },
});

function between(rng, min, max) {
  return min + (max - min) * rng();
}

function pickWeighted(rng, weights) {
  let cursor = rng();
  for (const [value, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

function inBlob(origin, axis, rx, ry, point) {
  const local = worldToLocal(origin, axis, point);
  const nx = local.x / rx;
  const ny = local.y / ry;
  return nx * nx + ny * ny <= 1;
}

function lotFootprint(lot, pad = 0.5) {
  return orientedRectangle(lot.x, lot.y, lot.w + pad, lot.d + pad, lot.rotation);
}

function neighborCount(lots, lot, radius = 30) {
  let count = 0;
  for (const other of lots) {
    if (other === lot) continue;
    if (distance(lot, other) < radius) count++;
  }
  return count;
}

function pickFrontier(lots, rng) {
  const weights = lots.map((lot) => 1 / (1 + neighborCount(lots, lot)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = rng() * total;
  for (let i = 0; i < lots.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return lots[i];
  }
  return lots[lots.length - 1];
}

function gapFor(mix, rng) {
  const kind = pickWeighted(rng, mix.weights);
  const range = mix[kind];
  return { kind, gap: between(rng, range[0], range[1]) };
}

function makeLot(type, template, rng, x, y, rotation, openAcross) {
  const w = between(rng, template.w[0], template.w[1]);
  const d = between(rng, template.d[0], template.d[1]);
  const h = between(rng, template.h[0], template.h[1]);
  return {
    type,
    x,
    y,
    w,
    d,
    h,
    rotation,
    openAcross,
    col: template.col,
    tags: [...template.tags],
  };
}

/**
 * Grow a clump of lots from 1–3 seeds. Never walks an along-axis cursor.
 */
export function accreteLots({ origin, axis, types, templates, mix, rng }) {
  const lots = [];
  if (!types.length) return lots;
  const rx = mix.blobAlong;
  const ry = mix.blobAcross;
  const overlaps = (footprint) =>
    lots.some((lot) => polygonIntersectsPolygon(lotFootprint(lot), footprint));

  const plant = (type, x, y, rotation, openAcross) => {
    const template = templates[type] || templates.house;
    const lot = makeLot(type, template, rng, x, y, rotation, openAcross);
    if (!inBlob(origin, axis, rx, ry, lot) || overlaps(lotFootprint(lot))) return false;
    lots.push(lot);
    return true;
  };

  const seedRot = axis + between(rng, -0.12, 0.12);
  plant(types[0], origin.x, origin.y, seedRot, -1);
  if (!lots.length) {
    lots.push(
      makeLot(
        types[0],
        templates[types[0]] || templates.house,
        rng,
        origin.x,
        origin.y,
        seedRot,
        -1
      )
    );
  }

  for (let index = 1; index < types.length; index++) {
    const type = types[index];
    const template = templates[type] || templates.house;
    let placed = false;
    for (let attempt = 0; attempt < 56 && !placed; attempt++) {
      const useScatter = lots.length < 2 || rng() < 0.08;
      if (useScatter && attempt > 10) {
        const along = between(rng, -rx * 0.7, rx * 0.7);
        const across = between(rng, -ry * 0.7, ry * 0.7);
        const point = localToWorld(origin, axis, along, across);
        placed = plant(
          type,
          point.x,
          point.y,
          axis + between(rng, -0.5, 0.5),
          rng() < 0.5 ? -1 : 1
        );
        continue;
      }
      const host = pickFrontier(lots, rng);
      const side = SIDES[Math.floor(rng() * SIDES.length)];
      const wobble = rng() < 0.32 ? between(rng, -0.45, 0.45) : 0;
      const turn = rng() < 0.14 ? Math.PI * 0.5 * (rng() < 0.5 ? 1 : -1) : 0;
      const { gap } = gapFor(mix, rng);
      const w = between(rng, template.w[0], template.w[1]);
      const d = between(rng, template.d[0], template.d[1]);
      const reach = host.w * 0.5 + w * 0.5 + gap;
      const angle = host.rotation + side + wobble;
      const x = host.x + Math.cos(angle) * reach;
      const y = host.y + Math.sin(angle) * reach;
      const rotation = host.rotation + turn + between(rng, -0.16, 0.16);
      const openAcross = Math.sin(side) >= 0 ? -1 : 1;
      placed = plant(type, x, y, rotation, openAcross);
      if (!placed && d !== w) {
        const reach2 = host.d * 0.5 + d * 0.5 + gap;
        placed = plant(
          type,
          host.x + Math.cos(angle) * reach2,
          host.y + Math.sin(angle) * reach2,
          rotation,
          openAcross
        );
      }
    }
  }
  return lots;
}

function lotRadius(lot) {
  return Math.hypot(lot.w, lot.d) * 0.5;
}

function clearance(a, b) {
  return distance(a, b) - lotRadius(a) * 0.72 - lotRadius(b) * 0.72;
}

function find(parent, index) {
  while (parent[index] !== index) {
    parent[index] = parent[parent[index]];
    index = parent[index];
  }
  return index;
}

/**
 * Residual lanes: spanning-tree cracks between lots, plus an umbilical to access.
 */
export function streetsFromLots(lots, access, place, nextRoadId) {
  const streets = [];
  if (!lots.length) return streets;
  const edges = [];
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      const sep = clearance(lots[i], lots[j]);
      if (sep > 18) continue;
      edges.push({ i, j, sep, d: distance(lots[i], lots[j]) });
    }
  }
  edges.sort((a, b) => a.d - b.d);
  const parent = lots.map((_, index) => index);
  const tree = [];
  for (const edge of edges) {
    const a = find(parent, edge.i);
    const b = find(parent, edge.j);
    if (a === b) continue;
    parent[a] = b;
    tree.push(edge);
  }

  const emit = (points, width, tags) => {
    if (!points || points.length < 2) return null;
    const road = {
      id: nextRoadId(),
      points,
      width,
      surface: tags.includes('main-street') ? 'compacted' : width < 5.2 ? 'track' : 'dirt',
      hierarchy: tags.includes('main-street') ? 'local' : 'alley',
      tags: ['place-street', `place:${place.id}`, ...tags],
    };
    streets.push(road);
    return road;
  };

  let main = true;
  for (const edge of tree) {
    if (edge.sep < 2.85 || edge.sep > 13) continue;
    const a = lots[edge.i];
    const b = lots[edge.j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const insetA = Math.min(lotRadius(a) * 0.45, len * 0.35);
    const insetB = Math.min(lotRadius(b) * 0.45, len * 0.35);
    const width = Math.max(3.6, Math.min(6.6, edge.sep * 0.9));
    const tags = [edge.sep < 6.2 ? 'sikka' : 'organic-lane'];
    if (main) {
      tags.push('main-street');
      main = false;
    }
    const road = emit(
      [
        { x: a.x + (dx / len) * insetA, y: a.y + (dy / len) * insetA },
        { x: b.x - (dx / len) * insetB, y: b.y - (dy / len) * insetB },
      ],
      width,
      tags
    );
    lots[edge.i].frontageRoad = lots[edge.i].frontageRoad || road;
    lots[edge.j].frontageRoad = lots[edge.j].frontageRoad || road;
  }

  const used = new Set(tree.map((edge) => `${edge.i}:${edge.j}`));
  const extras = edges.filter(
    (edge) => !used.has(`${edge.i}:${edge.j}`) && edge.sep >= 2.9 && edge.sep <= 11
  );
  const laneCap = Math.max(14, Math.floor(lots.length * 0.55));
  for (const edge of extras) {
    if (streets.length >= laneCap) break;
    const a = lots[edge.i];
    const b = lots[edge.j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const insetA = Math.min(lotRadius(a) * 0.4, len * 0.32);
    const insetB = Math.min(lotRadius(b) * 0.4, len * 0.32);
    const width = Math.max(3.5, Math.min(6.2, edge.sep * 0.88));
    const road = emit(
      [
        { x: a.x + (dx / len) * insetA, y: a.y + (dy / len) * insetA },
        { x: b.x - (dx / len) * insetB, y: b.y - (dy / len) * insetB },
      ],
      width,
      [edge.sep < 6.2 ? 'sikka' : 'organic-lane']
    );
    lots[edge.i].frontageRoad = lots[edge.i].frontageRoad || road;
    lots[edge.j].frontageRoad = lots[edge.j].frontageRoad || road;
  }

  if (access) {
    let nearest = lots[0];
    let best = Infinity;
    for (const lot of lots) {
      const d = Math.hypot(lot.x - access.x, lot.y - access.y);
      if (d < best) {
        best = d;
        nearest = lot;
      }
    }
    if (best > 4) {
      const road = emit(
        [
          { x: access.x, y: access.y },
          { x: nearest.x, y: nearest.y },
        ],
        5.8,
        ['main-street', 'gate-umbilical']
      );
      nearest.frontageRoad = nearest.frontageRoad || road;
    }
  }

  if (!streets.length && lots.length) {
    const a = lots[0];
    const b = lots[Math.min(1, lots.length - 1)];
    const road = emit(
      [
        { x: a.x - a.w * 0.4, y: a.y },
        { x: b.x + b.w * 0.4, y: b.y },
      ],
      5.4,
      ['main-street', 'organic-lane']
    );
    for (const lot of lots) lot.frontageRoad = lot.frontageRoad || road;
  }

  for (const lot of lots) {
    if (lot.frontageRoad) continue;
    let best = streets[0];
    let bestD = Infinity;
    for (const road of streets) {
      for (const point of road.points) {
        const d = Math.hypot(lot.x - point.x, lot.y - point.y);
        if (d < bestD) {
          bestD = d;
          best = road;
        }
      }
    }
    lot.frontageRoad = best;
  }
  return streets;
}

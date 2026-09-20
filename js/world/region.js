/**
 * Regional geography and destination demand for WORLD_GEN v4.
 *
 * This phase chooses why places exist. It does not lay out streets or
 * buildings; destination anchors express scale, orientation and land use.
 */

import { mulberry32 } from '../rng.js';
import {
  boundsFromPoints,
  clamp,
  deriveSeed,
  directionFromAngle,
  localToWorld,
  meanderPolyline,
  nearestPointOnPolyline,
  orientedRectangle,
  regularPolygon,
  TAU,
} from './geometry.js';

export const REGION_PROFILES = Object.freeze({
  alluvial_palm: {
    id: 'alluvial_palm',
    name: 'Lower alluvial palm belt',
    description: 'A settled irrigation belt fading into saline flats and open desert.',
    tags: ['alluvial', 'irrigated', 'palm-belt', 'canals', 'sabkha'],
    resources: {
      groundwater: 0.82,
      agriculture: 0.86,
      aggregate: 0.28,
      fuelTransit: 0.48,
      strategicHighGround: 0.3,
    },
  },
  wadi_piedmont: {
    id: 'wadi_piedmont',
    name: 'Wadi piedmont corridor',
    description: 'Gravel fans, seasonal channels and defended crossings below broken high ground.',
    tags: ['wadi', 'piedmont', 'gravel-fan', 'high-ground', 'seasonal-water'],
    resources: {
      groundwater: 0.52,
      agriculture: 0.46,
      aggregate: 0.78,
      fuelTransit: 0.44,
      strategicHighGround: 0.86,
    },
  },
  desert_logistics: {
    id: 'desert_logistics',
    name: 'Interior desert logistics corridor',
    description: 'A long-haul freight route linking depots, service yards and dispersed defenses.',
    tags: ['desert', 'logistics', 'hardpack', 'fuel-route', 'remote'],
    resources: {
      groundwater: 0.24,
      agriculture: 0.18,
      aggregate: 0.58,
      fuelTransit: 0.92,
      strategicHighGround: 0.62,
    },
  },
});

const ANCHOR_META = Object.freeze({
  town: { category: 'settlement', scale: [560, 840], tags: ['civilian', 'market-town'] },
  village: { category: 'settlement', scale: [210, 360], tags: ['civilian', 'village'] },
  compound: { category: 'settlement', scale: [190, 340], tags: ['civilian', 'walled-compound'] },
  farm: { category: 'agriculture', scale: [170, 310], tags: ['civilian', 'farm'] },
  roadside_service: {
    category: 'commerce',
    scale: [120, 210],
    tags: ['civilian', 'roadside', 'services'],
  },
  fuel_depot: {
    category: 'industrial',
    scale: [190, 300],
    tags: ['industrial', 'fuel-storage', 'secured'],
  },
  industrial_depot: {
    category: 'industrial',
    scale: [210, 340],
    tags: ['industrial', 'logistics', 'secured'],
  },
  oil_field: {
    category: 'industrial',
    scale: [280, 420],
    tags: ['industrial', 'fuel-storage', 'oil', 'secured'],
  },
  checkpoint: {
    category: 'security',
    scale: [90, 150],
    tags: ['military', 'checkpoint', 'road-control'],
  },
  camp: { category: 'military', scale: [210, 330], tags: ['military', 'garrison', 'secured'] },
  sam_site: {
    category: 'military',
    scale: [210, 310],
    tags: ['military', 'air-defense', 'dispersed'],
  },
});

const HOSTILE_CATEGORIES = new Set(['military', 'security', 'industrial']);

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function randomInt(rng, min, max) {
  return Math.floor(randomBetween(rng, min, max + 1));
}

function randomPick(rng, values) {
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}

function terrainType(terrain, x, y) {
  return typeof terrain?.type === 'function' ? terrain.type(x, y) : 'sand';
}

function terrainSample(terrain, x, y) {
  if (typeof terrain?.typeAndElevation === 'function') {
    const sample = terrain.typeAndElevation(x, y);
    return {
      type: sample.type || 'sand',
      elevation: Number.isFinite(sample.elevation) ? sample.elevation : 0,
      oasisDist: Number.isFinite(sample.oasisDist) ? sample.oasisDist : Infinity,
      wadiDist: Number.isFinite(sample.wadiDist) ? sample.wadiDist : Infinity,
    };
  }
  return {
    type: terrainType(terrain, x, y),
    elevation: terrainElevation(terrain, x, y),
    oasisDist: Infinity,
    wadiDist: Infinity,
  };
}

function suitabilityFromSample(sample) {
  let s = 0;
  const water = Math.min(sample.oasisDist, sample.wadiDist);
  s += Math.exp(-water / 900) * 1.0;
  if (sample.elevation > 500) s -= 0.5;
  if (sample.elevation < 30) s -= 0.3;
  if (sample.oasisDist < 260) s += 0.6;
  return s;
}

function terrainElevation(terrain, x, y) {
  return typeof terrain?.elevation === 'function' ? terrain.elevation(x, y) : 0;
}

function terrainSuitability(terrain, x, y) {
  return typeof terrain?.suitability === 'function' ? terrain.suitability(x, y) : 0.5;
}

function localRelief(terrain, x, y, centerElevation) {
  if (typeof terrain?.elevation !== 'function') return 0;
  const center = Number.isFinite(centerElevation)
    ? centerElevation
    : terrainElevation(terrain, x, y);
  const east = terrainElevation(terrain, x + 55, y);
  const north = terrainElevation(terrain, x, y + 55);
  return Math.max(Math.abs(center - east), Math.abs(center - north));
}

function nearestWadiAxis(terrain, x, y, fallback) {
  let best = null;
  for (const wadi of terrain?.wadis || []) {
    const hit = nearestPointOnPolyline(wadi.points, x, y);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best ? best.angle : fallback;
}

function buildTypePlan(profileId, count, rng) {
  const settlementCount = randomInt(rng, 5, 8);
  const plan = ['town'];
  for (let i = 0; i < settlementCount; i++) {
    const compoundChance = profileId === 'wadi_piedmont' ? 0.46 : 0.22;
    plan.push(rng() < compoundChance ? 'compound' : 'village');
  }

  if (profileId === 'alluvial_palm') {
    plan.push(
      'farm',
      'farm',
      'farm',
      'farm',
      'farm',
      'farm',
      'roadside_service',
      'roadside_service',
      'roadside_service'
    );
  } else if (profileId === 'wadi_piedmont') {
    plan.push('farm', 'farm', 'farm', 'farm', 'roadside_service', 'compound', 'compound');
  } else {
    plan.push(
      'farm',
      'farm',
      'farm',
      'roadside_service',
      'roadside_service',
      'roadside_service',
      'fuel_depot'
    );
  }
  plan.push(
    'fuel_depot',
    'oil_field',
    'industrial_depot',
    'checkpoint',
    'camp',
    'sam_site',
    'sam_site'
  );

  const extras = {
    alluvial_palm: ['farm', 'village', 'roadside_service', 'compound', 'farm', 'village'],
    wadi_piedmont: ['compound', 'village', 'farm', 'farm', 'roadside_service', 'village'],
    desert_logistics: [
      'roadside_service',
      'farm',
      'village',
      'fuel_depot',
      'oil_field',
      'roadside_service',
    ],
  }[profileId];
  while (plan.length < count) plan.push(randomPick(rng, extras));
  return plan.slice(0, count);
}

function rayToOperationalBoundary(direction, half, inset) {
  const dx = Math.abs(direction.x) < 1e-6 ? 1e-6 : Math.abs(direction.x);
  const dy = Math.abs(direction.y) < 1e-6 ? 1e-6 : Math.abs(direction.y);
  const distance = Math.min((half - inset) / dx, (half - inset) / dy);
  return { x: direction.x * distance, y: direction.y * distance };
}

function chooseCandidateSource(type, terrain, scale, axes, half, rng) {
  const isWaterDriven =
    type === 'town' || type === 'village' || type === 'compound' || type === 'farm';
  const isHighGround = type === 'sam_site' || type === 'camp';
  const margin = scale * 0.58 + 80;

  if (isHighGround && terrain?.highs?.length && rng() < 0.62) {
    const high = randomPick(rng, terrain.highs);
    const angle = rng() * TAU;
    const distance = high.radius * randomBetween(rng, 0.8, 1.35);
    return {
      x: high.x + Math.cos(angle) * distance,
      y: high.y + Math.sin(angle) * distance,
      source: 'high-ground',
      axis: angle + Math.PI * 0.5,
    };
  }

  if (isWaterDriven && terrain?.oases?.length && rng() < 0.58) {
    const oasis = randomPick(rng, terrain.oases);
    const angle = rng() * TAU;
    const distance = oasis.radius * randomBetween(rng, 0.35, 1.05) + scale * 0.18;
    return {
      x: oasis.x + Math.cos(angle) * distance,
      y: oasis.y + Math.sin(angle) * distance,
      source: 'oasis-margin',
      axis: nearestWadiAxis(terrain, oasis.x, oasis.y, axes.water.angle),
    };
  }

  if (isWaterDriven && terrain?.wadis?.length && rng() < 0.58) {
    const preferred = terrain.wadis.filter((wadi) => wadi.order === 1);
    const wadi = randomPick(rng, preferred.length ? preferred : terrain.wadis);
    const segment = randomInt(rng, 0, Math.max(0, wadi.points.length - 2));
    const a = wadi.points[segment];
    const b = wadi.points[segment + 1] || a;
    const t = rng();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = side * ((wadi.width || 70) * 0.65 + scale * 0.23 + 28);
    const point = {
      x: a.x + (b.x - a.x) * t - Math.sin(angle) * offset,
      y: a.y + (b.y - a.y) * t + Math.cos(angle) * offset,
    };
    return { ...point, source: 'wadi-bank', axis: angle };
  }

  if (
    (type === 'roadside_service' ||
      type === 'fuel_depot' ||
      type === 'industrial_depot' ||
      type === 'oil_field' ||
      type === 'checkpoint') &&
    rng() < 0.65
  ) {
    const direction = axes.trade.direction;
    const normal = { x: -direction.y, y: direction.x };
    const along = randomBetween(rng, -half * 0.72, half * 0.72);
    const across = randomBetween(rng, -half * 0.22, half * 0.22);
    return {
      x: direction.x * along + normal.x * across,
      y: direction.y * along + normal.y * across,
      source: 'trade-corridor',
      axis: axes.trade.angle,
    };
  }

  return {
    x: randomBetween(rng, -half + margin, half - margin),
    y: randomBetween(rng, -half + margin, half - margin),
    source: 'open-ground',
    axis: axes.trade.angle + randomBetween(rng, -0.45, 0.45),
  };
}

function scoreCandidate(candidate, type, category, scale, terrain, axes, worldSize, placed) {
  const half = worldSize * 0.5;
  const margin = scale * 0.58 + 65;
  if (
    Math.abs(candidate.x) > half - margin ||
    Math.abs(candidate.y) > half - margin ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y)
  ) {
    return -Infinity;
  }

  const radial = Math.hypot(candidate.x, candidate.y);
  const centerExclusion = Math.max(760, worldSize * 0.155);
  if (HOSTILE_CATEGORIES.has(category) && radial < centerExclusion) return -Infinity;
  if (type === 'town' && radial < Math.max(900, worldSize * 0.18)) return -Infinity;

  const sample = terrainSample(terrain, candidate.x, candidate.y);
  const ground = sample.type;
  if (ground === 'rock' && type !== 'sam_site') return -Infinity;
  if (ground === 'wadi') return -Infinity;

  let nearestSpacing = Infinity;
  const clustered =
    type === 'farm' || type === 'village' || type === 'compound' || type === 'roadside_service';
  for (const anchor of placed) {
    const distance = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
    const neighborClustered =
      anchor.type === 'farm' ||
      anchor.type === 'village' ||
      anchor.type === 'compound' ||
      anchor.type === 'roadside_service';
    const tight = clustered && neighborClustered;
    const required = Math.max(tight ? 148 : 230, (scale + anchor.scale) * (tight ? 0.26 : 0.4));
    if (distance < required) return -Infinity;
    nearestSpacing = Math.min(nearestSpacing, distance);
  }

  const suitability = suitabilityFromSample(sample);
  const waterDistance = Math.min(sample.oasisDist, sample.wadiDist);
  const relief = localRelief(terrain, candidate.x, candidate.y, sample.elevation);
  const elevation = sample.elevation;
  const direction = axes.trade.direction;
  const corridorDistance = Math.abs(candidate.x * -direction.y + candidate.y * direction.x);

  let score = -relief * 0.025;
  if (ground === 'hardpack') score += 1.2;
  if (ground === 'gravel') score += 0.75;
  if (ground === 'dunes') score -= 1.7;
  if (candidate.source !== 'open-ground') score += 0.35;

  if (category === 'settlement' || category === 'agriculture') {
    score += suitability * 4.2;
    score += Math.exp(-waterDistance / 620) * (category === 'agriculture' ? 4.6 : 3.8);
  } else if (category === 'industrial' || category === 'commerce' || category === 'security') {
    score += Math.exp(-corridorDistance / 740) * 3.2;
    score += relief < 45 ? 1.1 : -0.8;
  } else if (category === 'military') {
    score += clamp(elevation / 420, -0.3, 2.2);
    score += clamp(radial / (worldSize * 0.35), 0, 1.8);
    score -= Math.exp(-waterDistance / 260) * 1.5;
  }

  if (type === 'town') {
    const desired = worldSize * 0.29;
    score -= Math.abs(radial - desired) / (worldSize * 0.16);
  }
  if (type === 'sam_site') score += elevation / 350;
  if (nearestSpacing < Infinity) {
    if (clustered) {
      score += Math.exp(-Math.max(0, nearestSpacing - 200) / 360) * 2.2;
    } else {
      score += Math.min(nearestSpacing / 1800, 0.8);
    }
  }
  return score;
}

function placeAnchor(type, index, profile, terrain, axes, worldSize, placed, rng) {
  const meta = ANCHOR_META[type];
  const scaleFactor = clamp(worldSize / 7200, 0.9, 2.05);
  const scale = randomBetween(rng, meta.scale[0], meta.scale[1]) * scaleFactor;
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 380; attempt++) {
    const candidate = chooseCandidateSource(type, terrain, scale, axes, worldSize * 0.5, rng);
    const score = scoreCandidate(
      candidate,
      type,
      meta.category,
      scale,
      terrain,
      axes,
      worldSize,
      placed
    );
    if (Number.isFinite(score) && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  // A deterministic lattice fallback keeps unusual terrain implementations usable.
  if (!best) {
    const columns = 4;
    const row = Math.floor(index / columns);
    const column = index % columns;
    const usable = worldSize * 0.72;
    let x = -usable * 0.5 + (column / (columns - 1)) * usable;
    let y = -usable * 0.5 + (row / 3) * usable;
    if (HOSTILE_CATEGORIES.has(meta.category) && Math.hypot(x, y) < worldSize * 0.17) {
      x += worldSize * 0.2;
    }
    best = { x, y, source: 'fallback-grid', axis: axes.trade.angle };
  }

  const axis = nearestWadiAxis(terrain, best.x, best.y, best.axis ?? axes.trade.angle);
  const tags = [...meta.tags, profile.id, best.source, terrainType(terrain, best.x, best.y)];
  return {
    id: `anchor-${String(index + 1).padStart(2, '0')}`,
    type,
    scale,
    category: meta.category,
    x: best.x,
    y: best.y,
    axis,
    crossAxis: axis + Math.PI * 0.5,
    source: best.source,
    terrainType: terrainType(terrain, best.x, best.y),
    suitability: terrainSuitability(terrain, best.x, best.y),
    elevation: terrainElevation(terrain, best.x, best.y),
    tags,
  };
}

function nearestWaterPoint(terrain, point) {
  let best = null;
  for (const oasis of terrain?.oases || []) {
    const distance = Math.hypot(point.x - oasis.x, point.y - oasis.y);
    if (!best || distance < best.distance) best = { x: oasis.x, y: oasis.y, distance };
  }
  for (const wadi of terrain?.wadis || []) {
    const hit = nearestPointOnPolyline(wadi.points, point.x, point.y);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

function makeArea(id, type, footprint, tags, anchorId = null) {
  const bounds = boundsFromPoints(footprint);
  return {
    id,
    type,
    geometry: 'area',
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
    footprint,
    bounds,
    anchorId,
    tags,
  };
}

function irregularPlot(center, axis, width, depth, rng) {
  const points = [];
  const sides = randomInt(rng, 7, 10);
  for (let i = 0; i < sides; i++) {
    const turn = (i / sides) * TAU + randomBetween(rng, -0.16, 0.16);
    const along = Math.cos(turn) * width * 0.5 * randomBetween(rng, 0.72, 1.22);
    const across = Math.sin(turn) * depth * 0.5 * randomBetween(rng, 0.72, 1.22);
    points.push(localToWorld(center, axis, along, across));
  }
  return points;
}

function makeTrack(id, points, width, tags, anchorId = null) {
  return {
    id,
    type: 'farm_track',
    geometry: 'line',
    x: points[Math.floor(points.length / 2)].x,
    y: points[Math.floor(points.length / 2)].y,
    points,
    width,
    bounds: boundsFromPoints(points),
    anchorId,
    tags,
  };
}

function buildLandUse(profile, anchors, terrain, rng) {
  const landUse = [];
  let id = 1;
  const nextId = () => `landuse-${String(id++).padStart(3, '0')}`;

  for (const anchor of anchors) {
    if (anchor.type !== 'farm' && anchor.type !== 'village' && anchor.type !== 'compound') continue;
    const fieldCount =
      anchor.type === 'farm'
        ? randomInt(rng, profile.id === 'alluvial_palm' ? 6 : 4, 10)
        : randomInt(rng, 3, 6);
    const fieldCenters = [];
    for (let field = 0; field < fieldCount; field++) {
      const side = field % 2 === 0 ? -1 : 1;
      const along = (field - (fieldCount - 1) * 0.5) * anchor.scale * 0.2;
      const across = side * anchor.scale * randomBetween(rng, 0.28, 0.78);
      const center = localToWorld(anchor, anchor.axis, along, across);
      fieldCenters.push(center);
      const width = anchor.scale * randomBetween(rng, 0.26, 0.5);
      const depth = anchor.scale * randomBetween(rng, 0.16, 0.38);
      const type =
        profile.id === 'alluvial_palm' && (field === 0 || rng() < 0.48)
          ? 'palm_grove'
          : rng() < 0.18
            ? 'scrub'
            : 'field';
      const area = makeArea(
        nextId(),
        type,
        irregularPlot(center, anchor.axis + randomBetween(rng, -0.22, 0.22), width, depth, rng),
        [
          'productive-land',
          type === 'palm_grove'
            ? 'date-palms'
            : type === 'scrub'
              ? 'desert-scrub'
              : 'irrigated-field',
          profile.id,
        ],
        anchor.id
      );
      area.tint = randomBetween(rng, 0, 1);
      area.angle = anchor.axis + randomBetween(rng, -0.22, 0.22);
      landUse.push(area);
      landUse.push(
        makeTrack(
          nextId(),
          meanderPolyline(
            { x: anchor.x, y: anchor.y },
            center,
            rng,
            randomInt(rng, 2, 4),
            randomBetween(rng, 14, 32)
          ),
          randomBetween(rng, 3.1, 4.8),
          ['farm-track', 'dirt', profile.id],
          anchor.id
        )
      );
    }
    for (let i = 0; i < fieldCenters.length - 1; i++) {
      if (rng() > 0.62) continue;
      landUse.push(
        makeTrack(
          nextId(),
          meanderPolyline(fieldCenters[i], fieldCenters[i + 1], rng, 2, randomBetween(rng, 10, 22)),
          randomBetween(rng, 2.8, 4.2),
          ['farm-track', 'field-link', profile.id],
          anchor.id
        )
      );
    }

    if (profile.id !== 'desert_logistics' || anchor.type === 'farm') {
      const water = nearestWaterPoint(terrain, anchor);
      const canalEnd = localToWorld(anchor, anchor.axis, 0, anchor.scale * 0.48);
      const start = water
        ? { x: water.x, y: water.y }
        : localToWorld(anchor, anchor.axis, -anchor.scale * 0.8, anchor.scale * 0.5);
      const points = [
        start,
        {
          x: (start.x + canalEnd.x) * 0.5 + Math.cos(anchor.crossAxis) * 12,
          y: (start.y + canalEnd.y) * 0.5 + Math.sin(anchor.crossAxis) * 12,
        },
        canalEnd,
      ];
      landUse.push({
        id: nextId(),
        type: profile.id === 'wadi_piedmont' ? 'falaj_channel' : 'irrigation_canal',
        geometry: 'line',
        x: points[1].x,
        y: points[1].y,
        points,
        width: profile.id === 'alluvial_palm' ? 7 : 4,
        bounds: boundsFromPoints(points),
        anchorId: anchor.id,
        tags: ['water-control', 'irrigation', profile.id],
      });
    }
  }

  if ((profile.id === 'alluvial_palm' || profile.id === 'desert_logistics') && terrain?.basin) {
    const basin = terrain.basin;
    const radius = Math.max(150, Math.min(410, basin.radius * 0.7));
    const footprint = regularPolygon(basin.x, basin.y, radius, 14, rng() * 0.3).map(
      (point, index) => {
        const factor = index % 2 === 0 ? 1 : 0.82;
        return {
          x: basin.x + (point.x - basin.x) * factor,
          y: basin.y + (point.y - basin.y) * factor * 0.62,
        };
      }
    );
    landUse.push(makeArea(nextId(), 'sabkha', footprint, ['saline-flat', 'seasonal-inundation']));
  }

  for (const wadi of terrain?.wadis || []) {
    if (!wadi.points || wadi.points.length < 3) continue;
    const groveCount = wadi.order === 1 ? randomInt(rng, 3, 6) : randomInt(rng, 2, 3);
    for (let grove = 0; grove < groveCount; grove++) {
      const index = randomInt(rng, 1, Math.max(1, wadi.points.length - 2));
      const point = wadi.points[index];
      const next = wadi.points[index + 1] || point;
      const angle = Math.atan2(next.y - point.y, next.x - point.x);
      const side = grove % 2 === 0 ? 1 : -1;
      const center = {
        x: point.x - Math.sin(angle) * (wadi.width * 0.45 + 28) * side,
        y: point.y + Math.cos(angle) * (wadi.width * 0.45 + 28) * side,
      };
      const kind = profile.id === 'desert_logistics' && rng() < 0.55 ? 'scrub' : 'palm_grove';
      const groveArea = makeArea(
        nextId(),
        kind,
        irregularPlot(center, angle, randomBetween(rng, 78, 150), randomBetween(rng, 46, 88), rng),
        [kind === 'scrub' ? 'wadi-scrub' : 'wadi-palms', profile.id]
      );
      groveArea.tint = randomBetween(rng, 0, 1);
      landUse.push(groveArea);
    }
    if (wadi.order === 1 && wadi.points.length >= 4) {
      const offsetPoints = [];
      const step = Math.max(1, Math.floor(wadi.points.length / 7));
      for (let i = 0; i < wadi.points.length; i += step) {
        const point = wadi.points[i];
        const next = wadi.points[Math.min(i + 1, wadi.points.length - 1)];
        const angle = Math.atan2(next.y - point.y, next.x - point.x);
        offsetPoints.push({
          x: point.x - Math.sin(angle) * (wadi.width * 0.55 + 18),
          y: point.y + Math.cos(angle) * (wadi.width * 0.55 + 18),
        });
      }
      if (offsetPoints.length >= 2) {
        landUse.push(
          makeTrack(nextId(), offsetPoints, randomBetween(rng, 3.4, 5.2), [
            'wadi-track',
            'dirt',
            profile.id,
          ])
        );
      }
    }
  }

  const civilians = anchors.filter(
    (anchor) =>
      anchor.type === 'farm' ||
      anchor.type === 'village' ||
      anchor.type === 'compound' ||
      anchor.type === 'town'
  );
  let patches = 0;
  for (let i = 0; i < civilians.length && patches < 16; i++) {
    for (let j = i + 1; j < civilians.length && patches < 16; j++) {
      const a = civilians[i];
      const b = civilians[j];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      if (span < 180 || span > 620 || rng() > 0.42) continue;
      const mid = {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
      };
      const kind =
        profile.id === 'desert_logistics' && rng() < 0.5
          ? 'scrub'
          : rng() < 0.55
            ? 'palm_grove'
            : 'field';
      const patch = makeArea(
        nextId(),
        kind,
        irregularPlot(
          mid,
          Math.atan2(b.y - a.y, b.x - a.x),
          randomBetween(rng, 55, 110),
          randomBetween(rng, 34, 68),
          rng
        ),
        ['in-between', kind === 'field' ? 'irrigated-field' : kind, profile.id]
      );
      patch.tint = randomBetween(rng, 0, 1);
      landUse.push(patch);
      patches++;
    }
  }

  for (const anchor of anchors.filter((item) => item.category === 'industrial')) {
    const center = localToWorld(anchor, anchor.axis, 0, anchor.scale * 0.62);
    landUse.push(
      makeArea(
        nextId(),
        'service_yard',
        orientedRectangle(center.x, center.y, anchor.scale * 0.7, anchor.scale * 0.32, anchor.axis),
        ['graded-yard', 'freight-handling', profile.id],
        anchor.id
      )
    );
  }
  return landUse;
}

/**
 * Choose one grounded regional profile and emit typed physical demand anchors.
 */
export function generateRegion(seed, worldSize, terrain, act = 1) {
  const rng = mulberry32(deriveSeed(seed, 'region-profile'));
  const profiles = Object.values(REGION_PROFILES);
  const profile = profiles[Math.floor(rng() * profiles.length)];
  const dipAngle =
    terrain?.dip && Number.isFinite(terrain.dip.x) && Number.isFinite(terrain.dip.y)
      ? Math.atan2(terrain.dip.y, terrain.dip.x)
      : rng() * TAU;
  const tradeAngle =
    profile.id === 'desert_logistics'
      ? dipAngle + randomBetween(rng, -0.7, 0.7)
      : dipAngle + Math.PI * 0.5 + randomBetween(rng, -0.32, 0.32);
  const waterAngle =
    profile.id === 'alluvial_palm'
      ? nearestWadiAxis(terrain, 0, 0, dipAngle)
      : dipAngle + randomBetween(rng, -0.18, 0.18);
  const tradeDirection = directionFromAngle(tradeAngle);
  const waterDirection = directionFromAngle(waterAngle);
  const half = worldSize * 0.5;
  const axes = {
    trade: {
      id: 'axis-trade',
      angle: tradeAngle,
      direction: tradeDirection,
      from: rayToOperationalBoundary({ x: -tradeDirection.x, y: -tradeDirection.y }, half, 45),
      to: rayToOperationalBoundary(tradeDirection, half, 45),
      tags: ['regional-road-demand', profile.id],
    },
    water: {
      id: 'axis-water',
      angle: waterAngle,
      direction: waterDirection,
      tags: ['drainage', 'irrigation-orientation', profile.id],
    },
    field: {
      id: 'axis-field',
      angle: waterAngle + Math.PI * 0.5,
      direction: directionFromAngle(waterAngle + Math.PI * 0.5),
      tags: ['plot-orientation', profile.id],
    },
  };

  const extra = Math.max(0, (Math.floor(act) || 1) - 1) * 3;
  const targetCount = randomInt(rng, 26 + extra, 32 + extra);
  const typePlan = buildTypePlan(profile.id, targetCount, rng);
  const anchors = [];
  for (let index = 0; index < typePlan.length; index++) {
    anchors.push(
      placeAnchor(typePlan[index], index, profile, terrain, axes, worldSize, anchors, rng)
    );
  }
  const landUse = buildLandUse(profile, anchors, terrain, rng);

  const region = {
    id: `region-${profile.id}`,
    profile: profile.id,
    profileId: profile.id,
    name: profile.name,
    description: profile.description,
    climate: 'hot-arid',
    bounds: {
      minX: -half,
      minY: -half,
      maxX: half,
      maxY: half,
      width: worldSize,
      height: worldSize,
    },
    axes,
    resources: { ...profile.resources },
    destinationAnchors: anchors,
    anchorIds: anchors.map((anchor) => anchor.id),
    tags: [...profile.tags],
  };
  return { region, landUse, anchors };
}

export const buildRegion = generateRegion;

/**
 * Demand-driven regional transport for WORLD_GEN v4.
 *
 * Every destination is a terminal in one connected network. Regional roads
 * use terrain-cost A*; local street geometry is added later by places.js.
 */

import { mulberry32 } from '../rng.js';
import {
  clamp,
  deriveSeed,
  distance,
  localToWorld,
  nearestPointOnPolyline as projectToPolyline,
  polylineLength,
  simplifyPolyline,
} from './geometry.js';

const TERRAIN_COST = Object.freeze({
  hardpack: 0.72,
  gravel: 0.92,
  sand: 1,
  wadi: 1.12,
  oasis: 2.6,
  dunes: 2.75,
  rock: 7.5,
});

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function sampleTerrain(terrain, x, y) {
  if (typeof terrain?.typeAndElevation === 'function') return terrain.typeAndElevation(x, y);
  return {
    type: typeof terrain?.type === 'function' ? terrain.type(x, y) : 'sand',
    elevation: typeof terrain?.elevation === 'function' ? terrain.elevation(x, y) : 0,
  };
}

function buildCostGrid(terrain, worldSize) {
  const targetCell = clamp(worldSize / 82, 64, 160);
  const count = Math.max(16, Math.ceil(worldSize / targetCell));
  const cell = worldSize / count;
  const half = worldSize * 0.5;
  const costs = new Float32Array(count * count);
  const elevations = new Float32Array(count * count);
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      const x = -half + (column + 0.5) * cell;
      const y = -half + (row + 0.5) * cell;
      const sample = sampleTerrain(terrain, x, y);
      const index = row * count + column;
      costs[index] = TERRAIN_COST[sample.type] ?? 1.35;
      elevations[index] = Number.isFinite(sample.elevation) ? sample.elevation : 0;
    }
  }
  return { count, cell, half, costs, elevations };
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(score, node) {
    const item = { score, node };
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        const left = index * 2 + 1;
        const right = left + 1;
        let child = left;
        if (
          right < this.items.length &&
          this.items[right].score < this.items[left].score
        ) {
          child = right;
        }
        if (this.items[child].score >= last.score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function leastCostPath(startPoint, endPoint, grid, buffers) {
  const { count, cell, half, costs, elevations } = grid;
  const toCell = (point) => ({
    column: clamp(Math.floor((point.x + half) / cell), 0, count - 1),
    row: clamp(Math.floor((point.y + half) / cell), 0, count - 1),
  });
  const startCell = toCell(startPoint);
  const endCell = toCell(endPoint);
  const start = startCell.row * count + startCell.column;
  const goal = endCell.row * count + endCell.column;
  if (start === goal) return [{ ...startPoint }, { ...endPoint }];

  const scores = buffers.scores;
  scores.fill(Infinity);
  const previous = buffers.previous;
  previous.fill(-1);
  const closed = buffers.closed;
  closed.fill(0);
  const heap = new MinHeap();
  const heuristic = (index) => {
    const column = index % count;
    const row = Math.floor(index / count);
    return Math.hypot(column - endCell.column, row - endCell.row) * cell * 0.7;
  };

  scores[start] = 0;
  heap.push(heuristic(start), start);
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < count * count * 8) {
    const current = heap.pop().node;
    if (closed[current]) continue;
    if (current === goal) {
      found = true;
      break;
    }
    closed[current] = 1;
    const column = current % count;
    const row = Math.floor(current / count);

    for (const [dx, dy] of DIRECTIONS) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= count || nextRow >= count) continue;
      const next = nextRow * count + nextColumn;
      if (closed[next]) continue;
      const stepLength = dx && dy ? cell * Math.SQRT2 : cell;
      const slope = Math.abs(elevations[next] - elevations[current]) / Math.max(1, stepLength);
      const transitionCost =
        stepLength * ((costs[current] + costs[next]) * 0.5 + Math.min(4.5, slope * 6));
      const score = scores[current] + transitionCost;
      if (score < scores[next]) {
        scores[next] = score;
        previous[next] = current;
        heap.push(score + heuristic(next), next);
      }
    }
  }

  if (!found) return [{ ...startPoint }, { ...endPoint }];
  const points = [];
  let current = goal;
  while (current !== -1) {
    const column = current % count;
    const row = Math.floor(current / count);
    points.push({
      x: -half + (column + 0.5) * cell,
      y: -half + (row + 0.5) * cell,
    });
    if (current === start) break;
    current = previous[current];
  }
  points.reverse();
  points[0] = { ...startPoint };
  points[points.length - 1] = { ...endPoint };
  return simplifyPolyline(points, cell * 1.05, 0.13);
}

function pointsEqual(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
}

function cleanPath(points) {
  const output = [];
  for (const point of points) {
    if (!output.length || !pointsEqual(point, output[output.length - 1])) output.push(point);
  }
  if (output.length === 1) output.push({ x: output[0].x + 0.01, y: output[0].y });
  return output;
}

export function nearestPointOnPolyline(points, x, y) {
  return projectToPolyline(points, x, y);
}

export function nearestRoadPoint(roads, x, y, predicate = null) {
  let best = null;
  for (const road of roads || []) {
    if (predicate && !predicate(road)) continue;
    const hit = projectToPolyline(road.points, x, y);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { ...hit, road, roadId: road.id };
    }
  }
  return best;
}

export function nearestRoad(roads, x, y, predicate = null) {
  return nearestRoadPoint(roads, x, y, predicate);
}

function boundaryGateway(id, point, direction, tags) {
  return {
    id,
    x: point.x,
    y: point.y,
    direction,
    tags: ['edge-gateway', ...tags],
  };
}

function boundaryPointForDirection(direction, worldSize, inset = 36) {
  const half = worldSize * 0.5 - inset;
  const dx = Math.max(1e-6, Math.abs(direction.x));
  const dy = Math.max(1e-6, Math.abs(direction.y));
  const multiplier = Math.min(half / dx, half / dy);
  return { x: direction.x * multiplier, y: direction.y * multiplier };
}

function townGates(town) {
  const axis = Number.isFinite(town?.axis) ? town.axis : 0;
  const scale = Math.max(80, town?.scale || 400);
  return {
    a: localToWorld(town, axis, -scale * 0.48, 0),
    b: localToWorld(town, axis, scale * 0.48, 0),
  };
}

function approachGate(anchor, toward) {
  if (!anchor || !Number.isFinite(anchor.x) || !toward) return toward;
  const axis = Number.isFinite(anchor.axis) ? anchor.axis : 0;
  const scale = Math.max(80, anchor.scale || 160);
  const dx = toward.x - anchor.x;
  const dy = toward.y - anchor.y;
  const c = Math.cos(axis);
  const s = Math.sin(axis);
  const along = dx * c + dy * s;
  const across = -dx * s + dy * c;
  if (Math.abs(along) >= Math.abs(across) * 0.72) {
    return localToWorld(anchor, axis, (along >= 0 ? 1 : -1) * scale * 0.48, 0);
  }
  return localToWorld(anchor, axis, 0, (across >= 0 ? 1 : -1) * scale * 0.36);
}

/**
 * Route gateways and destination demand into a single connected hierarchy.
 */
export function generateTransport(seed, worldSize, terrain, region) {
  const rng = mulberry32(deriveSeed(seed, 'transport'));
  const anchors = region?.destinationAnchors || [];
  const roads = [];
  const connections = {};
  const grid = buildCostGrid(terrain, worldSize);
  const cellCount = grid.count * grid.count;
  const pathBuffers = {
    scores: new Float64Array(cellCount),
    previous: new Int32Array(cellCount),
    closed: new Uint8Array(cellCount),
  };
  let roadNumber = 1;

  const addRoad = (start, end, hierarchy, surface, width, tags) => {
    const points = cleanPath(leastCostPath(start, end, grid, pathBuffers));
    const road = {
      id: `road-${String(roadNumber++).padStart(3, '0')}`,
      points,
      width,
      surface,
      hierarchy,
      tags: [...tags],
    };
    roads.push(road);
    return road;
  };

  const tradeDirection = region?.axes?.trade?.direction || { x: 1, y: 0 };
  const opposite = { x: -tradeDirection.x, y: -tradeDirection.y };
  const gateways = [
    boundaryGateway(
      'gateway-westbound',
      boundaryPointForDirection(opposite, worldSize),
      opposite,
      ['regional-highway']
    ),
    boundaryGateway(
      'gateway-eastbound',
      boundaryPointForDirection(tradeDirection, worldSize),
      tradeDirection,
      ['regional-highway']
    ),
  ];
  if (rng() < 0.72) {
    const side = rng() < 0.5 ? -1 : 1;
    const branchDirection = {
      x: -tradeDirection.y * side,
      y: tradeDirection.x * side,
    };
    gateways.push(
      boundaryGateway(
        'gateway-freight-branch',
        boundaryPointForDirection(branchDirection, worldSize),
        branchDirection,
        ['freight-branch']
      )
    );
  }

  const town = anchors.find((anchor) => anchor.type === 'town') || anchors[0] || { x: 0, y: 0 };
  const gates = townGates(town);
  const inboundUsesA = distance(gateways[0], gates.a) <= distance(gateways[0], gates.b);
  const inbound = addRoad(
    gateways[0],
    inboundUsesA ? gates.a : gates.b,
    'highway',
    'paved',
    randomBetween(rng, 30, 38),
    ['regional', 'gateway', `gateway:${gateways[0].id}`, `anchor:${town.id || 'town'}`]
  );
  const outbound = addRoad(
    inboundUsesA ? gates.b : gates.a,
    gateways[1],
    'highway',
    'paved',
    randomBetween(rng, 30, 38),
    ['regional', 'gateway', `gateway:${gateways[1].id}`, `anchor:${town.id || 'town'}`]
  );
  if (town.id) connections[town.id] = [inbound.id, outbound.id];

  if (gateways[2]) {
    const branchCandidates = anchors.filter(
      (anchor) =>
        anchor.category === 'industrial' ||
        anchor.type === 'village' ||
        anchor.type === 'roadside_service'
    );
    let branchTarget = town;
    let bestDemand = -Infinity;
    for (const anchor of branchCandidates) {
      const distanceToGateway = Math.hypot(anchor.x - gateways[2].x, anchor.y - gateways[2].y);
      const demand = anchor.scale - distanceToGateway * 0.08;
      if (demand > bestDemand) {
        bestDemand = demand;
        branchTarget = anchor;
      }
    }
    const branch = addRoad(
      gateways[2],
      approachGate(branchTarget, gateways[2]),
      'highway',
      'paved',
      randomBetween(rng, 25, 32),
      [
        'regional',
        'freight',
        `gateway:${gateways[2].id}`,
        `anchor:${branchTarget.id || 'town'}`,
      ]
    );
    if (branchTarget.id) {
      connections[branchTarget.id] = [...(connections[branchTarget.id] || []), branch.id];
    }
  }

  const connectOrder = anchors
    .filter((anchor) => anchor.id !== town.id)
    .sort((a, b) => b.scale - a.scale || a.id.localeCompare(b.id));
  for (const anchor of connectOrder) {
    const nearest = nearestRoadPoint(
      roads,
      anchor.x,
      anchor.y,
      (road) => road.hierarchy === 'highway' || road.hierarchy === 'secondary'
    );
    const target = nearest ? { x: nearest.x, y: nearest.y } : town;
    const major =
      anchor.category === 'settlement' ||
      anchor.category === 'industrial' ||
      anchor.category === 'commerce';
    const hierarchy = major ? 'secondary' : 'access';
    const surface =
      anchor.type === 'village' ||
      anchor.type === 'roadside_service' ||
      anchor.type === 'fuel_depot' ||
      anchor.type === 'industrial_depot'
        ? 'paved'
        : anchor.category === 'agriculture'
          ? 'track'
          : 'dirt';
    const width =
      hierarchy === 'secondary'
        ? randomBetween(rng, 16, 23)
        : anchor.type === 'checkpoint'
          ? randomBetween(rng, 13, 18)
          : randomBetween(rng, 9, 15);
    const road = addRoad(approachGate(anchor, target), target, hierarchy, surface, width, [
      'destination-connector',
      `anchor:${anchor.id}`,
      `destination:${anchor.type}`,
      nearest ? `joins:${nearest.roadId}` : `joins:${town.id}`,
    ]);
    connections[anchor.id] = [...(connections[anchor.id] || []), road.id];
  }

  // Connectivity is an invariant, represented explicitly rather than inferred
  // from near-coincident rendered points.
  for (const anchor of anchors) {
    if (!connections[anchor.id]?.length) {
      const nearest = nearestRoadPoint(roads, anchor.x, anchor.y);
      const target = nearest ? nearest : town;
      const road = addRoad(approachGate(anchor, target), target, 'access', 'track', 9, [
        'destination-connector',
        'connectivity-fallback',
        `anchor:${anchor.id}`,
      ]);
      connections[anchor.id] = [road.id];
    }
  }

  return {
    roads,
    gateways,
    connections,
    totalRoadLength: roads.reduce((sum, road) => sum + polylineLength(road.points), 0),
  };
}

export const buildTransport = generateTransport;

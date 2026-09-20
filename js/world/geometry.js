/**
 * Small dependency-free geometry kernel for WORLD_GEN v4.
 *
 * Polygons are arrays of `{ x, y }` in world space. Rotations are radians.
 * Generation code keeps these shapes authoritative; x/y values are only
 * convenient indexes into the geometry.
 */

export const TAU = Math.PI * 2;
export const EPSILON = 1e-9;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpPoint(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Winding dirt-lane between two points. Amplitude is world units. */
export function meanderPolyline(a, b, rng, bends = 2, amplitude = 36) {
  const points = [{ x: a.x, y: a.y }];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const count = Math.max(1, Math.floor(bends));
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const offset = (rng() * 2 - 1) * amplitude * Math.sin(Math.PI * t);
    points.push({
      x: a.x + dx * t + nx * offset,
      y: a.y + dy * t + ny * offset,
    });
  }
  points.push({ x: b.x, y: b.y });
  return points;
}

export function distanceSq(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector, fallback = { x: 1, y: 0 }) {
  const magnitude = length(vector);
  if (magnitude <= EPSILON) return { x: fallback.x, y: fallback.y };
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

export function perpendicular(vector) {
  return { x: -vector.y, y: vector.x };
}

export function directionFromAngle(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function angleOf(vector) {
  return Math.atan2(vector.y, vector.x);
}

export function localToWorld(origin, rotation, along, across) {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: origin.x + along * c - across * s,
    y: origin.y + along * s + across * c,
  };
}

export function worldToLocal(origin, rotation, point) {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: dx * c + dy * s,
    y: -dx * s + dy * c,
  };
}

export function rotatePoint(point, origin, rotation) {
  const local = worldToLocal(origin, 0, point);
  return localToWorld(origin, rotation, local.x, local.y);
}

export function orientedRectangle(cx, cy, width, depth, rotation = 0) {
  const origin = { x: cx, y: cy };
  const hw = width * 0.5;
  const hd = depth * 0.5;
  return [
    localToWorld(origin, rotation, -hw, -hd),
    localToWorld(origin, rotation, hw, -hd),
    localToWorld(origin, rotation, hw, hd),
    localToWorld(origin, rotation, -hw, hd),
  ];
}

export function regularPolygon(cx, cy, radius, sides = 12, rotation = 0) {
  const points = [];
  const count = Math.max(3, Math.floor(sides));
  for (let i = 0; i < count; i++) {
    const angle = rotation + (i / count) * TAU;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

export function polygonArea(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea * 0.5;
}

export function polygonCentroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    crossSum += cross;
    xSum += (a.x + b.x) * cross;
    ySum += (a.y + b.y) * cross;
  }
  if (Math.abs(crossSum) <= EPSILON) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  return { x: xSum / (3 * crossSum), y: ySum / (3 * crossSum) };
}

export function boundsFromPoints(points) {
  if (!points || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function expandBounds(bounds, amount) {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

export function pointInBounds(point, bounds) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq <= EPSILON ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

export function nearestPointOnPolyline(points, x, y) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) {
    return {
      x: points[0].x,
      y: points[0].y,
      distance: Math.hypot(x - points[0].x, y - points[0].y),
      segmentIndex: 0,
      t: 0,
      angle: 0,
    };
  }
  const query = { x, y };
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const hit = distancePointToSegment(query, points[i], points[i + 1]);
    if (!best || hit.distance < best.distance) {
      best = {
        ...hit,
        segmentIndex: i,
        angle: Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x),
      };
    }
  }
  return best;
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length || 0); i++) total += distance(points[i - 1], points[i]);
  return total;
}

export function cumulativePolylineLengths(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  }
  return cumulative;
}

export function pointAlongPolyline(points, amount, cumulative = null) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return { ...points[0], angle: 0, segmentIndex: 0 };
  const lengths = cumulative || cumulativePolylineLengths(points);
  const total = lengths[lengths.length - 1];
  const target = clamp(amount, 0, total);
  let lo = 1;
  let hi = lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const index = Math.max(0, lo - 1);
  const segmentLength = lengths[index + 1] - lengths[index] || EPSILON;
  const t = (target - lengths[index]) / segmentLength;
  const a = points[index];
  const b = points[index + 1];
  return {
    ...lerpPoint(a, b, t),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    segmentIndex: index,
    t,
  };
}

export function densifyPolyline(points, spacing = 50) {
  if (!points || points.length < 2) return points ? points.map((point) => ({ ...point })) : [];
  const cumulative = cumulativePolylineLengths(points);
  const total = cumulative[cumulative.length - 1];
  if (total <= EPSILON) return [{ ...points[0] }, { ...points[points.length - 1] }];
  const output = [];
  for (let amount = 0; amount < total; amount += Math.max(1, spacing)) {
    const point = pointAlongPolyline(points, amount, cumulative);
    output.push({ x: point.x, y: point.y });
  }
  output.push({ ...points[points.length - 1] });
  return output;
}

export function simplifyPolyline(points, minSpacing = 35, angleTolerance = 0.08) {
  if (!points || points.length <= 2) return points ? points.map((point) => ({ ...point })) : [];
  const spaced = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(spaced[spaced.length - 1], points[i]) >= minSpacing) {
      spaced.push({ ...points[i] });
    }
  }
  spaced.push({ ...points[points.length - 1] });
  if (spaced.length <= 2) return spaced;

  const output = [spaced[0]];
  for (let i = 1; i < spaced.length - 1; i++) {
    const a = output[output.length - 1];
    const b = spaced[i];
    const c = spaced[i + 1];
    const first = Math.atan2(b.y - a.y, b.x - a.x);
    const second = Math.atan2(c.y - b.y, c.x - b.x);
    const turn = Math.abs(Math.atan2(Math.sin(second - first), Math.cos(second - first)));
    if (turn >= angleTolerance) output.push(b);
  }
  output.push(spaced[spaced.length - 1]);
  return output;
}

export function segmentFootprint(a, b, width) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return orientedRectangle(
    (a.x + b.x) * 0.5,
    (a.y + b.y) * 0.5,
    Math.max(distance(a, b), EPSILON),
    width,
    angle
  );
}

export function polygonIntersectsPolygon(a, b) {
  if (!a?.length || !b?.length) return false;
  if (!boundsOverlap(boundsFromPoints(a), boundsFromPoints(b))) return false;
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) {
        return true;
      }
    }
  }
  return false;
}

export function boundsOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Stable integer stream derivation; labels isolate generation phases. */
export function deriveSeed(seed, label) {
  let hash = (seed >>> 0) ^ 0x9e3779b9;
  const text = String(label);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

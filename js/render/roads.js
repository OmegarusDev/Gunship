/**
 * render/roads.js — hierarchy-aware roads. Asphalt reads as a ribbon;
 * dirt and alleys read as packed earth and ruts, not faded highway paint.
 */
import { clamp } from '../rng.js';
import { withAlpha } from '../drawUtil.js';

const HIER = {
  alley: 0,
  service: 0,
  local: 1,
  perimeter: 1,
  access: 2,
  secondary: 3,
  highway: 4,
};

const STYLE = {
  highway: {
    edge: '#3a3428',
    fill: '#585040',
    lip: '#7a7060',
    shoulder: 3.4,
    mark: 'dash',
    markColor: 'rgba(214,176,74,0.78)',
    markWidth: 1.8,
    dash: [22, 14],
  },
  secondary: {
    edge: '#453c2e',
    fill: '#6a5e4a',
    lip: '#8a7c64',
    shoulder: 2.4,
    mark: 'dash',
    markColor: 'rgba(196,168,96,0.5)',
    markWidth: 1.25,
    dash: [16, 18],
  },
  local: {
    edge: '#5a4630',
    fill: '#8a7048',
    shoulder: 1.8,
    mark: 'none',
  },
  dirt: {
    edge: '#6a5434',
    fill: '#9a8254',
    shoulder: 1.5,
    mark: 'ruts',
    rutColor: 'rgba(40,28,14,0.16)',
  },
  alley: {
    edge: '#4a3a26',
    fill: '#6e5a3a',
    shoulder: 1.05,
    mark: 'ruts',
    rutColor: 'rgba(30,22,12,0.22)',
  },
};

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
  const b = clamp((n & 0xff) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function styleFor(road) {
  const hier = road.hierarchy || 'local';
  const surface = road.surface || 'dirt';
  if (hier === 'highway') return STYLE.highway;
  if (hier === 'secondary' && surface === 'paved') return STYLE.secondary;
  if (hier === 'alley' || hier === 'service') return STYLE.alley;
  if (surface === 'paved') return STYLE.secondary;
  if (hier === 'local' || hier === 'perimeter' || surface === 'compacted') return STYLE.local;
  return STYLE.dirt;
}

function offsetPoints(pts, sideDist) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const r = pts[Math.max(i - 1, 0)];
    let nx = -(q.y - r.y);
    let ny = q.x - r.x;
    const l = Math.hypot(nx, ny) || 1;
    out.push({ x: p.x + (nx / l) * sideDist, y: p.y + (ny / l) * sideDist });
  }
  return out;
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export function drawRoads(ctx, cam, world) {
  if (!world || world.roads.length === 0) return;
  const vb = cam.getVisibleBounds();
  const roads = [];
  for (let i = 0; i < world.roads.length; i++) {
    const road = world.roads[i];
    if (road.points.length < 2) continue;
    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const p of road.points) {
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.y > maxy) maxy = p.y;
    }
    if (maxx < vb.left - 80 || minx > vb.right + 80 || maxy < vb.top - 80 || miny > vb.bottom + 80)
      continue;
    roads.push({ road, idx: i });
  }
  roads.sort((a, b) => (HIER[a.road.hierarchy] || 0) - (HIER[b.road.hierarchy] || 0));
  if (roads.length === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const { road } of roads) {
    const st = styleFor(road);
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = road.width + st.shoulder;
    tracePoly(ctx, road.points);
  }
  for (const { road, idx } of roads) {
    const st = styleFor(road);
    const tone = ((idx * 137) % 9) - 4;
    ctx.strokeStyle = shadeHex(st.fill, tone);
    ctx.lineWidth = road.width;
    tracePoly(ctx, road.points);
    if (st.lip && road.width >= 8) {
      ctx.strokeStyle = withAlpha(st.lip, 0.35);
      ctx.lineWidth = Math.max(1.2, road.width * 0.16);
      tracePoly(ctx, road.points);
    }
  }
  for (const { road } of roads) {
    const st = styleFor(road);
    if (st.mark === 'dash') {
      ctx.strokeStyle = st.markColor;
      ctx.lineWidth = st.markWidth;
      ctx.setLineDash(st.dash);
      ctx.lineCap = 'butt';
      tracePoly(ctx, road.points);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    } else if (st.mark === 'ruts') {
      const off = Math.max(1.15, road.width * 0.2);
      ctx.strokeStyle = st.rutColor;
      ctx.lineWidth = Math.max(1, road.width * 0.16);
      tracePoly(ctx, offsetPoints(road.points, -off));
      tracePoly(ctx, offsetPoints(road.points, off));
    }
  }
}

let _miniRoadsCache = null;
export function getMiniRoads(world, S) {
  const key = `${world?.seed}:${world?.worldGenVersion}:${world?.roads?.length}:${world?.worldSize}`;
  if (_miniRoadsCache && _miniRoadsCache.S === S && _miniRoadsCache.key === key)
    return _miniRoadsCache.c;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const half = world.worldSize / 2;
  const k = S / world.worldSize;
  for (const road of world.roads) {
    if (road.points.length < 2) continue;
    const hier = HIER[road.hierarchy] || 0;
    g.strokeStyle =
      hier >= 4
        ? 'rgba(90,80,64,0.85)'
        : hier >= 3
          ? 'rgba(130,112,80,0.7)'
          : 'rgba(160,138,90,0.42)';
    g.lineWidth = hier >= 4 ? 1.8 : hier >= 3 ? 1.25 : 0.8;
    g.beginPath();
    g.moveTo((road.points[0].x + half) * k, (road.points[0].y + half) * k);
    for (let i = 1; i < road.points.length; i++)
      g.lineTo((road.points[i].x + half) * k, (road.points[i].y + half) * k);
    g.stroke();
  }
  _miniRoadsCache = { S, c, key };
  return c;
}

export function clearRoadCache() {
  _miniRoadsCache = null;
}

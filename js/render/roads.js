/**
 * render/roads.js — road rendering with hierarchy-aware overdraw & minimap cache.
 * Extracted from app.js. Takes world as param instead of closing over global.
 */
import { clamp } from '../rng.js';
import { withAlpha } from '../drawUtil.js';

const ROAD_STYLE = {
  paved: { fill: '#7a6a4a', edge: '#5a4a2a', shoulder: 5 },
  dirt:  { fill: '#9a8a5a', edge: '#6f6038', shoulder: 4 },
  track: { fill: '#a89868', edge: '#83744c', shoulder: 3 },
};

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 0xff) + amt, 0, 255);
  const b = clamp((n & 0xff) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

const HIER = { local: 0, secondary: 1, highway: 2 };

export function drawRoads(ctx, cam, world) {
  if (!world || world.roads.length === 0) return;
  const vb = cam.getVisibleBounds();
  const roads = [];
  for (let i = 0; i < world.roads.length; i++) {
    const road = world.roads[i];
    if (road.points.length < 2) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of road.points) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
    if (maxx < vb.left - 80 || minx > vb.right + 80 || maxy < vb.top - 80 || miny > vb.bottom + 80) continue;
    roads.push({ road, idx: i, minx, miny, maxx, maxy });
  }
  roads.sort((a, b) => (HIER[a.road.hierarchy] || 0) - (HIER[b.road.hierarchy] || 0));
  if (roads.length === 0) return;
  const tracePoly = (pts) => {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const { road } of roads) {
    const st = ROAD_STYLE[road.surface] || ROAD_STYLE.dirt;
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = road.width + st.shoulder;
    tracePoly(road.points);
  }
  for (const { road, idx } of roads) {
    const st = ROAD_STYLE[road.surface] || ROAD_STYLE.dirt;
    const tone = ((idx * 137) % 11) - 5;
    ctx.strokeStyle = shadeHex(st.fill, tone);
    ctx.lineWidth = road.width;
    tracePoly(road.points);
  }
  for (const { road } of roads) {
    const surface = road.surface || 'dirt';
    if (surface === 'dirt') {
      ctx.strokeStyle = withAlpha('#000000', 0.05);
      ctx.lineWidth = road.width * 0.45;
      ctx.setLineDash([4, 10]);
      tracePoly(road.points);
      ctx.setLineDash([]);
    } else if (surface === 'track') {
      const off = Math.max(1.5, road.width * 0.22);
      ctx.strokeStyle = withAlpha('#000000', 0.09);
      ctx.lineWidth = 1.2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const q = road.points[Math.min(i + 1, road.points.length - 1)];
          const r = road.points[Math.max(i - 1, 0)];
          let nx = -(q.y - r.y), ny = q.x - r.x;
          const l = Math.hypot(nx, ny) || 1;
          nx = nx / l * off * side; ny = ny / l * off * side;
          if (i === 0) ctx.moveTo(p.x + nx, p.y + ny); else ctx.lineTo(p.x + nx, p.y + ny);
        }
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = withAlpha('#ccaa66', 0.32);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([14, 22]);
      tracePoly(road.points);
      ctx.setLineDash([]);
    }
  }
}

let _miniRoadsCache = null; // { S, c, worldKey }
export function getMiniRoads(world, S) {
  const key = world?.roads?.length + ':' + world?.worldSize;
  if (_miniRoadsCache && _miniRoadsCache.S === S && _miniRoadsCache.key === key) return _miniRoadsCache.c;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const half = world.worldSize / 2;
  const k = S / world.worldSize;
  g.strokeStyle = 'rgba(170,150,95,0.5)'; g.lineWidth = 1;
  for (const road of world.roads) {
    if (road.points.length < 2) continue;
    g.beginPath();
    g.moveTo((road.points[0].x + half) * k, (road.points[0].y + half) * k);
    for (let i = 1; i < road.points.length; i++) g.lineTo((road.points[i].x + half) * k, (road.points[i].y + half) * k);
    g.stroke();
  }
  _miniRoadsCache = { S, c, key };
  return c;
}

export function clearRoadCache() { _miniRoadsCache = null; }

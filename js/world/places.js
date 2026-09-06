/**
 * Geometry-first place grammars for WORLD_GEN v4.
 *
 * Destinations become streets, frontage parcels, oriented footprints and
 * enclosure geometry. The returned Place records are derived indexes only.
 */
import { mulberry32 } from '../rng.js';
import {
  boundsFromPoints,
  cumulativePolylineLengths,
  deriveSeed,
  distance,
  localToWorld,
  orientedRectangle,
  pointAlongPolyline,
  polygonIntersectsPolygon,
  polylineLength,
  regularPolygon,
} from './geometry.js';
import { nearestRoadPoint } from './transport.js';

const BUILDING_TYPES = Object.freeze({
  courtyard_house: {
    w: [32, 44],
    d: [27, 38],
    h: [9, 14],
    col: '#a8895d',
    tags: ['civilian', 'residential', 'courtyard'],
  },
  house: { w: [24, 34], d: [20, 28], h: [8, 12], col: '#b49363', tags: ['civilian', 'residential'] },
  hut: { w: [18, 27], d: [14, 21], h: [6, 9], col: '#9f8057', tags: ['civilian', 'residential'] },
  shop: { w: [25, 36], d: [20, 28], h: [9, 13], col: '#ae8d5e', tags: ['civilian', 'commerce'] },
  market: { w: [40, 54], d: [30, 42], h: [9, 13], col: '#b29364', tags: ['civilian', 'commerce', 'landmark'] },
  mosque: { w: [36, 48], d: [30, 40], h: [13, 18], col: '#c1a574', tags: ['civilian', 'civic', 'sacred', 'landmark'] },
  minaret: {
    w: [8, 11],
    d: [8, 11],
    h: [36, 52],
    col: '#c4a876',
    tags: ['civilian', 'civic', 'sacred', 'landmark'],
  },
  water_tower: {
    w: [12, 16],
    d: [12, 16],
    h: [24, 36],
    col: '#8d8668',
    tags: ['civilian', 'landmark', 'water'],
  },
  farm_house: { w: [27, 38], d: [22, 31], h: [8, 12], col: '#a58759', tags: ['civilian', 'farm'] },
  shed: { w: [19, 31], d: [15, 24], h: [6, 10], col: '#8e7652', tags: ['civilian', 'agriculture'] },
  depot: {
    w: [38, 58],
    d: [28, 42],
    h: [11, 17],
    col: '#8e866b',
    tags: ['industrial', 'logistics', 'missionEligible', 'supply'],
  },
  warehouse: {
    w: [48, 72],
    d: [34, 50],
    h: [13, 19],
    col: '#827c68',
    tags: ['industrial', 'logistics', 'missionEligible', 'supply'],
  },
  garage: {
    w: [38, 58],
    d: [28, 39],
    h: [10, 15],
    col: '#797765',
    tags: ['industrial', 'vehicle', 'missionEligible'],
  },
  fuel: {
    w: [26, 36],
    d: [26, 36],
    h: [12, 18],
    col: '#77776a',
    tags: ['industrial', 'fuel', 'missionEligible', 'explosive'],
  },
  barracks: {
    w: [42, 62],
    d: [25, 36],
    h: [11, 16],
    col: '#8d8c70',
    tags: ['military', 'garrison', 'missionEligible'],
  },
  bunker: {
    w: [32, 48],
    d: [27, 40],
    h: [7, 11],
    col: '#77745e',
    tags: ['military', 'hardened', 'missionEligible'],
  },
  command: {
    w: [42, 58],
    d: [31, 43],
    h: [13, 18],
    col: '#8f9075',
    tags: ['military', 'command', 'missionEligible', 'highPriority'],
  },
  radar: {
    w: [27, 36],
    d: [27, 36],
    h: [18, 26],
    col: '#898c77',
    tags: ['military', 'radar', 'communications', 'missionEligible', 'highPriority'],
  },
  tower: {
    w: [14, 20],
    d: [14, 20],
    h: [28, 42],
    col: '#777967',
    tags: ['military', 'observation', 'missionEligible'],
  },
  guard_post: {
    w: [19, 27],
    d: [15, 22],
    h: [8, 12],
    col: '#89836a',
    tags: ['military', 'checkpoint', 'missionEligible'],
  },
});

const NAME_PREFIXES = ['Al', 'Umm', 'Ayn', 'Qasr', 'Wadi'];
const NAME_ROOTS = [
  'Qarah',
  'Safra',
  'Nakhil',
  'Hamra',
  'Ruways',
  'Hajar',
  'Samra',
  'Jadid',
  'Rafid',
  'Dhiban',
  'Khayr',
  'Sahil',
  'Mazin',
  'Rimal',
  'Basir',
  'Najm',
  'Fajr',
  'Dujayl',
];

function between(rng, min, max) {
  return min + (max - min) * rng();
}

function pick(rng, values) {
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}

function categoryForAnchor(anchor) {
  if (anchor.category === 'military' || anchor.category === 'security') return 'military';
  if (anchor.category === 'industrial') return 'industrial';
  return 'civilian';
}

function placeName(anchor, index, rng, used) {
  const base = `${pick(rng, NAME_PREFIXES)} ${NAME_ROOTS[(index * 5 + Math.floor(rng() * NAME_ROOTS.length)) % NAME_ROOTS.length]}`;
  let name = base;
  if (anchor.type === 'farm') name = `${base} Farms`;
  else if (anchor.type === 'roadside_service') name = `${base} Services`;
  else if (anchor.type === 'fuel_depot') name = `${base} Fuel Yard`;
  else if (anchor.type === 'industrial_depot') name = `${base} Freight Yard`;
  else if (anchor.type === 'checkpoint') name = `${base} Checkpoint`;
  else if (anchor.type === 'camp') name = `Camp ${base}`;
  else if (anchor.type === 'sam_site') name = `${base} Air-Defense Position`;
  if (used.has(name)) name = `${name} ${index + 1}`;
  used.add(name);
  return name;
}

function makeStreet(id, points, width, surface, hierarchy, tags) {
  return { id, points, width, surface, hierarchy, tags };
}

function roadThrough(id, origin, angle, length, width, surface, hierarchy, tags, bend = 0) {
  const start = localToWorld(origin, angle, -length * 0.5, 0);
  const end = localToWorld(origin, angle, length * 0.5, 0);
  const points =
    Math.abs(bend) > 0.01
      ? [start, localToWorld(origin, angle, 0, bend), end]
      : [start, end];
  return makeStreet(id, points, width, surface, hierarchy, tags);
}

function courtyardFootprint(center, w, d, rotation, wall, openAcross) {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const innerW = Math.max(4, hw - wall);
  const innerD = Math.max(4, hd - wall);
  if (openAcross < 0) {
    return [
      localToWorld(center, rotation, -hw, -hd),
      localToWorld(center, rotation, hw, -hd),
      localToWorld(center, rotation, hw, hd),
      localToWorld(center, rotation, innerW, hd),
      localToWorld(center, rotation, innerW, -innerD),
      localToWorld(center, rotation, -innerW, -innerD),
      localToWorld(center, rotation, -innerW, hd),
      localToWorld(center, rotation, -hw, hd),
    ];
  }
  return [
    localToWorld(center, rotation, -hw, hd),
    localToWorld(center, rotation, hw, hd),
    localToWorld(center, rotation, hw, -hd),
    localToWorld(center, rotation, innerW, -hd),
    localToWorld(center, rotation, innerW, innerD),
    localToWorld(center, rotation, -innerW, innerD),
    localToWorld(center, rotation, -innerW, -hd),
    localToWorld(center, rotation, -hw, -hd),
  ];
}

function makeDistrict(id, placeId, kind, center, width, depth, rotation, tags) {
  const footprint = orientedRectangle(center.x, center.y, width, depth, rotation);
  return {
    id,
    placeId,
    kind,
    x: center.x,
    y: center.y,
    rotation,
    footprint,
    bounds: boundsFromPoints(footprint),
    tags,
  };
}

function buildDistricts(anchor, placeId, nextDistrictId) {
  const districts = [];
  const add = (kind, along, across, width, depth, tags) => {
    const center = localToWorld(anchor, anchor.axis, along, across);
    districts.push(
      makeDistrict(nextDistrictId(), placeId, kind, center, width, depth, anchor.axis, tags)
    );
  };
  if (anchor.type === 'town') {
    add('old_quarter', -anchor.scale * 0.22, 0, anchor.scale * 0.36, anchor.scale * 0.55, [
      'civilian',
      'residential',
      'courtyard',
    ]);
    add('market_quarter', anchor.scale * 0.08, 0, anchor.scale * 0.28, anchor.scale * 0.52, [
      'civilian',
      'commerce',
      'landmark',
    ]);
    add('outer_quarter', anchor.scale * 0.32, 0, anchor.scale * 0.3, anchor.scale * 0.62, [
      'civilian',
      'mixed-use',
    ]);
  } else if (anchor.type === 'village' || anchor.type === 'compound') {
    add('village_core', 0, 0, anchor.scale * 0.78, anchor.scale * 0.58, [
      'civilian',
      'residential',
    ]);
    add('agricultural_edge', 0, anchor.scale * 0.36, anchor.scale * 0.82, anchor.scale * 0.24, [
      'civilian',
      'agriculture',
    ]);
  } else if (anchor.type === 'farm') {
    add('farmstead', -anchor.scale * 0.12, 0, anchor.scale * 0.58, anchor.scale * 0.44, [
      'civilian',
      'agriculture',
    ]);
  } else if (anchor.type === 'roadside_service') {
    add('roadside_strip', 0, 0, anchor.scale * 0.82, anchor.scale * 0.5, [
      'civilian',
      'commerce',
      'roadside',
    ]);
  } else if (anchor.type === 'fuel_depot' || anchor.type === 'industrial_depot') {
    add('secured_yard', 0, 0, anchor.scale * 0.82, anchor.scale * 0.68, [
      'industrial',
      'logistics',
      'secured',
    ]);
  } else if (anchor.type === 'checkpoint') {
    add('control_point', 0, 0, anchor.scale * 0.88, anchor.scale * 0.62, [
      'military',
      'road-control',
    ]);
  } else if (anchor.type === 'camp') {
    add('garrison', 0, 0, anchor.scale * 0.82, anchor.scale * 0.72, [
      'military',
      'garrison',
      'command',
    ]);
  } else {
    add('air_defense_battery', 0, 0, anchor.scale * 0.88, anchor.scale * 0.82, [
      'military',
      'airDefense',
      'dispersed',
    ]);
  }
  return districts;
}

function streetsForAnchor(anchor, placeId, nextRoadId, rng) {
  const roads = [];
  const add = (angle, length, width, surface, hierarchy, tags, along = 0, across = 0, bend = 0) => {
    const origin = localToWorld(anchor, anchor.axis, along, across);
    const road = roadThrough(
      nextRoadId(),
      origin,
      angle,
      length,
      width,
      surface,
      hierarchy,
      ['place-street', `place:${placeId}`, ...tags],
      bend
    );
    roads.push(road);
    return road;
  };

  const a = anchor.axis;
  const cross = a + Math.PI * 0.5;
  if (anchor.type === 'town') {
    const spineLen = anchor.scale * 0.96;
    const spinePts = [0, 0.3, 0.62, 1].map((t, index) =>
      localToWorld(
        anchor,
        a,
        -spineLen * 0.5 + spineLen * t,
        index === 0 || index === 3 ? 0 : between(rng, -26, 26)
      )
    );
    const spine = makeStreet(
      nextRoadId(),
      spinePts,
      13,
      'compacted',
      'local',
      ['place-street', `place:${placeId}`, 'souk-spine', 'main-street']
    );
    roads.push(spine);
    const spineLength = polylineLength(spine.points);
    const alleyCount = 4 + Math.floor(rng() * 2);
    for (let i = 0; i < alleyCount; i++) {
      const t = 0.13 + (i / Math.max(1, alleyCount - 1)) * 0.74 + between(rng, -0.03, 0.03);
      const start = pointAlongPolyline(spine.points, spineLength * Math.max(0.08, Math.min(0.92, t)));
      const side = i % 2 === 0 ? 1 : -1;
      const deadEnd = i === alleyCount - 1 || rng() < 0.38;
      const alleyLen = anchor.scale * (deadEnd ? between(rng, 0.2, 0.3) : between(rng, 0.38, 0.55));
      const mid = localToWorld(start, a, between(rng, -12, 12), side * alleyLen * (deadEnd ? 1 : 0.52));
      const end = localToWorld(start, a, between(rng, -16, 16), side * alleyLen);
      roads.push(
        makeStreet(
          nextRoadId(),
          deadEnd ? [start, end] : [start, mid, end],
          deadEnd ? 6 : 8,
          'dirt',
          'alley',
          [
            'place-street',
            `place:${placeId}`,
            deadEnd ? 'dead-end' : 't-junction',
            'quarter-lane',
          ]
        )
      );
    }
    add(
      a + between(rng, -0.05, 0.05),
      anchor.scale * 0.42,
      7,
      'dirt',
      'alley',
      ['back-lane'],
      between(rng, -anchor.scale * 0.08, anchor.scale * 0.1),
      (rng() < 0.5 ? -1 : 1) * anchor.scale * between(rng, 0.2, 0.3),
      between(rng, -8, 8)
    );
  } else if (anchor.type === 'village' || anchor.type === 'compound') {
    add(a, anchor.scale * 0.88, 9, 'dirt', 'local', ['village-lane'], 0, 0, between(rng, -14, 14));
    add(
      cross + between(rng, -0.08, 0.08),
      anchor.scale * between(rng, 0.34, 0.5),
      6,
      'track',
      'alley',
      ['farm-spur', rng() < 0.45 ? 'dead-end' : 't-junction'],
      between(rng, -anchor.scale * 0.12, anchor.scale * 0.16)
    );
  } else if (anchor.type === 'farm') {
    add(a, anchor.scale * 0.76, 7, 'track', 'local', ['farm-track']);
  } else if (anchor.type === 'roadside_service') {
    add(a, anchor.scale * 0.82, 11, 'compacted', 'service', ['frontage-road']);
  } else if (anchor.type === 'fuel_depot' || anchor.type === 'industrial_depot') {
    add(a, anchor.scale * 0.76, 11, 'compacted', 'service', ['yard-spine']);
    add(cross, anchor.scale * 0.56, 9, 'dirt', 'service', ['loading-lane']);
  } else if (anchor.type === 'checkpoint') {
    const length = anchor.scale * 0.96;
    const origin = { x: anchor.x, y: anchor.y };
    roads.push(
      makeStreet(
        nextRoadId(),
        [
          localToWorld(origin, a, -length * 0.5, 0),
          localToWorld(origin, a, -length * 0.16, 16),
          localToWorld(origin, a, length * 0.16, -16),
          localToWorld(origin, a, length * 0.5, 0),
        ],
        11,
        'compacted',
        'local',
        ['place-street', `place:${placeId}`, 'inspection-lane', 'chicane']
      )
    );
  } else if (anchor.type === 'camp') {
    add(a, anchor.scale * 0.74, 10, 'dirt', 'local', ['parade-road']);
    add(cross, anchor.scale * 0.58, 9, 'dirt', 'service', ['motor-pool-road']);
  } else {
    const center = anchor;
    for (let i = 0; i < 3; i++) {
      const angle = a + (i / 3) * Math.PI * 2;
      const end = localToWorld(center, angle, anchor.scale * 0.36, 0);
      roads.push({
        id: nextRoadId(),
        points: [{ x: center.x, y: center.y }, end],
        width: 8,
        surface: 'dirt',
        hierarchy: 'service',
        tags: ['place-street', `place:${placeId}`, 'battery-spur'],
      });
    }
  }
  return roads;
}

function buildingPlan(type, count) {
  const pools = {
    town: ['courtyard_house', 'courtyard_house', 'shop', 'house', 'courtyard_house', 'hut'],
    village: ['courtyard_house', 'house', 'hut', 'shed'],
    compound: ['courtyard_house', 'courtyard_house', 'shed', 'hut'],
    farm: ['farm_house', 'shed', 'shed', 'hut'],
    roadside_service: ['shop', 'garage', 'depot', 'house'],
    fuel_depot: ['fuel', 'fuel', 'depot', 'garage', 'guard_post'],
    industrial_depot: ['warehouse', 'depot', 'garage', 'guard_post'],
    checkpoint: ['guard_post', 'bunker', 'tower'],
    camp: ['command', 'barracks', 'barracks', 'garage', 'bunker', 'tower'],
    sam_site: ['radar', 'bunker', 'garage', 'guard_post', 'tower'],
  };
  const guaranteed = {
    town: ['mosque', 'minaret', 'market'],
    village: ['courtyard_house', 'water_tower'],
    compound: ['courtyard_house'],
    farm: ['farm_house'],
    roadside_service: ['shop'],
    fuel_depot: ['fuel', 'depot'],
    industrial_depot: ['warehouse', 'depot'],
    checkpoint: ['guard_post'],
    camp: ['command', 'barracks'],
    sam_site: ['radar', 'bunker'],
  }[type];
  const output = [...guaranteed];
  const pool = pools[type];
  while (output.length < count) output.push(pool[(output.length * 7 + type.length) % pool.length]);
  return output;
}

function targetBuildingCount(anchor, rng) {
  const ranges = {
    town: [28, 40],
    village: [10, 16],
    compound: [8, 13],
    farm: [4, 7],
    roadside_service: [4, 7],
    fuel_depot: [7, 11],
    industrial_depot: [8, 13],
    checkpoint: [3, 5],
    camp: [9, 14],
    sam_site: [6, 10],
  };
  const [min, max] = ranges[anchor.type];
  return Math.round(between(rng, min, max));
}

function nearestDistrict(districts, point) {
  let best = districts[0];
  let bestDistance = Infinity;
  for (const district of districts) {
    const candidate = Math.hypot(point.x - district.x, point.y - district.y);
    if (candidate < bestDistance) {
      best = district;
      bestDistance = candidate;
    }
  }
  return best;
}

function makeBuilding(
  type,
  point,
  rotation,
  place,
  district,
  road,
  side,
  rng,
  nextParcelId,
  nextBuildingId,
  packed = false
) {
  const template = BUILDING_TYPES[type] || BUILDING_TYPES.house;
  const w = between(rng, template.w[0], template.w[1]);
  const d = between(rng, template.d[0], template.d[1]);
  const h = between(rng, template.h[0], template.h[1]);
  const parcelWidth = w + (packed ? between(rng, 2.5, 5) : between(rng, 8, 16));
  const parcelDepth = d + (packed ? between(rng, 3, 6) : between(rng, 10, 20));
  const normalAngle = rotation + Math.PI * 0.5;
  const stagger = packed ? between(rng, 0.6, 2.8) : between(rng, 3, 8);
  const offset = side * (road.width * 0.5 + d * 0.5 + stagger);
  const center = {
    x: point.x + Math.cos(normalAngle) * offset,
    y: point.y + Math.sin(normalAngle) * offset,
  };
  const openAcross = side > 0 ? -1 : 1;
  const usesCourt = type === 'courtyard_house' || type === 'mosque' || type === 'compound';
  const wall = Math.max(5.5, Math.min(w, d) * 0.22);
  const footprint = usesCourt
    ? courtyardFootprint(center, w, d, rotation, wall, openAcross)
    : orientedRectangle(center.x, center.y, w, d, rotation);
  const court = usesCourt
    ? localToWorld(center, rotation, 0, openAcross * Math.max(4, d * 0.12 - 2))
    : null;
  const parcelId = nextParcelId();
  const parcel = {
    id: parcelId,
    placeId: place.id,
    districtId: district.id,
    x: center.x,
    y: center.y,
    rotation,
    polygon: orientedRectangle(center.x, center.y, parcelWidth, parcelDepth, rotation),
    frontageRoadId: road.id,
    kind: template.tags.includes('residential')
      ? 'residential'
      : template.tags.includes('military')
        ? 'military'
        : template.tags.includes('industrial')
          ? 'industrial'
          : 'mixed',
    tags: [...template.tags, packed ? 'party-wall' : 'frontage-parcel'],
  };
  const buildingId = nextBuildingId();
  const destructible =
    template.tags.includes('missionEligible') && !template.tags.includes('civilian');
  const hp = destructible ? Math.round(55 + w * 0.8 + d * 0.4) : 0;
  const building = {
    id: buildingId,
    x: center.x,
    y: center.y,
    w,
    d,
    h,
    col: template.col,
    type,
    rotation,
    footprint,
    court,
    placeId: place.id,
    districtId: district.id,
    parcelId,
    frontageRoadId: road.id,
    doorDir: normalAngle + (side > 0 ? Math.PI : 0),
    tags: [...template.tags],
    hp,
    maxHp: hp,
    destructible,
    destroyed: false,
    flashTimer: 0,
    objectiveTag: null,
    special: type === 'fuel' ? 'fuel' : type === 'minaret' ? 'minaret' : type === 'water_tower' ? 'water' : null,
    highPriority: template.tags.includes('highPriority'),
  };
  return { parcel, building };
}

function overlapsExisting(buildings, footprint) {
  return buildings.some((building) => polygonIntersectsPolygon(building.footprint, footprint));
}

function commitBuilding(generated, parcels, buildings) {
  parcels.push(generated.parcel);
  buildings.push(generated.building);
}

function placeBuildings(anchor, place, districts, streets, rng, nextParcelId, nextBuildingId) {
  const parcels = [];
  const buildings = [];
  const packed = ['town', 'village', 'compound', 'farm', 'roadside_service'].includes(anchor.type);
  const plan = buildingPlan(anchor.type, targetBuildingCount(anchor, rng));
  let planIndex = 0;

  if (packed && streets[0]) {
    const spine = streets[0];
    const spineLen = polylineLength(spine.points);
    const landmarkAt = pointAlongPolyline(spine.points, spineLen * 0.48);
    const landmarkDistrict = nearestDistrict(districts, landmarkAt);
    while (planIndex < plan.length && (plan[planIndex] === 'mosque' || plan[planIndex] === 'minaret' || plan[planIndex] === 'market' || plan[planIndex] === 'water_tower')) {
      const type = plan[planIndex];
      const side = type === 'minaret' || type === 'water_tower' ? 1 : -1;
      const along = type === 'minaret' ? spineLen * 0.52 : type === 'market' ? spineLen * 0.42 : spineLen * 0.48;
      const point = pointAlongPolyline(spine.points, Math.min(spineLen - 8, Math.max(8, along)));
      const candidate = makeBuilding(
        type,
        point,
        point.angle,
        place,
        landmarkDistrict,
        spine,
        side,
        rng,
        nextParcelId,
        nextBuildingId,
        true
      );
      if (!overlapsExisting(buildings, candidate.building.footprint)) {
        commitBuilding(candidate, parcels, buildings);
      }
      planIndex++;
    }

    for (const road of streets) {
      const lengths = cumulativePolylineLengths(road.points);
      const total = lengths[lengths.length - 1];
      if (total < 24) continue;
      for (const side of [-1, 1]) {
        let cursor = Math.min(12, total * 0.08);
        let guard = 0;
        while (planIndex < plan.length && cursor < total - 10 && guard++ < 80) {
          const type = plan[planIndex];
          const template = BUILDING_TYPES[type] || BUILDING_TYPES.house;
          const width = (template.w[0] + template.w[1]) * 0.5;
          if (cursor + width > total - 8) break;
          const base = pointAlongPolyline(road.points, cursor + width * 0.5, lengths);
          const candidate = makeBuilding(
            type,
            base,
            base.angle,
            place,
            nearestDistrict(districts, base),
            road,
            side,
            rng,
            nextParcelId,
            nextBuildingId,
            true
          );
          if (overlapsExisting(buildings, candidate.building.footprint)) {
            cursor += 5;
            continue;
          }
          commitBuilding(candidate, parcels, buildings);
          planIndex++;
          cursor += candidate.building.w + between(rng, 0.9, 2.1);
        }
      }
    }
  }

  let attempts = 0;
  while (planIndex < plan.length && attempts++ < plan.length * 10) {
    const road = streets[attempts % streets.length];
    const lengths = cumulativePolylineLengths(road.points);
    const total = lengths[lengths.length - 1];
    const laneIndex = Math.floor(attempts / streets.length);
    const slotsPerRoad = Math.max(3, Math.ceil(plan.length / streets.length));
    const slot = laneIndex % slotsPerRoad;
    const amount = total * ((slot + 1) / (slotsPerRoad + 1));
    const base = pointAlongPolyline(road.points, amount, lengths);
    const jitter = between(rng, -Math.min(7, total * 0.02), Math.min(7, total * 0.02));
    const point = {
      x: base.x + Math.cos(base.angle) * jitter,
      y: base.y + Math.sin(base.angle) * jitter,
    };
    const side = (laneIndex + attempts) % 2 === 0 ? -1 : 1;
    const district = nearestDistrict(districts, point);
    const candidate = makeBuilding(
      plan[planIndex],
      point,
      base.angle,
      place,
      district,
      road,
      side,
      rng,
      nextParcelId,
      nextBuildingId,
      packed
    );
    if (overlapsExisting(buildings, candidate.building.footprint)) continue;
    commitBuilding(candidate, parcels, buildings);
    planIndex++;
  }
  return { parcels, buildings };
}

function perimeterFeatures(anchor, place, nextFeatureId) {
  const output = [];
  const military = place.category === 'military';
  const enclosed =
    military || anchor.type === 'compound' || anchor.type === 'fuel_depot' || anchor.type === 'industrial_depot';
  if (!enclosed) return output;
  const kind = anchor.type === 'sam_site' ? 'berm' : military ? 'wall' : 'fence';
  const halfW = anchor.scale * 0.44;
  const halfD = anchor.scale * (anchor.type === 'sam_site' ? 0.4 : 0.34);
  const local = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([along, across]) => localToWorld(anchor, anchor.axis, along, across));
  // Two open polylines leave a readable gate centered on the access side.
  const firstMid = localToWorld(anchor, anchor.axis, 0, -halfD);
  const gateHalf = 18;
  const gateA = localToWorld(firstMid, anchor.axis, -gateHalf, 0);
  const gateB = localToWorld(firstMid, anchor.axis, gateHalf, 0);
  for (const points of [
    [gateB, local[1], local[2], local[3], local[0], gateA],
  ]) {
    output.push({
      id: nextFeatureId(),
      kind,
      type: kind,
      x: anchor.x,
      y: anchor.y,
      points,
      closed: false,
      placeId: place.id,
      tags: [kind, 'perimeter', 'gate', anchor.type],
    });
  }
  return output;
}

function landmarkFeatures(anchor, place, buildings, nextFeatureId, rng) {
  const output = [];
  if (['village', 'compound', 'farm'].includes(anchor.type)) {
    const point = localToWorld(anchor, anchor.axis, -anchor.scale * 0.18, anchor.scale * 0.12);
    output.push({
      id: nextFeatureId(),
      kind: 'well',
      type: 'well',
      x: point.x,
      y: point.y,
      radius: 7,
      placeId: place.id,
      tags: ['water', 'civilian', 'landmark'],
    });
  }
  if (anchor.type === 'sam_site') {
    for (let i = 0; i < 3; i++) {
      const angle = anchor.axis + (i / 3) * Math.PI * 2;
      const center = localToWorld(anchor, angle, anchor.scale * 0.3, 0);
      const polygon = regularPolygon(center.x, center.y, 31 + rng() * 8, 12, angle);
      output.push({
        id: nextFeatureId(),
        kind: 'revetment',
        type: 'revetment',
        x: center.x,
        y: center.y,
        polygon,
        closed: true,
        placeId: place.id,
        tags: ['military', 'airDefense', 'revetment'],
      });
    }
  }
  if (anchor.type === 'checkpoint') {
    for (const offset of [-0.22, -0.06, 0.08, 0.24]) {
      const side = offset < 0 ? -1 : 1;
      const center = localToWorld(anchor, anchor.axis, offset * anchor.scale, side * 14);
      const line = orientedRectangle(center.x, center.y, 5, 22, anchor.axis + Math.PI * 0.5);
      output.push({
        id: nextFeatureId(),
        kind: 'barrier',
        type: 'barrier',
        x: center.x,
        y: center.y,
        points: [line[0], line[1]],
        placeId: place.id,
        tags: ['military', 'road-control', 'barrier', 'chicane'],
      });
    }
  }
  if (anchor.type === 'fuel_depot') {
    const tanks = buildings.filter((building) => building.placeId === place.id && building.type === 'fuel');
    for (const tank of tanks) {
      output.push({
        id: nextFeatureId(),
        kind: 'oil_tank',
        type: 'oil_tank',
        x: tank.x,
        y: tank.y,
        radius: Math.max(tank.w, tank.d) * 0.42,
        placeId: place.id,
        tags: ['industrial', 'fuel', 'landmark'],
      });
    }
  }
  return output;
}

function localLandUse(anchor, place, buildings = []) {
  const output = [];
  const mosque = buildings.find((building) => building.placeId === place.id && building.type === 'mosque');
  if (anchor.type === 'town') {
    const court = mosque || place;
    output.push({
      id: `landuse-${place.id}-court`,
      type: 'courtyard',
      kind: 'courtyard',
      polygon: orientedRectangle(
        court.x,
        court.y,
        (mosque?.w || anchor.scale * 0.16) * 1.55,
        (mosque?.d || anchor.scale * 0.13) * 1.45,
        mosque?.rotation ?? anchor.axis
      ),
      anchorId: anchor.id,
      placeId: place.id,
      tags: ['civic-space', 'mosque-court'],
    });
  } else if (anchor.category === 'industrial') {
    output.push({
      id: `landuse-${place.id}-pad`,
      type: 'industrial_pad',
      kind: 'industrial_pad',
      polygon: orientedRectangle(
        anchor.x,
        anchor.y,
        anchor.scale * 0.76,
        anchor.scale * 0.58,
        anchor.axis
      ),
      anchorId: anchor.id,
      placeId: place.id,
      tags: ['graded-yard', 'logistics'],
    });
  } else if (anchor.type === 'camp') {
    output.push({
      id: `landuse-${place.id}-parade`,
      type: 'parade',
      kind: 'parade',
      polygon: orientedRectangle(
        anchor.x,
        anchor.y,
        anchor.scale * 0.5,
        anchor.scale * 0.2,
        anchor.axis
      ),
      anchorId: anchor.id,
      placeId: place.id,
      tags: ['military', 'open-ground'],
    });
  }
  for (const shape of output) {
    shape.x = anchor.x;
    shape.y = anchor.y;
    shape.bounds = boundsFromPoints(shape.polygon);
  }
  return output;
}

export function generatePlaces(seed, worldSize, terrain, region, transport, regionalLandUse = []) {
  const rng = mulberry32(deriveSeed(seed, 'places'));
  const roads = [...transport.roads];
  const districts = [];
  const parcels = [];
  const buildings = [];
  const features = [];
  const places = [];
  const landUse = regionalLandUse.map((shape) => ({
    ...shape,
    polygon: shape.polygon || shape.footprint,
    kind: shape.kind || shape.type,
  }));
  let roadNumber = roads.length + 1;
  let districtNumber = 1;
  let parcelNumber = 1;
  let buildingNumber = 1;
  let featureNumber = 1;
  const nextRoadId = () => `road-${String(roadNumber++).padStart(3, '0')}`;
  const nextDistrictId = () => `district-${String(districtNumber++).padStart(3, '0')}`;
  const nextParcelId = () => `parcel-${String(parcelNumber++).padStart(4, '0')}`;
  const nextBuildingId = () => `building-${String(buildingNumber++).padStart(4, '0')}`;
  const nextFeatureId = () => `feature-${String(featureNumber++).padStart(4, '0')}`;
  const usedNames = new Set();

  for (let index = 0; index < region.destinationAnchors.length; index++) {
    const anchor = region.destinationAnchors[index];
    const placeId = `place-${String(index + 1).padStart(3, '0')}`;
    const depthRatio =
      anchor.type === 'town'
        ? 0.72
        : anchor.type === 'sam_site'
          ? 0.9
          : anchor.type === 'checkpoint'
            ? 0.62
            : 0.74;
    const footprint = orientedRectangle(
      anchor.x,
      anchor.y,
      anchor.scale,
      anchor.scale * depthRatio,
      anchor.axis
    );
    const place = {
      id: placeId,
      anchorId: anchor.id,
      name: placeName(anchor, index, rng, usedNames),
      kind: anchor.type,
      category: categoryForAnchor(anchor),
      scale: anchor.scale,
      x: anchor.x,
      y: anchor.y,
      rotation: anchor.axis,
      footprint,
      bounds: boundsFromPoints(footprint),
      districtIds: [],
      roadIds: [...(transport.connections[anchor.id] || [])],
      parcelIds: [],
      buildingIds: [],
      featureIds: [],
      accessPoints: [],
      landmarkTags: [...anchor.tags],
      discovered: false,
    };

    const connector = nearestRoadPoint(
      roads,
      anchor.x,
      anchor.y,
      (road) => (transport.connections[anchor.id] || []).includes(road.id)
    );
    place.accessPoints.push({
      id: `access-${placeId}-01`,
      x: connector?.x ?? anchor.x,
      y: connector?.y ?? anchor.y,
      roadId: connector?.roadId || place.roadIds[0],
      kind: 'road-gate',
    });

    const placeDistricts = buildDistricts(anchor, placeId, nextDistrictId);
    const streets = streetsForAnchor(anchor, placeId, nextRoadId, rng);
    roads.push(...streets);
    place.roadIds.push(...streets.map((road) => road.id));
    const generated = placeBuildings(
      anchor,
      place,
      placeDistricts,
      streets,
      rng,
      nextParcelId,
      nextBuildingId
    );
    const placeFeatures = [
      ...perimeterFeatures(anchor, place, nextFeatureId),
      ...landmarkFeatures(anchor, place, generated.buildings, nextFeatureId, rng),
    ];
    const placeLandUse = localLandUse(anchor, place, generated.buildings);

    districts.push(...placeDistricts);
    parcels.push(...generated.parcels);
    buildings.push(...generated.buildings);
    features.push(...placeFeatures);
    landUse.push(...placeLandUse);
    place.districtIds.push(...placeDistricts.map((district) => district.id));
    place.parcelIds.push(...generated.parcels.map((parcel) => parcel.id));
    place.buildingIds.push(...generated.buildings.map((building) => building.id));
    place.featureIds.push(...placeFeatures.map((feature) => feature.id));
    place.landmarkTags = [
      ...new Set([
        ...place.landmarkTags,
        ...generated.buildings.flatMap((building) => building.tags),
        ...placeFeatures.flatMap((feature) => feature.tags),
      ]),
    ];
    places.push(place);
  }

  // Ensure local streets physically meet the regional connector at each gate.
  for (const place of places) {
    const access = place.accessPoints[0];
    const local = nearestRoadPoint(
      roads,
      place.x,
      place.y,
      (road) => road.tags?.includes(`place:${place.id}`)
    );
    if (access && local && distance(access, local) > 2) {
      const road = {
        id: nextRoadId(),
        points: [
          { x: access.x, y: access.y },
          { x: local.x, y: local.y },
        ],
        width: 8,
        surface: 'dirt',
        hierarchy: 'access',
        tags: ['place-street', `place:${place.id}`, 'gate-connection'],
      };
      roads.push(road);
      place.roadIds.push(road.id);
    }
  }

  return { roads, districts, parcels, buildings, features, places, landUse };
}

export { BUILDING_TYPES };

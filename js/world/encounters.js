/**
 * Independent occupation/contact layer for WORLD_GEN v4.
 *
 * A town can be neutral, partly occupied, or host several contacts. Clearing
 * one encounter never changes the identity of the physical place.
 */
import { WORLD_SIZE } from '../config.js';
import { mulberry32 } from '../rng.js';
import { deriveSeed, pointAlongPolyline, cumulativePolylineLengths } from './geometry.js';
import { classMinAct, isVehicleClass } from '../data/enemyClasses.js';

function between(rng, min, max) {
  return min + (max - min) * rng();
}

function integer(rng, min, max) {
  return Math.floor(between(rng, min, max + 1));
}

function weightedPick(rng, entries) {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let cursor = rng() * total;
  for (const [value, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function contactKind(place) {
  if (!place) return 'road_patrol';
  if (place.kind === 'sam_site') return 'air_defense';
  if (place.kind === 'camp') return 'garrison';
  if (place.kind === 'checkpoint') return 'checkpoint';
  if (place.category === 'industrial') return 'secured_logistics';
  if (place.kind === 'town') return 'occupied_district';
  return 'local_cell';
}

function classWeights(kind, act = 1) {
  let entries;
  if (kind === 'air_defense') {
    entries = [
      ['rifleman', 4],
      ['assault', 3],
      ['rpg', 2],
      ['manpads', 3],
      ['hmg', 1.2],
      ['lightAA', 3],
      ['twin23', 1.6],
      ['aaTruck', 1.2],
      ['shilka', 1.5],
      ['heavyAA', 0.8],
      ['sam', 1],
    ];
  } else if (kind === 'garrison') {
    entries = [
      ['rifleman', 5],
      ['assault', 4],
      ['mg', 2],
      ['rpg', 2],
      ['hmg', 0.8],
      ['manpads', 1],
      ['technical', 1],
      ['aaTruck', 0.5],
      ['apc', 0.7],
      ['tank', 0.35],
    ];
  } else if (kind === 'checkpoint') {
    entries = [
      ['rifleman', 5],
      ['assault', 2],
      ['mg', 1],
      ['rpg', 1],
      ['hmg', 0.6],
      ['technical', 1.5],
      ['lightAA', 0.4],
    ];
  } else if (kind === 'secured_logistics') {
    entries = [
      ['rifleman', 5],
      ['assault', 3],
      ['mg', 1],
      ['rpg', 1.5],
      ['technical', 1],
      ['aaTruck', 0.4],
      ['unarmed', 0.8],
    ];
  } else if (kind === 'road_patrol') {
    entries = [
      ['technical', 4],
      ['aaTruck', 0.8],
      ['apc', 1],
      ['rifleman', 3],
      ['rpg', 1],
      ['shilka', 0.4],
      ['tank', 0.25],
    ];
  } else {
    entries = [
      ['rifleman', 6],
      ['assault', 2.5],
      ['rpg', 1.4],
      ['mg', 0.8],
      ['unarmed', 1.2],
    ];
  }
  const gated = entries.filter(([cls]) => classMinAct(cls) <= act);
  return gated.length ? gated : [['rifleman', 1]];
}

function rosterCount(kind, place, rng) {
  if (kind === 'air_defense') return integer(rng, 7, 11);
  if (kind === 'garrison') return integer(rng, 8, 13);
  if (kind === 'checkpoint') return integer(rng, 4, 7);
  if (kind === 'secured_logistics') return integer(rng, 5, 9);
  if (kind === 'occupied_district') return integer(rng, 6, 10);
  if (kind === 'road_patrol') return integer(rng, 4, 6);
  return integer(rng, place?.scale > 300 ? 5 : 3, place?.scale > 300 ? 8 : 6);
}

function placeBuildings(place, buildings, districtId) {
  const owned = buildings.filter(
    (building) =>
      building.placeId === place.id && (!districtId || building.districtId === districtId)
  );
  return owned.length ? owned : buildings.filter((building) => building.placeId === place.id);
}

function pickPost(kind, className, owned, place, encounter, rng) {
  const isVehicle = isVehicleClass(className);
  const access = place?.accessPoints?.[0] || null;
  const courts = owned.filter((building) => building.court && !building.tags?.includes('sacred'));
  const roofs = owned.filter((building) => !building.tags?.includes('sacred'));
  if (isVehicle) {
    if (access && rng() < 0.7) {
      const angle = rng() * Math.PI * 2;
      return {
        x: access.x + Math.cos(angle) * between(rng, 10, 22),
        y: access.y + Math.sin(angle) * between(rng, 10, 22),
        post: 'gate',
        building: null,
        isIndoor: false,
      };
    }
    const angle = rng() * Math.PI * 2;
    return {
      x: encounter.x + Math.cos(angle) * between(rng, 22, Math.min(70, encounter.radius * 0.28)),
      y: encounter.y + Math.sin(angle) * between(rng, 22, Math.min(70, encounter.radius * 0.28)),
      post: 'street',
      building: null,
      isIndoor: false,
    };
  }

  const roll = rng();
  const preferRoof = kind === 'occupied_district' || kind === 'local_cell' || kind === 'garrison';
  if (preferRoof && roofs.length && roll < 0.42) {
    const building = roofs[Math.floor(rng() * roofs.length)];
    const angle = rng() * Math.PI * 2;
    return {
      x: building.x + Math.cos(angle) * Math.min(5, building.w * 0.16),
      y: building.y + Math.sin(angle) * Math.min(5, building.d * 0.16),
      post: 'rooftop',
      building,
      isIndoor: false,
    };
  }
  if (courts.length && roll < 0.72) {
    const building = courts[Math.floor(rng() * courts.length)];
    const angle = rng() * Math.PI * 2;
    return {
      x: building.court.x + Math.cos(angle) * 4,
      y: building.court.y + Math.sin(angle) * 4,
      post: 'courtyard',
      building,
      isIndoor: false,
    };
  }
  if (roofs.length && roll < 0.88) {
    const building = roofs[Math.floor(rng() * roofs.length)];
    const angle = rng() * Math.PI * 2;
    return {
      x: building.x + Math.cos(angle) * Math.min(6, building.w * 0.2),
      y: building.y + Math.sin(angle) * Math.min(6, building.d * 0.2),
      post: 'interior',
      building,
      isIndoor: !building.tags?.includes('sacred'),
    };
  }
  if (access && rng() < 0.55) {
    const angle = rng() * Math.PI * 2;
    return {
      x: access.x + Math.cos(angle) * between(rng, 6, 16),
      y: access.y + Math.sin(angle) * between(rng, 6, 16),
      post: 'gate',
      building: null,
      isIndoor: false,
    };
  }
  const angle = rng() * Math.PI * 2;
  return {
    x: encounter.x + Math.cos(angle) * between(rng, 12, 48),
    y: encounter.y + Math.sin(angle) * between(rng, 12, 48),
    post: 'street',
    building: null,
    isIndoor: false,
  };
}

function makeRoster(encounter, place, buildings, rng, act = 1) {
  const count = rosterCount(encounter.kind, place, rng);
  const weights = classWeights(encounter.kind, act);
  const owned = place ? placeBuildings(place, buildings, encounter.districtId) : [];
  const roster = [];
  for (let index = 0; index < count; index++) {
    let className = weightedPick(rng, weights);
    if (index === 0 && className === 'unarmed') className = 'rifleman';
    if (encounter.kind === 'air_defense' && index === 0) {
      className = act >= 4 ? 'heavyAA' : act >= 3 ? 'shilka' : act >= 2 ? 'twin23' : 'lightAA';
    }
    const post = pickPost(encounter.kind, className, owned, place, encounter, rng);
    roster.push({
      id: `${encounter.id}-unit-${String(index + 1).padStart(2, '0')}`,
      encounterId: encounter.id,
      placeId: encounter.placeId,
      districtId: encounter.districtId,
      parcelId: post.building?.parcelId || null,
      className,
      x: post.x,
      y: post.y,
      post: post.post,
      isIndoor: post.isIndoor,
      active: false,
      objectiveTarget: false,
      state: 'idle',
    });
  }
  return roster;
}

function rewardFor(kind, rng) {
  const profiles = {
    air_defense: [130, 70, 50, 10],
    garrison: [115, 60, 45, 9],
    checkpoint: [65, 30, 28, 5],
    secured_logistics: [90, 50, 36, 7],
    occupied_district: [85, 42, 34, 7],
    local_cell: [55, 25, 25, 4],
    road_patrol: [70, 35, 28, 5],
  };
  const [score, dollars, xp, heat] = profiles[kind] || profiles.local_cell;
  return {
    score: Math.round(score * between(rng, 0.9, 1.12)),
    dollars: Math.round(dollars * between(rng, 0.85, 1.18)),
    xp,
    heat,
  };
}

function candidateForPlace(place, districts) {
  const ownedDistricts = districts.filter((district) => district.placeId === place.id);
  if (place.kind === 'town') {
    return ownedDistricts.slice(0, 2).map((district) => ({
      place,
      district,
      priority: 80,
    }));
  }
  return [{ place, district: ownedDistricts[0] || null, priority: 50 }];
}

function roadPatrolCandidate(roads, index, rng) {
  const candidates = roads.filter(
    (road) =>
      (road.hierarchy === 'highway' || road.hierarchy === 'secondary') && road.points.length >= 2
  );
  const road = candidates[index % candidates.length];
  if (!road) return null;
  const cumulative = cumulativePolylineLengths(road.points);
  const total = cumulative[cumulative.length - 1];
  const point = pointAlongPolyline(road.points, total * between(rng, 0.22, 0.78), cumulative);
  return { road, point };
}

export function generateEncounters(
  seed,
  places,
  districts,
  buildings,
  roads,
  act = 1,
  worldSize = WORLD_SIZE
) {
  const rng = mulberry32(deriveSeed(seed, 'encounters'));
  const extra = Math.max(0, (Math.floor(act) || 1) - 1) * 2;
  const targetCount = integer(rng, 10 + extra, 14 + extra);
  const encounters = [];
  const usedDistricts = new Set();
  let encounterNumber = 1;
  const nextId = () => `encounter-${String(encounterNumber++).padStart(3, '0')}`;

  const mandatory = places
    .filter((place) => place.category === 'military' || place.category === 'industrial')
    .flatMap((place) => candidateForPlace(place, districts))
    .sort((a, b) => {
      const rank = { sam_site: 4, camp: 3, checkpoint: 2, fuel_depot: 1, oil_field: 1 };
      return (rank[b.place.kind] || 0) - (rank[a.place.kind] || 0);
    });
  const civilian = places
    .filter(
      (place) =>
        place.category === 'civilian' && place.kind !== 'farm' && place.kind !== 'roadside_service'
    )
    .flatMap((place) => candidateForPlace(place, districts))
    .map((candidate) => ({
      ...candidate,
      priority: candidate.place.kind === 'town' ? 75 : rng() * 55,
    }))
    .sort((a, b) => b.priority - a.priority);

  const selected = [];
  const minCenter = Math.max(520, worldSize * 0.085);
  const farEnough = (candidate) => {
    const x = candidate.district?.x ?? candidate.place.x;
    const y = candidate.district?.y ?? candidate.place.y;
    return Math.hypot(x, y) >= minCenter;
  };
  for (const candidate of mandatory) {
    if (selected.length >= targetCount - 2) break;
    if (!farEnough(candidate)) continue;
    selected.push(candidate);
  }
  for (const candidate of civilian) {
    if (selected.length >= targetCount - 2) break;
    if (!farEnough(candidate)) continue;
    if (candidate.district && usedDistricts.has(candidate.district.id)) continue;
    selected.push(candidate);
    if (candidate.district) usedDistricts.add(candidate.district.id);
  }

  for (const candidate of selected) {
    const { place, district } = candidate;
    const kind = contactKind(place);
    const id = nextId();
    const encounter = {
      id,
      placeId: place.id,
      districtId: district?.id || place.districtIds[0] || null,
      kind,
      x: district?.x ?? place.x,
      y: district?.y ?? place.y,
      radius:
        kind === 'air_defense'
          ? 430
          : kind === 'garrison'
            ? 400
            : kind === 'occupied_district'
              ? 360
              : 320,
      discovered: false,
      cleared: false,
      state: 'hidden',
      reward: rewardFor(kind, rng),
      roster: [],
      tags: [
        'hostile-contact',
        kind,
        ...(kind === 'air_defense' ? ['airDefense'] : []),
        ...(kind === 'secured_logistics' ? ['logistics', 'supply'] : []),
        ...(kind === 'garrison' ? ['military', 'command'] : []),
      ],
    };
    encounter.roster = makeRoster(encounter, place, buildings, rng, act);
    encounters.push(encounter);
  }

  // Road patrols supply mobile contacts without turning every inhabited place hostile.
  let patrolIndex = 0;
  let patrolAttempts = 0;
  while (encounters.length < targetCount && patrolAttempts++ < 240) {
    const candidate = roadPatrolCandidate(roads, patrolIndex++, rng);
    if (!candidate) break;
    if (Math.hypot(candidate.point.x, candidate.point.y) < minCenter) continue;
    if (
      encounters.some(
        (encounter) =>
          Math.hypot(encounter.x - candidate.point.x, encounter.y - candidate.point.y) < 330
      )
    ) {
      continue;
    }
    const id = nextId();
    const encounter = {
      id,
      placeId: null,
      districtId: null,
      roadId: candidate.road.id,
      kind: 'road_patrol',
      x: candidate.point.x,
      y: candidate.point.y,
      radius: 340,
      discovered: false,
      cleared: false,
      state: 'hidden',
      reward: rewardFor('road_patrol', rng),
      roster: [],
      tags: ['hostile-contact', 'road_patrol', 'mobile', 'convoyRoute'],
    };
    encounter.roster = makeRoster(encounter, null, buildings, rng, act);
    encounters.push(encounter);
  }

  // A connected regional road always exists; this deterministic fallback only
  // handles unusually compact/custom terrain implementations.
  const regionalRoads = roads.filter(
    (road) => road.hierarchy === 'highway' || road.hierarchy === 'secondary'
  );
  let fallbackAttempts = 0;
  while (encounters.length < targetCount && regionalRoads.length && fallbackAttempts < 80) {
    const road = regionalRoads[fallbackAttempts % regionalRoads.length];
    const cumulative = cumulativePolylineLengths(road.points);
    const total = cumulative[cumulative.length - 1];
    const t = 0.12 + ((fallbackAttempts * 0.17) % 0.76);
    fallbackAttempts++;
    let point = pointAlongPolyline(road.points, total * t, cumulative);
    if (Math.hypot(point.x, point.y) < minCenter) {
      point = pointAlongPolyline(road.points, total * ((t + 0.37) % 1), cumulative);
    }
    if (Math.hypot(point.x, point.y) < minCenter) continue;
    const id = nextId();
    const encounter = {
      id,
      placeId: null,
      districtId: null,
      roadId: road.id,
      kind: 'road_patrol',
      x: point.x,
      y: point.y,
      radius: 340,
      discovered: false,
      cleared: false,
      state: 'hidden',
      reward: rewardFor('road_patrol', rng),
      roster: [],
      tags: ['hostile-contact', 'road_patrol', 'mobile', 'convoyRoute'],
    };
    encounter.roster = makeRoster(encounter, null, buildings, rng, act);
    encounters.push(encounter);
  }

  for (const place of places) {
    place.encounterIds = encounters
      .filter((encounter) => encounter.placeId === place.id)
      .map((encounter) => encounter.id);
  }
  return encounters;
}

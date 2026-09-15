/**
 * WORLD_GEN v4 orchestrator.
 *
 * Region → transport → places → encounters → semantic contract overlay.
 * Physical geometry is authoritative; places and encounters are derived.
 */
import { WORLD_SIZE } from '../config.js';
import { getDifficulty, getScenario, getStyle, intelCountForCampaign } from '../contracts.js';
import { createTerrain } from '../terrain.js';
import { mulberry32 } from '../rng.js';
import { hourFromSeed, wrapHour } from '../sun.js';
import {
  cumulativePolylineLengths,
  deriveSeed,
  localToWorld,
  orientedRectangle,
  pointAlongPolyline,
} from './geometry.js';
import { generateRegion } from './region.js';
import { generateTransport } from './transport.js';
import { generatePlaces } from './places.js';
import { generateEncounters } from './encounters.js';
import { AA_CLASSES, classMinAct } from '../data/enemyClasses.js';

function between(rng, min, max) {
  return min + (max - min) * rng();
}

function pick(rng, values) {
  if (!values?.length) return null;
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}

function hasTag(item, tag) {
  return Boolean(item?.tags?.includes(tag));
}

function placeById(world, id) {
  return world.places.find((place) => place.id === id) || null;
}

function attachToPlace(world, place, building, parcel) {
  if (!place) return;
  if (building && !place.buildingIds.includes(building.id)) place.buildingIds.push(building.id);
  if (parcel && !place.parcelIds.includes(parcel.id)) place.parcelIds.push(parcel.id);
  if (building) {
    place.landmarkTags = [...new Set([...(place.landmarkTags || []), ...(building.tags || [])])];
  }
}

function makeBuilding(world, place, parcel, type, tags, hp) {
  const host =
    parcel ||
    world.parcels.find((item) => item.placeId === place.id && item.kind !== 'residential') ||
    world.parcels.find((item) => item.placeId === place.id);
  if (!host) return null;
  const index = world.buildings.length + 1;
  const rotation = host.rotation ?? place?.rotation ?? 0;
  const x = host.x;
  const y = host.y;
  const w = type === 'radar' ? 30 : type === 'command' ? 48 : 36;
  const d = type === 'radar' ? 30 : type === 'command' ? 36 : 28;
  const h = type === 'radar' ? 22 : 16;
  const building = {
    id: `building-${String(index).padStart(4, '0')}-objective`,
    x,
    y,
    w,
    d,
    h,
    col: type === 'radar' ? '#898c77' : '#8f9075',
    type,
    rotation,
    footprint: orientedRectangle(x, y, w, d, rotation),
    placeId: place.id,
    districtId: host.districtId || place.districtIds[0] || null,
    parcelId: host.id,
    frontageRoadId: host.frontageRoadId || place.roadIds[0] || null,
    tags: [...tags],
    hp,
    maxHp: hp,
    destructible: true,
    destroyed: false,
    flashTimer: 0,
    objectiveTag: tags.find((tag) => tag === 'command' || tag === 'radar') || type,
    special: type === 'radar' ? 'radar' : null,
    highPriority: true,
  };
  world.buildings.push(building);
  attachToPlace(world, place, building, host);
  return building;
}

function eligibleParcels(world, place, extraTags = []) {
  return world.parcels.filter((parcel) => {
    if (parcel.placeId !== place.id) return false;
    if (parcel.kind === 'residential') return false;
    if (extraTags.length && !extraTags.some((tag) => hasTag(parcel, tag) || hasTag(place, tag))) {
      return parcel.kind === 'military' || parcel.kind === 'industrial' || parcel.kind === 'mixed';
    }
    return true;
  });
}

function choosePlace(world, kinds, tags) {
  const byKind = world.places.filter((place) => kinds.includes(place.kind));
  if (byKind.length) return byKind[0];
  const byTag = world.places.filter((place) => tags.some((tag) => hasTag(place, tag)));
  return byTag[0] || world.places.find((place) => place.category === 'military') || world.places[0];
}

function chooseTaggedBuilding(world, tags, excludeCivic = true) {
  return world.buildings.find((building) => {
    if (excludeCivic && (hasTag(building, 'residential') || hasTag(building, 'civic') || hasTag(building, 'sacred'))) {
      return false;
    }
    return tags.some((tag) => hasTag(building, tag) || building.type === tag);
  });
}

function convoyRouteFromRoads(roads, rng) {
  const highways = roads.filter((road) => road.hierarchy === 'highway' && road.points.length >= 2);
  const secondaries = roads.filter((road) => road.hierarchy === 'secondary' && road.points.length >= 2);
  const pool = highways.length ? highways : secondaries.length ? secondaries : roads.filter((road) => road.points.length >= 2);
  if (!pool.length) return null;
  const first = pick(rng, pool);
  let points = first.points.map((point) => ({ ...point }));
  const join = nearestOther(pool, first, rng);
  if (join) points = points.concat(join.points.slice(1).map((point) => ({ ...point })));
  if (points.length < 2) return null;
  const routeCum = cumulativePolylineLengths(points);
  const totalLength = routeCum[routeCum.length - 1];
  if (totalLength < 80) return null;
  return { points, routeCum, totalLength };
}

function nearestOther(roads, current, rng) {
  const others = roads.filter((road) => road.id !== current.id);
  if (!others.length) return null;
  const end = current.points[current.points.length - 1];
  others.sort(
    (a, b) =>
      Math.hypot(a.points[0].x - end.x, a.points[0].y - end.y) -
      Math.hypot(b.points[0].x - end.x, b.points[0].y - end.y)
  );
  return others[0] || pick(rng, others);
}

function makeConvoy(id, route, rng, extras = {}) {
  const start = pointAlongPolyline(route.points, route.totalLength * 0.18, route.routeCum);
  return {
    id,
    route: route.points,
    routeCum: route.routeCum,
    totalLength: route.totalLength,
    s: route.totalLength * 0.18,
    direction: 1,
    composition: extras.composition || convoyComposition(1, 0),
    speed: extras.speed || 38,
    hp: extras.hp || 100,
    maxHp: extras.hp || 100,
    destroyed: false,
    objectiveTarget: Boolean(extras.objectiveTarget),
    encounterId: extras.encounterId || null,
    placeId: extras.placeId || null,
    flashTimer: 0,
    fireCooldown: 0,
    active: false,
    x: start.x,
    y: start.y,
    angle: start.angle,
  };
}

function rosterAct(context, contract) {
  if (context?.practice || context?.sandbox) return 4;
  const act = contract?.campaign?.act || context?.act || 1;
  return Math.max(1, Math.min(4, Math.floor(act)));
}

function convoyComposition(act, index) {
  if (act <= 1) {
    return index === 0
      ? ['technical', 'technical', 'rifleman']
      : ['technical', 'rifleman', 'rifleman', 'rpg'];
  }
  if (act === 2) {
    return index === 0
      ? ['technical', 'apc', 'aaTruck']
      : ['technical', 'rifleman', 'rifleman', 'rpg'];
  }
  if (act === 3) {
    return index === 0
      ? ['technical', 'apc', 'shilka']
      : ['technical', 'apc', 'rifleman', 'rpg'];
  }
  return index === 0
    ? ['technical', 'apc', 'shilka', 'sam']
    : ['aaTruck', 'rifleman', 'rpg', 'manpads'];
}

function generateConvoys(seed, roads, encounters, act = 1) {
  const rng = mulberry32(deriveSeed(seed, 'convoys'));
  const convoys = [];
  const count = 1 + (rng() < 0.55 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const route = convoyRouteFromRoads(roads, rng);
    if (!route) continue;
    const mobile = encounters.find((encounter) => encounter.kind === 'road_patrol' && !encounter.placeId);
    convoys.push(
      makeConvoy(`convoy-${String(i + 1).padStart(2, '0')}`, route, rng, {
        encounterId: mobile?.id || null,
        composition: convoyComposition(act, i),
      })
    );
  }
  return convoys;
}

function generateDecorations(seed, terrain, landUse, places) {
  const rng = mulberry32(deriveSeed(seed, 'decorations'));
  const decorations = [];
  for (const oasis of terrain?.oases || []) {
    const count = 8 + Math.floor(rng() * 7);
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = rng() * oasis.radius * 0.85;
      decorations.push({
        x: oasis.x + Math.cos(angle) * dist,
        y: oasis.y + Math.sin(angle) * dist,
        type: 'palm',
        size: 8 + rng() * 6,
        angle: rng() * Math.PI * 2,
      });
    }
  }
  for (const shape of landUse.filter((item) => item.kind === 'palm_grove' || item.type === 'palm_grove')) {
    const polygon = shape.polygon || shape.footprint;
    if (!polygon?.length) continue;
    for (let i = 0; i < 6; i++) {
      const a = polygon[Math.floor(rng() * polygon.length)];
      const b = polygon[Math.floor(rng() * polygon.length)];
      decorations.push({
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
        type: 'palm',
        size: 7 + rng() * 5,
        angle: rng() * Math.PI * 2,
      });
    }
  }
  for (const place of places.filter((item) => item.category === 'civilian')) {
    if (rng() > 0.55) continue;
    decorations.push({
      x: place.x + (rng() - 0.5) * 40,
      y: place.y + (rng() - 0.5) * 40,
      type: rng() < 0.5 ? 'bush' : 'rock',
      size: 4 + rng() * 5,
      angle: rng() * Math.PI * 2,
    });
  }
  return decorations;
}

function seedSupplyAndFuel(world, rng) {
  for (const place of world.places) {
    if (place.kind !== 'fuel_depot' && place.kind !== 'industrial_depot') continue;
    const tank = world.buildings.find((building) => building.placeId === place.id && building.type === 'fuel');
    const depot = {
      id: `depot-${place.id}`,
      x: tank?.x ?? place.x,
      y: tank?.y ?? place.y,
      placeId: place.id,
      destroyed: false,
    };
    world.fuelDepots.push(depot);
    if (tank) tank.depotId = depot.id;
  }

  const cratePlaces = world.places.filter(
    (place) => place.kind === 'industrial_depot' || place.kind === 'fuel_depot' || place.kind === 'camp'
  );
  const extra = (world.luck || 0) >= 10 ? 2 : (world.luck || 0) >= 5 ? 1 : 0;
  for (const place of cratePlaces.slice(0, 3 + extra)) {
    const access = place.accessPoints[0] || place;
    world.supplyCrates.push({
      id: `crate-${place.id}`,
      x: access.x + between(rng, -12, 12),
      y: access.y + between(rng, -12, 12),
      placeId: place.id,
      encounterId: place.encounterIds?.[0] || null,
      collected: false,
      objective: false,
      rewardType: 'repair',
    });
  }
}

function applyContractPlan(world, contract) {
  const scenario = getScenario(contract?.scenarioId);
  const style = getStyle(contract?.styleId);
  const difficulty = getDifficulty(contract?.difficultyId);
  const rng = mulberry32(deriveSeed(world.seed, `contract:${scenario.id}`));

  world.objective = {
    type: scenario.id,
    targetId: null,
    targetIds: [],
    target: null,
    requiredCount: scenario.id === 'suppression' ? 3 : 1,
    progress: 0,
    complete: false,
    targetPlaceId: null,
    targetPlaceName: null,
  };
  world.extraction = { active: false };
  world.responsePlan = {
    heatGainMultiplier: style.heatGainMultiplier,
    hunterRateMultiplier: style.hunterRateMultiplier,
    enemyCountMultiplier: style.enemyCountMultiplier,
    difficultyId: difficulty.id,
    tierEvents: [
      { tier: 1, label: 'LOCAL ALERT' },
      { tier: 2, label: 'SECTOR RESPONSE' },
      { tier: 3, label: 'HUNTER TRACKING' },
      { tier: 4, label: 'FULL PURSUIT' },
    ],
  };

  if (scenario.id === 'strike') {
    const place = choosePlace(world, ['camp', 'sam_site'], ['command', 'military']);
    let building = world.buildings.find(
      (item) => item.placeId === place.id && (item.type === 'command' || hasTag(item, 'command'))
    );
    if (!building) {
      const parcel = pick(rng, eligibleParcels(world, place, ['military'])) || world.parcels.find((item) => item.placeId === place.id);
      building = makeBuilding(world, place, parcel, 'command', ['military', 'command', 'missionEligible', 'highPriority'], Math.round(90 * difficulty.targetHpMultiplier));
    }
    if (!building) {
      building = world.buildings.find((item) => item.type === 'command' || hasTag(item, 'command'));
    }
    if (building) {
      building.hp = Math.max(building.hp, Math.round(90 * difficulty.targetHpMultiplier));
      building.maxHp = building.hp;
      building.destructible = true;
      building.highPriority = true;
      if (!hasTag(building, 'command')) building.tags.push('command');
      world.objective.targetId = building.id;
      world.objective.target = building;
      world.objective.targetPlaceId = place.id;
      world.objective.targetPlaceName = place.name;
    }
  } else if (scenario.id === 'sabotage') {
    const place = choosePlace(world, ['sam_site', 'camp'], ['radar', 'communications']);
    let building = world.buildings.find(
      (item) => item.placeId === place.id && (item.type === 'radar' || hasTag(item, 'radar'))
    );
    if (!building) {
      const parcel = pick(rng, eligibleParcels(world, place, ['military'])) || world.parcels.find((item) => item.placeId === place.id);
      building = makeBuilding(world, place, parcel, 'radar', ['military', 'radar', 'communications', 'missionEligible', 'highPriority'], Math.round(70 * difficulty.targetHpMultiplier));
    }
    if (!building) {
      building = world.buildings.find((item) => item.type === 'radar' || hasTag(item, 'radar'));
    }
    if (building) {
      building.hp = Math.max(building.hp, Math.round(70 * difficulty.targetHpMultiplier));
      building.maxHp = building.hp;
      building.destructible = true;
      building.highPriority = true;
      world.objective.targetId = building.id;
      world.objective.target = building;
      world.objective.targetPlaceId = place.id;
      world.objective.targetPlaceName = place.name;
    }
  } else if (scenario.id === 'intercept') {
    let convoy = world.convoys[0];
    if (!convoy) {
      const route = convoyRouteFromRoads(world.roads, rng);
      if (route) {
        convoy = makeConvoy('convoy-objective', route, rng, {
          objectiveTarget: true,
          composition: convoyComposition(world.act || 1, 0),
        });
        world.convoys.push(convoy);
      }
    }
    if (convoy) {
      convoy.objectiveTarget = true;
      convoy.hp = Math.round(110 * difficulty.targetHpMultiplier);
      convoy.maxHp = convoy.hp;
      world.objective.targetId = convoy.id;
      world.objective.target = convoy;
      const near = world.places
        .filter((place) => place.category !== 'civilian' || place.kind === 'roadside_service')
        .sort((a, b) => Math.hypot(a.x - convoy.x, a.y - convoy.y) - Math.hypot(b.x - convoy.x, b.y - convoy.y))[0];
      world.objective.targetPlaceId = near?.id || null;
      world.objective.targetPlaceName = near?.name || 'SUPPLY CONVOY';
    }
  } else if (scenario.id === 'suppression') {
    const air = world.encounters.filter((encounter) => hasTag(encounter, 'airDefense') || encounter.kind === 'air_defense');
    const pool = air.length ? air : world.encounters.filter((encounter) => encounter.placeId);
    const marked = [];
    for (const encounter of pool) {
      for (const entry of encounter.roster) {
        if (AA_CLASSES.includes(entry.className) && classMinAct(entry.className) <= (world.act || 1)) {
          entry.objectiveTarget = true;
          marked.push(entry);
        }
        if (marked.length >= 3) break;
      }
      if (marked.length >= 3) break;
    }
    while (marked.length < 3) {
      const encounter = pool[0] || world.encounters[0];
      if (!encounter) break;
      const place = placeById(world, encounter.placeId);
      const origin = place || encounter;
      const offset = localToWorld(origin, rng() * Math.PI * 2, 28 + marked.length * 10, 0);
      const entry = {
        id: `${encounter.id}-aa-${marked.length + 1}`,
        encounterId: encounter.id,
        placeId: encounter.placeId,
        districtId: encounter.districtId,
        parcelId: null,
        className:
          marked.length === 0
            ? 'lightAA'
            : marked.length === 1
              ? (world.act || 1) >= 2
                ? 'manpads'
                : 'mg'
              : (world.act || 1) >= 3
                ? 'shilka'
                : (world.act || 1) >= 2
                  ? 'twin23'
                  : 'lightAA',
        x: offset.x,
        y: offset.y,
        isIndoor: false,
        active: false,
        objectiveTarget: true,
        state: 'idle',
      };
      encounter.roster.push(entry);
      marked.push(entry);
    }
    const home = placeById(world, pool[0]?.placeId);
    world.objective.targetIds = marked.map((entry) => entry.id);
    world.objective.target = marked[0] || null;
    world.objective.requiredCount = 3;
    world.objective.targetPlaceId = home?.id || pool[0]?.placeId || null;
    world.objective.targetPlaceName = home?.name || 'AIR DEFENSE';
  } else if (scenario.id === 'recovery') {
    const place = choosePlace(world, ['industrial_depot', 'fuel_depot', 'camp'], ['supply', 'logistics']);
    const access = place.accessPoints[0] || place;
    let crate = world.supplyCrates.find((item) => item.placeId === place.id);
    if (!crate) {
      crate = {
        id: `crate-objective-${place.id}`,
        x: access.x + 10,
        y: access.y + 8,
        placeId: place.id,
        encounterId: place.encounterIds?.[0] || null,
        collected: false,
        objective: true,
        rewardType: 'repair',
      };
      world.supplyCrates.push(crate);
    }
    crate.objective = true;
    world.objective.targetId = crate.id;
    world.objective.target = crate;
    world.objective.targetPlaceId = place.id;
    world.objective.targetPlaceName = place.name;
  }

  // Every operation has a radar installation so Heat remains controllable.
  let radar = chooseTaggedBuilding(world, ['radar']);
  if (!radar) {
    const place =
      world.places.find((item) => item.id !== world.objective.targetPlaceId && item.kind === 'sam_site') ||
      choosePlace(world, ['sam_site', 'camp'], ['military']);
    const parcel = pick(rng, eligibleParcels(world, place, ['military'])) || world.parcels.find((item) => item.placeId === place.id);
    radar = makeBuilding(world, place, parcel, 'radar', ['military', 'radar', 'communications', 'missionEligible'], 65);
  }
  if (radar) {
    world.radarSites.push({
      id: `radar-${radar.placeId}`,
      x: radar.x,
      y: radar.y,
      buildingId: radar.id,
      placeId: radar.placeId,
      destroyed: false,
    });
  }

  if (scenario.id !== 'recovery' && rng() < (style.supplyChance || 0.4)) {
    const supplyPlace =
      world.places.find((place) => place.id !== world.objective.targetPlaceId && place.category === 'industrial') ||
      world.places.find((place) => place.id !== world.objective.targetPlaceId);
    if (supplyPlace && !world.supplyCrates.some((crate) => crate.placeId === supplyPlace.id && crate.objective)) {
      const access = supplyPlace.accessPoints[0] || supplyPlace;
      world.supplyCrates.push({
        id: `crate-bonus-${supplyPlace.id}`,
        x: access.x + between(rng, -16, 16),
        y: access.y + between(rng, -16, 16),
        placeId: supplyPlace.id,
        encounterId: supplyPlace.encounterIds?.[0] || null,
        collected: false,
        objective: false,
        rewardType: 'repair',
      });
    }
  }

  placeIntelHolders(world, contract, rng);
  if ((world.objective.intel?.required || 0) > 0) hideObjectiveTarget(world);
  else world.objective.revealed = true;
}

function hideObjectiveTarget(world) {
  const t = world.objective?.target;
  if (t) {
    t.objectiveHidden = true;
    if (Array.isArray(t.route)) t.active = false;
  }
  if (world.objective?.type === 'suppression') {
    for (const encounter of world.encounters) {
      for (const entry of encounter.roster || []) {
        if (entry.objectiveTarget) entry.objectiveHidden = true;
      }
    }
  }
}

export function revealObjectiveTarget(world) {
  const o = world.objective;
  if (!o || o.revealed) return false;
  o.revealed = true;
  const t = o.target;
  if (t) {
    t.objectiveHidden = false;
    if (Array.isArray(t.route)) t.active = true;
  }
  if (o.type === 'suppression') {
    for (const encounter of world.encounters) {
      for (const entry of encounter.roster || []) {
        if (entry.objectiveTarget) entry.objectiveHidden = false;
      }
    }
  }
  return true;
}

function placeIntelHolders(world, contract, rng) {
  const need = intelCountForCampaign(contract?.campaign || { act: 1 });
  const excludePlace = world.objective?.targetPlaceId;
  const excludeId = world.objective?.targetId;
  const usedPlaces = new Set();
  const holders = [];
  const pool = (world.buildings || []).filter(
    (b) =>
      b.id !== excludeId &&
      b.placeId !== excludePlace &&
      !b.destroyed &&
      b.placeId
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  for (const b of pool) {
    if (holders.length >= need) break;
    if (usedPlaces.has(b.placeId)) continue;
    usedPlaces.add(b.placeId);
    b.destructible = true;
    b.intelHolder = true;
    b.highPriority = true;
    b.hp = Math.max(b.hp || 40, 48);
    b.maxHp = b.hp;
    holders.push(b);
  }
  while (holders.length < need) {
    const place =
      world.places.find((p) => p.id !== excludePlace && !usedPlaces.has(p.id) && p.category !== 'civilian') ||
      world.places.find((p) => p.id !== excludePlace && !usedPlaces.has(p.id));
    if (!place) break;
    const parcel =
      pick(rng, eligibleParcels(world, place, ['military'])) ||
      world.parcels.find((item) => item.placeId === place.id);
    const shack = makeBuilding(
      world,
      place,
      parcel,
      'command',
      ['military', 'intel', 'missionEligible', 'highPriority'],
      48
    );
    if (!shack) break;
    usedPlaces.add(place.id);
    shack.destructible = true;
    shack.intelHolder = true;
    shack.highPriority = true;
    holders.push(shack);
  }
  world.objective.intel = { required: Math.max(1, need), secured: 0, holders };
  world.objective.revealed = false;
  if (!holders.length) {
    world.objective.intel.required = 0;
    world.objective.revealed = true;
  }
}

export function generateWorldV4(input) {
  const context = typeof input === 'number' ? { seed: input } : input || {};
  const seed = context.seed ?? context.rootSeed ?? 42;
  const worldSize = context.worldSize || WORLD_SIZE;
  const terrain = context.terrain || createTerrain(seed, worldSize);
  const contract = context.contract || null;
  const act = rosterAct(context, contract);

  const { region, landUse: regionalLandUse } = generateRegion(seed, worldSize, terrain);
  const transport = generateTransport(seed, worldSize, terrain, region);
  const placesResult = generatePlaces(seed, worldSize, terrain, region, transport, regionalLandUse);
  const encounters = generateEncounters(
    seed,
    placesResult.places,
    placesResult.districts,
    placesResult.buildings,
    placesResult.roads,
    act
  );
  const convoys = generateConvoys(seed, placesResult.roads, encounters, act);
  const decorations = generateDecorations(seed, terrain, placesResult.landUse, placesResult.places);

  const world = {
    seed,
    worldSize,
    worldGenVersion: 4,
    terrain,
    region,
    landUse: placesResult.landUse,
    roads: placesResult.roads,
    districts: placesResult.districts,
    parcels: placesResult.parcels,
    buildings: placesResult.buildings,
    features: placesResult.features,
    places: placesResult.places,
    encounters,
    decorations,
    convoys,
    supplyCrates: [],
    fuelDepots: [],
    radarSites: [],
    objective: null,
    extraction: { active: false },
    responsePlan: null,
    contract,
    luck: context.luck || 0,
    act,
    hour: Number.isFinite(contract?.hour) ? wrapHour(contract.hour) : hourFromSeed(seed),
    debugWorldgen: false,
  };

  seedSupplyAndFuel(world, mulberry32(deriveSeed(seed, 'supply')));
  applyContractPlan(world, contract);
  return world;
}

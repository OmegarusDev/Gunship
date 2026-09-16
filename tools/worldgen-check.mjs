#!/usr/bin/env node
// Deterministic structural checks for Geometry-First Gulf Worldgen V4.
import { generateWorld } from '../js/world.js';
import { classMinAct } from '../js/data/enemyClasses.js';
import { worldSizeForAct } from '../js/config.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(condition, message) {
  if (condition) pass++;
  else {
    fail++;
    failures.push(message);
  }
}

function polygonArea(polygon = []) {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function distanceToRoads(point, roads) {
  let best = Infinity;
  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      best = Math.min(best, distanceToSegment(point, road.points[i], road.points[i + 1]));
    }
  }
  return best;
}

function canonical(world) {
  const round = (n) => Math.round(n * 100) / 100;
  return JSON.stringify({
    profile: world.region?.profile?.id || world.region?.profile || world.region?.id,
    roads: world.roads.map((road) => [
      road.id,
      road.hierarchy,
      road.surface,
      road.points.map((point) => [round(point.x), round(point.y)]),
    ]),
    places: world.places.map((place) => [
      place.id,
      place.name,
      place.kind,
      round(place.x),
      round(place.y),
      place.parcelIds,
      place.buildingIds,
    ]),
    buildings: world.buildings.map((building) => [
      building.id,
      building.type,
      round(building.x),
      round(building.y),
      round(building.rotation || 0),
      building.placeId,
      building.parcelId,
    ]),
    encounters: world.encounters.map((encounter) => [
      encounter.id,
      encounter.placeId,
      encounter.kind,
      round(encounter.x),
      round(encounter.y),
      encounter.roster.map((entry) => [entry.id, entry.className, round(entry.x), round(entry.y)]),
    ]),
    objective: [world.objective?.type, world.objective?.targetId, world.objective?.targetPlaceId],
  });
}

const profiles = new Set();
const seeds = Array.from({ length: 48 }, (_, index) => 401 + index * 97);

for (const seed of seeds) {
  const contract = {
    seed,
    scenarioId: ['strike', 'intercept', 'sabotage', 'suppression', 'recovery'][seed % 5],
    styleId: 'precision_strike',
    difficultyId: 'standard',
    campaign: { act: 1, sortie: 1 },
  };
  const world = generateWorld({ seed, contract });
  const again = generateWorld({ seed, contract });
  const label = `seed ${seed}`;

  ok(world.worldGenVersion === 4, `${label}: v4 world`);
  ok(world.worldSize === worldSizeForAct(1), `${label}: act 1 operational area`);
  ok(!('sites' in world), `${label}: no legacy sites`);
  ok(canonical(world) === canonical(again), `${label}: deterministic canonical geometry`);
  ok(world.places.length >= 12 && world.places.length <= 18, `${label}: 12–18 destinations`);
  ok(world.encounters.length >= 10 && world.encounters.length <= 14, `${label}: 10–14 contacts`);
  ok(
    world.places.some((place) => place.kind === 'town' && (place.scale || 0) >= 500),
    `${label}: large town present`
  );
  ok(Number.isFinite(world.hour) && world.hour >= 0 && world.hour < 24, `${label}: sortie hour`);
  ok(world.act === 1, `${label}: campaign act stamped`);
  const spawned = [
    ...world.encounters.flatMap((encounter) => encounter.roster.map((entry) => entry.className)),
    ...(world.convoys || []).flatMap((convoy) => convoy.composition || []),
  ];
  for (const className of spawned) {
    ok(
      classMinAct(className) <= 1,
      `${label}: ${className} must not spawn in act 1`
    );
  }
  ok(
    world.places.some(
      (place) =>
        place.category === 'civilian' &&
        !world.encounters.some((encounter) => encounter.placeId === place.id)
    ),
    `${label}: at least one neutral civilian place`
  );

  const profile =
    world.region?.profile?.id || world.region?.profile || world.region?.id || 'unknown';
  profiles.add(profile);

  const roadIds = new Set(world.roads.map((road) => road.id));
  const parcelIds = new Set(world.parcels.map((parcel) => parcel.id));
  const buildingIds = new Set(world.buildings.map((building) => building.id));
  const featureIds = new Set(world.features.map((feature) => feature.id));
  const placeIds = new Set(world.places.map((place) => place.id));
  const encounterIds = new Set(world.encounters.map((encounter) => encounter.id));

  ok(roadIds.size === world.roads.length, `${label}: unique road ids`);
  ok(parcelIds.size === world.parcels.length, `${label}: unique parcel ids`);
  ok(buildingIds.size === world.buildings.length, `${label}: unique building ids`);
  ok(placeIds.size === world.places.length, `${label}: unique place ids`);
  ok(encounterIds.size === world.encounters.length, `${label}: unique encounter ids`);

  for (const road of world.roads) {
    ok(road.points.length >= 2 && road.width > 0, `${label}/${road.id}: valid road geometry`);
  }
  for (const parcel of world.parcels) {
    ok(
      polygonArea(parcel.polygon) > 20 && roadIds.has(parcel.frontageRoadId),
      `${label}/${parcel.id}: area and real street frontage`
    );
  }
  for (const building of world.buildings) {
    ok(
      building.footprint?.length >= 3 &&
        polygonArea(building.footprint) > 10 &&
        placeIds.has(building.placeId) &&
        parcelIds.has(building.parcelId) &&
        roadIds.has(building.frontageRoadId),
      `${label}/${building.id}: owned frontage footprint`
    );
    ok(
      building.tags?.includes('residential') ? !building.tags.includes('missionTarget') : true,
      `${label}/${building.id}: homes excluded from mission targets`
    );
  }
  for (const place of world.places) {
    ok(
      place.name &&
        place.footprint?.length >= 3 &&
        polygonArea(place.footprint) > 100 &&
        place.accessPoints?.length > 0,
      `${label}/${place.id}: named geometry and access`
    );
    ok(
      place.roadIds.every((id) => roadIds.has(id)) &&
        place.parcelIds.every((id) => parcelIds.has(id)) &&
        place.buildingIds.every((id) => buildingIds.has(id)) &&
        place.featureIds.every((id) => featureIds.has(id)),
      `${label}/${place.id}: derived references resolve`
    );
    ok(
      place.accessPoints.every((point) => distanceToRoads(point, world.roads) < 45),
      `${label}/${place.id}: connected access points`
    );
    if (place.kind === 'town') {
      const local = world.roads.filter((road) => road.tags?.includes(`place:${place.id}`));
      ok(local.length >= 5, `${label}/${place.id}: town street blocks`);
    }
  }
  for (const encounter of world.encounters) {
    ok(
      (!encounter.placeId || placeIds.has(encounter.placeId)) &&
        encounter.radius > 0 &&
        encounter.roster.some((entry) => entry.className !== 'unarmed'),
      `${label}/${encounter.id}: owned armed contact`
    );
    ok(
      Math.hypot(encounter.x, encounter.y) >= 420,
      `${label}/${encounter.id}: contact clear of center spawn`
    );
    ok(
      encounter.roster.every(
        (entry) =>
          Number.isFinite(entry.x) &&
          Number.isFinite(entry.y) &&
          entry.encounterId === encounter.id &&
          !('offsetX' in entry) &&
          !('offsetY' in entry)
      ),
      `${label}/${encounter.id}: absolute roster ownership`
    );
  }

  ok(world.objective?.target, `${label}: semantic objective target exists`);
  ok(
    (world.objective?.intel?.required || 0) >= 1 &&
      (world.objective.intel.holders || []).length >= world.objective.intel.required,
    `${label}: intel sites placed`
  );
  ok(world.objective?.target?.objectiveHidden, `${label}: primary target hidden pending intel`);
  ok(
    !world.objective?.targetPlaceId || placeIds.has(world.objective.targetPlaceId),
    `${label}: objective place resolves`
  );
  if (contract.scenarioId === 'sabotage') {
    const sam = world.places.find((place) => place.kind === 'sam_site');
    const targetPlace = world.places.find((place) => place.id === world.objective?.targetPlaceId);
    ok(
      !sam || targetPlace?.kind === 'sam_site',
      `${label}: sabotage prefers SAM over camp`
    );
  }
}

ok(profiles.size >= 3, `regional variety: saw ${profiles.size} profiles (${[...profiles].join(', ')})`);

{
  const late = new Set();
  for (let i = 0; i < 16; i++) {
    const seed = 9001 + i * 41;
    const world = generateWorld({
      seed,
      contract: {
        seed,
        scenarioId: 'strike',
        styleId: 'precision_strike',
        difficultyId: 'standard',
        campaign: { act: 4, sortie: 1 },
      },
    });
    ok(world.act === 4, `act-4 seed ${seed}: act stamped`);
    ok(world.worldSize === worldSizeForAct(4), `act-4 seed ${seed}: larger operational area`);
    for (const encounter of world.encounters) {
      for (const entry of encounter.roster) late.add(entry.className);
    }
    for (const convoy of world.convoys || []) {
      for (const className of convoy.composition || []) late.add(className);
    }
  }
  ok(late.has('manpads'), 'act 4 field roster includes MANPADS');
  ok(late.has('twin23') || late.has('aaTruck') || late.has('shilka'), 'act 4 field roster includes mid/late AA');
  ok(
    late.has('shilka') || late.has('tank') || late.has('sam') || late.has('heavyAA'),
    `act 4 field roster includes heavy kit (${[...late].join(', ')})`
  );
}

console.log(`\nWorldgen check: ${pass} passed, ${fail} failed across ${seeds.length} seeds`);
if (fail) {
  for (const message of failures.slice(0, 80)) console.log('  FAIL:', message);
  if (failures.length > 80) console.log(`  … ${failures.length - 80} more`);
  process.exit(1);
}
console.log(`Profiles: ${[...profiles].join(', ')}`);

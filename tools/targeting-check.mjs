/**
 * Targeting resolution: never lock roster stubs or empty dirt.
 * Usage: node tools/targeting-check.mjs
 */
import {
  isRosterStub,
  isLockable,
  resolveLiveTarget,
  resolveObjectiveAim,
  pickAutoTarget,
  pickClickedTarget,
} from '../js/sim/targeting.js';
import { isTargetAlive, getObjectiveFocus } from '../js/sim/objectives.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};

const stub = {
  id: 'enc-aa-1',
  className: 'lightAA',
  encounterId: 'enc-1',
  x: 10,
  y: 10,
  state: 'idle',
  objectiveTarget: true,
};
const liveAA = {
  id: 'enc-aa-1',
  className: 'lightAA',
  category: 'emplacement',
  x: 80,
  y: 40,
  state: 'idle',
  hp: 40,
  maxHp: 40,
  damage: 8,
  fireRate: 0.4,
  range: 200,
  objectiveTarget: true,
};
const rifle = {
  id: 'rifle-1',
  className: 'rifleman',
  category: 'infantry',
  x: 30,
  y: 0,
  state: 'idle',
  hp: 15,
  maxHp: 15,
  damage: 3,
  fireRate: 1.2,
  range: 120,
};
const truck = {
  id: 'tech-1',
  className: 'technical',
  category: 'vehicle',
  x: 50,
  y: 10,
  state: 'idle',
  hp: 50,
  maxHp: 50,
  damage: 5,
  fireRate: 0.5,
  range: 180,
};
const bunker = {
  id: 'building-1',
  type: 'command',
  x: 12,
  y: 12,
  w: 48,
  d: 36,
  destructible: true,
  destroyed: false,
  hp: 90,
  maxHp: 90,
};
const convoy = {
  id: 'convoy-1',
  x: 200,
  y: 0,
  route: [
    [0, 0],
    [200, 0],
  ],
  active: true,
  destroyed: false,
  hp: 80,
  maxHp: 80,
};
const heli = { x: 0, y: 0, weaponRange: 400 };
const world = {
  buildings: [bunker],
  convoys: [convoy],
  supplyCrates: [],
  objective: { type: 'suppression', target: stub, targetIds: [stub.id] },
};

console.log('— lockable / stubs —');
ok(isRosterStub(stub), 'worldgen roster entry is a stub');
ok(!isRosterStub(liveAA), 'spawned emplacement is live');
ok(!isLockable(stub), 'stub is not lockable');
ok(isLockable(liveAA) && isLockable(truck) && isLockable(bunker) && isLockable(convoy), 'live kinds lock');
ok(isTargetAlive(world, null, stub, [liveAA]), 'stub is alive only via its live twin');
ok(!isTargetAlive(world, null, stub, []), 'stub alone is not a living target');

console.log('— resolve live —');
ok(resolveLiveTarget(world, [liveAA, rifle], null, stub) === liveAA, 'stub id maps to moving unit');
const dead = { ...liveAA, state: 'dead' };
ok(resolveLiveTarget(world, [dead], null, stub) === null, 'dead twin does not keep the lock');
ok(resolveLiveTarget(world, [liveAA], null, bunker) === bunker, 'building identity stays live');

console.log('— auto aim —');
const ghostLock = pickAutoTarget({
  world,
  enemies: [rifle],
  boss: { spawned: false },
  heli,
  mode: 'closest',
  manualTarget: null,
});
ok(ghostLock === rifle, 'closest ignores suppression stub and locks a real soldier');

const objLock = pickAutoTarget({
  world,
  enemies: [rifle, liveAA],
  boss: { spawned: false },
  heli,
  mode: 'closest',
  manualTarget: null,
});
ok(objLock === liveAA, 'live marked AA wins over a closer rifle');

const vehLock = pickAutoTarget({
  world: { ...world, objective: { type: 'strike', target: bunker } },
  enemies: [truck, rifle],
  boss: { spawned: false },
  heli: { x: 48, y: 10, weaponRange: 400 },
  mode: 'closest',
  manualTarget: null,
});
ok(vehLock === truck || vehLock === bunker, 'vehicles share the closest pool');
ok(vehLock !== stub, 'vehicle lock is never the dirt stub');

const infraLock = pickAutoTarget({
  world: { ...world, objective: { type: 'strike', target: bunker } },
  enemies: [rifle, liveAA],
  boss: { spawned: false },
  heli,
  mode: 'infrastructure',
  manualTarget: null,
});
ok(infraLock === bunker || infraLock === liveAA, 'infra locks a building or emplacement');
ok(infraLock !== rifle, 'infra does not lock infantry');

console.log('— objective focus —');
ok(resolveObjectiveAim(world, [liveAA], null, heli) === liveAA, 'objective aim is the live AA');
ok(getObjectiveFocus(world, null, [liveAA], heli)?.x === liveAA.x, 'focus follows the unit, not spawn dirt');
ok(getObjectiveFocus(world, null, [], heli) === null, 'no focus when the unit is gone');

console.log('— click —');
const clicked = pickClickedTarget(world, [truck], null, { x: 50, y: 10 });
ok(clicked === truck, 'click on a vehicle locks the vehicle');
const clickedB = pickClickedTarget(world, [], null, { x: 12, y: 12 });
ok(clickedB === bunker, 'click on a building locks the building');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

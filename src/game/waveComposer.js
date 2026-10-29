// Pure wave planning: turns a wave number into a timed spawn plan. No three.js (runs under Node for sim:waves).
import { ENEMY_TYPES, ROUTES, WAVES } from '../config.js';
import { shuffle } from '../core/rng.js';

export const isBossWave = (n) => n % WAVES.bossEvery === 0;

export function waveBudget(n) {
  const b = Math.floor(8 + 6 * n + 0.5 * n * n);
  return isBossWave(n) ? Math.floor(b * 1.25) : b;
}

function typeWeights(n) {
  return {
    infantry: 10 + 0.5 * n,
    rpg: 1.5 + 0.2 * n,
    sapper: 0.8 + 0.15 * n,
    technical: 0.5 + 0.12 * n,
    apc: 0.25 + 0.08 * n,
    tank: n >= 15 ? 0.04 * n : 0,
  };
}

const VEHICLES = ['technical', 'apc', 'tank'];

export function composeWave(n, rng) {
  const boss = isBossWave(n);
  let budget = waveBudget(n);
  const counts = { infantry: 0, rpg: 0, sapper: 0, technical: 0, apc: 0, tank: 0 };

  // Boss waves get guaranteed armor, paid for first.
  if (boss) {
    counts.technical += 2 + Math.floor(n / 5);
    counts.apc += Math.floor(n / 5);
    counts.tank += Math.floor(n / 10);
    for (const t of VEHICLES) budget -= counts[t] * ENEMY_TYPES[t].cost;
  }

  const w = typeWeights(n);
  const types = Object.keys(ENEMY_TYPES).filter((t) => n >= ENEMY_TYPES[t].firstWave && w[t] > 0);
  while (budget > 0) {
    let total = 0;
    for (const t of types) if (ENEMY_TYPES[t].cost <= budget) total += w[t];
    if (total <= 0) break;
    let r = rng() * total;
    let pick = 'infantry';
    for (const t of types) {
      if (ENEMY_TYPES[t].cost > budget) continue;
      r -= w[t];
      if (r <= 0) {
        pick = t;
        break;
      }
    }
    counts[pick]++;
    budget -= ENEMY_TYPES[pick].cost;
  }

  // Attack directions.
  let nDirs = Math.min(4, 1 + Math.floor(n / 3));
  if (boss) nDirs = Math.min(ROUTES.count, nDirs + 2);
  const dirs = shuffle(rng, [...Array(ROUTES.count).keys()]).slice(0, nDirs);
  const hasVehicles = VEHICLES.some((t) => counts[t] > 0);
  let roadDirs = dirs.filter((d) => ROUTES.main.includes(d));
  if (hasVehicles && roadDirs.length === 0) {
    const r = ROUTES.main[Math.floor(rng() * ROUTES.main.length)];
    dirs.push(r);
    roadDirs = [r];
  }

  // Foot soldiers go out in squads, vehicles alone; every third slot is a vehicle.
  const squadSize = Math.min(10, 4 + Math.floor(n / 4));
  const foot = [];
  for (const t of ['rpg', 'sapper', 'infantry']) for (let i = 0; i < counts[t]; i++) foot.push(t);
  shuffle(rng, foot);
  const squads = [];
  for (let i = 0; i < foot.length; i += squadSize) squads.push(foot.slice(i, i + squadSize));
  const vehicles = [];
  for (const t of VEHICLES) for (let i = 0; i < counts[t]; i++) vehicles.push(t);
  shuffle(rng, vehicles);

  const slots = [];
  let si = 0;
  let vi = 0;
  while (si < squads.length || vi < vehicles.length) {
    const wantVehicle = slots.length % 3 === 2 || si >= squads.length;
    if (vi < vehicles.length && wantVehicle) slots.push({ units: [vehicles[vi++]], vehicle: true });
    else if (si < squads.length) slots.push({ units: squads[si++], vehicle: false });
    else slots.push({ units: [vehicles[vi++]], vehicle: true });
  }

  const interval = Math.max(2, 7 - 0.25 * n);
  let t = 0;
  let footDir = Math.floor(rng() * dirs.length);
  let roadDir = Math.floor(rng() * Math.max(1, roadDirs.length));
  const groups = slots.map((s, i) => {
    if (i > 0) t += interval * (0.8 + 0.4 * rng());
    const routeId = s.vehicle ? roadDirs[roadDir++ % roadDirs.length] : dirs[footDir++ % dirs.length];
    return { t, routeId, units: s.units };
  });

  let total = 0;
  for (const type of Object.keys(counts)) total += counts[type] * (1 + (ENEMY_TYPES[type].passengers || 0));

  return {
    n,
    boss,
    budget: waveBudget(n),
    counts,
    total,
    dirs,
    roadDirs,
    groups,
    hpMul: 1 + 0.05 * (n - 1),
    speedMul: Math.min(1.35, 1 + 0.015 * (n - 1)),
    dmgMul: 1 + 0.04 * (n - 1),
  };
}

// Enemy behaviour: advance along a route, stop at a firing ring and engage the base,
// or (sappers and stragglers) charge the wall.
import { FRIENDLY } from '../config.js';
import { surfaceHeight } from '../world/terrain.js';
import { nearestWallPoint } from '../world/compound.js';
import { sectorOf } from '../world/roads.js';

export const ENEMY_CAUSE = { byPlayer: false, weapon: -1, shellId: 0 };
const tmp = [];
const rs = (s) => (Math.random() - 0.5) * s;

function turn(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

function moveToward(u, tx, tz, dt, g) {
  let dx = tx - u.x;
  let dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) {
    u.moving = false;
    return;
  }
  dx /= d;
  dz /= d;
  let sp = u.speed * (u.suppressT > 0 ? 0.35 : 1);
  if (!u.vehicle) {
    // Separation so squads spread out instead of stacking.
    g.units.hash.query(u.x, u.z, 1.6, tmp);
    let sx = 0;
    let sz = 0;
    for (const o of tmp) {
      if (o === u || o.vehicle) continue;
      const ox = u.x - o.x;
      const oz = u.z - o.z;
      const dd = Math.hypot(ox, oz) || 0.01;
      if (dd < 1.6) {
        sx += (ox / dd) * (1.6 - dd);
        sz += (oz / dd) * (1.6 - dd);
      }
    }
    dx += sx * 1.2;
    dz += sz * 1.2;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
  } else {
    // Vehicles slow down behind another vehicle on the road.
    g.units.hash.query(u.x + dx * 9, u.z + dz * 9, 6, tmp);
    for (const o of tmp) {
      if (o !== u && o.vehicle) {
        sp *= 0.2;
        break;
      }
    }
  }
  const step = Math.min(sp * dt, d);
  u.x += dx * step;
  u.z += dz * step;
  u.y = surfaceHeight(u.x, u.z) - g.fx.decals.holeDepth(u.x, u.z);
  u.yaw = turn(u.yaw, Math.atan2(dx, dz), (u.vehicle ? 2.2 : 9) * dt);
  u.phase += step * 2.2;
  u.moving = true;
}

function pickTarget(u, g) {
  if (Math.random() < u.def.friendlyChance) {
    const f = g.units.randomFriendly();
    if (f) return { friendly: f, x: f.x, y: f.y + 1.5, z: f.z };
  }
  const w = nearestWallPoint(u.x, u.z, 0);
  const along = rs(16);
  const onX = Math.abs(w.x) > Math.abs(w.z);
  return { friendly: null, x: onX ? w.x : w.x + along, y: 0.8 + Math.random() * 1.6, z: onX ? w.z + along : w.z };
}

export function applyEnemyHit(g, friendly, dmg, sector) {
  if (friendly) {
    if (friendly.alive && Math.random() < FRIENDLY.enemyHitChance) g.units.damage(friendly, FRIENDLY.enemyDamage, ENEMY_CAUSE);
  } else {
    g.base.damage(dmg, sector);
  }
}

function fire(u, g) {
  const def = u.def;
  const sx = u.x;
  const sy = u.y + (u.vehicle ? 2.4 : 2.0);
  const sz = u.z;
  const t = pickTarget(u, g);
  const sector = sectorOf(u.x, u.z);
  const dmg = def.damage * u.dmgMul;
  u.flashT = 0.08;
  if (def.attack === 'rifle' || def.attack === 'mg') {
    const shots = def.attack === 'mg' ? 3 : 1;
    for (let i = 0; i < shots; i++) g.fx.tracer(sx, sy, sz, t.x + rs(3), t.y + rs(1), t.z + rs(3), 380, 9, 1.1, 1.5);
    g.fx.muzzle(sx, sy, sz, def.attack === 'mg' ? 1.8 : 1.1);
    if (Math.random() < (def.attack === 'mg' ? 0.3 : 0.08)) g.audio.gunfire(sx, sy, sz);
    applyEnemyHit(g, t.friendly, dmg, sector);
  } else {
    g.shells.fireEnemy(def.attack, sx, sy, sz, t.x, t.y, t.z, t.friendly, dmg, sector);
    g.fx.muzzle(sx, sy, sz, 2.4, 2.4);
  }
}

function detonateSapper(u, g) {
  const def = u.def;
  g.fx.blast(u.x, u.y, u.z, 1.6);
  g.audio.smallBlast(u.x, u.y, u.z, 0.45);
  g.base.damage(def.damage * u.dmgMul, sectorOf(u.x, u.z));
  const cause = { ...ENEMY_CAUSE, blast: { x: u.x, z: u.z, power: 14, reach: def.blastRadius } };
  g.units.hash.query(u.x, u.z, def.blastRadius, tmp);
  for (const o of tmp) if (o.alive && o.team === 'friendly') g.units.kill(o, cause);
  g.units.kill(u, cause);
  g.events.emit('sapperHit', u);
}

export function updateEnemy(u, dt, g) {
  const def = u.def;
  if (u.suppressT > 0) u.suppressT -= dt;
  switch (u.state) {
    case 'advance': {
      const r = Math.hypot(u.x, u.z);
      if (u.straggler || (def.attack === 'charge' && r < def.chargeRange)) {
        u.state = 'charge';
        break;
      }
      if (def.ringR && r <= u.ringR) {
        u.state = 'engage';
        u.moving = false;
        if (u.passengers) g.units.dismount(u);
        g.events.emit('enemyEngaged', u);
        break;
      }
      const route = g.world.routes[u.routeId];
      let tx = 0;
      let tz = 0;
      if (u.wp < route.waypoints.length) {
        const p = route.waypoints[u.wp];
        tx = p.x + p.nx * u.lane;
        tz = p.z + p.nz * u.lane;
        const dx = tx - u.x;
        const dz = tz - u.z;
        if (dx * dx + dz * dz < (u.vehicle ? 49 : 36)) u.wp++;
      }
      moveToward(u, tx, tz, dt, g);
      break;
    }
    case 'engage': {
      u.moving = false;
      u.yaw = turn(u.yaw, Math.atan2(-u.x, -u.z), 4 * dt);
      u.fireCd -= dt;
      if (u.fireCd <= 0) {
        fire(u, g);
        u.fireCd = def.fireInterval * (0.75 + 0.5 * Math.random()) * (u.suppressT > 0 ? 2 : 1);
      }
      break;
    }
    case 'charge': {
      const wp = nearestWallPoint(u.x, u.z, u.vehicle ? 6 : 1.5);
      const dx = wp.x - u.x;
      const dz = wp.z - u.z;
      if (dx * dx + dz * dz < 6) {
        if (def.attack === 'charge') {
          detonateSapper(u, g);
          return;
        }
        u.state = 'engage';
        break;
      }
      moveToward(u, wp.x, wp.z, dt, g);
      break;
    }
    default:
      break;
  }
}

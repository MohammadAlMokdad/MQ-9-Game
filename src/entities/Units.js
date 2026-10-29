// Unit store for enemies, friendlies, corpses and wrecks. Owns the spatial hash and the
// instanced draws: soldiers render from baked animation frames, vehicles from their models.
import { InstancedBatch } from '../render/InstancedBatch.js';
import { MATS, vehicleMaterial } from '../render/heat.js';
import { ContactShadows } from '../render/ContactShadows.js';
import { SpatialHash } from '../core/SpatialHash.js';
import { ENEMY_TYPES, FRIENDLY, PERSON_SCALE, VEHICLE_SCALE, RENDER } from '../config.js';
import { surfaceHeight } from '../world/terrain.js';
import { updateEnemy } from './EnemyAI.js';
import { updateFriendly, strobeOn } from './Friendlies.js';

const FRIENDLY_DEF = { mesh: 'person', hp: FRIENDLY.hp, armor: 'soft', radius: 0.5, score: 0 };

// Instance capacity per baked frame, by clip. The last death frame holds every corpse.
const FRAME_CAP = { run: 140, walk: 70, idle: 90, shoot: 90, death: 60, hit: 80 };
const CORPSE_CAP = 420;
const GRAVITY = 24;
const R = Math.random;

// Daylight colours. Painted parts of the models are a neutral base (vehicle bodies 0.74 for the
// pickup, 0.6 for the truck and tank hulls; clothing 0.5), so these multipliers give real paint
// and fabric colours: civilian pickups in white, silver, beige, faded red; military trucks and
// tanks in olive drab, dark green or desert sand; cartel gunmen in jeans, black, olive, khaki;
// our troops in coyote tan.
const toTint = (base, list) => list.map((c) => c.map((v) => v / base));
const PAINT = {
  technical: toTint(0.74, [[0.82, 0.82, 0.8], [0.6, 0.61, 0.62], [0.7, 0.63, 0.5], [0.52, 0.2, 0.16], [0.16, 0.2, 0.28], [0.09, 0.09, 0.09], [0.64, 0.56, 0.4], [0.24, 0.3, 0.22]]),
  apc: toTint(0.6, [[0.36, 0.38, 0.26], [0.32, 0.34, 0.25], [0.62, 0.55, 0.4]]),
  tank: toTint(0.6, [[0.33, 0.35, 0.24], [0.24, 0.29, 0.2], [0.6, 0.53, 0.38]]),
};
const ENEMY_CLOTHES = toTint(0.5, [[0.22, 0.27, 0.38], [0.08, 0.08, 0.08], [0.3, 0.32, 0.22], [0.55, 0.5, 0.38], [0.72, 0.72, 0.7], [0.4, 0.4, 0.4], [0.36, 0.28, 0.2], [0.28, 0.31, 0.22]]);
const FRIENDLY_CLOTHES = toTint(0.5, [[0.55, 0.47, 0.36], [0.5, 0.45, 0.35], [0.52, 0.49, 0.38]]);
const pickFrom = (list) => list[Math.floor(R() * list.length)];
function dayTint(team, def) {
  if (def.vehicle) return pickFrom(PAINT[def.mesh] || PAINT.technical);
  return pickFrom(team === 'friendly' ? FRIENDLY_CLOTHES : ENEMY_CLOTHES);
}

export class Units {
  constructor(game, soldierAnim) {
    this.game = game;
    this.all = [];
    this.hash = new SpatialHash(700, 8, 2048);
    this.nextId = 1;
    this.enemyAlive = 0;
    this.enemyPassengers = 0;
    this.friendlyAlive = 0;
    this.engaged = 0;
    const add = (geom, cap, shadows) => {
      const mat = geom.userData.map ? vehicleMaterial(`unit-${geom.uuid.slice(0, 8)}`, geom.userData.map) : MATS.units;
      const b = new InstancedBatch(geom, mat, cap, shadows);
      game.scene.add(b.mesh);
      return b;
    };
    this.soldier = {};
    for (const [key, anim] of Object.entries(soldierAnim)) {
      const n = anim.frames.length;
      this.soldier[key] = {
        n,
        dur: anim.duration,
        loop: anim.loop,
        batches: anim.frames.map((g, i) => add(g, key === 'death' && i === n - 1 ? CORPSE_CAP : FRAME_CAP[key], RENDER.soldierShadows)),
      };
    }
    const V = game.world.vehicles;
    this.vehicleBatches = { technical: add(V.technical, 80, true), apc: add(V.apc, 60, true), tank: add(V.tank, 40, true) };
    this.batchList = [...Object.values(this.soldier).flatMap((s) => s.batches), ...Object.values(this.vehicleBatches)];
    this.contact = new ContactShadows(game.scene, 700);
  }

  reset() {
    this.all.length = 0;
    this.enemyAlive = 0;
    this.enemyPassengers = 0;
    this.friendlyAlive = 0;
  }

  create(team, type, def, x, z) {
    const u = {
      id: this.nextId++,
      team,
      type,
      def,
      alive: true,
      x,
      y: surfaceHeight(x, z),
      z,
      yaw: 0,
      hp: def.hp,
      maxHp: def.hp,
      armor: def.armor,
      radius: def.radius,
      vehicle: !!def.vehicle,
      scale: def.vehicle ? VEHICLE_SCALE : PERSON_SCALE,
      state: 'advance',
      routeId: 0,
      wp: 0,
      lane: 0,
      ringR: 0,
      speed: def.speed || 0,
      dmgMul: 1,
      plan: null,
      fireCd: 0,
      suppressT: 0,
      moving: false,
      animT: R() * 10,
      deadT: 0,
      passengers: 0,
      heatMul: 0.92 + R() * 0.16,
      tint: dayTint(team, def),
      straggler: false,
      flashT: -1,
      // death physics
      fly: false,
      dying: false,
      fvx: 0,
      fvy: 0,
      fvz: 0,
      spinX: 0,
      spinZ: 0,
      pitch: 0,
      roll: 0,
      slot: '',
      loop: null,
    };
    this.all.push(u);
    return u;
  }

  // `at` places the unit at a given point (dismounts); otherwise it lines up behind the route entry.
  spawnEnemy(type, routeId, idx, plan, at = null) {
    const def = ENEMY_TYPES[type];
    const route = this.game.world.routes[routeId];
    const w0 = route.waypoints[0];
    const w1 = route.waypoints[1] || w0;
    const lane = def.vehicle ? 0 : (R() - 0.5) * (route.main ? 14 : 8);
    let x;
    let z;
    let wp = 1;
    if (at) {
      x = at.x;
      z = at.z;
      wp = at.wp;
    } else {
      let ox = w0.x - w1.x;
      let oz = w0.z - w1.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      const back = def.vehicle ? 0 : idx * 3;
      x = w0.x + ox * back + w0.nx * lane;
      z = w0.z + oz * back + w0.nz * lane;
    }
    const u = this.create('enemy', type, def, x, z);
    u.hp = u.maxHp = def.hp * plan.hpMul;
    u.speed = def.speed * plan.speedMul * (def.vehicle ? 1 : 0.9 + R() * 0.2);
    u.dmgMul = plan.dmgMul;
    u.plan = plan;
    u.routeId = routeId;
    u.wp = wp;
    u.lane = lane;
    u.ringR = def.ringR + (R() - 0.5) * def.ringJitter;
    u.fireCd = R() * (def.fireInterval || 1);
    u.passengers = def.passengers || 0;
    u.yaw = Math.atan2(-x, -z);
    this.enemyAlive++;
    this.enemyPassengers += u.passengers;
    return u;
  }

  dismount(u) {
    const n = u.passengers;
    if (!n) return;
    u.passengers = 0;
    this.enemyPassengers -= n;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy('infantry', u.routeId, 0, u.plan, { x: u.x + Math.cos(a) * 3.5, z: u.z + Math.sin(a) * 3.5, wp: u.wp });
    }
    this.game.events.emit('dismount', { unit: u, count: n });
  }

  spawnFriendlies(onlyMissing = false) {
    const fob = this.game.world.compound;
    const occupied = new Set();
    if (onlyMissing) for (const u of this.all) if (u.team === 'friendly' && u.alive) occupied.add(u.slot);
    let added = 0;
    fob.posts.forEach((p, i) => {
      const slot = `post${i}`;
      if (occupied.has(slot)) return;
      const u = this.create('friendly', 'soldier', FRIENDLY_DEF, p.x, p.z);
      u.y = p.y;
      u.slot = slot;
      u.state = 'post';
      u.yaw = Math.atan2(p.x, p.z);
      u.fireCd = 1 + R() * 2;
      this.friendlyAlive++;
      added++;
    });
    fob.patrols.forEach((pt, i) => {
      const slot = `patrol${i}`;
      if (occupied.has(slot)) return;
      const a = pt.loop[pt.start];
      const u = this.create('friendly', 'soldier', FRIENDLY_DEF, a.x, a.z);
      u.slot = slot;
      u.state = 'patrol';
      u.loop = pt.loop;
      u.wp = (pt.start + 1) % pt.loop.length;
      u.speed = FRIENDLY.patrolSpeed;
      u.fireCd = 1 + R() * 2;
      this.friendlyAlive++;
      added++;
    });
    return added;
  }

  // Throws a body (or hops a wreck) away from a blast.
  launch(u, bx, bz, power, reach) {
    const dx = u.x - bx;
    const dz = u.z - bz;
    const d = Math.hypot(dx, dz) || 0.5;
    const k = Math.max(0.25, 1 - d / reach);
    const sp = power * k * (0.7 + R() * 0.5);
    u.fly = true;
    u.fvx = (dx / d) * sp + (R() - 0.5) * 3;
    u.fvz = (dz / d) * sp + (R() - 0.5) * 3;
    u.fvy = power * 0.85 * k * (0.6 + R() * 0.5) + 3;
    const spin = u.vehicle ? 1.2 : 9;
    u.spinX = (R() - 0.5) * spin;
    u.spinZ = (R() - 0.5) * spin;
    u.yaw = Math.atan2(dx, dz);
  }

  // Returns how many enemies died (a loaded vehicle takes its passengers with it).
  kill(u, cause) {
    if (!u.alive) return 0;
    u.alive = false;
    u.hp = 0;
    u.state = 'dead';
    u.deadT = 0;
    u.moving = false;
    const g = this.game;
    const blast = cause.blast;
    if (!u.vehicle) {
      if (blast && blast.power > 0) this.launch(u, blast.x, blast.z, blast.power, blast.reach);
      else u.dying = true;
    }
    if (u.team === 'friendly') {
      this.friendlyAlive--;
      g.events.emit('friendlyKilled', { unit: u, cause });
      return 0;
    }
    this.enemyAlive--;
    let kills = 1;
    g.events.emit('kill', { unit: u, cause });
    if (u.vehicle) {
      u.pitch = (R() - 0.5) * 0.12;
      u.roll = (R() - 0.5) * 0.25;
      if (blast && blast.power > 15) this.launch(u, blast.x, blast.z, 7, blast.reach * 1.5);
      g.fx.vehicleDeath(u.x, u.y, u.z, u.radius);
      g.audio.vehicleExplosion(u.x, u.y, u.z);
      const n = u.passengers;
      u.passengers = 0;
      this.enemyPassengers -= n;
      for (let i = 0; i < n; i++) {
        const c = this.create('enemy', 'infantry', ENEMY_TYPES.infantry, u.x + (R() - 0.5) * 3, u.z + (R() - 0.5) * 3);
        c.alive = false;
        c.state = 'dead';
        c.y += 1.5;
        this.launch(c, u.x, u.z, 16, 6);
        g.events.emit('kill', { unit: c, cause });
        kills++;
      }
    }
    return kills;
  }

  damage(u, amount, cause) {
    if (!u.alive) return 0;
    u.hp -= amount;
    return u.hp <= 0 ? this.kill(u, cause) : 0;
  }

  nearestEnemy(x, z, range) {
    let best = null;
    let bd = range * range;
    for (const u of this.all) {
      if (!u.alive || u.team !== 'enemy') continue;
      const d = (u.x - x) ** 2 + (u.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  // Nearest live enemy vehicle to (x, z) within range, or null (guided bomb targeting).
  nearestVehicle(x, z, range) {
    let best = null;
    let bd = range * range;
    for (const u of this.all) {
      if (!u.alive || u.team !== 'enemy' || !u.vehicle) continue;
      const d = (u.x - x) ** 2 + (u.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  randomFriendly() {
    let pick = null;
    let seen = 0;
    for (const u of this.all) {
      if (!u.alive || u.team !== 'friendly') continue;
      seen++;
      if (R() * seen < 1) pick = u;
    }
    return pick;
  }

  killAllEnemies(cause) {
    for (const u of this.all) if (u.alive && u.team === 'enemy') this.kill(u, cause);
  }

  update(dt) {
    const g = this.game;
    const all = this.all;
    this.hash.clear();
    for (const u of all) if (u.alive) this.hash.insert(u);
    let engaged = 0;
    for (let i = 0, n = all.length; i < n; i++) {
      const u = all[i];
      if (u.alive) {
        u.flashT -= dt;
        if (u.team === 'enemy') {
          updateEnemy(u, dt, g);
          if (u.state === 'engage') engaged++;
        } else {
          updateFriendly(u, dt, g);
        }
        // Gait speed follows movement speed.
        u.animT += dt * (u.moving ? Math.max(0.6, u.speed / (u.speed > 2.2 ? 4 : 1.4)) : 1);
      } else {
        u.deadT += dt;
        if (u.fly) this.integrateBody(u, dt);
      }
    }
    this.engaged = engaged;
    // Drop old corpses and wrecks; bodies go sooner when the field is crowded.
    let corpses = 0;
    for (const u of all) if (!u.alive && !u.vehicle) corpses++;
    const bodyLife = corpses > CORPSE_CAP * 0.75 ? 20 : 50;
    let w = 0;
    for (let i = 0; i < all.length; i++) {
      const u = all[i];
      if (!u.alive && u.deadT > (u.vehicle ? 75 : bodyLife)) continue;
      all[w++] = u;
    }
    all.length = w;
  }

  integrateBody(u, dt) {
    u.fvy -= GRAVITY * dt;
    u.x += u.fvx * dt;
    u.y += u.fvy * dt;
    u.z += u.fvz * dt;
    u.pitch += u.spinX * dt;
    u.roll += u.spinZ * dt;
    const gy = surfaceHeight(u.x, u.z) - this.game.fx.decals.holeDepth(u.x, u.z);
    if (u.y > gy) return;
    u.y = gy;
    if (u.fvy < -7) {
      u.fvy *= -0.25;
      u.fvx *= 0.45;
      u.fvz *= 0.45;
      u.spinX *= 0.4;
      u.spinZ *= 0.4;
      if (!u.vehicle) this.game.fx.dust(u.x, u.y, u.z, 0.6);
    } else {
      u.fly = false;
      if (u.vehicle) {
        u.pitch = (R() - 0.5) * 0.15;
        u.roll = (R() - 0.5) * 0.3;
        this.game.fx.dust(u.x, u.y, u.z, 2);
      } else {
        u.pitch = 0;
        u.roll = 0;
        this.game.fx.dust(u.x, u.y, u.z, 0.8);
      }
    }
  }

  soldierFrame(key, t) {
    const s = this.soldier[key];
    const f = s.loop ? Math.floor((t / s.dur) * s.n) % s.n : Math.min(s.n - 1, Math.floor((t / s.dur) * (s.n - 1)));
    return s.batches[f < 0 ? 0 : f];
  }

  render(time) {
    for (const b of this.batchList) b.begin();
    const contact = this.contact;
    contact.begin();
    const V = this.game.world.vehicles;
    const strobes = this.game.fx.strobes;
    strobes.begin();
    const deathDur = this.soldier.death.dur;
    // Thermal: instance color is a heat multiplier. Daylight: clothing / paint tint.
    const th = this.game.renderer.thermalMode;
    for (const u of this.all) {
      if (u.vehicle) {
        const b = this.vehicleBatches[u.def.mesh];
        if (!u.fly) {
          const sz = V[u.def.mesh].userData.size;
          contact.push(u.x, u.y, u.z, u.yaw, sz.w * u.scale * 1.15, sz.l * u.scale * 1.08, u.alive ? 1 : 0.8);
        }
        if (u.alive) {
          if (th) b.push(u.x, u.y, u.z, u.yaw, 0, 0, u.scale, u.heatMul * (u.flashT > 0 ? 1.2 : 1));
          else b.push(u.x, u.y, u.z, u.yaw, 0, 0, u.scale, u.tint[0], u.tint[1], u.tint[2]);
        } else {
          const k = Math.exp(-u.deadT / 18);
          const flick = 0.8 + 0.2 * Math.sin(time * 21 + u.id) * Math.sin(time * 6.7 + u.id * 3);
          if (th) b.push(u.x, u.y - 0.2, u.z, u.yaw, u.pitch, u.roll, u.scale, 0.42 + 1.15 * k * flick);
          // Negative colour: charred all over, not just the paint (see heat.js SURF_PAINT).
          else b.push(u.x, u.y - 0.2, u.z, u.yaw, u.pitch, u.roll, u.scale, -0.16, -0.15, -0.14);
        }
        continue;
      }
      let b;
      let pitch = 0;
      let roll = 0;
      if (u.alive) {
        if (u.moving) b = this.soldierFrame(u.speed > 2.2 ? 'run' : 'walk', u.animT);
        else b = this.soldierFrame(u.flashT > -0.6 ? 'shoot' : 'idle', u.animT);
        if (u.team === 'friendly') strobes.push(u.x, u.y + 1.9 * u.scale, u.z, strobeOn(time, u.id));
      } else if (u.fly) {
        b = this.soldier.hit.batches[3];
        pitch = u.pitch;
        roll = u.roll;
      } else if (u.dying && u.deadT < deathDur) {
        b = this.soldierFrame('death', u.deadT);
      } else {
        const d = this.soldier.death;
        b = d.batches[d.n - 1];
      }
      if (!u.fly) {
        if (u.alive) contact.push(u.x, u.y, u.z, u.yaw, 0.9 * u.scale, 0.9 * u.scale, 0.75);
        else contact.push(u.x, u.y, u.z, u.yaw, 0.9 * u.scale, 1.9 * u.scale, 0.55);
      }
      if (th) {
        const heat = u.alive ? u.heatMul * (u.flashT > 0 ? 1.2 : 1) : u.heatMul * (0.38 + 0.62 * Math.exp(-u.deadT / 16));
        b.push(u.x, u.y, u.z, u.yaw, pitch, roll, u.scale, heat);
      } else {
        b.push(u.x, u.y, u.z, u.yaw, pitch, roll, u.scale, u.tint[0], u.tint[1], u.tint[2]);
      }
    }
    for (const b of this.batchList) b.end();
    contact.end();
    strobes.end();
  }
}

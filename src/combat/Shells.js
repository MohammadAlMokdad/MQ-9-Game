// Rounds in flight, all flying real paths through the world. Player shells fly a ballistic arc
// from the guns to their impact point in a real flight time, so moving targets must be led; seen
// from the sensor they streak in from the guns' side of the picture and slow as they recede.
// Guided bombs drop off the rack under the aircraft, keep its motion at first, sag below the line
// of sight and are steered onto a vehicle.
// Enemy rockets and cannon rounds fly toward the base or a friendly.
import * as THREE from 'three';
import { WEAPONS, FRIENDLY, GBU, weaponIndex } from '../config.js';
import { ENEMY_CAUSE, applyEnemyHit } from '../entities/EnemyAI.js';
import { surfaceHeight } from '../world/terrain.js';

const tmp = [];
const rs = (s) => (Math.random() - 0.5) * s;
const ENEMY_SPEED = { rocket: 75, cannon: 220, shell: 260 };
const BOMB = weaponIndex('gbu');
const G = 9.81;
// A tracer's glowing streak: its burning length, or the distance it covers in the sensor's
// exposure, whichever is longer.
const STREAK_TIME = 0.06;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

// Seconds a guided bomb takes to land from `dist` metres away.
export function bombFlightTime(dist) {
  return Math.min(GBU.timeMax, Math.max(GBU.timeMin, dist / GBU.pathSpeed));
}

export class Shells {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.bombs = [];
    this.enemy = [];
    this.nextId = 1;
    this.lastSplash = null;
  }

  reset() {
    for (const s of this.list) s.done = true;
    this.list.length = 0;
    this.bombs.length = 0;
    this.enemy.length = 0;
    this.lastSplash = null;
    this.game.audio.stopScheduled();
  }

  // Fires a round from the muzzle `from` to land on `to` after its flight time: a ballistic arc
  // under gravity (the fire-control aims a little high to allow for the drop).
  fire(wi, from, to) {
    const w = WEAPONS[wi];
    const T = from.distanceTo(to) / w.speed;
    const s = {
      id: this.nextId++,
      wi,
      x: to.x,
      y: to.y,
      z: to.z,
      t: 0,
      tFlight: T,
      muzzle: from.clone(),
      v0: new THREE.Vector3().subVectors(to, from).divideScalar(T).setY((to.y - from.y) / T + 0.5 * G * T),
      // Where it is this frame (see shellPath): its head, its tracer's tail and its heading.
      head: new THREE.Vector3(),
      tail: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      streak: Math.max(w.tracerLen, w.speed * STREAK_TIME) / w.speed,
      done: false,
    };
    this.shellPath(s);
    this.list.push(s);
    this.game.fx.tracers.addLinked(s, w.tracerHeat, w.tracerWidth);
    if (w.id !== '25') this.lastSplash = s;
    return s;
  }

  shellAt(s, t, out) {
    return out.copy(s.muzzle).addScaledVector(s.v0, t).setY(s.muzzle.y + s.v0.y * t - 0.5 * G * t * t);
  }

  shellPath(s) {
    const t = Math.min(s.t, s.tFlight);
    this.shellAt(s, t, s.head);
    this.shellAt(s, Math.max(0, t - s.streak), s.tail);
    s.dir.copy(s.v0).setY(s.v0.y - G * t).normalize();
  }

  // Releases a guided bomb from the aircraft. It locks the enemy vehicle nearest the aim point
  // (within GBU.lockRange) and flies for a fixed time, its aim point following the vehicle.
  // With no vehicle it dives on the aim point.
  fireBomb(from, aim) {
    const target = this.game.units.nearestVehicle(aim.x, aim.z, GBU.lockRange);
    const end = target ? new THREE.Vector3(target.x, target.y + 1, target.z) : aim.clone();
    const T = bombFlightTime(from.distanceTo(end));
    const cam = this.game.cam;
    const b = {
      id: this.nextId++,
      wi: BOMB,
      x: cam.pos.x,
      y: cam.pos.y + GBU.rack,
      z: cam.pos.z,
      vx: 0,
      vy: -1,
      vz: 0,
      t: 0,
      T,
      tti: T,
      aim: end.clone(),
      target,
      ax: end.x,
      ay: end.y,
      az: end.z,
      incoming: false,
      onScreen: false,
    };
    this.bombPath(b, 0);
    this.bombs.push(b);
    return b;
  }

  // Where a bomb is, `t` seconds after release. It hangs `GBU.rack` metres under the aircraft and
  // drops away moving with it; then it falls away toward its target, faster and faster, along
  // the line from the aircraft to the target, sagging below that line (and lagging behind the
  // aircraft) the way a falling, gliding bomb does until its fins pull it onto the target.
  // Seen from the sensor it drops out of the bottom of the picture, slides back in from the
  // bottom edge and dives onto the crosshair. The sag is set from the sensor's field of view, so
  // it slides in early in its fall at any zoom.
  bombPath(b, dt) {
    const cam = this.game.cam;
    const x = Math.min(1, b.t / b.T);
    const s = x * (0.6 + 0.4 * x);
    // On the line from the rack to the target.
    _a.copy(cam.pos);
    _a.y += GBU.rack;
    _a.lerp(b.aim, s);
    // Sag: down across the line of sight (world down seen at a slant), with some lag behind
    // the aircraft's motion (the sensor's right is the aircraft's forward).
    _f.subVectors(b.aim, cam.pos);
    const D = _f.length();
    _f.multiplyScalar(1 / D);
    _b.set(0, -1, 0).addScaledVector(_f, _f.y).normalize();
    _r.setFromMatrixColumn(cam.camera.matrixWorld, 0);
    _b.addScaledVector(_r, -GBU.lag).normalize();
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    _a.addScaledVector(_b, GBU.sag * tanV * D * s * (1 - s));
    if (dt > 0) {
      b.vx = (_a.x - b.x) / dt;
      b.vy = (_a.y - b.y) / dt;
      b.vz = (_a.z - b.z) / dt;
    }
    b.x = _a.x;
    b.y = _a.y;
    b.z = _a.z;
  }

  // Seconds until the most recent 40mm/105mm round lands, or -1.
  splashIn() {
    const s = this.lastSplash;
    return s && s.t < s.tFlight ? s.tFlight - s.t : -1;
  }

  fireEnemy(kind, sx, sy, sz, tx, ty, tz, friendly, dmg, sector) {
    const speed = ENEMY_SPEED[kind];
    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    this.enemy.push({ kind, x: sx, y: sy, z: sz, ux: dx / dist, uy: dy / dist, uz: dz / dist, dist, travelled: 0, speed, friendly, dmg, sector, trail: 0, tx, ty, tz });
    if (kind !== 'rocket') this.game.fx.tracer(sx, sy, sz, tx, ty, tz, speed, 8, 1.8, 2.2);
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      if (s.t >= s.tFlight) {
        s.done = true; // its tracer goes with it
        this.list.splice(i, 1);
        g.damage.detonate(s);
      } else {
        this.shellPath(s);
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      if (this.updateBomb(this.bombs[i], dt)) this.bombs.splice(i, 1);
    }
    for (let i = this.enemy.length - 1; i >= 0; i--) {
      const r = this.enemy[i];
      const step = r.speed * dt;
      r.travelled += step;
      r.x += r.ux * step;
      r.y += r.uy * step;
      r.z += r.uz * step;
      if (r.kind === 'rocket') {
        r.trail -= dt;
        if (r.trail <= 0) {
          r.trail = 0.025;
          g.fx.smoke.emit(r.x, r.y, r.z, rs(0.6), 0.5, rs(0.6), 1.6, 1.2, 4, 0.58, 0.26, 0.65, 0, 0, 0.6, -1, 0, 0.6, 0.35);
          g.fx.hot.emit(r.x, r.y, r.z, 0, 0, 0, 0.06, 1.6, 1.0, 2.4, 1.0, 1, 1, 0, 0, 15);
        }
      }
      if (r.travelled >= r.dist) {
        this.enemy.splice(i, 1);
        this.enemyImpact(r);
      }
    }
  }

  // Moves a guided bomb along its path. Returns true once it has gone off.
  updateBomb(b, dt) {
    const g = this.game;
    b.t += dt;
    // The locked vehicle was destroyed: take the nearest other vehicle, else keep the spot.
    if (b.target && !b.target.alive) b.target = g.units.nearestVehicle(b.aim.x, b.aim.z, 80);
    // The aim point follows the target at a limited speed, so a target switch never makes the
    // bomb jump.
    if (b.target) {
      _a.set(b.target.x, b.target.y + 1, b.target.z).sub(b.aim);
      const d = _a.length();
      const step = GBU.track * dt;
      if (d > step) _a.multiplyScalar(step / d);
      b.aim.add(_a);
    }
    b.ax = b.aim.x;
    b.ay = b.aim.y;
    b.az = b.aim.z;
    const x = Math.min(1, b.t / b.T);
    this.bombPath(b, dt);
    b.tti = Math.max(0, b.T - b.t);
    if (!b.incoming && b.tti < 3) {
      b.incoming = true;
      g.audio.gbuIncoming(b.tti, b.aim.x, b.aim.y, b.aim.z);
    }
    if (x >= 1) {
      this.detonateBomb(b, b.aim.x, b.aim.y - 1, b.aim.z);
      return true;
    }
    const ground = surfaceHeight(b.x, b.z);
    if (b.y <= ground + 0.3) {
      this.detonateBomb(b, b.x, ground, b.z);
      return true;
    }
    return false;
  }

  detonateBomb(b, x, y, z) {
    this.game.damage.detonate({ id: b.id, wi: BOMB, x, y, z });
  }

  enemyImpact(r) {
    const g = this.game;
    g.fx.blast(r.tx, r.ty - 0.5, r.tz, r.kind === 'shell' ? 1.4 : r.kind === 'cannon' ? 0.8 : 1);
    g.audio.smallBlast(r.tx, r.ty, r.tz, r.kind === 'shell' ? 0.4 : 0.25);
    if (r.friendly) {
      // Explosive rounds hurt everyone near the soldier they were aimed at.
      g.units.hash.query(r.tx, r.tz, 4, tmp);
      for (const u of tmp) if (u.alive && u.team === 'friendly') g.units.damage(u, FRIENDLY.enemyDamage * 2, ENEMY_CAUSE);
    } else {
      applyEnemyHit(g, null, r.dmg, r.sector);
    }
  }
}

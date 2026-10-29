// Effect recipes on top of the particle, tracer and decal systems, plus smoke/fire emitters,
// delayed events and the friendly IR strobes.
//
// The recipes follow real gunship footage: an HE round is a very short flash and fireball, then
// a brown-grey cloud of earth and smoke that billows up and drifts downwind, a ring of dust
// rolling out along the ground, and dirt thrown in arcs. Burning vehicles put up a column of
// black oily smoke over the flames.
import * as THREE from 'three';
import { PointSystem, PARTICLE_LIGHT } from './Particles.js';
import { Tracers } from './Tracers.js';
import { Decals } from './Decals.js';
import { spriteAtlas } from '../render/textures.js';
import { SENSOR, SUN } from '../render/heat.js';
import { surfaceHeight } from '../world/terrain.js';
import { WEAPONS, HEAT } from '../config.js';

const R = Math.random;
const rs = (s) => (R() - 0.5) * s;
const DOT = 15; // atlas frame: soft round dot
const flame = () => 12 + Math.floor(R() * 3);
const _v = new THREE.Vector3();

const STROBE_VERT = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = 4.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// IR strobes only show on the thermal sensor, as with real infrared beacons.
const STROBE_FRAG = /* glsl */ `
  uniform float uHeat;
  uniform float uThermal;
  varying float vAlpha;
  void main() {
    if (vAlpha * uThermal < 0.01) discard;
    gl_FragColor = vec4(vec3(uHeat * vAlpha), 1.0);
  }`;

class Strobes {
  constructor(cap = 48) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.alpha = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uHeat: { value: HEAT.strobe }, uThermal: SENSOR.uThermal },
        vertexShader: STROBE_VERT,
        fragmentShader: STROBE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  push(x, y, z, a) {
    if (this.n >= this.cap) return;
    const o = this.n * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.alpha[this.n] = a;
    this.n++;
  }

  end() {
    this.aPos.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.geometry.setDrawRange(0, this.n);
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const atlas = spriteAtlas();
    this.hot = new PointSystem(4500, 'hot', atlas);
    this.smoke = new PointSystem(6500, 'smoke', atlas);
    this.tracers = new Tracers(900);
    this.decals = new Decals(scene, game.assets.textures);
    this.strobes = new Strobes();
    scene.add(this.smoke.points, this.hot.points, this.tracers.lines, this.strobes.points);
    this.emitters = [];
    this.timers = [];
    this.nextEmitter = 1;
  }

  reset() {
    this.hot.clear();
    this.smoke.clear();
    this.tracers.clear();
    this.decals.clear();
    this.emitters.length = 0;
    this.timers.length = 0;
  }

  // Ground height under the next emissions, so particles fade softly where they meet it.
  ground(y) {
    this.hot.ground = y;
    this.smoke.ground = y;
  }

  after(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  addEmitter(x, y, z, { life = Infinity, interval = 0.3, fire = false, size = 1, smoke = true } = {}) {
    const e = { id: this.nextEmitter++, x, y, z, gy: surfaceHeight(x, z), life, interval, fire, size, smoke, acc: R() * interval };
    this.emitters.push(e);
    return e.id;
  }

  removeEmitter(id) {
    const i = this.emitters.findIndex((e) => e.id === id);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  // Burning things within `radius` of a point (for the fire crackle loop).
  firesNear(x, z, radius) {
    let n = 0;
    for (const e of this.emitters) if (e.fire && (e.x - x) ** 2 + (e.z - z) ** 2 < radius * radius) n += e.size;
    return n;
  }

  tracer(ax, ay, az, bx, by, bz, speed = 420, len = 10, heat = 1.2, width = 1.6) {
    this.tracers.add(ax, ay, az, bx, by, bz, speed, len, heat, width);
  }

  muzzle(x, y, z, size = 1.4, heat = 2.2) {
    this.ground(-1e4);
    this.hot.emit(x, y, z, 0, 0, 0, 0.07, size * 1.8, size * 2.2, heat, heat * 0.4, 1, 1, 0, 0, DOT);
  }

  // Small tan puff (bodies hitting the ground, wrecks settling).
  dust(x, y, z, size = 1) {
    this.ground(y - 0.2);
    for (let i = 0; i < 3; i++) this.smoke.emit(x + rs(size), y + 0.4, z + rs(size), rs(2), 0.6 + R(), rs(2), 1.8 + R(), 1.5 * size, 4.8 * size, 0.36, 0.24, 0.55, 0, 0, 0.8, -1, 0, 0.4, 0.05);
  }

  // Earth thrown out by a blast: dark clods arcing out and falling back (daylight), with a few
  // glowing fragments (thermal).
  debris(x, y, z, n, speed, up, hotFrac = 0.4) {
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283;
      const s = speed * (0.35 + R() * 0.65);
      const sz = 0.25 + R() * 0.45;
      this.smoke.emit(x, y + 0.6, z, Math.cos(a) * s, up * (0.45 + R() * 0.8), Math.sin(a) * s, 1.1 + R() * 1.3, sz, sz * 0.8, 0.7, 0.4, 0.95, 0.9, 26, 0.25, DOT, 0.035, 0, 0.75);
      if (R() < hotFrac) this.hot.emit(x, y + 0.6, z, Math.cos(a) * s, up * (0.4 + R() * 0.8), Math.sin(a) * s, 0.5 + R() * 0.7, 0.9, 0.4, 2.1, 0.5, 1, 0.8, 30, 0.25, DOT, 0.045);
    }
  }

  // Dust rolling out along the ground from the blast.
  dustRing(x, y, z, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rs(0.3);
      const sp = speed * (0.7 + R() * 0.5);
      this.smoke.emit(x + Math.cos(a) * size * 0.3, y + size * 0.25, z + Math.sin(a) * size * 0.3, Math.cos(a) * sp, 0.6 + R(), Math.sin(a) * sp, 3.5 + R() * 2.5, size, size * 2.8, 0.44, 0.23, 0.75, 0, 0, 1.4, -1, 0, 0.7, 0.08);
    }
  }

  // The rising cloud of earth and explosive smoke: thrown out fast, braked by drag, then
  // billowing up and drifting. A darker core and lighter, dustier edges.
  cloud(x, y, z, n, spread, size0, size1, rise, life, darkCore = 0.55) {
    for (let i = 0; i < n; i++) {
      const core = i < n * 0.35;
      const a = R() * 6.283;
      const out = spread * (core ? 0.5 + R() * 0.6 : 1.1 + R() * 1.3);
      const r = R() * spread * 0.25;
      this.smoke.emit(
        x + Math.cos(a) * r, y + size0 * 0.35 + R() * spread * 0.3, z + Math.sin(a) * r,
        Math.cos(a) * out, rise * (0.6 + R() * 0.9) * (core ? 1.3 : 1), Math.sin(a) * out,
        life * (0.75 + R() * 0.5), size0 * (0.8 + R() * 0.4), size1 * (0.8 + R() * 0.4),
        core ? 0.68 : 0.58, 0.26, 0.95, 0, 0, 1.15, -1, 0, 1,
        core ? darkCore : 0.08 + R() * 0.12,
      );
    }
  }

  // Shell and bomb impacts, by weapon index (see WEAPONS).
  impact(wi, x, y, z) {
    const { hot, smoke } = this;
    const w = WEAPONS[wi];
    this.ground(y - 0.3);
    if (w.id === '25') {
      // 25mm HEI: a sharp flash with incendiary sparkle, a puff of dust, a spray of dirt.
      hot.emit(x, y + 0.5, z, 0, 0, 0, 0.07, 2.8, 4.2, 2.6, 0.2, 1, 1, 0, 0, DOT);
      for (let i = 0; i < 4; i++) hot.emit(x, y + 0.3, z, rs(16), 4 + R() * 9, rs(16), 0.18 + R() * 0.25, 0.5, 0.25, 2.2, 0.4, 1, 1, 25, 0.4, DOT, 0.05);
      for (let i = 0; i < 3; i++) smoke.emit(x + rs(1.5), y + 0.7, z + rs(1.5), rs(1.5), 1 + R(), rs(1.5), 2 + R() * 1.5, 1.4, 5, 0.46, 0.25, 0.7, 0, 0, 0.6, -1, 0, 0.6, 0.12);
      for (let i = 0; i < 4; i++) {
        const a = R() * 6.283;
        const s = 4 + R() * 5;
        smoke.emit(x, y + 0.3, z, Math.cos(a) * s, 4 + R() * 5, Math.sin(a) * s, 0.7 + R() * 0.4, 0.3, 0.25, 0.6, 0.4, 0.9, 0.9, 24, 0.2, DOT, 0.03, 0, 0.7);
      }
      this.decals.addCrater(x, y, z, w.decal, 0.5);
    } else if (w.id === '40') {
      // 40mm HE: flash and a short fireball, then a 6-10 m cloud of dust and smoke.
      hot.emit(x, y + 1.4, z, 0, 0, 0, 0.12, 9, 15, 3.2, 0, 1, 1, 0, 0, DOT);
      for (let i = 0; i < 6; i++) hot.emit(x + rs(3), y + 0.8 + R() * 2, z + rs(3), rs(7), 2 + R() * 6, rs(7), 0.22 + R() * 0.15, 3, 7, 2.6, 0.3, 1, 1, 0, 1.6, flame());
      this.cloud(x, y, z, 9, 5, 3.5, 13, 3.5, 6, 0.5);
      this.debris(x, y, z, 14, 24, 20, 0.35);
      this.dustRing(x, y, z, 10, 14, 3.5);
      this.decals.addCrater(x, y, z, w.decal, 0.7);
      if (R() < 0.25) this.addEmitter(x + rs(3), y + 0.4, z + rs(3), { life: 5 + R() * 4, interval: 0.25, fire: true, size: 0.4, smoke: false });
    } else {
      // 105mm HE and the guided bomb (bigger still): a blinding flash, a brief fireball, a
      // towering cloud, a dust ring racing out, dirt thrown in arcs, and a haze of dust over the spot.
      const bomb = w.id === 'gbu';
      const k = bomb ? 1.55 : 1;
      hot.emit(x, y + 4 * k, z, 0, 0, 0, 0.16, 32 * k, 60 * k, 3.4, 0, 1, 1, 0, 0, DOT);
      for (let i = 0; i < 12; i++) hot.emit(x + rs(8 * k), y + 1.5 + R() * 5 * k, z + rs(8 * k), rs(12), 5 + R() * 10, rs(12), 0.3 + R() * 0.25, 7 * k, 17 * k, 3.0, 0.3, 1, 1, 0, 1.6, flame());
      for (let i = 0; i < 6; i++) hot.emit(x + rs(6 * k), y + 3 + R() * 6, z + rs(6 * k), rs(8), 8 + R() * 10, rs(8), 0.5 + R() * 0.4, 10 * k, 24 * k, 1.6, 0, 1, 1, 0, 1.1);
      this.cloud(x, y, z, Math.round(24 * k), 12 * k, 10 * k, 32 * k, 9 * k, 12, 0.6);
      this.debris(x, y, z, Math.round(42 * k), 48 * k, 38 * k, 0.3);
      this.dustRing(x, y, z, Math.round(22 * k), 26 * k, 8 * k);
      // Lingering haze of fine dust drifting downwind.
      for (let i = 0; i < 6 * k; i++) smoke.emit(x + rs(20 * k), y + 4 + R() * 10 * k, z + rs(20 * k), rs(2), 0.8 + R(), rs(2), 14 + R() * 8, 20 * k, 42 * k, 0.4, 0.22, 0.32, 0, 0, 0.15, -1, 0, 1.2, 0.15);
      this.decals.addRing(x, y, z, 55 * k, 0.45, 1.4);
      this.decals.addCrater(x, y, z, w.decal, 1.0);
      const fires = bomb ? 5 : 3;
      for (let i = 0; i < fires; i++) if (R() < 0.6) this.addEmitter(x + rs(14 * k), y + 0.5, z + rs(14 * k), { life: 6 + R() * 8, interval: 0.2, fire: true, size: 0.45 + R() * 0.4, smoke: R() < 0.6 });
    }
  }

  // Small explosion used for RPG/cannon hits and sappers.
  blast(x, y, z, size = 1) {
    const { hot } = this;
    this.ground(y - 0.3);
    hot.emit(x, y + 1, z, 0, 0, 0, 0.12, 10 * size, 16 * size, 2.8, 0, 1, 1, 0, 0, DOT);
    for (let i = 0; i < 5; i++) hot.emit(x + rs(2 * size), y + 1, z + rs(2 * size), rs(6), 2 + R() * 5, rs(6), 0.25 + R() * 0.2, 2.5 * size, 7 * size, 2.5, 0.3, 1, 1, 0, 1.6, flame());
    this.cloud(x, y, z, Math.round(7 * size), 3 * size, 3 * size, 11 * size, 3, 5, 0.6);
    this.debris(x, y, z, Math.round(9 * size), 16 * size, 14 * size, 0.35);
    this.decals.addCrater(x, y, z, 3 * size, 0.7);
  }

  // A vehicle brews up: fuel fireball rolling upward, debris, then it burns with a column of
  // black smoke for a minute.
  vehicleDeath(x, y, z, radius) {
    const { hot, smoke } = this;
    this.ground(y - 0.3);
    hot.emit(x, y + 3, z, 0, 0, 0, 0.2, 26, 40, 3.2, 0, 1, 1, 0, 0, DOT);
    for (let i = 0; i < 14; i++) hot.emit(x + rs(radius * 2), y + 1 + R() * 3, z + rs(radius * 2), rs(8), 5 + R() * 9, rs(8), 0.55 + R() * 0.45, 6, 16, 2.7, 0.35, 1, 1, -2, 1.3, flame());
    for (let i = 0; i < 8; i++) smoke.emit(x + rs(radius), y + 3 + R() * 4, z + rs(radius), rs(3), 5 + R() * 4, rs(3), 6 + R() * 4, 5, 16, 0.9, 0.3, 0.9, 0, 0, 0.35, -1, 0, 1, 0.95);
    this.debris(x, y, z, 22, 26, 26, 0.5);
    this.after(0.35, () => this.blast(x + rs(2), y + 1, z + rs(2), 1.4));
    return this.addEmitter(x, y + 1.5, z, { life: 60, interval: 0.14, fire: true, size: 1.3 });
  }

  update(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.emitters.splice(i, 1);
        continue;
      }
      e.acc += dt;
      const fade = Math.min(1, e.life / 12);
      const s = e.size;
      this.ground(e.gy - 0.2);
      while (e.acc >= e.interval) {
        e.acc -= e.interval;
        // Burning fuel and tyres give black smoke; small grass fires give grey.
        if (e.smoke) {
          const dark = e.fire ? 0.9 : 0.5;
          this.smoke.emit(e.x + rs(1.6 * s), e.y + 0.5 + R(), e.z + rs(1.6 * s), rs(1), 3 + R() * 2.5, rs(1), 8 + R() * 5, 2.5 * s, 18 * s, 0.6, 0.24, 0.85 * fade, 0, 0, 0.1, -1, 0, 1, dark);
        }
        if (e.fire) {
          this.hot.emit(e.x + rs(2.2 * s), e.y - 0.4 + R() * s, e.z + rs(2.2 * s), rs(1), 2 + R() * 3, rs(1), 0.35 + R() * 0.35, 1.8 * s, 4.2 * s, 2.0 * fade + 0.25, 0.2, 1, 1, 0, 0, flame(), 0, 0.3);
          if (R() < 0.3) this.hot.emit(e.x + rs(2 * s), e.y + R() * s, e.z + rs(2 * s), rs(2), 4 + R() * 4, rs(2), 0.8 + R() * 0.6, 0.3, 0.15, 2.0, 0.4, 1, 1, -2, 0, DOT, 0, 0.5);
        }
      }
    }

    const g = this.game;
    // Sun direction in view space for lighting the smoke billboards.
    const cam = g.cam.camera;
    _v.copy(SUN).transformDirection(cam.matrixWorldInverse);
    PARTICLE_LIGHT.uSunView.value.copy(_v);
    this.hot.update(dt);
    this.smoke.update(dt);
    this.tracers.update(dt, g.renderer.width, g.renderer.height);
    this.decals.update(dt);
  }
}

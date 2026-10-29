// The guns and the guided bomb: rate of fire, 40mm magazine, 25mm barrel heat, bomb rearming,
// and the switch delay.
import * as THREE from 'three';
import { WEAPONS, CAMERA } from '../config.js';

const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();

export class Weapons {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.cur = 0;
    this.switchT = 0;
    this.state = WEAPONS.map((w) => ({ cd: 0, ammo: w.mag, reloadT: 0, heat: 0, overheated: false, idleT: 0 }));
  }

  get weapon() {
    return WEAPONS[this.cur];
  }

  select(i) {
    if (i === this.cur || i < 0 || i >= WEAPONS.length) return;
    this.cur = i;
    this.switchT = CAMERA.switchTime;
    this.game.renderer.addStatic(CAMERA.switchTime);
    this.game.audio.click();
  }

  cycle(d) {
    this.select((this.cur + d + WEAPONS.length) % WEAPONS.length);
  }

  reload() {
    const w = this.weapon;
    const s = this.state[this.cur];
    if (!w.mag || s.reloadT > 0 || s.ammo === w.mag) return;
    s.reloadT = w.reload;
  }

  update(dt, trigger) {
    const g = this.game;
    this.switchT = Math.max(0, this.switchT - dt);
    for (let i = 0; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      const s = this.state[i];
      const wasCooling = s.cd > 0;
      s.cd = Math.max(0, s.cd - dt);
      if (w.single && wasCooling && s.cd === 0) g.audio.reload105();
      if (s.reloadT > 0) {
        s.reloadT -= dt;
        if (s.reloadT <= 0) {
          s.reloadT = 0;
          s.ammo = w.mag;
          g.audio.clank();
        }
      }
      if (w.heatPerShot) {
        s.idleT += dt;
        if (s.idleT > w.coolDelay) s.heat = Math.max(0, s.heat - w.coolRate * dt);
        if (s.overheated && s.heat <= w.overheatResume) s.overheated = false;
      }
    }
    if (trigger && this.switchT <= 0) this.tryFire();
  }

  tryFire() {
    const g = this.game;
    const i = this.cur;
    const w = WEAPONS[i];
    const s = this.state[i];
    if (s.cd > 0 || s.reloadT > 0 || s.overheated) return false;

    const cam = g.cam;
    _dir.copy(cam.aimDir);
    if (w.spread) {
      _dir.x += (Math.random() + Math.random() - 1) * w.spread;
      _dir.y += (Math.random() + Math.random() - 1) * w.spread;
      _dir.z += (Math.random() + Math.random() - 1) * w.spread;
      _dir.normalize();
    }
    if (!g.world.raycast(cam.pos, _dir, _hit)) {
      _hit.copy(cam.pos).addScaledVector(_dir, -cam.pos.y / _dir.y);
    }
    if (w.guided) {
      const b = g.shells.fireBomb(cam.gunPos, _hit);
      g.radio.say(b.target ? 'bombAway' : 'bombNoLock', {}, 3);
    } else {
      g.shells.fire(i, cam.gunPos, _hit);
    }

    s.cd = w.interval;
    if (w.mag) {
      s.ammo--;
      if (s.ammo <= 0) s.reloadT = w.reload;
    }
    if (w.heatPerShot) {
      s.heat = Math.min(1, s.heat + w.heatPerShot);
      s.idleT = 0;
      if (s.heat >= 1) {
        s.overheated = true;
        g.audio.overheat();
      }
    }
    cam.kick(w.recoil, (Math.random() - 0.5) * 0.4, 1);
    g.audio.fire(i);
    g.score.stats.shots[i]++;
    return true;
  }
}

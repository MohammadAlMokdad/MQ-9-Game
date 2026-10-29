// Compound integrity: takes damage from enemy fire (and your own danger-close rounds), burns as it weakens.
import { BASE } from '../config.js';
import { DIR_NAMES } from '../world/roads.js';

export class Base {
  constructor(game) {
    this.game = game;
    this.fires = [];
    this.sectorHit = new Float32Array(8);
    this.reset();
  }

  reset() {
    this.hp = BASE.maxHp;
    this.damageThisWave = 0;
    this.sectorHit.fill(0);
    for (const id of this.fires) this.game.fx.removeEmitter(id);
    this.fires.length = 0;
    this.warned = { 50: false, 25: false };
  }

  get frac() {
    return this.hp / BASE.maxHp;
  }

  damage(amount, sector = -1) {
    const g = this.game;
    if (g.debug.god || (g.state !== 'playing' && g.state !== 'intermission')) return;
    this.hp = Math.max(0, this.hp - amount);
    this.damageThisWave += amount;
    if (sector >= 0) {
      this.sectorHit[sector] = 1;
      g.radio.say('baseHit', { dir: DIR_NAMES[sector] }, 1);
    } else {
      g.radio.say('dangerClose', {}, 3);
    }
    const pct = this.frac * 100;
    for (const t of [50, 25]) {
      if (pct <= t && !this.warned[t]) {
        this.warned[t] = true;
        g.radio.say('baseLow', { pct: t }, 4);
      }
    }
    if (this.hp <= 0) g.onBaseDestroyed();
  }

  repair(amount) {
    this.hp = Math.min(BASE.maxHp, this.hp + amount);
    const pct = this.frac * 100;
    for (const t of [50, 25]) if (pct > t) this.warned[t] = false;
  }

  update(dt) {
    for (let i = 0; i < 8; i++) this.sectorHit[i] = Math.max(0, this.sectorHit[i] - dt * 1.5);
    // One burning building per threshold crossed.
    const want = BASE.fireThresholds.filter((t) => this.frac < t).length;
    const spots = this.game.world.compound.fireSpots;
    while (this.fires.length < want) {
      const s = spots[this.fires.length % spots.length];
      this.fires.push(this.game.fx.addEmitter(s.x, s.y, s.z, { interval: 0.18, fire: true, size: 1.4 }));
    }
    while (this.fires.length > want) this.game.fx.removeEmitter(this.fires.pop());
  }
}

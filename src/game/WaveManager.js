// Runs a wave's spawn plan over time and decides when the wave is clear.
import { composeWave } from './waveComposer.js';
import { WAVES } from '../config.js';
import { DIR_NAMES } from '../world/roads.js';
import { mulberry32 } from '../core/rng.js';

export function dirList(dirs) {
  const names = [...new Set(dirs.map((d) => DIR_NAMES[d]))];
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export class WaveManager {
  constructor(game) {
    this.game = game;
    this.rng = mulberry32((Date.now() & 0xffffff) ^ 0x5bd1e995);
    this.reset();
  }

  reset() {
    this.plan = null;
    this.prepared = null;
    this.active = false;
    this.t = 0;
    this.gi = 0;
    this.queued = 0;
    this.sinceKill = 0;
    this.stragglersOn = false;
  }

  prepare(n) {
    this.prepared = composeWave(n, this.rng);
    return this.prepared;
  }

  start(n) {
    const plan = this.prepared && this.prepared.n === n ? this.prepared : composeWave(n, this.rng);
    this.prepared = null;
    this.plan = plan;
    this.active = true;
    this.t = 0;
    this.gi = 0;
    this.queued = plan.total;
    this.sinceKill = 0;
    this.stragglersOn = false;
    this.game.base.damageThisWave = 0;
  }

  get hostiles() {
    const u = this.game.units;
    return this.queued + u.enemyAlive + u.enemyPassengers;
  }

  onKill() {
    this.sinceKill = 0;
  }

  // Debug: drop everything still queued.
  skipQueue() {
    if (!this.plan) return;
    this.gi = this.plan.groups.length;
    this.queued = 0;
  }

  spawnGroup(group) {
    const g = this.game;
    const route = g.world.routes[group.routeId];
    group.units.forEach((type, i) => {
      const u = g.units.spawnEnemy(type, group.routeId, i, this.plan);
      this.queued -= 1 + u.passengers;
      if (type === 'technical') g.radio.say('vehicles', { dir: route.dirName }, 2);
      if (type === 'apc' || type === 'tank') g.radio.say('armor', { dir: route.dirName }, 3);
    });
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    this.sinceKill += dt;
    const groups = this.plan.groups;
    while (this.gi < groups.length && groups[this.gi].t <= this.t && g.units.enemyAlive < WAVES.aliveCap) {
      this.spawnGroup(groups[this.gi]);
      this.gi++;
    }
    const done = this.gi >= groups.length;
    const alive = g.units.enemyAlive + g.units.enemyPassengers;

    // A few hostiles hiding at the edge? Send them at the wall and mark them.
    if (done && !this.stragglersOn && alive > 0 && alive <= WAVES.stragglerCount && this.sinceKill > WAVES.stragglerTime) {
      this.stragglersOn = true;
      for (const u of g.units.all) {
        if (u.alive && u.team === 'enemy') {
          u.straggler = true;
          if (u.state !== 'charge') u.state = 'charge';
        }
      }
      g.radio.say('stragglers', {}, 3);
    }

    if (done && alive === 0) {
      this.active = false;
      g.onWaveCleared(this.plan);
    }
  }
}

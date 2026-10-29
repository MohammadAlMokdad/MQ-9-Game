// Developer keys (dev server or ?debug): stats overlay, wave skipping, spawning, god mode.
import { ENEMY_ORDER } from '../config.js';

const NO_SCORE = { byPlayer: false, weapon: -1, shellId: 0 };

export class Debug {
  constructor(game) {
    this.game = game;
    this.enabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
    this.el = document.getElementById('debug');
    this.show = false;
    this.god = false;
    this.showSplash = false;
    this.acc = 0;
    this.frames = 0;
    this.fps = 0;
  }

  update(dt) {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.show) this.render();
    }
    if (!this.enabled) return;
    const g = this.game;
    const inp = g.input;
    if (inp.pressed.has('F1') || inp.pressed.has('Backquote')) {
      this.show = !this.show;
      this.el.classList.toggle('hidden', !this.show);
    }
    if (g.state !== 'playing' && g.state !== 'intermission') return;

    if (inp.shift()) {
      for (let i = 0; i < ENEMY_ORDER.length; i++) if (inp.pressed.has(`Digit${i + 1}`)) this.spawnAtAim(ENEMY_ORDER[i]);
      return;
    }
    if (inp.pressed.has('KeyK')) g.units.killAllEnemies(NO_SCORE);
    if (inp.pressed.has('KeyN')) {
      g.waves.skipQueue();
      g.units.killAllEnemies(NO_SCORE);
      if (g.state === 'intermission') g.interT = Math.min(g.interT, 0.1);
    }
    if (inp.pressed.has('KeyJ')) g.jumpWaves(5);
    if (inp.pressed.has('KeyG')) this.god = !this.god;
    if (inp.pressed.has('KeyB')) this.stress(150);
    if (inp.pressed.has('KeyV')) this.showSplash = !this.showSplash;
    if (inp.pressed.has('KeyT')) g.renderer.u.uBypass.value = g.renderer.u.uBypass.value ? 0 : 1;
  }

  currentPlan() {
    const g = this.game;
    return g.waves.plan || g.waves.prepared || g.waves.prepare(Math.max(1, g.wave + 1));
  }

  // Spawns a unit at the crosshair, attached to the nearest route so it keeps walking in.
  spawnAtAim(type) {
    const g = this.game;
    const a = g.cam.aim;
    let best = null;
    let bestD = Infinity;
    for (const r of g.world.routes) {
      r.waypoints.forEach((p, i) => {
        const d = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { route: r.id, wp: i };
        }
      });
    }
    return g.units.spawnEnemy(type, best.route, 0, this.currentPlan(), { x: a.x, z: a.z, wp: best.wp + 1 });
  }

  stress(n) {
    const g = this.game;
    const plan = this.currentPlan();
    for (let i = 0; i < n; i++) g.units.spawnEnemy('infantry', i % 8, Math.floor(i / 8), plan);
  }

  render() {
    const g = this.game;
    const info = g.renderer.renderer.info.render;
    let corpses = 0;
    for (const u of g.units.all) if (!u.alive) corpses++;
    this.el.textContent = [
      `FPS ${this.fps.toFixed(0)}   draw calls ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k`,
      `state ${g.state}   wave ${g.wave}   enemies ${g.units.enemyAlive} (+${g.units.enemyPassengers} mounted)   friendlies ${g.units.friendlyAlive}   corpses ${corpses}`,
      `particles hot ${g.fx.hot.n} smoke ${g.fx.smoke.n}   tracers ${g.fx.tracers.list.length}   shells ${g.shells.list.length}/${g.shells.enemy.length}`,
      `god ${this.god ? 'ON' : 'off'}   [K] kill all  [N] next wave  [J] +5 waves  [G] god  [B] stress  [V] splash  [T] raw heat  [Shift+1..6] spawn`,
    ].join('\n');
  }
}

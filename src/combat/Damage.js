// Player shell detonation: splash falloff x armor, kill attribution, suppression, danger close.
import { WEAPONS, ARMOR, BASE } from '../config.js';
import { isInsideCompound } from '../world/compound.js';

export class Damage {
  constructor(game) {
    this.game = game;
    this.tmp = [];
  }

  detonate(s) {
    const g = this.game;
    const w = WEAPONS[s.wi];
    const armor = ARMOR[w.id];
    const { x, y, z } = s;

    g.fx.impact(s.wi, x, y, z);
    const onScreen = g.hud.isOnScreen(x, y, z);
    // The 105 and the bomb are big enough to swamp the sensor (w.dip). Every impact jolts the
    // view, harder the bigger the round; the 105 and the bomb shake it even when out of view.
    if (onScreen) {
      if (w.flash) g.renderer.addFlash(w.flash);
      if (w.dip) g.renderer.dipGain(w.dip);
      g.cam.kick(w.kick);
      g.cam.addTrauma(w.rumble);
    } else if (w.dip) {
      g.renderer.addFlash(0.25);
      g.cam.kick(w.kick * 0.5);
      g.cam.addTrauma(w.rumble * 0.5);
    }
    g.audio.impact(s.wi, x, y, z);

    // Blast data lets kills throw bodies away from the impact.
    const cause = { byPlayer: true, weapon: s.wi, shellId: s.id, blast: { x, z, power: w.push, reach: w.outer } };
    const near = g.units.hash.query(x, z, w.outer, this.tmp);
    let kills = 0;
    let hit = false;
    for (const u of near) {
      if (!u.alive) continue;
      const dx = u.x - x;
      const dz = u.z - z;
      const dy = u.y + 1 - y;
      const dist = Math.max(0, Math.sqrt(dx * dx + dz * dz + dy * dy * 0.3) - u.radius);
      if (dist >= w.outer) continue;
      const f = dist <= w.inner ? 1 : 1 - (dist - w.inner) / (w.outer - w.inner);
      const dmg = w.damage * f * (u.team === 'friendly' ? 1 : armor[u.armor]);
      if (dmg <= 0) continue;
      if (u.team === 'enemy') hit = true;
      kills += g.units.damage(u, dmg, cause);
    }

    // Everything bigger than the 25mm pins down infantry around the impact.
    if (w.id !== '25') {
      g.units.hash.query(x, z, w.outer * 3, this.tmp);
      for (const u of this.tmp) if (u.alive && u.team === 'enemy' && u.armor === 'soft') u.suppressT = 2;
    }

    g.world.destruction.damage(g, s.wi, x, y, z);
    if (isInsideCompound(x, z, 0)) g.base.damage(w.damage * BASE.dangerClose, -1);
    if (hit) g.score.stats.hits[s.wi]++;
    if (kills >= 2) g.score.multiKill(kills, x, y, z);
    g.events.emit('detonate', { wi: s.wi, kills, x, y, z });
  }
}

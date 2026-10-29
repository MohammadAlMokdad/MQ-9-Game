// Friendly soldiers: hold posts on the towers and gates or walk a patrol loop, fire back at the
// nearest hostile, and wear IR strobes so the gunship can tell them apart.
import { FRIENDLY } from '../config.js';

const FRIENDLY_CAUSE = { byPlayer: false, weapon: -1, shellId: 0 };
const rs = (s) => (Math.random() - 0.5) * s;

// Double-blink every 1.2 s, phase-shifted per soldier.
export function strobeOn(time, id) {
  const t = (time + id * 0.37) % 1.2;
  return t < 0.08 || (t > 0.2 && t < 0.28) ? 1 : 0;
}

export function updateFriendly(u, dt, g) {
  u.moving = false;
  if (u.state === 'patrol') {
    const p = u.loop[u.wp];
    const dx = p.x - u.x;
    const dz = p.z - u.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      u.wp = (u.wp + 1) % u.loop.length;
    } else {
      const s = Math.min(d, u.speed * dt);
      u.x += (dx / d) * s;
      u.z += (dz / d) * s;
      u.yaw = Math.atan2(dx, dz);
      u.phase += s * 2.2;
      u.moving = true;
    }
  }

  u.fireCd -= dt;
  if (u.fireCd > 0) return;
  u.fireCd = FRIENDLY.fireMin + Math.random() * (FRIENDLY.fireMax - FRIENDLY.fireMin);
  const t = g.units.nearestEnemy(u.x, u.z, FRIENDLY.range);
  if (!t) return;
  const sy = u.y + 2.0;
  const miss = Math.random() >= FRIENDLY.hitChance;
  const ox = miss ? rs(6) : 0;
  const oz = miss ? rs(6) : 0;
  g.fx.tracer(u.x, sy, u.z, t.x + ox, t.y + 1.2, t.z + oz, 380, 9, 1.1, 1.5);
  g.fx.muzzle(u.x, sy, u.z, 1.1);
  u.flashT = 0.08;
  if (u.state === 'post') u.yaw = Math.atan2(t.x - u.x, t.z - u.z);
  if (!miss && t.armor === 'soft') g.units.damage(t, FRIENDLY.damage, FRIENDLY_CAUSE);
}

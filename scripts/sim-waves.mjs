// Prints the wave composition for waves 1..40 so the difficulty curve can be checked without a browser.
import { composeWave } from '../src/game/waveComposer.js';
import { mulberry32 } from '../src/core/rng.js';

const rows = [];
for (let n = 1; n <= 40; n++) {
  const p = composeWave(n, mulberry32(n * 7919));
  const last = p.groups.length ? p.groups[p.groups.length - 1].t : 0;
  rows.push({
    wave: n,
    boss: p.boss ? 'BOSS' : '',
    budget: p.budget,
    inf: p.counts.infantry,
    rpg: p.counts.rpg,
    sap: p.counts.sapper,
    tech: p.counts.technical,
    apc: p.counts.apc,
    tank: p.counts.tank,
    total: p.total,
    dirs: p.dirs.length,
    groups: p.groups.length,
    spawnSecs: Math.round(last),
    hp: p.hpMul.toFixed(2),
    speed: p.speedMul.toFixed(2),
    dmg: p.dmgMul.toFixed(2),
  });
}
console.table(rows);

// Points, kill chain multiplier, multi-kills, wave bonuses, run stats and the local high-score table.
import { SCORE, ENEMY_ORDER, WEAPONS } from '../config.js';

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export class Score {
  constructor(game) {
    this.game = game;
    this.high = loadJSON(SCORE.storageKey, []);
    if (!Array.isArray(this.high)) this.high = [];
    game.events.on('kill', (e) => this.onKill(e));
    game.events.on('friendlyKilled', (e) => this.onFriendlyKilled(e));
    this.reset();
  }

  reset() {
    this.score = 0;
    this.chain = 0;
    this.chainT = 0;
    this.mult = 1;
    this.ffThisWave = false;
    const kills = {};
    for (const t of ENEMY_ORDER) kills[t] = 0;
    this.stats = { kills, shots: WEAPONS.map(() => 0), hits: WEAPONS.map(() => 0), bestMulti: 0, bestMult: 1, friendliesLost: 0, teamKills: 0, waves: 0, time: 0 };
  }

  get best() {
    return Math.max(this.high.length ? this.high[0].score : 0, this.score);
  }

  get totalKills() {
    return Object.values(this.stats.kills).reduce((a, b) => a + b, 0);
  }

  onKill(e) {
    const u = e.unit;
    if (u.team !== 'enemy' || !e.cause.byPlayer) return;
    this.stats.kills[u.type]++;
    this.chain++;
    this.chainT = SCORE.chainWindow;
    this.mult = Math.min(SCORE.multMax, 1 + SCORE.multStep * Math.floor(this.chain / SCORE.chainStep));
    this.stats.bestMult = Math.max(this.stats.bestMult, this.mult);
    const pts = Math.round(u.def.score * this.mult);
    this.score += pts;
    this.game.hud.popup(u.x, u.y + 4, u.z, `+${pts}`);
    this.game.waves.onKill();
    if (u.vehicle) this.game.radio.say('vehicleKill', {}, 2);
    else this.game.radio.say('kill', {}, 0);
  }

  multiKill(k, x, y, z) {
    const bonus = Math.round(SCORE.multiKillBase * ((k * (k - 1)) / 2) * this.mult);
    const label = k >= 8 ? 'CARNAGE' : k >= 4 ? 'MULTI KILL' : k === 3 ? 'TRIPLE KILL' : 'DOUBLE KILL';
    this.score += bonus;
    this.stats.bestMulti = Math.max(this.stats.bestMulti, k);
    this.game.hud.bigText(`${label}  x${k}`, `+${bonus}`);
    this.game.hud.popup(x, y + 10, z, `+${bonus}`);
    if (k >= 4) this.game.radio.say('multikill', {}, 3);
  }

  onFriendlyKilled(e) {
    this.stats.friendliesLost++;
    if (!e.cause.byPlayer) {
      this.game.radio.say('manDown', {}, 1);
      return;
    }
    this.score = Math.max(0, this.score - SCORE.ffPenalty);
    this.chain = 0;
    this.chainT = 0;
    this.mult = 1;
    this.stats.teamKills++;
    this.ffThisWave = true;
    this.game.hud.bigText('FRIENDLY FIRE', `-${SCORE.ffPenalty}`);
    this.game.radio.say('ff', {}, 5);
  }

  update(dt) {
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) {
        this.chain = 0;
        this.mult = 1;
      }
    }
  }

  waveClear(n, boss, friendliesAlive, baseDamage) {
    const parts = {
      wave: SCORE.waveBase * n,
      friendlies: SCORE.perFriendly * friendliesAlive,
      noDamage: baseDamage <= 0 ? SCORE.noDamageBonus : 0,
      noFF: this.ffThisWave ? 0 : SCORE.noFFBonus,
    };
    let total = parts.wave + parts.friendlies + parts.noDamage + parts.noFF;
    if (boss) total *= SCORE.bossMult;
    this.score += total;
    this.ffThisWave = false;
    this.stats.waves = n;
    return { total, ...parts, boss };
  }

  // Records the run. Returns the 1-based rank in the table, or 0 if it didn't place.
  finalize(wave, time) {
    this.stats.time = time;
    const entry = { score: this.score, wave, kills: this.totalKills, date: new Date().toISOString().slice(0, 10) };
    this.high.push(entry);
    this.high.sort((a, b) => b.score - a.score);
    this.high = this.high.slice(0, 10);
    saveJSON(SCORE.storageKey, this.high);
    return this.high.indexOf(entry) + 1;
  }
}

export function loadSettings() {
  return loadJSON(SCORE.settingsKey, { sens: 1, mode: 'TV', muted: false, boxes: true });
}

export function saveSettings(s) {
  saveJSON(SCORE.settingsKey, s);
}

// Gunship sensor HUD, laid out like the reference: callsign and nav block top-left, sensor mode
// box top-right, range scale on the right, nav status bottom-left, weapon/ammo box bottom-right,
// status and radio subtitles bottom-centre, and a thin reticle ringed by rotating N/E/S/W.
// DOM panels hold the text (updated only when it changes); an overlay canvas draws the rest.
import * as THREE from 'three';
import { WEAPONS, CAMERA, GBU } from '../config.js';
import { sectorOf } from '../world/roads.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const M_TO_FT = 3.28084;
const SHORT_DIR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const FONT = '"Barlow SC", "Arial Narrow", "Segoe UI", sans-serif';
const SPEAKER = { OUTPOST: 'Outpost', FCO: 'Warhammer FCO' };
const BOX_TAG = { rpg: 'RPG', sapper: 'BOMB', technical: 'TECH', apc: 'TRUCK', tank: 'TANK' };
// Side-view renders of each munition (nose right), shown in the weapon box.
const ICONS = WEAPONS.map((w) => `${import.meta.env.BASE_URL}assets/ui/${w.icon}.png`);

const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
const pad = (n, w) => String(n).padStart(w, '0');

// Degrees to D° M' S.SSS".
function dms(deg, w) {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60;
  return `${pad(d, w)}° ${pad(m, 2)}' ${s.toFixed(3).padStart(6, '0')}"`;
}

export class Hud {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.root = $('hud');
    this.el = {
      nav: $('hud-nav'),
      sensor: $('hud-sensor'),
      sensor2: $('hud-sensor2'),
      game: $('hud-game'),
      weapons: $('hud-weapons'),
      status: $('hud-status'),
      radio: $('hud-radio'),
    };
    this.cache = {};
    this.popups = [];
    this.big = null;
    this.w = 1;
    this.h = 1;
    this.visible = false;
    this.sCount = new Int32Array(8);
    this.sX = new Float32Array(8);
    this.sZ = new Float32Array(8);
    this.p = { x: 0, y: 0, behind: false };
    this.enemies = [];
    this.rects = [];
  }

  reset() {
    this.popups.length = 0;
    this.big = null;
    this.cache = {};
  }

  show(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  resize(w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  set(key, el, value, html = false) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  project(x, y, z) {
    _v.set(x, y, z).project(this.game.cam.camera);
    this.p.behind = _v.z > 1;
    this.p.x = ((_v.x + 1) / 2) * this.w;
    this.p.y = ((1 - _v.y) / 2) * this.h;
    return this.p;
  }

  isOnScreen(x, y, z) {
    _v.set(x, y, z).project(this.game.cam.camera);
    return _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
  }

  popup(x, y, z, text) {
    this.popups.push({ x, y, z, text, t: 0 });
    if (this.popups.length > 40) this.popups.shift();
  }

  bigText(title, sub) {
    this.big = { title, sub, t: 0 };
  }

  update(dt) {
    const g = this.game;
    for (const p of this.popups) p.t += dt;
    while (this.popups.length && this.popups[0].t > 1.2) this.popups.shift();
    if (this.big) {
      this.big.t += dt;
      if (this.big.t > 2.2) this.big = null;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible) return;
    this.updatePanels();
    this.drawOverlay(ctx);
    if (g.debug.showSplash) this.drawSplashRadius(ctx);
  }

  updatePanels() {
    const g = this.game;
    const el = this.el;
    const wpn = g.weapons;
    const cam = g.cam;

    // Nav block: target coordinates, aircraft speed/heading/altitude.
    const t = cam.target;
    const lat = 26.8112 - t.z / 111320;
    const lon = -(99.2873 + t.x / (111320 * Math.cos((lat * Math.PI) / 180)));
    let hdg = (Math.atan2(-Math.sin(cam.theta), -Math.cos(cam.theta)) * 180) / Math.PI;
    if (hdg < 0) hdg += 360;
    const spd = 236 + Math.round(Math.sin(g.time * 0.21) * 3);
    this.set(
      'nav',
      el.nav,
      `${dms(lat, 3)} N\n${dms(lon, 3)} W\nSPD ${spd} KTS. HDG ${pad(Math.round(hdg) % 360, 3)} T\nALT. ${fmtNum(CAMERA.altitude * M_TO_FT).replace(',', '')} FT.`,
    );

    const mode = g.renderer.mode;
    this.set('sensor', el.sensor, mode === 'TV' ? 'DAYLIGHT' : 'THERMAL');
    this.set('sensor2', el.sensor2, `${mode === 'TV' ? 'NORM' : mode === 'BHOT' ? 'BLK' : 'RAINBOW'}  ${cam.zoom}X`);

    // Game state: wave, hostiles, score, compound integrity.
    const sc = g.score;
    const frac = g.base.frac;
    const fTotal = g.world.compound.posts.length + g.world.compound.patrols.length;
    let top = `WAVE ${Math.max(1, g.state === 'intermission' ? g.wave + 1 : g.wave)}&nbsp;&nbsp;&nbsp;HOSTILES ${g.waves.active ? g.waves.hostiles : 0}&nbsp;&nbsp;&nbsp;SCORE ${fmtNum(sc.score)}`;
    if (sc.mult > 1) top += ` x${sc.mult.toFixed(1)}`;
    top += `&nbsp;&nbsp;&nbsp;HI ${fmtNum(sc.best)}`;
    top += `<br>COMPOUND<span class="bar${frac < 0.3 ? ' low' : ''}"><i style="width:${(frac * 100).toFixed(1)}%"></i></span>${Math.ceil(frac * 100)}%&nbsp;&nbsp;&nbsp;FRIENDLIES ${g.units.friendlyAlive}/${fTotal}`;
    if (g.state === 'intermission') top += `<br>NEXT WAVE IN ${Math.max(0, Math.ceil(g.interT))}&nbsp;&nbsp;&nbsp;[ENTER] SKIP`;
    this.set('game', el.game, top, true);

    // Weapon box: ammo count and name per gun; the selected one is framed, red while reloading.
    const rows = WEAPONS.map((w, i) => {
      const s = wpn.state[i];
      let ammo;
      let busy = false;
      if (w.single) {
        ammo = s.cd > 0 ? 0 : 1;
        busy = s.cd > 0;
      } else if (w.mag) {
        ammo = s.reloadT > 0 ? 0 : s.ammo;
        busy = s.reloadT > 0;
      } else {
        ammo = s.overheated ? 0 : Math.round((1 - s.heat) / w.heatPerShot);
        busy = s.overheated;
      }
      return `<div class="row${i === wpn.cur ? ' on' : ''}"><span class="ammo">${ammo}</span><img class="ico" src="${ICONS[i]}" alt=""><span class="${busy ? 'red' : ''}">${w.name}</span></div>`;
    });
    this.set('weapons', el.weapons, rows.join(''), true);

    const w = wpn.weapon;
    const s = wpn.state[wpn.cur];
    let status = '';
    if (wpn.switchT > 0) status = `${w.name} <span class="red">SWITCHING</span>`;
    else if (s.overheated) status = `${w.name} <span class="red">OVERHEAT</span>`;
    else if (s.reloadT > 0 && w.guided) status = `${w.name} <span class="red">REARMING ${Math.ceil(s.reloadT)}</span>`;
    else if (s.reloadT > 0 || (w.single && s.cd > 0)) status = `${w.name} <span class="red">RELOADING</span>`;
    this.set('status', el.status, status, true);

    this.set(
      'radio',
      el.radio,
      g.radio.log.map((l) => `<div class="line${l.t > 6 ? ' fade' : ''}"><span class="who">${SPEAKER[l.who] || l.who}:</span> ${l.text}</div>`).join('<br>'),
      true,
    );
  }

  font(size, weight = 500) {
    this.ctx.font = `${weight} ${size}px ${FONT}`;
  }

  stroke(ctx, draw, width = 1.4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = width + 1.6;
    ctx.beginPath();
    draw(ctx);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = width;
    ctx.beginPath();
    draw(ctx);
    ctx.stroke();
  }

  text(ctx, str, x, y, size = 14, align = 'center', alpha = 1, color = '#fff', weight = 500) {
    this.font(size, weight);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  // Thin cross with a centre bracket and corner ticks; each weapon has its own size (w.reticle).
  drawReticle(ctx, cx, cy, w) {
    const [R, gap, cxk, cyk] = w.reticle;
    this.stroke(ctx, (c) => {
      c.moveTo(cx - R, cy);
      c.lineTo(cx - gap, cy);
      c.moveTo(cx + gap, cy);
      c.lineTo(cx + R, cy);
      c.moveTo(cx, cy - R * 0.8);
      c.lineTo(cx, cy - gap);
      c.moveTo(cx, cy + gap);
      c.lineTo(cx, cy + R * 0.8);
      // Centre bracket.
      const b = 6;
      const l = 3;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          c.moveTo(cx + sx * b, cy + sy * (b - l));
          c.lineTo(cx + sx * b, cy + sy * b);
          c.lineTo(cx + sx * (b - l), cy + sy * b);
          // Corner ticks.
          c.moveTo(cx + sx * cxk, cy + sy * (cyk - 9));
          c.lineTo(cx + sx * cxk, cy + sy * cyk);
          c.lineTo(cx + sx * (cxk - 9), cy + sy * cyk);
        }
      }
      // Range ticks along the horizontal arms.
      for (let k = gap + 18; k < R; k += 18) {
        c.moveTo(cx - k, cy - 3);
        c.lineTo(cx - k, cy + 3);
        c.moveTo(cx + k, cy - 3);
        c.lineTo(cx + k, cy + 3);
      }
    }, 1.3);
  }

  // N/E/S/W letters ringing the reticle, rotating with the view.
  drawCompass(ctx, cx, cy, w) {
    const t = this.game.cam.target;
    const r = w.compass;
    const dirs = [
      ['N', 0, -60],
      ['E', 60, 0],
      ['S', 0, 60],
      ['W', -60, 0],
    ];
    const c0 = this.project(t.x, t.y, t.z);
    const ox = c0.x;
    const oy = c0.y;
    for (const [label, dx, dz] of dirs) {
      const p = this.project(t.x + dx, t.y, t.z + dz);
      const a = Math.atan2(p.y - oy, p.x - ox);
      this.text(ctx, label, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 18, 'center', 1, '#fff', 600);
    }
  }

  // Vertical range scale (0-500 m) with a marker for the crosshair's distance from the compound.
  drawRangeScale(ctx) {
    const x = this.w * 0.865;
    const y0 = this.h * 0.3;
    const y1 = this.h * 0.66;
    const t = this.game.cam.target;
    const dist = Math.hypot(t.x, t.z);
    this.stroke(ctx, (c) => {
      c.moveTo(x, y0);
      c.lineTo(x, y1);
      for (let m = 0; m <= 500; m += 50) {
        const y = y0 + ((y1 - y0) * m) / 500;
        const len = m % 250 === 0 ? 12 : 6;
        c.moveTo(x, y);
        c.lineTo(x + len, y);
      }
    }, 1.1);
    for (const m of [0, 250, 500]) this.text(ctx, `${m}m`, x + 18, y0 + ((y1 - y0) * m) / 500, 13, 'left');
    const my = y0 + ((y1 - y0) * Math.min(500, dist)) / 500;
    this.stroke(ctx, (c) => {
      c.moveTo(x - 4, my);
      c.lineTo(x - 11, my - 5);
      c.lineTo(x - 11, my + 5);
      c.closePath();
    }, 1.2);
    this.text(ctx, `${Math.round(dist)}m`, x - 16, my, 13, 'right');
  }

  // Off-screen marker clamped to the screen edge, pointing at (sx, sy).
  edgeMarker(ctx, sx, sy, behind, label, blink) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    let dx = sx - cx;
    let dy = sy - cy;
    if (behind) {
      dx = -dx;
      dy = -dy;
    }
    const mx = 90;
    const top = 120;
    const bottom = 230;
    const tx = (this.w / 2 - mx) / (Math.abs(dx) || 1e-6);
    const ty = (dy < 0 ? this.h / 2 - top : this.h / 2 - bottom) / (Math.abs(dy) || 1e-6);
    const t = Math.min(tx, ty);
    const x = cx + dx * t;
    const y = cy + dy * t;
    const a = Math.atan2(dy, dx);
    if (blink && Math.floor(this.game.time * 6) % 2 === 0) return;
    this.stroke(ctx, (c) => {
      c.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
      c.lineTo(x + Math.cos(a + 2.4) * 9, y + Math.sin(a + 2.4) * 9);
      c.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
      c.lineTo(x + Math.cos(a - 2.4) * 9, y + Math.sin(a - 2.4) * 9);
    }, 1.6);
    this.text(ctx, label, x - Math.cos(a) * 20, y - Math.sin(a) * 20, 13);
  }

  drawOverlay(ctx) {
    const g = this.game;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const w = g.weapons.weapon;
    if (g.weapons.switchT <= 0) this.drawReticle(ctx, cx, cy, w);
    this.drawCompass(ctx, cx, cy, w);
    this.drawRangeScale(ctx);

    this.drawGuidance(ctx, cx, cy);
    const splash = g.shells.splashIn();
    if (splash >= 0) this.text(ctx, `SPLASH ${splash.toFixed(1)}`, cx + 60, cy + 100, 14, 'left');

    // Threat sectors: count live enemies per compass sector, mark those off-screen.
    this.sCount.fill(0);
    this.sX.fill(0);
    this.sZ.fill(0);
    const marked = [];
    const enemies = this.enemies;
    enemies.length = 0;
    for (const u of g.units.all) {
      if (!u.alive || u.team !== 'enemy') continue;
      enemies.push(u);
      const s = sectorOf(u.x, u.z);
      this.sCount[s]++;
      this.sX[s] += u.x;
      this.sZ[s] += u.z;
      if (u.straggler) marked.push(u);
    }
    if (g.settings.boxes !== false) this.drawTargetBoxes(ctx, enemies);
    for (let s = 0; s < 8; s++) {
      const n = this.sCount[s];
      if (!n) continue;
      const p = this.project(this.sX[s] / n, 2, this.sZ[s] / n);
      const off = p.behind || p.x < 0 || p.x > this.w || p.y < 0 || p.y > this.h;
      if (off) this.edgeMarker(ctx, p.x, p.y, p.behind, `${SHORT_DIR[s]} ${n}`, g.base.sectorHit[s] > 0.4);
    }
    const fp = this.project(0, 5, 0);
    if (fp.behind || fp.x < 0 || fp.x > this.w || fp.y < 0 || fp.y > this.h) this.edgeMarker(ctx, fp.x, fp.y, fp.behind, 'HACIENDA', false);

    for (const u of marked) {
      const p = this.project(u.x, u.y + 2, u.z);
      if (p.behind) continue;
      this.stroke(ctx, (c) => {
        c.moveTo(p.x, p.y - 12);
        c.lineTo(p.x + 12, p.y);
        c.lineTo(p.x, p.y + 12);
        c.lineTo(p.x - 12, p.y);
        c.closePath();
      }, 1.4);
    }

    for (const p of this.popups) {
      const s = this.project(p.x, p.y, p.z);
      if (s.behind) continue;
      this.text(ctx, p.text, s.x, s.y - p.t * 40, 14, 'center', Math.min(1, 2 - p.t * 1.6), '#fff', 600);
    }

    if (this.big) {
      const k = this.big.t;
      const a = Math.min(1, 2.2 - k);
      const size = 28 + Math.max(0, 0.15 - k) * 60;
      this.text(ctx, this.big.title, cx, cy + 200, size, 'center', a, '#fff', 600);
      this.text(ctx, this.big.sub, cx, cy + 230, 17, 'center', a, '#fff', 600);
    }

    if (g.state === 'paused') return;
    if (g.base.frac < 0.25 && Math.floor(g.time * 2) % 2 === 0) this.text(ctx, 'COMPOUND CRITICAL', cx, this.h * 0.2, 20, 'center', 1, '#ff4b3e', 600);
  }

  // Red target box around every live hostile: the unit's 3D bounds (oriented by its heading)
  // projected to the screen, padded, with a minimum size so distant soldiers stay visible.
  // Screen rectangle around a unit's 3D bounds (oriented by its heading), or null if behind.
  unitRect(u, pad = 6) {
    const V = this.game.world.vehicles;
    let hx;
    let hz;
    let h;
    if (u.vehicle) {
      const s = V[u.def.mesh].userData.size;
      hx = (s.w / 2) * u.scale;
      hz = (s.l / 2) * u.scale;
      h = s.h * u.scale;
    } else {
      hx = hz = 0.45 * u.scale;
      h = 1.85 * u.scale;
    }
    const c = Math.cos(u.yaw);
    const sn = Math.sin(u.yaw);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const lx = k & 1 ? hx : -hx;
      const lz = k & 2 ? hz : -hz;
      const p = this.project(u.x + lx * c + lz * sn, u.y + (k & 4 ? h : 0), u.z - lx * sn + lz * c);
      if (p.behind) return null;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  // Corner brackets around a screen rectangle.
  brackets(ctx, r, len = 8) {
    this.stroke(ctx, (c) => {
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const x = r.x + sx * r.w;
        const y = r.y + sy * r.h;
        const dx = sx ? -1 : 1;
        const dy = sy ? -1 : 1;
        c.moveTo(x, y + dy * len);
        c.lineTo(x, y);
        c.lineTo(x + dx * len, y);
      }
    }, 1.5);
  }

  // Open corner ticks around a point, leaving the munition inside them visible.
  ticks(ctx, px, py, r) {
    const l = r * 0.45;
    this.stroke(ctx, (c) => {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        c.moveTo(px + sx * r, py + sy * (r - l));
        c.lineTo(px + sx * r, py + sy * r);
        c.lineTo(px + sx * (r - l), py + sy * r);
      }
    }, 1.2);
  }

  // Bomb symbology. GBU selected: brackets on the vehicle it would lock. In flight: corner ticks
  // on each bomb, and its target or impact point with the time to impact.
  drawGuidance(ctx, cx, cy) {
    const g = this.game;
    const bombs = g.shells.bombs;
    if (g.weapons.weapon.guided && g.state !== 'paused') {
      const t = g.cam.target;
      const lock = g.units.nearestVehicle(t.x, t.z, GBU.lockRange);
      const r = lock && this.unitRect(lock, 9);
      if (r) {
        this.brackets(ctx, r, 10);
        this.text(ctx, 'LOCK', r.x + r.w / 2, r.y - 10, 12, 'center', 1, '#fff', 600);
      } else {
        this.text(ctx, 'NO VEHICLE IN RANGE', cx, cy + 172, 13, 'center', 0.85);
      }
    }
    for (const b of bombs) {
      const p = this.project(b.x, b.y, b.z);
      // Until it falls into the picture, an arrow at the edge shows where it is.
      const inView = !p.behind && p.x > 0 && p.x < this.w && p.y > 0 && p.y < this.h;
      if (inView) this.ticks(ctx, p.x, p.y, 18);
      else this.edgeMarker(ctx, p.x, p.y, p.behind, 'GBU', false);
      const r = b.target && b.target.alive ? this.unitRect(b.target, 10) : null;
      if (r) {
        this.brackets(ctx, r, 12);
        this.text(ctx, `GBU  TTI ${b.tti.toFixed(1)}`, r.x + r.w / 2, r.y + r.h + 12, 13, 'center', 1, '#fff', 600);
      } else {
        const q = this.project(b.ax, b.ay, b.az);
        if (!q.behind) this.text(ctx, `GBU  TTI ${b.tti.toFixed(1)}`, q.x, q.y + 18, 13, 'center', 1, '#fff', 600);
      }
    }
  }

  drawTargetBoxes(ctx, enemies) {
    const V = this.game.world.vehicles;
    const R = this.rects;
    R.length = 0;
    for (const u of enemies) {
      let hx;
      let hz;
      let h;
      if (u.vehicle) {
        const s = V[u.def.mesh].userData.size;
        hx = (s.w / 2) * u.scale;
        hz = (s.l / 2) * u.scale;
        h = s.h * u.scale;
      } else {
        hx = hz = 0.45 * u.scale;
        h = 1.85 * u.scale;
      }
      const c = Math.cos(u.yaw);
      const sn = Math.sin(u.yaw);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let behind = false;
      for (let k = 0; k < 8; k++) {
        const lx = k & 1 ? hx : -hx;
        const lz = k & 2 ? hz : -hz;
        const p = this.project(u.x + lx * c + lz * sn, u.y + (k & 4 ? h : 0), u.z - lx * sn + lz * c);
        if (p.behind) {
          behind = true;
          break;
        }
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      if (behind) continue;
      const w = Math.max(12, x1 - x0 + 6);
      const hh = Math.max(16, y1 - y0 + 6);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      if (mx + w / 2 < 0 || mx - w / 2 > this.w || my + hh / 2 < 0 || my - hh / 2 > this.h) continue;
      R.push({ x: Math.round(mx - w / 2) + 0.5, y: Math.round(my - hh / 2) + 0.5, w: Math.round(w), h: Math.round(hh), u });
    }
    if (!R.length) return;
    const path = () => {
      ctx.beginPath();
      for (const r of R) ctx.rect(r.x, r.y, r.w, r.h);
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    path();
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#ff3b30';
    path();
    ctx.stroke();
    // Tags on the priority targets.
    for (const r of R) {
      const tag = BOX_TAG[r.u.type];
      if (tag) this.text(ctx, tag, r.x, r.y - 7, 11, 'left', 1, '#ff3b30', 600);
    }
  }

  drawSplashRadius(ctx) {
    const g = this.game;
    const w = WEAPONS[g.weapons.cur];
    for (const r of [w.inner, w.outer]) {
      this.stroke(ctx, (c) => {
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          const p = this.project(g.cam.target.x + Math.cos(a) * r, g.cam.target.y, g.cam.target.z + Math.sin(a) * r);
          if (i === 0) c.moveTo(p.x, p.y);
          else c.lineTo(p.x, p.y);
        }
      }, 1);
    }
  }
}

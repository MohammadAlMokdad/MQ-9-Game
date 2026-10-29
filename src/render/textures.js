// Procedurally generated textures: soil detail, smoke/fire sprite atlas, road surface, crater mask.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

export const DETAIL_MEAN = 0.86; // average of the detail texture; geometry heat is scaled to compensate

// Tileable value noise on a periodic lattice (period p cells across the texture).
function tileNoise(rng, p) {
  const grid = Float32Array.from({ length: p * p }, rng);
  return (u, v) => {
    const fx = u * p;
    const fy = v * p;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let tx = fx - ix;
    let ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y0 = (((iy % p) + p) % p) * p;
    const y1 = ((((iy + 1) % p) + p) % p) * p;
    const a = grid[y0 + x0];
    const b = grid[y0 + x1];
    const c = grid[y1 + x0];
    const d = grid[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// Fine-grain soil: grit, pebbles, tufts. Multiplies surface heat.
export function detailTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(4242);
  const oct = [8, 16, 32, 64].map((p) => tileNoise(rng, p));
  const amps = [0.4, 0.3, 0.2, 0.1];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += amps[k] * oct[k](x / size, y / size);
      let out = DETAIL_MEAN + (v - 0.5) * 0.38;
      const r = rng();
      if (r < 0.014) out -= 0.22 * rng();
      else if (r < 0.02) out += 0.12 * rng();
      const b = Math.max(0, Math.min(255, Math.round(out * 255)));
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// 4x4 sprite atlas. Frames 0-11: billowing smoke puffs, 12-14: ragged flame, 15: soft dot.
// A = density. R, G = the puff's surface normal (x, y in sprite space, from the density
// gradient) so smoke can be lit by the sun from any viewing angle; B = self-shadowing (dense
// cores are darker inside).
export const ATLAS_COLS = 4;
export function spriteAtlas() {
  const F = 128;
  const S = F * ATLAS_COLS;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rng = mulberry32(777);
  const dens = new Float32Array(F * F);
  const at = (xx, yy) => dens[Math.min(F - 1, Math.max(0, yy)) * F + Math.min(F - 1, Math.max(0, xx))];
  for (let f = 0; f < 16; f++) {
    const ox = (f % ATLAS_COLS) * F;
    const oy = Math.floor(f / ATLAS_COLS) * F;
    const n1 = tileNoise(rng, 4);
    const n2 = tileNoise(rng, 8);
    const n3 = tileNoise(rng, 16);
    const n4 = tileNoise(rng, 32);
    const flame = f >= 12 && f < 15;
    const dot = f === 15;
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const u = x / F;
        const v = y / F;
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        let a;
        if (dot) {
          a = Math.max(0, 1 - r) ** 2;
        } else {
          // Domain-warped fbm gives lumpy, cauliflower edges.
          const wx = n1(u, v) * 0.35;
          const wy = n1(v + 0.37, u + 0.11) * 0.35;
          const n = 0.5 * n2(u + wx, v + wy) + 0.3 * n3(u + wx, v + wy) + 0.2 * n4(u, v);
          const edge = flame ? 0.75 : 0.95;
          const fall = Math.max(0, 1 - r / edge);
          a = Math.max(0, Math.min(1, (n * 1.7 - 0.55 + fall * 0.9) * fall * 1.6));
          if (flame) a = Math.pow(a, 1.6) * 1.3;
        }
        dens[y * F + x] = Math.min(1, a);
      }
    }
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const a = at(x, y);
        // Height field = density; canvas y runs down, sprite y runs up.
        const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
        const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
        const k = dot ? 6 : 14;
        // Bulge: a puff is roughly a sphere, so its edges face outward.
        const nx = -gx * k + (x / F - 0.5) * 1.4;
        const ny = gy * k + (0.5 - y / F) * 1.4;
        const l = Math.hypot(nx, ny, 1);
        // Self-shadow: thick centres hide more light.
        let occl = 0;
        for (let s = 1; s <= 4; s++) occl += at(x + s * 2, y - s * 2);
        const shade = Math.max(0, Math.min(1, 1 - occl * 0.16 - a * 0.25));
        const o = ((oy + y) * S + ox + x) * 4;
        img.data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
        img.data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
        img.data[o + 2] = Math.round(shade * 255);
        img.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.premultiplyAlpha = false;
  return tex;
}

// Normal map (OpenGL convention) from a canvas's brightness, for procedural textures.
export function normalFromHeight(src, strength = 2) {
  const w = src.width;
  const h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => {
    const o = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (d[o] + d[o + 1] + d[o + 2]) / 765;
  };
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength;
      const ny = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 4;
      img.data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function canvasMean(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  return s / (d.length / 4);
}

function repeating(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.userData.mean = canvasMean(canvas);
  return tex;
}

// Draws a shape at (x, y) and at its wrapped copies so the texture tiles seamlessly.
function wrapped(size, x, y, pad, draw) {
  for (const ox of [0, -size, size]) {
    for (const oy of [0, -size, size]) {
      if (ox && (x + ox < -pad || x + ox > size + pad)) continue;
      if (oy && (y + oy < -pad || y + oy > size + pad)) continue;
      draw(x + ox, y + oy);
    }
  }
}

// Clipped hedge / dense shrub foliage: overlapping leaves in several greens with dark gaps.
// Returns { map, nor }.
export function foliageTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rng = mulberry32(2024);
  g.fillStyle = '#1b2615';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const l = 3 + rng() * 5;
    const t = rng();
    const rot = rng() * Math.PI;
    g.fillStyle = `rgb(${Math.round(44 + t * 52)},${Math.round(64 + t * 62)},${Math.round(30 + t * 26)})`;
    wrapped(size, x, y, 10, (px, py) => {
      g.beginPath();
      g.ellipse(px, py, l, l * 0.45, rot, 0, Math.PI * 2);
      g.fill();
    });
  }
  return { map: repeating(c), nor: normalFromHeight(c, 3) };
}

// Baled straw: fine strands, mostly aligned. Returns { map, nor }.
export function strawTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rng = mulberry32(99);
  g.fillStyle = '#a58d58';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 4200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 6 + rng() * 22;
    const ang = (rng() - 0.5) * 0.5;
    const t = rng();
    g.strokeStyle = `rgba(${Math.round(118 + t * 112)},${Math.round(96 + t * 94)},${Math.round(48 + t * 62)},0.8)`;
    g.lineWidth = 0.6 + rng() * 1.2;
    wrapped(size, x, y, 30, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      g.stroke();
    });
  }
  return { map: repeating(c), nor: normalFromHeight(c, 2) };
}

// Soft round falloff for contact shadows under vehicles and soldiers.
export function blobTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// Ejecta spray around a crater: dirt thrown out in rays and clods, densest near the rim.
// Alpha is coverage; red carries a little brightness variation for the clods.
export function ejectaTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(31337);
  const cx = S / 2;
  const blob = (x, y, r, a, shade = 255) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${shade},${shade},${shade},${a})`);
    gr.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // Soft blanket just outside the rim.
  const ring = g.createRadialGradient(cx, cx, S * 0.12, cx, cx, S * 0.34);
  ring.addColorStop(0, 'rgba(255,255,255,0.9)');
  ring.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = ring;
  g.fillRect(0, 0, S, S);
  // Rays of thrown dirt, broken into clods.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const len = S * (0.22 + rng() * 0.26);
    for (let k = 0; k < 14; k++) {
      const d = S * 0.13 + (k / 14) * len;
      const w = (1 - k / 14) * S * 0.035 + 1;
      const j = (rng() - 0.5) * 0.12;
      blob(cx + Math.cos(a + j) * d, cx + Math.sin(a + j) * d, w * (0.6 + rng()), 0.35 + rng() * 0.4, 150 + Math.floor(rng() * 105));
    }
  }
  // Scattered clods.
  for (let i = 0; i < 160; i++) {
    const a = rng() * Math.PI * 2;
    const d = S * (0.12 + Math.pow(rng(), 1.6) * 0.36);
    blob(cx + Math.cos(a) * d, cx + Math.sin(a) * d, 1 + rng() * 3.5, 0.5 + rng() * 0.5, 120 + Math.floor(rng() * 135));
  }
  // Clear the middle: that is where the hole itself is (crater opening = 0.38 of the spray radius).
  g.globalCompositeOperation = 'destination-out';
  const hole = g.createRadialGradient(cx, cx, S * 0.17, cx, cx, S * 0.24);
  hole.addColorStop(0, 'rgba(0,0,0,1)');
  hole.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hole;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';
  return new THREE.CanvasTexture(c);
}

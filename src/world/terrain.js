// Analytic terrain: flat ground around the compound, gentle rolling ranchland, hills ringing the map edge.
import * as THREE from 'three';
import { fbm2, valueNoise2 } from '../core/rng.js';
import { HEAT, COLOR } from '../config.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = smooth(105, 170, r) * (fbm2(x * 0.006 + 11.3, z * 0.006 - 4.7, 3, 1) - 0.5) * 6;
  if (r > 620) h += smooth(620, 950, r) * (30 + 50 * fbm2(x * 0.004, z * 0.004, 3, 2));
  return h;
}

// Height of every vertex above the ground (attribute aoH), for contact darkening and
// splash-back grime on walls. base: a fixed ground height instead of the terrain's.
export function addGroundHeight(geom, base = null) {
  const p = geom.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = p.getY(i) - (base ?? heightAt(p.getX(i), p.getZ(i)));
  geom.setAttribute('aoH', new THREE.BufferAttribute(a, 1));
  return geom;
}

export const TERRAIN_TOP = 110; // nothing in heightAt goes above this
const SIZE = 5200;
const SEG = 260;

// Height of the rendered terrain mesh (its triangles linearly interpolate heightAt between
// grid vertices, so it can differ from heightAt by a few tens of centimetres). Use this for
// anything that must sit exactly on the visible ground.
export function surfaceHeight(x, z) {
  const s = SIZE / SEG;
  const half = SIZE / 2;
  const fx = (x + half) / s;
  const fz = (z + half) / s;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const x0 = ix * s - half;
  const z0 = iz * s - half;
  const hb = heightAt(x0, z0 + s);
  const hd = heightAt(x0 + s, z0);
  // PlaneGeometry splits each cell into (a, b, d) and (b, c, d).
  if (u + v <= 1) {
    const ha = heightAt(x0, z0);
    return ha + (hd - ha) * u + (hb - ha) * v;
  }
  const hc = heightAt(x0 + s, z0 + s);
  return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}

export function buildTerrain() {
  const size = SIZE;
  const seg = SEG;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();

  const col = new Float32Array(pos.count * 3);
  const alb = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = fbm2(x * 0.004, z * 0.004, 4, 5) - 0.5;
    const h = HEAT.ground * (1 + 0.12 * n + 0.05 * (valueNoise2(x * 0.06, z * 0.06, 9) - 0.5));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = h;
    // Daylight: patches of greener and drier ground.
    const k = 0.92 + 0.18 * n;
    alb[i * 3] = COLOR.ground[0] * k * (1 + 0.06 * n);
    alb[i * 3 + 1] = COLOR.ground[1] * k;
    alb[i * 3 + 2] = COLOR.ground[2] * k * (1 - 0.08 * n);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
  return g;
}

// March a ray against the height field. Returns distance along the (unit) ray, or -1.
export function raycastTerrain(ox, oy, oz, dx, dy, dz, maxT = 8000) {
  if (dy >= -1e-4) return -1;
  let t = oy > TERRAIN_TOP ? (TERRAIN_TOP - oy) / dy : 0;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  let prevT = t;
  for (let i = 0; i < 400 && t < maxT; i++) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const gap = y - heightAt(x, z);
    if (gap < 0.05) {
      if (gap >= 0) return t;
      let a = prevT;
      let b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) * 0.5;
        if (oy + dy * m <= heightAt(ox + dx * m, oz + dz * m)) b = m;
        else a = m;
      }
      return b;
    }
    prevT = t;
    t += Math.max(0.4, gap / (-dy + 0.8 * horiz));
  }
  return -1;
}

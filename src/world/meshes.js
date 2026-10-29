// Procedural props for the ranch map, each painted with a daylight colour and a heat value.
// Builders return { bucket: geometry[] } maps so pieces land in the right textured material:
//   plaster, clay (walls) - tile, tin, tinred (roofs, uv-mapped) - wood - paver - lawn - hedge -
//   hay - rock - metal - window (glazing) - glass (greenhouses) - water - plain.
import * as THREE from 'three';
import { part, box, paint, merge } from '../render/heat.js';
import { HEAT, COLOR, WALL_PAINT } from '../config.js';
import { LIB, addProp } from './props.js';

// ---- helpers ----

export class Parts {
  constructor() {
    this.b = {};
  }

  // obj tags the geometry as (part of) a destructible object: { kind, collider? }.
  // Cloned geometries share userData with their template, so tags always get a fresh object.
  add(bucket, g, obj = null) {
    if (obj) g.userData = { ...g.userData, obj };
    (this.b[bucket] ||= []).push(g);
    return this;
  }

  addAll(other, obj = null) {
    for (const [k, list] of Object.entries(other.b)) for (const g of list) this.add(k, g, obj ?? g.userData.obj ?? null);
    return this;
  }

  // Applies a transform to everything (used to place a built prop in the world).
  transform(m) {
    for (const list of Object.values(this.b)) for (const g of list) g.applyMatrix4(m);
    return this;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function placeMatrix(x, y, z, ry = 0, s = 1) {
  return _m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), new THREE.Vector3(s, s, s)).clone();
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const shade = (c, k) => c.map((v) => Math.min(1, v * k));

// Builds a non-indexed triangle list with per-vertex uv, then paints it.
function triGeometry(tris, heat, color) {
  // tris: array of [x,y,z,u,v] * 3
  const pos = [];
  const uv = [];
  for (const t of tris) {
    for (const v of t) {
      pos.push(v[0], v[1], v[2]);
      uv.push(v[3], v[4]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return paint(g, heat, color);
}

// Hip roof over a w x d footprint (ridge along the longer side). uv in meters: u along the eaves,
// v up the slope. Pivot at the footprint centre, eaves at y = 0.
export function hipRoof(w, d, h, over, heat, color) {
  const swap = d > w;
  const W = (swap ? d : w) + over * 2;
  const D = (swap ? w : d) + over * 2;
  const r = Math.max(0, W / 2 - D / 2);
  const L = Math.hypot(D / 2, h);
  const vs = (dist) => (dist / (D / 2)) * L;
  const tris = [];
  const P = (x, y, z, u, v) => [x, y, z, u, v];
  // South & north trapezoids.
  const s1 = P(-W / 2, 0, D / 2, -W / 2, 0);
  const s2 = P(W / 2, 0, D / 2, W / 2, 0);
  const s3 = P(r, h, 0, r, vs(D / 2));
  const s4 = P(-r, h, 0, -r, vs(D / 2));
  tris.push([s1, s2, s3], [s1, s3, s4]);
  const n1 = P(W / 2, 0, -D / 2, -W / 2, 0);
  const n2 = P(-W / 2, 0, -D / 2, W / 2, 0);
  const n3 = P(-r, h, 0, r, vs(D / 2));
  const n4 = P(r, h, 0, -r, vs(D / 2));
  tris.push([n1, n2, n3], [n1, n3, n4]);
  // East & west triangles.
  tris.push([P(W / 2, 0, D / 2, -D / 2, 0), P(W / 2, 0, -D / 2, D / 2, 0), P(r, h, 0, 0, vs(D / 2))]);
  tris.push([P(-W / 2, 0, -D / 2, -D / 2, 0), P(-W / 2, 0, D / 2, D / 2, 0), P(-r, h, 0, 0, vs(D / 2))]);
  const g = triGeometry(tris, heat, color);
  if (swap) g.rotateY(Math.PI / 2);
  g.userData.ridge = r * 2;
  return g;
}

// Gable roof (ridge along x) with gable-end triangles returned separately (they belong to the walls).
export function gableRoof(w, d, h, over, heat, color) {
  const W = w + over * 2;
  const D = d + over * 2;
  const L = Math.hypot(D / 2, h);
  const P = (x, y, z, u, v) => [x, y, z, u, v];
  const tris = [
    [P(-W / 2, 0, D / 2, -W / 2, 0), P(W / 2, 0, D / 2, W / 2, 0), P(W / 2, h, 0, W / 2, L)],
    [P(-W / 2, 0, D / 2, -W / 2, 0), P(W / 2, h, 0, W / 2, L), P(-W / 2, h, 0, -W / 2, L)],
    [P(W / 2, 0, -D / 2, -W / 2, 0), P(-W / 2, 0, -D / 2, W / 2, 0), P(-W / 2, h, 0, W / 2, L)],
    [P(W / 2, 0, -D / 2, -W / 2, 0), P(-W / 2, h, 0, W / 2, L), P(W / 2, h, 0, -W / 2, L)],
  ];
  return triGeometry(tris, heat, color);
}

export function gableEnds(w, d, h, heat, color) {
  const P = (x, y, z) => [x, y, z, 0, 0];
  const g = triGeometry(
    [
      [P(w / 2, 0, d / 2), P(w / 2, 0, -d / 2), P(w / 2, h, 0)],
      [P(-w / 2, 0, -d / 2), P(-w / 2, 0, d / 2), P(-w / 2, h, 0)],
    ],
    heat,
    color,
  );
  g.deleteAttribute('uv');
  return g;
}

// ---- facade details ----

// A window in local space on a wall facing +Z (wall surface at z = 0): dark reflective glass with
// a mullion, a painted frame standing proud of the wall, and a sill.
function windowParts(w, h, wallBucket, wallColor, frameColor, rng) {
  const p = new Parts();
  const glassTint = shade(COLOR.window, 0.85 + rng() * 0.35);
  p.add('window', part(new THREE.PlaneGeometry(w, h), HEAT.glass, glassTint, 0, 0, 0.015));
  const t = 0.09;
  const dd = 0.12;
  p.add('plain', box(w + 2 * t, t, dd, HEAT.frame, frameColor, 0, h / 2 + t / 2, 0));
  p.add('plain', box(w + 2 * t, t, dd, HEAT.frame, frameColor, 0, -h / 2 - t / 2, 0));
  p.add('plain', box(t, h, dd, HEAT.frame, frameColor, -w / 2 - t / 2, 0, 0));
  p.add('plain', box(t, h, dd, HEAT.frame, frameColor, w / 2 + t / 2, 0, 0));
  p.add('plain', box(0.05, h, 0.05, HEAT.frame, frameColor, 0, 0, 0.03));
  p.add('plain', box(w, 0.05, 0.05, HEAT.frame, frameColor, 0, h * 0.18, 0.03));
  p.add(wallBucket, box(w + 0.34, 0.07, 0.24, HEAT.wall, shade(wallColor, 0.95), 0, -h / 2 - t - 0.035, 0.1));
  return p;
}

// A plank door with a frame, on a wall facing +Z, bottom at y = 0.
function doorParts(w, h, frameColor, rng) {
  const p = new Parts();
  const wood = shade(COLOR.doorWood, 0.8 + rng() * 0.5);
  p.add('wood', box(w, h, 0.07, HEAT.wood, wood, 0, h / 2, 0.035));
  const t = 0.1;
  p.add('plain', box(w + 2 * t, t, 0.13, HEAT.frame, frameColor, 0, h + t / 2, 0));
  p.add('plain', box(t, h, 0.13, HEAT.frame, frameColor, -w / 2 - t / 2, h / 2, 0));
  p.add('plain', box(t, h, 0.13, HEAT.frame, frameColor, w / 2 + t / 2, h / 2, 0));
  return p;
}

// Windows and doors on the four walls of a w x d block, `floors` storeys high.
function openings(p, w, d, h, floors, rng, wallBucket, wallColor) {
  const fh = h / floors;
  const frameColor = rng() < 0.6 ? COLOR.frame : shade(COLOR.doorWood, 1.1);
  for (let f = 0; f < floors; f++) {
    const y = f * fh + fh * 0.56;
    for (const [len, axis] of [[w, 'x'], [d, 'z']]) {
      const n = Math.max(1, Math.floor(len / 4));
      for (let i = 0; i < n; i++) {
        if (rng() < 0.12) continue;
        const t = -len / 2 + (len / n) * (i + 0.5);
        for (const s of [-1, 1]) {
          const isDoor = f === 0 && i === Math.floor(n / 2) && s === 1 && axis === 'x';
          let sub;
          let yy;
          if (isDoor) {
            sub = doorParts(1.3, Math.min(2.5, fh * 0.78), frameColor, rng);
            yy = 0;
          } else {
            const wh = Math.min(1.9, fh * 0.46);
            sub = windowParts(1.05, wh, wallBucket, wallColor, frameColor, rng);
            yy = y;
          }
          const ry = axis === 'x' ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
          const x = axis === 'x' ? t : s * (w / 2);
          const z = axis === 'x' ? s * (d / 2) : t;
          p.addAll(sub.transform(placeMatrix(x, yy, z, ry)));
        }
      }
    }
  }
}

// ---- rooftop clutter ----

// Black polyethylene water tank with a domed lid, as on nearly every Mexican roof.
function waterTank(p, x, y, z) {
  p.add('plain', part(new THREE.CylinderGeometry(0.62, 0.66, 1.2, 16), HEAT.tankBlack, COLOR.tankBlack, x, y + 0.6, z));
  const dome = new THREE.SphereGeometry(0.62, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.35, 1);
  p.add('plain', part(dome, HEAT.tankBlack, shade(COLOR.tankBlack, 1.15), x, y + 1.2, z));
}

// Split-system condenser: the photoscanned unit when available, else a pale box with a fan grille.
function acUnit(p, x, y, z, ry) {
  if (LIB.aircon) {
    addProp(p, 'aircon', x, y, z, ry, 1, null, HEAT.ac / 0.6);
    return;
  }
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  p.add('metal', box(0.9, 0.62, 0.34, HEAT.ac, [0.82, 0.82, 0.8], x, y + 0.31, z, ry));
  p.add('plain', part(new THREE.CircleGeometry(0.22, 12), HEAT.ac * 1.2, [0.15, 0.15, 0.15], x + s * 0.175 - c * 0.12, y + 0.33, z + c * 0.175 + s * 0.12, 0, ry, 0));
}

// Small satellite dish on a stub mast.
function satDish(p, x, y, z, ry) {
  p.add('metal', box(0.06, 0.7, 0.06, HEAT.metal, [0.5, 0.5, 0.5], x, y + 0.35, z));
  const dish = new THREE.SphereGeometry(0.42, 12, 4, 0, Math.PI * 2, 0, 0.6);
  dish.rotateX(-1.1);
  p.add('plain', part(dish, HEAT.metal, [0.86, 0.86, 0.84], x, y + 0.75, z, 0, ry, 0));
}

// Solar water heater: a tilted dark collector and its tank.
function solarHeater(p, x, y, z, ry) {
  const panel = new THREE.BoxGeometry(1.8, 0.06, 1.1);
  panel.rotateX(-0.6);
  p.add('window', part(panel, HEAT.glass * 2, [0.1, 0.13, 0.2], x, y + 0.55, z, 0, ry, 0));
  const tank = new THREE.CylinderGeometry(0.22, 0.22, 1.8, 10);
  tank.rotateZ(Math.PI / 2);
  p.add('metal', part(tank, HEAT.metal * 1.2, [0.75, 0.75, 0.74], x - Math.sin(ry) * 0.6, y + 1.0, z - Math.cos(ry) * 0.6, 0, ry, 0));
}

function rooftop(p, w, d, y, rng) {
  const spots = [];
  const free = (x, z, r) => spots.every((s) => Math.hypot(s[0] - x, s[1] - z) > s[2] + r);
  const place = (r, fn) => {
    for (let k = 0; k < 8; k++) {
      const x = (rng() - 0.5) * (w - 2 * r - 0.8);
      const z = (rng() - 0.5) * (d - 2 * r - 0.8);
      if (free(x, z, r)) {
        spots.push([x, z, r]);
        fn(x, z);
        return;
      }
    }
  };
  if (rng() < 0.85) place(0.9, (x, z) => waterTank(p, x, y, z));
  if (w * d > 120 && rng() < 0.5) place(0.9, (x, z) => waterTank(p, x, y, z));
  const nAc = Math.floor(rng() * Math.min(4, (w * d) / 40));
  for (let i = 0; i < nAc; i++) place(0.6, (x, z) => acUnit(p, x, y, z, Math.floor(rng() * 4) * (Math.PI / 2)));
  if (rng() < 0.45) place(0.6, (x, z) => satDish(p, x, y, z, rng() * 6.28));
  if (rng() < 0.35) place(1.2, (x, z) => solarHeater(p, x, y, z, Math.PI + (rng() - 0.5) * 0.3));
}

// ---- buildings ----

// Hacienda block: painted stucco with a darker skirting band, framed windows, a hip tile roof
// with a ridge cap, or a rooftop terrace with parapet and clutter.
export function haciendaBlock(w, d, h, rng, { floors = 2, terrace = false, wall = 'plaster', paint: wallPaint = null } = {}) {
  const p = new Parts();
  const wallColor = wallPaint ?? (wall === 'plaster' ? pick(rng, WALL_PAINT.hacienda) : shade(COLOR.adobe, 1.05));
  p.add(wall, box(w, h, d, HEAT.wall, wallColor, 0, h / 2, 0));
  // Skirting ("guardapolvo"): a band of darker paint along the foot of the walls.
  const skirt = pick(rng, [[0.55, 0.32, 0.24], [0.62, 0.6, 0.56], [0.45, 0.36, 0.3], shade(wallColor, 0.72)]);
  p.add(wall, box(w + 0.05, 0.75, d + 0.05, HEAT.wall, skirt, 0, 0.375, 0));
  openings(p, w, d, h, floors, rng, wall, wallColor);
  if (terrace) {
    p.add('paver', box(w, 0.3, d, HEAT.roofFlat, [0.72, 0.5, 0.4], 0, h + 0.15, 0));
    for (const s of [-1, 1]) {
      p.add(wall, box(w, 0.9, 0.35, HEAT.wall, wallColor, 0, h + 0.75, s * (d / 2 - 0.17)));
      p.add(wall, box(0.35, 0.9, d, HEAT.wall, wallColor, s * (w / 2 - 0.17), h + 0.75, 0));
      p.add('plain', box(w + 0.1, 0.08, 0.45, HEAT.roof, [0.6, 0.38, 0.3], 0, h + 1.24, s * (d / 2 - 0.17)));
      p.add('plain', box(0.45, 0.08, d + 0.1, HEAT.roof, [0.6, 0.38, 0.3], s * (w / 2 - 0.17), h + 1.24, 0));
    }
    rooftop(p, w - 1, d - 1, h + 0.3, rng);
  } else {
    const rh = Math.min(w, d) * 0.28;
    const roof = hipRoof(w, d, rh, 0.6, HEAT.roof, COLOR.tile);
    p.add('tile', roof.translate(0, h, 0));
    // Ridge cap.
    const ridge = roof.userData.ridge;
    if (ridge > 0.5) {
      const cap = box(ridge + 0.3, 0.16, 0.3, HEAT.roof, [0.55, 0.33, 0.25], 0, h + rh + 0.04, 0);
      if (d > w) cap.rotateY(Math.PI / 2);
      p.add('plain', cap);
    }
    // Fascia board under the eaves.
    for (const s of [-1, 1]) {
      p.add('plain', box(w + 1.2, 0.14, 0.06, HEAT.wood, [0.42, 0.3, 0.22], 0, h - 0.04, s * (d / 2 + 0.6)));
      p.add('plain', box(0.06, 0.14, d + 1.2, HEAT.wood, [0.42, 0.3, 0.22], s * (w / 2 + 0.6), h - 0.04, 0));
    }
  }
  return p;
}

// Arcade porch: columns with arches under a lean-to tile roof, along +z of a wall of length len.
export function arcade(len, h, depth, rng) {
  const p = new Parts();
  const col = pick(rng, WALL_PAINT.hacienda);
  const n = Math.max(2, Math.floor(len / 3.2));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len / n) * i;
    p.add('plaster', box(0.55, h, 0.55, HEAT.wall, col, x, h / 2, depth));
    p.add('plaster', box(0.75, 0.3, 0.75, HEAT.wall, shade(col, 0.8), x, 0.15, depth));
  }
  p.add('plaster', box(len + 0.6, 0.8, 0.6, HEAT.wall, col, 0, h + 0.4, depth));
  // Arch spandrels: shadowed half-discs read as round arches from above at an angle.
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    const g = new THREE.CircleGeometry((len / n) * 0.4, 12, 0, Math.PI);
    p.add('plain', part(g, HEAT.shade, COLOR.shade, x, h - 0.35, depth + 0.31));
  }
  p.add('paver', box(len, 0.15, depth, HEAT.roofFlat, [0.72, 0.5, 0.4], 0, 0.08, depth / 2));
  // The back half of this roof sits inside the building it is attached to, leaving a lean-to.
  p.add('tile', gableRoof(len, depth * 2 + 0.6, 1.1, 0.3, HEAT.roof, COLOR.tile).translate(0, h + 0.8, 0));
  return p;
}

// Long stable with tile gable roof and an arched arcade along its front (+z).
export function stable(len, d, h, rng) {
  const p = new Parts();
  p.add('clay', box(len, h, d, HEAT.wall, COLOR.adobe, 0, h / 2, 0));
  const n = Math.floor(len / 4.2);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    p.add('plain', box(2.6, 2.4, 0.12, HEAT.shade, COLOR.shade, x, 1.2, d / 2 + 0.04));
    p.add('plain', part(new THREE.CircleGeometry(1.3, 12, 0, Math.PI), HEAT.shade, COLOR.shade, x, 2.4, d / 2 + 0.05));
    p.add('wood', box(1.2, 1.3, 0.06, HEAT.wood, COLOR.doorWood, x - 0.6, 0.65, d / 2 + 0.1));
  }
  p.add('tile', gableRoof(len, d, 2.2, 0.6, HEAT.roof, COLOR.tile).translate(0, h, 0));
  p.add('clay', gableEnds(len, d, 2.2, HEAT.wall, COLOR.adobe).translate(0, h, 0));
  p.add('plain', box(len + 1.2, 0.16, 0.3, HEAT.roof, [0.55, 0.33, 0.25], 0, h + 2.24, 0));
  return p;
}

// Plank barn with a corrugated metal roof (galvanised or red-painted) and big dark doors.
export function barn(w, d, h, rng) {
  const p = new Parts();
  const roof = rng() < 0.5 ? 'tin' : 'tinred';
  const wood = shade(COLOR.wood, 0.8 + rng() * 0.35);
  p.add('wood', box(w, h, d, HEAT.wood, wood, 0, h / 2, 0));
  p.add('plain', box(w * 0.35, h * 0.75, 0.12, HEAT.shade, COLOR.shade, 0, h * 0.375, d / 2 + 0.04));
  p.add('wood', box(w * 0.18, h * 0.75, 0.08, HEAT.wood, shade(wood, 0.8), -w * 0.27, h * 0.375, d / 2 + 0.12));
  p.add(roof, gableRoof(w, d, d * 0.25, 0.4, HEAT.tin, roof === 'tin' ? COLOR.tin : [0.82, 0.8, 0.78]).translate(0, h, 0));
  p.add('wood', gableEnds(w, d, d * 0.25, HEAT.wood, wood).translate(0, h, 0));
  return p;
}

// Open-sided hay shed: corrugated roof on posts, stacked bales underneath.
export function openShed(w, d, h, rng) {
  const p = new Parts();
  for (let i = 0; i <= Math.round(w / 4); i++) {
    const x = -w / 2 + (w / Math.round(w / 4)) * i;
    for (const s of [-1, 1]) p.add('wood', box(0.3, h, 0.3, HEAT.wood, COLOR.wood, x, h / 2, s * d / 2));
  }
  p.add(rng() < 0.6 ? 'tin' : 'tinred', gableRoof(w, d, 1.2, 0.5, HEAT.tin, COLOR.tin).translate(0, h, 0));
  for (let i = 0; i < Math.floor(w / 1.4); i++) {
    if (rng() < 0.35) continue;
    const stack = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < stack; k++) p.add('hay', box(1.2, 0.6, d * 0.7, HEAT.hay, shade(COLOR.hay, 0.9 + rng() * 0.2), -w / 2 + 0.9 + i * 1.4, 0.3 + k * 0.62, 0));
  }
  return p;
}

// Flat-roofed village house (painted or bare adobe) with a parapet, a roof painted with
// terracotta waterproofing, a water tank and other clutter; or a shack with a metal roof.
export function villageHouse(w, d, h, rng) {
  const p = new Parts();
  const tinRoof = rng() < 0.3;
  const wall = rng() < 0.35 ? 'clay' : 'plaster';
  const wallColor = wall === 'clay' ? shade(COLOR.adobe, 0.95 + rng() * 0.2) : pick(rng, WALL_PAINT.village);
  p.add(wall, box(w, h, d, HEAT.wall, wallColor, 0, h / 2, 0));
  if (rng() < 0.6) p.add(wall, box(w + 0.05, 0.6, d + 0.05, HEAT.wall, shade(wallColor, 0.7), 0, 0.3, 0));
  openings(p, w, d, h, 1, rng, wall, wallColor);
  if (tinRoof) {
    p.add(rng() < 0.5 ? 'tin' : 'tinred', gableRoof(w, d, 0.8, 0.4, HEAT.tin, COLOR.tin).translate(0, h, 0));
  } else {
    const roofColor = pick(rng, [[0.66, 0.34, 0.25], [0.7, 0.4, 0.3], [0.78, 0.77, 0.74], [0.58, 0.55, 0.5]]);
    p.add('plain', box(w, 0.25, d, HEAT.roofFlat, roofColor, 0, h + 0.12, 0));
    for (const s of [-1, 1]) {
      p.add(wall, box(w, 0.6, 0.3, HEAT.wall, wallColor, 0, h + 0.4, s * (d / 2 - 0.15)));
      p.add(wall, box(0.3, 0.6, d, HEAT.wall, wallColor, s * (w / 2 - 0.15), h + 0.4, 0));
    }
    rooftop(p, w - 0.8, d - 0.8, h + 0.25, rng);
  }
  return p;
}

// Victorian glasshouse: framed glass walls and gable roof, beds of plants inside.
export function greenhouse(w, d, h, rng) {
  const p = new Parts();
  const rh = d * 0.38;
  p.add('paver', box(w + 3, 0.15, d + 3, HEAT.roofFlat, COLOR.paver, 0, 0.07, 0));
  p.add('plaster', box(w, 0.6, d, HEAT.wall, COLOR.stucco, 0, 0.45, 0));
  // Glass shell.
  p.add('glass', box(w - 0.1, h - 0.6, d - 0.1, HEAT.glass, COLOR.glass, 0, 0.6 + (h - 0.6) / 2, 0));
  p.add('glass', gableRoof(w, d, rh, 0, HEAT.glass, COLOR.glass).deleteAttribute('uv').translate(0, h, 0));
  p.add('glass', gableEnds(w, d, rh, HEAT.glass, COLOR.glass).translate(0, h, 0));
  // White steel frame: posts, eave rails, rafters, ridge.
  const fr = (gw, gh, gd, x, y, z, ry = 0) => p.add('metal', box(gw, gh, gd, HEAT.frame, COLOR.frame, x, y, z, ry));
  const nx = Math.round(w / 1.6);
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w / nx) * i;
    for (const s of [-1, 1]) fr(0.1, h, 0.1, x, h / 2, s * d / 2);
    const slope = Math.atan2(rh, d / 2);
    for (const s of [-1, 1]) {
      const g = box(0.1, 0.1, Math.hypot(d / 2, rh), HEAT.frame, COLOR.frame, 0, 0, 0);
      g.rotateX(s * slope);
      g.translate(x, h + rh / 2, (s * d) / 4);
      p.add('metal', g);
    }
  }
  const nz = Math.round(d / 1.6);
  for (let i = 0; i <= nz; i++) for (const s of [-1, 1]) fr(0.1, h, 0.1, s * w / 2, h / 2, -d / 2 + (d / nz) * i);
  for (const s of [-1, 1]) {
    fr(w, 0.12, 0.12, 0, h, s * d / 2);
    fr(0.12, 0.12, d, s * w / 2, h, 0);
  }
  fr(w, 0.14, 0.14, 0, h + rh, 0);
  // Planting beds inside.
  for (let i = 0; i < Math.floor(d / 2.5); i++) p.add('hedge', box(w * 0.85, 0.7, 1.1, HEAT.plant, COLOR.plant, 0, 0.35, -d / 2 + 1.6 + i * 2.5));
  return p;
}

// Steel water tower on four legs.
export function waterTower() {
  const p = new Parts();
  const H = 11;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = box(0.3, H, 0.3, HEAT.metal, COLOR.rust, 0, H / 2, 0);
      g.rotateZ(sx * -0.06);
      g.rotateX(sz * 0.06);
      g.translate(sx * 2.2, 0, sz * 2.2);
      p.add('metal', g);
    }
  }
  for (const y of [3.5, 7.5]) {
    for (const s of [-1, 1]) {
      p.add('metal', box(4.4, 0.15, 0.15, HEAT.metal, COLOR.rust, 0, y, s * 2.1));
      p.add('metal', box(0.15, 0.15, 4.4, HEAT.metal, COLOR.rust, s * 2.1, y, 0));
    }
  }
  p.add('metal', part(new THREE.CylinderGeometry(2.8, 2.8, 3.4, 20), HEAT.tankSun, COLOR.rust, 0, H + 1.7, 0));
  p.add('metal', part(new THREE.ConeGeometry(3.0, 1.2, 20), HEAT.tankSun, shade(COLOR.rust, 0.9), 0, H + 4.0, 0));
  p.add('metal', box(3.2, 0.12, 3.2, HEAT.metal, COLOR.rust, 0, H - 0.1, 0));
  return p;
}

// Star-shaped courtyard fountain.
export function fountain() {
  const p = new Parts();
  const star = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 5.2 : 3.8;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const rim = new THREE.ExtrudeGeometry(star, { depth: 0.7, bevelEnabled: false });
  rim.rotateX(-Math.PI / 2);
  p.add('plaster', part(rim, HEAT.wall, COLOR.stucco));
  p.add('water', part(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 32), HEAT.water, [0.32, 0.46, 0.44], 0, 0.62, 0));
  p.add('plaster', part(new THREE.CylinderGeometry(0.5, 0.8, 1.6, 12), HEAT.wall, COLOR.stucco, 0, 0.8, 0));
  p.add('plaster', part(new THREE.CylinderGeometry(1.3, 1.1, 0.25, 16), HEAT.wall, COLOR.stucco, 0, 1.7, 0));
  // Paved disc around it.
  p.add('paver', part(new THREE.CylinderGeometry(9, 9, 0.12, 40), HEAT.roofFlat, COLOR.paverDark, 0, 0.06, 0));
  return p;
}

export function pool(w, d) {
  const p = new Parts();
  p.add('paver', box(w + 3, 0.15, d + 3, HEAT.roofFlat, [0.8, 0.76, 0.7], 0, 0.07, 0));
  p.add('plain', box(w + 0.6, 0.2, d + 0.6, HEAT.roofFlat, [0.88, 0.86, 0.82], 0, 0.1, 0));
  p.add('water', box(w, 0.1, d, HEAT.water, COLOR.pool, 0, 0.16, 0));
  return p;
}

// Post-and-rail fence along a polyline of [x, z] points (y from heightFn).
export function fence(points, heightFn, rng, closed = false) {
  const p = new Parts();
  const pts = closed ? [...points, points[0]] : points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.6));
    const yaw = Math.atan2(bx - ax, bz - az);
    for (let k = 0; k <= n; k++) {
      if (k === n && i < pts.length - 2) continue;
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      p.add('wood', box(0.16, 1.45, 0.16, HEAT.wood, COLOR.woodDark, x, heightFn(x, z) + 0.72, z));
    }
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const my = heightFn(mx, mz);
    for (const y of [0.55, 1.15]) {
      const g = box(0.08, 0.14, len, HEAT.wood, COLOR.wood, 0, 0, 0);
      g.rotateY(yaw);
      g.translate(mx, my + y, mz);
      p.add('wood', g);
    }
  }
  return p;
}

export function roundBale() {
  return part(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 16), HEAT.hay, COLOR.hay, 0, 0.8, 0, 0, 0, Math.PI / 2);
}

export function barrels(n, rng) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const c = rng() < 0.5 ? COLOR.barrelBlue : COLOR.rust;
    parts.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14), HEAT.metal, c, (i % 3) * 0.66, 0.44, Math.floor(i / 3) * 0.66));
    for (const y of [0.3, 0.6]) parts.push(part(new THREE.CylinderGeometry(0.31, 0.31, 0.03, 14), HEAT.metal, shade(c, 0.8), (i % 3) * 0.66, y, Math.floor(i / 3) * 0.66));
  }
  return merge(parts);
}

// ---- vegetation ----

// Agave rosette (instanced by the thousand in the fields): ~22 stiff, tapering, slightly curved
// leaves, blue-green, paler toward the tips.
export function agaveGeometry() {
  const pos = [];
  const alb = [];
  const n = 16;
  const base = [0.27, 0.38, 0.36];
  const tip = [0.42, 0.5, 0.44];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.618;
    const ring = i / n;
    const len = 0.75 + (1 - ring) * 0.5 + r() * 0.15;
    const up = 0.35 + ring * 0.85 + r() * 0.12;
    const wid = 0.11 + (1 - ring) * 0.05;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const sx = -dz;
    const sz = dx;
    const segs = 2;
    let prevL = null;
    let prevR = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ang = up * (1 - 0.35 * t);
      const reach = Math.cos(ang) * len * t;
      const lift = Math.sin(ang) * len * t + 0.08;
      const w = wid * (1 - t * 0.92);
      const cx = dx * reach;
      const cz = dz * reach;
      const L = [cx + sx * w, lift, cz + sz * w];
      const R = [cx - sx * w, lift, cz - sz * w];
      const col = base.map((b, k) => b + (tip[k] - b) * t);
      if (prevL) {
        // Two triangles per segment, counter-clockwise from above.
        for (const v of [prevL[0], prevR[0], R, prevL[0], R, L]) pos.push(...v);
        for (const c of [prevL[1], prevR[1], col, prevL[1], col, col]) alb.push(...c);
      }
      prevL = [L, col];
      prevR = [R, col];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n3 = pos.length / 3;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n3 * 3).fill(HEAT.agave), 3));
  g.setAttribute('albedo', new THREE.Float32BufferAttribute(alb, 3));
  return g;
}

export function bushGeometry(rng) {
  const g = new THREE.IcosahedronGeometry(0.9 + rng() * 0.5, 1);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const k = 0.75 + rng() * 0.5;
    pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.6, pa.getZ(i) * k);
  }
  return part(g, HEAT.bush, COLOR.leaves.map((c) => c * 0.9), 0, 0.3, 0, 0, rng() * 3, 0);
}

export function poleGeometry() {
  return merge([
    part(new THREE.CylinderGeometry(0.13, 0.17, 9, 8), HEAT.wood, COLOR.woodDark, 0, 4.5, 0),
    box(2.4, 0.15, 0.15, HEAT.wood, COLOR.woodDark, 0, 8.6, 0),
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), HEAT.metal, [0.75, 0.75, 0.72], -1.1, 8.77, 0),
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), HEAT.metal, [0.75, 0.75, 0.72], 1.1, 8.77, 0),
  ]);
}

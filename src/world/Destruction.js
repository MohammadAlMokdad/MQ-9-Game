// Destructible map objects. Each object owns vertex ranges inside the merged world meshes, so
// destroying one rewrites those vertices in place: buildings collapse into rubble with a few
// broken walls left standing, trees and towers topple away from the blast, cars become burnt-out
// wrecks, rocks shatter. Wreckage is charred in daylight and hot in thermal (cooling over a
// minute or so), and building colliders drop so shells hit the rubble. restore() undoes it all.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DESTRUCT, WEAPONS } from '../config.js';
import { valueNoise2 } from '../core/rng.js';
import { box, part } from '../render/heat.js';
import { Parts, placeMatrix } from './meshes.js';
import { addGroundHeight } from './terrain.js';

const CELL = 24;
const cellOf = (v) => Math.floor(v / CELL);
const key = (gx, gz) => (gx + 1000) * 4096 + (gz + 1000);
const R = Math.random;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const COOL_HEAT = 0.72; // what wreckage settles to in thermal (a little warmer than the ground)

export class Destruction {
  // mats: the world's sensor-aware materials by bucket name (rubble reuses them).
  constructor(scene, mats) {
    this.scene = scene;
    this.mats = mats;
    this.objects = [];
    this.grid = new Map();
    this.burning = [];
    this.stamp = 0;
    this.coolAcc = 0;
  }

  // metas: { kind, collider?, box: Box3, ranges: [{ mesh, start, count }] } from World.
  init(metas) {
    for (const m of metas) {
      const spec = DESTRUCT[m.kind];
      if (!spec || (!m.ranges.length && !m.tree)) continue;
      m.spec = spec;
      m.hp = spec.hp;
      m.destroyed = false;
      m.saved = null;
      m.mark = 0;
      if (m.collider) m.colliderMaxY = m.collider.maxY;
      this.objects.push(m);
      const b = m.box;
      for (let gx = cellOf(b.min.x); gx <= cellOf(b.max.x); gx++) {
        for (let gz = cellOf(b.min.z); gz <= cellOf(b.max.z); gz++) {
          const k = key(gx, gz);
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(m);
        }
      }
    }
  }

  get destroyedCount() {
    let n = 0;
    for (const m of this.objects) if (m.destroyed) n++;
    return n;
  }

  // Splash damage from a player shell at (x, y, z).
  damage(g, wi, x, y, z) {
    const w = WEAPONS[wi];
    const reach = w.outer;
    this.stamp++;
    for (let gx = cellOf(x - reach); gx <= cellOf(x + reach); gx++) {
      for (let gz = cellOf(z - reach); gz <= cellOf(z + reach); gz++) {
        const list = this.grid.get(key(gx, gz));
        if (!list) continue;
        for (const m of list) {
          if (m.mark === this.stamp || m.destroyed) continue;
          m.mark = this.stamp;
          const b = m.box;
          const dx = Math.max(b.min.x - x, 0, x - b.max.x);
          const dy = Math.max(b.min.y - y, 0, y - b.max.y);
          const dz = Math.max(b.min.z - z, 0, z - b.max.z);
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= w.outer) continue;
          const f = d <= w.inner ? 1 : 1 - (d - w.inner) / (w.outer - w.inner);
          m.hp -= w.damage * f * m.spec.mult[w.id];
          if (m.hp <= 0) this.destroy(g, m, x, z);
        }
      }
    }
  }

  // ---- vertex helpers ----

  save(m) {
    m.saved = m.ranges.map(({ mesh, start, count }) => {
      const at = mesh.geometry.attributes;
      return {
        pos: at.position.array.slice(start * 3, (start + count) * 3),
        nrm: at.normal.array.slice(start * 3, (start + count) * 3),
        col: at.color.array.slice(start * 3, (start + count) * 3),
        alb: at.albedo.array.slice(start * 3, (start + count) * 3),
      };
    });
  }

  touch(attr, start, count) {
    attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize);
    attr.needsUpdate = true;
  }

  // fn(p, n) edits position p (and normal n for rigid moves) per vertex; then optionally
  // recomputes flat normals for deformed shapes.
  mapVerts(m, fn, flatNormals) {
    for (const { mesh, start, count } of m.ranges) {
      const at = mesh.geometry.attributes;
      const P = at.position.array;
      const N = at.normal.array;
      for (let i = start; i < start + count; i++) {
        const o = i * 3;
        _v.set(P[o], P[o + 1], P[o + 2]);
        _n.set(N[o], N[o + 1], N[o + 2]);
        fn(_v, _n);
        P[o] = _v.x;
        P[o + 1] = _v.y;
        P[o + 2] = _v.z;
        N[o] = _n.x;
        N[o + 1] = _n.y;
        N[o + 2] = _n.z;
      }
      if (flatNormals) {
        for (let i = start; i + 2 < start + count; i += 3) {
          const o = i * 3;
          _a.set(P[o], P[o + 1], P[o + 2]);
          _b.set(P[o + 3], P[o + 4], P[o + 5]);
          _c.set(P[o + 6], P[o + 7], P[o + 8]);
          _b.sub(_a);
          _c.sub(_a);
          _b.cross(_c).normalize();
          for (let k = 0; k < 3; k++) {
            N[o + k * 3] = _b.x;
            N[o + k * 3 + 1] = _b.y;
            N[o + k * 3 + 2] = _b.z;
          }
        }
      }
      this.touch(at.position, start, count);
      this.touch(at.normal, start, count);
    }
  }

  // Soot in daylight (patchy), heat in thermal.
  scorch(m, char, heat) {
    m.ranges.forEach(({ mesh, start, count }, ri) => {
      const at = mesh.geometry.attributes;
      const A = at.albedo.array;
      const C = at.color.array;
      const P = at.position.array;
      const sv = m.saved[ri];
      for (let i = 0; i < count; i++) {
        const o = (start + i) * 3;
        const n = valueNoise2(P[o] * 0.45, P[o + 2] * 0.45, 11);
        const k = char * (0.7 + 0.6 * n);
        A[o] = sv.alb[i * 3] * k;
        A[o + 1] = sv.alb[i * 3 + 1] * k;
        A[o + 2] = sv.alb[i * 3 + 2] * k;
        C[o] = C[o + 1] = C[o + 2] = sv.col[i * 3] * 0.3 + heat * 0.7;
      }
      this.touch(at.albedo, start, count);
      this.touch(at.color, start, count);
    });
    this.burning.push({ m, t: 0, heat });
  }

  // ---- destruction ----

  destroy(g, m, bx, bz) {
    m.destroyed = true;
    m.hp = 0;
    if (m.tree) {
      // Instanced realistic tree: it falls over (see Trees.js).
      m.field.topple(m.tree, bx, bz);
      const t = m.tree;
      g.fx.dust(t.x, t.y, t.z, Math.min(3, t.h * 0.25));
      g.audio.collapse(t.x, t.y, t.z, false);
      return;
    }
    this.save(m);
    const b = m.box;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const g0 = b.min.y;
    const H = b.max.y - b.min.y;
    const W = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const style = m.spec.style;

    if (style === 'collapse') {
      // The building is replaced by a rubble field: from above a squashed roof still looks
      // like a roof, so the original is hidden and broken walls and debris take its place.
      const palette = this.palette(m);
      this.hide(m);
      m.rubble = this.buildRubble(m, palette);
      this.dustCloud(g, cx, g0, cz, W, H);
      const fires = Math.max(1, Math.min(4, Math.round((W * W) / 120)));
      for (let i = 0; i < fires; i++) {
        const fx = b.min.x + R() * (b.max.x - b.min.x);
        const fz = b.min.z + R() * (b.max.z - b.min.z);
        g.fx.addEmitter(fx, g0 + 1, fz, { life: 60 + R() * 60, interval: 0.2, fire: true, size: 0.8 + R() * 0.8 });
      }
      g.audio.collapse(cx, g0, cz, true);
    } else if (style === 'topple') {
      // Fall away from the blast, pivoting on the base.
      let dx = cx - bx;
      let dz = cz - bz;
      let l = Math.hypot(dx, dz);
      if (l < 0.3) {
        const a = R() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
        l = 1;
      }
      dx /= l;
      dz /= l;
      _axis.set(dz, 0, -dx).normalize();
      _q.setFromAxisAngle(_axis, 1.3 + R() * 0.3);
      this.mapVerts(m, (p, n) => {
        p.x -= cx;
        p.y -= g0;
        p.z -= cz;
        p.applyQuaternion(_q);
        // Anything swung below the ground is pressed flat onto it.
        if (p.y < 0.05) p.y = 0.05 + -p.y * 0.08;
        p.x += cx;
        p.y += g0;
        p.z += cz;
        n.applyQuaternion(_q);
      }, false);
      this.scorch(m, m.kind === 'tower' ? 0.5 : 0.6, m.kind === 'tower' ? 1.1 : 0.95);
      g.fx.dust(cx + dx * H * 0.6, g0, cz + dz * H * 0.6, Math.min(4, H * 0.35));
      if (m.collider) m.collider.maxY = m.collider.minY + 2;
      g.audio.collapse(cx, g0, cz, m.kind === 'tower');
    } else if (style === 'wreck') {
      _axis.set(R() - 0.5, 0, R() - 0.5).normalize();
      _q.setFromAxisAngle(_axis, 0.12 + R() * 0.1);
      this.mapVerts(m, (p) => {
        p.y = g0 + (p.y - g0) * 0.8;
        p.x -= cx;
        p.y -= g0;
        p.z -= cz;
        p.applyQuaternion(_q);
        p.x += cx;
        p.y += g0 + 0.1;
        p.z += cz;
      }, true);
      this.scorch(m, 0.25, 1.6);
      g.fx.vehicleDeath(cx, g0, cz, W / 2);
      g.audio.vehicleExplosion(cx, g0, cz);
    } else if (style === 'burn') {
      this.mapVerts(m, (p) => {
        p.y = g0 + (p.y - g0) * 0.45;
      }, true);
      this.scorch(m, 0.3, 1.5);
      g.fx.addEmitter(cx, g0 + 0.5, cz, { life: 25 + R() * 15, interval: 0.25, fire: true, size: 0.5 });
    } else if (style === 'blast') {
      this.mapVerts(m, (p) => {
        p.y = g0 + (p.y - g0) * 0.2;
        p.x = cx + (p.x - cx) * 1.4;
        p.z = cz + (p.z - cz) * 1.4;
      }, true);
      this.scorch(m, 0.2, 1.4);
      g.fx.blast(cx, g0, cz, 1.4);
      g.audio.smallBlast(cx, g0, cz, 0.45);
    } else {
      // Shatter: rock or masonry breaks into a low spread of fragments.
      this.mapVerts(m, (p) => {
        const n = valueNoise2(p.x * 1.3, p.z * 1.3, 5);
        p.y = g0 + (p.y - g0) * (0.25 + 0.2 * n);
        p.x = cx + (p.x - cx) * (1.2 + 0.3 * n);
        p.z = cz + (p.z - cz) * (1.2 + 0.3 * n);
      }, true);
      this.scorch(m, 0.85, 0.95);
      this.dustCloud(g, cx, g0, cz, W * 0.6, H);
      g.audio.collapse(cx, g0, cz, false);
    }
    if (m.collider && style === 'collapse') m.collider.maxY = m.collider.minY + Math.max(0.8, H * 0.2);
  }

  // Collapses every triangle of the object to a point, so it stops rendering (and casting shadow).
  hide(m) {
    for (const { mesh, start, count } of m.ranges) {
      const at = mesh.geometry.attributes;
      const P = at.position.array;
      const x = P[start * 3];
      const y = P[start * 3 + 1];
      const z = P[start * 3 + 2];
      for (let i = start; i < start + count; i++) {
        P[i * 3] = x;
        P[i * 3 + 1] = y;
        P[i * 3 + 2] = z;
      }
      this.touch(at.position, start, count);
    }
  }

  // Average colours of the object's walls and roof, from its saved albedo.
  palette(m) {
    const acc = {};
    m.ranges.forEach(({ mesh, count }, ri) => {
      const k = mesh.material.name;
      const a = (acc[k] ||= { r: 0, g: 0, b: 0, n: 0 });
      const alb = m.saved[ri].alb;
      for (let i = 0; i < count; i += 3) {
        a.r += alb[i * 3];
        a.g += alb[i * 3 + 1];
        a.b += alb[i * 3 + 2];
        a.n++;
      }
    });
    const avg = (k) => (acc[k] && acc[k].n ? [acc[k].r / acc[k].n, acc[k].g / acc[k].n, acc[k].b / acc[k].n] : null);
    let wallBucket = 'plaster';
    let most = 0;
    for (const k of ['plaster', 'clay', 'wood']) {
      if (acc[k] && acc[k].n > most) {
        most = acc[k].n;
        wallBucket = k;
      }
    }
    return {
      wallBucket,
      wall: avg(wallBucket) || [0.6, 0.55, 0.48],
      roof: avg('tile') || avg('tin') || avg('paver') || [0.32, 0.27, 0.22],
      glass: !!acc.glass,
    };
  }

  // Broken wall stubs around the footprint, jumbled wall chunks, tilted roof slabs, charred
  // debris on a bed of ash; built in the building's own frame, then placed.
  buildRubble(m, pal) {
    const b = m.box;
    const f = m.frame || { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, ry: 0, w: b.max.x - b.min.x, d: b.max.z - b.min.z };
    const H = b.max.y - b.min.y;
    const w = f.w;
    const d = f.d;
    const P = new Parts();
    const char = (c, k) => c.map((v) => v * k);
    const WALL_HEAT = 0.95;
    // Ash and dirt bed: overlapping patches give it a ragged outline instead of a neat rectangle.
    const patches = Math.max(6, Math.round((w * d) / 25));
    for (let i = 0; i < patches; i++) {
      const pw = (0.35 + R() * 0.5) * (w + 3);
      const pd = (0.35 + R() * 0.5) * (d + 3);
      const shade = 0.13 + R() * 0.1;
      P.add('plain', box(pw, 0.1 + R() * 0.08, pd, 0.9, [shade, shade * 0.9, shade * 0.8], (R() - 0.5) * w * 0.6, 0.06, (R() - 0.5) * d * 0.6, (R() - 0.5) * 0.8));
    }
    if (pal.glass) {
      // Greenhouse: twisted white frames and shattered glass.
      for (let i = 0; i < 14; i++) {
        const len = 2 + R() * 4;
        P.add('plain', part(new THREE.BoxGeometry(0.12, 0.12, len), 0.75, [0.85, 0.85, 0.82], (R() - 0.5) * w, 0.3 + R() * 1.2, (R() - 0.5) * d, (R() - 0.5) * 1.2, R() * 3, (R() - 0.5) * 0.8));
      }
      for (let i = 0; i < 40; i++) {
        const s = 0.4 + R() * 1.4;
        P.add('glass', part(new THREE.BoxGeometry(s, 0.04, s * (0.5 + R())), 0.2, [0.62, 0.72, 0.74], (R() - 0.5) * (w + 3), 0.1 + R() * 0.4, (R() - 0.5) * (d + 3), (R() - 0.5) * 0.6, R() * 3, (R() - 0.5) * 0.6));
      }
    } else {
      // A low heap of debris in the middle.
      for (let i = 0; i < 6; i++) {
        const hw = (0.3 + R() * 0.4) * w;
        const hd = (0.3 + R() * 0.4) * d;
        P.add('plain', box(hw, 0.3 + R() * 0.5, hd, 0.95, char(pal.wall, 0.35 + R() * 0.25), (R() - 0.5) * w * 0.4, 0.2, (R() - 0.5) * d * 0.4, (R() - 0.5) * 0.9));
      }
      // Wall stubs with gaps, jagged heights.
      for (const [len, off, isX] of [
        [w, d / 2, true],
        [w, -d / 2, true],
        [d, w / 2, false],
        [d, -w / 2, false],
      ]) {
        const n = Math.max(2, Math.ceil(len / 2.4));
        for (let i = 0; i < n; i++) {
          if (R() < 0.3) continue;
          const seg = (len / n) * (0.75 + R() * 0.25);
          const hh = H * (0.06 + 0.45 * R() * R());
          const t = -len / 2 + (len / n) * (i + 0.5);
          const g = isX ? box(seg, hh, 0.45, WALL_HEAT, char(pal.wall, 0.8), t, hh / 2, off) : box(0.45, hh, seg, WALL_HEAT, char(pal.wall, 0.8), off, hh / 2, t);
          P.add(pal.wallBucket, g);
        }
      }
      // Jumbled chunks: wall blocks, burnt bits.
      const nChunks = Math.max(14, Math.min(90, Math.round((w * d) / 5)));
      for (let i = 0; i < nChunks; i++) {
        const s = 0.4 + R() * 1.8;
        const hh = 0.3 + R() * Math.min(1.4, H * 0.25);
        const x = (R() - 0.5) * (w + 2);
        const z = (R() - 0.5) * (d + 2);
        const burnt = R() < 0.3;
        const geo = part(new THREE.BoxGeometry(s, hh, s * (0.5 + R())), burnt ? 1.1 : WALL_HEAT, burnt ? [0.1, 0.09, 0.08] : char(pal.wall, 0.6 + R() * 0.4), x, hh * 0.4 + R() * 0.5, z, (R() - 0.5) * 0.9, R() * 3, (R() - 0.5) * 0.9);
        P.add(burnt ? 'plain' : pal.wallBucket, geo);
      }
      // Roof slabs that came down in pieces.
      const nSlabs = Math.max(3, Math.min(14, Math.round((w * d) / 30)));
      for (let i = 0; i < nSlabs; i++) {
        const sw = 2 + R() * Math.min(5, w * 0.4);
        const sd = 1.5 + R() * Math.min(4, d * 0.4);
        P.add('plain', part(new THREE.BoxGeometry(sw, 0.22, sd), 0.85, char(pal.roof, 0.55 + R() * 0.35), (R() - 0.5) * w * 0.8, 0.6 + R() * 1.2, (R() - 0.5) * d * 0.8, (R() - 0.5) * 1.0, R() * 3, (R() - 0.5) * 1.0));
      }
      // A few beams sticking out.
      for (let i = 0; i < 5; i++) {
        P.add('plain', part(new THREE.BoxGeometry(0.25, 0.25, 3 + R() * 4), 0.9, [0.16, 0.12, 0.09], (R() - 0.5) * w * 0.7, 0.8 + R(), (R() - 0.5) * d * 0.7, (R() - 0.5) * 1.2, R() * 3, (R() - 0.5) * 0.6));
      }
    }
    P.transform(placeMatrix(f.x, b.min.y, f.z, f.ry));
    const meshes = [];
    for (const [k, list] of Object.entries(P.b)) {
      const geo = mergeGeometries(list, false);
      for (const gg of list) gg.dispose();
      addGroundHeight(geo, b.min.y);
      const mesh = new THREE.Mesh(geo, this.mats[k]);
      mesh.castShadow = k !== 'glass';
      mesh.receiveShadow = true;
      mesh.renderOrder = k === 'glass' ? 2 : 0;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  // Pale dust rolling out of a collapse, plus thrown debris.
  dustCloud(g, x, y, z, W, H) {
    const n = Math.min(40, 8 + Math.round(W));
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const r = R() * W * 0.5;
      const sp = 3 + R() * 6;
      g.fx.smoke.emit(x + Math.cos(a) * r, y + R() * H * 0.6, z + Math.sin(a) * r, Math.cos(a) * sp, 1 + R() * 3, Math.sin(a) * sp, 6 + R() * 6, 4 + W * 0.15, 10 + W * 0.45, 0.3, 0.24, 0.85, 0, 0, 0.6, -1, 0, 1);
    }
    g.fx.debris(x, y + H * 0.3, z, Math.min(30, 8 + Math.round(W)), 18, 16);
  }

  // Wreckage cools slowly in thermal.
  update(dt) {
    this.coolAcc += dt;
    if (this.coolAcc < 0.5 || !this.burning.length) return;
    const step = this.coolAcc;
    this.coolAcc = 0;
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const e = this.burning[i];
      e.t += step;
      const cur = COOL_HEAT + (e.heat - COOL_HEAT) * Math.exp(-e.t / 30);
      e.m.ranges.forEach(({ mesh, start, count }, ri) => {
        const attr = mesh.geometry.attributes.color;
        const C = attr.array;
        const sv = e.m.saved[ri].col;
        for (let k = 0; k < count; k++) {
          const o = (start + k) * 3;
          C[o] = C[o + 1] = C[o + 2] = sv[k * 3] * 0.3 + cur * 0.7;
        }
        this.touch(attr, start, count);
      });
      if (e.t > 150) this.burning.splice(i, 1);
    }
  }

  // Puts every destroyed object back (new run).
  restore() {
    for (const m of this.objects) {
      m.hp = m.spec.hp;
      if (!m.destroyed) continue;
      if (m.tree) {
        m.field.restore(m.tree);
        m.destroyed = false;
        continue;
      }
      m.ranges.forEach(({ mesh, start, count }, ri) => {
        const at = mesh.geometry.attributes;
        const sv = m.saved[ri];
        at.position.array.set(sv.pos, start * 3);
        at.normal.array.set(sv.nrm, start * 3);
        at.color.array.set(sv.col, start * 3);
        at.albedo.array.set(sv.alb, start * 3);
        for (const a of [at.position, at.normal, at.color, at.albedo]) this.touch(a, start, count);
      });
      if (m.collider) m.collider.maxY = m.colliderMaxY;
      if (m.rubble) {
        for (const mesh of m.rubble) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
        }
        m.rubble = null;
      }
      m.destroyed = false;
      m.saved = null;
    }
    this.burning.length = 0;
  }
}

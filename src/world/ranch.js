// Everything outside the hacienda walls, laid out after the reference mission's ranch:
// greenhouse farm, barnyard with water tower and corrals, adobe village, ranch house, hay
// sheds, terraced agave fields, dense trees, ranch fences and power lines along dirt roads.
import * as THREE from 'three';
import { part, placed } from '../render/heat.js';
import {
  Parts, placeMatrix, haciendaBlock, stable, barn, openShed, villageHouse, greenhouse, waterTower,
  fence, roundBale, barrels, poleGeometry,
} from './meshes.js';
import { heightAt } from './terrain.js';
import { LIB, addProp, addRock, addDrums } from './props.js';
import { mulberry32 } from '../core/rng.js';
import { bearingVec, distToRoutes } from './roads.js';
import { HEAT, COLOR } from '../config.js';

const aabb = (x, y, z, w, h, d) => ({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });

export function buildRanch(rng, routes, vehicles) {
  const P = new Parts();
  const colliders = [];
  const yards = [[0, 0, 98]];
  const agave = []; // one Float32Array of (x, y, z, yaw, scale) per field
  const trees = []; // realistic tree spots, filled by World
  const bushes = []; // scrub spots (x, y, z, yaw, scale), drawn by World
  const palms = []; // date palm spots, filled by World
  const lines = [];
  const foot = [{ x: 0, z: 0, r: 92 }]; // occupied circles (the compound first)
  const sites = {};

  const blocked = (x, z, r, roadClear = 6) =>
    distToRoutes(routes, x, z) < r + roadClear || foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r);

  // Finds a free spot near the requested bearing/range by spiralling outwards.
  const findSite = (bearing, range, r) => {
    for (let k = 0; k < 60; k++) {
      const b = bearing + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 3;
      const d = bearingVec(b);
      const rr = range + (k % 5) * 6;
      const x = d.x * rr;
      const z = d.z * rr;
      if (!blocked(x, z, r)) return { x, z };
    }
    const d = bearingVec(bearing);
    return { x: d.x * range, z: d.z * range };
  };

  // Places a destructible building at (x, z) on the terrain, records its footprint and collider box.
  const put = (sub, x, z, ry, w, d, h, kind) => {
    const y = heightAt(x, z);
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    const W = w * c + d * s;
    const D = w * s + d * c;
    const collider = aabb(x, y, z, W, h, D);
    colliders.push(collider);
    P.addAll(sub.transform(placeMatrix(x, y, z, ry)), { kind, collider, frame: { x, z, ry, w, d } });
    foot.push({ x, z, r: Math.hypot(W, D) / 2 });
  };
  // kind makes the prop destructible (tree, palm, prop, drums, vehicle); bucket picks the material.
  const prop = (geom, x, z, ry = 0, s = 1, heatMul = 1, kind = null, bucket = 'plain') =>
    P.add(bucket, placed(geom, x, heightAt(x, z), z, ry, s, heatMul), kind ? { kind } : null);
  const local = (cx, cz, ry) => (lx, lz) => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)];

  // Randomness for photoscanned dressing only, so the layout is the same with or without props.
  const dress = mulberry32(2718);
  const bale = roundBale();
  const drums = barrels(6, rng);
  const scatterBales = (cx, cz, n, spread) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (rng() - 0.5) * spread;
      const z = cz + (rng() - 0.5) * spread;
      if (!blocked(x, z, 1, 3)) prop(bale, x, z, rng() * 6, 1, 1, 'prop', 'hay');
    }
  };
  const park = (geom, x, z, ry, heat) => {
    if (!blocked(x, z, 3, 2)) {
      prop(geom, x, z, ry, 1, heat, 'vehicle', geom.userData.bucket || 'plain');
      foot.push({ x, z, r: 3 });
    }
  };

  // --- Greenhouse farm (northwest) ---
  {
    const s = findSite(312, 195, 40);
    sites.greenhouses = s;
    const ry = (rng() - 0.5) * 0.6;
    const L = local(s.x, s.z, ry);
    yards.push([s.x, s.z, 52]);
    let [x, z] = L(-14, 0);
    put(greenhouse(26, 13, 3.4, rng), x, z, ry, 29, 16, 7, 'greenhouse');
    [x, z] = L(16, -2);
    put(greenhouse(20, 11, 3.2, rng), x, z, ry + Math.PI / 2, 23, 14, 6.5, 'greenhouse');
    [x, z] = L(-14, 16);
    scatterBales(x, z, 8, 20);
    [x, z] = L(14, 20);
    park(vehicles.truck, x, z, ry + 0.4, 0.75);
    [x, z] = L(-30, -14);
    addDrums(P, x, heightAt(x, z), z, ry, dress, () => prop(drums, x, z, ry, 1, 1, 'drums', 'metal'));
    P.addAll(fence([L(-34, -18), L(30, -18), L(30, 30), L(-34, 30)], heightAt, rng, true));
  }

  // --- Barnyard (west-southwest): stable with arches, barns, water tower, corrals ---
  {
    const s = findSite(250, 235, 55);
    sites.barnyard = s;
    const ry = (rng() - 0.5) * 0.5;
    const L = local(s.x, s.z, ry);
    yards.push([s.x, s.z, 70]);
    let [x, z] = L(0, -24);
    put(stable(40, 9, 4.2, rng), x, z, ry, 42, 11, 8, 'stable');
    [x, z] = L(-30, 6);
    put(barn(15, 11, 5, rng), x, z, ry + Math.PI / 2, 16, 12, 9, 'barn');
    [x, z] = L(26, 4);
    put(barn(12, 10, 4.5, rng), x, z, ry, 13, 11, 8, 'barn');
    [x, z] = L(-4, 30);
    put(openShed(20, 8, 4, rng), x, z, ry, 21, 9, 6, 'shed');
    [x, z] = L(12, -6);
    put(waterTower(), x, z, 0, 6, 6, 16, 'tower');
    // Corrals.
    for (const [cx, cz, w, d] of [
      [-6, 8, 18, 14],
      [-26, 30, 16, 12],
      [30, 30, 20, 14],
    ]) {
      const pts = [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]].map(([a, b]) => L(a, b));
      P.addAll(fence(pts, heightAt, rng, true));
    }
    [x, z] = L(18, 14);
    scatterBales(x, z, 12, 22);
    [x, z] = L(-20, -6);
    addDrums(P, x, heightAt(x, z), z, ry, dress, () => prop(drums, x, z, ry, 1, 1, 'drums', 'metal'));
    // Crates stacked by the barn.
    if (LIB.crate) {
      [x, z] = L(-22, 2);
      for (let i = 0; i < 5; i++) addProp(P, 'crate', x + (i % 3) * 1.1, heightAt(x, z) + (i >= 3 ? 0.62 : 0), z + (i >= 3 ? 0.3 : 0), ry + (dress() - 0.5) * 0.3, 1, { kind: 'prop' });
    }
    [x, z] = L(-12, 18);
    park(vehicles.car, x, z, ry + 1.2, 0.8);
    [x, z] = L(38, -16);
    park(vehicles.carRed, x, z, ry - 0.4, 0.5);
    [x, z] = L(8, 20);
    park(vehicles.truck, x, z, ry + Math.PI / 2, 0.6);
  }

  // --- Adobe village (east) ---
  {
    const s = findSite(100, 265, 65);
    sites.village = s;
    yards.push([s.x, s.z, 75]);
    let placedN = 0;
    for (let tries = 0; tries < 90 && placedN < 12; tries++) {
      const x = s.x + (rng() - 0.5) * 120;
      const z = s.z + (rng() - 0.5) * 120;
      const w = 7 + rng() * 6;
      const d = 6 + rng() * 5;
      const r = Math.hypot(w, d) / 2 + 2;
      if (blocked(x, z, r, 8)) continue;
      const ry = Math.round(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.3;
      put(villageHouse(w, d, 3 + rng() * 1.2, rng), x, z, ry, w, d, 5, 'house');
      if (rng() < 0.5) {
        const L = local(x, z, ry);
        const m = 4;
        P.addAll(fence([L(-w / 2 - m, d / 2 + m), L(-w / 2 - m, -d / 2 - m), L(w / 2 + m, -d / 2 - m), L(w / 2 + m, d / 2 + m)], heightAt, rng));
      }
      if (rng() < 0.4) park(rng() < 0.5 ? vehicles.car : vehicles.carRed, x + (rng() - 0.5) * 14, z + d / 2 + 5, rng() * 6, 0.5 + rng() * 0.4);
      // Now and then a car under a dust cover beside the house.
      if (LIB.covered_car && dress() < 0.3) {
        const cx = x - (w / 2 + 3.5) * Math.cos(ry);
        const cz = z + (w / 2 + 3.5) * Math.sin(ry);
        if (!blocked(cx, cz, 3, 2)) {
          addProp(P, 'covered_car', cx, heightAt(cx, cz), cz, ry + Math.PI / 2 + (dress() - 0.5) * 0.4, 1, { kind: 'vehicle' });
          foot.push({ x: cx, z: cz, r: 3 });
        }
      }
      placedN++;
    }
    for (let i = 0; i < 10; i++) {
      const x = s.x + (rng() - 0.5) * 110;
      const z = s.z + (rng() - 0.5) * 110;
      if (blocked(x, z, 2, 4)) continue;
      palms.push({ x, z, yaw: rng() * 6.28, scale: 1.15 + rng() * 0.45, r: rng() });
    }
  }

  // --- Ranch house (northeast) ---
  {
    const s = findSite(28, 225, 45);
    sites.ranchHouse = s;
    const ry = (rng() - 0.5) * 0.8;
    const L = local(s.x, s.z, ry);
    yards.push([s.x, s.z, 50]);
    let [x, z] = L(0, 0);
    put(haciendaBlock(17, 10, 4.2, rng, { floors: 1, wall: 'clay' }), x, z, ry, 18, 11, 8, 'house');
    [x, z] = L(24, 8);
    put(barn(13, 10, 4.6, rng), x, z, ry, 14, 11, 8, 'barn');
    const cr = [[-14, 14], [10, 14], [10, 34], [-14, 34]].map(([a, b]) => L(a, b));
    P.addAll(fence(cr, heightAt, rng, true));
    [x, z] = L(-2, 24);
    scatterBales(x, z, 6, 16);
    [x, z] = L(-16, -10);
    park(vehicles.car, x, z, ry + 0.5, 0.9);
  }

  // --- South farm: hay sheds with trucks parked under them ---
  {
    const s = findSite(172, 215, 45);
    sites.southFarm = s;
    const ry = (rng() - 0.5) * 0.6;
    const L = local(s.x, s.z, ry);
    yards.push([s.x, s.z, 55]);
    let [x, z] = L(-12, 0);
    put(openShed(24, 10, 4.5, rng), x, z, ry, 25, 11, 6, 'shed');
    [x, z] = L(16, -4);
    put(barn(14, 12, 5, rng), x, z, ry + Math.PI / 2, 15, 13, 9, 'barn');
    [x, z] = L(-12, 16);
    park(vehicles.truck, x, z, ry, 0.5);
    [x, z] = L(4, 20);
    scatterBales(x, z, 10, 24);
    [x, z] = L(20, 18);
    addDrums(P, x, heightAt(x, z), z, ry, dress, () => prop(drums, x, z, ry, 1, 1, 'drums', 'metal'));
  }

  // --- Agave fields: curved terraces and straight rows ---
  const plantRows = (cx, cz, kind, opts) => {
    const field = [];
    if (kind === 'arc') {
      const { r0, r1, a0, a1 } = opts;
      for (let r = r0; r <= r1; r += 2.5) {
        const n = Math.floor((r * (a1 - a0)) / 1.7);
        for (let i = 0; i < n; i++) {
          const a = a0 + ((i + 0.5) / n) * (a1 - a0);
          const x = cx + Math.cos(a) * r + (rng() - 0.5) * 0.3;
          const z = cz + Math.sin(a) * r + (rng() - 0.5) * 0.3;
          if (Math.hypot(x, z) < 105 || distToRoutes(routes, x, z) < 7) continue;
          if (foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 1)) continue;
          field.push(x, heightAt(x, z), z, rng() * 6.28, 0.8 + rng() * 0.45);
        }
      }
    } else {
      const { w, d, ry } = opts;
      const L = local(cx, cz, ry);
      for (let lz = -d / 2; lz <= d / 2; lz += 2.6) {
        for (let lx = -w / 2; lx <= w / 2; lx += 1.7) {
          const [x, z] = L(lx + (rng() - 0.5) * 0.3, lz);
          if (Math.hypot(x, z) < 105 || distToRoutes(routes, x, z) < 7) continue;
          if (foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 1)) continue;
          field.push(x, heightAt(x, z), z, rng() * 6.28, 0.8 + rng() * 0.45);
        }
      }
    }
    if (field.length) agave.push(new Float32Array(field));
  };
  for (const [bearing, range, span] of [
    [205, 330, 1.7],
    [140, 340, 1.4],
    [335, 360, 1.2],
  ]) {
    const d = bearingVec(bearing);
    const cx = d.x * (range + 120);
    const cz = d.z * (range + 120);
    // The arcs face back toward the hacienda like an amphitheatre.
    const facing = Math.atan2(-cz, -cx);
    plantRows(cx, cz, 'arc', { r0: 50, r1: 125, a0: facing - span / 2, a1: facing + span / 2 });
    foot.push({ x: d.x * range, z: d.z * range, r: 60 });
  }
  for (const [bearing, range] of [
    [62, 360],
    [278, 370],
    [118, 160],
  ]) {
    const d = bearingVec(bearing);
    const x = d.x * range;
    const z = d.z * range;
    if (blocked(x, z, 30, 0)) continue;
    plantRows(x, z, 'rows', { w: 70, d: 50, ry: rng() * Math.PI });
    foot.push({ x, z, r: 42 });
  }

  // --- Trees: clustered stands everywhere, as in the reference ---
  for (let i = 0; i < 620; i++) {
    let x;
    let z;
    if (i % 3 === 0) {
      const f = foot[1 + Math.floor(rng() * (foot.length - 1))] || foot[0];
      const a = rng() * 6.28;
      const r = f.r + 6 + rng() * 30;
      x = f.x + Math.cos(a) * r;
      z = f.z + Math.sin(a) * r;
    } else {
      const a = rng() * 6.28;
      const r = 100 + Math.sqrt(rng()) * 900;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    if (blocked(x, z, 3, 4)) continue;
    const n = rng() < 0.4 ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const tx = x + (rng() - 0.5) * 10;
      const tz = z + (rng() - 0.5) * 10;
      trees.push({ x: tx, z: tz, yaw: rng() * 6.28, scale: 0.8 + rng() * 0.45, r: rng() });
    }
  }
  // Dense groves, and a belt of trees around the hacienda walls.
  const grove = (gx, gz, n, spread) => {
    for (let k = 0; k < n; k++) {
      const a = rng() * 6.28;
      const r = Math.sqrt(rng()) * spread;
      const tx = gx + Math.cos(a) * r;
      const tz = gz + Math.sin(a) * r;
      if (Math.hypot(tx, tz) < 92 || blocked(tx, tz, 2.5, 4)) continue;
      trees.push({ x: tx, z: tz, yaw: rng() * 6.28, scale: 0.85 + rng() * 0.45, r: rng() });
    }
  };
  for (let i = 0; i < 16; i++) {
    const a = rng() * 6.28;
    const r = 150 + rng() * 650;
    grove(Math.cos(a) * r, Math.sin(a) * r, 14 + Math.floor(rng() * 14), 22 + rng() * 25);
  }
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * 6.28 + rng() * 0.1;
    const r = 100 + rng() * 35;
    grove(Math.cos(a) * r, Math.sin(a) * r, 2 + Math.floor(rng() * 3), 6);
  }
  // Palms along the compound walls outside.
  for (let i = 0; i < 18; i++) {
    const a = rng() * 6.28;
    const r = 80 + rng() * 18;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (blocked(x, z, 1, 4) && Math.hypot(x, z) < 92) continue;
    if (distToRoutes(routes, x, z) < 8) continue;
    palms.push({ x, z, yaw: rng() * 6.28, scale: 1.15 + rng() * 0.45, r: rng() });
  }

  // --- Scrub and rocks ---
  // Scrub grows in loose clumps; World draws it (photoscanned shrubs when available).
  for (let i = 0; i < 950; i++) {
    const a = rng() * 6.28;
    const r = 100 + Math.sqrt(rng()) * 850;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const n = 1 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 7;
      const z = cz + (rng() - 0.5) * 7;
      if (blocked(x, z, 0.5, 3)) continue;
      bushes.push({ x, y: heightAt(x, z), z, yaw: rng() * 6.28, scale: 0.6 + rng() * 0.8, r: rng() });
    }
  }
  for (let i = 0; i < 150; i++) {
    const a = rng() * 6.28;
    const r = 110 + rng() * 800;
    const n = rng() < 0.4 ? 2 + Math.floor(rng() * 3) : 1;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 6;
      const z = cz + (rng() - 0.5) * 6;
      if (blocked(x, z, 2, 4)) continue;
      const size = (k ? 0.6 : 1.1) + rng() * 1.6;
      addRock(P, x, heightAt(x, z), z, size, dress, () => {
        const g = new THREE.DodecahedronGeometry(size * 0.6, 0);
        g.scale(1, 0.55 + dress() * 0.3, 1);
        P.add('rock', part(g, HEAT.rock, COLOR.rock, x, heightAt(x, z), z, 0, dress() * 6, 0), { kind: 'rock' });
      });
    }
  }

  // --- Along the main roads: ranch fences, burnt-out pickups, power lines ---
  const pole = poleGeometry();
  for (const route of routes.filter((r) => r.main)) {
    // Fence runs on alternating sides.
    for (let run = 0; run < 3; run++) {
      const start = 4 + Math.floor(rng() * Math.max(1, route.waypoints.length - 14));
      const side = rng() < 0.5 ? -1 : 1;
      const pts = [];
      for (let k = start; k < Math.min(route.waypoints.length, start + 6); k++) {
        const w = route.waypoints[k];
        pts.push([w.x + w.nx * side * 8, w.z + w.nz * side * 8]);
      }
      if (pts.length > 1) P.addAll(fence(pts, heightAt, rng));
    }
    for (let i = 0; i < 2; i++) {
      const wp = route.waypoints[3 + Math.floor(rng() * Math.max(1, route.waypoints.length - 8))];
      if (!wp) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const x = wp.x + wp.nx * side * (12 + rng() * 4);
      const z = wp.z + wp.nz * side * (12 + rng() * 4);
      const g = vehicles.wreck.clone();
      g.rotateZ((rng() - 0.5) * 0.5);
      P.add(g.userData.bucket || 'plain', placed(g, x, heightAt(x, z) - 0.25, z, rng() * 6.28));
      g.dispose();
    }
    let prev = null;
    for (const p of route.pts) {
      const r = Math.hypot(p.x, p.z);
      if (r < 110 || r > 800) continue;
      if (prev && Math.hypot(p.x - prev.px, p.z - prev.pz) < 50) continue;
      const tx = p.x / r;
      const tz = p.z / r;
      const x = p.x - tz * 13;
      const z = p.z + tx * 13;
      const y = heightAt(x, z);
      const yaw = Math.atan2(tx, tz);
      P.add('wood', placed(pole, x, y, z, yaw));
      const cur = { px: p.x, pz: p.z, x, y: y + 8.6, z, ox: Math.cos(yaw) * 1.1, oz: -Math.sin(yaw) * 1.1 };
      if (prev) {
        for (const s of [-1, 1]) {
          const ax = prev.x + prev.ox * s;
          const az = prev.z + prev.oz * s;
          const bx = cur.x + cur.ox * s;
          const bz = cur.z + cur.oz * s;
          let lx = ax;
          let ly = prev.y;
          let lz = az;
          for (let k = 1; k <= 4; k++) {
            const t = k / 4;
            const nx = ax + (bx - ax) * t;
            const nz = az + (bz - az) * t;
            const ny = prev.y + (cur.y - prev.y) * t - Math.sin(t * Math.PI) * 1.2;
            lines.push(lx, ly, lz, nx, ny, nz);
            lx = nx;
            ly = ny;
            lz = nz;
          }
        }
      }
      prev = cur;
    }
  }
  pole.dispose();
  bale.dispose();
  drums.dispose();

  return { parts: P, colliders, yards, agave, lines, sites, trees, palms, bushes };
}

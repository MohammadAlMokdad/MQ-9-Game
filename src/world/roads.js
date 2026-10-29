// Eight entry routes into the hacienda compound: four roads to the gates, four foot trails on the diagonals.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { heightAt } from './terrain.js';
import { MAP, HEAT, ROUTES, COLOR } from '../config.js';

export const DIR_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

// North is -Z, east is +X.
export function bearingVec(deg) {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

export function sectorOf(x, z) {
  let b = (Math.atan2(x, -z) * 180) / Math.PI;
  if (b < 0) b += 360;
  return Math.round(b / 45) % 8;
}

export function buildRoutes(seed = 7) {
  const rng = mulberry32(seed);
  const routes = [];
  for (let i = 0; i < ROUTES.count; i++) {
    const main = ROUTES.main.includes(i);
    const bearing = i * 45 + (main ? 0 : (rng() - 0.5) * 14);
    const d = bearingVec(bearing);
    const px = -d.z;
    const pz = d.x;
    const radii = main ? [640, MAP.spawnRadius, 330, 240, 160, 105, 74] : [620, MAP.spawnRadius, 340, 260, 190];
    const ctrl = radii.map((r) => {
      const j = r < MAP.spawnRadius && r > 130 ? (rng() - 0.5) * (main ? 70 : 90) : 0;
      return new THREE.Vector3(d.x * r + px * j, 0, d.z * r + pz * j);
    });
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 6));

    // Waypoints start at the spawn radius and carry the local lateral normal for lane offsets.
    const waypoints = [];
    for (let k = 0; k < pts.length; k += 2) {
      const p = pts[k];
      if (Math.hypot(p.x, p.z) > MAP.spawnRadius + 1) continue;
      const a = pts[Math.max(0, k - 1)];
      const b = pts[Math.min(pts.length - 1, k + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      waypoints.push({ x: p.x, z: p.z, nx: -tz, nz: tx });
    }
    routes.push({ id: i, main, bearing, dirName: DIR_NAMES[i], pts, waypoints, width: main ? 7 : 3.5 });
  }
  return routes;
}

// Ribbons draped on the terrain, a little wider than the road so the edges can fray into the
// grass (see roadMaterial). uv in metres: u across the ribbon, v along it. roadW = ribbon width.
const ROAD_MARGIN = 1.6;
export function buildRoadGeometry(routes) {
  const positions = [];
  const colors = [];
  const albedo = [];
  const uvs = [];
  const widths = [];
  for (const route of routes) {
    const w = route.width / 2 + ROAD_MARGIN;
    const heat = route.main ? HEAT.road : HEAT.trail;
    const alb = route.main ? COLOR.road : COLOR.road.map((v) => v * 0.94);
    const L = [];
    const R = [];
    const V = [];
    let dist = 0;
    for (let k = 0; k < route.pts.length; k++) {
      if (k > 0) dist += route.pts[k].distanceTo(route.pts[k - 1]);
      V.push(dist);
      const a = route.pts[Math.max(0, k - 1)];
      const b = route.pts[Math.min(route.pts.length - 1, k + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const p = route.pts[k];
      const lx = p.x - tz * w;
      const lz = p.z + tx * w;
      const rx = p.x + tz * w;
      const rz = p.z - tx * w;
      L.push([lx, heightAt(lx, lz) + 0.2, lz]);
      R.push([rx, heightAt(rx, rz) + 0.2, rz]);
    }
    for (let k = 0; k < L.length - 1; k++) {
      // Counter-clockwise seen from above. uv in meters: u across the road, v along it.
      const W = w * 2;
      const quad = [
        [L[k], 0, V[k]],
        [L[k + 1], 0, V[k + 1]],
        [R[k], W, V[k]],
        [R[k], W, V[k]],
        [L[k + 1], 0, V[k + 1]],
        [R[k + 1], W, V[k + 1]],
      ];
      for (const [v, u, vv] of quad) {
        positions.push(v[0], v[1], v[2]);
        uvs.push(u, vv);
        colors.push(heat, heat, heat);
        albedo.push(alb[0], alb[1], alb[2]);
        widths.push(W);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('albedo', new THREE.Float32BufferAttribute(albedo, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('roadW', new THREE.Float32BufferAttribute(widths, 1));
  g.computeVertexNormals();
  return g;
}

// Shortest distance from a point to any route polyline (used to keep props off the roads).
export function distToRoutes(routes, x, z) {
  let best = Infinity;
  for (const r of routes) {
    for (const p of r.pts) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

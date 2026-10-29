// The defended position: a walled hacienda (as in the reference mission) held by friendly
// troops. Stucco perimeter with rounded corners and four gates, tiled main house with a
// rooftop terrace, guest house, arcaded east wing, courtyard fountain, pool and palms.
import * as THREE from 'three';
import { box, part, placed } from '../render/heat.js';
import { Parts, placeMatrix, haciendaBlock, arcade, fountain, pool, barrels, hipRoof } from './meshes.js';
import { MAP, HEAT, COLOR } from '../config.js';
import { mulberry32 } from '../core/rng.js';
import { LIB, addProp, addDrums } from './props.js';

const H = MAP.fobHalf;
const CORNER = 9; // rounded wall corner radius

export function isInsideCompound(x, z, pad = 2) {
  return Math.abs(x) <= H + pad && Math.abs(z) <= H + pad;
}

// Closest point on the wall perimeter, pushed `out` meters to the outside.
export function nearestWallPoint(x, z, out = 0) {
  let px = Math.max(-H, Math.min(H, x));
  let pz = Math.max(-H, Math.min(H, z));
  if (Math.abs(x) <= H && Math.abs(z) <= H) {
    if (H - Math.abs(x) < H - Math.abs(z)) px = Math.sign(x || 1) * H;
    else pz = Math.sign(z || 1) * H;
  }
  if (Math.abs(px) >= Math.abs(pz)) px += Math.sign(px || 1) * out;
  else pz += Math.sign(pz || 1) * out;
  return { x: px, z: pz };
}

const aabb = (x, y, z, w, h, d) => ({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });

function place(parts, sub, x, z, ry = 0, obj = null) {
  parts.addAll(sub.transform(placeMatrix(x, 0, z, ry)), obj);
}

// One open wrought-iron gate leaf (4.6 m long along z, 2.6 m high): rails and vertical bars.
function gateLeaf() {
  const p = new Parts();
  const iron = [0.12, 0.12, 0.12];
  for (const y of [0.18, 1.3, 2.45]) p.add('metal', box(0.07, 0.09, 4.6, HEAT.metal, iron, 0, y, 0));
  for (const z of [-2.27, 2.27]) p.add('metal', box(0.09, 2.6, 0.09, HEAT.metal, iron, 0, 1.3, z));
  for (let k = 1; k < 22; k++) p.add('metal', box(0.035, 2.3, 0.035, HEAT.metal, iron, 0, 1.3, -2.3 + (4.6 * k) / 22));
  return p;
}

// vehicles: { humvee, truck, car } geometries from render/models.js.
export function buildCompound(vehicles) {
  const rng = mulberry32(99);
  const P = new Parts();
  const colliders = [];
  const WH = 3.2;
  // A destructible building with its shell-blocking collider.
  const solid = (box, kind = 'hacienda') => {
    colliders.push(box);
    return { kind, collider: box };
  };

  // Perimeter wall with tile coping, split around the gates, rounded corners.
  const run = H - CORNER;
  for (const side of [-1, 1]) {
    for (const half of [-1, 1]) {
      const a = MAP.gateHalf;
      const len = run - a;
      const mid = half * (a + len / 2);
      for (const [x, z, w, d] of [
        [mid, side * H, len, 0.6],
        [side * H, mid, 0.6, len],
      ]) {
        P.add('plaster', box(w, WH, d, HEAT.wall, COLOR.stucco, x, WH / 2, z));
        P.add('plain', box(w + 0.2, 0.25, d + 0.2, HEAT.roof, [0.62, 0.36, 0.28], x, WH + 0.12, z));
        colliders.push(aabb(x, 0, z, w, WH, d));
      }
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * run;
      const cz = sz * run;
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * (Math.PI / 2);
        const a1 = ((i + 1) / segs) * (Math.PI / 2);
        const am = (a0 + a1) / 2;
        const len = 2 * CORNER * Math.sin((a1 - a0) / 2) + 0.4;
        const x = cx + sx * Math.cos(am) * CORNER;
        const z = cz + sz * Math.sin(am) * CORNER;
        const yaw = Math.atan2(-sx * Math.sin(am), sz * Math.cos(am));
        P.add('plaster', box(0.6, WH, len, HEAT.wall, COLOR.stucco, x, WH / 2, z, yaw));
        colliders.push(aabb(x, 0, z, 2, WH, 2));
      }
    }
  }
  // Gate pillars and open iron gate leaves.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const ox = Math.sin(a);
    const oz = -Math.cos(a);
    const px = -oz;
    const pz = ox;
    for (const s of [-1, 1]) {
      const x = ox * H + px * s * (MAP.gateHalf + 0.6);
      const z = oz * H + pz * s * (MAP.gateHalf + 0.6);
      P.add('plaster', box(1.3, 4.2, 1.3, HEAT.wall, COLOR.stucco, x, 2.1, z));
      P.add('plain', box(1.6, 0.3, 1.6, HEAT.roof, [0.62, 0.36, 0.28], x, 4.35, z));
      const lx = ox * (H - 2.4) + px * s * (MAP.gateHalf - 0.4);
      const lz = oz * (H - 2.4) + pz * s * (MAP.gateHalf - 0.4);
      P.addAll(gateLeaf().transform(placeMatrix(lx, 0, lz, a + s * 0.5)));
    }
  }

  // Main house: two-storey north wing with an arcade, and a west wing with a rooftop terrace.
  const north = solid(aabb(-20, 0, -42, 35, 10, 14));
  place(P, haciendaBlock(34, 13, 7.5, rng), -20, -42, 0, north);
  place(P, arcade(34, 3.2, 3.2, rng), -20, -35.5, 0, north);
  const west = solid(aabb(-36, 0, -15, 14, 8.5, 29));
  place(P, haciendaBlock(13, 28, 7.5, rng, { terrace: true }), -36, -15, 0, west);
  place(P, arcade(26, 3.2, 3.2, rng), -29.5, -14, Math.PI / 2, west);
  // Guest house with a roof terrace.
  place(P, haciendaBlock(18, 11, 4.4, rng, { floors: 1, terrace: true }), 30, -40, 0, solid(aabb(30, 0, -40, 19, 5.4, 12)));
  // East wing: long single-storey range with an arcade facing the courtyard.
  const east = solid(aabb(54, 0, 8, 11, 7, 43));
  place(P, haciendaBlock(10, 42, 4.6, rng, { floors: 1 }), 54, 8, 0, east);
  place(P, arcade(40, 3.0, 3.0, rng), 49, 8, -Math.PI / 2, east);
  // Servants' quarters and garage along the south wall.
  place(P, haciendaBlock(22, 8, 4.0, rng, { floors: 1, wall: 'clay' }), -14, 56, 0, solid(aabb(-14, 0, 56, 23, 6, 9), 'house'));
  place(P, haciendaBlock(16, 11, 4.4, rng, { floors: 1 }), -46, 52, 0, solid(aabb(-46, 0, 52, 17, 6.5, 12), 'house'));

  // Courtyard garden: four lawns around a circular path, the fountain in a paved circle,
  // cross paths, hedges, paths out to the gates, palms and shade trees.
  const LAWN = [0.44, 0.52, 0.36];
  const lowOccluders = [];
  for (const [x, z] of [
    [-6, -13],
    [22, -13],
    [-6, 17],
    [22, 17],
  ]) {
    P.add('lawn', box(24, 0.1, 22, HEAT.lawn, LAWN, x, 0.05, z));
    // Clipped hedge border with gaps at the corners.
    for (const s2 of [-1, 1]) {
      P.add('hedge', box(18, 0.95, 0.75, HEAT.bush, COLOR.hedge, x, 0.47, z + s2 * 10.6));
      P.add('hedge', box(0.75, 0.95, 16, HEAT.bush, COLOR.hedge, x + s2 * 11.6, 0.47, z));
      lowOccluders.push({ x, z: z + s2 * 10.6, w: 18, d: 0.75, ry: 0, h: 0.95 }, { x: x + s2 * 11.6, z, w: 0.75, d: 16, ry: 0, h: 0.95 });
    }
  }
  const ring = new THREE.RingGeometry(15, 18, 40);
  ring.rotateX(-Math.PI / 2);
  P.add('paver', part(ring, HEAT.roofFlat, COLOR.paver, 8, 0.13, 2));
  P.add('paver', box(54, 0.12, 4, HEAT.roofFlat, COLOR.paver, 8, 0.11, 2));
  P.add('paver', box(4, 0.12, 46, HEAT.roofFlat, COLOR.paver, 8, 0.11, 2));
  place(P, fountain(), 8, 2, 0, { kind: 'fountain' });
  for (const [x, z, w, d] of [
    [0, -55, 6, 26],
    [0, 45, 6, 46],
    [-52, 0, 34, 6],
    [48, -12, 30, 5],
  ]) {
    P.add('paver', box(w, 0.12, d, HEAT.roofFlat, COLOR.paverDark, x, 0.06, z));
  }
  place(P, pool(18, 8), 26, 44);
  // Pergola along the pool.
  for (let i = 0; i <= 5; i++) P.add('wood', box(0.3, 2.8, 0.3, HEAT.wood, COLOR.wood, 17 + i * 3.6, 1.4, 51));
  for (let i = 0; i <= 12; i++) P.add('wood', box(0.2, 0.2, 3.4, HEAT.wood, COLOR.woodDark, 17 + i * 1.5, 2.9, 52.5));

  // More buildings: a small chapel by the south-east corner and a storehouse in the north-west.
  const chapel = solid(aabb(50, 0, 52, 10, 9, 16), 'house');
  place(P, haciendaBlock(9, 15, 6.5, rng, { floors: 1 }), 50, 52, 0, chapel);
  const belfry = solid(aabb(50, 0, 43, 3.6, 13, 3.6), 'tower');
  P.add('plaster', box(3.4, 11, 3.4, HEAT.wall, COLOR.stucco, 50, 5.5, 43), belfry);
  P.add('tile', hipRoof(3.6, 3.6, 2, 0.3, HEAT.roof, COLOR.tile).translate(50, 11, 43), belfry);
  place(P, haciendaBlock(12, 10, 4.2, rng, { floors: 1, wall: 'clay' }), -56, -40, 0, solid(aabb(-56, 0, -40, 13, 6.5, 11), 'house'));

  // Palms line the garden and the walls; broadleaf shade trees in the corners.
  const palmSpots = [
    [-16, -14], [32, -14], [-16, 18], [32, 18], [8, -18], [8, 22], [-22, 2], [38, 2],
    [-8, -2], [24, -2], [-8, 6], [24, 6], [14, 38], [40, 38], [-60, -60], [60, -60],
    [60, 64], [-60, 60], [-55, 30], [-55, -24], [-62, 10], [62, -45], [36, 62], [-30, 64],
    [-4, -28], [20, -28], [30, 32], [-12, 32],
  ];
  const palms = palmSpots.map(([x, z]) => ({ x, z, yaw: rng() * 6.28, scale: 1.1 + rng() * 0.35, r: rng() }));
  const trees = [[-55, 15], [62, -30], [-25, 40], [42, 60], [-62, -8], [8, 60], [-40, 40], [62, 40]].map(([x, z]) => ({ x, z, yaw: rng() * 6.28, scale: 0.9 + rng() * 0.25, r: rng() }));

  // Our vehicles inside the walls, a generator, fuel drums.
  // Textured (realistic) vehicle models carry their own material bucket.
  const vb = (g) => g.userData.bucket || 'plain';
  for (let i = 0; i < 3; i++) P.add(vb(vehicles.humvee), placed(vehicles.humvee, 14 + i * 4.8, 0, -56, Math.PI, 1, 0.9 + 0.3 * rng()), { kind: 'vehicle' });
  P.add(vb(vehicles.truck), placed(vehicles.truck, -46, 0, 38, Math.PI / 2, 1, 0.7), { kind: 'vehicle' });
  P.add(vb(vehicles.car), placed(vehicles.car, -30, 0, 46, 0.3, 1, 0.8), { kind: 'vehicle' });
  P.add('metal', box(1.6, 1.4, 2.4, HEAT.generator, [0.36, 0.42, 0.3], -56, 0.7, 44), { kind: 'drums' });
  const dress = mulberry32(31);
  addDrums(P, -60, 0, 40, 0, dress, () => {
    const drums = barrels(6, rng);
    P.add('metal', placed(drums, -60, 0, 40), { kind: 'drums' });
    drums.dispose();
  });
  // Crates by the garage, and concrete barriers forming a checkpoint chicane outside each gate.
  if (LIB.crate) for (let i = 0; i < 6; i++) addProp(P, 'crate', -40 + (i % 3) * 1.1, i >= 3 ? 0.62 : 0, 44 + (i >= 3 ? 0.2 : 0), (dress() - 0.5) * 0.2, 1, { kind: 'prop' });
  if (LIB.covered_car) addProp(P, 'covered_car', -24, 0, 50, 0.15, 1, { kind: 'vehicle' });
  if (LIB.road_barrier) {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const ox = Math.sin(a);
      const oz = -Math.cos(a);
      for (const [d, side] of [[12, -1], [19, 1]]) {
        const x = ox * (H + d) - oz * side * 2.6;
        const z = oz * (H + d) + ox * side * 2.6;
        addProp(P, 'road_barrier', x, 0, z, a + Math.PI / 2, 1, { kind: 'rock' });
      }
    }
  }

  // Friendly firing positions: rooftop terraces, the gates, the courtyard.
  const posts = [
    { x: -40.5, y: 7.8, z: -27 },
    { x: -31.5, y: 7.8, z: -27 },
    { x: -40.5, y: 7.8, z: -3 },
    { x: -31.5, y: 7.8, z: -3 },
    { x: 23, y: 4.7, z: -43.5 },
    { x: 37, y: 4.7, z: -43.5 },
  ];
  for (const s of [-1, 1]) {
    for (const g of [-8, 8]) {
      posts.push({ x: g, y: 0, z: s * (H - 2.2) });
      posts.push({ x: s * (H - 2.2), y: 0, z: g });
    }
  }
  posts.push({ x: 44, y: 0, z: -2 }, { x: -24, y: 0, z: 8 });

  // Patrol loop around the plaza, clear of the buildings and arcades.
  const loop = [
    { x: -24, z: -24 },
    { x: 40, z: -24 },
    { x: 40, z: 30 },
    { x: -24, z: 30 },
  ];
  const patrols = [0, 1, 2, 3].map((i) => ({ loop, start: i }));

  const fireSpots = [
    { x: -20, y: 9, z: -42 },
    { x: 54, y: 5.5, z: 8 },
    { x: 30, y: 5, z: -40 },
  ];

  return { parts: P, colliders, posts, patrols, fireSpots, trees, palms, lowOccluders };
}

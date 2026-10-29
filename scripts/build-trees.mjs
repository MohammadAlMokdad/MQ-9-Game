// Builds the game's vegetation asset (public/assets/trees/trees.json + trees.bin) from two
// Sketchfab downloads (both CC-BY-4.0; see CREDITS.md):
//   realistic_trees_collection/  "Realistic Trees Collection" by Jungle Jim  -> 7 broadleaf trees
//   date_palm/                   "Date Palm" by evolveduk                    -> 1 date palm
//
// Every variant gets three levels of detail, each a list of parts (one draw per part):
//   Trees  LOD0 most of the bark + dense leaf cards; LOD1 trunk and main limbs + thinned,
//          enlarged cards; LOD2 trunk + a sparse set of large cards that still read as a crown.
//          Branch triangles are ranked by area (thin twigs go first); leaf cards are thinned at
//          random, the survivors grown, and their normals bent outward so crowns shade as a mass.
//   Palm   LOD0 the full model; LOD1 drops the scaly leaf bases; LOD2 also drops the frond stems
//          and keeps every other frond.
//
// Textures were converted once to resized WebP next to the output (bark, leaves_*, palm_*).
// Usage: npm run build:trees
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/assets/trees/';

// ---- shared helpers ----

function loader(dir) {
  const gltf = JSON.parse(readFileSync(dir + 'scene.gltf', 'utf8'));
  const bin = readFileSync(dir + 'scene.bin');
  const view = new DataView(bin.buffer, bin.byteOffset);
  const accessor = (i) => {
    const a = gltf.accessors[i];
    const bv = gltf.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const C = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const stride = bv.byteStride || n * C.BYTES_PER_ELEMENT;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new (C === Float32Array ? Float32Array : Uint32Array)(a.count * n);
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < n; c++) {
        const o = base + k * stride + c * C.BYTES_PER_ELEMENT;
        out[k * n + c] = C === Float32Array ? view.getFloat32(o, true) : C === Uint32Array ? view.getUint32(o, true) : C === Uint16Array ? view.getUint16(o, true) : view.getUint8(o);
      }
    }
    return out;
  };
  const primitives = (meshIndex) =>
    gltf.meshes[meshIndex].primitives.map((p) => ({
      material: gltf.materials[p.material].name,
      pos: accessor(p.attributes.POSITION),
      nrm: accessor(p.attributes.NORMAL),
      uv: accessor(p.attributes.TEXCOORD_0),
      idx: p.indices !== undefined ? accessor(p.indices) : null,
    }));
  return { gltf, primitives };
}

// Expands an indexed primitive into a flat list of triangles: [{ p: [9], n: [9], t: [6] }].
function triangles(prim) {
  const tris = [];
  const count = prim.idx ? prim.idx.length : prim.pos.length / 3;
  for (let i = 0; i < count; i += 3) {
    const tri = { p: [], n: [], t: [] };
    for (let k = 0; k < 3; k++) {
      const v = prim.idx ? prim.idx[i + k] : i + k;
      tri.p.push(prim.pos[v * 3], prim.pos[v * 3 + 1], prim.pos[v * 3 + 2]);
      tri.n.push(prim.nrm[v * 3], prim.nrm[v * 3 + 1], prim.nrm[v * 3 + 2]);
      tri.t.push(prim.uv[v * 2], prim.uv[v * 2 + 1]);
    }
    tris.push(tri);
  }
  return tris;
}

const area = (p) => {
  const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
  const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
};

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Groups triangles into connected pieces (vertices welded by position).
function pieces(tris) {
  const parent = tris.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 9; k += 3) {
      const key = `${t.p[k].toFixed(3)},${t.p[k + 1].toFixed(3)},${t.p[k + 2].toFixed(3)}`;
      if (owner.has(key)) parent[find(i)] = find(owner.get(key));
      else owner.set(key, i);
    }
  });
  const groups = new Map();
  tris.forEach((t, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  });
  return [...groups.values()];
}

// Leaf cards: two triangles sharing an edge form one card; anything unpaired stays single.
function cards(tris) {
  const out = [];
  const same = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) < 1e-3;
  for (let i = 0; i < tris.length; i++) {
    const a = tris[i];
    const b = tris[i + 1];
    if (b) {
      let shared = 0;
      for (let x = 0; x < 9; x += 3) for (let y = 0; y < 9; y += 3) if (same(a.p, x, b.p, y)) shared++;
      if (shared >= 2) {
        out.push([a, b]);
        i++;
        continue;
      }
    }
    out.push([a]);
  }
  return out;
}

const chunks = [];
let offset = 0;
function push(arr) {
  const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(bytes);
  const at = offset;
  offset += bytes.length;
  return [at, arr.length];
}

// Packs triangles into compact indexed geometry (positions welded by exact match).
function packIndexed(mat, tris, xf) {
  const map = new Map();
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const key = `${t.p[k * 3]},${t.p[k * 3 + 1]},${t.p[k * 3 + 2]},${t.t[k * 2]},${t.t[k * 2 + 1]}`;
      let v = map.get(key);
      if (v === undefined) {
        v = pos.length / 3;
        map.set(key, v);
        const [x, y, z] = xf(t.p[k * 3], t.p[k * 3 + 1], t.p[k * 3 + 2]);
        pos.push(x, y, z);
        nrm.push(t.n[k * 3], t.n[k * 3 + 1], t.n[k * 3 + 2]);
        uv.push(t.t[k * 2], t.t[k * 2 + 1]);
      }
      idx.push(v);
    }
  }
  return { mat, tris: tris.length, pos: push(new Float32Array(pos)), nrm: push(new Float32Array(nrm)), uv: push(new Float32Array(uv)), idx: push(new Uint32Array(idx)) };
}

// Base of the trunk (centre of its lowest vertices), height, and a transform to metres with the
// base at the origin.
function frame(trunkTris, allTris, scale) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of trunkTris) for (let k = 1; k < 9; k += 3) minY = Math.min(minY, t.p[k]);
  for (const t of allTris) for (let k = 1; k < 9; k += 3) maxY = Math.max(maxY, t.p[k]);
  let bx = 0;
  let bz = 0;
  let bn = 0;
  for (const t of trunkTris) {
    for (let k = 0; k < 9; k += 3) {
      if (t.p[k + 1] < minY + (maxY - minY) * 0.02) {
        bx += t.p[k];
        bz += t.p[k + 2];
        bn++;
      }
    }
  }
  bx /= bn;
  bz /= bn;
  let radius = 0;
  for (const t of allTris) for (let k = 0; k < 9; k += 3) radius = Math.max(radius, Math.hypot(t.p[k] - bx, t.p[k + 2] - bz) * scale);
  return { minY, maxY, bx, bz, radius, height: (maxY - minY) * scale, xf: (x, y, z) => [(x - bx) * scale, (y - minY) * scale, (z - bz) * scale] };
}

const variants = [];
const report = (v) =>
  console.log(`${(v.group + ' ' + v.name).padEnd(30)} h=${v.height.toFixed(1)}m r=${v.radius.toFixed(1)}m  ` + v.lods.map((l, i) => `LOD${i} ${l.parts.reduce((s, p) => s + p.tris, 0)}`).join('  '));

// ---- broadleaf trees ----

{
  const SCALE = 0.00105; // source units -> metres
  const LOD = [
    { bark: 2600, leaves: 4200, grow: 1.5 },
    { bark: 520, leaves: 1500, grow: 2.4 },
    { bark: 120, leaves: 520, grow: 3.4 },
  ];
  // Leaf material -> texture file (the download repeats three images under several names).
  const LEAF_TEX = { leaves: 'leaves_a', 'leaves.001': 'leaves_a', 'leaves.002': 'leaves_a', 'leaves.006': 'leaves_b', 'leaves.009': 'leaves_c', 'leaves.010': 'leaves_c', 'leaves.011': 'leaves_c' };
  const { gltf, primitives } = loader('realistic_trees_collection/');
  for (const node of gltf.nodes) {
    if (!node.name || !node.name.startsWith('Tree EZTree') || !node.children) continue;
    const prims = node.children.flatMap((c) => (gltf.nodes[c].mesh !== undefined ? primitives(gltf.nodes[c].mesh) : []));
    const bark = prims.filter((p) => !p.material.startsWith('leaves'));
    const leaves = prims.filter((p) => p.material.startsWith('leaves'));
    const barkTris = bark.flatMap(triangles);
    const leafTris = leaves.flatMap(triangles);
    const F = frame(barkTris, [...barkTris, ...leafTris], SCALE);
    const leafMat = LEAF_TEX[leaves[0].material] || 'leaves_a';

    // Canopy centre, for outward leaf normals.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const t of leafTris) {
      cx += t.p[0];
      cy += t.p[1];
      cz += t.p[2];
    }
    cx /= leafTris.length;
    cy /= leafTris.length;
    cz /= leafTris.length;

    const leafCards = cards(leafTris);
    const barkByArea = [...barkTris].sort((a, b) => area(b.p) - area(a.p));
    const lods = LOD.map((spec, li) => {
      const keptBark = barkByArea.slice(0, Math.min(barkByArea.length, spec.bark));
      const rng = rngFrom(1234 + li * 77 + variants.length * 13);
      const f = Math.min(1, spec.leaves / 2 / leafCards.length);
      const grow = Math.min(spec.grow, 1 / Math.sqrt(f));
      const pos = [];
      const nrm = [];
      const uv = [];
      for (const card of leafCards) {
        if (rng() > f) continue;
        let mx = 0;
        let my = 0;
        let mz = 0;
        let mn = 0;
        for (const t of card) {
          for (let k = 0; k < 9; k += 3) {
            mx += t.p[k];
            my += t.p[k + 1];
            mz += t.p[k + 2];
            mn++;
          }
        }
        mx /= mn;
        my /= mn;
        mz /= mn;
        let ox = mx - cx;
        let oy = my - cy + (F.maxY - F.minY) * 0.15;
        let oz = mz - cz;
        const ol = Math.hypot(ox, oy, oz) || 1;
        ox /= ol;
        oy /= ol;
        oz /= ol;
        for (const t of card) {
          for (let k = 0; k < 3; k++) {
            pos.push(...F.xf(mx + (t.p[k * 3] - mx) * grow, my + (t.p[k * 3 + 1] - my) * grow, mz + (t.p[k * 3 + 2] - mz) * grow));
            nrm.push(ox, oy, oz);
            uv.push(t.t[k * 2], t.t[k * 2 + 1]);
          }
        }
      }
      return {
        parts: [
          packIndexed('bark', keptBark, F.xf),
          { mat: leafMat, tris: pos.length / 9, pos: push(new Float32Array(pos)), nrm: push(new Float32Array(nrm)), uv: push(new Float32Array(uv)) },
        ],
      };
    });
    const v = { group: 'tree', name: node.name.replace('Tree ', ''), height: +F.height.toFixed(2), radius: +F.radius.toFixed(2), lods };
    variants.push(v);
    report(v);
  }
}

// ---- date palm ----

{
  const SCALE = 0.01; // centimetres -> metres
  const MAT = { Tree_0Mat: 'palm_trunk', Tree_1Mat: 'palm_fronds', Tree_2Mat: 'palm_boots', Tree_3Mat: 'palm_stems' };
  const { gltf, primitives } = loader('date_palm/');
  const prims = gltf.meshes.flatMap((_, i) => primitives(i));
  const byMat = {};
  for (const p of prims) (byMat[MAT[p.material]] ||= []).push(...triangles(p));
  const all = Object.values(byMat).flat();
  const F = frame(byMat.palm_trunk, all, SCALE);

  // The source fronds face downward (most normals point at the ground), so from the gunship's
  // view the crowns came out lit from behind. Turn every frond triangle to face up and give it
  // a smooth outward-and-up normal from the crown centre, like the broadleaf leaf cards.
  {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const t of byMat.palm_fronds) {
      for (let k = 0; k < 9; k += 3) {
        cx += t.p[k];
        cy += t.p[k + 1];
        cz += t.p[k + 2];
        n++;
      }
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const span = F.maxY - F.minY;
    for (const t of byMat.palm_fronds) {
      const p = t.p;
      const ny = (p[5] - p[2]) * (p[6] - p[0]) - (p[3] - p[0]) * (p[8] - p[2]); // y of (b-a) x (c-a)
      if (ny < 0) {
        for (const [arr, w] of [[t.p, 3], [t.n, 3], [t.t, 2]]) {
          for (let c = 0; c < w; c++) [arr[w + c], arr[2 * w + c]] = [arr[2 * w + c], arr[w + c]];
        }
      }
      for (let k = 0; k < 3; k++) {
        let ox = (p[k * 3] - cx) * 0.6;
        let oy = p[k * 3 + 1] - cy + span * 0.35;
        let oz = (p[k * 3 + 2] - cz) * 0.6;
        const l = Math.hypot(ox, oy, oz) || 1;
        t.n[k * 3] = ox / l;
        t.n[k * 3 + 1] = oy / l;
        t.n[k * 3 + 2] = oz / l;
      }
    }
  }

  // Every other frond for the far LOD, chosen evenly around the crown.
  const fronds = pieces(byMat.palm_fronds)
    .map((tris) => {
      let x = 0;
      let z = 0;
      for (const t of tris) {
        x += t.p[0] - F.bx;
        z += t.p[2] - F.bz;
      }
      return { tris, angle: Math.atan2(z, x) };
    })
    .sort((a, b) => a.angle - b.angle);
  const halfFronds = fronds.filter((_, i) => i % 2 === 0).flatMap((f) => f.tris);

  const lods = [
    { parts: ['palm_trunk', 'palm_boots', 'palm_stems', 'palm_fronds'].map((m) => packIndexed(m, byMat[m], F.xf)) },
    { parts: ['palm_trunk', 'palm_stems', 'palm_fronds'].map((m) => packIndexed(m, byMat[m], F.xf)) },
    { parts: [packIndexed('palm_trunk', byMat.palm_trunk, F.xf), packIndexed('palm_fronds', halfFronds, F.xf)] },
  ];
  const v = { group: 'palm', name: 'DatePalm', height: +F.height.toFixed(2), radius: +F.radius.toFixed(2), fronds: fronds.length, lods };
  variants.push(v);
  report(v);
}

// Materials: texture, kind (bark = opaque, leaves = alpha-tested cards, stems = opaque two-sided),
// heat key from config HEAT, daylight grade.
const materials = {
  bark: { tex: 'bark', kind: 'bark', heat: 'trunk', day: [0.78, 0.74, 0.7] },
  leaves_a: { tex: 'leaves_a', kind: 'leaves', heat: 'tree', day: [0.78, 0.82, 0.7] },
  leaves_b: { tex: 'leaves_b', kind: 'leaves', heat: 'tree', day: [0.78, 0.82, 0.7] },
  leaves_c: { tex: 'leaves_c', kind: 'leaves', heat: 'tree', day: [0.78, 0.82, 0.7] },
  palm_trunk: { tex: 'palm_trunk', kind: 'bark', heat: 'trunk', day: [0.8, 0.76, 0.7] },
  palm_boots: { tex: 'palm_boots', kind: 'bark', heat: 'trunk', day: [0.8, 0.76, 0.7] },
  palm_stems: { tex: 'palm_stems', kind: 'stems', heat: 'palm', day: [0.82, 0.84, 0.72] },
  palm_fronds: { tex: 'palm_fronds', kind: 'leaves', alphaTest: 0.3, heat: 'palm', day: [0.92, 0.96, 0.8] },
};

writeFileSync(OUT + 'trees.bin', Buffer.concat(chunks));
writeFileSync(OUT + 'trees.json', JSON.stringify({ materials, variants }, null, 1));
console.log(`wrote ${OUT}trees.bin (${(offset / 1024).toFixed(0)} KB) and trees.json`);

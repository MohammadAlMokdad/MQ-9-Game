// Photoscanned props (Poly Haven, CC0; converted by scripts/blender/convert_prop.py): boulders,
// shrubs, oil drums, rooftop air conditioners, a covered car, road barriers and crates.
//
// propGroups() turns a prop GLB into sensor-aware geometry, one group per material, with the
// attributes the world materials expect (heat as vertex colour, albedo, uv). The map builders
// place copies into material buckets (merged with the static world, destructible) through LIB;
// shrubs are drawn by InstancedProps instead, in tiles that the camera can cull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../render/heat.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Filled by World before the map is built: name -> { groups, size } (see propGroups).
export const LIB = {};

function imageMean(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      n++;
    }
    return n ? sum / n : 0.5;
  } catch {
    return 0.5;
  }
}

// The sensor shaders convert sRGB to linear themselves, so model textures are sampled raw.
function rawTexture(tex) {
  if (!tex) return null;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.mean ??= tex.image ? imageMean(tex.image) : 0.5;
  return tex;
}

// One group per material: { geometry (non-indexed: position, normal, uv, color = heat, albedo),
// map, normalMap, alphaTest, rough, metal }. size = the model's bounding box size (m).
export function propGroups(gltf, heat) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const base = mat?.map ? [1, 1, 1] : mat?.color ? [mat.color.r, mat.color.g, mat.color.b].map((v) => Math.pow(v, 1 / 2.2)) : [0.6, 0.6, 0.6];
    const alb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) alb.set(base, i * 3);
    g.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(heat), 3));
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  });
  const groups = [];
  const box = new THREE.Box3();
  for (const [mat, list] of byMat) {
    const geometry = list.length > 1 ? mergeGeometries(list, false) : list[0];
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    groups.push({
      geometry,
      map: rawTexture(mat?.map || null),
      normalMap: mat?.normalMap || null,
      alphaTest: mat?.alphaTest || (mat?.transparent ? 0.5 : 0),
      rough: mat?.roughness ?? 0.85,
      metal: mat?.metalness ?? 0,
    });
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  return { groups, size };
}

// Bucket names and world materials for a library prop placed into the merged static world.
export function propBuckets(name) {
  return LIB[name].groups.map((_, i) => `prop_${name}_${i}`);
}

export function propMaterials() {
  const mats = {};
  for (const [name, prop] of Object.entries(LIB)) {
    if (prop.instanced) continue;
    prop.groups.forEach((g, i) => {
      mats[`prop_${name}_${i}`] = surfaceMaterial({
        name: `prop_${name}_${i}`,
        tex: g.map,
        nor: g.normalMap,
        norFlipY: true,
        uv: true,
        raw: !!g.map,
        scale: 1,
        texAmt: 1,
        detailAmt: 0.12,
        rough: Math.max(0.35, g.rough),
        metal: g.metal,
        env: 0.9,
        grime: 0.2,
        aoH: true,
      });
    });
  }
  return mats;
}

// Adds a placed, transformed copy of library prop `name` to a Parts collection.
// heatMul scales its thermal heat (warm engine, hot drum...); tint multiplies its albedo.
export function addProp(P, name, x, y, z, ry = 0, s = 1, obj = null, heatMul = 1, tint = null) {
  const buckets = propBuckets(name);
  _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, ry), _s.set(s, s, s));
  LIB[name].groups.forEach((g, i) => {
    const c = g.geometry.clone().applyMatrix4(_m);
    if (heatMul !== 1) {
      const a = c.attributes.color.array;
      for (let k = 0; k < a.length; k++) a[k] *= heatMul;
    }
    if (tint) {
      const a = c.attributes.albedo.array;
      for (let k = 0; k < a.length; k++) a[k] *= tint[k % 3];
    }
    P.add(buckets[i], c, obj);
  });
}

const BOULDERS = ['boulder_a', 'boulder_b', 'boulder_c', 'boulder_d'];

// A boulder (photoscanned when available) roughly `size` metres across, destructible.
export function addRock(P, x, y, z, size, rng, fallback) {
  const have = BOULDERS.filter((n) => LIB[n]);
  if (!have.length) return fallback();
  const name = have[Math.floor(rng() * have.length)];
  const sz = LIB[name].size;
  const s = size / Math.max(sz.x, sz.z, 0.1);
  addProp(P, name, x, y - 0.12 * s * sz.y, z, rng() * Math.PI * 2, s, { kind: 'rock' });
  return true;
}

// A cluster of six oil drums, red and blue, standing at (x, z) on height y.
export function addDrums(P, x, y, z, ry, rng, fallback) {
  const kinds = ['barrel_red', 'barrel_blue'].filter((n) => LIB[n]);
  if (!kinds.length) return fallback();
  const obj = { kind: 'drums' };
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  for (let i = 0; i < 6; i++) {
    const lx = (i % 3) * 0.68 + (rng() - 0.5) * 0.06;
    const lz = Math.floor(i / 3) * 0.68 + (rng() - 0.5) * 0.06;
    const name = kinds[Math.floor(rng() * kinds.length)];
    const sz = LIB[name].size;
    addProp(P, name, x + lx * c + lz * s, y, z - lx * s + lz * c, rng() * Math.PI * 2, 0.88 / Math.max(sz.y, 0.1), obj, 1.1);
  }
  return true;
}

// Instanced copies of several prop variants, grouped into map tiles so whole tiles are culled
// off-screen. materialFor(group) supplies each material.
export class InstancedProps {
  constructor(scene, variants, materialFor, tile = 250, castShadow = true) {
    this.castShadow = castShadow;
    this.scene = scene;
    this.variants = variants; // [{ groups }]
    this.materialFor = materialFor;
    this.tile = tile;
    this.items = new Map(); // tileKey|variant -> [matrix arrays]
    this.meshes = [];
  }

  add(variant, x, y, z, yaw, scale) {
    const key = `${Math.floor(x / this.tile)}|${Math.floor(z / this.tile)}|${variant}`;
    if (!this.items.has(key)) this.items.set(key, []);
    _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(scale, scale, scale));
    this.items.get(key).push(_m.clone());
  }

  build() {
    const mats = this.variants.map((v) => v.groups.map((g) => this.materialFor(g)));
    for (const [key, list] of this.items) {
      const vi = Number(key.split('|')[2]);
      this.variants[vi].groups.forEach((g, gi) => {
        const mesh = new THREE.InstancedMesh(g.geometry, mats[vi][gi].mat, list.length);
        list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
        mesh.computeBoundingSphere();
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = true;
        if (mats[vi][gi].depth) mesh.customDepthMaterial = mats[vi][gi].depth;
        this.scene.add(mesh);
        this.meshes.push(mesh);
      });
    }
  }
}

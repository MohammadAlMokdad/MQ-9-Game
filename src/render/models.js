// Turns the loaded glTF models into geometry the instanced renderers can use, carrying both a
// daylight color (albedo, sampled from the model's materials/textures) and a thermal heat value.
// The animated soldier is baked into one static geometry per animation frame, so hundreds of
// soldiers render as a few dozen instanced draws instead of hundreds of skinned meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, merge } from './heat.js';
import { HEAT } from '../config.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

// Clip name in the glTF -> frames to bake, loop or play once, include the rifle.
export const SOLDIER_CLIPS = {
  run: { clip: 'Run', frames: 16, loop: true, rifle: true },
  walk: { clip: 'Walk', frames: 16, loop: true, rifle: true },
  idle: { clip: 'Idle_Gun', frames: 10, loop: true, rifle: true },
  shoot: { clip: 'Idle_Gun_Shoot', frames: 8, loop: true, rifle: true },
  death: { clip: 'Death', frames: 16, loop: false, rifle: false },
  hit: { clip: 'HitRecieve', frames: 6, loop: false, rifle: false },
};

// Thermal signature by material: exposed skin is hottest, the visor is cold glass.
const SOLDIER_HEAT = { Skin: 1.65, Swat: 1.3, Swat_Black: 1.05, Visor: 0.4 };

const toDisplay = (c) => [c.r, c.g, c.b].map((v) => Math.pow(Math.max(0, v), 1 / 2.2));

// Clothing takes each soldier's own colour (see Units); skin, boots and kit keep the model's.
const SOLDIER_PAINT = { Swat: 0.5 };
// For a textured character (e.g. Mixamo), everything not skinned mainly to these bones counts as
// clothing: it keeps its light/dark detail but takes the soldier's colour, so friend and foe can
// still be told apart on the daylight camera.
const SKIN_BONES = /head|neck|hand|thumb|index|middle|ring|pinky/i;

function withPaint(g, value = 0) {
  g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(value), 1));
  return g;
}

// Multiplies the painted parts of a vehicle geometry by a colour and drops the paint mask, for
// parked vehicles merged into the static world.
export function bakePaint(geom, tint) {
  const a = geom.attributes.albedo.array;
  const m = geom.attributes.paint?.array;
  if (m) {
    for (let i = 0; i < m.length; i++) {
      for (let k = 0; k < 3; k++) a[i * 3 + k] *= 1 + (tint[k] - 1) * m[i];
    }
    geom.deleteAttribute('paint');
  }
  return geom;
}

function rifleGeometry() {
  const gun = [0.16, 0.15, 0.14];
  return merge([
    box(0.07, 0.1, 0.62, HEAT.metal * 1.1, gun, 0, 0, 0.05),
    box(0.05, 0.05, 0.36, HEAT.metal, gun, 0, 0.02, 0.52),
    box(0.06, 0.2, 0.08, HEAT.metal, gun, 0, -0.13, 0.08),
    box(0.06, 0.12, 0.26, HEAT.metal * 0.9, gun, 0, -0.03, -0.36),
  ]);
}

function sequentialIndex(n) {
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return new THREE.BufferAttribute(idx, 1);
}

export function bakeSoldier(gltf) {
  const root = gltf.scene;
  const mixer = new THREE.AnimationMixer(root);
  const skinned = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o);
  });
  // Bundled model bones, or a Mixamo rig (converted by scripts/blender/convert_mixamo.py).
  const chest = root.getObjectByName('Chest') || root.getObjectByName('mixamorigSpine2') || root.getObjectByName('mixamorig:Spine2');
  // The bundled stylised model has an oversized head; scale it toward real proportions.
  const head = root.getObjectByName('Swat_Head') ? root.getObjectByName('Head') : null;
  const rifle = withPaint(rifleGeometry());
  const out = {};
  let floor = null;

  for (const [key, spec] of Object.entries(SOLDIER_CLIPS)) {
    const clip = gltf.animations.find((a) => a.name.split('|').pop() === spec.clip);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    const frames = [];
    for (let f = 0; f < spec.frames; f++) {
      const t = spec.loop ? (f / spec.frames) * clip.duration : (f / (spec.frames - 1)) * clip.duration * 0.999;
      if (head) head.scale.set(1, 1, 1);
      mixer.setTime(t);
      if (head) head.scale.multiplyScalar(0.8);
      root.updateMatrixWorld(true);
      const parts = skinned.map((mesh) => skinnedToGeometry(mesh));
      if (spec.rifle && chest) {
        // Rifle carried across the chest, pointing forward and slightly down.
        chest.getWorldPosition(_v);
        _q.setFromEuler(new THREE.Euler(0.28, -0.25, 0));
        _m.compose(_v.clone().add(new THREE.Vector3(-0.1, -0.08, 0.3)), _q, new THREE.Vector3(1, 1, 1));
        const r = rifle.clone().applyMatrix4(_m);
        r.setIndex(sequentialIndex(r.attributes.position.count));
        parts.push(r);
      }
      const g = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      frames.push(g);
    }
    out[key] = { frames, duration: clip.duration, loop: spec.loop };
    if (key === 'idle') {
      frames[0].computeBoundingBox();
      floor = frames[0].boundingBox.min.y;
    }
  }
  // Stand everyone on y = 0.
  for (const anim of Object.values(out)) for (const g of anim.frames) g.translate(0, -floor, 0);
  rifle.dispose();
  return out;
}

function skinnedToGeometry(mesh) {
  const src = mesh.geometry;
  const n = src.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const heat = new Float32Array(n * 3);
  const alb = new Float32Array(n * 3);
  const h0 = SOLDIER_HEAT[mesh.material.name] ?? 1.2;
  const paintBase = SOLDIER_PAINT[mesh.material.name];
  const [cr, cg, cb] = paintBase ? [paintBase, paintBase, paintBase] : toDisplay(mesh.material.color);
  // A textured character (e.g. from Mixamo) samples its texture per vertex.
  const px = !paintBase && mesh.material.map?.image ? texturePixels(mesh.material.map) : null;
  const uv = src.attributes.uv;
  const msk = new Float32Array(n).fill(paintBase ? 1 : 0);
  const bones = mesh.skeleton?.bones || [];
  const si = src.attributes.skinIndex;
  const sw = src.attributes.skinWeight;
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, _v);
    _v.applyMatrix4(mesh.matrixWorld);
    pos[i * 3] = _v.x;
    pos[i * 3 + 1] = _v.y;
    pos[i * 3 + 2] = _v.z;
    // Torso and head run warmer than the legs and boots.
    const h = h0 * (0.82 + 0.18 * Math.min(1, Math.max(0, _v.y / 1.5)));
    heat[i * 3] = heat[i * 3 + 1] = heat[i * 3 + 2] = h;
    let r = cr;
    let g = cg;
    let b = cb;
    if (px && uv) {
      const u = uv.getX(i) - Math.floor(uv.getX(i));
      const v = uv.getY(i) - Math.floor(uv.getY(i));
      const o4 = (Math.min(px.h - 1, Math.floor(v * px.h)) * px.w + Math.min(px.w - 1, Math.floor(u * px.w))) * 4;
      r *= px.data[o4] / 255;
      g *= px.data[o4 + 1] / 255;
      b *= px.data[o4 + 2] / 255;
      let skin = false;
      if (si && sw) {
        let best = 0;
        let bi = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (w > best) {
            best = w;
            bi = si.getComponent(i, k);
          }
        }
        skin = SKIN_BONES.test(bones[bi]?.name || '');
      }
      if (!skin) {
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = 0.5 * Math.min(1.7, Math.max(0.3, L / 0.3));
        msk[i] = 1;
      }
    }
    alb[i * 3] = r;
    alb[i * 3 + 1] = g;
    alb[i * 3 + 2] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(heat, 3));
  g.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
  g.setAttribute('paint', new THREE.BufferAttribute(msk, 1));
  g.setIndex(src.index ? src.index.clone() : sequentialIndex(n));
  g.computeVertexNormals();
  return g;
}

// ---- Vehicles ----

// Reads a texture's pixels once so vertex colors can be sampled from it.
const pixelCache = new Map();
function texturePixels(tex) {
  if (pixelCache.has(tex)) return pixelCache.get(tex);
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  pixelCache.set(tex, px);
  return px;
}

// Collects every mesh of a glTF scene into one geometry in scene space (skinned meshes in rest
// pose), with an albedo sampled from each vertex's texture texel or its material color.
// paintFn(materialName, r, g, b) -> null, or [mask, r, g, b] for body paint (neutral base colour
// that the per-instance paint colour multiplies).
// Textured mode (a realistic model whose meshes all share one baked texture atlas): uv is kept and
// the albedo is the material colour, so the shader applies the full-resolution texture.
function flatten(gltf, paintFn = null, textured = false) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    // Work on the original vertices (skin weights are per vertex), expand the index afterwards.
    const src = o.geometry;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const n = src.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const alb = new Float32Array(n * 3);
    const msk = new Float32Array(n);
    const uv = src.attributes.uv;
    const px = !textured && mat?.map?.image ? texturePixels(mat.map) : null;
    const base = mat?.color ? toDisplay(mat.color) : [0.5, 0.5, 0.5];
    for (let i = 0; i < n; i++) {
      // Skinned meshes need the bone transform; plain meshes just their world matrix.
      if (o.isSkinnedMesh) o.getVertexPosition(i, _v);
      else _v.fromBufferAttribute(src.attributes.position, i);
      _v.applyMatrix4(o.matrixWorld);
      pos[i * 3] = _v.x;
      pos[i * 3 + 1] = _v.y;
      pos[i * 3 + 2] = _v.z;
      let r = base[0];
      let g = base[1];
      let b = base[2];
      if (px && uv) {
        const u = uv.getX(i) - Math.floor(uv.getX(i));
        const v = uv.getY(i) - Math.floor(uv.getY(i));
        const o4 = (Math.min(px.h - 1, Math.floor(v * px.h)) * px.w + Math.min(px.w - 1, Math.floor(u * px.w))) * 4;
        r *= px.data[o4] / 255;
        g *= px.data[o4 + 1] / 255;
        b *= px.data[o4 + 2] / 255;
      }
      const painted = paintFn ? paintFn(mat?.name || '', r, g, b) : null;
      if (painted) [msk[i], r, g, b] = painted;
      alb[i * 3] = r;
      alb[i * 3 + 1] = g;
      alb[i * 3 + 2] = b;
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
    geo.setAttribute('paint', new THREE.BufferAttribute(msk, 1));
    if (textured) geo.setAttribute('uv', uv ? uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (src.index) {
      geo.setIndex(src.index.clone());
      geo = geo.toNonIndexed();
    }
    geo.computeVertexNormals();
    geo.userData.material = mat?.name || '';
    geo.userData.map = mat?.map || null;
    parts.push(geo);
  });
  return parts;
}

// The single texture shared by every mesh of a model, or null (then colours are baked per vertex).
function sharedAtlas(gltf) {
  let map;
  let ok = true;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = (Array.isArray(o.material) ? o.material[0] : o.material)?.map || null;
    if (map === undefined) map = m;
    else if (m !== map && m?.source !== map?.source) ok = false;
  });
  return ok && map ? map : null;
}

// Normalizes a vehicle to face +Z, sit on y = 0, be `length` long (null keeps the model's own
// size), then paints heat with heatFn(xn, yn, zn, materialName): xn/zn in -1..1 (left..right,
// rear..front), yn in 0..1. A realistic model with one texture atlas keeps its texture
// (geometry.userData.map); others get per-vertex colours.
export function buildVehicle(gltf, { length = null, rotY = 0, heatFn, extras = [], paintFn = null }) {
  const atlas = sharedAtlas(gltf);
  const parts = flatten(gltf, paintFn, !!atlas);
  const rot = new THREE.Matrix4().makeRotationY(rotY);
  for (const p of parts) p.applyMatrix4(rot);
  const bb = new THREE.Box3();
  for (const p of parts) {
    p.computeBoundingBox();
    bb.union(p.boundingBox);
  }
  const s = length ? length / (bb.max.z - bb.min.z) : 1;
  length = (bb.max.z - bb.min.z) * s;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -bb.min.y, -cz));
  const hw = ((bb.max.x - bb.min.x) / 2) * s;
  const hh = (bb.max.y - bb.min.y) * s;
  const hl = length / 2;
  for (const p of parts) {
    p.applyMatrix4(norm);
    const pa = p.attributes.position;
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const h = heatFn(pa.getX(i) / hw, pa.getY(i) / hh, pa.getZ(i) / hl, p.userData.material);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = h;
    }
    p.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const extraGeoms = extras.map((e) => {
    const x = withPaint(e({ hw, hh, hl }));
    if (atlas) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    return x;
  });
  const g = mergeGeometries([...parts, ...extraGeoms], false);
  for (const p of parts) p.dispose();
  g.userData.size = { w: hw * 2, h: hh, l: length };
  if (atlas) {
    // The sensor shaders convert sRGB to linear themselves.
    atlas.colorSpace = THREE.NoColorSpace;
    atlas.needsUpdate = true;
    atlas.userData.mean ??= 0.45;
    g.userData.map = atlas;
  }
  return g;
}

const mix = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
const GUN = [0.18, 0.18, 0.17];
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// The pickup's body panels are the saturated blue in its texture atlas: repaint them neutral.
const pickupPaint = (mat, r, g, b) => (mat === 'Atlas' && b > r * 1.25 && b > g * 1.05 && b > 0.22 ? [1, 0.74, 0.74, 0.74] : null);
// Hull materials keep their relative shading but lose their colour.
const hullPaint = (names, base) => (mat, r, g, b) => (names.some((n) => mat.startsWith(n)) ? [1, ...[0, 0, 0].map(() => Math.min(0.85, (lum(r, g, b) / base) * 0.6))] : null);

// Thermal layout by vehicle type, in normalized coordinates (x, z in -1..1 left..right and
// rear..front, y in 0..1): hot engine and exhaust, warm tyres or tracks, sun-warmed body.
const HEAT_FNS = {
  technical: (x, y, z, mat) => {
    if (mat === 'Headlights' || mat === 'BrakeLight') return 0.35;
    if (y < 0.3) return HEAT.tire;
    if (z > 0.42 && y < 0.72) return mix(HEAT.vehicle, HEAT.engine, (z - 0.42) / 0.3);
    if (z < -0.85 && y < 0.35) return HEAT.exhaust;
    return z > -0.05 ? HEAT.vehicle * 1.05 : HEAT.vehicle * 0.9;
  },
  apc: (x, y, z) => {
    if (y < 0.28) return HEAT.tire;
    if (z > 0.62 && y < 0.62) return mix(HEAT.vehicle, HEAT.engine, (z - 0.62) / 0.25);
    if (Math.abs(x) > 0.75 && z > 0.25 && z < 0.55 && y > 0.4) return HEAT.exhaust;
    if (z > 0.3) return HEAT.vehicle * 1.05;
    return HEAT.vehicle * 0.85;
  },
  tank: (x, y, z) => {
    if (z < -0.88 && y < 0.55) return HEAT.exhaust;
    if (z < -0.35 && y > 0.32 && y < 0.6 && Math.abs(x) < 0.6) return HEAT.engine;
    if (Math.abs(x) > 0.6 && y < 0.45) return HEAT.track * 1.1;
    if (z > 0.45 && y > 0.55) return HEAT.metal;
    return y > 0.55 ? HEAT.vehicle * 1.08 : HEAT.vehicle;
  },
  humvee: (x, y, z) => {
    if (y < 0.3) return HEAT.humvee * 1.2;
    if (z > 0.5 && y < 0.7) return HEAT.humvee * 1.6;
    return HEAT.humvee;
  },
  car: (warm) => (x, y, z) => {
    if (y < 0.3) return HEAT.tire * (0.6 + 0.4 * warm);
    if (z > 0.42 && y < 0.72) return mix(HEAT.vehicle, HEAT.engine, warm * 0.6);
    return HEAT.vehicle * 0.85;
  },
};

// A realistic vehicle converted by scripts/blender/convert_vehicle.py: already facing +Z at real
// size in metres with one baked texture atlas, so it keeps its own size and texture.
export function realVehicleGeometry(gltf, role, warm = 0.5) {
  const heatFn = role === 'car' ? HEAT_FNS.car(warm) : HEAT_FNS[role];
  return buildVehicle(gltf, { length: null, heatFn });
}

export function technicalGeometry(gltf) {
  return buildVehicle(gltf, {
    length: 5.4,
    paintFn: pickupPaint,
    heatFn: (x, y, z, mat) => {
      if (mat === 'Headlights' || mat === 'BrakeLight') return 0.35;
      if (y < 0.3) return HEAT.tire;
      if (z > 0.42 && y < 0.72) return mix(HEAT.vehicle, HEAT.engine, (z - 0.42) / 0.3);
      if (z < -0.85 && y < 0.35) return HEAT.exhaust;
      return z > -0.05 ? HEAT.vehicle * 1.05 : HEAT.vehicle * 0.9;
    },
    // Heavy machine gun on a pintle in the bed.
    extras: [
      ({ hh, hl }) =>
        merge([
          box(0.12, 0.9, 0.12, HEAT.metal, GUN, 0, hh * 0.55 + 0.45, -hl * 0.45),
          box(0.22, 0.24, 0.6, HEAT.metal * 1.1, GUN, 0, hh * 0.55 + 0.95, -hl * 0.4),
          box(0.07, 0.07, 1.2, HEAT.metal, GUN, 0, hh * 0.55 + 1.0, -hl * 0.4 + 0.8),
        ]),
    ],
  });
}

// Civilian pickup (no gun), engine cold or warm.
export function pickupGeometry(gltf, warm = 0.5) {
  return buildVehicle(gltf, {
    length: 5.3,
    paintFn: pickupPaint,
    heatFn: (x, y, z) => {
      if (y < 0.3) return HEAT.tire * (0.6 + 0.4 * warm);
      if (z > 0.42 && y < 0.72) return mix(HEAT.vehicle, HEAT.engine, warm * 0.6);
      return HEAT.vehicle * 0.85;
    },
  });
}

export function truckGeometry(gltf) {
  return buildVehicle(gltf, {
    length: 7.6,
    rotY: Math.PI / 2,
    paintFn: hullPaint(['Body', 'BackCovering'], 0.4),
    heatFn: (x, y, z) => {
      if (y < 0.28) return HEAT.tire;
      if (z > 0.62 && y < 0.62) return mix(HEAT.vehicle, HEAT.engine, (z - 0.62) / 0.25);
      if (Math.abs(x) > 0.75 && z > 0.25 && z < 0.55 && y > 0.4) return HEAT.exhaust;
      if (z > 0.3) return HEAT.vehicle * 1.05;
      return HEAT.vehicle * 0.85;
    },
  });
}

export function tankGeometry(gltf) {
  return buildVehicle(gltf, {
    length: 9.2,
    rotY: Math.PI / 2,
    paintFn: hullPaint(['Main'], 0.4),
    heatFn: (x, y, z) => {
      if (z < -0.88 && y < 0.55) return HEAT.exhaust;
      if (z < -0.35 && y > 0.32 && y < 0.6 && Math.abs(x) < 0.6) return HEAT.engine;
      if (Math.abs(x) > 0.6 && y < 0.45) return HEAT.track * 1.1;
      if (z > 0.45 && y > 0.55) return HEAT.metal;
      return y > 0.55 ? HEAT.vehicle * 1.08 : HEAT.vehicle;
    },
  });
}

export function humveeGeometry(gltf) {
  return buildVehicle(gltf, {
    length: 4.9,
    rotY: Math.PI / 2,
    heatFn: (x, y, z) => {
      if (y < 0.3) return HEAT.humvee * 1.2;
      if (z > 0.5 && y < 0.7) return HEAT.humvee * 1.6;
      return HEAT.humvee;
    },
  });
}

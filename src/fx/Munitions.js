// Rounds and bombs in flight, drawn with their real models: the 25/40/105 mm projectiles (the
// user's PGU-25/U, PGU-9/B and PGU-44/B models; only the projectile flies, the brass case stays
// in the gun) and the guided bomb.
// True scale, except that nothing shrinks below a few pixels on screen, so you can watch every
// munition come down onto its target. The rounds fly almost straight away from the sensor and
// are seen nose-on, so their minimum size is set by their width; the bomb, seen side-on in its
// dive, by its length. The bomb casts a shadow on the ground as it comes in.
// Daylight shows the painted models; thermal shows them warm (the rounds hot from firing).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../render/heat.js';
import { weaponIndex } from '../config.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();

// Collects the meshes of a glTF scene (optionally only those whose name matches) into one
// geometry in model space, keeping uv, grouped by base-colour texture. center: move the
// collected geometry's middle to the origin (a round's projectile sits above its case in the
// model, so it would otherwise be drawn a case-length ahead of where it is).
function gather(gltf, match = null, center = false) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || (match && !match.test(o.name) && !match.test(o.parent?.name || ''))) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const map = mat?.map || null;
    const color = mat?.color ? [mat.color.r, mat.color.g, mat.color.b].map((v) => Math.pow(v, 1 / 2.2)) : [0.6, 0.6, 0.6];
    const n = g.attributes.position.count;
    const alb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) alb.set(map ? [1, 1, 1] : color, i * 3);
    g.setAttribute('albedo', new THREE.BufferAttribute(alb, 3));
    const key = map ? map.uuid : 'plain';
    if (!groups.has(key)) groups.set(key, { map, list: [], metal: mat?.metalness ?? 0, rough: mat?.roughness ?? 0.5 });
    groups.get(key).list.push(g);
  });
  const out = [...groups.values()].map((gr) => ({ geometry: mergeGeometries(gr.list, false), map: gr.map, metal: gr.metal, rough: gr.rough }));
  if (center && out.length) {
    const box = new THREE.Box3();
    for (const o of out) {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox);
    }
    const c = box.getCenter(new THREE.Vector3());
    for (const o of out) o.geometry.translate(-c.x, -c.y, -c.z);
  }
  return out;
}

// One instanced batch per texture group of a model. push() points the model's long axis along a
// direction.
class ModelBatch {
  constructor(scene, groups, heat, cap, axis, { shadow = false } = {}) {
    this.axis = axis; // the model's long axis (nose direction) in model space
    this.meshes = groups.map(({ geometry, map, metal, rough }) => {
      geometry.computeBoundingBox();
      const n = geometry.attributes.position.count;
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(heat), 3));
      if (map) {
        // Sampled raw: the sensor shaders do their own sRGB -> linear conversion.
        map.colorSpace = THREE.NoColorSpace;
        map.needsUpdate = true;
        map.userData.mean ??= 0.5;
      }
      const mat = surfaceMaterial({ name: `munition-${map ? map.uuid.slice(0, 8) : 'plain'}`, tex: map, uv: !!map, raw: !!map, scale: 1, texAmt: 1, detailAmt: 0, rough, metal, roughVar: 0 });
      const mesh = new THREE.InstancedMesh(geometry, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.count = 0;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return mesh;
    });
    const box = new THREE.Box3();
    for (const m of this.meshes) box.union(m.geometry.boundingBox);
    const size = box.getSize(new THREE.Vector3());
    this.length = Math.max(size.x, size.y, size.z);
    // Width across the long axis.
    this.diameter = Math.max(1e-3, Math.abs(axis.y) > 0.5 ? Math.max(size.x, size.z) : Math.abs(axis.z) > 0.5 ? Math.max(size.x, size.y) : Math.max(size.y, size.z));
    this.n = 0;
    this.cap = cap;
  }

  begin() {
    this.n = 0;
  }

  push(x, y, z, dx, dy, dz, scale) {
    _d.set(dx, dy, dz);
    if (_d.lengthSq() < 1e-12) _d.copy(this.axis);
    _q.setFromUnitVectors(this.axis, _d.normalize());
    if (this.n >= this.cap) return;
    _p.set(x, y, z);
    _s.setScalar(scale);
    _m.compose(_p, _q, _s);
    for (const mesh of this.meshes) _m.toArray(mesh.instanceMatrix.array, this.n * 16);
    this.n++;
  }

  end() {
    for (const mesh of this.meshes) {
      mesh.count = this.n;
      mesh.visible = this.n > 0;
      if (this.n) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// Smallest on-screen size in pixels: rounds by width, the bomb by length. The bomb also has a
// largest size: it drops away close to the sensor, where at 3x it would fill a third of the view.
const MIN_WIDTH_PX = { 25: 3, 40: 4.5, 105: 6 };
const MIN_LENGTH_PX_GBU = 40;
// It falls away from the sensor, so it is mostly seen tail-on: a cross of fins at least this wide.
const MIN_WIDTH_PX_GBU = 16;
const MAX_LENGTH_PX_GBU = 170;

export class Munitions {
  // models: { r105, r40, r25, gbu } glTFs. Any may be missing.
  constructor(scene, models) {
    // One batch per weapon, at its index in WEAPONS.
    this.batches = [];
    this.minPx = [];
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, 1);
    const round = (id, gltf, cap) => {
      const i = weaponIndex(id);
      this.batches[i] = gltf ? new ModelBatch(scene, gather(gltf, /Projetil/, true), 1.7, cap, up) : null;
      this.minPx[i] = MIN_WIDTH_PX[id];
    };
    round('25', models.r25, 64);
    round('40', models.r40, 24);
    round('105', models.r105, 8);
    // A bomb gliding at 200-300 m/s is warmed by the air: it shows light on thermal.
    this.bomb = models.gbu ? new ModelBatch(scene, gather(models.gbu), 1.35, 6, fwd, { shadow: true }) : null;
  }

  // shells: player rounds in flight ({ wi, head, dir }: where to draw them, see Shells.shellView);
  // bombs: guided bombs ({ x, y, z, vx, vy, vz }).
  render(shells, bombs, camera, viewportH) {
    for (const b of this.batches) b?.begin();
    this.bomb?.begin();
    const pxPerRad = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const cam = camera.position;
    // Scale that makes `size` metres span at least `px` pixels (and at most `maxPx`) at this point.
    const scaleFor = (x, y, z, size, px, maxPx = Infinity) => {
      const perPx = Math.hypot(x - cam.x, y - cam.y, z - cam.z) / pxPerRad / size;
      return Math.min(Math.max(1, px * perPx), maxPx * perPx);
    };
    for (const s of shells) {
      const b = this.batches[s.wi];
      if (!b || !s.head) continue;
      const { x, y, z } = s.head;
      b.push(x, y, z, s.dir.x, s.dir.y, s.dir.z, scaleFor(x, y, z, b.diameter, this.minPx[s.wi] ?? 3));
    }
    const gb = this.bomb;
    if (gb) {
      for (const m of bombs) {
        const k = Math.max(scaleFor(m.x, m.y, m.z, gb.length, MIN_LENGTH_PX_GBU, MAX_LENGTH_PX_GBU), scaleFor(m.x, m.y, m.z, gb.diameter, MIN_WIDTH_PX_GBU));
        gb.push(m.x, m.y, m.z, m.vx, m.vy, m.vz, k);
      }
    }
    for (const b of this.batches) b?.end();
    this.bomb?.end();
  }
}

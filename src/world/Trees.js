// Instanced vegetation built by scripts/build-trees.mjs: broadleaf trees ("Realistic Trees
// Collection" by Jungle Jim) and date palms ("Date Palm" by evolveduk), both CC-BY-4.0.
// A field holds every plant of one group. Each frame the visible plants are sorted into three
// levels of detail by their size on screen, so the sensor's narrow zooms get full detail while
// wide views stay cheap. Hit plants topple away from the blast and lie where they fell.
import * as THREE from 'three';
import { SENSOR, FRAG_IBL, CLOUD, GLSL_CLOUD } from '../render/heat.js';
import { HEAT } from '../config.js';

// On-screen plant height (px) needed for each level of detail.
const LOD0_PX = 90;
const LOD1_PX = 48;
const FALL_TIME = 1.7;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

// Daylight: texture colour (converted to linear light) under the sun and sky, graded by a per-
// material tint. Thermal: a heat value with the texture's light/dark detail; foliage reads cool,
// bark a little warmer. Leaves let some light through (a soft wrap), so crowns are not black.
export function plantMaterial(map, spec) {
  const cards = spec.kind === 'leaves';
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: cards ? (spec.alphaTest ?? 0.45) : 0,
    side: spec.kind === 'bark' ? THREE.FrontSide : THREE.DoubleSide,
    roughness: cards ? 0.7 : 0.9,
    metalness: 0,
  });
  mat.envMapIntensity = cards ? 0.55 : 0.7;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uThermal = SENSOR.uThermal;
    sh.uniforms.uHeat = { value: HEAT[spec.heat] };
    sh.uniforms.uDay = { value: new THREE.Vector3(...spec.day) };
    sh.uniforms.uMapSize = { value: new THREE.Vector2(map?.image?.width || 512, map?.image?.height || 512) };
    Object.assign(sh.uniforms, CLOUD);
    sh.vertexShader = `varying vec2 vCloudP;\n${sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vCloudP = (modelMatrix * cwp).xz;
      }`,
    )}`;
    sh.fragmentShader = `uniform float uThermal;\nuniform float uHeat;\nuniform vec3 uDay;\nuniform vec2 uMapSize;\nvarying vec2 vCloudP;\n${GLSL_CLOUD}\n${sh.fragmentShader
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          float cs = mix(cloudShade(vCloudP), 1.0, uThermal * 0.55);
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `{
        #ifdef USE_ALPHATEST
          // Small mip levels average leaf alpha toward zero, so distant foliage would thin out and
          // vanish under the alpha test: boost alpha by mip level to keep its coverage.
          vec2 mdx = dFdx(vMapUv * uMapSize);
          vec2 mdy = dFdy(vMapUv * uMapSize);
          float mipLevel = max(0.0, 0.5 * log2(max(dot(mdx, mdx), dot(mdy, mdy))));
          diffuseColor.a *= 1.0 + mipLevel * 0.3;
        #endif
        float tl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 day = pow(max(diffuseColor.rgb * uDay * vec3(1.0, 0.97, 0.82), vec3(0.0)), vec3(2.2));
        diffuseColor.rgb = mix(day, vec3(uHeat * (0.65 + 0.9 * tl)), uThermal);
      }
      #include <color_fragment>`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, uThermal);')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_IBL}`)}`;
  };
  mat.customProgramCacheKey = () => `plant3-${spec.kind}-${mat.alphaTest}`;
  const depth = cards ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: mat.alphaTest }) : null;
  return { mat, depth };
}

function geometry(buf, part) {
  const f32 = ([at, n]) => new Float32Array(buf, at, n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(f32(part.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(f32(part.nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(f32(part.uv), 2));
  if (part.idx) g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, part.idx[0], part.idx[1]), 1));
  return g;
}

export class TreeField {
  // data: { json, bin (ArrayBuffer), textures }; group: 'tree' or 'palm'.
  constructor(scene, data, group) {
    this.scene = scene;
    this.data = data;
    this.trees = [];
    this.variants = data.json.variants.filter((v) => v.group === group);
    this.batches = null;
  }

  // Weighted toward the big shade trees; the small bush variant is rare.
  pickVariant(r) {
    const w = this.variants.map((v) => (v.height < 3 ? 0.25 : v.height < 6 ? 0.8 : 1.2));
    let t = r * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) {
      t -= w[i];
      if (t <= 0) return i;
    }
    return w.length - 1;
  }

  add(x, y, z, yaw, scale, rand) {
    const variant = this.pickVariant(rand);
    const v = this.variants[variant];
    const rec = { x, y, z, yaw, scale, variant, h: v.height * scale, r: v.radius * scale, fall: null };
    this.trees.push(rec);
    return rec;
  }

  // Ground box of a plant (for splash damage).
  box(rec) {
    return new THREE.Box3(new THREE.Vector3(rec.x - rec.r * 0.5, rec.y, rec.z - rec.r * 0.5), new THREE.Vector3(rec.x + rec.r * 0.5, rec.y + rec.h, rec.z + rec.r * 0.5));
  }

  build() {
    const { json, bin, textures } = this.data;
    const counts = new Array(this.variants.length).fill(0);
    for (const t of this.trees) counts[t.variant]++;
    const mats = {};
    const material = (name) => (mats[name] ||= plantMaterial(textures[json.materials[name].tex], json.materials[name]));
    this.batches = this.variants.map((v, vi) =>
      v.lods.map((lod) =>
        lod.parts.map((part) => {
          const cap = Math.max(1, counts[vi]);
          const { mat, depth } = material(part.mat);
          const m = new THREE.InstancedMesh(geometry(bin, part), mat, cap);
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
          m.instanceColor.setUsage(THREE.DynamicDrawUsage);
          m.frustumCulled = false;
          m.castShadow = true;
          m.receiveShadow = true;
          if (depth) m.customDepthMaterial = depth;
          m.count = 0;
          this.scene.add(m);
          return m;
        }),
      ),
    );
  }

  // Starts a fall away from (bx, bz).
  topple(rec, bx, bz) {
    let dx = rec.x - bx;
    let dz = rec.z - bz;
    let l = Math.hypot(dx, dz);
    if (l < 0.3) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
      l = 1;
    }
    rec.fall = { t: 0, axis: new THREE.Vector3(dz / l, 0, -dx / l), angle: 1.38 + Math.random() * 0.2 };
  }

  restore(rec) {
    rec.fall = null;
  }

  update(dt, camera, viewportHeight, thermal) {
    if (!this.batches) return;
    for (const per of this.batches) for (const lod of per) for (const mesh of lod) mesh.count = 0;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const pxPerRad = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const cam = camera.position;
    for (const t of this.trees) {
      // A margin keeps plants just off-screen casting their shadows into view.
      _sphere.center.set(t.x, t.y + t.h * 0.5, t.z);
      _sphere.radius = t.h * 0.7 + 25;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      const px = (t.h / cam.distanceTo(_sphere.center)) * pxPerRad;
      const parts = this.batches[t.variant][px > LOD0_PX ? 0 : px > LOD1_PX ? 1 : 2];

      _q.setFromAxisAngle(_up, t.yaw);
      let heat = 1;
      let tint = 1;
      if (t.fall) {
        const f = t.fall;
        f.t += dt;
        const k = Math.min(1, f.t / FALL_TIME);
        // Accelerating fall, a small bounce at the end.
        let ang = f.angle * k * k;
        if (k >= 1) ang = f.angle - 0.05 * Math.exp(-(f.t - FALL_TIME) * 6) * Math.sin((f.t - FALL_TIME) * 25);
        _qf.setFromAxisAngle(f.axis, ang);
        _q.premultiply(_qf);
        heat = 1 + 1.3 * Math.exp(-f.t / 25);
        tint = 0.55;
      }
      _p.set(t.x, t.y - 0.15, t.z);
      _s.setScalar(t.scale);
      _m.compose(_p, _q, _s);
      const c = thermal ? heat : tint;
      for (const mesh of parts) {
        const i = mesh.count++;
        _m.toArray(mesh.instanceMatrix.array, i * 16);
        const ca = mesh.instanceColor.array;
        ca[i * 3] = c;
        ca[i * 3 + 1] = c * (thermal ? 1 : 0.92);
        ca[i * 3 + 2] = c * (thermal ? 1 : 0.85);
      }
    }
    for (const per of this.batches) {
      for (const lod of per) {
        for (const mesh of lod) {
          mesh.visible = mesh.count > 0;
          if (!mesh.count) continue;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }
}

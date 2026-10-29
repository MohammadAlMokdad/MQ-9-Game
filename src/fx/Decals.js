// Shell craters and shockwave rings.
// A crater is a real hole: its opening is written to the stencil buffer first, the terrain and
// roads skip those pixels (see HOLE_STENCIL), and a bowl of churned soil that dips below the
// ground is drawn in their place, lit and self-shadowed by the sun. A ragged raised lip and a
// spray of thrown-out dirt surround it. In thermal the fresh crater glows and cools.
import * as THREE from 'three';
import { surfaceHeight } from '../world/terrain.js';
import { ejectaTexture } from '../render/textures.js';
import { SENSOR, surfaceMaterial } from '../render/heat.js';
import { mulberry32 } from '../core/rng.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

// Bowl size relative to the thrown-dirt radius, and depth relative to the bowl radius.
const BOWL = 0.38;
const DEPTH = 0.42;

// Applied to the ground materials: don't draw where a crater opening was stencilled.
export function cutByCraters(mat) {
  mat.stencilWrite = true; // enables the stencil test in three.js
  mat.stencilRef = 1;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFail = THREE.KeepStencilOp;
  mat.stencilZFail = THREE.KeepStencilOp;
  mat.stencilZPass = THREE.KeepStencilOp;
  return mat;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Unit crater: the opening is radius 1 at ground level (y = 0). Inside, a bowl drops to
// -DEPTH; outside, a raised lip; beyond that the skirt sinks under the terrain. Returns the
// bowl and the matching flat "cap" (the opening, for the stencil), sharing one ragged outline.
function craterGeometry() {
  const rng = mulberry32(4711);
  const segs = 28;
  const raw = Array.from({ length: segs }, () => 0.86 + rng() * 0.28);
  const jit = raw.map((v, s) => (v + raw[(s + 1) % segs] + raw[(s + segs - 1) % segs]) / 3);
  const rings = [0, 0.16, 0.31, 0.45, 0.58, 0.7, 0.8, 0.88, 0.95, 1.0, 1.07, 1.16, 1.27, 1.4, 1.55, 1.72];
  const height = (r) => {
    if (r <= 1) return -DEPTH * Math.pow(1 - r * r, 0.7);
    if (r <= 1.55) return 0.14 * Math.sin((Math.PI * (r - 1)) / 0.55);
    return -0.18;
  };
  const pos = [];
  const heat = [];
  const alb = [];
  for (const r of rings) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const rr = r * jit[s];
      const lump = r > 1 && r < 1.5 ? (rng() - 0.5) * 0.08 : r > 0 && r < 0.9 ? (rng() - 0.5) * 0.05 : 0;
      pos.push(Math.cos(a) * rr, height(r) + lump, Math.sin(a) * rr);
      // Dark damp churned soil at the bottom, lighter walls, pale dry dirt on the lip.
      // The lip is patchy thrown soil, darker clods mixed with dry dirt.
      const t = smooth(0.2, 1.15, r);
      const v = r > 1 ? 0.62 + rng() * 0.5 : 0.88 + rng() * 0.24;
      alb.push((0.2 + 0.3 * t) * v, (0.15 + 0.24 * t) * v, (0.1 + 0.16 * t) * v);
      const h = 1.1 - 0.4 * smooth(0.3, 1.3, r);
      heat.push(h, h, h);
    }
  }
  const idx = [];
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let s = 0; s < segs; s++) {
      const a = ri * segs + s;
      const b = ri * segs + ((s + 1) % segs);
      const c = (ri + 1) * segs + s;
      const d = (ri + 1) * segs + ((s + 1) % segs);
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from above
    }
  }
  const bowl = new THREE.BufferGeometry();
  bowl.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bowl.setIndex(idx);
  bowl.computeVertexNormals();
  bowl.setAttribute('color', new THREE.Float32BufferAttribute(heat, 3));
  bowl.setAttribute('albedo', new THREE.Float32BufferAttribute(alb, 3));

  // The opening: slightly beyond the rim, where the raised lip already covers the cut edge.
  const cp = [0, 0, 0];
  const ci = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    cp.push(Math.cos(a) * 1.05 * jit[s], 0, Math.sin(a) * 1.05 * jit[s]);
    ci.push(0, 1 + s, 1 + ((s + 1) % segs));
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cap.setIndex(ci);
  return { bowl, cap };
}

const SPLAT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vI;
  void main() {
    vUv = uv;
    vI = instanceColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const SPLAT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uThermal;
  varying vec2 vUv;
  varying vec3 vI;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vI.g;
    if (a < 0.01) discard;
    vec3 day = pow(vec3(0.46, 0.37, 0.27) * (0.7 + 0.45 * t.r), vec3(2.2));
    gl_FragColor = vec4(mix(day, vec3(vI.r), uThermal), a);
  }`;

// One ring buffer of craters (stencil cap + bowl + ejecta spray).
class CraterPool {
  constructor(scene, cap, geo, bowlMat, capMat, splatGeo, splatMat) {
    this.cap = cap;
    this.next = 0;
    this.items = [];
    const mk = (g, mat, order) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = order;
      scene.add(m);
      return m;
    };
    this.capMesh = mk(geo.cap, capMat, -10); // before the terrain
    this.splat = mk(splatGeo, splatMat, 1);
    this.bowl = mk(geo.bowl, bowlMat, 0);
    this.bowl.castShadow = true; // the rim shades the inside of the hole
    this.bowl.receiveShadow = true;
  }

  add(x, y, z, r, heat) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const yaw = Math.random() * Math.PI * 2;
    const R = r * BOWL;
    const ys = 0.85 + Math.random() * 0.3;
    _p.set(x, y, z);
    _q.setFromAxisAngle(_up, yaw);
    _s.set(R, R * ys, R);
    _m.compose(_p, _q, _s);
    _m.toArray(this.bowl.instanceMatrix.array, i * 16);
    _m.toArray(this.capMesh.instanceMatrix.array, i * 16);
    _p.set(x, y + 0.06, z);
    _q.setFromAxisAngle(_up, yaw).multiply(FLAT);
    _s.set(r, r, r);
    _m.compose(_p, _q, _s);
    _m.toArray(this.splat.instanceMatrix.array, i * 16);
    this.items[i] = { t: 0, heat, tone: 0.9 + Math.random() * 0.2, x, z, R, D: R * ys * DEPTH };
    this.bowl.count = this.splat.count = this.capMesh.count = Math.max(this.bowl.count, i + 1);
    this.bowl.instanceMatrix.needsUpdate = true;
    this.capMesh.instanceMatrix.needsUpdate = true;
    this.splat.instanceMatrix.needsUpdate = true;
  }

  // How far below the ground the crater floor is at (x, z), for things standing in it.
  depthAt(x, z) {
    let d = 0;
    for (let i = 0; i < this.bowl.count; i++) {
      const it = this.items[i];
      if (!it) continue;
      const q = ((x - it.x) ** 2 + (z - it.z) ** 2) / (it.R * it.R);
      if (q < 1) d = Math.max(d, it.D * Math.pow(1 - q, 0.7));
    }
    return d;
  }

  clear() {
    this.items.length = 0;
    this.next = 0;
    this.bowl.count = this.splat.count = this.capMesh.count = 0;
  }

  update(dt, thermal) {
    const bc = this.bowl.instanceColor.array;
    const sc = this.splat.instanceColor.array;
    for (let i = 0; i < this.bowl.count; i++) {
      const it = this.items[i];
      if (!it) continue;
      it.t += dt;
      const o = i * 3;
      // Thermal: glowing fresh soil that cools. Daylight: plain soil colour.
      const hot = Math.exp(-it.t / 5);
      const b = thermal ? 0.85 + it.heat * 1.4 * hot : it.tone;
      bc[o] = bc[o + 1] = bc[o + 2] = b;
      sc[o] = 0.62 + it.heat * 0.6 * hot; // thermal brightness of the spray
      sc[o + 1] = thermal ? 0.15 + 0.6 * hot : 0.75 * Math.max(0.35, 1 - it.t / 240); // coverage
      sc[o + 2] = 0;
    }
    this.bowl.instanceColor.needsUpdate = true;
    this.splat.instanceColor.needsUpdate = true;
  }
}

export class Decals {
  constructor(scene, textures) {
    const geo = craterGeometry();
    const bowlMat = surfaceMaterial({ name: 'crater', tex: textures.dry_ground_rocks, nor: textures.dry_ground_rocks_nor, norAmt: 1.3, scale: 1 / 2.2, texAmt: 0.55, detailAmt: 0.4, rough: 0.97 });
    bowlMat.polygonOffset = true;
    bowlMat.polygonOffsetFactor = -1;
    bowlMat.polygonOffsetUnits = -1;
    // Invisible: only marks the opening in the stencil buffer.
    const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    capMat.stencilWrite = true;
    capMat.stencilRef = 1;
    capMat.stencilFunc = THREE.AlwaysStencilFunc;
    capMat.stencilZPass = THREE.ReplaceStencilOp;
    const splatGeo = new THREE.PlaneGeometry(2, 2);
    const splatMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: ejectaTexture() }, uThermal: SENSOR.uThermal },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // Separate pools so a long 25mm burst can't erase the big 105 craters.
    this.big = new CraterPool(scene, 90, geo, bowlMat, capMat, splatGeo, splatMat);
    this.small = new CraterPool(scene, 160, geo, bowlMat, capMat, splatGeo, splatMat);

    this.ringCap = 16;
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    ringMat.onBeforeCompile = (sh) => {
      sh.uniforms.uThermal = SENSOR.uThermal;
      sh.fragmentShader = `uniform float uThermal;\n${sh.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.rgb *= 0.12 + 0.88 * uThermal;',
      )}`;
    };
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, this.ringCap);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.ringCap * 3), 3);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.ringMesh.renderOrder = 2;
    scene.add(this.ringMesh);
  }

  // r is the radius of the thrown-out dirt; the bowl itself is about a third of that.
  // Impacts on roofs or walls (well above the ground) leave no ground crater.
  addCrater(x, y, z, r, heat = 0.8) {
    const ground = surfaceHeight(x, z);
    if (y - ground > 1.5) return;
    (r >= 2.5 ? this.big : this.small).add(x, ground, z, r, heat);
  }

  holeDepth(x, z) {
    return this.big.depthAt(x, z);
  }

  addRing(x, y, z, maxR, life, heat) {
    if (this.rings.length >= this.ringCap) this.rings.shift();
    this.rings.push({ x, y: y + 0.5, z, maxR, life, heat, t: 0 });
  }

  clear() {
    this.big.clear();
    this.small.clear();
    this.rings.length = 0;
    this.ringMesh.count = 0;
  }

  update(dt) {
    const thermal = SENSOR.uThermal.value > 0.5;
    this.big.update(dt, thermal);
    this.small.update(dt, thermal);

    const rc = this.ringMesh.instanceColor.array;
    let n = 0;
    for (let i = 0; i < this.rings.length; ) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) {
        this.rings.splice(i, 1);
        continue;
      }
      const k = r.t / r.life;
      const s = r.maxR * (1 - (1 - k) * (1 - k));
      _p.set(r.x, r.y, r.z);
      _s.set(s, s, s);
      _m.compose(_p, FLAT, _s);
      _m.toArray(this.ringMesh.instanceMatrix.array, n * 16);
      const h = r.heat * (1 - k);
      rc[n * 3] = rc[n * 3 + 1] = rc[n * 3 + 2] = h;
      n++;
      i++;
    }
    this.ringMesh.count = n;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.instanceColor.needsUpdate = true;
  }
}

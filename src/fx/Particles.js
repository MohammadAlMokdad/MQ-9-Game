// Pooled camera-facing billboards in typed arrays, drawn as one instanced quad batch.
// "hot" is additive (fire, sparks, flashes), "smoke" is alpha-blended (dust, smoke columns).
// Each particle can spin, pick an atlas frame, drift with the wind, or stretch along its
// velocity (sparks and debris streaks).
//
// Daylight: smoke is lit by the sun and sky using the puff normals stored in the atlas, so a
// column has a bright sunlit side and a shaded side from any viewing angle; its colour runs from
// earth-brown dust to black soot. Fire is emissive (HDR) with a temperature colour ramp, so it
// blooms. Thermal: everything is a heat value. Particles fade out where they meet the ground.
import * as THREE from 'three';
import { ATLAS_COLS } from '../render/textures.js';
import { SENSOR } from '../render/heat.js';

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData;   // size, rotation, heat, alpha
  attribute vec3 iVel;
  attribute vec4 iData2;  // atlas frame, stretch, ground height, darkness (-1 = from heat)
  uniform float uCols;
  varying vec2 vUv;
  varying float vHeat;
  varying float vAlpha;
  varying float vRot;
  varying float vDark;
  varying float vSoft;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec2 c = position.xy;
    float size = iData.x;
    vec3 off;
    if (iData2.y > 0.0) {
      vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
      float sp = length(vv.xy);
      vec2 d = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
      vec2 sd = vec2(-d.y, d.x);
      off = vec3(sd * c.x * size + d * c.y * (size + sp * iData2.y), 0.0);
      vRot = atan(d.x, d.y);
    } else {
      float cr = cos(iData.y);
      float sr = sin(iData.y);
      off = vec3(vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * size, 0.0);
      vRot = iData.y;
    }
    mv.xyz += off;
    gl_Position = projectionMatrix * mv;
    // World height of this corner, for the soft fade into the ground.
    float wy = iPos.y + (vec4(off, 0.0) * viewMatrix).y;
    vSoft = clamp((wy - iData2.z) / (size * 0.3 + 0.4), 0.0, 1.0);
    float f = iData2.x;
    float col = mod(f, uCols);
    float row = floor(f / uCols);
    vUv = vec2((col + c.x + 0.5) / uCols, 1.0 - (row + 0.5 - c.y) / uCols);
    vHeat = iData.z;
    vAlpha = iData.w;
    vDark = iData2.w;
  }`;

// Fire: white-hot in thermal; in daylight an emissive temperature ramp from deep red to
// yellow-white, bright enough to bloom.
const FRAG_HOT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uThermal;
  uniform float uFireGain;
  varying vec2 vUv;
  varying float vHeat;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    float a = texture2D(uAtlas, vUv).a;
    float v = vHeat * a * vAlpha * mix(1.0, vSoft, 0.8);
    float T = clamp(vHeat / 3.0, 0.0, 1.0);
    vec3 fire = mix(vec3(1.0, 0.2, 0.025), vec3(1.0, 0.5, 0.12), smoothstep(0.15, 0.55, T));
    fire = mix(fire, vec3(1.0, 0.88, 0.68), smoothstep(0.65, 1.0, T));
    gl_FragColor = vec4(mix(fire * v * uFireGain, vec3(v), uThermal), 1.0);
  }`;

// Smoke: hot and bright in thermal; in daylight a lit volume of dust or soot.
const FRAG_SMOKE = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uThermal;
  uniform vec3 uSunView;
  uniform vec3 uSunCol;
  uniform vec3 uSkyCol;
  varying vec2 vUv;
  varying float vHeat;
  varying float vAlpha;
  varying float vRot;
  varying float vDark;
  varying float vSoft;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vAlpha * mix(1.0, vSoft, 0.85);
    if (a < 0.004) discard;
    vec3 th = vec3(vHeat * 1.45 * (0.72 + 0.4 * t.b));
    vec2 nxy = t.rg * 2.0 - 1.0;
    float cr = cos(vRot);
    float sr = sin(vRot);
    vec3 n = vec3(nxy.x * cr - nxy.y * sr, nxy.x * sr + nxy.y * cr, 0.0);
    n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
    float wrap = clamp(dot(n, uSunView) * 0.6 + 0.4, 0.0, 1.0);
    float dark = vDark >= 0.0 ? vDark : clamp((vHeat - 0.3) * 2.6, 0.0, 1.0);
    vec3 alb = mix(vec3(0.43, 0.35, 0.25), vec3(0.03, 0.028, 0.026), dark);
    vec3 lit = alb * (uSkyCol * (0.5 + 0.5 * t.b) + uSunCol * wrap * (0.35 + 0.65 * t.b));
    // Fresh smoke over a fire glows orange from below.
    lit += vec3(1.0, 0.32, 0.06) * max(0.0, vHeat - 0.85) * 0.9 * (1.0 - t.b) * (1.0 - n.y * 0.5);
    gl_FragColor = vec4(mix(lit, th, uThermal), a);
  }`;

const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'h0', 'h1', 'a0', 'a1', 'grav', 'drag', 'rot', 'rotV', 'frame', 'stretch', 'wind', 'gy', 'dark'];

// Shared daylight lighting for every particle system (set each frame by Effects).
export const PARTICLE_LIGHT = {
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Vector3(2.8, 2.65, 2.4) },
  uSkyCol: { value: new THREE.Vector3(0.55, 0.62, 0.75) },
  uFireGain: { value: 2.6 },
};

export class PointSystem {
  constructor(capacity, kind, atlas) {
    this.cap = capacity;
    this.n = 0;
    for (const f of FIELDS) this[f] = new Float32Array(capacity);
    this.windX = 2.2;
    this.windZ = 1.1;
    // Ground height used for the soft fade of particles emitted next (set by the effect recipes).
    this.ground = -1e4;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (n) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = inst(3);
    this.aData = inst(4);
    this.aVel = inst(3);
    this.aData2 = inst(4);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iData', this.aData);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iData2', this.aData2);
    g.instanceCount = 0;
    this.geometry = g;

    const hot = kind === 'hot';
    this.uniforms = { uAtlas: { value: atlas }, uCols: { value: ATLAS_COLS }, uThermal: SENSOR.uThermal, ...PARTICLE_LIGHT };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: hot ? FRAG_HOT : FRAG_SMOKE,
      transparent: true,
      depthWrite: false,
      blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Mesh(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = hot ? 4 : 3;
  }

  // Positional args keep the hot path allocation-free. frame -1 picks a random smoke frame.
  // dark: 0 = earth-brown dust .. 1 = black soot (-1 derives it from the heat, hot = sooty).
  emit(x, y, z, vx, vy, vz, life, s0, s1, h0, h1, a0 = 1, a1 = 1, grav = 0, drag = 0, frame = -1, stretch = 0, wind = 0, dark = -1) {
    let i = this.n;
    if (i >= this.cap) i = Math.floor(Math.random() * this.cap);
    else this.n++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.h0[i] = h0;
    this.h1[i] = h1;
    this.a0[i] = a0;
    this.a1[i] = a1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.rot[i] = Math.random() * 6.283;
    this.rotV[i] = (Math.random() - 0.5) * 0.6;
    this.frame[i] = frame >= 0 ? frame : Math.floor(Math.random() * 12);
    this.stretch[i] = stretch;
    this.wind[i] = wind;
    this.gy[i] = this.ground;
    this.dark[i] = dark;
  }

  copy(src, dst) {
    for (const f of FIELDS) this[f][dst] = this[f][src];
  }

  clear() {
    this.n = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt) {
    const P = this.aPos.array;
    const D = this.aData.array;
    const V = this.aVel.array;
    const D2 = this.aData2.array;
    let i = 0;
    while (i < this.n) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= damp;
      this.vy[i] *= damp;
      this.vz[i] *= damp;
      const w = this.wind[i];
      this.px[i] += (this.vx[i] + this.windX * w) * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += (this.vz[i] + this.windZ * w) * dt;
      // Heavy debris stops at the ground instead of sinking through it.
      if (this.grav[i] > 0 && this.py[i] < this.gy[i]) {
        this.py[i] = this.gy[i];
        this.vx[i] *= 0.3;
        this.vz[i] *= 0.3;
        this.vy[i] = 0;
      }
      this.rot[i] += this.rotV[i] * dt;
      const k = age / this.life[i];
      const ke = 1 - (1 - k) * (1 - k);
      const o3 = i * 3;
      P[o3] = this.px[i];
      P[o3 + 1] = this.py[i];
      P[o3 + 2] = this.pz[i];
      V[o3] = this.vx[i];
      V[o3 + 1] = this.vy[i];
      V[o3 + 2] = this.vz[i];
      const o4 = i * 4;
      D[o4] = this.s0[i] + (this.s1[i] - this.s0[i]) * ke;
      D[o4 + 1] = this.rot[i];
      D[o4 + 2] = this.h0[i] + (this.h1[i] - this.h0[i]) * k;
      // Fade in quickly, then follow a0 -> a1.
      D[o4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * k) * Math.min(1, age * 25);
      D2[o4] = this.frame[i];
      D2[o4 + 1] = this.stretch[i];
      D2[o4 + 2] = this.gy[i];
      D2[o4 + 3] = this.dark[i];
      i++;
    }
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aData2.needsUpdate = true;
    this.geometry.instanceCount = this.n;
  }
}

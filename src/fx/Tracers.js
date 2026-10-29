// Moving tracer streaks (shells in flight, small-arms fire both ways), drawn as glowing
// screen-space ribbons with a constant pixel width so they read at any zoom.
// A round flying straight away from the sensor is seen nose-on and its streak collapses to a
// point, so every tracer keeps a minimum on-screen length: seen from behind it becomes a glowing
// dot, as real tracer rounds look, drawn just in front of the round's model.
import * as THREE from 'three';
import { SENSOR } from '../render/heat.js';

const VERT = /* glsl */ `
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec2 iD; // heat, width in px
  uniform vec2 uRes;
  varying float vT;
  varying float vS;
  varying float vAlong;
  varying float vShort;
  varying float vHeat;
  void main() {
    vec4 ca = projectionMatrix * modelViewMatrix * vec4(iA, 1.0);
    vec4 cb = projectionMatrix * modelViewMatrix * vec4(iB, 1.0);
    vec2 sa = ca.xy / ca.w;
    vec2 sb = cb.xy / cb.w;
    vec2 dir = (sb - sa) * uRes;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 c = mix(ca, cb, position.x);
    c.xy += nrm * position.y * iD.y / uRes * c.w;
    // Stretch a too-short streak (pixels) to its minimum length, centred on itself.
    float minLen = iD.y * 1.6;
    float extra = max(0.0, minLen - len * 0.5);
    c.xy += dir * (position.x - 0.5) * extra * 2.0 / uRes * c.w;
    // Pull it a few metres toward the camera so the round's own model can't hide it.
    c.z -= 0.0002 * c.w;
    gl_Position = c;
    vT = position.x;
    vS = position.y;
    vAlong = position.x * 2.0 - 1.0;
    vShort = clamp(extra / minLen, 0.0, 1.0);
    vHeat = iD.x;
  }`;

const FRAG = /* glsl */ `
  uniform float uThermal;
  varying float vT;
  varying float vS;
  varying float vAlong;
  varying float vShort;
  varying float vHeat;
  void main() {
    float across = 1.0 - vS * vS;
    // A long streak fades toward its tail; a nose-on one is an evenly lit, round-edged dot.
    float along = mix(mix(0.08, 1.0, vT * vT), 1.0 - vAlong * vAlong * 0.85, vShort);
    float v = vHeat * across * along;
    gl_FragColor = vec4(mix(vec3(1.0, 0.42, 0.12) * 2.4, vec3(1.0), uThermal) * v, 1.0);
  }`;

export class Tracers {
  constructor(cap = 900) {
    this.cap = cap;
    this.list = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aA = inst(3);
    this.aB = inst(3);
    this.aD = inst(2);
    g.setAttribute('iA', this.aA);
    g.setAttribute('iB', this.aB);
    g.setAttribute('iD', this.aD);
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = { uRes: { value: new THREE.Vector2(1600, 900) }, uThermal: SENSOR.uThermal };
    this.lines = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
  }

  add(ax, ay, az, bx, by, bz, speed, len, heat, width = 2) {
    if (this.list.length >= this.cap) return;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.list.push({ ax, ay, az, ux: dx / dist, uy: dy / dist, uz: dz / dist, dist, speed, len, heat, width, t: 0 });
  }

  // A streak that follows a round: drawn each frame from `src.tail` to `src.head` (vectors the
  // round keeps up to date) until `src.done`.
  addLinked(src, heat, width = 2) {
    if (this.list.length >= this.cap || !heat) return;
    this.list.push({ src, heat, width });
  }

  clear() {
    this.list.length = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt, width, height) {
    this.uniforms.uRes.value.set(width, height);
    const L = this.list;
    const A = this.aA.array;
    const B = this.aB.array;
    const D = this.aD.array;
    let n = 0;
    for (let i = 0; i < L.length; ) {
      const tr = L[i];
      const o = n * 3;
      if (tr.src) {
        if (tr.src.done) {
          L[i] = L[L.length - 1];
          L.pop();
          continue;
        }
        tr.src.tail.toArray(A, o);
        tr.src.head.toArray(B, o);
      } else {
        tr.t += dt;
        const head = Math.min(tr.dist, tr.t * tr.speed);
        const tail = Math.max(0, tr.t * tr.speed - tr.len);
        if (tail >= tr.dist) {
          L[i] = L[L.length - 1];
          L.pop();
          continue;
        }
        A[o] = tr.ax + tr.ux * tail;
        A[o + 1] = tr.ay + tr.uy * tail;
        A[o + 2] = tr.az + tr.uz * tail;
        B[o] = tr.ax + tr.ux * head;
        B[o + 1] = tr.ay + tr.uy * head;
        B[o + 2] = tr.az + tr.uz * head;
      }
      D[n * 2] = tr.heat;
      D[n * 2 + 1] = tr.width;
      n++;
      i++;
    }
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.aD.needsUpdate = true;
    this.geometry.instanceCount = n;
  }
}

// Soft dark ellipses on the ground under vehicles and soldiers: the ambient occlusion where they
// meet the ground, which the sun's shadow map alone does not give (it leaves a lit gap under a
// truck's chassis). One instanced draw; faint in thermal, where shaded ground is only a little cooler.
import * as THREE from 'three';
import { SENSOR } from './heat.js';
import { blobTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class ContactShadows {
  constructor(scene, cap = 600) {
    this.cap = cap;
    this.n = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: blobTexture() }, uThermal: SENSOR.uThermal },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vK;
        void main() {
          vUv = uv;
          vK = instanceColor.r;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uThermal;
        varying vec2 vUv;
        varying float vK;
        void main() {
          float a = texture2D(uMap, vUv).a * vK * mix(0.62, 0.25, uThermal);
          if (a < 0.003) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.count = 0;
    scene.add(mesh);
    this.mesh = mesh;
  }

  begin() {
    this.n = 0;
  }

  // Ellipse w (across) x l (along the heading) metres under (x, y, z); k = darkness 0..1.
  push(x, y, z, yaw, w, l, k = 1) {
    if (this.n >= this.cap) return;
    _q.setFromAxisAngle(_up, yaw).multiply(FLAT);
    _p.set(x, y + 0.04, z);
    _s.set(w, l, 1);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    this.mesh.instanceColor.array[this.n * 3] = k;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

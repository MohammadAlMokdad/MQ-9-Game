// A dynamic InstancedMesh refilled every frame: begin(), push() each visible thing, end().
// Per-instance color is used as a heat multiplier (cooling corpses, burning wrecks).
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class InstancedBatch {
  constructor(geometry, material, capacity, shadows = false) {
    this.capacity = capacity;
    this.n = 0;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    this.mesh = mesh;
  }

  begin() {
    this.n = 0;
  }

  // r alone is a thermal heat multiplier; r, g, b is a daylight color tint.
  push(x, y, z, yaw, pitch, roll, scale, r, g = r, b = r) {
    if (this.n >= this.capacity) return;
    _e.set(pitch, yaw, roll);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(scale, scale, scale);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    const c = this.mesh.instanceColor.array;
    const o = this.n * 3;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
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

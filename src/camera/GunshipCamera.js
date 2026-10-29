// The sensor turret: the aircraft flies a left-hand pylon turn around the compound while the
// camera stays locked on a ground point the player slews with the mouse. The image rotates
// as the plane circles, as it does from a real gunship.
import * as THREE from 'three';
import { CAMERA, MAP } from '../config.js';
import { noise1 } from '../core/rng.js';
import { heightAt } from '../world/terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const REF_FOV = CAMERA.fov; // sensitivity, sway and shake are tuned at 1x

export class GunshipCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(REF_FOV, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.pos = this.camera.position;
    this.aim = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, -1, 0);
    this.gunPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.theta = 0;
    this.fov = REF_FOV;
    this.trauma = 0;
    this.t = 0;
    this.zoom = CAMERA.zooms[0]; // magnification: 1, 2 or 3
    this.sensMul = 1;
    // Jolt spring: angular offset (rad at 1x) and its rate, left/right and up/down.
    this.kx = 0;
    this.ky = 0;
    this.kvx = 0;
    this.kvy = 0;
  }

  reset() {
    this.theta = Math.random() * Math.PI * 2;
    this.aim.set(0, 0, 0);
    this.trauma = 0;
    this.kx = this.ky = this.kvx = this.kvy = 0;
    this.zoom = CAMERA.zooms[0];
  }

  // Jolts the view by about `amount` rad (at 1x; the same number of pixels at any zoom). With
  // no direction it goes a random way, as a blast's shockwave does; recoil pushes the view up.
  kick(amount, dirX = null, dirY = null) {
    if (!amount) return;
    let x = dirX;
    let y = dirY;
    if (x === null) {
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * 0.8;
      y = Math.sin(a);
    }
    // An impulse of v gives a peak swing of about v / omega.
    const w = 2 * Math.PI * CAMERA.kickFreq;
    this.kvx += x * amount * w;
    this.kvy += y * amount * w;
  }

  // Next magnification, wrapping from the highest back to 1x.
  cycleZoom() {
    const z = CAMERA.zooms;
    this.zoom = z[(z.indexOf(this.zoom) + 1) % z.length];
  }

  addTrauma(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  // Mouse deltas become angular slews of the line of sight, re-intersected with the ground.
  slew(mdx, mdy) {
    const k = CAMERA.sensitivity * this.sensMul * (this.fov / REF_FOV);
    const dx = this.aim.x - this.pos.x;
    const dz = this.aim.z - this.pos.z;
    let yaw = Math.atan2(dx, dz);
    let pitch = Math.atan2(-this.pos.y, Math.hypot(dx, dz));
    yaw -= mdx * k;
    pitch = Math.max(-1.5, Math.min(-0.12, pitch - mdy * k));
    const cp = Math.cos(pitch);
    const t = -this.pos.y / Math.sin(pitch);
    let ax = this.pos.x + Math.sin(yaw) * cp * t;
    let az = this.pos.z + Math.cos(yaw) * cp * t;
    const r = Math.hypot(ax, az);
    if (r > MAP.aimRadius) {
      ax *= MAP.aimRadius / r;
      az *= MAP.aimRadius / r;
    }
    this.aim.set(ax, 0, az);
  }

  update(dt, mdx, mdy, attract) {
    this.t += dt;
    const omega = (Math.PI * 2) / CAMERA.orbitPeriod;
    this.theta += dt * omega;
    this.pos.set(Math.cos(this.theta) * CAMERA.orbitRadius, CAMERA.altitude, -Math.sin(this.theta) * CAMERA.orbitRadius);
    this.vel.set(-Math.sin(this.theta), 0, -Math.cos(this.theta)).multiplyScalar(CAMERA.orbitRadius * omega);

    const targetFov = CAMERA.fov / this.zoom;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * CAMERA.fovLerp);

    if (attract) this.aim.set(Math.sin(this.t * 0.07) * 90, 0, Math.cos(this.t * 0.05) * 90);
    else if (mdx || mdy) this.slew(mdx, mdy);
    this.target.set(this.aim.x, heightAt(this.aim.x, this.aim.z), this.aim.z);

    const cam = this.camera;
    cam.up.copy(UP);
    cam.lookAt(this.target);
    const fs = this.fov / REF_FOV;
    cam.rotateY(fs * (CAMERA.swayA * noise1(this.t * 0.25, 1) + CAMERA.swayB * noise1(this.t * 1.3, 2)));
    cam.rotateX(fs * (CAMERA.swayA * noise1(this.t * 0.25, 3) + CAMERA.swayB * noise1(this.t * 1.3, 4)));
    cam.getWorldDirection(this.aimDir); // the crosshair ray: sway included, shake not

    this.trauma = Math.max(0, this.trauma - CAMERA.traumaDecay * dt);
    const tr2 = this.trauma * this.trauma;
    if (tr2 > 0) {
      const tt = this.t * CAMERA.shakeFreq;
      cam.rotateY(tr2 * CAMERA.shakeAngle * fs * noise1(tt, 5));
      cam.rotateX(tr2 * CAMERA.shakeAngle * fs * noise1(tt, 6));
      cam.rotateZ(tr2 * CAMERA.shakeRoll * noise1(tt, 7));
    }
    // Jolt spring, in small steps so it stays stable at any frame rate.
    const w = 2 * Math.PI * CAMERA.kickFreq;
    const c = 2 * CAMERA.kickDamp * w;
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.kvx += (-w * w * this.kx - c * this.kvx) * h;
      this.kvy += (-w * w * this.ky - c * this.kvy) * h;
      this.kx += this.kvx * h;
      this.ky += this.kvy * h;
    }
    if (this.kx || this.ky) {
      cam.rotateY(this.kx * fs);
      cam.rotateX(this.ky * fs);
    }
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // The guns sit on the left side of the fuselage, aft of the sensor ball (the sensor looks out
    // the left side, so its right is the aircraft's nose) and a little below it.
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.gunPos.copy(this.pos).addScaledVector(this.right, -12);
    this.gunPos.y -= 4;
  }

  // Aim readouts for the HUD.
  get slantRange() {
    return this.pos.distanceTo(this.target);
  }
}

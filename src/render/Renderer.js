// WebGL renderer + post chain: multisampled HDR scene render -> bloom -> sensor pass.
// The scene is rendered in linear light; the sensor pass tone-maps daylight and builds the FLIR image.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ThermalShader } from './ThermalShader.js';
import { SENSOR } from './heat.js';
import { RENDER } from '../config.js';

// Sensor modes, cycled with F: daylight colour TV, thermal in a rainbow palette, thermal
// black-hot.
export const MODES = ['TV', 'RAINBOW', 'BHOT'];
// Modes saved by older versions: white-hot became the rainbow palette.
const RENAMED = { WHOT: 'RAINBOW' };

export class Renderer {
  constructor(canvas, scene, camera) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.info.autoReset = false; // count the whole post chain, not just the last pass
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun's shadow map is redrawn every other frame: the world is mostly static and the
    // shadow frustum covers more than the view, so a frame of lag on moving units is invisible.
    this.renderer.shadowMap.autoUpdate = false;
    this.frameNo = 0;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.width = 1;
    this.height = 1;

    // Stencil is for the crater holes. Nothing reads depth/stencil after the scene pass, and
    // resolving a multisampled depth-stencil buffer every frame costs ~2/3 of the frame on some GPUs.
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: RENDER.msaa,
      stencilBuffer: true,
      resolveDepthBuffer: false,
      resolveStencilBuffer: false,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 1.05);
    // Glow is soft by nature: blur from quarter resolution instead of half.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.bloomDay = { strength: 0.32, radius: 0.55, threshold: 2.6 };
    this.bloomThermal = { strength: 0.5, radius: 0.4, threshold: 1.05 };
    this.composer.addPass(this.bloom);
    this.thermal = new ShaderPass(ThermalShader);
    this.composer.addPass(this.thermal);
    this.u = this.thermal.uniforms;

    this.mode = MODES[0];
    this.flash = 0;
    this.gain = 1;
    this.staticT = 0;
    this.time = 0;
  }

  get thermalMode() {
    return this.mode !== 'TV';
  }

  get blackHot() {
    return this.mode === 'BHOT';
  }

  get rainbow() {
    return this.mode === 'RAINBOW';
  }

  setMode(mode) {
    mode = RENAMED[mode] || mode;
    this.mode = MODES.includes(mode) ? mode : MODES[0];
    SENSOR.uThermal.value = this.thermalMode ? 1 : 0;
    Object.assign(this.bloom, this.thermalMode ? this.bloomThermal : this.bloomDay);
    this.addStatic(0.15);
  }

  cycleMode() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.u.uTexel.value.set(1 / w, 1 / h);
  }

  // Daylight camera exposure and airlight (linear haze colour, veil amount).
  setDayLook(exposure, haze, hazeColor) {
    this.u.uExposure.value = exposure;
    this.u.uHaze.value = haze;
    this.u.uHazeCol.value.set(...hazeColor);
  }

  addFlash(v) {
    this.flash = Math.max(this.flash, v);
  }

  dipGain(v) {
    this.gain = Math.min(this.gain, v);
  }

  addStatic(t) {
    this.staticT = Math.max(this.staticT, t);
  }

  render(dt) {
    this.time += dt;
    this.flash *= Math.exp(-dt * 6);
    if (this.flash < 0.002) this.flash = 0;
    this.gain += (1 - this.gain) * Math.min(1, dt * 1.4);
    this.staticT = Math.max(0, this.staticT - dt);

    this.u.uTime.value = this.time;
    SENSOR.uTime.value = this.time;
    this.u.uFlash.value = this.flash;
    this.u.uGain.value = this.gain;
    this.u.uThermal.value = this.thermalMode ? 1 : 0;
    this.u.uBlackHot.value = this.blackHot ? 1 : 0;
    this.u.uRainbow.value = this.rainbow ? 1 : 0;
    this.u.uNoise.value = this.staticT > 0 ? 0.45 : 0.05;
    this.renderer.info.reset();
    if (this.frameNo++ % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
  }
}

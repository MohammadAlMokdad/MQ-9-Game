// Final post pass: the gunship sensor image.
//  Thermal: FLIR image, either black-hot grayscale or a rainbow palette (cold indigo and blue
//           through cyan, green, yellow, orange and red to white-hot), with soft optics,
//           edge-enhancement halos, automatic gain, saturation flash, fixed-pattern noise and grain.
//  Daylight: the colour TV camera. The scene arrives as linear HDR light; this pass adds the
//           long-range look (airlight haze, optics softness, edge sharpening, slight colour
//           fringing, heat shimmer), applies filmic tone mapping and encodes for the display.
import * as THREE from 'three';

export const ThermalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uTime: { value: 0 },
    uThermal: { value: 1 },
    uBlackHot: { value: 0 },
    uRainbow: { value: 0 },
    uFlash: { value: 0 },
    uGain: { value: 1 },
    uNoise: { value: 0.05 },
    uBypass: { value: 0 },
    uExposure: { value: 1 },
    uHaze: { value: 0.12 },
    uHazeCol: { value: new THREE.Vector3(1.2, 1.32, 1.5) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uTime;
    uniform float uThermal;
    uniform float uBlackHot;
    uniform float uRainbow;
    uniform float uFlash;
    uniform float uGain;
    uniform float uNoise;
    uniform float uBypass;
    uniform float uExposure;
    uniform float uHaze;
    uniform vec3 uHazeCol;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    vec3 tex(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }

    vec3 ring(vec2 uv, float r) {
      vec2 o = uTexel * r;
      return (tex(uv + vec2(o.x, 0.0)) + tex(uv - vec2(o.x, 0.0)) + tex(uv + vec2(0.0, o.y)) + tex(uv - vec2(0.0, o.y))
            + tex(uv + o * 0.7071) + tex(uv - o * 0.7071) + tex(uv + vec2(o.x, -o.y) * 0.7071) + tex(uv + vec2(-o.x, o.y) * 0.7071)) * 0.125;
    }

    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    // FLIR-style rainbow palette, linear between stops: t = 0 coldest, 1 hottest.
    vec3 seg(vec3 c, vec3 to, float t, float a, float b) { return mix(c, to, clamp((t - a) / (b - a), 0.0, 1.0)); }
    vec3 rainbow(float t) {
      t = clamp(t, 0.0, 1.0);
      vec3 c = vec3(0.03, 0.0, 0.1);
      c = seg(c, vec3(0.2, 0.02, 0.5), t, 0.0, 0.16);
      c = seg(c, vec3(0.02, 0.2, 0.9), t, 0.16, 0.32);
      c = seg(c, vec3(0.0, 0.72, 0.92), t, 0.32, 0.46);
      c = seg(c, vec3(0.12, 0.84, 0.25), t, 0.46, 0.58);
      c = seg(c, vec3(0.96, 0.92, 0.1), t, 0.58, 0.7);
      c = seg(c, vec3(1.0, 0.5, 0.02), t, 0.7, 0.81);
      c = seg(c, vec3(0.94, 0.06, 0.04), t, 0.81, 0.91);
      c = seg(c, vec3(1.0, 0.92, 0.9), t, 0.91, 1.0);
      return c;
    }

    // ACES filmic (Hill's RRT+ODT fit, as in three.js).
    vec3 rrtOdt(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 c) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c = inM * (c / 0.6);
      c = rrtOdt(c);
      return clamp(outM * c, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }

    void main() {
      if (uBypass > 0.5) {
        vec3 b = tex(vUv);
        gl_FragColor = vec4(uThermal > 0.5 ? clamp(b, 0.0, 1.0) : toSRGB(aces(b * uExposure)), 1.0);
        return;
      }
      // Heat shimmer: the long air path wobbles the image by a fraction of a pixel.
      vec2 sh = vec2(vnoise(vUv * vec2(9.0, 5.0) + uTime * 0.8), vnoise(vUv * vec2(7.0, 11.0) - uTime * 0.6)) - 0.5;
      vec2 uv = vUv + sh * uTexel * 0.9;
      vec3 c = tex(uv);
      vec3 near = ring(uv, 1.0);
      vec3 wide = ring(uv, 3.5);
      vec2 dv = vUv - 0.5;
      dv.x *= uTexel.y / uTexel.x * 0.6;
      float vig = 1.0 - 0.5 * smoothstep(0.38, 0.85, length(dv));
      float grain = (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uNoise;
      vec3 outc;

      if (uThermal > 0.5) {
        // Soft sensor, then unsharp mask for the FLIR halo. The rainbow palette turns small
        // brightness flicker into colour speckle, so it gets a slightly softer sensor.
        float h = mix(lum(c), lum(near), uRainbow > 0.5 ? 0.55 : 0.4);
        h += (h - lum(wide)) * 0.7;
        // Automatic gain control: contrast dips after a big blast and recovers.
        h = (h - 0.5) * uGain * 1.06 + 0.5;
        h = clamp(h, 0.0, 1.0);
        h = h * h * (3.0 - 2.0 * h) * 0.35 + h * 0.65;
        h = mix(h, 1.0, uFlash);
        if (uBlackHot > 0.5) h = 1.0 - h;
        h += grain;
        h += (hash(vec2(floor(gl_FragCoord.x), 7.7)) - 0.5) * 0.016;
        h += (hash(vec2(3.1, floor(gl_FragCoord.y) + floor(uTime * 24.0))) - 0.5) * 0.01;
        h *= 0.975 + 0.025 * sin(gl_FragCoord.y * 3.14159);
        // Rainbow span: sun-warmed ground (heat 0.52-0.7) lands in purple, blue and cyan, warm
        // bodies in green and yellow, engines, fires and the hottest people in orange, red, white.
        if (uRainbow > 0.5) outc = rainbow(pow(clamp((h - 0.25) / 0.75, 0.0, 1.0), 1.5)) * mix(1.0, vig, 0.7);
        else outc = vec3(h * vig);
      } else {
        // Lateral colour: red and blue land a fraction of a pixel apart toward the edges.
        vec2 ca = (vUv - 0.5) * uTexel * 2.2;
        vec3 col = vec3(tex(uv + ca).r, c.g, tex(uv - ca).b);
        // Optics: a little softness, then the camera's edge enhancement.
        col = mix(col, near, 0.2);
        col += (col - wide) * 0.42;
        col = max(col, vec3(0.0));
        // Airlight: the long slant path veils the scene, a little more toward the far (top) edge.
        float hz = clamp(uHaze * mix(0.82, 1.2, vUv.y), 0.0, 1.0);
        col = mix(col, uHazeCol, hz);
        col = aces(col * uExposure);
        col = toSRGB(col);
        // Sensor grade: a touch of desaturation and a gentle contrast curve.
        float l = lum(col);
        col = mix(vec3(l), col, 0.8);
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
        col = mix(col, vec3(1.0), uFlash * 0.22);
        col += grain * 0.55;
        outc = col * mix(1.0, vig, 0.8);
      }
      gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
    }`,
};

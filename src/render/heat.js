// Surfaces carry two looks: a real colour (albedo) for the daylight TV camera and a "heat"
// value for the thermal camera. One shared uniform switches every material between them.
//
// Daylight is physically based: albedo (stored as display-space colour) is converted to
// linear light, shaded by the sun and a sky environment map with roughness, normal maps and
// weathering, and tone-mapped in the sensor pass. Thermal keeps a plain diffuse heat model
// (sky reflections, specular and metalness are switched off) so the FLIR image stays a heat map.
// Photo textures (CC0, Poly Haven) supply colour and relief in daylight and fine heat detail in
// thermal.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DETAIL_MEAN, detailTexture } from './textures.js';

export const SUN = new THREE.Vector3(0.42, 0.8, 0.3).normalize();

// uThermal: 1 = thermal, 0 = daylight colour. Shared by every sensor-aware shader in the game.
// uTime drives water ripples and other small animated surface effects.
export const SENSOR = { uThermal: { value: 1 }, uTime: { value: 0 } };

// Hex colour to display-space rgb. Daylight shaders convert these to linear themselves.
export function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// Display-space hex colour to linear rgb (for lights, fog and clear colours in daylight).
export function linear(hex) {
  return rgb(hex).map((v) => Math.pow(v, 2.2));
}

// Writes heat (as the vertex colour) and albedo into a geometry.
export function paint(geom, heat, color = 0xb0aaa0) {
  const n = geom.attributes.position.count;
  const h = new Float32Array(n * 3).fill(heat);
  const a = new Float32Array(n * 3);
  const [r, g, b] = Array.isArray(color) ? color : rgb(color);
  for (let i = 0; i < n; i++) {
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(h, 3));
  geom.setAttribute('albedo', new THREE.BufferAttribute(a, 3));
  return geom;
}

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

// Normalizes a primitive (non-indexed, no uv), places it, and paints it so it can merge with anything.
export function part(geom, heat, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz)));
  g.translate(x, y, z);
  return paint(g, heat, color);
}

export const box = (w, h, d, heat, color, x, y, z, ry = 0) => part(new THREE.BoxGeometry(w, h, d), heat, color, x, y, z, 0, ry, 0);

export function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

// Copies a prop geometry, transformed, optionally scaling its heat.
export function placed(geom, x, y, z, ry = 0, s = 1, heatMul = 1) {
  const g = geom.clone();
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e.set(0, ry, 0)), new THREE.Vector3(s, s, s)));
  if (heatMul !== 1) {
    const c = g.attributes.color.array;
    for (let i = 0; i < c.length; i++) c[i] *= heatMul;
  }
  return g;
}

// ---- Shared GLSL ----

export const GLSL_COMMON = /* glsl */ `
  float sLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
  float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Triplanar sample. Flat walls and floors face one axis, so they take a single sample (with
  // explicit gradients, as the branch is not uniform at edges); only slanted faces blend all three.
  vec3 triTex(sampler2D t, vec3 p, vec3 w) {
    vec3 gx = dFdx(p);
    vec3 gy = dFdy(p);
    vec3 r = vec3(0.0);
    if (w.x > 0.97) r = textureGrad(t, p.zy, gx.zy, gy.zy).rgb;
    else if (w.y > 0.97) r = textureGrad(t, p.xz, gx.xz, gy.xz).rgb;
    else if (w.z > 0.97) r = textureGrad(t, p.xy, gx.xy, gy.xy).rgb;
    else r = textureGrad(t, p.zy, gx.zy, gy.zy).rgb * w.x + textureGrad(t, p.xz, gx.xz, gy.xz).rgb * w.y + textureGrad(t, p.xy, gx.xy, gy.xy).rgb * w.z;
    return r;
  }
  // Triplanar tangent-space normal map, returned in world space. Each projection's tangent frame
  // is (dP/du, dP/dv, axis), which is exact on the axis-aligned faces of buildings.
  vec3 triNormal(sampler2D t, vec3 p, vec3 n, float amt) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z + 1e-5);
    vec3 s = sign(n + 1e-5);
    vec3 gx = dFdx(p);
    vec3 gy = dFdy(p);
    vec3 tx = vec3(0.0, 0.0, 1.0);
    vec3 ty = vec3(0.0, 0.0, 1.0);
    vec3 tz = vec3(0.0, 0.0, 1.0);
    if (w.x > 0.01) tx = textureGrad(t, p.zy, gx.zy, gy.zy).xyz * 2.0 - 1.0;
    if (w.y > 0.01) ty = textureGrad(t, p.xz, gx.xz, gy.xz).xyz * 2.0 - 1.0;
    if (w.z > 0.01) tz = textureGrad(t, p.xy, gx.xy, gy.xy).xyz * 2.0 - 1.0;
    tx.xy *= amt;
    ty.xy *= amt;
    tz.xy *= amt;
    vec3 nx = vec3(tx.z * s.x, tx.y, tx.x);
    vec3 ny = vec3(ty.x, ty.z * s.y, ty.y);
    vec3 nz = vec3(tz.x, tz.y, tz.z * s.z);
    return normalize(nx * w.x + ny * w.y + nz * w.z);
  }
  // Tangent frame from screen-space derivatives (no tangent attribute needed).
  mat3 surfTBN(vec3 N, vec3 p, vec2 uv) {
    vec3 dp1 = dFdx(p);
    vec3 dp2 = dFdy(p);
    vec2 duv1 = dFdx(uv);
    vec2 duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
    return mat3(T * invmax, B * invmax, N);
  }
  // Weathering for daylight: splash-back dirt at the foot of walls, rain streaks running down,
  // and blotchy dirt on flat tops. aoH = height above the ground in metres.
  vec3 surfWeather(vec3 day, vec3 wp, vec3 wn, float aoH, float amt) {
    float vert = 1.0 - abs(wn.y);
    float splash = exp(-max(aoH, 0.0) / 0.9);
    float streak = sNoise(vec2((wp.x + wp.z) * 1.3, wp.y * 0.12));
    float streak2 = sNoise(vec2((wp.x - wp.z) * 0.55 + 17.0, wp.y * 0.05));
    float blotch = sNoise(wp.xz * 0.12 + wp.y * 0.07) * 0.6 + sNoise(wp.xz * 0.53) * 0.4;
    float g = vert * (splash * 0.6 + smoothstep(0.62, 1.0, streak) * 0.24 + smoothstep(0.55, 0.92, streak2) * 0.14)
      + (1.0 - vert) * smoothstep(0.45, 0.85, blotch) * 0.28;
    return day * mix(vec3(1.0), vec3(0.6, 0.53, 0.45), clamp(g * amt, 0.0, 1.0));
  }
`;

// Drifting cloud shadows (fair-weather cumulus): patches a few hundred metres across that dim the
// sun. Thermal shows them too, more weakly (shaded ground is only a little cooler).
export const CLOUD = { uCloudTime: SENSOR.uTime, uCloudCover: { value: 0.6 } };
export const GLSL_CLOUD = /* glsl */ `
  uniform float uCloudTime;
  uniform float uCloudCover;
  float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float cloudShade(vec2 p) {
    vec2 q = p / 480.0 + vec2(uCloudTime * 0.0042, uCloudTime * 0.0017);
    float n = cNoise(q) * 0.55 + cNoise(q * 2.13 + 3.7) * 0.3 + cNoise(q * 4.31 + 7.1) * 0.15;
    return mix(1.0, 0.3, smoothstep(uCloudCover, uCloudCover + 0.12, n));
  }
`;
export const FRAG_CLOUD = /* glsl */ `
  {
    float cs = mix(cloudShade(vHWPos.xz), 1.0, uThermal * 0.55);
    reflectedLight.directDiffuse *= cs;
    reflectedLight.directSpecular *= cs;
  }
`;

// ---- Surface materials ----

const VERT_DECL = /* glsl */ `
  attribute vec3 albedo;
  varying vec3 vAlbedo;
  varying vec3 vHWPos;
  varying vec3 vHWNrm;
  varying vec2 vMUv;
  #ifdef SURF_AOH
    attribute float aoH;
    varying float vAoH;
  #endif
  #ifdef SURF_PAINT
    attribute float paint;
  #endif
`;
const VERT_BODY = /* glsl */ `
  vAlbedo = albedo;
  #ifdef USE_INSTANCING_COLOR
    #ifdef SURF_PAINT
      // Only painted parts (vehicle bodies, clothing) take the per-instance colour; a negative
      // colour (burnt-out wreck) applies to the whole model.
      vec3 icol = instanceColor.rgb;
      float allOver = step(icol.r, 0.0);
      vAlbedo *= mix(vec3(1.0), abs(icol), max(paint, allOver));
    #else
      vAlbedo *= instanceColor.rgb;
    #endif
  #endif
  vec4 hWP = vec4(transformed, 1.0);
  vec3 hN = objectNormal;
  #ifdef USE_INSTANCING
    hWP = instanceMatrix * hWP;
    hN = mat3(instanceMatrix) * hN;
  #endif
  hWP = modelMatrix * hWP;
  vHWPos = hWP.xyz;
  vHWNrm = normalize(mat3(modelMatrix) * hN);
  #ifdef SURF_UV
    vMUv = uv;
  #endif
  #ifdef SURF_AOH
    vAoH = aoH;
  #endif
`;

const FRAG_DECL = /* glsl */ `
  uniform float uThermal;
  uniform float uTime;
  uniform sampler2D uDetail;
  uniform float uDetailAmt;
  uniform float uTexScale;
  uniform float uTexAmt;
  uniform float uTexMean;
  uniform float uNorAmt;
  uniform float uAlphaDay;
  uniform float uAlphaTh;
  uniform float uGrime;
  uniform float uRoughVar;
  #ifdef SURF_TEX
    uniform sampler2D uTex;
  #endif
  #ifdef SURF_NOR
    uniform sampler2D uNor;
  #endif
  varying vec3 vAlbedo;
  varying vec3 vHWPos;
  varying vec3 vHWNrm;
  varying vec2 vMUv;
  #ifdef SURF_AOH
    varying float vAoH;
  #endif
  // World normal facing the viewer's side of the surface. Double-sided materials (downloaded
  // vehicles, whose single-sided panels often face either way) see back faces too, and those
  // must shade, weather and darken like the side they show.
  vec3 surfNrm() {
    #ifdef DOUBLE_SIDED
      return gl_FrontFacing ? vHWNrm : -vHWNrm;
    #else
      return vHWNrm;
    #endif
  }
  ${GLSL_COMMON}
  ${GLSL_CLOUD}
`;

const FRAG_COLOR = /* glsl */ `
  #include <color_fragment>
  float surfLum = 0.45;
  {
    vec3 tw = abs(vHWNrm);
    tw /= (tw.x + tw.y + tw.z + 1e-4);
    float dl = sLum(triTex(uDetail, vHWPos * 0.2, tw)) / ${DETAIL_MEAN.toFixed(3)};
    dl = mix(1.0, dl, uDetailAmt);
    vec3 tc = vec3(1.0);
    float tl = 1.0;
    #ifdef SURF_TEX
      #ifdef SURF_UV
        tc = texture2D(uTex, vMUv * uTexScale).rgb;
      #else
        tc = triTex(uTex, vHWPos * uTexScale, tw);
      #endif
      surfLum = sLum(tc);
      tl = mix(1.0, surfLum / uTexMean, uTexAmt * 0.5);
      #ifndef SURF_RAW
        tc = mix(vec3(1.0), tc / uTexMean, uTexAmt);
      #endif
    #endif
    float heat = vColor.r * tl * dl;
    vec3 day = vAlbedo * tc * mix(1.0, dl, 0.6);
    #ifdef SURF_GRIME
      #ifdef SURF_AOH
        day = surfWeather(day, vHWPos, surfNrm(), vAoH, uGrime);
      #else
        day = surfWeather(day, vHWPos, surfNrm(), 50.0, uGrime);
      #endif
    #endif
    #ifdef SURF_LAWN
      // Mowing stripes and a few drier patches.
      day *= 0.94 + 0.06 * sign(sin(vHWPos.x * 1.9635 + 0.4));
      day *= 0.9 + 0.2 * sNoise(vHWPos.xz * 0.35);
    #endif
    diffuseColor.rgb = mix(toLinear(day), vec3(heat), uThermal);
    #ifdef SURF_ALPHA
      diffuseColor.a = mix(uAlphaDay, uAlphaTh, uThermal);
    #endif
  }
`;

// Thermal is a diffuse heat map: no gloss, no metal, no sky reflection or sky fill.
const FRAG_ROUGH = /* glsl */ `
  roughnessFactor = mix(clamp(roughnessFactor * (1.0 + uRoughVar * (0.45 - surfLum)), 0.03, 1.0), 1.0, uThermal);
`;
const FRAG_METAL = /* glsl */ `
  metalnessFactor *= 1.0 - uThermal;
`;
const FRAG_NORMAL = /* glsl */ `
  #ifdef SURF_NOR
  {
    #ifdef SURF_UV
      vec3 mapN = texture2D(uNor, vMUv * uTexScale).xyz * 2.0 - 1.0;
      mapN.xy *= uNorAmt;
      #ifdef SURF_NOR_FLIPY
        // glTF textures are not flipped vertically, so their tangent-space green runs the other way.
        mapN.y = -mapN.y;
      #endif
      normal = normalize(surfTBN(normal, -vViewPosition, vMUv * uTexScale) * mapN);
    #else
      vec3 nW = triNormal(uNor, vHWPos * uTexScale, normalize(surfNrm()), uNorAmt);
      normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    #endif
  }
  #endif
`;
export const FRAG_IBL = /* glsl */ `
  iblIrradiance *= 1.0 - uThermal;
  radiance *= 1.0 - uThermal;
`;
// Contact darkening at the foot of walls and under overhangs (sky light only; the sun's
// occlusion comes from the shadow map).
const FRAG_AO = /* glsl */ `
  #ifdef SURF_AOH
  {
    float ao = 1.0 - 0.55 * (1.0 - abs(vHWNrm.y)) * exp(-max(vAoH, 0.0) / 0.8);
    ao *= 1.0 - 0.45 * max(0.0, -surfNrm().y);
    ao = mix(ao, 1.0, uThermal);
    reflectedLight.indirectDiffuse *= ao;
    reflectedLight.indirectSpecular *= ao;
  }
  #endif
`;

let sharedDetail = null;
export function detail() {
  if (!sharedDetail) sharedDetail = detailTexture();
  return sharedDetail;
}

// Every sensor-aware material registers here so the world can retune them together.
export const SENSOR_MATERIALS = new Set();

// Sensor-aware PBR material.
//  tex     colour texture (.userData.mean = average luminance), mapped triplanar in world space
//          (scale = repeats per metre) or by uv when `uv` is true
//  nor     matching tangent-space normal map (OpenGL convention), norAmt = strength
//  raw     the texture is an albedo atlas (model texture) rather than a tiling detail photo
//  rough / metal / env   daylight roughness, metalness and sky-reflection strength
//  grime   daylight weathering amount; aoH: geometry has an `aoH` (height above ground) attribute
//  alpha   [daylight, thermal] opacity for see-through surfaces (glass)
export function surfaceMaterial({
  tex = null, nor = null, uv = false, scale = 0.25, texAmt = 1, detailAmt = 0.45, norAmt = 1,
  polygonOffset = false, alpha = null, name = '', rough = 0.85, metal = 0, env = 1, roughVar = 0.5,
  grime = 0, aoH = false, raw = false, lawn = false, paint = false, norFlipY = false, side = THREE.FrontSide,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, side });
  mat.name = name;
  mat.envMapIntensity = env;
  if (alpha) {
    mat.transparent = true;
    mat.depthWrite = false;
  }
  if (polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  const flags = { SURF_TEX: !!tex, SURF_NOR: !!nor, SURF_UV: uv, SURF_ALPHA: !!alpha, SURF_GRIME: grime > 0, SURF_AOH: aoH, SURF_RAW: raw, SURF_LAWN: lawn, SURF_PAINT: paint, SURF_NOR_FLIPY: !!nor && norFlipY };
  const defs = Object.entries(flags)
    .filter(([, on]) => on)
    .map(([k]) => `#define ${k}\n`)
    .join('');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uThermal: SENSOR.uThermal,
      uTime: SENSOR.uTime,
      uDetail: { value: detail() },
      uDetailAmt: { value: detailAmt },
      uTex: { value: tex },
      uNor: { value: nor },
      uNorAmt: { value: norAmt },
      uTexScale: { value: scale },
      uTexAmt: { value: texAmt },
      uTexMean: { value: tex?.userData.mean ?? 0.5 },
      uAlphaDay: { value: alpha ? alpha[0] : 1 },
      uAlphaTh: { value: alpha ? alpha[1] : 1 },
      uGrime: { value: grime },
      uRoughVar: { value: roughVar },
      ...CLOUD,
    });
    sh.vertexShader = defs + VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader =
      defs +
      FRAG_DECL +
      sh.fragmentShader
        .replace('#include <color_fragment>', FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_IBL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_CLOUD}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
  };
  const key = `surf2-${name}-${defs.replace(/\s+/g, '')}-${scale}-${texAmt}-${detailAmt}-${norAmt}`;
  mat.customProgramCacheKey = () => key;
  SENSOR_MATERIALS.add(mat);
  return mat;
}

// Material for a textured (realistic) vehicle model: its baked texture atlas carries the paint.
// world: a parked vehicle merged into the static map (grime, contact darkening) rather than an
// instanced unit (per-instance colour on painted parts).
// Double-sided: downloaded models are built to be viewed double-sided (as Sketchfab shows them),
// with single-sided panels and mirrored parts facing either way, so culling back faces would
// punch holes in them.
export function vehicleMaterial(name, map, world = false) {
  return surfaceMaterial({ name, tex: map, uv: true, raw: true, scale: 1, texAmt: 1, detailAmt: 0.12, rough: 0.6, roughVar: 0.4, env: 0.9, grime: world ? 0.3 : 0, aoH: world, paint: !world, side: THREE.DoubleSide });
}

// ---- Ground ----

// Ground: aerial photo textures blended by a land-cover map (packed-dirt yards, tilled fields)
// and darkened by a baked occlusion map around buildings, walls and trees, with normal-mapped
// relief. cover: { map, rect: [minX, minZ, size], fine, fineRect } from World.
export function groundMaterial({ T, cover }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.name = 'ground';
  mat.envMapIntensity = 1;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uThermal: SENSOR.uThermal,
      uGrass: { value: T.aerial_grass_rock },
      uGrassN: { value: T.aerial_grass_rock_nor },
      uDry: { value: T.aerial_ground_rock },
      uYard: { value: T.dirt_aerial_02 },
      uYardN: { value: T.dirt_aerial_02_nor },
      uField: { value: T.raked_dirt },
      uFieldN: { value: T.raked_dirt_nor },
      uMicro: { value: T.dry_ground_rocks },
      uMicroN: { value: T.dry_ground_rocks_nor },
      uMeans: { value: new THREE.Vector4(T.aerial_grass_rock.userData.mean, T.aerial_ground_rock.userData.mean, T.dirt_aerial_02.userData.mean, T.raked_dirt.userData.mean) },
      uMicroMean: { value: T.dry_ground_rocks.userData.mean },
      uCover: { value: cover.map },
      uCoverRect: { value: new THREE.Vector3(...cover.rect) },
      uFine: { value: cover.fine },
      uFineRect: { value: new THREE.Vector3(...cover.fineRect) },
      ...CLOUD,
    });
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader =
      /* glsl */ `
      uniform float uThermal;
      uniform sampler2D uGrass;
      uniform sampler2D uGrassN;
      uniform sampler2D uDry;
      uniform sampler2D uYard;
      uniform sampler2D uYardN;
      uniform sampler2D uField;
      uniform sampler2D uFieldN;
      uniform sampler2D uMicro;
      uniform sampler2D uMicroN;
      uniform vec4 uMeans;
      uniform float uMicroMean;
      uniform sampler2D uCover;
      uniform vec3 uCoverRect;
      uniform sampler2D uFine;
      uniform vec3 uFineRect;
      varying vec3 vAlbedo;
      varying vec3 vHWPos;
      varying vec3 vHWNrm;
      varying vec2 vMUv;
      ${GLSL_COMMON}
      ${GLSL_CLOUD}
    ` +
      sh.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
      float gAO = 1.0;
      float gYard = 0.0;
      float gField = 0.0;
      {
        vec2 p = vHWPos.xz;
        vec3 g1 = texture2D(uGrass, p / 34.0).rgb / uMeans.x;
        vec3 g2 = texture2D(uGrass, p / 151.0 + 0.37).rgb / uMeans.x;
        vec3 col = g1 * mix(vec3(1.0), g2, 0.45);
        // Large drier, sparser patches break up the tiling.
        float n1 = sNoise(p * 0.0045) * 0.62 + sNoise(p * 0.019 + 3.1) * 0.38;
        float dryK = smoothstep(0.5, 0.8, n1);
        vec3 dry = texture2D(uDry, p / 41.0 + 0.21).rgb / uMeans.y;
        col = mix(col, dry * vec3(1.03, 0.98, 0.92), dryK * 0.7);
        vec3 mi = texture2D(uMicro, p / 4.5).rgb / uMicroMean;
        col *= 0.8 + 0.2 * sLum(mi);
        // Land cover: R = packed-dirt yards, G = tilled fields, A = sky occlusion.
        vec4 cv = texture2D(uCover, (p - uCoverRect.xy) / uCoverRect.z);
        float edgeN = sNoise(p * 0.23) - 0.5 + (sNoise(p * 0.9) - 0.5) * 0.4;
        gYard = smoothstep(0.22, 0.78, cv.r + edgeN * 0.35);
        gField = smoothstep(0.3, 0.7, cv.g + edgeN * 0.2);
        vec2 gpx = dFdx(p);
        vec2 gpy = dFdy(p);
        if (gYard > 0.002) {
          vec3 yardC = mix(vec3(1.0), textureGrad(uYard, p / 26.0, gpx / 26.0, gpy / 26.0).rgb / uMeans.z, 0.75);
          col = mix(col, yardC * vec3(0.97, 0.96, 0.94), gYard * 0.85);
        }
        if (gField > 0.002) {
          vec3 fieldC = textureGrad(uField, p / 6.5, gpx / 6.5, gpy / 6.5).rgb / uMeans.w;
          col = mix(col, fieldC * vec3(0.98, 0.9, 0.8), gField * 0.9);
        }
        gAO = cv.a;
        vec2 fUv = (p - uFineRect.xy) / uFineRect.z;
        if (fUv.x > 0.0 && fUv.y > 0.0 && fUv.x < 1.0 && fUv.y < 1.0) gAO = min(gAO, texture2D(uFine, fUv).r);
        float heat = vColor.r * mix(1.0, sLum(col), 0.55 - 0.32 * gYard) * (1.0 + 0.1 * gYard + 0.08 * gField) * mix(0.9, 1.0, gAO);
        vec3 day = toLinear(vAlbedo * col) * mix(1.0, gAO, 0.35);
        diffuseColor.rgb = mix(day, vec3(heat), uThermal);
      }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, uThermal);')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
      {
        vec2 p = vHWPos.xz;
        vec2 npx = dFdx(p);
        vec2 npy = dFdy(p);
        vec3 tn = texture2D(uGrassN, p / 34.0).xyz * 2.0 - 1.0;
        if (gYard > 0.002) tn = mix(tn, textureGrad(uYardN, p / 26.0, npx / 26.0, npy / 26.0).xyz * 2.0 - 1.0, gYard * 0.93);
        if (gField > 0.002) tn = mix(tn, textureGrad(uFieldN, p / 6.5, npx / 6.5, npy / 6.5).xyz * 2.0 - 1.0, gField * 0.9);
        vec3 nM = texture2D(uMicroN, p / 4.5).xyz * 2.0 - 1.0;
        tn.xy = tn.xy * 1.2 + nM.xy * 0.5;
        tn = normalize(tn);
        vec3 N = normalize(vHWNrm);
        vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
        vec3 B = cross(T, N);
        vec3 nW = normalize(T * tn.x + B * tn.y + N * tn.z);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`,
        )
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_IBL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_CLOUD}`)
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= mix(gAO, mix(1.0, gAO, 0.5), uThermal);
      reflectedLight.indirectSpecular *= gAO;`,
        );
  };
  mat.customProgramCacheKey = () => 'ground2';
  SENSOR_MATERIALS.add(mat);
  return mat;
}

// ---- Dirt roads ----

// Roads are ribbons draped over the ground: uv.x runs across (0..width m), uv.y along (m).
// Tyre-tracked sand runs along the road, edges fray into the grass, and the two wheel ruts
// are worn darker. Alpha-blended so the edges melt into the terrain.
export function roadMaterial(T) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, transparent: true, depthWrite: false });
  mat.name = 'road';
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uThermal: SENSOR.uThermal,
      uRoad: { value: T.aerial_sand },
      uRoadN: { value: T.aerial_sand_nor },
      uDirt: { value: T.dirt_aerial_02 },
      uMeans: { value: new THREE.Vector2(T.aerial_sand.userData.mean, T.dirt_aerial_02.userData.mean) },
      ...CLOUD,
    });
    sh.vertexShader =
      `#define SURF_UV\nattribute float roadW;\nvarying float vRoadW;\n${VERT_DECL}` +
      sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}\nvRoadW = roadW;`);
    sh.fragmentShader =
      /* glsl */ `
      uniform float uThermal;
      uniform sampler2D uRoad;
      uniform sampler2D uRoadN;
      uniform sampler2D uDirt;
      uniform vec2 uMeans;
      varying float vRoadW;
      varying vec3 vAlbedo;
      varying vec3 vHWPos;
      varying vec3 vHWNrm;
      varying vec2 vMUv;
      ${GLSL_COMMON}
      ${GLSL_CLOUD}
    ` +
      sh.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
      vec2 rUv = vec2(vMUv.x / 9.0, vMUv.y / 9.0);
      {
        float W = vRoadW;
        float u = vMUv.x;
        float edge = min(u, W - u);
        float ragged = (sNoise(vec2(vMUv.y * 0.35, W)) - 0.5) * 1.6 + (sNoise(vec2(vMUv.y * 1.7, 5.0)) - 0.5) * 0.6;
        float a = smoothstep(0.0, 1.0, (edge + ragged * 0.6) / max(0.6, W * 0.22));
        vec3 c = texture2D(uRoad, rUv).rgb / uMeans.x;
        vec3 d = texture2D(uDirt, vHWPos.xz / 22.0).rgb / uMeans.y;
        float mixD = 0.35 + 0.35 * sNoise(vHWPos.xz * 0.05);
        c = mix(c, d, mixD);
        // Wheel ruts on the main roads.
        float rut = W > 8.0 ? exp(-pow((abs(u - W * 0.5) - 0.95) / 0.35, 2.0)) : 0.0;
        c *= 1.0 - 0.12 * rut;
        float heat = vColor.r * mix(1.0, sLum(c), 0.5);
        diffuseColor.rgb = mix(toLinear(vAlbedo * c), vec3(heat), uThermal);
        diffuseColor.a = a * 0.95;
      }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, uThermal);')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
      {
        vec3 mapN = texture2D(uRoadN, rUv).xyz * 2.0 - 1.0;
        mapN.xy *= 1.1;
        normal = normalize(surfTBN(normal, -vViewPosition, rUv) * mapN);
      }`,
        )
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_IBL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_CLOUD}`);
  };
  mat.customProgramCacheKey = () => 'road2';
  SENSOR_MATERIALS.add(mat);
  return mat;
}

// ---- Water ----

// Pool and fountain water: the tiled floor seen through clear water, rippled reflections of the
// sky and sun glints in daylight; cold and flat in thermal. Albedo = what the water looks like
// from above (turquoise for the pool).
export function waterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0 });
  mat.name = 'water';
  mat.envMapIntensity = 1.4;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uThermal = SENSOR.uThermal;
    sh.uniforms.uTime = SENSOR.uTime;
    Object.assign(sh.uniforms, CLOUD);
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader =
      /* glsl */ `
      uniform float uThermal;
      uniform float uTime;
      varying vec3 vAlbedo;
      varying vec3 vHWPos;
      varying vec3 vHWNrm;
      varying vec2 vMUv;
      ${GLSL_COMMON}
      ${GLSL_CLOUD}
      vec2 rippleGrad(vec2 p, float t) {
        float e = 0.05;
        float h0 = sNoise(p + vec2(t * 0.6, t * 0.3)) + 0.5 * sNoise(p * 2.3 - vec2(t * 0.4, -t * 0.7));
        float hx = sNoise(p + vec2(e, 0.0) + vec2(t * 0.6, t * 0.3)) + 0.5 * sNoise((p + vec2(e, 0.0)) * 2.3 - vec2(t * 0.4, -t * 0.7));
        float hz = sNoise(p + vec2(0.0, e) + vec2(t * 0.6, t * 0.3)) + 0.5 * sNoise((p + vec2(0.0, e)) * 2.3 - vec2(t * 0.4, -t * 0.7));
        return vec2(hx - h0, hz - h0) / e;
      }
    ` +
      sh.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
      {
        vec2 p = vHWPos.xz * 1.6;
        // Caustic light on the pool floor.
        float ca = sNoise(p * 1.3 + vec2(uTime * 0.5, uTime * 0.2)) * sNoise(p * 1.7 - vec2(uTime * 0.3, -uTime * 0.45));
        vec3 day = vAlbedo * (0.85 + 0.6 * ca);
        diffuseColor.rgb = mix(toLinear(day), vColor.rgb, uThermal);
      }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, uThermal);')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
      {
        vec2 g = rippleGrad(vHWPos.xz * 1.6, uTime) * 0.05 * (1.0 - uThermal);
        vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`,
        )
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_IBL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_CLOUD}`);
  };
  mat.customProgramCacheKey = () => 'water2';
  SENSOR_MATERIALS.add(mat);
  return mat;
}

export const MATS = {
  units: surfaceMaterial({ name: 'units', detailAmt: 0.2, rough: 0.62, roughVar: 0.2, env: 0.9, paint: true }),
};

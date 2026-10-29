// Builds the static map once (hacienda compound + surrounding ranch), owns the sun, the sky
// light and the daylight/thermal look switch, and answers "where does this shell hit?"
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain, raycastTerrain } from './terrain.js';
import { buildRoutes, buildRoadGeometry } from './roads.js';
import { buildCompound } from './compound.js';
import { buildRanch } from './ranch.js';
import { agaveGeometry, bushGeometry } from './meshes.js';
import { Destruction } from './Destruction.js';
import { buildLandcover } from './landcover.js';
import { cutByCraters } from '../fx/Decals.js';
import { TreeField, plantMaterial } from './Trees.js';
import { LIB, propGroups, propMaterials, InstancedProps } from './props.js';
import { heightAt, addGroundHeight } from './terrain.js';
import { SUN, SENSOR, surfaceMaterial, groundMaterial, roadMaterial, waterMaterial, vehicleMaterial, rgb, linear } from '../render/heat.js';
import { foliageTexture, strawTexture } from '../render/textures.js';
import { technicalGeometry, truckGeometry, tankGeometry, humveeGeometry, pickupGeometry, realVehicleGeometry, bakePaint } from '../render/models.js';
import { mulberry32 } from '../core/rng.js';
import { LIGHT, HEAT } from '../config.js';

function scaleAlbedo(geom, k) {
  const a = geom.attributes.albedo.array;
  for (let i = 0; i < a.length; i++) a[i] *= k;
  return geom;
}

function scaleHeat(geom, k) {
  const c = geom.attributes.color.array;
  for (let i = 0; i < c.length; i++) c[i] *= k;
  return geom;
}

// The sensor-aware materials of the static world, by bucket name.
export function worldMaterials(T) {
  const foliage = foliageTexture();
  const straw = strawTexture();
  return {
    plaster: surfaceMaterial({ name: 'plaster', tex: T.painted_plaster_wall, nor: T.painted_plaster_wall_nor, scale: 1 / 3.2, norAmt: 0.8, rough: 0.9, grime: 1, aoH: true }),
    clay: surfaceMaterial({ name: 'clay', tex: T.patterned_clay_plaster, nor: T.patterned_clay_plaster_nor, scale: 1 / 2.8, rough: 0.93, grime: 1, aoH: true }),
    tile: surfaceMaterial({ name: 'tile', tex: T.clay_roof_tiles_02, nor: T.clay_roof_tiles_02_nor, uv: true, scale: 1 / 2.2, norAmt: 1.35, rough: 0.75, grime: 0.55, aoH: true }),
    tin: surfaceMaterial({ name: 'tin', tex: T.worn_corrugated_iron, nor: T.worn_corrugated_iron_nor, uv: true, scale: 1 / 2, rough: 0.5, metal: 0.5, grime: 0.4, aoH: true }),
    tinred: surfaceMaterial({ name: 'tinred', tex: T.box_profile_metal_sheet, nor: T.box_profile_metal_sheet_nor, uv: true, scale: 1 / 2.4, rough: 0.55, metal: 0.35, grime: 0.6, aoH: true }),
    wood: surfaceMaterial({ name: 'wood', tex: T.weathered_planks, nor: T.weathered_planks_nor, scale: 1 / 2.5, rough: 0.88, grime: 0.6, aoH: true }),
    paver: surfaceMaterial({ name: 'paver', tex: T.square_cobblestone, nor: T.square_cobblestone_nor, scale: 1 / 2.5, rough: 0.82, grime: 0.5, aoH: true }),
    lawn: surfaceMaterial({ name: 'lawn', tex: T.leafy_grass, nor: T.leafy_grass_nor, scale: 1 / 3, rough: 0.95, lawn: true, aoH: true }),
    hedge: surfaceMaterial({ name: 'hedge', tex: foliage.map, nor: foliage.nor, scale: 1 / 1.3, norAmt: 1.6, rough: 0.9, roughVar: 0, aoH: true }),
    hay: surfaceMaterial({ name: 'hay', tex: straw.map, nor: straw.nor, scale: 1 / 1.1, rough: 0.95, aoH: true }),
    rock: surfaceMaterial({ name: 'rock', tex: T.dry_riverbed_rock, nor: T.dry_riverbed_rock_nor, scale: 1 / 2.2, rough: 0.9, aoH: true }),
    metal: surfaceMaterial({ name: 'metal', rough: 0.45, metal: 0.65, grime: 0.5, aoH: true, roughVar: 0 }),
    window: surfaceMaterial({ name: 'window', detailAmt: 0.05, rough: 0.08, roughVar: 0, env: 1.3 }),
    glass: surfaceMaterial({ name: 'glass', detailAmt: 0.1, alpha: [0.38, 0.6], rough: 0.08, roughVar: 0, env: 1.3 }),
    water: waterMaterial(),
    plain: surfaceMaterial({ name: 'plain', rough: 0.82, grime: 0.35, aoH: true }),
  };
}

// Sky dome rendered once into a prefiltered environment map: the blue sky and its bright
// horizon light everything from above in daylight (no sun disc: the sun is the directional light),
// and a warm brown ground bounce lights it from below.
function skyScene() {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.13, 0.28, 0.62);
        vec3 horizon = vec3(0.62, 0.69, 0.78);
        vec3 ground = vec3(0.16, 0.135, 0.1);
        vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
        float s = max(dot(d, uSun), 0.0);
        sky += vec3(1.0, 0.92, 0.8) * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.8);
        vec3 c = h >= 0.0 ? sky : mix(horizon * 0.55, ground, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  return scene;
}

export class World {
  constructor(scene, assets) {
    const M = assets.models;
    const T = assets.textures;
    this.scene = scene;
    this.routes = buildRoutes(7);

    // Vehicle geometries shared with the unit renderer, plus parked/wrecked statics.
    // Realistic converted models are used when present, else the bundled low-poly ones.
    this.vehicles = {
      technical: M.veh_technical ? realVehicleGeometry(M.veh_technical, 'technical') : technicalGeometry(M.pickup),
      apc: M.veh_apc ? realVehicleGeometry(M.veh_apc, 'apc') : truckGeometry(M.truck),
      tank: M.veh_tank ? realVehicleGeometry(M.veh_tank, 'tank') : tankGeometry(M.tank),
    };
    const car = (warm) => (M.veh_car ? realVehicleGeometry(M.veh_car, 'car', warm) : pickupGeometry(M.pickup, warm));
    const statics = {
      humvee: bakePaint(M.veh_humvee ? realVehicleGeometry(M.veh_humvee, 'humvee') : humveeGeometry(M.humvee), [1, 1, 1]),
      truck: bakePaint(this.vehicles.apc.clone(), [0.6, 0.63, 0.43]),
      car: bakePaint(car(0.5), [1.1, 1.1, 1.07]),
      carRed: bakePaint(car(0.2), [0.7, 0.27, 0.22]),
      // Burnt-out wrecks by the roads: the civilian pickup, charred.
      wreck: scaleAlbedo(scaleHeat(bakePaint(car(0), [0.3, 0.28, 0.26]), 0.55), 0.4),
    };

    // Photoscanned props for the map builders (see props.js); shrubs are instanced separately.
    const PROP_HEAT = { boulder: HEAT.rock, barrel: HEAT.metal, aircon: 0.6, covered_car: HEAT.vehicle * 0.85, road_barrier: HEAT.wall, crate: HEAT.wood, bush: HEAT.bush };
    for (const [name, gltf] of Object.entries(assets.props || {})) {
      if (!gltf) continue;
      const kind = Object.keys(PROP_HEAT).find((k) => name.startsWith(k)) || 'boulder';
      LIB[name] = { ...propGroups(gltf, PROP_HEAT[kind]), instanced: kind === 'bush' };
    }

    // Textured (realistic) vehicle models get their own material bucket, so their texture
    // survives being merged into the static world.
    for (const [k, g] of Object.entries(statics)) if (g.userData.map) g.userData.bucket = `veh_${k}`;

    this.compound = buildCompound(statics);
    const ranch = buildRanch(mulberry32(1337), this.routes, statics);
    this.colliders = [...this.compound.colliders, ...ranch.colliders];
    this.sites = ranch.sites;

    const mats = { ...worldMaterials(T), ...propMaterials() };
    for (const g of Object.values(statics)) {
      if (g.userData.bucket) mats[g.userData.bucket] = vehicleMaterial(g.userData.bucket, g.userData.map, true);
    }
    this.mats = mats;

    // Merge props into one mesh per material per 250 m tile, so the camera and the shadow pass
    // can cull what is off-screen.
    // Destructible objects keep track of which vertices they own in the merged meshes.
    const TILE = 250;
    const buckets = new Map();
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    const metas = new Set();
    for (const src of [this.compound.parts, ranch.parts]) {
      for (const [k, list] of Object.entries(src.b)) {
        if (!mats[k]) throw new Error(`no material for bucket ${k}`);
        for (const g of list) {
          addGroundHeight(g);
          g.computeBoundingBox();
          box.copy(g.boundingBox).getCenter(c);
          const key = `${k}|${Math.floor(c.x / TILE)}|${Math.floor(c.z / TILE)}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(g);
          const obj = g.userData.obj;
          if (obj) {
            if (!metas.has(obj)) {
              metas.add(obj);
              obj.box = new THREE.Box3();
              obj.ranges = [];
            }
            obj.box.union(g.boundingBox);
          }
        }
      }
    }
    for (const [key, list] of buckets) {
      const k = key.split('|')[0];
      const owned = [];
      let offset = 0;
      for (const g of list) {
        const count = g.attributes.position.count;
        if (g.userData.obj) owned.push({ obj: g.userData.obj, start: offset, count });
        offset += count;
      }
      const geom = mergeGeometries(list, false);
      if (!geom) throw new Error(`could not merge bucket ${key}`);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(geom, mats[k]);
      mesh.castShadow = k !== 'glass' && k !== 'water' && k !== 'window';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = k === 'glass' ? 2 : 0;
      scene.add(mesh);
      for (const { obj, start, count } of owned) obj.ranges.push({ mesh, start, count });
    }
    // Realistic trees: instanced, destructible (they topple).
    this.trees = new TreeField(scene, assets.trees, 'tree');
    this.palms = new TreeField(scene, assets.trees, 'palm');
    const canopies = [];
    for (const [field, kind, list] of [
      [this.trees, 'tree', [...this.compound.trees, ...ranch.trees]],
      [this.palms, 'palm', [...this.compound.palms, ...ranch.palms]],
    ]) {
      for (const t of list) {
        const rec = field.add(t.x, heightAt(t.x, t.z), t.z, t.yaw, t.scale, t.r);
        metas.add({ kind, tree: rec, field, box: field.box(rec), ranges: [] });
        canopies.push({ x: t.x, z: t.z, r: rec.r * (kind === 'palm' ? 0.55 : 0.9), dark: kind === 'palm' ? 0.35 : 0.55 });
      }
      field.build();
    }
    // Scrub: photoscanned dry and green shrubs when available, else simple foliage clumps.
    // Four green and two dry shrub variants keep the draw count down.
    const bushNames = Object.keys(LIB)
      .filter((k) => LIB[k].instanced)
      .sort()
      .filter((n) => ['bush_green_a', 'bush_green_c', 'bush_green_e', 'bush_green_g', 'bush_dry_a', 'bush_dry_c'].includes(n) || !/bush_(green|dry)_/.test(n));
    const bushVariants = bushNames.map((k) => LIB[k]);
    // Mostly dense green scrub, some dry: r in 0..1 picks a variant.
    const greens = bushNames.map((n, i) => (n.includes('green') ? i : -1)).filter((i) => i >= 0);
    const dries = bushNames.map((n, i) => (n.includes('green') ? -1 : i)).filter((i) => i >= 0);
    const pickBush = (r) => {
      const green = r < 0.7;
      const list = (green ? greens : dries).length ? (green ? greens : dries) : bushVariants.map((_, i) => i);
      const k = green ? r / 0.7 : (r - 0.7) / 0.3;
      return list[Math.min(list.length - 1, Math.floor(k * list.length))];
    };
    const plant = (g) => (g.map ? plantMaterial(g.map, { kind: g.alphaTest > 0 ? 'leaves' : 'stems', heat: 'bush', day: [0.95, 0.95, 0.85], alphaTest: g.alphaTest || 0.5 }) : { mat: mats.hedge, depth: null });
    if (!bushVariants.length) {
      const rng = mulberry32(5);
      for (let i = 0; i < 3; i++) {
        const g = addGroundHeight(bushGeometry(rng), -0.5);
        bushVariants.push({ groups: [{ geometry: g, map: null }] });
      }
    }
    // Shrubs don't cast sun shadows (too costly for thousands of them); the baked ground
    // occlusion map shades the ground under each one instead.
    this.bushes = new InstancedProps(scene, bushVariants, plant, 400, false);
    // Each variant is scaled to a real scrub size: 1.5-3.5 m across its largest dimension
    // (b.scale is 0.6-1.4), so tall and low-spreading shrubs keep their own proportions.
    const bushSize = bushVariants.map((v) => {
      const bb = new THREE.Box3();
      for (const gr of v.groups) {
        gr.geometry.computeBoundingBox();
        bb.union(gr.geometry.boundingBox);
      }
      return Math.max(0.2, bb.max.y - bb.min.y, bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    });
    for (const b of ranch.bushes) {
      const v = pickBush(b.r);
      const size = 3.0 * b.scale;
      this.bushes.add(v, b.x, b.y - 0.05, b.z, b.yaw, size / bushSize[v]);
      canopies.push({ x: b.x, z: b.z, r: 0.45 * size, dark: 0.3 });
    }
    this.bushes.build();

    this.destruction = new Destruction(scene, mats);
    this.destruction.init([...metas]);

    // Baked ground maps: dirt yards, tilled fields and sky occlusion around everything standing.
    const occluders = [];
    for (const m of metas) {
      if (m.tree || !m.box) continue;
      const f = m.frame;
      const h = m.box.max.y - m.box.min.y;
      if (f) occluders.push({ x: f.x, z: f.z, w: f.w, d: f.d, ry: f.ry, h });
      else occluders.push({ x: (m.box.min.x + m.box.max.x) / 2, z: (m.box.min.z + m.box.max.z) / 2, w: m.box.max.x - m.box.min.x, d: m.box.max.z - m.box.min.z, ry: 0, h });
    }
    const metaColliders = new Set([...metas].map((mm) => mm.collider).filter(Boolean));
    for (const b of this.compound.colliders) if (!metaColliders.has(b)) occluders.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ, ry: 0, h: b.maxY - b.minY });
    for (const o of this.compound.lowOccluders) occluders.push(o);
    const cover = buildLandcover({ yards: ranch.yards, fields: ranch.agave, occluders, canopies });
    this.cover = cover;

    const terrain = new THREE.Mesh(buildTerrain(), cutByCraters(groundMaterial({ T, cover })));
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    scene.add(terrain);

    const roads = new THREE.Mesh(buildRoadGeometry(this.routes), cutByCraters(roadMaterial(T)));
    roads.receiveShadow = true;
    roads.matrixAutoUpdate = false;
    roads.renderOrder = 1;
    scene.add(roads);

    // Agave fields, one instanced mesh per field.
    const agaveGeom = agaveGeometry();
    const agaveMat = surfaceMaterial({ name: 'agave', detailAmt: 0.25, rough: 0.6, roughVar: 0, side: THREE.DoubleSide });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const A of ranch.agave) {
      const n = A.length / 5;
      const field = new THREE.InstancedMesh(agaveGeom, agaveMat, n);
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        const s = A[o + 4];
        m.compose(new THREE.Vector3(A[o], A[o + 1], A[o + 2]), q.setFromAxisAngle(up, A[o + 3]), new THREE.Vector3(s, s, s));
        field.setMatrixAt(i, m);
      }
      field.computeBoundingSphere();
      field.castShadow = false;
      field.receiveShadow = true;
      scene.add(field);
    }

    const wires = new THREE.BufferGeometry();
    wires.setAttribute('position', new THREE.Float32BufferAttribute(ranch.lines, 3));
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x555555 });
    const wireMesh = new THREE.LineSegments(wires, this.wireMat);
    wireMesh.matrixAutoUpdate = false;
    scene.add(wireMesh);

    // Thermal uses a flat ambient term; daylight uses the sky environment instead (see initSky).
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(LIGHT.shadowMap, LIGHT.shadowMap);
    this.sun.shadow.radius = 2;
    this.sun.shadow.bias = -0.0002;
    const sc = this.sun.shadow.camera;
    sc.near = 10;
    sc.far = 4000;
    scene.add(this.ambient, this.sun, this.sun.target);
    this.setMode(true);
  }

  // Prefilters the sky into the scene's environment map (needs the renderer).
  initSky(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = skyScene();
    this.envRT = pmrem.fromScene(sky, 0, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = LIGHT.day.sky;
    sky.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    pmrem.dispose();
  }

  // Thermal or daylight: lights, haze and the shared shader switch.
  setMode(thermal) {
    const L = thermal ? LIGHT.thermal : LIGHT.day;
    SENSOR.uThermal.value = thermal ? 1 : 0;
    const col = thermal ? rgb : linear;
    this.ambient.color.setRGB(...rgb(L.ambientColor));
    this.ambient.intensity = L.ambient * Math.PI;
    this.sun.color.setRGB(...col(L.sunColor));
    this.sun.intensity = L.sun * Math.PI;
    const haze = new THREE.Color().setRGB(...col(L.haze));
    this.scene.background = haze;
    if (this.scene.fog) this.scene.fog.color.copy(haze);
    this.wireMat.color.setRGB(...(thermal ? [0.5, 0.5, 0.5] : [0.02, 0.02, 0.02]));
  }

  // Keeps the shadow map centred on what the sensor is looking at, sized to the zoom level,
  // and snapped to whole texels so shadows don't shimmer as the view moves.
  updateSun(target, halfExtent) {
    const half = Math.max(60, Math.min(700, halfExtent));
    const texel = (half * 2) / LIGHT.shadowMap;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + SUN.x * 1800, SUN.y * 1800, tz + SUN.z * 1800);
    const sc = this.sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    this.sun.shadow.normalBias = texel * 1.2;
  }

  // Ray (unit direction) against terrain and building boxes. Writes the hit into `out`.
  raycast(o, d, out) {
    let best = raycastTerrain(o.x, o.y, o.z, d.x, d.y, d.z);
    if (best < 0) best = Infinity;
    const ix = 1 / d.x;
    const iy = 1 / d.y;
    const iz = 1 / d.z;
    for (const b of this.colliders) {
      let t1 = (b.minX - o.x) * ix;
      let t2 = (b.maxX - o.x) * ix;
      let tmin = Math.min(t1, t2);
      let tmax = Math.max(t1, t2);
      t1 = (b.minY - o.y) * iy;
      t2 = (b.maxY - o.y) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.minZ - o.z) * iz;
      t2 = (b.maxZ - o.z) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= tmin && tmin > 0 && tmin < best) best = tmin;
    }
    if (best === Infinity) return false;
    out.set(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    return true;
  }
}

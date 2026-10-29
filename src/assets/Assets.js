// Loads the bundled models, photo textures and sound files (see CREDITS.md) before the game is built.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL}assets/`;

const MODELS = {
  soldier: 'models/soldier.glb',
  pickup: 'models/pickup.glb',
  truck: 'models/truck.glb',
  tank: 'models/tank.glb',
  humvee: 'models/humvee.glb',
};

// Munition models (the 105/40/25 mm rounds and the guided bomb). The game still runs without them.
const OPTIONAL_MODELS = {
  r105: 'models/rounds/r105.glb',
  r40: 'models/rounds/r40.glb',
  r25: 'models/rounds/r25.glb',
  gbu: 'models/gbu.glb',
  // Realistic vehicles converted from downloads (scripts/blender/convert_vehicle.py). When present
  // they replace the bundled low-poly ones.
  veh_technical: 'models/vehicles/technical.glb',
  veh_apc: 'models/vehicles/truck.glb',
  veh_tank: 'models/vehicles/tank.glb',
  veh_humvee: 'models/vehicles/humvee.glb',
  veh_car: 'models/vehicles/car.glb',
  // A realistic animated soldier (scripts/blender/convert_mixamo.py) replaces the bundled one.
  soldier_real: 'models/soldiers/soldier.glb',
};

// Colour maps and their OpenGL-convention normal maps (*_nor), all Poly Haven CC0.
const TEXTURES = [
  'aerial_grass_rock', 'aerial_grass_rock_nor', 'aerial_ground_rock', 'dirt_aerial_02', 'dirt_aerial_02_nor',
  'aerial_sand', 'aerial_sand_nor', 'raked_dirt', 'raked_dirt_nor', 'dry_ground_rocks', 'dry_ground_rocks_nor',
  'painted_plaster_wall', 'painted_plaster_wall_nor', 'patterned_clay_plaster', 'patterned_clay_plaster_nor',
  'clay_roof_tiles_02', 'clay_roof_tiles_02_nor', 'worn_corrugated_iron', 'worn_corrugated_iron_nor',
  'box_profile_metal_sheet', 'box_profile_metal_sheet_nor', 'weathered_planks', 'weathered_planks_nor',
  'square_cobblestone', 'square_cobblestone_nor', 'leafy_grass', 'leafy_grass_nor', 'dry_riverbed_rock', 'dry_riverbed_rock_nor',
];

const TREE_TEX = ['bark', 'leaves_a', 'leaves_b', 'leaves_c', 'palm_trunk', 'palm_boots', 'palm_stems', 'palm_fronds'];

export const SFX = [
  'gun105_a', 'gun105_b', 'gun105_sub', 'gun40_a', 'gun40_b', 'gun25',
  'exp_big', 'exp_rumble', 'exp_med_a', 'exp_med_b', 'exp_small', 'exp_thump', 'exp_vehicle', 'exp_debris',
  'amb_war', 'amb_gunfire', 'burst_distant', 'engine_turboprop', 'engine_cabin',
  'radio_in', 'radio_out', 'casing', 'fire_loop',
  // Guided bomb: release, dive, blast and the rumble rolling back off the hills.
  'gbu_release', 'gbu_incoming', 'gbu_blast', 'gbu_rumble',
];

// Repeating texture whose average luminance is stored in userData.mean (shaders normalize by it).
async function loadTexture(url) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`texture ${url}`));
    i.src = url;
  });
  const tex = new THREE.Texture(img);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  tex.userData.mean = sum / (d.length / 4);
  return tex;
}

// Audio is decoded up front with an OfflineAudioContext (no user gesture needed); the
// resulting AudioBuffers play in the real context later.
export async function loadAssets(onProgress = () => {}) {
  // Photoscanned props (boulders, shrubs, drums...) listed in props/props.json; optional.
  let propNames = [];
  try {
    propNames = await (await fetch(`${BASE}props/props.json`)).json();
  } catch {
    propNames = [];
  }
  const total = Object.keys(MODELS).length + Object.keys(OPTIONAL_MODELS).length + propNames.length + TEXTURES.length + TREE_TEX.length + 2 + SFX.length;
  let done = 0;
  const tick = () => onProgress(++done / total);

  const loader = new GLTFLoader();
  const decoder = new OfflineAudioContext(2, 1, 44100);
  const models = {};
  const props = {};
  const textures = {};
  const sfx = {};
  const trees = { textures: {} };
  await Promise.all([
    ...TREE_TEX.map(async (name) => {
      trees.textures[name] = await loadTexture(`${BASE}trees/${name}.webp`);
      tick();
    }),
    (async () => {
      trees.json = await (await fetch(`${BASE}trees/trees.json`)).json();
      tick();
    })(),
    (async () => {
      trees.bin = await (await fetch(`${BASE}trees/trees.bin`)).arrayBuffer();
      tick();
    })(),
    ...Object.entries(MODELS).map(async ([key, file]) => {
      models[key] = await loader.loadAsync(BASE + file);
      tick();
    }),
    ...propNames.map(async (name) => {
      try {
        props[name] = await loader.loadAsync(`${BASE}props/${name}.glb`);
      } catch {
        props[name] = null;
        console.warn(`prop missing: ${name}`);
      }
      tick();
    }),
    ...Object.entries(OPTIONAL_MODELS).map(async ([key, file]) => {
      try {
        models[key] = await loader.loadAsync(BASE + file);
      } catch {
        models[key] = null;
        console.warn(`optional model missing: ${file}`);
      }
      tick();
    }),
    ...TEXTURES.map(async (name) => {
      textures[name] = await loadTexture(`${BASE}tex/${name}.jpg`);
      tick();
    }),
    ...SFX.map(async (name) => {
      const data = await (await fetch(`${BASE}sfx/${name}.mp3`)).arrayBuffer();
      sfx[name] = await decoder.decodeAudioData(data);
      tick();
    }),
  ]);
  return { models, props, textures, sfx, trees };
}

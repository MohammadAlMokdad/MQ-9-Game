// Every tunable number in the game lives here.
// No three.js imports: scripts/sim-waves.mjs loads this file under plain Node.

export const MAP = {
  spawnRadius: 430, // enemies enter the map here
  aimRadius: 560,   // how far from the compound the sensor can be slewed
  fobHalf: 70,      // compound wall half-size (a 140 m square)
  gateHalf: 5,      // half-width of the gate gaps in each wall
};

// Route ids 0..7 map to bearings 0, 45, 90 ... degrees. Even ids are roads (vehicles allowed), odd ids are foot trails.
export const ROUTES = { count: 8, main: [0, 2, 4, 6] };

// Slant range is ~1.8 km, looking down at ~56 degrees. Narrow fields of view from that far
// out flatten perspective the way a real gunship sensor does.
export const CAMERA = {
  orbitRadius: 1000,
  altitude: 1500,
  orbitPeriod: 150,  // seconds per full pylon turn
  near: 80,
  far: 9000,
  sensitivity: 0.00035, // rad per mouse pixel at 1x
  fov: 8, // field of view at 1x (degrees), whatever the weapon
  zooms: [1, 2, 3], // right click / Z steps through these magnifications
  fovLerp: 10,
  switchTime: 0.35,
  // Blasts and recoil jolt the view: a damped spring (kickFreq Hz, kickDamp of critical) that
  // kicks once and settles within about half a second, so the picture stays readable. Big blasts
  // add a short rumble (trauma): slow noise of up to shakeAngle/shakeRoll rad at shakeFreq.
  kickFreq: 5.5,
  kickDamp: 0.3,
  traumaDecay: 1.4,
  shakeAngle: 0.006,
  shakeRoll: 0.002,
  shakeFreq: 9,
  swayA: 0.0012,
  swayB: 0.0005,
};

// Smallest to biggest: this order is the HUD order and the 1-4 keys. Code refers to a weapon by
// its id, never by its position, so the list can be reordered freely.
//   icon     its picture in assets/ui (weapon box and menu)
//   reticle  [arm length, centre gap, corner tick x, corner tick y] in pixels; compass: radius
//            of the N/E/S/W ring
//   push     how hard its blast throws bodies; dip: a blast big enough to swamp the sensor's
//            gain (how far the image dips)
//   single   one round in the breech: the box shows 1 or 0 and it reloads after every shot
//   kick     how far its impact jolts the view (rad at 1x; 0.001 is about 6 px on a 900 px
//            screen at any zoom); rumble: the impact's shake (trauma); recoil: the jolt on firing
export const WEAPONS = [
  {
    id: '25', name: '25MM', icon: 'round_25', interval: 0.1, mag: 0, reload: 0, speed: 1200,
    damage: 40, inner: 1.2, outer: 3.5, spread: 0.0009, decal: 1.8,
    heatPerShot: 0.04, coolRate: 0.45, coolDelay: 0.25, overheatResume: 0.25,
    flash: 0, tracerLen: 30, tracerHeat: 1.8, tracerWidth: 2,
    kick: 0.00022, rumble: 0, recoil: 0.0001,
    reticle: [76, 10, 50, 38], compass: 92, push: 0,
  },
  {
    id: '40', name: '40MM', icon: 'round_40', interval: 0.45, mag: 6, reload: 2.5, speed: 1000,
    damage: 120, inner: 2.5, outer: 8, spread: 0.0004, decal: 4.8,
    flash: 0.12, tracerLen: 22, tracerHeat: 2.0, tracerWidth: 2.5,
    kick: 0.0007, rumble: 0.12, recoil: 0.00035,
    reticle: [104, 13, 70, 54], compass: 118, push: 11,
  },
  {
    id: '105', name: '105MM', icon: 'round_105', interval: 4.0, mag: 0, reload: 0, speed: 800, single: true,
    damage: 700, inner: 5, outer: 20, spread: 0, decal: 15,
    flash: 0.85, tracerLen: 30, tracerHeat: 2.2, tracerWidth: 3,
    kick: 0.002, rumble: 0.35, recoil: 0.0011,
    reticle: [140, 16, 96, 72], compass: 150, push: 22, dip: 0.6,
  },
  // Guided bomb: released from the aircraft, it steers itself onto the enemy vehicle nearest the
  // crosshair (or the crosshair point if there are no vehicles). Two on the rack, slow rearm.
  {
    id: 'gbu', name: 'GBU', icon: 'gbu', interval: 1.5, mag: 2, reload: 24, speed: 0, guided: true,
    damage: 3200, inner: 7, outer: 26, spread: 0, decal: 22,
    flash: 1, tracerLen: 0, tracerHeat: 0, tracerWidth: 0,
    kick: 0.0042, rumble: 0.6, recoil: 0.0003,
    reticle: [140, 16, 96, 72], compass: 150, push: 30, dip: 0.45,
  },
];

// Position of a weapon in WEAPONS (its HUD slot and key) from its id.
export const weaponIndex = (id) => WEAPONS.findIndex((w) => w.id === id);

// Guided bomb flight: it drops off the rack `rack` m under the aircraft and falls away onto its
// vehicle along the sensor's line of sight, sagging below it and lagging toward the aircraft's
// tail (`lag` sideways per metre down), by `sag` half fields of view as it starts to fall, so it
// slides into the picture from the lower left. Flight time is distance / pathSpeed, clamped to
// timeMin..timeMax (s). lockRange: how far from the crosshair it looks for a vehicle (m).
// track: how fast its aim point can follow a moving or new target (m/s).
export const GBU = { pathSpeed: 180, timeMin: 7, timeMax: 12, lockRange: 260, track: 40, rack: -3, sag: 1.1, lag: 0.75 };

// Lighting per sensor mode. Thermal: ambient heat plus solar loading that leaves cool shadows.
// Daylight: warm sun and a cool sky fill.
// Daylight is physically based: sun = irradiance (x pi), sky = strength of the sky environment
// light, exposure/haze/hazeColor (linear) set the TV camera's look in the sensor pass.
export const LIGHT = {
  shadowMap: 4096,
  thermal: { ambient: 0.46, sun: 0.6, ambientColor: 0xffffff, sunColor: 0xffffff, haze: 0x5e5e5e },
  day: {
    ambient: 0, sun: 3.0, sky: 1.0, ambientColor: 0xffffff, sunColor: 0xfff1de, haze: 0xb4c0cc,
    exposure: 0.5, hazeAmount: 0.06, hazeColor: [0.95, 1.05, 1.22],
  },
};
export const RENDER = { soldierShadows: false, msaa: 4 };

// Damage multiplier by weapon id and target armor class.
export const ARMOR = {
  105: { soft: 1, light: 1, armored: 1, tank: 1 },
  40: { soft: 1, light: 1, armored: 0.5, tank: 0.15 },
  25: { soft: 1, light: 0.2, armored: 0, tank: 0 },
  gbu: { soft: 1, light: 1, armored: 1, tank: 1 },
};

// People are drawn a little oversized so they read from altitude (hit radii are not scaled).
export const PERSON_SCALE = 1.15;
export const VEHICLE_SCALE = 1.0;

export const ENEMY_TYPES = {
  infantry: {
    mesh: 'person', hp: 35, armor: 'soft', speed: 3.0, radius: 0.5, cost: 1, firstWave: 1,
    ringR: 135, ringJitter: 30, attack: 'rifle', fireInterval: 2.0, damage: 1.5, friendlyChance: 0.2, score: 50,
  },
  rpg: {
    mesh: 'rpg', hp: 35, armor: 'soft', speed: 2.8, radius: 0.5, cost: 3, firstWave: 2,
    ringR: 170, ringJitter: 24, attack: 'rocket', fireInterval: 8, damage: 25, friendlyChance: 0.25, score: 150,
  },
  sapper: {
    mesh: 'sapper', hp: 50, armor: 'soft', speed: 6.0, radius: 0.5, cost: 3, firstWave: 4,
    ringR: 0, ringJitter: 0, chargeRange: 240, attack: 'charge', damage: 120, blastRadius: 10, score: 150,
  },
  technical: {
    mesh: 'technical', vehicle: true, hp: 240, armor: 'light', speed: 12, radius: 2.6, cost: 7, firstWave: 3,
    ringR: 215, ringJitter: 20, attack: 'mg', fireInterval: 0.5, damage: 2, friendlyChance: 0.3, passengers: 3, score: 300,
  },
  apc: {
    mesh: 'apc', vehicle: true, hp: 900, armor: 'armored', speed: 7, radius: 3.3, cost: 16, firstWave: 6,
    ringR: 245, ringJitter: 20, attack: 'cannon', fireInterval: 3, damage: 20, friendlyChance: 0.2, passengers: 6, score: 750,
  },
  tank: {
    mesh: 'tank', vehicle: true, hp: 1800, armor: 'tank', speed: 5, radius: 3.9, cost: 30, firstWave: 10,
    ringR: 300, ringJitter: 20, attack: 'shell', fireInterval: 6, damage: 70, friendlyChance: 0.15, score: 1500,
  },
};
export const ENEMY_ORDER = ['infantry', 'rpg', 'sapper', 'technical', 'apc', 'tank'];

export const FRIENDLY = {
  hp: 100,
  range: 230,
  fireMin: 1.2,
  fireMax: 2.0,
  hitChance: 0.15,
  damage: 14,
  patrolSpeed: 1.4,
  enemyHitChance: 0.18, // chance an enemy shot aimed at a soldier connects
  enemyDamage: 34,
};

export const BASE = {
  maxHp: 1000,
  repair: 120,
  bossRepair: 250,
  dangerClose: 0.05, // fraction of a shell's damage the base takes when you hit inside the wire
  fireThresholds: [0.75, 0.5, 0.25],
};

export const WAVES = {
  firstDelay: 5,
  intermission: 10,
  bossEvery: 5,
  aliveCap: 150,
  stragglerCount: 3,
  stragglerTime: 30,
};

export const SCORE = {
  chainWindow: 3,
  chainStep: 5,
  multStep: 0.5,
  multMax: 4,
  multiKillBase: 75,
  waveBase: 250,
  perFriendly: 25,
  noDamageBonus: 1000,
  noFFBonus: 300,
  ffPenalty: 500,
  bossMult: 2,
  storageKey: 'gunship.highscores.v1',
  settingsKey: 'gunship.settings.v1',
};

// Heat is the thermal brightness before lighting and the sensor pass. Sunlit ground ends up
// around 0.7; above ~1.1 blooms (people, engines, fire).
export const HEAT = {
  ground: 0.6,
  road: 0.64,
  trail: 0.62,
  wall: 0.6,
  roof: 0.55,
  roofFlat: 0.6,
  tin: 0.74,
  wood: 0.5,
  glass: 0.2,
  frame: 0.7,
  shade: 0.24,
  ac: 1.0,
  metal: 0.6,
  tankSun: 0.8,
  water: 0.16,
  hay: 0.6,
  plant: 0.4,
  lawn: 0.5,
  trunk: 0.44,
  tree: 0.36,
  palm: 0.4,
  agave: 0.46,
  bush: 0.34,
  rock: 0.6,
  vehicle: 0.6,
  engine: 1.5,
  exhaust: 1.8,
  tire: 0.75,
  track: 0.65,
  humvee: 0.55,
  generator: 1.1,
  strobe: 2.2,
  bomb: 0.95,
  tankBlack: 0.95,
};

// Daylight albedo (display-space rgb 0..1). Textured surfaces use near-neutral values and get
// their hue from the photo texture.
const c = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
export const COLOR = {
  ground: c(0x666c5c),
  road: c(0x8c8475),
  stucco: c(0xcbc5b9),
  stuccoDirty: c(0xb3a998),
  adobe: c(0xa38f77),
  tile: c(0xb3ada7),
  tin: c(0xa9a7a1),
  roofFlat: c(0xa29b8f),
  window: c(0x262b30),
  shade: c(0x2e2b27),
  wood: c(0x8e8272),
  woodDark: c(0x6e6052),
  glass: c(0x9fb4b8),
  frame: c(0xe6e6e0),
  plant: c(0x4f6e3c),
  metal: c(0x8e8e8a),
  rust: c(0x86644e),
  water: c(0x47676f),
  pool: c(0x5fb2cc),
  paver: c(0xaaa59b),
  paverDark: c(0x8f8a81),
  hay: c(0xb7a26e),
  barrelBlue: c(0x3d5c8e),
  trunk: c(0x5b4b3d),
  leaves: c(0x3f5a2e),
  agave: c(0x6f8f86),
  waterTank: c(0x2b2b2b),
  rock: c(0x9c958a),
  hedge: c(0x4a6036),
  tankBlack: c(0x1e1f20),
  doorWood: c(0x5c4430),
  frame: c(0xe8e4dc),
};

// Wall paint seen across rural Mexico: whites and creams for the hacienda, faded ochres,
// terracottas, pinks and blues in the village. Display-space rgb.
export const WALL_PAINT = {
  hacienda: [c(0xe9e3d6), c(0xe4dccb), c(0xefe9dd), c(0xddd2bd)],
  village: [c(0xe0d2b4), c(0xd9b98c), c(0xc98f6a), c(0xd8a7a0), c(0xb9c8c9), c(0xcfc7a4), c(0xe6e0d2), c(0xb79b7a)],
};

// Destructible map objects: hit points, how they come apart, and damage multiplier per weapon id.
// Buildings and rock shrug off the 25mm.
const SOFT = { 25: 0.6, 40: 1, 105: 1, gbu: 1 };
const HARD = { 25: 0.12, 40: 0.55, 105: 1, gbu: 1.3 };
export const DESTRUCT = {
  tree: { hp: 70, style: 'topple', mult: SOFT },
  palm: { hp: 55, style: 'topple', mult: SOFT },
  prop: { hp: 30, style: 'burn', mult: SOFT }, // hay bales
  drums: { hp: 25, style: 'blast', mult: SOFT },
  vehicle: { hp: 160, style: 'wreck', mult: { 25: 0.3, 40: 1, 105: 1, gbu: 1 } },
  rock: { hp: 420, style: 'shatter', mult: HARD },
  fountain: { hp: 350, style: 'shatter', mult: HARD },
  greenhouse: { hp: 200, style: 'collapse', mult: HARD },
  shed: { hp: 260, style: 'collapse', mult: HARD },
  tower: { hp: 320, style: 'topple', mult: HARD },
  barn: { hp: 520, style: 'collapse', mult: HARD },
  house: { hp: 480, style: 'collapse', mult: HARD },
  stable: { hp: 600, style: 'collapse', mult: HARD },
  hacienda: { hp: 650, style: 'collapse', mult: HARD },
};

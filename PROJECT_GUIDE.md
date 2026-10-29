# Project Guide: Gunship: Hacienda Defense

This guide maps everything in the project: where each part lives, what every setting does, how to make common changes, and the full 3D statistics of every model. Use it to decide what to edit before changing anything.

All counts and sizes were measured from the files and from the running game on 2026-10-09. Frame-rate figures come from an Intel integrated GPU in a headless browser, so a real graphics card will do better. If you replace a model, re-measure it (see [Re-measuring](#re-measuring)).

Contents:

1. [Run and build](#1-run-and-build)
2. [Folder structure](#2-folder-structure)
3. [How the game runs](#3-how-the-game-runs)
4. [Source code map](#4-source-code-map)
5. [Configuration reference](#5-configuration-reference)
6. [Settings that live outside config.js](#6-settings-that-live-outside-configjs)
7. [How to change common things](#7-how-to-change-common-things)
8. [3D models: full statistics](#8-3d-models-full-statistics)
9. [3D in the running game](#9-3d-in-the-running-game)
10. [Textures, sounds, fonts and icons](#10-textures-sounds-fonts-and-icons)
11. [Asset tools](#11-asset-tools)
12. [Known limits and open items](#12-known-limits-and-open-items)

---

## 1. Run and build

| Command | What it does |
|---|---|
| `npm install` | Installs three.js 0.186.1 and Vite 8.3.3 |
| `npm run dev` | Starts the dev server and opens the game. Add `?debug` to the URL for the debug keys |
| `npm run build` | Builds the shippable game into `dist/` (relative paths, so it runs from any folder) |
| `npm run preview` | Serves the built `dist/` |
| `npm run sim:waves` | Prints the enemy mix for waves 1 to 40, without a browser |
| `npm run build:trees` | Rebuilds the tree asset from the `realistic_trees_collection/` and `date_palm/` downloads |

The asset scripts in `scripts/blender/` need Blender 5.1, run headless from `C:/Program Files/Blender Foundation/Blender 5.1/blender.exe` (see [Asset tools](#11-asset-tools)).

Debug keys (dev server or `?debug`):

| Key | Action |
|---|---|
| F1 or backquote | Stats overlay |
| K | Kill all enemies |
| N | Next wave |
| J | Jump 5 waves |
| G | God mode |
| B | Spawn 150 enemies (stress test) |
| V | Show the current weapon's splash radius |
| T | Raw render, without the sensor look |
| Shift + 1 to 6 | Spawn infantry, RPG, sapper, technical, APC or tank at the crosshair |

---

## 2. Folder structure

```
MQ-9 Game/
├─ index.html              The page: game canvases, HUD panels, menu, pause and game-over screens,
│                          loadout cards and the control list shown on the menu
├─ package.json            npm scripts and the two dependencies
├─ vite.config.js          Dev server and build settings (relative base path)
├─ README.md               Player-facing description and controls
├─ CREDITS.md              Every third-party asset, its author and licence
├─ PROJECT_GUIDE.md        This file
├─ src/                    All game code (section 4)
├─ public/assets/          Everything shipped with the game (sections 8 and 10)
│  ├─ models/              Bundled low-poly models, the soldier and the guided bomb
│  │  ├─ vehicles/         Realistic vehicles that replace the bundled ones
│  │  └─ rounds/           25, 40 and 105 mm rounds
│  ├─ props/               22 photoscanned props and props.json (the load list)
│  ├─ trees/               Trees and palms: trees.json, trees.bin and 8 bark/leaf textures
│  ├─ tex/                 29 ground and building photo textures with normal maps
│  ├─ sfx/                 27 sound effects
│  ├─ ui/                  4 weapon icons for the HUD and menu
│  └─ fonts/               HUD font, 3 weights
├─ scripts/                Build tools (section 11)
│  ├─ blender/             Headless Blender converters for vehicles, props, soldiers, icons, bomb
│  ├─ build-trees.mjs      Builds public/assets/trees from the tree downloads
│  └─ sim-waves.mjs        Prints the wave difficulty curve
│
│  Source downloads (not shipped; only needed to rebuild assets):
├─ claude's demanded 3d models/   Sketchfab vehicle downloads, 482 MB
├─ missles/                       Round and bomb source models, 56 MB
├─ realistic_trees_collection/    Tree source, 41 MB
├─ date_palm/                     Palm source, 7 MB
├─ node_modules/                  Installed packages, 62 MB
└─ .claude/                       Claude Code settings for this project
```

| Shipped asset folder | Files | Size |
|---|---|---|
| `tex/` | 29 | 13 MB |
| `models/` (including `vehicles/` and `rounds/`) | 14 | 8.3 MB |
| `trees/` | 10 | 6.2 MB |
| `sfx/` | 27 | 5.1 MB |
| `props/` | 23 | 2.6 MB |
| `ui/` | 4 | 200 KB |
| `fonts/` | 3 | 44 KB |

---

## 3. How the game runs

**Start-up** (`src/main.js`): loads the HUD font, then every asset through `src/assets/Assets.js` with a progress bar, then builds the `Game`. The game object is exposed as `window.__game` for testing.

**States** (`src/Game.js`):

```
menu -> intermission <-> playing (<-> paused) -> gameoverSeq -> gameover -> intermission ...
```

**Each frame**, in this order:

1. Debug keys, then the player's keys (weapon, zoom, sensor mode, mute, pause).
2. Camera: the aircraft moves along its orbit and the sensor tracks the aim point.
3. Weapons (cooldowns, reloads, firing), shells and bombs in flight, waves, units, compound health, score.
4. Effects, destruction, radio, and the battle-intensity level for the ambient sound.
5. Tree level of detail, the sun's shadow area following the crosshair, then the instanced units and munitions are filled in.
6. Menus, HUD, and finally the renderer: scene, then bloom, then the sensor pass (daylight camera or thermal).

**Events**: systems talk through a small event bus (`src/core/events.js`). Events in use: `detonate`, `kill`, `dismount`, `enemyEngaged`, `friendlyKilled`, `sapperHit`.

**Weapons are identified by name, not position.** `WEAPONS` in `config.js` is ordered smallest to biggest (25mm, 40mm, 105mm, GBU), and that order sets the HUD order and the 1 to 4 keys. The code looks weapons up by their `id` (`'25'`, `'40'`, `'105'`, `'gbu'`), so the list can be reordered safely.

**Two looks on every surface**: each material carries a daylight colour and a thermal heat value, and one shared switch flips the whole scene between them (`src/render/heat.js`). The final image is made in `src/render/ThermalShader.js`.

---

## 4. Source code map

### Core and game flow

| File | Lines | What it does | Edit it to change |
|---|---|---|---|
| `src/main.js` | 40 | Font, asset loading, game start, main loop | Start-up behaviour, frame-time cap |
| `src/Game.js` | 353 | Owns every system, the state machine and key handling | Key bindings, frame order, game-over sequence |
| `src/config.js` | 297 | Almost every tunable number (section 5) | Balance, camera, weapons, enemies, colours, heat |
| `src/assets/Assets.js` | 143 | The lists of models, textures and sounds to load | Adding or removing an asset |
| `src/core/Input.js` | 91 | Mouse lock, buttons, wheel, keys | Blocked browser keys |
| `src/core/SpatialHash.js` | 55 | Grid for fast "who is near this point" lookups | Rarely |
| `src/core/events.js` | 17 | Event bus | Rarely |
| `src/core/rng.js` | 64 | Seeded random numbers and noise | Rarely |
| `src/debug/Debug.js` | 95 | Debug keys and stats overlay | Debug tools |

### Camera, combat and units

| File | Lines | What it does | Edit it to change |
|---|---|---|---|
| `src/camera/GunshipCamera.js` | 151 | Orbit, aiming, zoom steps, impact jolt spring and shake, gun position | Gun position (12 m aft, 4 m below the sensor), shake behaviour |
| `src/combat/Weapons.js` | 113 | Fire rate, magazines, 25mm overheating, bomb rearming, switch delay, recoil | Firing rules |
| `src/combat/Shells.js` | 264 | Shells on ballistic arcs, the guided bomb's fall and guidance, enemy rockets and cannon rounds | Flight paths, tracer streak length |
| `src/combat/Damage.js` | 64 | Splash damage, armour, kills, suppression, danger-close, impact flash and jolt | Damage rules |
| `src/entities/Units.js` | 463 | All soldiers, vehicles, corpses and wrecks; their instanced drawing | Instance limits, clothing colours, death physics |
| `src/entities/EnemyAI.js` | 180 | Enemies advance, stop at a firing ring and shoot; sappers charge | Enemy behaviour |
| `src/entities/Friendlies.js` | 47 | Friendly posts and patrols, return fire, IR strobes | Friendly behaviour |
| `src/game/WaveManager.js` | 106 | Runs a wave's spawn plan and detects the end of a wave | Wave pacing |
| `src/game/waveComposer.js` | 117 | Turns a wave number into an enemy mix (budget and type weights) | Difficulty curve |
| `src/game/Base.js` | 64 | Compound health and fires as it weakens | Base damage |
| `src/game/Score.js` | 135 | Points, kill chains, multi-kills, wave bonuses, high scores, saved settings | Scoring |
| `src/game/Radio.js` | 131 | Radio lines by event, with cooldowns | Radio text |

### Rendering and effects

| File | Lines | What it does | Edit it to change |
|---|---|---|---|
| `src/render/Renderer.js` | 132 | WebGL setup, 4x MSAA, bloom, sensor modes, shadow-map refresh | Sensor modes, bloom strength |
| `src/render/ThermalShader.js` | 165 | Final image: rainbow and black-hot thermal, daylight camera look | Thermal palette, grain, haze, sharpening |
| `src/render/heat.js` | 710 | Shared material system: daylight colour plus heat, textures, weathering, cloud shadows | Surface looks, vehicle material |
| `src/render/models.js` | 467 | Turns glTF models into game geometry, bakes the soldier's animations, vehicle heat layouts | Vehicle heat maps, soldier clips and heat |
| `src/render/textures.js` | 311 | Generated textures: soil detail, smoke and fire sprites, road, craters | Procedural textures |
| `src/render/InstancedBatch.js` | 55 | Refilled-each-frame instanced mesh | Rarely |
| `src/render/ContactShadows.js` | 79 | Dark ground blobs under units | Contact shadow strength |
| `src/fx/Effects.js` | 310 | Explosion, dust, debris and fire recipes for every weapon, emitters, IR strobes | How explosions look |
| `src/fx/Particles.js` | 256 | Particle pools ("hot" fire and sparks, "smoke" dust and smoke) | Particle lighting and look |
| `src/fx/Tracers.js` | 156 | Glowing tracer streaks that follow each round | Tracer look |
| `src/fx/Munitions.js` | 174 | Draws rounds and the bomb in flight with their 3D models and minimum on-screen sizes | Munition visibility |
| `src/fx/Decals.js` | 316 | Real crater holes in the ground, scorch rings | Craters |

### World

| File | Lines | What it does | Edit it to change |
|---|---|---|---|
| `src/world/World.js` | 398 | Builds the whole map once, merges it into 250 m tiles, sun, sky, shadows, raycasts | Vehicle models used for parked and wrecked cars, prop heat |
| `src/world/compound.js` | 246 | The defended hacienda: walls, gates, main house, wings, fountain, pool, palms, parked Humvees | The compound layout |
| `src/world/ranch.js` | 436 | Everything outside the walls: farms, barnyard, village, fields, trees, fences, power lines, wrecks | The surrounding map |
| `src/world/meshes.js` | 591 | Procedural building pieces: roofs, walls, arcades, barns, sheds, greenhouses, towers | Building shapes |
| `src/world/props.js` | 210 | Places the photoscanned props; instanced shrubs | Prop placement helpers |
| `src/world/Trees.js` | 232 | Instanced trees and palms with 3 levels of detail; toppling | Tree detail distances |
| `src/world/Destruction.js` | 497 | Buildings collapse, trees topple, cars burn, rocks shatter | Destruction styles |
| `src/world/roads.js` | 132 | 8 entry routes: 4 roads to the gates and 4 foot trails | Routes |
| `src/world/terrain.js` | 112 | The ground height function and terrain mesh | Terrain shape |
| `src/world/landcover.js` | 143 | Baked ground maps: dirt yards, fields, shade around buildings | Ground patterns |

### Interface

| File | Lines | What it does | Edit it to change |
|---|---|---|---|
| `src/ui/Hud.js` | 585 | HUD panels, reticle, compass, range scale, target boxes, bomb guidance, edge arrows | Everything drawn over the picture |
| `src/ui/Screens.js` | 118 | Menu, pause, game-over and banner screens | Screen text and stats |
| `src/ui/hud.css` | 570 | Styles for the HUD and screens | Fonts, colours, layout |
| `index.html` | | Page structure, menu loadout cards, control list | Menu content |

---

## 5. Configuration reference

All of these are in `src/config.js`. This file has no three.js imports, so `npm run sim:waves` can load it.

### Map and camera

| Setting | Value | Meaning |
|---|---|---|
| `MAP.spawnRadius` | 430 m | Enemies enter the map at this distance from the compound |
| `MAP.aimRadius` | 560 m | How far from the compound the crosshair can go |
| `MAP.fobHalf` | 70 m | Half the compound wall's side (a 140 m square) |
| `MAP.gateHalf` | 5 m | Half-width of each gate |
| `ROUTES` | 8 routes; roads on 0, 2, 4, 6 | Routes 0 to 7 point N, NE, E and so on; even ones are roads, odd ones foot trails |
| `CAMERA.orbitRadius` / `altitude` | 1000 m / 1500 m | The aircraft's circle around the compound |
| `CAMERA.orbitPeriod` | 150 s | Time for one full circle |
| `CAMERA.near` / `far` | 80 m / 9000 m | Camera clipping distances |
| `CAMERA.sensitivity` | 0.00035 | Radians of slew per mouse pixel at 1x (scaled down with zoom) |
| `CAMERA.fov` | 8 degrees | Field of view at 1x |
| `CAMERA.zooms` | 1, 2, 3 | Zoom steps for right click or Z |
| `CAMERA.fovLerp` | 10 | How quickly zoom changes settle |
| `CAMERA.switchTime` | 0.35 s | Weapon switch delay |
| `CAMERA.kickFreq` / `kickDamp` | 5.5 Hz / 0.3 | The impact jolt spring: how fast it swings back and how quickly it settles |
| `CAMERA.traumaDecay` | 1.4 per s | How quickly an impact's rumble fades |
| `CAMERA.shakeAngle` / `shakeRoll` / `shakeFreq` | 0.006 rad / 0.002 rad / 9 Hz | Size and speed of the rumble |
| `CAMERA.swayA` / `swayB` | 0.0012 / 0.0005 rad | The sensor's constant slow drift |

### Weapons

`WEAPONS`, in HUD and key order:

| | 25MM | 40MM | 105MM | GBU |
|---|---|---|---|---|
| `id` | `25` | `40` | `105` | `gbu` |
| Seconds between shots (`interval`) | 0.1 | 0.45 | 4.0 | 1.5 |
| Magazine (`mag`) / reload | none, overheats | 6 / 2.5 s | 1 in the breech (`single`) | 2 / 24 s rearm |
| Round speed (`speed`) | 1200 m/s | 1000 m/s | 800 m/s | guided, 7 to 12 s fall |
| Damage | 40 | 120 | 700 | 3200 |
| Full damage within (`inner`) / no damage beyond (`outer`) | 1.2 / 3.5 m | 2.5 / 8 m | 5 / 20 m | 7 / 26 m |
| Spread | 0.0009 | 0.0004 | 0 | 0 |
| Crater size (`decal`) | 1.8 | 4.8 | 15 | 22 |
| Overheat: per shot / cool rate / cool delay / resume at | 0.04 / 0.45 / 0.25 s / 0.25 | | | |
| Impact flash (`flash`) | 0 | 0.12 | 0.85 | 1 |
| Sensor gain dip (`dip`) | | | 0.6 | 0.45 |
| Impact jolt (`kick`) | 0.00022 rad (about 1 px) | 0.0007 (about 2.5 px) | 0.002 (about 11 px) | 0.0042 (about 25 px) |
| Impact rumble (`rumble`) | 0 | 0.12 | 0.35 | 0.6 |
| Firing recoil (`recoil`) | 0.0001 | 0.00035 | 0.0011 | 0.0003 |
| Body throw (`push`) | 0 | 11 | 22 | 30 |
| Tracer length / heat / width | 30 m / 1.8 / 2 px | 22 m / 2.0 / 2.5 px | 30 m / 2.2 / 3 px | none |
| HUD reticle size (`reticle`), compass radius | 76 px, 92 | 104 px, 118 | 140 px, 150 | 140 px, 150 |
| Icon (`icon`, in `public/assets/ui/`) | `round_25` | `round_40` | `round_105` | `gbu` |

`GBU` (the bomb's flight):

| Setting | Value | Meaning |
|---|---|---|
| `pathSpeed` | 180 m/s | Flight time is the distance divided by this |
| `timeMin` / `timeMax` | 7 / 12 s | Shortest and longest flight time |
| `lockRange` | 260 m | How far from the crosshair it looks for a vehicle to lock |
| `track` | 40 m/s | How fast its aim point can follow a moving or new target |
| `rack` | -3 m | Rack height under the aircraft |
| `sag` | 1.1 | How far the fall sags below the line of sight, in half fields of view |
| `lag` | 0.75 | How much it drifts toward the aircraft's tail, so it enters from the lower left |

`ARMOR` multiplies damage by weapon and armour class:

| Weapon | soft | light | armored | tank |
|---|---|---|---|---|
| 105 | 1 | 1 | 1 | 1 |
| 40 | 1 | 1 | 0.5 | 0.15 |
| 25 | 1 | 0.2 | 0 | 0 |
| gbu | 1 | 1 | 1 | 1 |

### Enemies, friendlies, base and waves

`ENEMY_TYPES`:

| Type | HP | Armour | Speed m/s | Cost | First wave | Stops at | Attack | Fires every | Damage | Score | Carries |
|---|---|---|---|---|---|---|---|---|---|---|---|
| infantry | 35 | soft | 3.0 | 1 | 1 | 135 m ± 30 | rifle | 2 s | 1.5 | 50 | |
| rpg | 35 | soft | 2.8 | 3 | 2 | 170 m ± 24 | rocket | 8 s | 25 | 150 | |
| sapper | 50 | soft | 6.0 | 3 | 4 | charges from 240 m | blast, 10 m | | 120 | 150 | |
| technical | 240 | light | 12 | 7 | 3 | 215 m ± 20 | machine gun | 0.5 s | 2 | 300 | 3 soldiers |
| apc | 900 | armored | 7 | 16 | 6 | 245 m ± 20 | cannon | 3 s | 20 | 750 | 6 soldiers |
| tank | 1800 | tank | 5 | 30 | 10 | 300 m ± 20 | shell | 6 s | 70 | 1500 | |

Each type also has `radius` (hit size) and `friendlyChance` (how often it shoots soldiers instead of the base). People are drawn 1.15 times life size (`PERSON_SCALE`) so they read from altitude; hit sizes are not scaled.

| Setting | Values |
|---|---|
| `FRIENDLY` | hp 100, range 230 m, fires every 1.2 to 2.0 s, hit chance 0.15, damage 14, patrol speed 1.4 m/s; enemy shots at soldiers hit 18% of the time for 34 |
| `BASE` | 1000 HP, repairs 120 between waves (250 after a boss wave), takes 5% of your own shell's damage inside the wire, burns at 75%, 50% and 25% |
| `WAVES` | first wave after 5 s, 10 s breaks, boss every 5th wave, at most 150 enemies alive; once a wave has fully spawned, if 3 or fewer enemies are left and nothing has been killed for 30 s, they charge |
| Wave size (`waveComposer.js`) | budget = 8 + 6n + 0.5n², +25% on boss waves; type weights grow with the wave number; tanks from wave 15 in normal waves |

### Score

| Setting | Value |
|---|---|
| Kill chain | kills within 3 s chain; every 5 kills adds 0.5x, up to 4x |
| Multi-kill bonus | 75 x k(k-1)/2 for k kills from one shell, times the multiplier |
| Wave clear | 250 x the wave number, +25 per surviving friendly, +1000 for no compound damage, +300 for no friendly fire, all x2 on boss waves |
| Friendly fire | -500 per friendly killed |
| Saved in the browser | high scores under `gunship.highscores.v1`, settings under `gunship.settings.v1` |

### Look: lighting, heat and colour

| Setting | Meaning |
|---|---|
| `LIGHT.shadowMap` | Sun shadow map size, 4096 |
| `LIGHT.thermal` | Thermal ambient 0.46 and sun 0.6 |
| `LIGHT.day` | Sun 3.0, sky 1.0, camera exposure 0.5, haze 0.06 with a blue tint |
| `RENDER.msaa` | Anti-aliasing samples, 4 |
| `RENDER.soldierShadows` | Soldiers cast sun shadows (off for speed) |
| `HEAT` | Thermal brightness of each surface. Sunlit ground ends up around 0.7; above about 1.1 glows (people, engines, fire). Examples: ground 0.6, vehicle 0.6, engine 1.5, exhaust 1.8, tree 0.36, water 0.16, IR strobe 2.2 |
| `COLOR` | Daylight colours of untextured surfaces |
| `WALL_PAINT` | Wall paint choices for the hacienda and the village |
| `DESTRUCT` | Hit points, destruction style and damage multiplier per weapon for each kind of map object |

`DESTRUCT` hit points: tree 70, palm 55, hay bale 30, drums 25, parked vehicle 160, rock 420, fountain 350, greenhouse 200, shed 260, water tower 320, barn 520, house 480, stable 600, hacienda block 650. Soft things take 0.6x from the 25mm; buildings and rock take 0.12x from the 25mm, 0.55x from the 40mm and 1.3x from the GBU.

---

## 6. Settings that live outside config.js

| File | Setting | Value | What it controls |
|---|---|---|---|
| `src/audio/Audio.js` | `GBU_MIX` | blast 0.95, rumble 0.7, thump 0.42 | Levels of the GBU explosion's layers |
| `src/audio/Audio.js` | `PUNCH_LEVEL` | 0.9 | Level of the GBU's own bus, which bypasses the compressor |
| `src/audio/Audio.js` | `GBU_RISER_PEAK` | 2.55 s | Where the GBU's incoming rush peaks, timed to impact |
| `src/audio/Audio.js` | `duck(...)` call in `impact` | 0.3 for 2.2 s | How far other sounds drop under a GBU blast |
| `src/combat/Shells.js` | `STREAK_TIME` | 0.06 s | Tracer streak: the distance a round covers in this time |
| `src/combat/Shells.js` | `ENEMY_SPEED` | rocket 75, cannon 220, shell 260 m/s | Enemy projectile speeds |
| `src/camera/GunshipCamera.js` | gun position | 12 m aft, 4 m below the sensor | Where shells start, so where tracers enter the picture |
| `src/fx/Munitions.js` | `MIN_WIDTH_PX` | 25mm 3, 40mm 4.5, 105mm 6 | Smallest on-screen width of a round |
| `src/fx/Munitions.js` | `MIN_LENGTH_PX_GBU` / `MIN_WIDTH_PX_GBU` / `MAX_LENGTH_PX_GBU` | 40 / 16 / 170 | The bomb's smallest and largest on-screen size |
| `src/render/ThermalShader.js` | `rainbow()` and its mapping | 9 colour stops; heat (h - 0.25) / 0.75, raised to 1.5 | The rainbow palette and which heat lands on which colour |
| `src/render/Renderer.js` | `MODES` | TV, RAINBOW, BHOT | Sensor modes and the F-key order |
| `src/render/Renderer.js` | bloom settings | day 0.32 strength, thermal 0.5 | Glow strength per mode |
| `src/entities/Units.js` | `FRAME_CAP`, `CORPSE_CAP` | run 140, walk 70, idle 90, shoot 90, death 60, hit 80; corpses 420 | Most soldiers drawable at once per animation frame |
| `src/entities/Units.js` | vehicle caps | technical 80, APC 60, tank 40 | Most enemy vehicles drawable at once |
| `src/entities/Units.js` | `ENEMY_CLOTHES`, `FRIENDLY_CLOTHES` | colour lists | Clothing colours in daylight |
| `src/render/models.js` | `SOLDIER_CLIPS`, `SOLDIER_HEAT` | clip list; skin 1.65, uniform 1.3 | Which animations are baked and how hot soldiers look |
| `src/render/models.js` | `HEAT_FNS` | per vehicle type | Thermal layout of each vehicle: hot engine, exhaust, tyres |
| `src/world/Trees.js` | `LOD0_PX`, `LOD1_PX` | 90 px, 48 px | On-screen tree height that switches to full and medium detail |
| `src/world/terrain.js` | `SIZE`, `SEG` | 5200 m, 260 | Terrain size and grid (20 m cells) |
| `src/world/World.js` | `TILE`, `PROP_HEAT` | 250 m; per prop kind | Merge tile size; thermal heat of each prop kind |
| `src/world/Destruction.js` | `COOL_HEAT` | 0.72 | What wreckage cools to in thermal |
| `src/game/Radio.js` | `LINES`, `COOLDOWN` | text per event | Radio lines and how often each may repeat |
| `src/ui/Hud.js` | `BOX_TAG`, `SPEAKER`, `FONT` | | Target box labels, radio speaker names, HUD font |

---

## 7. How to change common things

**Weapon balance.** Edit the weapon's entry in `WEAPONS` (damage, splash, fire rate, magazine, speed) and its row in `ARMOR`.

**Weapon order or keys.** Reorder the `WEAPONS` array. The HUD, the 1 to 4 keys and the shot statistics follow automatically. Also reorder the loadout cards and the key hint in `index.html`.

**Add a weapon.** All of these are needed, or damage turns into "not a number":

1. An entry in `WEAPONS` with a new `id` and an `icon`.
2. A row in `ARMOR` for that `id`.
3. The `id` in `SOFT`, `HARD` and the vehicle multiplier in `DESTRUCT`.
4. An icon PNG in `public/assets/ui/` (512 x 128, nose to the right).
5. Its sounds in `Audio.fire()` and `Audio.impact()`.
6. Its explosion recipe in `Effects.impact()`.
7. A model batch in `Munitions` if it should be drawn in flight.
8. A loadout card in `index.html`.

**Zoom.** `CAMERA.zooms` lists the steps and `CAMERA.fov` sets the 1x view.

**Camera shake.** Each weapon's `kick` (the jolt), `rumble` (the shake after it) and `recoil`. Make the jolt bouncier or calmer with `CAMERA.kickFreq` and `kickDamp`.

**Thermal palette or modes.** Colours are in `rainbow()` in `ThermalShader.js`. The line that calls it sets which heat maps to which colour. The mode list is `MODES` in `Renderer.js`, and the HUD label is in `Hud.js` (`sensor2`).

**How hot something looks.** `HEAT` in `config.js` for surfaces, `HEAT_FNS` in `models.js` for vehicles, `SOLDIER_HEAT` for soldiers, `PROP_HEAT` in `World.js` for props.

**Daylight look.** `LIGHT.day` (sun, sky, exposure, haze) and the daylight branch of `ThermalShader.js` (sharpening, colour fringing, contrast).

**Enemies and difficulty.** Stats in `ENEMY_TYPES`. Wave size and mix in `waveBudget` and `typeWeights` in `waveComposer.js`. Check the curve with `npm run sim:waves`.

**Replace a vehicle.** Download a model under about 30,000 triangles, convert it with `convert_vehicle.py` and save it as `public/assets/models/vehicles/<technical|truck|tank|humvee|car>.glb`. If its engine is in an unusual place, adjust its heat layout in `HEAT_FNS`, then add its credit to `CREDITS.md`. Which game role uses which file:

| File | Used as |
|---|---|
| `technical.glb` | Enemy technical |
| `truck.glb` | Enemy APC and parked trucks |
| `tank.glb` | Enemy tank |
| `humvee.glb` | The 3 parked Humvees in the compound |
| `car.glb` | Parked civilian pickups (white and red) and the burnt-out wrecks |

**Replace the soldier.** Download a Mixamo character and its animations, combine them with `convert_mixamo.py` into `public/assets/models/soldiers/soldier.glb`. The game uses it automatically.

**Add a prop.** Convert it with `convert_prop.py` into `public/assets/props/<name>.glb` and add the name to `props.json`. Its heat kind comes from the start of its name in `PROP_HEAT` (`World.js`). Place it from `ranch.js` or `compound.js` through `LIB` and `addProp`.

**Add or change a sound.** Put the MP3 in `public/assets/sfx/`, add its name to `SFX` in `Assets.js`, and play it from `Audio.js` with `this.play(this.raw.<name>, { ... })`. Then credit it in `CREDITS.md`.

**Explosions.** `Effects.impact()` holds one recipe per weapon: flash, fireball, dust cloud, debris, dust ring, crater and fires.

**Munition visibility.** Minimum on-screen sizes in `Munitions.js`, tracer length in `Shells.js`, the bomb's fall in `GBU`, the gun position in `GunshipCamera.js`.

**The map.** The compound is in `compound.js`, everything outside it in `ranch.js`, building shapes in `meshes.js`, roads in `roads.js`, ground shape in `terrain.js`.

**HUD and menus.** Drawing is in `Hud.js`, layout and colours in `hud.css`, menu text in `index.html` and `Screens.js`.

**Performance.** The biggest levers:

- `RENDER.msaa`, 4 samples.
- `LIGHT.shadowMap`, 4096.
- Tree detail switch points (`LOD0_PX` and `LOD1_PX`).
- `WAVES.aliveCap`, 150 enemies.
- The soldier's triangle count (7,800 per soldier).
- The Humvee model (24,749 triangles, the heaviest vehicle).

---

## 8. 3D models: full statistics

Measured from the files. Vertices are the file's stored vertices; triangles are drawn triangles. Size is width x height x length in metres as the model sits in its file (Y up). The game re-scales the bundled models, so their file size can differ from the in-game size.

### Realistic vehicles (in use)

| File | Game role | Vertices | Triangles | Meshes | Materials | Texture | Size (m) | File | Source |
|---|---|---|---|---|---|---|---|---|---|
| `vehicles/technical.glb` | Enemy technical | 11,493 | 11,430 | 1 | 1 | 1024 x 1024 JPEG atlas | 2.26 x 2.10 x 5.20 | 625 KB | Pick-up Truck Improvised Fighting Vehicle |
| `vehicles/truck.glb` | Enemy APC, parked trucks | 9,770 | 8,492 | 1 | 1 | 1024 x 1024 JPEG atlas | 2.98 x 3.19 x 7.37 | 504 KB | Ural 4320 |
| `vehicles/tank.glb` | Enemy tank | 16,237 | 10,901 | 1 | 1 | 1024 x 1024 JPEG atlas | 2.91 x 2.65 x 7.02 | 727 KB | Panzer IV |
| `vehicles/humvee.glb` | Parked Humvees | 36,016 | 24,749 | 1 | 1 | 1024 x 1024 JPEG atlas | 2.75 x 2.42 x 4.57 | 1,392 KB | Ukrainian M998 Humvee (insignia removed) |
| `vehicles/car.glb` | Civilian pickups, wrecks | 8,440 | 9,999 | 1 | 1 | 1024 x 1024 JPEG atlas | 2.11 x 1.80 x 4.90 | 467 KB | Chevrolet C10 1963 |

All five face +Z, sit on the ground at real size, and carry position, normal and one UV set. Every original material was baked into the single atlas by `convert_vehicle.py`.

### Soldier (in use)

| File | Vertices | Triangles | Meshes / parts | Materials | Skeleton | Animations | Size (m) | File |
|---|---|---|---|---|---|---|---|---|
| `soldier.glb` | 14,254 | 7,752 | 4 / 9 | 4, untextured: Swat, Swat_Black, Skin, Visor | 62 bones | 24 clips | 1.68 x 1.85 x 0.36 | 1,524 KB |

This is the bundled stylised "SWAT" character by Quaternius. The game bakes 6 of its clips (run, walk, idle with gun, shooting, death, hit) into static frames (see section 9).

### Munitions (in use)

| File | Vertices | Triangles | Meshes | Materials | Textures | Size (m) | File |
|---|---|---|---|---|---|---|---|
| `rounds/r25.glb` | 3,987 | 5,784 | 2 (case, projectile) | 2 | colour + normal, 512 x 512 JPEG, per material | 0.04 x 0.22 x 0.04 | 256 KB |
| `rounds/r40.glb` | 4,331 | 6,000 | 2 | 2 | as above | 0.06 x 0.44 x 0.06 | 283 KB |
| `rounds/r105.glb` | 4,909 | 6,000 | 2 | 2 | as above | 0.12 x 0.79 x 0.12 | 291 KB |
| `gbu.glb` | 946 | 1,152 | 1 (4 parts) | 4, untextured: Body, Seeker, Kit, Band | none | 0.65 x 0.65 x 3.15 | 32 KB |

The round sizes are length along Y. Only the projectile flies; the brass case stays in the gun, so each round in flight draws 3,000 triangles.

### Bundled low-poly vehicles (fallbacks, loaded but not drawn)

These load at start-up but are only drawn if a file in `models/vehicles/` is missing.

| File | Stands in for | Vertices | Triangles | Meshes / parts | Materials | Textures | Rig | Size in file | File |
|---|---|---|---|---|---|---|---|---|---|
| `pickup.glb` | Technical and car | 6,964 | 6,432 | 4 / 6 | 3 | 512 x 512 PNG | | 2.31 x 1.85 x 5.18 | 267 KB |
| `truck.glb` | APC and truck | 18,666 | 9,938 | 9 / 24 | 11 | none | | 7.26 x 3.05 x 2.67 (lies along X) | 670 KB |
| `tank.glb` | Tank | 11,126 | 6,064 | 5 / 11 | 9 | none, vertex colours | 45 bones, 4 clips | 17.2 x 7.48 x 10.09 (file units; game scales it to 9.2 m) | 817 KB |
| `humvee.glb` | Humvee | 15,802 | 8,148 | 1 / 1 | 1 | 64 x 64 PNG | | 4.68 x 2.00 x 2.70 (lies along X) | 544 KB |

### Props (photoscans, `public/assets/props/`)

| File | Vertices | Triangles | Materials | Textures | Size (m) | File |
|---|---|---|---|---|---|---|
| `aircon.glb` | 206 | 236 | 1 | 512 JPEG | 0.23 x 0.49 x 0.75 | 62 KB |
| `barrel_blue.glb` | 341 | 250 | 1 | 512 JPEG | 0.64 x 0.93 x 0.63 | 38 KB |
| `barrel_red.glb` | 280 | 250 | 1 | 512 JPEG | 0.56 x 0.88 x 0.56 | 47 KB |
| `boulder_a.glb` | 445 | 600 | 1 | 512 JPEG colour + normal | 2.39 x 1.45 x 3.08 | 151 KB |
| `boulder_b.glb` | 437 | 600 | 1 | 512 JPEG colour + normal | 2.51 x 1.88 x 2.49 | 155 KB |
| `boulder_c.glb` | 516 | 600 | 1 | 512 JPEG colour + normal | 0.73 x 0.53 x 1.35 | 182 KB |
| `boulder_d.glb` | 523 | 600 | 1 | 512 JPEG colour + normal | 0.66 x 0.65 x 1.21 | 178 KB |
| `bush_dry_a.glb` | 1,866 | 898 | 2 (solid, cut-out) | 512 WebP | 0.68 x 0.51 x 0.72 | 115 KB |
| `bush_dry_b.glb` | 1,827 | 883 | 2 | 512 WebP | 0.49 x 0.49 x 0.51 | 114 KB |
| `bush_dry_c.glb` | 1,749 | 886 | 2 | 512 WebP | 0.41 x 0.45 x 0.48 | 111 KB |
| `bush_dry_d.glb` | 1,709 | 887 | 2 | 512 WebP | 0.34 x 0.41 x 0.40 | 110 KB |
| `bush_dry_e.glb` | 1,329 | 815 | 2 | 512 WebP | 0.18 x 0.32 x 0.29 | 98 KB |
| `bush_green_a.glb` | 1,871 | 895 | 2 | 512 WebP | 1.67 x 2.10 x 1.68 | 140 KB |
| `bush_green_b.glb` | 1,797 | 895 | 2 | 512 WebP | 1.26 x 1.73 x 1.42 | 138 KB |
| `bush_green_c.glb` | 1,799 | 895 | 2 | 512 WebP | 1.20 x 1.59 x 1.51 | 138 KB |
| `bush_green_d.glb` | 1,823 | 895 | 2 | 512 WebP | 0.87 x 1.38 x 1.06 | 138 KB |
| `bush_green_e.glb` | 1,802 | 898 | 2 | 512 WebP | 0.68 x 1.01 x 1.03 | 138 KB |
| `bush_green_f.glb` | 1,745 | 892 | 2 | 512 WebP | 0.49 x 0.73 x 0.63 | 136 KB |
| `bush_green_g.glb` | 1,695 | 897 | 2 | 512 WebP | 0.33 x 0.79 x 0.39 | 134 KB |
| `covered_car.glb` | 2,385 | 1,490 | 1 | 512 JPEG | 1.80 x 1.41 x 4.38 | 128 KB |
| `crate.glb` | 130 | 120 | 1 | 512 JPEG | 0.39 x 0.34 x 0.71 | 37 KB |
| `road_barrier.glb` | 226 | 200 | 1 | 512 JPEG | 0.63 x 0.83 x 1.54 | 50 KB |

Boulders also carry tangents for their normal maps. Each bush's two materials share one WebP texture; the cut-out one uses alpha masking and is double-sided. The source scan and author of each prop is listed in `public/assets/props/SOURCES.md`.

### Trees and palms (`public/assets/trees/`)

Stored in a custom format (`trees.json` describes the parts, `trees.bin` holds the vertex data). Each variant has three levels of detail: full detail up close, medium, and a sparse far version. Vertex and triangle counts are per plant.

| Variant | Group | Height (m) | Crown radius (m) | Full: vertices / triangles | Medium | Far |
|---|---|---|---|---|---|---|
| EZTree0.Large | tree | 10.84 | 6.14 | 12,579 / 6,120 | 4,835 / 1,994 | 1,544 / 608 |
| EZTree0.Medium010 | tree | 7.00 | 3.55 | 15,465 / 6,932 | 5,679 / 2,116 | 1,987 / 714 |
| EZTree0.Medium011 | tree | 4.96 | 2.64 | 12,782 / 6,200 | 5,459 / 2,136 | 1,925 / 670 |
| EZTree1.Bush006 | tree | 1.93 | 1.86 | 9,867 / 5,096 | 5,251 / 2,076 | 1,670 / 630 |
| EZTree1.Large001 | tree | 8.63 | | 14,719 / 6,813 | 4,921 / 2,036 | 1,597 / 621 |
| EZTree1.Large009 | tree | 11.21 | | 14,834 / 6,752 | 4,813 / 1,972 | 1,679 / 642 |
| EZTree1.Medium002 | tree | 5.13 | | 14,518 / 6,826 | 4,746 / 1,974 | 1,688 / 656 |
| DatePalm | palm | 7.34 | | 5,250 / 9,941 | 2,946 / 7,061 | 1,521 / 3,816 |

Every broadleaf tree is one bark part (2,600 / 520 / 120 triangles by level) plus one leaf-card part. Tree textures: `bark` 512, `leaves_a`, `leaves_b`, `leaves_c` 1024, `palm_trunk` 512, `palm_boots` 512, `palm_fronds` 1024 and `palm_stems` 64 x 512, all WebP, 8 in all.

---

## 9. 3D in the running game

### Map contents

| Placed on the map | Count |
|---|---|
| Broadleaf trees | 1,494 |
| Date palms | 40 |
| Shrubs | 2,346 |
| Agave plants | 8,458 |
| Rocks and boulders | 266 |
| Hacienda building blocks | 4 |
| Houses | 17 |
| Barns / stable / sheds / greenhouses / water towers / fountain | 4 / 1 / 2 / 2 / 2 / 1 |
| Parked vehicles: 3 Humvees, 3 trucks, 5 white pickups, 3 red pickups, 1 covered car | 15 |
| Burnt-out wrecks | 8 |
| Hay bales | 40 |
| Oil drum groups | 5 |
| Collision boxes for shells (buildings, walls) | 60 |

Trees, palms, rocks, buildings, parked vehicles, hay bales and oil drums can all be destroyed. Shrubs, agave and the burnt-out wrecks cannot.

### Geometry the game builds

The game converts models into its own format with extra per-vertex data (daylight colour, heat, paint mask). Vehicles are un-indexed (every triangle has its own 3 vertices), so their in-game vertex counts are 3 times their triangle counts.

| What | Vertices | Triangles | How it is drawn |
|---|---|---|---|
| Enemy technical | 34,290 | 11,430 | Instanced, up to 80, casts shadows |
| Enemy APC (Ural truck) | 25,476 | 8,492 | Instanced, up to 60, casts shadows |
| Enemy tank (Panzer IV) | 32,703 | 10,901 | Instanced, up to 40, casts shadows |
| Soldier, one animation frame | 14,398 (14,254 in death and hit frames, which drop the rifle) | 7,800 (7,752) | Instanced per frame |
| Soldier, all 72 baked frames | 1,033,488 | 560,544 | 72 instanced meshes, 6,780 slots in total |
| One round in flight (25, 40 or 105 mm) | 9,000 | 3,000 | Instanced, up to 64 / 24 / 8 |
| Guided bomb in flight | 3,456 | 1,152 | Instanced, up to 6, casts shadows |
| Terrain | 68,121 | 135,200 | One mesh, 5.2 km square, 20 m grid |
| Roads | 4,182 | 1,394 | One mesh |
| Craters | 896 | 1,680 | Instanced, up to 250 |
| Agave | 960 | 320 | Instanced, 8,458 plants |
| Trees, palms and shrubs (all variants and detail levels) | 619,345 | 240,092 | 399 instanced batches, 14,016 slots |

Soldier animation frames: run 16 frames over 0.79 s, walk 16 over 1.33 s, idle 10 over 1.67 s, shooting 8 over 0.67 s, death 16 over 1.04 s, hit 6 over 0.54 s.

### The static map, merged by material

The buildings, props and parked vehicles are merged into one mesh per material per 250 m tile:

| Material | Pieces | Vertices | Triangles |
|---|---|---|---|
| Burnt-out wrecks (`veh_wreck`) | 8 cars | 239,976 | 79,992 |
| Parked Humvees (`veh_humvee`) | 3 | 222,741 | 74,247 |
| White pickups (`veh_car`) | 5 | 149,985 | 49,995 |
| Red pickups (`veh_carRed`) | 3 | 89,991 | 29,997 |
| Parked trucks (`veh_truck`) | 3 | 76,428 | 25,476 |
| Boulders, 4 kinds | 258 | 464,400 | 154,800 |
| Untextured detail (`plain`) | | 58,728 | 19,576 |
| Wood | | 43,224 | 14,408 |
| Metal | | 14,820 | 4,940 |
| Plaster walls | | 12,252 | 4,084 |
| Blue / red oil drums | 15 / 9 | 11,250 / 6,750 | 3,750 / 2,250 |
| Hay | | 7,008 | 2,336 |
| Air conditioners | 7 | 4,956 | 1,652 |
| Road barriers | 8 | 4,800 | 1,600 |
| Covered car | 1 | 4,470 | 1,490 |
| Crates | 11 | 3,960 | 1,320 |
| Clay walls, windows, pavers, hedges, water, roof tiles, lawn, glass, tin roofs | | 6,918 in all | 2,306 in all |
| Power lines | | 608 | (lines) |

The boulders, the 8 wrecks and the 3 parked Humvees each cost more triangles than all the buildings together (about 47,700).

### Per-frame cost

| View | Draw calls | Triangles per frame | Frame rate |
|---|---|---|---|
| Daylight, compound, 1x | about 310 | about 2.1 million | 58 fps |
| Rainbow thermal, compound, 1x | about 190 | about 1.4 million | 53 fps |
| Black-hot thermal, compound, 1x | about 340 | about 2.3 million | 53 fps |
| Daylight with 150 enemies | about 320 | about 3.2 million | 48 fps |

The numbers include the sun's shadow pass and vary as the aircraft circles. They are from the Intel integrated GPU. The scene holds 708 drawable objects, 201 geometries and 70 GPU textures.

Effect pools: 4,500 fire and spark particles, 6,500 smoke and dust particles, 900 tracers, 700 contact shadows.

---

## 10. Textures, sounds, fonts and icons

### Photo textures (`public/assets/tex/`, all Poly Haven, CC0)

Each has a colour map and a matching normal map (`_nor`), except `aerial_ground_rock`, which has no normal map.

| Texture | Size | Used for |
|---|---|---|
| `aerial_grass_rock` | 2048 | Ground: grassland |
| `aerial_ground_rock` | 1024 | Ground: dry patches |
| `dirt_aerial_02` | 1024 | Ground: dirt yards; road edges |
| `raked_dirt` | 1024 | Ground: tilled fields |
| `dry_ground_rocks` | 1024 | Ground: close-up detail over everything |
| `aerial_sand` | 1024 | Roads |
| `leafy_grass` | 1024 | Lawns |
| `dry_riverbed_rock` | 1024 | Rock |
| `painted_plaster_wall` | 1024 | Stucco walls (`plaster`) |
| `patterned_clay_plaster` | 1024 | Adobe walls (`clay`) |
| `clay_roof_tiles_02` | 1024 | Tiled roofs (`tile`) |
| `worn_corrugated_iron` | 1024 | Tin roofs (`tin`) |
| `box_profile_metal_sheet` | 1024 | Red metal roofs (`tinred`) |
| `weathered_planks` | 1024 | Wood |
| `square_cobblestone` | 1024 | Paving (`paver`) |

The game also generates textures in code (`src/render/textures.js`): soil detail, the smoke and fire sprite atlas, the road surface and crater masks.

### Sound effects (`public/assets/sfx/`)

| File | Length | Played for |
|---|---|---|
| `gun25.mp3` | 1.2 s | 25mm shot |
| `gun40_a.mp3`, `gun40_b.mp3` | 1.8 s, 0.5 s | 40mm shot (thump and crack) |
| `gun105_a.mp3`, `gun105_b.mp3`, `gun105_sub.mp3` | 6.9 s, 0.8 s, 2.4 s | 105mm shot (report, crack, sub-bass) |
| `casing.mp3` | 14.0 s | Brass casings, 105 reload |
| `exp_small.mp3`, `exp_thump.mp3` | 1.7 s, 3.1 s | 25mm impacts |
| `exp_med_a.mp3`, `exp_med_b.mp3` | 2.9 s, 3.2 s | 40mm impacts, enemy rockets |
| `exp_big.mp3`, `exp_rumble.mp3`, `exp_debris.mp3` | 7.8 s, 13.0 s, 13.5 s | 105mm impacts, collapses |
| `exp_vehicle.mp3` | 7.6 s | Vehicle explosions |
| `gbu_release.mp3` | 6.9 s | GBU leaving the rack |
| `gbu_incoming.mp3` | 2.9 s | GBU's rush, peaking at impact |
| `gbu_blast.mp3`, `gbu_rumble.mp3` | 12.2 s, 14.3 s | GBU explosion and rolling rumble (plus a generated sub-bass thump) |
| `engine_turboprop.mp3`, `engine_cabin.mp3` | 37.4 s, 22.5 s | Aircraft engine loops |
| `amb_war.mp3`, `amb_gunfire.mp3`, `burst_distant.mp3` | 23.8 s, 7.6 s, 2.1 s | Battle ambience |
| `fire_loop.mp3` | 21.0 s | Burning wrecks nearby |
| `radio_in.mp3`, `radio_out.mp3` | 0.3 s, 0.7 s | Radio squelch |

The sound chain: every effect goes through a compressor and a limiter, with a generated outdoor echo. The GBU blast takes its own route around the compressor, and a safety clipper after the limiter keeps the output below full scale. Distance muffles and delays impacts, and the screen position pans them left or right.

### Fonts and icons

| File | What |
|---|---|
| `fonts/barlow-sc-400.woff2`, `-500`, `-600` | Barlow Semi Condensed, the HUD font, three weights |
| `ui/round_25.png`, `round_40.png`, `round_105.png`, `gbu.png` | 512 x 128 side-view icons for the weapon box and menu |

---

## 11. Asset tools

| Script | What it does |
|---|---|
| `scripts/blender/convert_vehicle.py` | Converts a downloaded vehicle into a game GLB: joins all parts, reduces it if needed, bakes every material into one 1024 atlas, faces it +Z at real size, and renders preview images. Options: `--front` (which way the nose points), `--length` (real length in metres), `--tris`, `--atlas`, `--exclude` (drop parts by name), `--probe=1` (orientation check only), `--preview` |
| `scripts/blender/convert_prop.py` | Converts a prop into a light GLB |
| `scripts/blender/convert_mixamo.py` | Combines a Mixamo character and its animations into the soldier GLB |
| `scripts/blender/make_gbu.py` | Builds the guided bomb model and its icon |
| `scripts/blender/build_assets.py` | Rebuilds the props, rounds and round icons from their sources |
| `scripts/blender/fetch_polyhaven.py` | Downloads Poly Haven model packages |
| `scripts/blender/render_icon.py` | Renders a side-view HUD icon of a model |
| `scripts/blender/inspect_models.py` | Prints model statistics and preview sheets |
| `scripts/blender/bl_common.py` | Shared helpers for the scripts above |
| `scripts/build-trees.mjs` | Builds the trees asset with three levels of detail |
| `scripts/sim-waves.mjs` | Prints the wave difficulty curve |

Run a Blender script like this:

```
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --factory-startup --python scripts/blender/convert_vehicle.py -- <input> <output.glb> --front=-y --length=5.2
```

**Models that convert well** are under about 30,000 triangles, with real textures and a CC0 or CC BY licence. Very dense models (hundreds of thousands to millions of triangles) tear and lose their texture when reduced.

### Re-measuring

To refresh the numbers in sections 8 and 9 after changing assets, ask Claude to "re-measure the 3D stats in PROJECT_GUIDE.md". It reads each GLB's data directly and measures the running game in a browser.

---

## 12. Known limits and open items

- **The soldier is still the stylised bundled model.** A realistic one needs a Mixamo download (character plus Run, Walk, Idle_Gun, Idle_Gun_Shoot, Death and HitRecieve animations), converted with `convert_mixamo.py`.
- **The four bundled low-poly vehicles still load** (2.3 MB) even though the realistic ones replace them. Making them load only when a realistic file is missing would shorten start-up.
- **The Humvee is the heaviest model** at 24,749 triangles, and there are 3 of them. The 8 wrecks share the car model at 9,999 triangles each.
- **The Humvee's licence is CC BY-NC**, which forbids commercial use. The technical is under the Sketchfab Standard licence, which allows use in the game but not redistributing the model on its own. See `CREDITS.md`.
- **At 3x zoom, shells appear later in their flight**, about 30 to 40% of the way. The view is only 2.7 degrees wide, and a real round is outside it until it gets close to the target.
- **Two downloads are unused** and can be deleted to save space: `claude's demanded 3d models/humvee` (2.9 million triangles) and `claude's demanded 3d models/t72m1`. The other source folders are only needed to rebuild assets.

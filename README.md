# Gunship: Hacienda Defense

An endless browser wave-defense game: you're the gunner on an AC-130 circling a ranch, and you hold off cartel attacks on a walled hacienda through daylight and thermal cameras.

The game is styled after the AC-130 "Close Air" mission from Modern Warfare 2 (2022). Your team holds the hacienda while cartel gunmen, technicals, trucks and tanks attack in waves that keep getting bigger. The run ends when the compound's integrity hits zero, so the goal is the high score.

## Features

- **Three sensor modes, like the mission's gunship camera:** a daylight colour camera, a rainbow thermal image (cold ground in blues and greens, warm bodies and engines in yellow, red and white), and black-hot thermal. Every surface carries both a daylight colour and a heat value, and one switch flips the whole scene between them.
- **Four weapons with real flight paths:** a 25mm Gatling, a 40mm autocannon, a 105mm howitzer, and a guided bomb (GBU) that locks onto the nearest vehicle. Shells fly ballistic arcs from the guns, a few metres aft of the sensor, so you have to lead moving targets. Shells and the bomb are drawn in flight with their 3D models.
- **Endless waves** that grow in size and mix with every wave, with a boss wave every 5th wave.
- **A detailed ranch map:** the hacienda with stucco walls, tiled roofs, arcades, a courtyard fountain and palms. Around it are greenhouses, a barnyard with a stable, barns and a water tower, corrals and hay bales, agave terraces, an adobe village, groves of trees, and dirt roads with fences and power lines.
- **Destruction:** buildings collapse, trees topple, cars burn and rocks shatter. Shells leave real craters in the ground.
- **A physically based daylight camera:** photo textures with normal maps, sun and sky lighting, soft shadows, contact shading, drifting cloud shadows, weathered buildings, and a filmic long-range look with haze and heat shimmer.
- **Detailed vehicle models** with their real paint and camouflage: an Ural 4320 truck, a Panzer IV tank, M998 Humvees and a 1963 Chevrolet pickup.
- **Layered sound:** explosions are muffled and delayed by distance and panned by screen position, and the GBU blast has its own sub-bass layer that ducks everything else.
- **Scoring** with kill chains, multi-kill bonuses and wave-clear bonuses. The top 10 scores are saved in your browser.

## Controls

| Input | Action |
|---|---|
| Mouse | Slew the sensor (click the game to lock the mouse) |
| Left mouse | Fire (hold for the 25mm) |
| Right mouse / Z | Zoom 1x, 2x, 3x (changing weapons keeps the zoom) |
| 1 / 2 / 3 / 4 | 25mm / 40mm / 105mm / guided bomb |
| Q / mouse wheel | Cycle weapons |
| R | Reload the 40mm (or rearm the bombs) |
| F | Daylight / rainbow thermal / black-hot thermal |
| H | Red target boxes on hostiles on / off |
| Enter | Skip the break between waves (or resume from pause) |
| M | Mute |
| Esc / P | Pause menu: resume, or exit to the main menu (abandons the run) |

The main menu also has a mouse sensitivity slider.

Shells take about 1.5 to 2 seconds to land, so lead moving targets. On thermal, friendlies wear flashing IR strobes. On the daylight camera they wear tan. Killing one costs 500 points.

## How it plays

### Weapons

| Gun | Fire | Best against |
|---|---|---|
| 25mm | Fast, but overheats | Infantry; useless against armour |
| 40mm | 6-round magazine | Technicals |
| 105mm | Huge blast, 4 s reload | Groups and armour |
| GBU | Guided bomb, 2 on the rack, 24 s rearm | Any vehicle |

When the guided bomb is released, it locks the enemy vehicle nearest the crosshair. It glides out to the side, then dives onto the vehicle across the sensor's view, so you can watch it come in. If its target dies first, it takes the next nearest vehicle. With no vehicle in range, it dives onto the crosshair point. The HUD brackets the vehicle it will lock and shows the time to impact while it falls.

Impacts jolt the sensor in proportion to their size, from a barely visible twitch for the 25mm to a hard kick for the GBU.

### Enemies

- Infantry
- RPG teams
- Suicide runners that rush the wall
- Technicals and trucks that drop off troops
- Tanks

Every 5th wave is a boss wave with heavy armour.

### Scoring

- Points for each kill.
- A chain multiplier for fast kills, up to x4.
- Big multi-kill bonuses when one shell kills several enemies, for example a loaded truck.
- Wave-clear bonuses for no compound damage and no friendly fire.

Between waves, the compound is partly repaired and fallen friendlies are replaced.

## Tech stack

- [three.js](https://threejs.org) 0.186 for WebGL rendering, with custom shaders for the thermal and daylight sensor looks.
- [Vite](https://vite.dev) 8 for the dev server and production build.
- Plain JavaScript (ES modules), with no UI framework. The HUD is HTML panels plus a 2D canvas overlay.
- The Web Audio API for sound.
- Node.js scripts and headless [Blender](https://www.blender.org) 5.1 Python scripts for asset preparation (optional; see below).

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20.19+ or 22.12+ (required by Vite 8), with npm.
- A desktop browser with WebGL 2 and pointer lock (a recent Chrome, Edge or Firefox), and a mouse.
- A dedicated graphics card is recommended. The map draws about 1,500 trees and up to 150 enemies at once.

### Install and run

```bash
git clone https://github.com/MohammadAlMokdad/MQ-9-Game.git
cd MQ-9-Game
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and opens the game in your browser. To start it without opening a browser, set the `NO_OPEN` environment variable (for example `NO_OPEN=1 npm run dev`).

### npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server and opens the game |
| `npm run build` | Builds the game into `dist/`, with relative paths so it runs from any folder or static host |
| `npm run preview` | Serves the production build from `dist/` |
| `npm run sim:waves` | Prints the enemy mix for waves 1 to 40 in the terminal (no browser needed) |
| `npm run build:trees` | Rebuilds `public/assets/trees/` from the raw tree downloads (see [Rebuilding the assets](#rebuilding-the-assets)) |

### Debug keys

Dev builds, or any build with `?debug` in the URL, add debug keys:

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

## Project structure

```
index.html            Page, HUD panels, menu, pause and game-over screens
vite.config.js        Dev server and build settings
src/
  main.js             Font and asset loading, game start, main loop
  Game.js             Owns every system, the state machine and key handling
  config.js           Almost every tunable number: weapons, enemies, waves, scoring, colours, heat
  assets/             Lists of models, textures and sounds to load
  camera/  combat/    Gunship orbit and aiming; weapons, shells, the guided bomb, splash damage
  entities/  game/    Units and AI; waves, the compound, score and radio chatter
  render/  fx/        Renderer, sensor shaders, materials; explosions, particles, tracers, craters
  world/              Terrain, the hacienda, the ranch, props, trees, roads, destruction
  ui/  audio/         HUD, screens and styles; sound
public/assets/        Runtime assets: models, props, trees, textures, sounds, HUD icons, font
scripts/
  build-trees.mjs     Builds the tree asset from the raw tree downloads
  sim-waves.mjs       Prints the wave difficulty curve
  blender/            Headless Blender scripts that convert downloads into game assets
```

[PROJECT_GUIDE.md](PROJECT_GUIDE.md) is the full developer reference: every source file, every setting in `config.js`, how to make common changes (weapons, vehicles, props, sounds, the map), and statistics for every model.

## Rebuilding the assets

You don't need to rebuild anything to play. Every asset the game loads is already in `public/assets/`. The raw downloads the assets were made from are several hundred MB, so they are not in this repository. You only need them to regenerate an asset.

| Asset | Built by | Source it expects |
|---|---|---|
| `public/assets/trees/` | `npm run build:trees` | The Sketchfab glTF downloads of "Realistic Trees Collection" in `realistic_trees_collection/` and "Date Palm" in `date_palm/`, at the project root (each with `scene.gltf` and `scene.bin`) |
| `public/assets/props/` | `scripts/blender/build_assets.py --only props` | Poly Haven 1k glTF packages, downloaded by `fetch_polyhaven.py` into the `--downloads` folder |
| `public/assets/models/rounds/`, `public/assets/ui/round_*.png` | `scripts/blender/build_assets.py --only rounds,icons` | Round models in `missles/25-40-105mm/<calibre>/scene.gltf`, adapted from "Sniper Bullet" |
| `public/assets/models/gbu.glb`, `public/assets/ui/gbu.png` | `scripts/blender/make_gbu.py` | None; the bomb is modelled by the script |
| `public/assets/models/vehicles/*.glb` | `scripts/blender/convert_vehicle.py` | A downloaded vehicle model (glTF, GLB, FBX or OBJ) |
| `public/assets/models/soldiers/soldier.glb` (optional) | `scripts/blender/convert_mixamo.py` | A Mixamo character and its animations |

The source links for every download are in [CREDITS.md](CREDITS.md). The Blender scripts need Blender 5.1 and run headless. Each script's header explains its options, for example:

```bash
blender -b --factory-startup --python scripts/blender/convert_vehicle.py -- <input> <output.glb> --front=-y --length=5.2
```

`convert_vehicle.py` joins the model, reduces it if needed, bakes all its materials into one 1024 px texture atlas, and turns it to face +Z at real size. Use models under about 30,000 triangles, since heavy reduction tears them. Save the result as `technical.glb`, `truck.glb`, `tank.glb`, `humvee.glb` or `car.glb` in `public/assets/models/vehicles/`, and it replaces the bundled low-poly model for that role.

### The technical

The enemy technical's detailed model ("Pick-up Truck Improvised Fighting Vehicle") is under the Sketchfab Standard licence, which does not allow redistributing the model on its own. That's why `public/assets/models/vehicles/technical.glb` isn't in this repository. Without it, the game draws technicals with the bundled low-poly pickup. To use the detailed model, download it from the [Sketchfab page](https://sketchfab.com/3d-models/pick-up-truck-improvised-fighting-vehicle-bc5604e0a7b341909de1077d0b3bc176) and convert it with `convert_vehicle.py` into that path.

## Credits

The game code is original. The models, textures, sounds and font come from Poly Pizza, Sketchfab, Poly Haven, Freesound and Google Fonts, under CC0, CC BY, CC BY-NC or the SIL Open Font License. [CREDITS.md](CREDITS.md) lists every asset, its author and its licence. Prop sources are in [public/assets/props/SOURCES.md](public/assets/props/SOURCES.md).

The Humvee model (`public/assets/models/vehicles/humvee.glb`) is under CC BY-NC 4.0, which forbids commercial use. Replace it before you sell or monetise the game.

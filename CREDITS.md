# Credits

The game code is original. The third-party assets below are bundled in `public/assets/` and used under the licence shown.

## 3D models (via [Poly Pizza](https://poly.pizza))

| File | Model | Author | Licence |
|---|---|---|---|
| `models/soldier.glb` | [SWAT](https://poly.pizza/m/Btfn3G5Xv4) (animated) | Quaternius | CC0 1.0 |
| `models/pickup.glb` | [Pickup Truck](https://poly.pizza/m/qn4grQgHm8) | Quaternius | CC0 1.0 |
| `models/tank.glb` | [Tank](https://poly.pizza/m/jWS1CLA0RO) | Quaternius | CC0 1.0 |
| `models/truck.glb` | [M939 Truck](https://poly.pizza/m/y8lBpvMlim) | J-Toastie | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `models/humvee.glb` | [Humvee](https://poly.pizza/m/Ebryot9iKM) | madtrollstudio | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

The game draws the vehicles below instead of these four when they are present; these stay as the fallback.

## Vehicles (via [Sketchfab](https://sketchfab.com))

| File | Model | Author | Licence |
|---|---|---|---|
| `models/vehicles/technical.glb` | [Pick-up Truck Improvised Fighting Vehicle](https://sketchfab.com/3d-models/pick-up-truck-improvised-fighting-vehicle-bc5604e0a7b341909de1077d0b3bc176) | [Mateusz Woliński](https://sketchfab.com/jeandiz) | [Sketchfab Standard](https://sketchfab.com/licenses) |
| `models/vehicles/truck.glb` | [Ural 4320](https://sketchfab.com/3d-models/ural-4320-f953c51a5dbc4a15949f4dcc0905c4e8) | [Brout](https://sketchfab.com/davidbroutian) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `models/vehicles/tank.glb` | [Panzer IV Medium Tank - Toshueyi](https://sketchfab.com/3d-models/panzer-iv-medium-tank-toshueyi-14c74d148326448c8edb5fee81be3894) | [Joanthan To](https://sketchfab.com/Toshueyi) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `models/vehicles/humvee.glb` | [Ukrainian M998 Humvee pickup](https://sketchfab.com/3d-models/ukrainian-m998-humvee-pickup-f4890c76df644017932502a0812fd32a), national insignia removed | [42manako](https://sketchfab.com/42manako) | [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) |
| `models/vehicles/car.glb` | [Low Poly Car - Chevrolet C10 Pickup 1963](https://sketchfab.com/3d-models/low-poly-car-chevrolet-c10-pickup-1963-679354c151984747bb74310ec5af8995) | [tedpermana](https://sketchfab.com/tedpermana) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

`scripts/blender/convert_vehicle.py` converted each one: it rescaled it to the real vehicle's size, reduced the pickup's mesh, and baked its textures into one atlas. The Sketchfab Standard licence lets this game use the technical, but the model may not be redistributed on its own. The Humvee's CC BY-NC licence forbids commercial use, so replace it before selling or monetising the game.

## Trees

`trees/` (built by `scripts/build-trees.mjs`) is based on ["Realistic Trees Collection"](https://sketchfab.com/3d-models/realistic-trees-collection-fe67c886eebf4bcb988d7c45e69995ad) by [Jungle Jim](https://sketchfab.com/jungle_jim), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

The palms in `trees/` are based on ["Date Palm"](https://sketchfab.com/3d-models/date-palm-11acf710e6c149daa8d6fb8cdc5d087f) by [evolveduk](https://sketchfab.com/evolveduk), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The frond normals were re-pointed outward so the crown lights from above.

Both were reduced to three levels of detail, and their textures were resized and converted to WebP.

## Munitions

| File | Model | Author | Licence |
|---|---|---|---|
| `models/rounds/r25.glb`, `r40.glb`, `r105.glb`, `ui/round_*.png` | 25 mm, 40 mm and 105 mm rounds adapted from [Sniper Bullet](https://sketchfab.com/3d-models/sniper-bullet-daf6f63d08eb4c9b9e16d1ff7f2dc71a) | AndreOrla | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `models/gbu.glb`, `ui/gbu.png` | Guided bomb, built by `scripts/blender/make_gbu.py` | original | same as the game code |

## Props (via [Poly Haven](https://polyhaven.com), all CC0 1.0)

`props/*.glb` (boulders, shrubs, oil drums, air conditioner, covered car, road barrier, crate) are reduced versions of Poly Haven scans. [props/SOURCES.md](public/assets/props/SOURCES.md) lists the source asset and authors of each file.

## Textures (via [Poly Haven](https://polyhaven.com), all CC0 1.0)

| File | Texture |
|---|---|
| `tex/aerial_grass_rock*.jpg` | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) |
| `tex/aerial_ground_rock.jpg` | [Aerial Ground Rock](https://polyhaven.com/a/aerial_ground_rock) |
| `tex/dirt_aerial_02*.jpg` | [Dirt Aerial 02](https://polyhaven.com/a/dirt_aerial_02) |
| `tex/aerial_sand*.jpg` | [Aerial Sand](https://polyhaven.com/a/aerial_sand) |
| `tex/raked_dirt*.jpg` | [Raked Dirt](https://polyhaven.com/a/raked_dirt) |
| `tex/dry_ground_rocks*.jpg` | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) |
| `tex/leafy_grass*.jpg` | [Leafy Grass](https://polyhaven.com/a/leafy_grass) |
| `tex/painted_plaster_wall*.jpg` | [Painted Plaster Wall](https://polyhaven.com/a/painted_plaster_wall) |
| `tex/patterned_clay_plaster*.jpg` | [Patterned Clay Plaster](https://polyhaven.com/a/patterned_clay_plaster) |
| `tex/clay_roof_tiles_02*.jpg` | [Clay Roof Tiles 02](https://polyhaven.com/a/clay_roof_tiles_02) |
| `tex/worn_corrugated_iron*.jpg` | [Worn Corrugated Iron](https://polyhaven.com/a/worn_corrugated_iron) |
| `tex/box_profile_metal_sheet*.jpg` | [Box Profile Metal Sheet](https://polyhaven.com/a/box_profile_metal_sheet) |
| `tex/weathered_planks*.jpg` | [Weathered Planks](https://polyhaven.com/a/weathered_planks) |
| `tex/square_cobblestone*.jpg` | [Square Cobblestone](https://polyhaven.com/a/square_cobblestone) |
| `tex/dry_riverbed_rock*.jpg` | [Dry Riverbed Rock](https://polyhaven.com/a/dry_riverbed_rock) |

The colour maps are 1K (the aerial grass is 2K) and `*_nor.jpg` are the matching OpenGL normal maps, recompressed.

## Font

`fonts/barlow-sc-*.woff2`: [Barlow Semi Condensed](https://fonts.google.com/specimen/Barlow+Semi+Condensed) by Jeremy Tribby, [SIL Open Font License 1.1](https://openfontlicense.org).

## Sound effects (via [Freesound](https://freesound.org), all CC0 1.0)

| File | Sound | Author |
|---|---|---|
| `sfx/gun105_a.mp3` | [Artillery Gunfire](https://freesound.org/people/qubodup/sounds/239137/) | qubodup |
| `sfx/gun105_b.mp3` | [Excalibur Howitzer Shot](https://freesound.org/people/qubodup/sounds/175430/) | qubodup |
| `sfx/gun105_sub.mp3` | [Deep Boom Heavy Cannon Fire](https://freesound.org/people/el_boss/sounds/853281/) | el_boss |
| `sfx/gun40_a.mp3` | [120mm Mortar Shell Shot 2](https://freesound.org/people/qubodup/sounds/854478/) | qubodup |
| `sfx/gun40_b.mp3` | [Heavy Artillery Shot](https://freesound.org/people/LilMati/sounds/441373/) | LilMati |
| `sfx/gun25.mp3` | [Mk 46 30mm gun - single shot](https://freesound.org/people/qubodup/sounds/162258/) | qubodup |
| `sfx/exp_big.mp3` | [Explosion_01](https://freesound.org/people/tommccann/sounds/235968/) | tommccann |
| `sfx/exp_rumble.mp3` | [Big Boom](https://freesound.org/people/unfa/sounds/189779/) | unfa |
| `sfx/exp_med_a.mp3` | [explosion_big_01](https://freesound.org/people/derplayer/sounds/587194/) | derplayer |
| `sfx/exp_med_b.mp3` | [explosion_big_02](https://freesound.org/people/derplayer/sounds/587193/) | derplayer |
| `sfx/exp_small.mp3` | [Distant Explosion](https://freesound.org/people/danlucaz/sounds/517747/) | danlucaz |
| `sfx/exp_thump.mp3` | [verydistantexplosion](https://freesound.org/people/Opticreep/sounds/255527/) | Opticreep |
| `sfx/exp_vehicle.mp3` | [Explosion004](https://freesound.org/people/klangfabrik/sounds/220062/) | klangfabrik |
| `sfx/exp_debris.mp3` | [Explosion_Debris_Short_Stereo](https://freesound.org/people/Nox_Sound/sounds/560510/) | Nox_Sound |
| `sfx/amb_war.mp3` | [War Ambience Loop](https://freesound.org/people/qubodup/sounds/239139/) | qubodup |
| `sfx/amb_gunfire.mp3` | [Distant Gunfire](https://freesound.org/people/iainmccurdy/sounds/842326/) | iainmccurdy |
| `sfx/burst_distant.mp3` | [Distant Three Round Burst](https://freesound.org/people/adrilahan/sounds/337242/) | adrilahan |
| `sfx/engine_turboprop.mp3` | [Airplane Turboprop (Outside Perspective) 2](https://freesound.org/people/Saladsounds/sounds/828952/) | Saladsounds |
| `sfx/engine_cabin.mp3` | [737 cabin noise at 10k feet](https://freesound.org/people/itinerantmonk108/sounds/585510/) | itinerantmonk108 |
| `sfx/radio_in.mp3` | [Radio Buzz / Squelch 1](https://freesound.org/people/magnuswaker/sounds/522164/) | magnuswaker |
| `sfx/radio_out.mp3` | [Walkie Talkie - Roger Beep](https://freesound.org/people/bruce965/sounds/321906/) | bruce965 |
| `sfx/casing.mp3` | [Brass bullet shell casing drop onto concrete](https://freesound.org/people/GrayJoy/sounds/210102/) | GrayJoy |
| `sfx/fire_loop.mp3` | [Fire Crackle and Flames 002](https://freesound.org/people/TheWoodlandNomad/sounds/363092/) | TheWoodlandNomad |
| `sfx/gbu_release.mp3` | [swish/whoosh](https://freesound.org/people/JSilverSound/sounds/568834/) | JSilverSound |
| `sfx/gbu_incoming.mp3` | [Huge Explosion Part 1 - Shockwave](https://freesound.org/people/bevibeldesign/sounds/366091/) | bevibeldesign |
| `sfx/gbu_blast.mp3` | [Huge Explosion](https://freesound.org/people/qubodup/sounds/741174/) | qubodup |
| `sfx/gbu_rumble.mp3` | [Huge Explosion - Thunder - Exploding](https://freesound.org/people/dmstudio/sounds/320782/) | dmstudio |

Sounds are the Freesound high-quality MP3 previews of the originals.

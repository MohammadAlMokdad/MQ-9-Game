// Owns every system and runs the state machine:
// menu -> intermission <-> playing (<-> paused) -> gameoverSeq -> gameover -> intermission ...
import * as THREE from 'three';
import { Events } from './core/events.js';
import { Input } from './core/Input.js';
import { GunshipCamera } from './camera/GunshipCamera.js';
import { Renderer } from './render/Renderer.js';
import { World } from './world/World.js';
import { DIR_NAMES, sectorOf } from './world/roads.js';
import { Effects } from './fx/Effects.js';
import { Munitions } from './fx/Munitions.js';
import { Units } from './entities/Units.js';
import { Shells } from './combat/Shells.js';
import { Damage } from './combat/Damage.js';
import { Weapons } from './combat/Weapons.js';
import { Base } from './game/Base.js';
import { Score, loadSettings, saveSettings } from './game/Score.js';
import { WaveManager, dirList } from './game/WaveManager.js';
import { Radio } from './game/Radio.js';
import { Audio } from './audio/Audio.js';
import { Hud } from './ui/Hud.js';
import { Screens } from './ui/Screens.js';
import { Debug } from './debug/Debug.js';
import { bakeSoldier } from './render/models.js';
import { WAVES, BASE, LIGHT, WEAPONS, weaponIndex } from './config.js';

export class Game {
  constructor(canvas, overlay, assets) {
    this.state = 'menu';
    this.prevState = 'playing';
    this.time = 0;
    this.missionTime = 0;
    this.wave = 0;
    this.interT = 0;
    this.nextAnnounced = false;
    this.seqT = 0;
    this.barrageT = 0;
    this.fireBlock = true;
    this.settings = { sens: 1, mode: 'TV', muted: false, boxes: true, ...loadSettings() };

    this.assets = assets;
    this.events = new Events();
    this.input = new Input(canvas);
    this.scene = new THREE.Scene();
    const haze = new THREE.Color(0.19, 0.19, 0.19);
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 2600, 7000);

    this.cam = new GunshipCamera();
    this.cam.sensMul = this.settings.sens;
    this.renderer = new Renderer(canvas, this.scene, this.cam.camera);
    this.renderer.setMode(this.settings.mode);
    this.world = new World(this.scene, assets);
    this.world.initSky(this.renderer.renderer);
    this.world.setMode(this.renderer.thermalMode);
    this.renderer.setDayLook(LIGHT.day.exposure, LIGHT.day.hazeAmount, LIGHT.day.hazeColor);
    this.fx = new Effects(this);
    this.munitions = new Munitions(this.scene, assets.models);
    this.units = new Units(this, bakeSoldier(assets.models.soldier_real || assets.models.soldier));
    this.shells = new Shells(this);
    this.damage = new Damage(this);
    this.weapons = new Weapons(this);
    this.audio = new Audio();
    this.audio.setBuffers(assets.sfx);
    this.audio.attach(this);
    this.audio.setMuted(!!this.settings.muted);
    this.radio = new Radio(this);
    this.debug = new Debug(this);
    this.base = new Base(this);
    this.score = new Score(this);
    this.waves = new WaveManager(this);
    this.hud = new Hud(this, overlay);
    this.screens = new Screens(this);

    this.events.on('enemyEngaged', (u) => {
      if (u.type === 'rpg') this.radio.say('rpg', { dir: DIR_NAMES[sectorOf(u.x, u.z)] }, 2);
    });
    this.events.on('sapperHit', () => this.radio.say('sapper', {}, 3));
    this.input.onLockChange = (locked) => {
      if (!locked) this.pause();
    };
    // If a lock request was refused (browsers block re-locking right after Esc), clicking the view retries.
    canvas.addEventListener('mousedown', () => {
      if ((this.state === 'playing' || this.state === 'intermission') && !this.input.locked) {
        this.fireBlock = true;
        this.input.requestLock();
      }
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.units.spawnFriendlies();
    this.screens.showMenu();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
  }

  // F: daylight TV -> thermal rainbow -> thermal black-hot.
  cycleSensor() {
    this.renderer.cycleMode();
    this.world.setMode(this.renderer.thermalMode);
    this.settings.mode = this.renderer.mode;
    saveSettings(this.settings);
    this.audio.click();
  }

  setSensitivity(v) {
    this.cam.sensMul = v;
    this.settings.sens = v;
    saveSettings(this.settings);
  }

  deploy() {
    this.audio.init();
    this.input.requestLock();
    this.start();
  }

  start() {
    this.world.destruction.restore();
    this.base.reset();
    this.fx.reset();
    this.units.reset();
    this.shells.reset();
    this.score.reset();
    this.weapons.reset();
    this.waves.reset();
    this.radio.reset();
    this.cam.reset();
    this.hud.reset();
    this.units.spawnFriendlies();
    this.wave = 0;
    this.missionTime = 0;
    this.state = 'intermission';
    this.interT = WAVES.firstDelay;
    this.nextAnnounced = false;
    this.fireBlock = true;
    this.waves.prepare(1);
    this.screens.hideAll();
    this.hud.show(true);
    this.radio.say('start', {}, 5);
    this.audio.startAmbience();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'intermission') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.input.exitLock(); // free the cursor so the menu buttons can be clicked
    this.audio.suspend(); // bombs in flight and their sounds both stop until resume
    this.screens.showPause(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    this.input.requestLock();
    this.state = this.prevState;
    this.fireBlock = true;
    this.screens.showPause(false);
  }

  // Abandons the current run (not recorded as a score) and returns to the main menu.
  exitToMenu() {
    this.audio.stopAmbience();
    this.input.exitLock();
    this.world.destruction.restore();
    this.base.reset();
    this.fx.reset();
    this.units.reset();
    this.shells.reset();
    this.waves.reset();
    this.radio.reset();
    this.score.reset();
    this.hud.reset();
    this.units.spawnFriendlies();
    this.state = 'menu';
    this.hud.show(false);
    this.screens.hideBanner();
    this.screens.showMenu();
  }

  jumpWaves(k) {
    this.wave += k;
    if (this.state === 'intermission') {
      this.waves.prepare(this.wave + 1);
      this.nextAnnounced = false;
      this.interT = Math.max(this.interT, 3.6);
    }
  }

  onWaveCleared(plan) {
    const n = plan.n;
    const res = this.score.waveClear(n, plan.boss, this.units.friendlyAlive, this.base.damageThisWave);
    this.base.repair(plan.boss ? BASE.bossRepair : BASE.repair);
    const added = this.units.spawnFriendlies(true);
    this.state = 'intermission';
    this.interT = WAVES.intermission;
    this.nextAnnounced = false;
    this.waves.prepare(n + 1);
    const bits = [`+${res.total.toLocaleString('en-US')}`];
    if (res.noDamage) bits.push('NO DAMAGE');
    if (res.noFF) bits.push('NO FRIENDLY FIRE');
    if (res.boss) bits.push('BOSS x2');
    this.screens.showBanner(`WAVE ${n} CLEARED`, bits.join('  ·  '), 4.5);
    this.radio.say('waveClear', {}, 4);
    if (added) this.radio.say('reinforce', {}, 2);
    this.audio.banner();
  }

  onBaseDestroyed() {
    if (this.state === 'gameoverSeq' || this.state === 'gameover') return;
    this.state = 'gameoverSeq';
    this.seqT = 4.5;
    this.barrageT = 0;
    this.waves.active = false;
    this.radio.say('gameOver', {}, 9);
  }

  toGameOver() {
    this.state = 'gameover';
    const rank = this.score.finalize(this.wave, this.missionTime);
    this.hud.show(false);
    this.input.exitLock();
    this.screens.showGameOver(rank);
    this.audio.stopAmbience();
  }

  updateIntermission(dt) {
    this.interT -= dt;
    const n = this.wave + 1;
    if (!this.nextAnnounced && this.interT <= 3.5) {
      this.nextAnnounced = true;
      const plan = this.waves.prepared && this.waves.prepared.n === n ? this.waves.prepared : this.waves.prepare(n);
      const dirs = dirList(plan.dirs);
      const sub = plan.boss ? `HEAVY ARMOR · FROM THE ${dirs.toUpperCase()}` : `HOSTILES FROM THE ${dirs.toUpperCase()}`;
      this.screens.showBanner(`WAVE ${n}`, sub, 3.2);
      this.radio.say(plan.boss ? 'boss' : 'waveStart', { dirs }, 4);
      this.audio.banner();
    }
    if (this.interT <= 0) {
      this.wave = n;
      this.state = 'playing';
      this.waves.start(n);
    }
  }

  // The outpost falls: shells and secondaries walk across the camp before the stats screen.
  updateGameOverSeq(dt) {
    this.seqT -= dt;
    this.barrageT -= dt;
    if (this.barrageT <= 0 && this.seqT > 1) {
      this.barrageT = 0.18 + Math.random() * 0.15;
      const x = (Math.random() - 0.5) * 130;
      const z = (Math.random() - 0.5) * 130;
      const wi = weaponIndex(Math.random() < 0.3 ? '105' : '40');
      this.fx.impact(wi, x, 0, z);
      this.renderer.addFlash(0.3);
      this.cam.addTrauma(0.2);
      this.audio.impact(wi, x, 0, z);
    }
    if (this.seqT <= 0) this.toGameOver();
  }

  handleKeys() {
    const inp = this.input;
    if (!inp.shift()) {
      // 1-4 pick the weapons in their HUD order (smallest to biggest).
      for (let i = 0; i < WEAPONS.length; i++) if (inp.pressed.has(`Digit${i + 1}`)) this.weapons.select(i);
    }
    if (inp.pressed.has('KeyQ')) this.weapons.cycle(1);
    if (inp.wheel) this.weapons.cycle(inp.wheel > 0 ? 1 : -1);
    if (inp.pressed.has('KeyF')) this.cycleSensor();
    if (inp.pressed.has('KeyH')) {
      this.settings.boxes = this.settings.boxes === false;
      saveSettings(this.settings);
      this.audio.click();
    }
    // Zoom is the sensor's own setting (1x, 2x, 3x); changing weapons leaves it alone.
    if (inp.mousePressed[2] || inp.pressed.has('KeyZ')) {
      this.cam.cycleZoom();
      this.audio.click();
    }
    if (inp.pressed.has('KeyR')) this.weapons.reload();
    if (inp.pressed.has('Enter') && this.state === 'intermission') this.interT = Math.min(this.interT, this.nextAnnounced ? 0 : 3.5);
    if (inp.pressed.has('KeyM')) {
      this.audio.setMuted(!this.audio.muted);
      this.settings.muted = this.audio.muted;
      saveSettings(this.settings);
    }
    if (inp.pressed.has('KeyP')) {
      this.pause();
      this.input.exitLock();
    }
  }

  frame(dt) {
    this.time += dt;
    const st = this.state;
    const active = st === 'playing' || st === 'intermission';
    const sim = active || st === 'gameoverSeq';

    this.debug.update(dt);
    if (active) this.handleKeys();
    if (!this.input.mouse[0]) this.fireBlock = false;

    if (st !== 'paused') {
      const attract = st === 'menu' || st === 'gameover';
      this.cam.update(dt, active ? this.input.dx : 0, active ? this.input.dy : 0, attract);
    }

    if (sim) {
      if (st !== 'gameoverSeq') this.missionTime += dt;
      if (active) this.weapons.update(dt, this.input.mouse[0] && !this.fireBlock);
      this.shells.update(dt);
      if (st === 'playing') this.waves.update(dt);
      this.units.update(dt);
      this.base.update(dt);
      this.score.update(dt);
      if (st === 'intermission' && this.state === 'intermission') this.updateIntermission(dt);
      if (st === 'gameoverSeq') this.updateGameOverSeq(dt);
    } else if (st === 'menu' || st === 'gameover') {
      this.units.update(dt);
    }

    if (st !== 'paused') {
      this.fx.update(dt);
      this.world.destruction.update(dt);
      this.radio.update(dt);
      const t = this.cam.target;
      this.audio.setIntensity(this.units.engaged, this.fx.firesNear(t.x, t.z, 220));
    }
    // Shadow map follows the crosshair and covers about the visible ground.
    const cam = this.cam.camera;
    for (const field of [this.world.trees, this.world.palms]) field.update(st === 'paused' ? 0 : dt, this.cam.camera, this.renderer.height, this.renderer.thermalMode);
    this.world.updateSun(this.cam.target, this.cam.slantRange * Math.tan((cam.fov * Math.PI) / 360) * cam.aspect * 1.35);
    this.units.render(this.time);
    this.munitions.render(this.shells.list, this.shells.bombs, this.cam.camera, this.renderer.height);
    // Daylight glow only comes from fire, flashes and tracers; skip the pass when there are none.
    this.renderer.bloom.enabled = this.renderer.thermalMode || this.fx.hot.n > 0 || this.fx.tracers.list.length > 0;
    this.screens.update(dt);
    this.hud.update(dt);
    this.renderer.render(dt);
    this.input.endFrame();
  }
}

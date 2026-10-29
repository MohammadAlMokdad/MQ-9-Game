// Sound design: recorded CC0 samples (see CREDITS.md) layered per event, with distance
// muffling and delay, stereo panning from the screen position, a generated outdoor-echo
// reverb, and crossfaded ambience loops (engines, distant firefight, burning wrecks).
// The guided bomb has its own release, dive and blast recordings.
import { WEAPONS } from '../config.js';

const R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const GBU_RISER_PEAK = 2.55; // the GBU dive recording peaks here (s)
// Levels of the guided bomb's blast layers (into the limiter, around the compressor), and of
// that bus: just under unity, so the limiter never lets a peak past full scale.
const GBU_MIX = { blast: 0.95, rumble: 0.7, thump: 0.42 };
const PUNCH_LEVEL = 0.9;

// Soft clipper (tanh) curve: adds harmonics to a pure low tone so small speakers carry it.
function softClip(drive, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return c;
}

// Output safety: untouched below `knee`, then bent smoothly so nothing reaches full scale (the
// limiter can let the first millisecond of a huge transient slip past it).
function safetyClip(knee = 0.89, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return c;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.raw = null;
    this.game = null;
    this.amb = null;
    this.small = 0; // concurrent small impacts (voice limit)
    this.scheduled = new Set(); // long or future sounds tied to munitions in flight
  }

  setBuffers(raw) {
    this.raw = raw;
  }

  attach(game) {
    this.game = game;
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && this.raw;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !this.raw) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.35;
    // Brickwall-style limiter so stacked 105 hits never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    this.out = limiter;
    const safety = ctx.createWaveShaper();
    safety.curve = safetyClip();
    safety.oversample = '4x';
    this.master.connect(comp).connect(limiter).connect(safety).connect(ctx.destination);
    // The guided bomb's blast goes around the compressor, straight into the limiter, so its
    // punch isn't squashed down to the level of a 105 (it mutes with the master).
    this.punch = ctx.createGain();
    this.punch.gain.value = this.muted ? 0 : PUNCH_LEVEL;
    this.punch.connect(limiter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.8;
    this.ambBus.connect(this.master);
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.7;
    this.uiBus.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    const b = this.raw;
    this.loops = {
      engine: this.makeLoop(b.engine_turboprop, 2),
      cabin: this.makeLoop(b.engine_cabin, 2),
      war: this.makeLoop(b.amb_war, 1.5),
      gunfire: this.makeLoop(b.amb_gunfire, 1),
      fire: this.makeLoop(b.fire_loop, 1.5),
    };
  }

  // Outdoor impulse: diffuse decaying tail plus a few slap-back echoes off the hills.
  makeImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const echoes = [0.17, 0.36, 0.62, 0.95];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        lp += (R() * 2 - 1 - lp) * 0.18; // darken the noise
        d[i] = lp * Math.exp(-t / 0.75) * 0.6;
      }
      for (const e of echoes) {
        const at = Math.floor((e + ch * 0.013) * ctx.sampleRate);
        for (let i = 0; i < 2400 && at + i < len; i++) d[at + i] += (R() * 2 - 1) * Math.exp(-i / 500) * 0.5 * Math.exp(-e);
      }
    }
    return buf;
  }

  // Bakes an equal-power crossfade of the tail into the head so the buffer loops seamlessly.
  makeLoop(src, fade) {
    const ctx = this.ctx;
    const sr = src.sampleRate;
    const f = Math.min(Math.floor(fade * sr), Math.floor(src.length / 3));
    const len = src.length - f;
    const out = ctx.createBuffer(src.numberOfChannels, len, sr);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const s = src.getChannelData(ch);
      const d = out.getChannelData(ch);
      d.set(s.subarray(0, len));
      for (let i = 0; i < f; i++) {
        const k = i / f;
        d[i] = s[i] * Math.sin((k * Math.PI) / 2) + s[len + i] * Math.cos((k * Math.PI) / 2);
      }
    }
    return out;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    if (this.punch) this.punch.gain.setTargetAtTime(m ? 0 : PUNCH_LEVEL, this.ctx.currentTime, 0.05);
  }

  play(buf, o = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;
    let node = src;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    node.connect(g);
    node = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(o.bus || this.sfxBus);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      node.connect(s);
      s.connect(this.reverb);
    }
    if (o.duration) {
      const end = t + o.duration / (o.rate || 1);
      g.gain.setValueAtTime(o.gain ?? 1, Math.max(t, end - 0.08));
      g.gain.linearRampToValueAtTime(0.0001, end);
      src.start(t, o.offset || 0, o.duration);
    } else {
      src.start(t, o.offset || 0);
    }
    if (o.onEnd) src.onended = o.onEnd;
    return { src, gain: g };
  }

  // Distance from the aircraft and left/right position on screen for a world point.
  spatial(x, y, z) {
    const g = this.game;
    if (!g) return { dist: 1400, pan: 0, lp: 2000, delay: 0.3 };
    const dist = g.cam.pos.distanceTo({ x, y, z });
    const p = g.hud.project(x, y, z);
    const pan = p.behind ? 0 : ((p.x / g.hud.w) * 2 - 1) * 0.7;
    return { dist, pan, lp: 900 + 9000 * Math.exp(-dist / 700), delay: 0.06 + dist / 5500 };
  }

  // ---- Player guns (heard from inside the aircraft) ----

  fire(wi) {
    if (!this.ok) return;
    const b = this.raw;
    const id = WEAPONS[wi].id;
    if (id === 'gbu') {
      // Guided bomb release: the rack's latch, then the bomb dropping away into the slipstream.
      this.click(0.9);
      if (b.gbu_release) this.play(b.gbu_release, { gain: 0.5, duration: 2.6, lowpass: 2800, send: 0.1 });
      return;
    }
    if (id === '105') {
      this.play(b.gun105_a, { gain: 0.75, duration: 2.1, lowpass: 5200, send: 0.12 });
      this.play(b.gun105_b, { gain: 0.45, rate: 0.82 });
      this.play(b.gun105_sub, { gain: 0.75, rate: 0.9 });
      this.play(b.casing, { gain: 0.32, rate: 0.5, duration: 1.4, delay: 0.55 });
    } else if (id === '40') {
      // One report per round: a low thump layered with a sharp crack, both single-shot samples.
      const pitch = rr(0.95, 1.05);
      this.play(b.gun40_a, { gain: 0.65, rate: 1.25 * pitch, duration: 1.1, lowpass: 3800, send: 0.08 });
      this.play(b.gun40_b, { gain: 0.55, rate: 1.1 * pitch, lowpass: 6000, send: 0.05 });
    } else {
      // One recorded 30mm report per round, so a tap is one shot and holding the trigger is
      // a string of shots. The tail is trimmed so rapid fire doesn't smear into a roar.
      this.play(b.gun25, { gain: 0.6, rate: rr(1.08, 1.16), duration: 0.55, lowpass: 7000, send: 0.05 });
    }
  }

  reload105() {
    if (!this.ok) return;
    this.play(this.raw.casing, { offset: 0.05, duration: 0.25, rate: 0.35, gain: 0.25 });
    this.click(0.5);
  }

  // ---- Bombs in flight ----

  // Keeps hold of a long or future sound so a new run (or exit to menu) can stop it.
  track(src) {
    this.scheduled.add(src);
    src.addEventListener('ended', () => this.scheduled.delete(src));
  }

  stopScheduled() {
    for (const src of this.scheduled) {
      try {
        src.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    this.scheduled.clear();
  }

  // Pausing the game pauses all sound, so bombs in flight stay in step with their audio.
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  // The guided bomb's dive: a rising rush timed to peak as the blast is heard.
  // remaining: seconds until impact.
  gbuIncoming(remaining, x, y, z) {
    const buf = this.raw?.gbu_incoming;
    if (!this.ok || !buf) return;
    const s = this.spatial(x, y, z);
    const wait = Math.max(0, remaining - GBU_RISER_PEAK);
    const offset = Math.max(0, GBU_RISER_PEAK - remaining);
    const { src } = this.play(buf, { offset, gain: 0.75, pan: s.pan, delay: s.delay + wait, lowpass: s.lp * 1.6, send: 0.2 });
    this.track(src);
  }

  // The pressure wave of a big blast: a sine falling from 70 to 32 Hz, hit hard and dying away
  // over about two seconds, driven through a soft clipper so its low harmonics carry on laptop
  // speakers too. Into `bus` after `delay` seconds.
  thump(delay, gain, bus) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 1.1);
    const drive = ctx.createWaveShaper();
    drive.curve = this.clip ??= softClip(3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    osc.connect(drive).connect(lp).connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + 2.3);
    this.track(osc);
  }

  // Pulls the guns, other impacts and the ambience down under a huge blast for `hold` seconds,
  // then lets them back up.
  duck(delay, level, hold) {
    const t = this.ctx.currentTime + delay;
    for (const [bus, base] of [[this.sfxBus, 0.9], [this.ambBus, 0.8]]) {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(base * level, t, 0.02);
      bus.gain.setTargetAtTime(base, t + hold, 0.9);
    }
  }

  // ---- Impacts out in the world ----

  impact(wi, x, y, z) {
    if (!this.ok) return;
    const b = this.raw;
    const s = this.spatial(x, y, z);
    const id = WEAPONS[wi].id;
    if (id === 'gbu') {
      // Guided bomb: a deep blast that rolls on for seconds, its rumble rolling back off the
      // hills a moment later, and a sub-bass pressure wave you feel more than hear. It goes
      // around the compressor (this.punch) while every other sound ducks under it. Distance takes
      // the top end off (no crackle: that is what made the old recording sound like fireworks).
      const bus = this.punch;
      const top = Math.max(2400, s.lp * 1.2);
      if (b.gbu_blast) this.play(b.gbu_blast, { gain: GBU_MIX.blast, lowpass: top, pan: s.pan, delay: s.delay, send: 0.3, bus });
      if (b.gbu_rumble) this.play(b.gbu_rumble, { offset: 0.15, gain: GBU_MIX.rumble, lowpass: 650, pan: s.pan * 0.3, delay: s.delay + 0.2, send: 0.45, bus });
      this.thump(s.delay, GBU_MIX.thump, bus);
      this.duck(s.delay, 0.3, 2.2);
    } else if (id === '105') {
      this.play(b.exp_big, { offset: 0.33, gain: 0.8, lowpass: s.lp * 1.3, pan: s.pan, delay: s.delay, send: 0.45 });
      this.play(b.exp_rumble, { gain: 0.5, rate: 0.85, lowpass: 700, pan: s.pan * 0.5, delay: s.delay + 0.05, send: 0.3 });
      this.play(b.exp_debris, { offset: 0.1, duration: 3, gain: 0.18, lowpass: s.lp, pan: s.pan, delay: s.delay + 0.35 });
    } else if (id === '40') {
      this.play(R() < 0.5 ? b.exp_med_a : b.exp_med_b, { gain: 0.5, rate: rr(0.85, 1.08), lowpass: s.lp * 1.4, pan: s.pan, delay: s.delay, send: 0.25 });
    } else {
      if (this.small > 6) return;
      this.small++;
      this.play(b.exp_small, { offset: 0.28, duration: 0.75, gain: 0.17, rate: rr(0.9, 1.3), lowpass: s.lp * 1.8, pan: s.pan, delay: s.delay, send: 0.08, onEnd: () => this.small-- });
      this.play(b.exp_thump, { duration: 0.6, gain: 0.1, rate: rr(1, 1.4), lowpass: 900, pan: s.pan, delay: s.delay });
    }
  }

  vehicleExplosion(x, y, z) {
    if (!this.ok) return;
    const s = this.spatial(x, y, z);
    this.play(this.raw.exp_vehicle, { gain: 0.65, lowpass: s.lp * 1.3, pan: s.pan, delay: s.delay + 0.3, send: 0.35 });
    this.play(this.raw.exp_debris, { offset: 0, duration: 4, gain: 0.25, lowpass: s.lp, pan: s.pan, delay: s.delay + 0.5 });
  }

  // A building coming down (big) or a tree / rock breaking (small).
  collapse(x, y, z, big) {
    if (!this.ok) return;
    const s = this.spatial(x, y, z);
    this.play(this.raw.exp_debris, { offset: big ? 0 : 0.4, duration: big ? 5 : 1.6, gain: big ? 0.45 : 0.22, rate: big ? 0.85 : 1.15, lowpass: s.lp, pan: s.pan, delay: s.delay + 0.15, send: 0.3 });
    if (big) this.play(this.raw.exp_rumble, { duration: 3, gain: 0.35, rate: 0.7, lowpass: 500, pan: s.pan * 0.5, delay: s.delay + 0.1 });
  }

  // Enemy rockets, cannon rounds and sappers going off near the compound.
  smallBlast(x, y, z, gain = 0.3) {
    if (!this.ok) return;
    const s = this.spatial(x, y, z);
    this.play(R() < 0.5 ? this.raw.exp_med_a : this.raw.exp_med_b, { gain, rate: rr(1.05, 1.3), lowpass: s.lp, pan: s.pan, delay: s.delay, send: 0.2 });
  }

  // Occasional positional burst of distant small-arms fire.
  gunfire(x, y, z) {
    if (!this.ok) return;
    const s = this.spatial(x, y, z);
    this.play(this.raw.burst_distant, { gain: rr(0.08, 0.16), rate: rr(0.85, 1.15), lowpass: 2600, pan: s.pan, delay: s.delay });
  }

  // ---- Ambience ----

  startAmbience() {
    if (!this.ctx || this.amb || !this.raw) return;
    const ctx = this.ctx;
    const loop = (buf, gain, lowpass) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(gain, ctx.currentTime, 1.5);
      src.connect(f).connect(g).connect(this.ambBus);
      src.start(ctx.currentTime, R() * buf.duration * 0.5);
      return { src, g };
    };
    this.amb = {
      engine: loop(this.loops.engine, 0.3, 1300),
      cabin: loop(this.loops.cabin, 0.24, 700),
      war: loop(this.loops.war, 0.0001, 3500),
      gunfire: loop(this.loops.gunfire, 0.0001, 2500),
      fire: loop(this.loops.fire, 0.0001, 3000),
    };
  }

  // engaged: enemies currently shooting; fires: burning wrecks/buildings near the crosshair.
  setIntensity(engaged, fires) {
    if (!this.amb) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, engaged / 25);
    this.amb.war.g.gain.setTargetAtTime(0.06 + 0.7 * k, t, 1.2);
    this.amb.gunfire.g.gain.setTargetAtTime(0.6 * k, t, 1.2);
    this.amb.fire.g.gain.setTargetAtTime(0.0001 + 0.22 * Math.min(1, fires / 3), t, 0.8);
  }

  stopAmbience() {
    if (!this.amb) return;
    const t = this.ctx.currentTime;
    for (const l of Object.values(this.amb)) {
      l.g.gain.setTargetAtTime(0.0001, t, 0.6);
      l.src.stop(t + 3);
    }
    this.amb = null;
  }

  // ---- Radio and UI ----

  radio(text = '') {
    if (!this.ok) return;
    this.play(this.raw.radio_in, { gain: 0.35, bus: this.uiBus });
    this.play(this.raw.radio_out, { gain: 0.25, bus: this.uiBus, delay: 0.5 + text.length * 0.045 });
  }

  tone(t0, dur, type, f0, f1, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.uiBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  click(gain = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.03, 'square', 1500, 1200, 0.05 * gain);
    this.tone(t + 0.04, 0.025, 'square', 900, 800, 0.04 * gain);
  }

  clank() {
    if (!this.ok) return;
    this.play(this.raw.casing, { offset: 0.05, duration: 0.3, rate: 0.7, gain: 0.18 });
    this.click(0.6);
  }

  overheat() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.tone(t + i * 0.12, 0.07, 'square', 880, 880, 0.06);
  }

  banner() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.12, 'square', 660, 660, 0.04);
    this.tone(t + 0.16, 0.12, 'square', 880, 880, 0.04);
  }
}

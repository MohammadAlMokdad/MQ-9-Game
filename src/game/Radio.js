// Radio chatter between the gunship crew (FCO) and the ground (OUTPOST). Prioritized, rate-limited.
const LINES = {
  start: [['OUTPOST', 'Warhammer, Outpost. Glad to have you overhead. Hostiles massing outside the wire.']],
  waveStart: [
    ['OUTPOST', 'Movement to the {dirs}. Here they come.'],
    ['OUTPOST', 'Contact {dirs}. Multiple hostiles inbound.'],
    ['FCO', 'Thermal shows a lot of heat signatures to the {dirs}.'],
  ],
  boss: [
    ['OUTPOST', 'Heavy armor rolling in from the {dirs}. Recommend the one-oh-five.'],
    ['FCO', 'Heavy armor from the {dirs}. Bombs are armed.'],
    ['FCO', 'Big push coming, crew. Armor from the {dirs}.'],
  ],
  vehicles: [
    ['OUTPOST', 'Technicals inbound from the {dir}.'],
    ['FCO', 'Vehicle moving fast on the {dir} road.'],
  ],
  armor: [
    ['OUTPOST', 'Armored vehicle, {dir} road. The forty will not cut it.'],
    ['FCO', 'Armor on the {dir} road. Switch to the one-oh-five.'],
    ['FCO', 'Armor on the {dir} road. Put a GBU on it.'],
  ],
  kill: [
    ['FCO', 'Good kill.'],
    ['FCO', 'Hit. Target down.'],
    ['FCO', 'Splash, one.'],
    ['FCO', 'He is down.'],
  ],
  vehicleKill: [
    ['FCO', 'Vehicle destroyed.'],
    ['FCO', 'Good secondaries on that one.'],
    ['OUTPOST', 'Vehicle is burning. Nice shot.'],
  ],
  multikill: [
    ['FCO', 'Multiple hostiles down.'],
    ['FCO', 'Good effect on target. That whole group is gone.'],
    ['OUTPOST', 'Wow. Nothing left of that squad.'],
  ],
  ff: [
    ['OUTPOST', 'Cease fire! Cease fire! Friendlies at that location!'],
    ['OUTPOST', 'Check fire! Those were our guys!'],
  ],
  dangerClose: [['OUTPOST', 'Danger close! You are hitting inside the wire!']],
  baseHit: [
    ['OUTPOST', 'Taking fire from the {dir}!'],
    ['OUTPOST', 'They are on the {dir} wall!'],
    ['OUTPOST', 'Heavy contact, {dir} side!'],
  ],
  baseLow: [['OUTPOST', 'Integrity at {pct} percent! We cannot hold much longer!']],
  rpg: [['OUTPOST', 'RPG team, {dir} side! Take them out!']],
  sapper: [
    ['OUTPOST', 'Runners! They are rushing the wall!'],
    ['OUTPOST', 'Explosion on the wall! They have suicide runners!'],
  ],
  manDown: [
    ['OUTPOST', 'Man down!'],
    ['OUTPOST', 'We have casualties on the wall.'],
  ],
  stragglers: [['FCO', 'Last few hostiles are making a run for the wall. Marked.']],
  waveClear: [
    ['OUTPOST', 'Area quiet. Good work, Warhammer.'],
    ['OUTPOST', 'No movement. That is the last of them, for now.'],
    ['FCO', 'Sector clear. Stand by.'],
  ],
  reinforce: [['OUTPOST', 'Reinforcements on the wall.']],
  bombAway: [
    ['FCO', 'Bomb away. Guiding on the vehicle.'],
    ['FCO', 'Weapon released. Tracking the vehicle.'],
    ['FCO', 'GBU away, steering onto the vehicle.'],
  ],
  bombNoLock: [['FCO', 'Bomb away. No vehicle in range, guiding on your crosshair.']],
  gameOver: [['OUTPOST', 'We are overrun! Outpost is lost! I say again, outpost is lost!']],
};

const COOLDOWN = {
  kill: 6,
  vehicleKill: 4,
  multikill: 5,
  baseHit: 9,
  rpg: 15,
  sapper: 10,
  manDown: 12,
  dangerClose: 6,
  vehicles: 6,
  armor: 6,
  bombAway: 2,
  bombNoLock: 2,
};

export class Radio {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.queue = [];
    this.gap = 0;
    this.cool = {};
    this.log = [];
  }

  say(cat, vars = {}, prio = 1) {
    const now = this.game.time;
    if ((this.cool[cat] || 0) > now) return;
    if (this.queue.some((m) => m.cat === cat)) return;
    if (this.queue.length >= 3 && prio < 3) return;
    this.queue.push({ cat, vars, prio, at: now });
    this.queue.sort((a, b) => b.prio - a.prio);
  }

  update(dt) {
    const now = this.game.time;
    this.gap -= dt;
    // Stale low-priority chatter is dropped instead of piling up.
    this.queue = this.queue.filter((m) => m.prio >= 3 || now - m.at < 4);
    if (this.gap <= 0 && this.queue.length) {
      const m = this.queue.shift();
      const options = LINES[m.cat];
      const [who, text] = options[Math.floor(Math.random() * options.length)];
      const line = text.replace(/\{(\w+)\}/g, (_, k) => m.vars[k] ?? '');
      this.log.push({ who, text: line, t: 0 });
      if (this.log.length > 3) this.log.shift();
      this.cool[m.cat] = now + (COOLDOWN[m.cat] || 0);
      this.gap = 2.2;
      this.game.audio.radio(line);
    }
    for (const l of this.log) l.t += dt;
    while (this.log.length && this.log[0].t > 8) this.log.shift();
  }
}

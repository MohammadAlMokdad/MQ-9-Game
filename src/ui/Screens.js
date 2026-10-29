// Menu, pause, game-over overlays and the center banner.
import { ENEMY_ORDER, WEAPONS } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const LABEL = { infantry: 'Infantry', rpg: 'RPG teams', sapper: 'Suicide runners', technical: 'Technicals', apc: 'APCs', tank: 'Tanks' };

export class Screens {
  constructor(game) {
    this.game = game;
    this.menu = $('screen-menu');
    this.pause = $('screen-pause');
    this.over = $('screen-over');
    this.banner = $('banner');
    this.bannerTitle = $('banner-title');
    this.bannerSub = $('banner-sub');
    this.bannerT = 0;
    this.overShownAt = 0;

    this.menu.addEventListener('click', (e) => {
      if (e.target.closest('.no-start')) return;
      game.deploy();
    });
    $('pause-resume').addEventListener('click', () => game.resume());
    $('pause-exit').addEventListener('click', () => game.exitToMenu());
    // Ignore clicks in the first moment after game over so a held trigger doesn't skip the stats.
    const settled = () => performance.now() - this.overShownAt > 800;
    $('over-again').addEventListener('click', () => settled() && game.deploy());
    $('over-menu').addEventListener('click', () => settled() && game.exitToMenu());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.pause.classList.contains('hidden')) game.resume();
    });

    const sens = $('sens');
    const sensVal = $('sens-val');
    sens.value = String(game.settings.sens);
    sensVal.textContent = `${Number(game.settings.sens).toFixed(2)}x`;
    sens.addEventListener('input', () => {
      game.setSensitivity(Number(sens.value));
      sensVal.textContent = `${Number(sens.value).toFixed(2)}x`;
    });
  }

  renderScores(el, highlightRank = 0) {
    const rows = this.game.score.high;
    if (!rows.length) {
      el.innerHTML = '<div class="empty">No runs yet. Hold the line.</div>';
      return;
    }
    el.innerHTML = `<table><tr><th>#</th><th>SCORE</th><th>WAVE</th><th>KILLS</th><th>DATE</th></tr>${rows
      .map(
        (r, i) =>
          `<tr class="${i + 1 === highlightRank ? 'me' : ''}"><td>${i + 1}</td><td>${fmt(r.score)}</td><td>${r.wave}</td><td>${r.kills}</td><td>${r.date}</td></tr>`,
      )
      .join('')}</table>`;
  }

  hideAll() {
    for (const s of [this.menu, this.pause, this.over]) s.classList.add('hidden');
  }

  showMenu() {
    this.hideAll();
    this.renderScores($('menu-scores'));
    this.menu.classList.remove('hidden');
  }

  showPause(v) {
    this.pause.classList.toggle('hidden', !v);
  }

  showGameOver(rank) {
    const g = this.game;
    const st = g.score.stats;
    const shots = st.shots.reduce((a, b) => a + b, 0);
    const hits = st.hits.reduce((a, b) => a + b, 0);
    const acc = (i) => (st.shots[i] ? `${Math.round((st.hits[i] / st.shots[i]) * 100)}%` : '-');
    $('over-score').textContent = fmt(g.score.score);
    $('over-rank').textContent = rank === 1 ? 'NEW HIGH SCORE' : rank ? `RANK #${rank}` : '';
    $('over-stats').innerHTML = `
      <div class="col">
        <div class="row"><span>Waves survived</span><b>${Math.max(0, g.wave - 1)}</b></div>
        <div class="row"><span>Time on station</span><b>${Math.floor(st.time / 60)}m ${Math.floor(st.time % 60)}s</b></div>
        <div class="row"><span>Total kills</span><b>${g.score.totalKills}</b></div>
        ${ENEMY_ORDER.map((t) => `<div class="row sub"><span>${LABEL[t]}</span><b>${st.kills[t]}</b></div>`).join('')}
      </div>
      <div class="col">
        <div class="row"><span>Accuracy</span><b>${shots ? Math.round((hits / shots) * 100) : 0}%</b></div>
        ${WEAPONS.map((w, i) => `<div class="row sub"><span>${w.name} (${st.shots[i]} rds)</span><b>${acc(i)}</b></div>`).join('')}
        <div class="row"><span>Best multi-kill</span><b>${st.bestMulti || '-'}</b></div>
        <div class="row"><span>Best multiplier</span><b>x${st.bestMult.toFixed(1)}</b></div>
        <div class="row"><span>Friendlies lost</span><b>${st.friendliesLost}</b></div>
        <div class="row"><span>Friendly fire kills</span><b>${st.teamKills}</b></div>
      </div>`;
    this.renderScores($('over-scores'), rank);
    this.overShownAt = performance.now();
    this.over.classList.remove('hidden');
  }

  hideBanner() {
    this.bannerT = 0;
    this.banner.classList.add('hidden');
  }

  showBanner(title, sub, dur) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerT = dur;
    this.banner.classList.remove('hidden');
  }

  update(dt) {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.add('hidden');
    }
  }
}

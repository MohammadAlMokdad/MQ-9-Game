import './ui/hud.css';
import { Game } from './Game.js';
import { loadAssets } from './assets/Assets.js';

const loading = document.getElementById('menu-loading');
const cta = document.getElementById('menu-cta');

// HUD font (Barlow Semi Condensed, SIL OFL). The game still works with fallbacks if it fails.
await Promise.all(
  [400, 500, 600].map((w) =>
    new FontFace('Barlow SC', `url(${import.meta.env.BASE_URL}assets/fonts/barlow-sc-${w}.woff2)`, { weight: String(w) })
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {}),
  ),
);

try {
  const assets = await loadAssets((p) => {
    loading.textContent = `LOADING ASSETS ${Math.round(p * 100)}%`;
  });
  loading.textContent = 'BUILDING THE AREA OF OPERATIONS...';
  await new Promise((r) => setTimeout(r, 30)); // let the message paint before the heavy build
  const game = new Game(document.getElementById('gl'), document.getElementById('overlay'), assets);
  window.__game = game;
  loading.classList.add('hidden');
  cta.classList.remove('hidden');

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    game.frame(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
} catch (err) {
  loading.textContent = `FAILED TO LOAD: ${err.message}`;
  throw err;
}

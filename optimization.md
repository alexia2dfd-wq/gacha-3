# GachAlexia — Optimization Notes

> Status: **parked** — audit done, nothing implemented yet.
> Motivation: users on weak hardware hit Throne reCAPTCHA timeouts during
> checkout. Theory (confirmed plausible): the extension's constant render load
> starves the page's main thread while the reCAPTCHA challenge is running.

## Diagnosis summary

- reCAPTCHA timeout correlates with **weak hardware** → resource contention,
  not bot-scoring of the automated click
- The extension's visuals share Throne's main thread (content-script
  architecture) — every wasted frame competes with the checkout challenge
- The redundant `startImageSpawning()` restart in `doPayment` was removed
  (2026-08) — it pointlessly churned the page mid-checkout. The ongoing spam
  from `doPull` still runs during checkout (separate question, untouched)

## Planned fixes (cheap, zero functional change)

### 1. Cap live spam images (~5 lines, `spawnImage()`)

10s lifetime at 1000ms spawn = unbounded pile-up if the main thread stalls
(stalled timeouts → more images alive → more stall → death spiral). Hard cap:

```js
const MAX_SPAM_ALIVE = 18; // tuned to current steady-state visual density
const live = document.querySelectorAll('.popup-image');
if (live.length >= MAX_SPAM_ALIVE) live[0].remove();
```

Identical visuals on healthy machines (steady state is ~10–15); the spiral
becomes impossible on slow ones. Bounds worst-case memory too.

### 2. Pause overlay animations when overlay is closed (one CSS rule)

The overlay is closed during the entire pull/checkout flow, but these all
keep repainting underneath the spam:

- `sigilPulse 6.5s` + `drop-shadow(0 0 55px)` — filter animation, main thread
- `shimmer 6s linear infinite` ×3 titles — background-position = repaint every frame
- `breathe 3.2s infinite` ×4
- `orbDrift` with `blur(90px)` — huge blur, animating, forever

Fix (adjust selector to the actual open/closed hook):

```css
.overlayBody:not(.open) * { animation-play-state: paused !important; }
```

### 3. Pause spawning on hidden tab (~6 lines)

Browsers throttle background-tab timers but don't stop our interval chains
cleanly; pause spawning (never the pull logic — that lives in background.js):

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopImageSpawning();
  else startImageSpawning(3000, { background: true });  // resume ambient
});
```

## Bigger lift (later)

### 4. Cloudinary server-side blur/filters

Every spam image carries client-side `blur() hue-rotate() brightness()
saturate()` — the most expensive per-image cost, repainted on the main thread.
Move into the Cloudinary URL (`e_blur:300/e_hue:...`) so pixels arrive
pre-baked. Ghost variants use dynamic pity-scaled intensity → pre-bake 3
intensity tiers (low/mid/high) as URL variants, pick nearest. Needs the
account's allowed-transform scheme verified first.

## Not worth doing / rejected

- **Simulated mouse events before the Pay click** — adversarial to reCAPTCHA
  behavioral scoring, fragile, fails silently per-user. No.
- **backdrop-filter removal on modals** — minor compared to the above; only
  revisit if the top fixes aren't enough. (Fallback: solid `rgba` bg instead
  of blur, near-identical on the dark theme.)
- **Electron app as a perf fix** — same Chromium, same costs. The app's real
  perf benefit is architectural (overlay window ≠ checkout page), not speed.
  See `standalone app.md`.

## Validation plan (when implemented)

- Weak-hardware user re-tests a multi-pull session through checkout
- DevTools Performance recording on the checkout page before/after —
  main-thread idle time during the 5s pre-click window should go way up

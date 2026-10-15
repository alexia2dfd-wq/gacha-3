# Banner System — Project Tracker

> Status: **engine live, presentation + structure in progress** (started 2026-08-11)
> Base engine shipped: BANNERS registry in `cards.js`, 50/50 rate-up in
> `rollCard()`, `#bannerSpot` panel + LIMITED tags, first banner live
> (Mina's Dog, s09, silver, Aug 11–25).

---

## 1. Banner presentation upgrade ⏳

Turn the banner from a small panel in the Pulls view into a proper showcase.

- **Placement**: rectangle occupying the **right half of the screen** —
  likely a tall vertical banner panel docked to the right edge (independent
  of the overlay? or inside it?). Decide: always visible on the store page
  while a banner runs, or only inside the overlay?
- **Click to expand**: clicking the banner opens a detail view/modal with:
  - the exclusive card(s) rendered bigger ("expand the card a bit")
  - full pool contents (which commons/rares/reap are in the banner)
  - exact rules (50/50 rate-up, countdown, FOMO copy — "gone forever after~")
- Card preview in the collapsed state should be larger than the current
  72px thumbnails
- Needs its own CSS block + skin overrides eventually (per-skin hue on the
  banner glow — reuse the SKINS registry pattern)

### Open questions
- Does the big banner live on the **store page** (ambient presence, like
  ghosts) or only in the **overlay**? Store page = more FOMO pressure;
  overlay = simpler, contained.
- Expand interaction: lightbox-style modal (reuse `#cardLightbox` pattern)
  or an inline slide-out?

---

## 2. Banner pool structure: 3 commons, 2 rares, 1 reap ⏳

Banners become **full pools**, not single-card rate-ups:

- Each banner defines 6 exclusive cards:
  - **3 bronze** (commons tier 1)
  - **2 silver** (rares tier 2)
  - **1 soul** (reap tier 4)
- Rate-up mechanics need a redesign decision:
  - Option A: 50/50 per tier as now — the win splits among that tier's
    banner cards (3-way for bronze, 2-way silver, soul uncontested)
  - Option B: while banner is active, banner cards *replace* the standard
    pool entirely (true "banner pool" — standard cards un-pullable for 2 weeks)
  - Option A keeps standard progress possible; Option B is classic gacha
    event design and much more aggressive FOMO
- **CardPress implication**: each banner needs 6 new artworks. CardPress
  flow handles it (6 uploads), but art production is the real bottleneck.
  Decide: reuse/re-skin existing art for commons, or full new sets?
- `cards.js` registry shape changes: `cardIds` → structured
  `{ bronze: [...], silver: [...], soul: [...] }` or keep flat and derive
  from card tiers (flat works — tier is already on the card def)

### Open questions
- Option A or B for rate-up mechanics?
- Do banner commons need unique art, or can they be alt-art/re-colored
  variants of existing cards (much cheaper to produce)?

---

## 3. Remote banner *schedule* (revised 2026-08-11) ⏳

Original plan (full remote banner definitions) **descoped**: cards can't be
sent remotely anyway (art ships with the extension), so a remote banner
*definition* buys little. Instead:

- **Banners ship with updates** — card defs + art bundled in `cards.js`.
  Future banners are registered **without dates** (dormant until activated)
- **The remote file carries the schedule** — which banner is live AND its
  window, both changeable without an update

### Design

- Host a tiny `current-banner.json` on a stable URL (Cloudinary raw upload
  — zero new infra, account already exists):
  ```json
  { "bannerId": "banner-002",
    "startsAt": "2026-09-01T00:00:00Z",
    "endsAt":   "2026-09-15T00:00:00Z" }
  ```
- `background.js` fetches it on startup + periodic alarm (~6h), caches in
  `chrome.storage.local` (`alexia_remoteBanner`)
- Bundled `BANNERS` entries become dateless templates: `{ id, name,
  cardIds }` — the registry is a *menu*, the remote file is the *schedule*
- `activeBanner()` resolution:
  1. Remote payload present → look up `bannerId` in bundled `BANNERS`;
     if found, merge in the remote `startsAt`/`endsAt` and evaluate the
     window against `Date.now()`
  2. No remote value / fetch failed / unknown id → no active banner
     (bundled entries have no dates to fall back on)
- Fail closed: a bad payload can never invent a banner (cardIds must come
  from the bundled registry) — worst case is a wrong window, and even that
  is validated as parseable ISO dates

### What this buys

- Launch/retire/reschedule a banner by uploading one tiny JSON — no
  extension update, no waiting for users to reload new code
- Ship future banner cards ahead of time (dormant, hidden), activate on
  your schedule — including *extending* a live banner by pushing endsAt
- Emergency kill-switch: point at nothing (or a past window) → dark

### Work checklist

- [ ] Upload `current-banner.json` to Cloudinary (raw), note the URL
- [ ] `background.js`: fetch on startup + `chrome.alarms` every 6h, cache payload
- [ ] `cards.js`: strip dates from `BANNERS` entries (templates only)
- [ ] `activeBanner()`: remote-window resolution, fail closed
- [ ] Validate: unknown id → ignore; unparseable dates → ignore; offline → no banner
- [ ] Test: flip the pointer, confirm the panel swaps without an update

---

## Done ✓

- Base banner engine (registry, activeBanner, 50/50, LIMITED tags,
  countdown UI in Pulls view)
- First banner live: Mina's Dog (s09, silver exclusive, 2026-08-11 → 08-25)

## Parking lot

- Banner-end celebration/consolation (last-day rate boost?)
- Banner history view (past banners + whether you got the card)
- Countdown in the popup too

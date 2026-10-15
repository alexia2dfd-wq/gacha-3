# GachAlexia — Patch Notes

Shipped features, newest first. For pending work see `CARD_FEATURES.md`
(the old `FUTURE_UPDATES.md` reward-system doc was retired — everything in
it is shipped and noted below).

---

## v3.6 (2026-08)

### Payment flow fix
- Throne checkout now requires selecting "Credit Card" before "Pay Now"
  becomes clickable; added the extra click with a 2s delay
- Pay Now selector now matches both `<span>` and direct button text
  (Throne changed their markup)

---

## v3.5 (2026-08)

### Court completion — every card has a themed passive
- All 31 cards now ship with user-designed passives (zero placeholders);
  new engine kinds: `pityShrink`, `freePullChance` (once-per-session guard),
  `cardDestroy`, `sentenceSpam`, `sundayBoost`, `poolMerge`, `bannerOdds`,
  `bannerCommon5050`, `removeItems`/`easyValue` dual-pool shorthands,
  `secondKind`/`secondValue` dual effects, `static` (breakpoint-exempt),
  `conflictsWith` (Tailjob↔Bunny supremacy)
- **Hard Mode**: Bunny takeover (l04) is unlock-only (`unlock: hardMode`);
  unlocks the hard item set — spit/cute/swipe/hot/soul buffet/surrender~
  (surrender~ = soul reap; needs a Throne store item before live pulls)
- **Forward-only XP**: `newXPBoost`/`dupeXPBoost` credit a `bonusXP`
  accumulator at pull time (devotion base is boost-free); one-time reprice
  on upgrade
- Pity bars + rates modal show live Court-adjusted thresholds; banner
  common pity 10 → 5

### Censored destroy visual
- Destroyed pulls render through the normal crown snatch reveal
  (spotlight + SFX) with a progressive pixelation canvas over the art and a
  big red DESTROYED slam (spawnTauntWord helper); never lands in the
  collection. 🧨 Sim Destroy button forces the branch

### Misc
- Only Pixels (l07) real sentences list (17 lines)
- Team Rocket taunt: 10rem word + 4 card copies, no giggle per user spec
- Gym banner (banner-004) authored: Arm Workout, Rest Bench, Sock slut,
  Gym Creep, Gym sweat, Gym brat

---

## v3.1 (2026-08)

### The Court (equipment system — CourtSystem.md)
- Every card has a **passive** (`{ kind, value, blurb }` in cards.js);
  owned cards equip into Court slots and bend the gacha
- **3 slots**, unlocked at Devotion Lv 1/5/10; new **Court tab** in the
  overlay nav (slots, picker modal, plain-language build summary)
- **Dupe breakpoints**: owning count≥3 of an equipped card boosts its
  passive ×1.5, count≥9 → ×2 (replace, not stack)
- Passive kinds: reapRateUp, rareRateUp, reapPityHaste, commonPityHaste,
  dupeXPBoost, dupeReroll, bannerLuck, freePullEvery, sessionLedger
  ($ total line in the session summary, real Throne prices)
- Hooks: item weights, reap/banner pity thresholds, banner 50/50 odds,
  dupe re-rolls, devotion XP, mid-session free-pull refunds
  (new `refundPull` message), `alexia_lifetimePulls` counter
- Presence: Pulls-view mini strip, ⚔ tag in collection, blurbs on crown
  reveals, lightbox, and banner modal
- **Unlock-key plumbing**: optional `unlock` tag on cards records
  permanent milestones in `alexia_unlocks` (features behind ids ship later)
- Court state + lifetime pulls + unlocks all ride the existing
  backup/restore export (all `alexia_*` keys)

### Banners (limited-time rate-ups — banner project.md)
- **Banner engine**: `BANNERS` registry in cards.js (dateless templates),
  exclusive cards (`exclusive: true`), silver/soul 50/50 rate-up,
  commons 10-pull banner pity, LIMITED tags, exclusive spam gating
- **Banner panel**: right-half themed showcase on the Pulls tab (per-skin
  accents), live countdown, tap → wide detail modal; hot-swaps without
  reload when the schedule changes
- **Remote schedule**: BannerPress pushes `banner/current.json` to the
  repo (git push via scratch clone); the extension polls
  raw.githubusercontent.com on every overlay open + startup + 6h alarm
  (moved off Cloudinary — its CDN cached raw uploads for 30 days and
  served stale schedules)
- **BannerForge**: diffs CardPress output vs cards.js, inserts exclusive
  cards (now with placeholder passives) + auto-numbered banner entries
- First banner live: "Mina's Dog" (s09/l06/b11), second authored:
  "Censor" (l07/s10/b12)

---

## v3.0 (2026-07/08)

### Progress & saves
- **Backup / Restore** in the extension popup — exports/imports all progress
  (`gachalexia-progress.json`): collection, devotion, skins, mode, pity,
  pull history
- **Storage migration** — mode, pity counters, and pull history moved from
  `localStorage` (throne.com site data) to `chrome.storage.local`, with a
  one-time automatic migration of legacy keys; survives site-data clears
  and extension updates
- `READ ME.txt` gained save-transfer instructions

### Card system
- **19-card pool** (8 bronze / 7 silver / 4 soul), all with real names
  (was 6 cards with filename-style names)
- **CardPress rename manager** — ✎ Rename Cards dialog edits `cards_out.json`
  and copies a full-pool snippet for one-paste sync into `cards.js`

### Overlay skins (Visual Overhaul Unlocks — CARD_FEATURES §1, done)
- **9 themes**: Plum (default), Crimson Haze (own a soul card), Moonlit
  (3 bronze), Golden Hour (Devotion Lv 5), Void (10 total cards), Sakura
  (any duplicate), Silver (5 distinct), Ember (soul + Lv 5 hybrid),
  Reaper's Crown (3 soul cards — premium: faster title shimmer + pulsing
  tab glow)
- **Themes tab** in the overlay nav: swatches, lock hints, tap-to-apply,
  persisted choice, self-healing fallback if an unlock is lost
- Themed: aquarium hue, store-page ghosts, sigil, rates/history modals,
  mode selector, devotion bar, corner buttons
- Dev reference: `THEMES.md` + the `gacha-theme` generator skill

### Devotion Level (CARD_FEATURES §4, done)
- XP from cards: new = 100 × tier mult, dupe = 20 × (bronze 1× / silver 3× /
  soul 10×); curve `100 · n^1.6`, self-healing recompute from collection
- XP bar top-left with level + `X/Y EXP` counter
- Level-up celebration banner (single, highest level)
- Session summary shows `+N Devotion XP` earned

### Housekeeping
- Sim pull buttons disabled (still in the markup, commented out)
- Spam image URLs moved from Imgur to Cloudinary (49 images)

---

## v2.1 — Card Reward System (the whole `FUTURE_UPDATES.md` plan, done)

- **CardPress tool** — tkinter GUI: Cloudinary upload, AES-256-GCM link
  encryption, id assignment, dupe detection, snippet output, key generation
- **Encrypted card defs** (`cards.js`) — AES-GCM via WebCrypto, key split
  into 3 pieces, Cloudinary `w_450,q_auto,f_auto` transform, full-pool
  preload at overlay open
- **Award flow** — every pull pre-rolls a card by rarity (common→bronze,
  rare→silver, reap→soul); chosen card + 2–5 decoys ride the pull's image
  spam (35% of spawns); crowned on Pay Now with snatch/swell/whip
  animation, spotlight dim, and a synthesized sub-bass drop
- **Collection** — `chrome.storage.local` persistence with version field,
  dupe counts (×N), variant tiers from dupe count (base ×1-2 / shiny ×3-8 /
  prismatic ×9+), "NEW!" vs "DUPLICATE ×N" reveal tags
- **Collection view** — nav-tabbed overlay (Pulls / Collection), tier-grouped
  grid, owned vs ??? placeholders, progress header, lightbox with 3D tilt +
  holo sheen + prismatic ghost layer (CSS, from `card-demo.html`)

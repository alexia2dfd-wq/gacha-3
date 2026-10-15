# The Court — Equipment System Implementation

> Status: **built** (2026-08-15) — engine, hooks, UI all live. Remaining:
> per-card passive tuning, unlock-key *features* (plumbing shipped), and
> the open questions at the bottom.
> Supersedes: the Court/currency/unlock-keys split in `CardFeatures.md` —
> all three fuse into one system here. Cards are equipped into Court slots
> like gear; each equipped card grants its passive; burning and unlocks
> become Court-adjacent mechanics instead of separate systems.

---

## 1. Concept

Every card is a piece of **equipment**. Owned cards sit in the collection;
up to 3 can be **equipped** into Court slots, where their passive effects
bend the gacha. Slots unlock with Devotion level, tying the two progression
systems together:

| Devotion Lv | Court slots |
|-------------|-------------|
| 1           | 1           |
| 5           | 2           |
| 10          | 3           |

Design goals:
- Every card has a *purpose* beyond the collection slot — a build decision
- Dupes stay valuable, 3 dupes buffs the effect by 50%, 9 dupes buffs it by 100%  (see #6)
- Banner exclusives become limited-time *abilities*, not just rare art
- One system to balance, not three

---

## 2. Data model

### 2.1 Card passive definitions (cards.js)

Each card def gains one optional field:

```js
{
  id: 'b03', name: 'Holy Nun', tier: 1, ...,
  passive: { kind: 'reapPityHaste', value: 0.10, blurb: 'Reap pity counts 10% faster' }
}
```

`passive` is a plain data object — **no functions in cards.js** (it must
stay serializable and BannerForge-insertable). The `kind` string maps to a
handler in content.js (§4). `value` semantics depend on the kind.

Passive kinds (initial set — extend as needed):

| kind | value | effect |
|------|-------|--------|
| `rareRateUp` | 0.02 | +2% absolute weight share to the rare group |
| `reapPityHaste` | 0.10 | reap pity threshold ×(1−v) (80 → 72) |
| `dupeXPBoost` | 0.50 | dupe devotion XP ×(1+v) |
| `dupeReroll` | 0.10 | v chance a dupe card draw re-rolls once |
| `bannerLuck` | 0.10 | banner 50/50 becomes (50+v·100)/(50−v·100) |
| `commonPityHaste` | 1 | banner common pity threshold −v (10 → 9) |
| `freePullEvery` | 10 | every v-th pull doesn't decrement pullsRemaining |
| `sessionLedger` | — | session summary shows running $ total |

### 2.2 Court state (chrome.storage.local)

```js
alexia_court = {
  equipped: ['b03', null, null],   // card ids, fixed length 3, null = empty
  version: 1
}
```

- Mirrored into a sync `courtCache` at startup alongside the existing
  caches (pityCache/modeCache/collectionCache pattern in
  `initStorageCaches`)
- Slot count is **derived**, not stored: `courtSlots(level) =
  level >= 10 ? 3 : level >= 5 ? 2 : 1`. Equipping into a locked slot is
  impossible by construction; if a user's level somehow drops (it can't
  today — XP is monotonic), excess equips are ignored, not wiped
- Equipped cards stay in the collection — equipping is not consuming

### 2.3 Validation

`getEquippedPassives()` — the single read path used everywhere:

```js
function getEquippedPassives() {
  const level = devotionLevelFromXP(devotionComputeXP(collectionCache));
  const slots = courtSlots(level);
  return (courtCache.equipped || [])
    .slice(0, slots)                       // locked slots ignored
    .filter(id => id && collectionCache[id]) // must still own it
    .map(id => cardDefs && cardDefs[id])
    .filter(def => def && def.passive);
}
```

Fail-closed: bad ids, unowned cards, missing defs, locked slots all drop
out silently. An empty/invalid Court = zero passives = current behavior.

---

## 3. Effect application points

Passives hook into existing code at exactly four places. Each hook
aggregates the relevant equipped passives and applies them locally — no
global state mutation.

### 3.1 Item roll — `chooseOneRandomItem()`

Before the weighted roll, compute modifiers:

```js
const mods = aggregateCourtMods();   // { rareRateUp, reapPityHaste, ... }
```

- `rareRateUp`: scale each rare-group item's weight by
  `(1 + mods.rareRateUp * baselineShare / rareShare)` — implemented simply
  as multiplying rare-group weights by `(1 + v)` per stack. Weights are
  relative, so scaling the group is enough; no renormalization needed
- `reapPityHaste`: the `pullsSinceSoulReap >= 79` check becomes
  `>= Math.floor(79 * (1 - mods.reapPityHaste))` (79 because the check is
  "counter reaches threshold−1"; floor keeps it an integer)
- `freePullEvery`: after the pull resolves, if
  `(totalPulls + 1) % v === 0`, refund `pullsRemaining++` with a taunt
  ("Alexia waves you through~ this one's on her")

### 3.2 Card roll — `rollCard(tier)`

- `bannerLuck`: the silver/soul `Math.random() < 0.5` becomes
  `< 0.5 + mods.bannerLuck`
- `commonPityHaste`: the `since >= 9` check becomes
  `>= 9 - mods.commonPityHaste`
- `dupeReroll`: after `pendingCardDraw` is chosen, if the pick is already
  owned (collectionCache) and `Math.random() < mods.dupeReroll`, re-roll
  once (single re-roll, no chain)

### 3.3 Devotion XP — `devotionComputeXP(cards)`

Pure function of the collection today. `dupeXPBoost` applies at the
*display/level* layer instead: wrap the computed XP:

```js
const xp = devotionComputeXP(data.cards) * (1 + aggregateCourtMods().dupeXPBoost);
```

Note: this makes level (and therefore slot count!) depend on equipment.
That's intentional — a dupe-XP build literally levels you faster — but see
§7 for the feedback-loop guard.

### 3.4 Session summary — `sessionLedger`

If any equipped card has this passive, the session summary gains a
running-total line. Pure UI, no game-math impact.

### Aggregation rule

`aggregateCourtMods()` sums same-kind values across equipped cards
(**additive stacking**, decided here to close the open question from
CardFeatures.md). Additive is legible ("two +2% cards = +4%") and the
values are small enough that linear stacking can't break the economy.
Caps: `reapPityHaste` ≤ 0.30, `bannerLuck` ≤ 0.20, `dupeReroll` ≤ 0.30 —
enforced in the aggregator, not per-card.

---

## 4. Passive assignment (all 22 cards)

One passive per card, themed to the card. Tier scales magnitude: bronze
small, silver medium, soul strong. Banner exclusives get banner-flavored
effects so a limited card is a limited *build piece*.

| Card | Tier | Passive |
|------|------|---------|
| (each bronze) | 1 | small: +1% rare rate, +25% dupe XP, etc. |
| (each silver) | 2 | medium: +2% rare rate, 10% reap haste, 10% dupe reroll |
| (each soul) | 4 | strong: free pull every 10, +10% banner luck, session ledger |
| Mina's Dog (s09) | 2 | banner common pity −1 |
| Under Mina's Boot (l06) | 4 | +10% banner luck |
| Mina (b11) | 1 | +1% rare rate during any live banner |

Exact per-card table to be filled in at build time — the kinds in §2.1 are
the menu. Rule: **no card ships without a passive**; new cards (CardPress
→ BannerForge pipeline) must pick one at insertion time. BannerForge's
insert template gains a `passive` field for this.

---

## 5. UI

### 5.1 Court management — new nav tab

Decided (closes the CardFeatures.md question): a dedicated **Court tab**
in the overlay nav, not a Pulls-view row. The Pulls view is already dense
(banner panel, pity bars, modes); equipment management is a deliberate,
build-crafting activity that deserves its own screen.

Court tab layout:
- 3 slot cards across the top (locked ones shown with the Devotion level
  required: "🔒 Lv 5")
- Tap a slot → picker modal listing owned cards with their passive blurbs
  (same modal shell as the banner modal — wide, side-by-side cards)
- Equipped card shown in-slot with art thumbnail + passive text; tap to
  unequip
- Active modifiers summary line at the bottom: aggregated effects in
  plain language ("+2% rare rate · reap pity 72 · dupes +50% XP")

### 5.2 Presence elsewhere

- Pulls view: tiny equipped-icons strip (3 mini thumbnails) under the pity
  bars — read-only, tap → jumps to Court tab
- Collection view: equipped cards get a small "⚔" corner tag (same
  pattern as the LIMITED ribbon)
- Card reveal: passive blurb line under the card name

### 5.3 Skinning

Court tab uses the existing skin system (`.skin-*` overrides) — no new
theme variables beyond reusing `--banner-accent` patterns for slot frames.

---

## 6. Fused mechanics (currency + unlocks folded in)

### 6.1 Burning (from "Cards as Currency")

Owning duplicate cards buffs the card effect at fixed breakpoints:
- Own 3 dupes, effect buffed by 50%
- Own 9 dupes, effect buffed by 100% 

### 6.2 Unlock keys (from "Cards as Unlock Keys")

Ownership milestones stay **passive and permanent** — they are not
equipment, they don't take slots:

- Own some soul card → hard mode unlocks (third mode in MODES)
- Own all 4 soul cards → Soul Tax (every 10th pull free — note this
  overlaps the `freePullEvery` passive; if both apply, milestone wins and
  the passive is redundant — acceptable, or give that soul card a
  different passive at assignment time)
- Own "Alexia's Throne" → lifetime stats tab
- Own "Hypnosis" → autopull queue

Decided: unlocks are **permanent-once-earned** (`alexia_unlocks` record
set at first ownership), so burning dupes later never revokes them. Check
runs once per collection change, not per pull.

---

## 7. Edge cases & guards

- **Slot-count feedback loop**: dupeXPBoost raises XP → level → slots →
  more passives. Intentional acceleration, but slot thresholds (5/10) are
  far enough apart that it can't spiral within a session. No guard needed;
  noted so nobody "fixes" it later
- **Banner-exclusive passives after banner ends**: the card stays owned,
  the passive keeps working. `bannerLuck`/`commonPityHaste` just do
  nothing when no banner is live (rollCard already early-exits)
- **Storage migration**: `alexia_court` absent → treated as all-empty.
  No migration needed; first Court tab visit writes the default
- **Backup/restore**: `alexia_court` and `alexia_unlocks` must join the
  export/import key list
- **Sim buttons**: sim1/sim10 paths call the same `chooseOneRandomItem`/
  `rollCard`, so Court effects apply in sims automatically — good for
  testing builds without spending
- **Fail-closed everywhere**: any inconsistency (equipped card not owned,
  def missing, storage corrupt) resolves to "no passive", never a crash

---

## 8. Build checklist

- [x] cards.js: add `passive` to all 25 card defs (placeholders — user retunes)
- [x] content.js: `courtCache` + `alexia_court` in initStorageCaches
- [x] content.js: `courtSlots()`, `getEquippedPassives()`, `aggregateCourtMods()`
- [x] content.js: hook §3.1 (chooseOneRandomItem: rareRateUp, reapPityHaste, freePullEvery)
- [x] content.js: hook §3.2 (rollCard: bannerLuck, commonPityHaste, dupeReroll)
- [x] content.js: hook §3.3 (devotion XP wrap)
- [x] content.js: hook §3.4 (session ledger line)
- [x] overlay.html: Court nav tab + tab pane (slots, summary line)
- [x] content.js: Court tab render + picker modal + equip/unequip actions
- [x] content.js: Pulls-view mini strip, collection ⚔ tag, reveal blurb
- [x] content.css: Court tab styles + slot frames (base hue; per-skin overrides reuse banner pattern)
- [x] ~~content.js: tribute burn + silver re-roll~~ — replaced by dupe breakpoints (user edit, §6.1)
- [x] content.js: `alexia_unlocks` milestone detection (plumbing only — features pending)
- [x] Backup/restore: covered automatically (export dumps all `alexia_*` keys)
- [x] BannerForge: placeholder passive in the insert template
- [x] `node --check` after every JS edit; engine smoke-tested (slot gating, dupe ladder, ownership)
- [x] PATCHNOTES.md entry (v3.1); CardFeatures.md header points here
- [ ] User: retune the 25 placeholder passives; pick the hard-mode unlock card

## Open questions (remaining)

- Hard mode design (worse rates, 2× XP) — exact numbers when built
- Autopull queue UX (Hypnosis unlock) — separate mini-design when built
- Should equipped cards be excluded from burning? (Current call: no —
  burning only touches dupes, equipped card's base copy is never burnable
  anyway)

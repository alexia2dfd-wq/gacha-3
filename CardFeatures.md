# Card Features — Gamification Design

> Status: **superseded by `CourtSystem.md`** (2026-08-15) — the Court,
> currency, and unlock-key ideas below were fused into the Court equipment
> system, which is built and live. This file kept for the original pitch
> history. Power-ups (consumable per-session charges) were pitched and
> **rejected** — do not resurrect that one.

---

## 1. The Court (cards as pull modifiers)

Equip up to 3 owned cards; each passively bends the gacha. Loadout slots
unlock with Devotion levels (1 slot at Lv1, 2 at Lv5, 3 at Lv10) — ties the
collection and devotion systems together. Every new card becomes a build
decision.

Example passives:
- "Massive..." → +2% rare-group rate
- "Holy Nun" → reap pity counts down 10% faster (72 instead of 80)
- "Virgin killer" → dupes give +50% devotion XP
- "Mob Boss" → session summaries show total spent (money-tracking fantasy)
- "Team Rocket" → 10% chance a dupe "blasts off" and re-rolls instantly

---

## 2. Cards as Currency

The collection becomes a resource you *spend* — makes common dupes actively
valuable and creates real decisions ("keep the set or burn for the rate-up?").

- **Tribute burning** — burn 3 bronze dupes → guarantee next pull is
  rare-group. Burn a silver → re-roll a just-pulled card.
- **Card wagers** — before a pull, stake a card: rare+ → the stake levels up
  (dupe progress); common → the stake is destroyed. Self-directed risk.

---

## 3. Cards as Unlock Keys (mechanical, not just skins)

Extends the existing skin-gating pattern to mechanics — cards become the
**tech tree** of the whole extension:

- Own "Unbeatable" → unlock a third mode (hard mode: worse rates, 2× XP)
- Own all 4 soul cards → unlock "Soul Tax": every 10th pull is free
  (doesn't decrement pullsRemaining)
- Own "Alexia's Throne" → unlock a second overlay tab with lifetime stats
- Own "Hypnosis" → unlock autopull queueing (queue 10 pulls, walk away)

---

## 4. The Unified Trinity (the coherent end-state)

Combine all three: **every card gets exactly one passive (in Court) + one
unlock (permanent, at collection milestones)**. A 19-card pool becomes
dozens of interacting mechanics, all fed by pulls, all reasons to want
*specific* cards rather than just "more cards."

This also gives banners/fusion (see `FUTURE_UPDATES.md`) something to plug
into: a banner-exclusive card isn't just rare art — it's a limited-time
*ability*.

---

## Open design questions (decide when building)

- Balance: do Court passives stack multiplicatively or additively with
  existing rates/pity?
- Does burning a card remove it from the collection permanently (hardcore)
  or just decrement dupe count (soft)?
- Unlock keys: should ownership be permanent-once-earned (keep unlock even
  if card is burned) or require current ownership?
- Where does Court management live — new nav tab, or a row on the Pulls view?

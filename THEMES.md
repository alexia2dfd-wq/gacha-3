# GachAlexia — Theme Registry

Dev reference for all overlay skins. Add new themes via the `gacha-theme` skill.

| # | ID | Label | CSS class | Unlock condition | Ghost hue | Notes |
|---|----|-------|-----------|------------------|-----------|-------|
| 1 | `default` | Plum | *(none)* | always available | `-15deg` | the original dark-plum look |
| 2 | `crimson` | Crimson Haze | `skin-crimson` | own any soul card | `-100deg` | deep red; first skin ever added |
| 3 | `moonlit` | Moonlit | `skin-moonlit` | collect all 3 bronze cards | `145deg` | soft blue; sigil hue +95° (redder than the ghosts) |
| 4 | `golden` | Golden Hour | `skin-golden` | reach Devotion Lv 5 | `-55deg` | gilded amber; only level-gated skin |
| 5 | `void` | Void | `skin-void` | own 10 total cards (dupes count) | `35deg` | deep violet |
| 6 | `sakura` | Sakura | `skin-sakura` | own any duplicate card (×2) | `-25deg` | soft pink; easiest unlock |
| 7 | `silver` | Silver | `skin-silver` | own 5 distinct cards | `190deg` | silver-on-black monochrome; sigil keeps base magenta color (user preference), aquarium images desaturated |
| 8 | `ember` | Ember | `skin-ember` | own a soul card + reach Devotion Lv 5 | `-75deg` | Crimson Haze × Golden Hour mix: burnt-orange embers on warm near-black; first hybrid unlock (two parent conditions ANDed) |
| 9 | `reaper` | Reaper's Crown | `skin-reaper` | own 3 soul cards (dupes count) | `-60deg` | premium blackened gold w/ blood-red undertone; extras: faster title shimmer (3.5s), pulsing crown glow on active nav tab |

## Architecture

- **Registry:** `SKINS` const in `content.js` (~L275) — each entry: `{ id, label, cls, hint, unlocked(owned) }`
- **Picker:** Themes nav tab (`view-themes` in `overlay.html`, `renderThemes()` in `content.js`) — locked rows show 🔒 + hint, unlocked are tap-to-apply
- **Persistence:** `alexia_overlaySkin` in `chrome.storage.local`; validated against the collection on overlay open, falls back to `default` if the unlock is lost
- **CSS:** one `.overlayBody.skin-X` block per theme at the end of `content.css` (~30 required selectors — see the skill)
- **Swatches:** `.themeSwatch.skin-X` radial gradients in the themes-view CSS section
- **Ghosts:** `skinHue` ternary in `spawnImage()` tints store-page ghosts per active skin
- **History modal:** `showHistory()` copies the active skin class onto the modal; only crimson/moonlit have modal overrides so far

## Unlock-condition patterns (for future themes)

```js
owned => Object.keys(owned).some(id => cardDefs[id] && cardDefs[id].tier === T)      // any card of tier T
owned => Object.keys(owned).filter(id => cardDefs[id] && cardDefs[id].tier === T).length >= N  // N distinct of tier T
owned => Object.values(owned).reduce((s, n) => s + n, 0) >= N                        // N total incl. dupes
owned => Object.values(owned).some(n => n >= 2)                                      // any duplicate
owned => Object.keys(owned).filter(id => cardDefs[id]).length >= N                   // N distinct any tier
owned => devotionLevelFromXP(devotionComputeXP(owned)) >= L                          // devotion level L
```

Tiers: 1 = bronze, 2 = silver, 4 = soul.

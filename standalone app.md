# GachAlexia as a Standalone App — Plan (draft)

> Status: **idea only** — no code yet. Parked until we feel like building it.
> Core concept: an Electron app that runs Throne in a hidden background window for the actual pull detection, with the gacha overlay living in its own window. No browser tab needed.

## Why Electron (and not Tauri/PWA)

- Electron **is Chromium** — the embedded-Throne trick (preload script + URL watching) is the same technique the extension's content script + `background.js` use today. Minimal rewrite of the automation logic.
- Tauri is ~10 MB but its webview isn't Chromium → the Throne automation would need real adaptation. Skip.
- PWA/hosted web app still needs a browser + extension bridge. Worst of both worlds.

## Target architecture

```
GachAlexia App (Electron)
├─ Overlay window          ← existing overlay UI (pulls, collection, themes, devotion)
│                            always-on-top option, system tray
├─ Hidden Throne window    ← BrowserWindow(show:false) + preload script
│   (BrowserView)            loads throne.com/brattyalexia, plays the
│                            content-script role (clicks, page automation)
└─ Main process            ← replaces background.js
   (state machine)           watches webContents 'did-navigate' for the same
                             URL patterns, drives pull state machine
```

## Component mapping (extension → app)

| Extension (today) | Standalone app |
|---|---|
| `background.js` — `chrome.tabs.onUpdated` URL watch (`throne.com/brattyalexia` → `doPull`, `.../checkout` → `doPayment`) | Main process: `webContents.on('did-navigate')` on the hidden view, same URL checks |
| Content script injection on Throne pages | Preload script + `executeJavaScript` on the hidden view |
| Overlay injected into host page (`shouldShowOverlay` handshake, `document.body.appendChild`) | Dedicated Electron `BrowserWindow` loading `overlay.html` directly — all DOM-injection assumptions get deleted |
| `chrome.storage.local` (`alexia_*` keys) | JSON file in app-data dir; Backup/Restore export format already serializes everything — reuse it as the on-disk format |
| `cards.js` (Cloudinary URLs, decryption) | Unchanged — loads as-is |
| Pull automation clicks on checkout/storefront | Same logic, ported to preload script |

## What changes vs. today

- **Throne login lives in the app** — hidden window has its own cookie jar; user logs in once inside the app, session persists. Arguably nicer (no interference with normal browsing).
- **No browser tab clutter** — overlay renders on its own surface, works with no browser open.
- **The risky DOM-injection code goes away** — `shouldShowOverlay` handshake, re-injection on reload, all deleted. The window *is* the overlay.

## Known tradeoffs / risks

- App size ~150–250 MB (Electron), needs `electron-builder` packaging.
- Throne changing their page structure breaks automation — same risk the extension already has.
- Long-term wants the update system from `FUTURE_UPDATES.md` (GitHub Releases).
- Extension stays alive during transition; progress transfers via existing Backup/Restore JSON.

## Build phases

1. **Prototype spike** (~150–250 lines new code, extension untouched, new folder e.g. `gacha-app/`)
   - Electron shell with hidden Throne view that just *logs* navigation events → validates Throne behaves in an embedded view
   - Overlay window rendering the current overlay with manual pulls → validates UI survives being lifted out of content-script context
2. **Port the engine**
   - Lift gacha/card/devotion/skin logic out of `content.js` into shared modules (storage calls already centralized in the cache layer — swap to a file-based adapter)
   - Port `background.js` state machine to main process
3. **Port the automation**
   - Preload script for the hidden Throne view (pull/payment click logic)
   - Wire `did-navigate` events → pull state machine
4. **Polish**
   - Tray icon, always-on-top toggle, single-instance lock, first-run Throne login flow
   - `electron-builder` packaging → installer
   - (Later) auto-update via GitHub Releases

## Open questions (decide when we actually build)

- Show the Throne window during login only, or always fully hidden + a "show Throne" debug toggle?
- Keep supporting the extension forever, or eventually app-only?
- In-app pulls when Throne is unreachable — hard fail, or queue-and-retry?

## Banners (fully remote — app version)

The extension's banner system is limited by its packaging: card art is
bundled, so new banner cards require an extension update, and the remote
file can only *schedule* pre-shipped banners (see `banner project.md`
track 3). The app removes that ceiling — banners become **fully remote**,
including introducing brand-new cards without any release.

### Why the app can do this

- No bundled-asset constraint: the app fetches card art at runtime from
  Cloudinary (cards are already served from there — the extension just
  chooses to encrypt+bundle the URLs)
- The app owns its storage (JSON file), so a remote card registry is just
  another synced document
- Auto-update via GitHub Releases exists for *code* changes; content
  (cards, banners, schedules) should never need it

### Design

- **Remote card registry** (`cards.json` on Cloudinary/raw hosting):
  full card defs — id, name, tier, exclusive flag, **plaintext or
  lightly-obfuscated Cloudinary URLs** (the AES encryption exists to stop
  extension-users from grepping the bundle; in the app the URLs are
  fetched at runtime anyway, so encryption buys little — decide whether
  to keep it for consistency or drop it)
- **Remote banner schedule** (`current-banner.json`): as designed for the
  extension — `{ bannerId, startsAt, endsAt }` — but `bannerId` can
  reference cards that were *also* delivered remotely
- App fetches both at startup + periodically (hourly), caches to disk,
  validates strictly (unknown tiers, bad URLs, malformed dates → reject
  and keep last-known-good)
- New card launch flow becomes: upload art to Cloudinary → add entry to
  `cards.json` → point `current-banner.json` at it. **Zero app updates,
  zero user action** — the banner and its new cards appear on next fetch

### Migration note

The extension's bundled `cards.js` + CardPress encryption pipeline stays
as the *authoring* tool (CardPress still uploads art to Cloudinary), but
the app reads the plaintext URL column from `cards_out.json` directly —
no encryption step needed for app-delivered cards.

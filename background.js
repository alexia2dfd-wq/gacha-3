const tabsAPI = typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs : browser.tabs;

let pullsRemaining = 0;
let overlayTabId = null;
let activeTabId = null;
let pityCounters = { pullsSince8pct: 0, pullsSinceSoulReap: 0 };

/* ===================== REMOTE BANNER SCHEDULE =====================
 * BannerPress pushes banner/current.json to the repo; we poll the raw URL
 * and cache the payload so content scripts can resolve the live banner.
 * Shape: { "bannerId": "banner-001", "startsAt": "ISO", "endsAt": "ISO" }
 * (raw.githubusercontent.com updates seconds after push — Cloudinary's CDN
 * cached raw uploads for 30 days and could serve stale schedules.)
 */
const BANNER_SCHEDULE_URL = "https://raw.githubusercontent.com/alexia2dfd-wq/gacha-3/main/banner/current.json";
const REMOTE_BANNER_KEY = 'alexia_remoteBanner';
const BANNER_ALARM = 'bannerScheduleRefresh';

function validateBannerSchedule(p) {
  if (!p || typeof p.bannerId !== 'string' || !p.bannerId) return null;
  if (Number.isNaN(Date.parse(p.startsAt)) || Number.isNaN(Date.parse(p.endsAt))) return null;
  return { bannerId: p.bannerId, startsAt: p.startsAt, endsAt: p.endsAt };
}

function fetchBannerSchedule() {
  // cache-bust is harmless here (GitHub raw updates fast), kept as a guard
  // against any intermediate proxy caching the raw file
  const url = BANNER_SCHEDULE_URL + '?t=' + Date.now();
  fetch(url, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(p => {
      const clean = validateBannerSchedule(p);
      if (!clean) throw new Error('invalid payload');
      chrome.storage.local.set({ [REMOTE_BANNER_KEY]: JSON.stringify(clean) });
      console.log('banner schedule updated:', clean.bannerId, '→', clean.endsAt);
    })
    .catch(e => console.warn('banner schedule fetch failed (keeping last known):', e.message));
}

chrome.runtime.onStartup.addListener(fetchBannerSchedule);
chrome.runtime.onInstalled.addListener(fetchBannerSchedule);
chrome.alarms.create(BANNER_ALARM, { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === BANNER_ALARM) fetchBannerSchedule(); });

// Send a message to the content script, retrying if it isn't ready yet
function trySendMessage(tabId, msg, retries = 6) {
  chrome.tabs.sendMessage(tabId, msg, () => {
    if (chrome.runtime.lastError && retries > 0) {
      setTimeout(() => trySendMessage(tabId, msg, retries - 1), 1000);
    }
  });
}

// When the active tab navigates, drive the pull state machine
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId || changeInfo.status !== 'complete' || pullsRemaining <= 0) return;
  const url = tab.url || '';

  if (url.includes('throne.com/brattyalexia/checkout')) {
    trySendMessage(tabId, { action: 'doPayment' });
  } else if (url.includes('throne.com/brattyalexia')) {
    trySendMessage(tabId, { action: 'doPull' });
  }
});

// If the user closes the tab mid-session, reset state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    console.log('Active pull tab closed — resetting.');
    pullsRemaining = 0;
    activeTabId = null;
  }
  if (tabId === overlayTabId) overlayTabId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'openGacha') {
    fetchBannerSchedule();  // fresh schedule on every gacha open
    chrome.tabs.create({ url: 'https://throne.com/brattyalexia' }, (tab) => {
      overlayTabId = tab.id;
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'shouldShowOverlay') {
    // every overlay open path fetches a fresh schedule — not just the first
    // open after the popup button (overlayTabId is consumed on first match)
    fetchBannerSchedule();
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId && tabId === overlayTabId) {
      overlayTabId = null;
      sendResponse({ ok: true, show: true });
   // } else if (tabId && tabId === activeTabId && pullsRemaining > 0) {
      // mid-pull-session page reloads (Throne redirects after payment)
      // wipe the DOM — re-inject the overlay so it survives the cycle
   //   sendResponse({ ok: true, show: true });
    } else {
      sendResponse({ ok: true, show: false });
    }
    return true;
  }
  if (msg.action === 'startPulls') {
    if (pullsRemaining > 0) {
      sendResponse({ ok: false, reason: 'already running' });
      return true;
    }
    pullsRemaining = msg.count;
    activeTabId = sender.tab ? sender.tab.id : null;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'freePullDone') {
    // a free pull ran sim-style in the overlay — no purchase happened, but
    // it still consumed one of the batch's pull slots, so decrement exactly
    // like pullComplete. Fire the next pull directly (the page never
    // navigated, so onUpdated won't); on the last pull of the batch, wrap
    // up with the summary instead.
    pullsRemaining--;
    console.log(`Free pull done. ${pullsRemaining} remaining.`);
    if (pullsRemaining > 0) {
      trySendMessage(activeTabId, { action: 'doPull' });
    } else {
      const finishedTabId = activeTabId;
      activeTabId = null;
      console.log('All pulls done!');
      if (finishedTabId !== null) {
        trySendMessage(finishedTabId, { action: 'allPullsDone' });
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'pullComplete') {
    pullsRemaining--;
    console.log(`Pull complete. ${pullsRemaining} remaining.`);
    if (pullsRemaining > 0) {
      // Throne redirects back to the storefront on its own after payment;
      // the onUpdated listener picks that up and fires the next doPull.
    } else {
      const finishedTabId = activeTabId;
      activeTabId = null;
      console.log('All pulls done!');
      if (finishedTabId !== null) {
        trySendMessage(finishedTabId, { action: 'allPullsDone' });
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'abortPulls') {
    // hard stop: no further pulls, no allPullsDone summary (content.js shows
    // its own abort UI). Used when the pull can't proceed (e.g. no saved card).
    console.log(`Pulls aborted (${pullsRemaining} remaining).`);
    pullsRemaining = 0;
    activeTabId = null;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'updatePity') {
    pityCounters = { pullsSince8pct: msg.pullsSince8pct, pullsSinceSoulReap: msg.pullsSinceSoulReap };
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'getStatus') {
    sendResponse({ pullsRemaining, pityCounters });
    return true;
  }

  // full progress dump for the popup's backup feature
  if (msg.action === 'exportProgress') {
    chrome.storage.local.get(null, all => {
      const progress = {};
      for (const k in all) {
        if (k.startsWith('alexia_')) progress[k] = all[k];
      }
      sendResponse({ ok: true, progress });
    });
    return true;
  }

  // restore a previously exported progress dump
  if (msg.action === 'importProgress') {
    const progress = msg.progress || {};
    chrome.storage.local.set(progress, () => sendResponse({ ok: true }));
    return true;
  }

  return true;
});

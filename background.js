const tabsAPI = typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs : browser.tabs;

let pullsRemaining = 0;
let activeTabId = null;
let pityCounters = { pullsSince8pct: 0, pullsSinceSoulReap: 0 };

// local storage for more reliability (plz check :3)
chrome.storage.local.get(['session'], (result) => {
  if (result.session && result.session.pullsRemaining > 0) {
    pullsRemaining = result.session.pullsRemaining;
    activeTabId = result.session.activeTabId;
    pityCounters = result.session.pityCounters || pityCounters;
    console.log('Restored session:', pullsRemaining, 'pulls remaining');
  }
});

// saving to local storage (plz check :3)
function saveSession() {
  chrome.storage.local.set({
    session: { pullsRemaining, activeTabId, pityCounters }
  });
}

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
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startPulls') {
    if (pullsRemaining > 0) {
      sendResponse({ ok: false, reason: 'already running' });
      return true;
    }
    pullsRemaining = msg.count;
    chrome.tabs.create({ url: 'https://throne.com/brattyalexia' }, (tab) => {
      activeTabId = tab.id;
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'pullComplete') {
    pullsRemaining--;
    console.log(`Pull complete. ${pullsRemaining} remaining.`);
    if (pullsRemaining < 1) {
      activeTabId = null;
      console.log('All pulls done!');
    }
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

  return true;
});

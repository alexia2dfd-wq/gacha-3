const btn1 = document.getElementById('pull1');
const btn10 = document.getElementById('pull10');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

function setBusy(remaining) {
  btn1.disabled = true;
  btn10.disabled = true;
  setStatus(`${remaining} pull${remaining !== 1 ? 's' : ''} remaining...`);
}

function updatePityDisplay(pity) {
  if (!pity) return;
  const s8 = pity.pullsSince8pct || 0;
  const sR = pity.pullsSinceSoulReap || 0;
  document.getElementById('count8pct').textContent = s8 + '/10';
  document.getElementById('countReap').textContent  = sR + '/80';
  document.getElementById('bar8pct').style.width = (s8 / 10 * 100) + '%';
  document.getElementById('barReap').style.width  = (sR / 80 * 100) + '%';
}

// Check if a session is already running and load pity counters
chrome.runtime.sendMessage({ action: 'getStatus' }, (resp) => {
  if (resp && resp.pullsRemaining > 0) setBusy(resp.pullsRemaining);
  if (resp) updatePityDisplay(resp.pityCounters);
});

btn1.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startPulls', count: 1 }, (resp) => {
    if (resp && resp.ok) {
      setBusy(1);
      setTimeout(() => window.close(), 500);
    } else {
      setStatus('Already running~');
    }
  });
});

btn10.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startPulls', count: 10 }, (resp) => {
    if (resp && resp.ok) {
      setBusy(10);
      setTimeout(() => window.close(), 500);
    } else {
      setStatus('Already running~');
    }
  });
});

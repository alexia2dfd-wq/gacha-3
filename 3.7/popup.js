const btnStart = document.getElementById('start');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
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

// Load pity counters on open
chrome.runtime.sendMessage({ action: 'getStatus' }, (resp) => {
  if (resp) updatePityDisplay(resp.pityCounters);
});

btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openGacha'}, (resp) => {
    if (resp && resp.ok) {
      setTimeout(() => window.close(), 500);
    } else {
      setStatus('Something went wrong~');
    }
  });
});

/* ---- progress backup / restore ---- */

/* Saves are obfuscated on export (XOR + Base64, prefixed) so casual editors
   can't tweak their collection in Notepad. NOT encryption — the key ships
   with the extension; it only raises the bar. Legacy plain-JSON backups
   still import (no prefix → parse as-is). */
const SAVE_PREFIX = 'GACHALEXIA1:';
const SAVE_KEY = [0x41, 0x6c, 0x65, 0x78, 0x69, 0x61, 0x47, 0x61,
                  0x63, 0x68, 0x61, 0x53, 0x61, 0x76, 0x65, 0x21];

function obfuscateSave(plainText) {
  const bytes = new TextEncoder().encode(plainText);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= SAVE_KEY[i % SAVE_KEY.length];
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return SAVE_PREFIX + btoa(bin);
}

function deobfuscateSave(text) {
  const t = (text || '').trim();
  if (!t.startsWith(SAVE_PREFIX)) return t;  // legacy plain JSON
  const bin = atob(t.slice(SAVE_PREFIX.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ SAVE_KEY[i % SAVE_KEY.length];
  return new TextDecoder().decode(bytes);
}

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

exportBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'exportProgress' }, (resp) => {
    if (!resp || !resp.ok) { setStatus('Backup failed~'); return; }
    const blob = new Blob([obfuscateSave(JSON.stringify(resp.progress))],
                          { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gachalexia-progress.alexia';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Progress saved~ 💾');
  });
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  const f = importFile.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const progress = JSON.parse(deobfuscateSave(reader.result));
      chrome.runtime.sendMessage({ action: 'importProgress', progress }, (resp) => {
        setStatus(resp && resp.ok ? 'Progress restored~ reopen the gacha ✨'
                                  : 'Restore failed~');
      });
    } catch (e) {
      setStatus('Invalid backup file~');
    }
  };
  reader.readAsText(f);
  importFile.value = '';  // allow re-picking the same file
});

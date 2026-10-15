let overlayLoaded = false;

/* ============ CARD SYSTEM — defs, preload, collection ============ */
let cardDefs = null;          // { id → { id, name, tier, url } } once decrypted
const CARD_TIER_NAMES = { 1: "bronze", 2: "silver", 4: "soul" };

function initCards() {
  decryptCards().then(map => {
    cardDefs = map;
    preloadCardImages(map);
    console.log(`cards: decrypted ${Object.keys(map).length} card(s)`);
  }).catch(e => console.warn("cards: decrypt failed", e));
}

// warm the browser cache so reveals paint instantly
function preloadCardImages(map) {
  Object.values(map).forEach(c => { const img = new Image(); img.src = c.url; });
}

/* ---- card draw flow ----
   chooseOneRandomItem picks the card up front (pendingCardDraw).
   During the pull, random cards (incl. the chosen one) ride the image spam.
   When the pull resolves, the chosen card is crowned on top, then floats
   away to the top of the screen. ---- */
let pendingCardDraw = null;    // card def chosen for the current pull
let currentPullCardIds = [];   // card ids allowed to appear in this pull's spam

// banner common pity: rides the existing pity cache (any key containing
// 'pullsSince' is mirrored from chrome.storage at startup). Every 10th
// common-tier card draw during a banner is guaranteed to be a banner card.
const BANNER_COMMON_KEY = 'alexia_pullsSinceBannerCommon';

// silver/soul flip-loss pity (user request): lose a flip → counter for that
// tier goes to 2 (guaranteed win on next flip); win (natural or forced)
// resets. Keyed 'alexia_pityBannerFlip<tier>' so export/import carries it.
function bannerFlipPityKey(tier) { return 'alexia_pityBannerFlip' + tier; }
const FLIP_PITY_THRESHOLD = 2; // pity triggers when counter reaches this

// returns true if the flip should be a forced win (and arms/resets the counter)
function bannerFlipPityForced(tier) {
  const key = bannerFlipPityKey(tier);
  const counter = pityCache[key] || 0;
  if (counter >= FLIP_PITY_THRESHOLD - 1) {
    pityCache[key] = 0;
    storageSet({ [key]: '0' });
    return true;
  }
  return false;
}
// record a flip LOSS — increments the per-tier counter; true = forced-win candidates on silver/soul picks
function bannerFlipLoss(tier) {
  const key = bannerFlipPityKey(tier);
  pityCache[key] = (pityCache[key] || 0) + 1;
  storageSet({ [key]: String(pityCache[key]) });
}

function rollCard(tier, _isReroll) {
  if (!cardDefs) return null;
  const mods = aggregateCourtMods();

  // Court: Team Rocket — small chance the whole draw ranks up a tier
  if (mods.tierUpgrade && tier < 4 && Math.random() < mods.tierUpgrade) {
    const upTier = tier === 1 ? 2 : 4;
    console.log(`Court: Team Rocket blasts the draw up to tier ${upTier}~`);
    teamRocketTaunt();
    return rollCard(upTier, true);
  }

  // Court: Bunny supremacy — the next soul reap is always Bunny takeover
  if (mods.forceReapCard && tier === 4 && cardDefs[mods.forceReapCard]) {
    return cardDefs[mods.forceReapCard];
  }

  const pool = Object.values(cardDefs).filter(c => c.tier === tier && !c.exclusive);
  // Court: Under Mina's Boot — a banner's exclusives join the standard pool
  if (mods.poolMerge && typeof BANNERS !== 'undefined') {
    const merged = BANNERS.find(b => b.id === mods.poolMerge);
    if (merged) merged.cardIds.forEach(id => {
      const c = cardDefs[id];
      if (c && c.tier === tier && !pool.includes(c)) pool.push(c);
    });
  }
  // banner rate-up: exclusive card of this tier vs the standard pool
  const banner = currentBanner();
  if (banner) {
    const rateUp = banner.cardIds.map(id => cardDefs[id]).filter(c => c && c.tier === tier);
    if (rateUp.length) {
      if (tier === 1 && !mods.bannerCommon5050) {
        // commons: 5-pull pity instead of a coin flip (Court: commonPityHaste lowers it)
        const threshold = Math.max(1, 4 - (mods.commonPityHaste || 0));
        const since = pityCache[BANNER_COMMON_KEY] || 0;
        // Court: Alexia's Throne — banner cards win every flip
        if (since >= threshold || mods.bannerGuarantee) {
          const pick = rateUp[Math.floor(Math.random() * rateUp.length)];
          pityCache[BANNER_COMMON_KEY] = 0;
          storageSet({ [BANNER_COMMON_KEY]: '0' });
          console.log(`banner common pity: ${pick.name} after ${since + 1} common draws`);
          return pick;
        }
        pityCache[BANNER_COMMON_KEY] = since + 1;
        storageSet({ [BANNER_COMMON_KEY]: String(since + 1) });
      } else if (mods.bannerGuarantee || bannerFlipPityForced(tier) || Math.random() < 0.5 + (mods.bannerLuck || 0) + (mods.bannerOdds || 0)) {
        // silver/soul: 50/50 (bannerLuck tilts, Armored pits → 75/25, Throne
        // guarantees); Adventurer Seduction moves commons to the flip too;
        // flip-loss pity forces a WIN on the tier that just lost.
        const pick = rateUp[Math.floor(Math.random() * rateUp.length)];
        console.log(`banner rate-up hit: ${pick.name} (${banner.name})`);
        return pick;
      }
      // flip lost (natural) → arm the pity for that tier
      if (tier !== 1) bannerFlipLoss(tier);
    }
  }
  if (!pool.length) return null;

  // Court: Tailjob — soul draws are always cards you don't own yet
  let candidates = pool;
  if (mods.forceNewSoul && tier === 4) {
    const fresh = pool.filter(c => !collectionCache[c.id]);
    if (fresh.length) candidates = fresh;
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  // Court: dupeReroll gives owned picks one re-roll (no chains)
  if (!_isReroll && mods.dupeReroll && collectionCache[pick.id] && Math.random() < mods.dupeReroll) {
    console.log(`Court: dupe ${pick.name} blasts off — re-rolling~`);
    return rollCard(tier, true);
  }
  return pick;
}

// banner exclusives only appear in spam while their banner is live or the
// user owns them (ownership = they earned the right to see it paraded)
function spamEligible(card) {
  if (!card.exclusive) return true;
  if (currentBanner()) return true;
  return !!collectionCache[card.id];
}

// build the spam parade: the chosen card + a few decoys (2–5)
function preparePullCardParade(chosen) {
  if (!cardDefs || !chosen) { currentPullCardIds = []; return; }
  const others = Object.values(cardDefs).filter(c => c.id !== chosen.id && spamEligible(c));
  const decoyCount = 2 + Math.floor(Math.random() * 4);
  const decoys = [];
  const pool = [...others];
  while (decoys.length < decoyCount && pool.length) {
    decoys.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  currentPullCardIds = [chosen.id, ...decoys.map(c => c.id)];
}

function pickSpamCard() {
  if (!currentPullCardIds.length || !cardDefs) return null;
  const id = currentPullCardIds[Math.floor(Math.random() * currentPullCardIds.length)];
  return cardDefs[id] || null;
}

// layer hierarchy:
//   2147483544 overlay · 2147483545 ambient ghosts · 2147483546 spam+wash
//   2147483547 crown / taunts / modals (untouchable top)
const SPAM_Z = "2147483546";

// variant from dupe count: 1-2 base, 3-8 shiny, 9+ prismatic
function cardVariant(count) {
  if (count >= 9) return 'prismatic';
  if (count >= 3) return 'shiny';
  return 'base';
}

function crownCard(card, { count = 1, isNew = false, destroyed = false } = {}) {
  if (!card) return;
  const variant = cardVariant(count || 1);
  const el = document.createElement('div');
  el.className = `card-crown snatch tier${card.tier} ${variant}`;
  el.style.setProperty('--art', `url('${card.url}')`);

  // spawn where a spam card would be — random spot, small, like the parade
  const startX = 15 + Math.random() * 60;   // vw
  const startY = 20 + Math.random() * 50;   // vh
  el.style.left = startX + 'vw';
  el.style.top = startY + 'vh';
  // whip toward the nearest horizontal edge
  el.style.setProperty('--whip-x', startX < 50 ? '-70vw' : '70vw');

  el.innerHTML = `
    <div class="crown-art">
      ${variant === 'prismatic' ? '<div class="ghost"></div>' : ''}
      <img src="${card.url}" alt="">
      ${variant !== 'base' ? '<div class="sheen"></div>' : ''}
      ${variant === 'prismatic' ? '<div class="sheen2"></div>' : ''}
      ${destroyed ? '<canvas class="pixCanvas"></canvas>' : ''}
      <div class="glare"></div>
    </div>
    <p class="crown-name">${card.name}</p>
    ${card.passive ? `<p class="crown-passive">⚔ ${card.passive.blurb}</p>` : card.unlock ? `<p class="crown-passive">🔓 ${card.unlock.blurb}</p>` : ''}
    ${card.exclusive ? '<p class="crown-tag limited">LIMITED</p>' : ''}
    ${destroyed
      ? '<p class="crown-tag destroyed">CARD DESTROYED</p>'
      : (isNew ? '<p class="crown-tag new">NEW!</p>' : (count > 1 ? `<p class="crown-tag dupe">DUPLICATE ×${count}</p>` : ''))}`;
  document.body.appendChild(el);

  // destroyed cards pixelate across the snatch reveal instead of whipping away
  if (destroyed) startPixelation(el);

  // spotlight steal: everything except the crown dims + desaturates
  document.documentElement.classList.add('card-spotlight');

  // bass drop on reveal
  sfxCardDrop();

  // beat 1: shockwave glow as it tears out of the parade (~250ms in)
  requestAnimationFrame(() => el.classList.add('snatch-glow'));
  // beat 2: swell to reveal size + shockwave ring
  setTimeout(() => el.classList.add('snatch-swell'), 300);
  if (destroyed) {
    // destroyed: big DESTROYED slam (rare-text logic: same helper as TEAM ROCKET~),
    // then red tag slams, spotlight drops, whip-away
    const word = spawnTauntWord('DESTROYED');
    word.style.color = '#e63946';
    word.style.textShadow = '0 0 26px rgba(230, 57, 70, 0.8)';
    word.style.fontSize = '8rem';
    word.style.left = '50vw';
    word.style.top = '35vh';
    fadeAndRemoveWord(word, 1900);
    setTimeout(() => {
      el.querySelector('.crown-tag.destroyed')?.classList.add('slam');
    }, 1700);
    setTimeout(() => {
      document.documentElement.classList.remove('card-spotlight');
      el.classList.add('snatch-whip');
      setTimeout(() => el.remove(), 600);
    }, 2600);
  } else {
    // normal: whip off-screen with motion blur (after 1.5s spotlight hold)
    setTimeout(() => {
      document.documentElement.classList.remove('card-spotlight');
      el.classList.add('snatch-whip');
      setTimeout(() => el.remove(), 600);
    }, 300 + 1500);
  }
}

// Progressive pixelation over ~2.2s (drawImage-only → cross-origin art is safe)
function startPixelation(el) {
  const img = el.querySelector('img');
  const canvas = el.querySelector('.pixCanvas');
  const art = el.querySelector('.crown-art');
  if (!img || !canvas || !art) return;
  const off = document.createElement('canvas');
  const PIX_STEPS = [2, 3, 4, 6, 9, 14, 20, 30, 44];
  const startT = performance.now();
  function drawPix(px) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    const sw = Math.max(1, Math.round(w / px));
    const sh = Math.max(1, Math.round(h / px));
    off.width = sw; off.height = sh;
    off.getContext('2d').drawImage(img, 0, 0, sw, sh);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, w, h);
  }
  function pixTick(now) {
    if (!el.isConnected) return;
    const prog = Math.min(1, (now - startT) / 2200);
    const px = PIX_STEPS[Math.min(PIX_STEPS.length - 1, Math.floor(prog * PIX_STEPS.length))];
    drawPix(px);
    if (prog < 1) requestAnimationFrame(pixTick);
  }
  function startPix() {
    canvas.width = art.clientWidth;
    canvas.height = art.clientHeight;
    canvas.style.opacity = '1';
    requestAnimationFrame(pixTick);
  }
  if (img.complete && img.naturalWidth) startPix();
  else img.addEventListener('load', startPix, { once: true });
}

// called when a pull resolves — award + crown the pending card
function resolveCardDraw() {
  if (!pendingCardDraw) return;
  const card = pendingCardDraw;
  pendingCardDraw = null;
  currentPullCardIds = [];
  // Court: Censored — small chance the pulled card is destroyed outright
  // (simForceDestroy lets the 🧨 Sim Destroy button force this branch).
  // Renders like a normal crown (spotlight + swell + sound), then pixelates
  // and is NOT added to the collection.
  const mods = aggregateCourtMods();
  const destroyRoll = simForceDestroy || (mods.cardDestroy && Math.random() < mods.cardDestroy);
  simForceDestroy = false;
  if (destroyRoll) {
    crownCard(card, { destroyed: true });
    return;
  }
  addCard(card.id).then(({ count, isNew }) => crownCard(card, { count, isNew }));
}

// Court: Censored — destroyed pulls render via crownCard (normal snatch
// reveal) with the pixelation canvas + red 'CARD DESTROYED' tag instead of
// 'NEW!' / 'DUPLICATE'. They never touch the collection.
// startPixelation() is the renderer.

/* ===================== COLLECTION VIEW ===================== */

function switchView(name) {
  const views = { main: 'view-main', collection: 'view-collection', court: 'view-court', themes: 'view-themes' };
  for (const key in views) {
    const el = document.getElementById(views[key]);
    if (el) el.style.display = key === name ? 'flex' : 'none';
  }
  document.querySelectorAll('.navTab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  // banner panel lives on document.body — it only belongs to the Pulls tab
  const spot = document.getElementById('bannerSpot');
  if (spot && spot.innerHTML) spot.style.display = name === 'main' ? '' : 'none';
  if (name === 'collection') renderCollection();
  if (name === 'court') renderCourt();
  if (name === 'themes') renderThemes();
}

function wireNavTabs() {
  document.querySelectorAll('.navTab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  const coll = document.getElementById('view-collection');
  if (coll) coll.style.display = 'none';
  const court = document.getElementById('view-court');
  if (court) court.style.display = 'none';
  const themes = document.getElementById('view-themes');
  if (themes) themes.style.display = 'none';
}

/* ===================== COURT VIEW ===================== */

// plain-language summary of the active build ("+2% rare rate · reap pity 72")
function courtSummaryText() {
  const mods = aggregateCourtMods();
  const parts = [];
  if (mods.newXPBoost) parts.push(`+${Math.round(mods.newXPBoost * 100)}% new-card XP`);
  if (mods.rareRateUp) parts.push(`+${Math.round(mods.rareRateUp * 100)}% rare rate`);
  if (mods.reapRateUp) parts.push(`+${Math.round(mods.reapRateUp * 100)}% reap rate`);
  if (mods.reapPityHaste) parts.push(`reap pity ${Math.floor(79 * (1 - mods.reapPityHaste)) + 1}`);
  if (mods.halfPity) parts.push('both pity tracks halved');
  if (mods.commonPityHaste) parts.push(`banner common pity ${10 - mods.commonPityHaste}`);
  if (mods.dupeXPBoost) parts.push(`+${Math.round(mods.dupeXPBoost * 100)}% dupe XP`);
  if (mods.dupeReroll) parts.push(`${Math.round(mods.dupeReroll * 100)}% dupe re-roll`);
  if (mods.tierUpgrade) parts.push(`${Math.round(mods.tierUpgrade * 100)}% tier-up chance`);
  if (mods.bannerLuck) parts.push(`+${Math.round(mods.bannerLuck * 100)}% banner luck`);
  if (mods.bannerGuarantee) parts.push('banner cards guaranteed');
  if (mods.freePullEvery) parts.push(`every ${Math.round(mods.freePullEvery)}th pull free`);
  if (mods.freePullChance) parts.push(`${Math.round(mods.freePullChance * 100)}% free-pull chance`);
  if (mods.sundayBoost) parts.push(new Date().getDay() === 0 ? '☀ sunday worship: rates doubled' : 'sunday worship (inactive today)');
  if (mods.removeCommons) parts.push('common pool filtered');
  if (mods.removeItems) parts.push('commons removed');
  if (mods.removeRare) parts.push('rare pool filtered');
  if (mods.forceRareItem) parts.push('rares always cute meal~');
  if (mods.forceReapCard) parts.push('next reap: Bunny takeover');
  if (mods.forceNewSoul) parts.push('souls always new');
  if (mods.sessionLedger) parts.push('$ ledger live');
  if (mods.poolMerge) parts.push('Mina cards in the pool');
  if (mods.cardDestroy) parts.push(`${Math.round(mods.cardDestroy * 100)}% card destruction`);
  if (mods.pityExtend) parts.push(`reap pity ${mods.pityExtend}`);
  if (mods.bannerCommon5050) parts.push('banner bronzes 50/50');
  if (mods.bannerOdds) parts.push(`banner odds ${Math.round((0.5 + mods.bannerOdds + (mods.bannerLuck || 0)) * 100)}%`);
  if (mods.sentenceSpam) parts.push('sentence spam');
  return parts.length ? parts.join(' · ') : 'no passives active — equip a card~';
}

function renderCourt() {
  const slotsEl = document.getElementById('courtSlots');
  const summaryEl = document.getElementById('courtSummary');
  if (!slotsEl) return;
  if (!cardDefs) { setTimeout(renderCourt, 500); return; }  // decrypt in flight
  const level = courtLevel();
  const slots = courtSlots(level);
  slotsEl.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const div = document.createElement('div');
    div.className = 'courtSlot';
    if (i >= slots) {
      div.classList.add('locked');
      div.innerHTML = `<p class="courtLock">🔒</p><p class="courtLockLv">Lv ${i === 1 ? 5 : 10}</p>`;
    } else {
      const id = courtCache.equipped[i];
      const def = id && cardDefs ? cardDefs[id] : null;
      if (def && def.passive) {
        const mult = def.passive.static ? 1 : dupeBuffMult(collectionCache[id] || 0);
        div.classList.add('filled');
        div.innerHTML = `
          <img src="${def.url}" alt="${def.name}">
          <p class="courtSlotName">${def.name}</p>
          <p class="courtSlotPassive">${def.passive.blurb}${mult > 1 ? ` <b>×${mult}</b>` : ''}</p>`;
        div.title = 'tap to unequip';
        div.addEventListener('click', () => { unequipCard(i); renderCourt(); renderCourtStrip(); updateOverlayPity(); });
      } else {
        // stale equip (card lost its passive, e.g. became unlock-only) — clear it
        if (id) { courtCache.equipped[i] = null; saveCourt(); }
        div.classList.add('empty');
        div.innerHTML = `<p class="courtPlus">+</p><p class="courtEmptyTxt">equip</p>`;
        div.addEventListener('click', () => showCourtPicker(i));
      }
    }
    slotsEl.appendChild(div);
  }
  if (summaryEl) summaryEl.textContent = courtSummaryText();
}

// picker modal: owned cards with their passive blurbs, tap to equip
function showCourtPicker(slot) {
  const owned = Object.keys(collectionCache)
    .map(id => cardDefs && cardDefs[id])
    .filter(d => d && d.passive)
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  const modal = document.createElement('div');
  modal.id = 'courtModal';
  modal.innerHTML = `
    <div class="courtModalCard">
      <h2>✦ Choose your champion ✦</h2>
      <div class="courtPickGrid">
        ${owned.length ? owned.map(d => {
          const mult = d.passive.static ? 1 : dupeBuffMult(collectionCache[d.id] || 0);
          const elsewhere = courtCache.equipped.includes(d.id);
          const foe = d.passive.conflictsWith;
          const blocked = foe && courtCache.equipped.includes(foe);
          return `<div class="courtPick${elsewhere ? ' equipped-elsewhere' : ''}${blocked ? ' blocked' : ''}" data-id="${d.id}">
            <img src="${d.url}" alt="${d.name}">
            <p class="courtPickName">${d.name} ×${collectionCache[d.id]}</p>
            <p class="courtPickPassive">${d.passive.blurb}${mult > 1 ? ` <b>×${mult}</b>` : ''}</p>
            ${blocked ? `<p class="courtPickNote">refuses: ${(cardDefs[foe] || {}).name || foe}</p>` : elsewhere ? '<p class="courtPickNote">moves here</p>' : ''}
          </div>`;
        }).join('') : '<p class="courtNone">no cards with passives yet~</p>'}
      </div>
      <p class="ratesClose">Tap anywhere to close~</p>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  modal.addEventListener('click', (e) => {
    const pick = e.target.closest('.courtPick');
    if (pick && !pick.classList.contains('blocked')) {
      if (equipCard(slot, pick.dataset.id) !== false) {
        modal.remove();
        renderCourt();
        renderCourtStrip();
        updateOverlayPity();  // thresholds may have changed (Schlllrp etc.)
      }
    } else if (!e.target.closest('.courtModalCard')) {
      modal.remove();
    }
  });
}

// Pulls-view mini strip: equipped thumbnails, tap → Court tab
function renderCourtStrip() {
  const strip = document.getElementById('courtStrip');
  if (!strip) return;
  const slots = courtSlots(courtLevel());
  const eq = (courtCache.equipped || []).slice(0, slots).filter(Boolean);
  strip.innerHTML = eq.map(id => {
    const def = cardDefs && cardDefs[id];
    return def ? `<img src="${def.url}" alt="${def.name}" title="${def.name}">` : '';
  }).join('');
  strip.style.display = eq.length ? '' : 'none';
  strip.onclick = () => switchView('court');
}

function renderCollection() {
  const grid = document.getElementById('collectionGrid');
  const progress = document.getElementById('collectionProgress');
  if (!grid) return;
  if (!cardDefs) {  // decrypt still in flight — retry shortly
    progress.textContent = 'summoning cards~';
    setTimeout(renderCollection, 500);
    return;
  }

  getCollection().then(data => {
    const owned = data.cards;
    const defs = Object.values(cardDefs).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
    const ownedCount = defs.filter(c => owned[c.id]).length;
    progress.textContent = `${ownedCount} / ${defs.length} collected`;

    const tierLabels = { 1: 'Bronze', 2: 'Silver', 4: 'Soul' };
    let html = '';
    let lastTier = null;
    defs.forEach(c => {
      if (c.tier !== lastTier) {
        if (lastTier !== null) html += '</div>';
        html += `<p class="collTier tier${c.tier}">${tierLabels[c.tier]}</p><div class="collRow">`;
        lastTier = c.tier;
      }
      const count = owned[c.id] || 0;
      if (count > 0) {
        const variant = cardVariant(count);
        html += `<div class="collCard owned tier${c.tier} ${variant}" data-card="${c.id}" style="--art: url('${c.url}')">
          <div class="collArt">
            ${variant === 'prismatic' ? '<div class="ghost"></div>' : ''}
            <img src="${c.url}" alt="">
            ${variant !== 'base' ? '<div class="sheen"></div>' : ''}
            ${variant === 'prismatic' ? '<div class="sheen2"></div>' : ''}
          </div>
          <p>${c.name}</p>
          ${c.exclusive ? '<span class="collLimited">LIMITED</span>' : ''}
          ${courtCache.equipped.includes(c.id) ? '<span class="collEquipped">⚔</span>' : ''}
          ${count > 1 ? `<span class="collCount">×${count}</span>` : ''}
        </div>`;
      } else {
        html += `<div class="collCard unowned tier${c.tier}">
          <div class="collBack">?</div><p>???${c.exclusive ? ' · limited' : ''}</p>
        </div>`;
      }
    });
    if (lastTier !== null) html += '</div>';
    grid.innerHTML = html;

    // lightbox on owned cards
    grid.querySelectorAll('.collCard.owned').forEach(el => {
      el.addEventListener('click', () => showCardLightbox(el.dataset.card, owned[el.dataset.card]));
    });
  });
}

function showCardLightbox(cardId, count) {
  const card = cardDefs[cardId];
  if (!card) return;
  const variant = cardVariant(count || 1);
  const lb = document.createElement('div');
  lb.id = 'cardLightbox';
  lb.innerHTML = `
    <div class="card lbCard tier${card.tier} ${variant}" data-tilt style="--art: url('${card.url}')">
      ${variant === 'prismatic' ? '<div class="ghost"></div>' : ''}
      <img src="${card.url}" alt="">
      ${variant !== 'base' ? '<div class="sheen"></div>' : ''}
      ${variant === 'prismatic' ? '<div class="sheen2"></div>' : ''}
      <div class="glare"></div>
    </div>
    <p class="lbName">${card.name}</p>
    <p class="lbMeta">${CARD_TIER_NAMES[card.tier]}${card.exclusive ? ' · LIMITED' : ''}${count > 1 ? ` · ×${count}` : ''}${variant !== 'base' ? ` · ${variant}` : ''}</p>
    ${card.passive ? `<p class="lbPassive">⚔ ${card.passive.blurb}</p>` : card.unlock ? `<p class="lbPassive">🔓 ${card.unlock.blurb}</p>` : ''}
    <button class="lbZoomBtn" type="button">⤢ full view</button>
    <p class="ratesClose">Tap anywhere to close~</p>`;
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add('open'));
  lb.addEventListener('click', () => lb.remove());
  wireCardTilt(lb.querySelector('[data-tilt]'));

  // full-view toggle: card grows to nearly fill the screen; tilt is
  // suspended while zoomed (the transform would fight the size transition)
  const zoomBtn = lb.querySelector('.lbZoomBtn');
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const zoomed = lb.classList.toggle('zoomed');
    zoomBtn.textContent = zoomed ? '⤡ back' : '⤢ full view';
    if (zoomed) {
      const c = lb.querySelector('[data-tilt]');
      if (c) c.style.transform = '';
    }
  });
}

// 3D tilt + glare tracking (from card-demo)
function wireCardTilt(card) {
  if (!card) return;
  const MAX_TILT = 14;
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.transform =
      `perspective(800px) rotateX(${(0.5 - py) * 2 * MAX_TILT}deg) rotateY(${(px - 0.5) * 2 * MAX_TILT}deg) scale(1.04)`;
    card.style.setProperty('--glare-x', `${px * 100}%`);
    card.style.setProperty('--glare-y', `${py * 100}%`);
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) scale(1)';
  });
}

/* ---- collection storage (chrome.storage.local) ---- */
const COLLECTION_KEY = 'alexia_cardCollection';

function getCollection() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(COLLECTION_KEY, res => {
        const data = res[COLLECTION_KEY];
        resolve(data && data.collectionVersion === 1 ? data : { collectionVersion: 1, cards: {}, stats: { totalEarned: 0 } });
      });
    } catch (e) {
      resolve({ collectionVersion: 1, cards: {}, stats: { totalEarned: 0 } });
    }
  });
}

// award a card: increments count + stats, returns { count, isNew }
function addCard(cardId) {
  return getCollection().then(data => {
    const isNew = !data.cards[cardId];
    data.cards[cardId] = (data.cards[cardId] || 0) + 1;
    data.stats.totalEarned++;
    collectionCache = data.cards;  // keep the sync mirror hot for spam filtering
    checkUnlocks();

    // Court XP boosts — FORWARD-ONLY: the bonus from this award goes into a
    // running accumulator; equipping/unequipping never reprices the past
    const def = cardDefs && cardDefs[cardId];
    if (def) {
      const mods = aggregateCourtMods();
      const tierMult = DEVOTION_TIER_MULT[def.tier] || 1;
      const base = (isNew ? DEVOTION_XP.new : DEVOTION_XP.dupe) * tierMult;
      const boost = isNew ? (mods.newXPBoost || 0) : (mods.dupeXPBoost || 0);
      if (boost > 0) {
        loadDevotionState().then(stored => {
          const bonusXP = (stored.bonusXP || 0) + Math.round(base * boost);
          saveDevotionState({ ...stored, bonusXP });
        });
      }
    }

    return new Promise(resolve => {
      try {
        chrome.storage.local.set({ [COLLECTION_KEY]: data }, () => resolve({ count: data.cards[cardId], isNew }));
      } catch (e) {
        resolve({ count: data.cards[cardId], isNew });
      }
    });
  });
}

/* ===================== DEVOTION SHARDS (currency) =====================
 * Earned: +30 on daily login (first overlay open of each local day).
 *         (+ level-up rewards — amounts TBD, wired via awardShards().)
 * Spent:  150 buys one free pull (sim-style, no Throne interaction).
 * Persisted in chrome.storage.local; mirrored to shardCache for sync reads.
 */
const SHARD_KEY = 'alexia_devotionShards';
const SHARD_DAILY_KEY = 'alexia_lastShardClaim';
const SHARD_DAILY_AMOUNT = 30;
const SHARD_PULL_COST = 150;
let shardCache = 0;

function loadShards() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(SHARD_KEY, res => resolve(parseInt(res[SHARD_KEY]) || 0));
    } catch (e) { resolve(0); }
  });
}

function saveShards(n) {
  shardCache = n;
  storageSet({ [SHARD_KEY]: String(n) });
  updateShardUI();
}

// add (or subtract, negative) shards and refresh the tracker
function awardShards(n) { saveShards(Math.max(0, shardCache + n)); }

function updateShardUI() {
  const el = document.getElementById('shardCount');
  if (el) el.textContent = shardCache;
  const btn = document.getElementById('shardPull');
  if (btn) btn.classList.toggle('cantAfford', shardCache < SHARD_PULL_COST);
}

// daily login: first overlay open of a new local day grants the stipend
function claimDailyShards() {
  try {
    chrome.storage.local.get(SHARD_DAILY_KEY, res => {
      const today = new Date().toDateString();
      if (res[SHARD_DAILY_KEY] === today) return;  // already claimed today
      storageSet({ [SHARD_DAILY_KEY]: today });
      awardShards(SHARD_DAILY_AMOUNT);
      console.log(`💠 daily login: +${SHARD_DAILY_AMOUNT} Devotion Shards (${shardCache} total)`);
      shardClaimToast(SHARD_DAILY_AMOUNT);
    });
  } catch (e) {}
}

// little celebratory toast when the daily stipend lands
function shardClaimToast(amount) {
  const t = document.createElement('div');
  t.id = 'shardToast';
  t.innerHTML = `<p>💠 +${amount} Devotion Shards</p><p class="shardToastSub">daily tribute accepted~</p>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('open'));
  setTimeout(() => { t.classList.remove('open'); setTimeout(() => t.remove(), 500); }, 2600);
}

function initShards() {
  loadShards().then(n => { shardCache = n; updateShardUI(); claimDailyShards(); });
}

// spend 150 shards on one free pull — runs sim-style (no Throne interaction)
function shardBuyPull() {
  if (shardCache < SHARD_PULL_COST) {
    console.log(`💠 not enough shards (${shardCache}/${SHARD_PULL_COST})`);
    return;
  }
  saveShards(shardCache - SHARD_PULL_COST);
  console.log(`💠 spent ${SHARD_PULL_COST} shards on a free pull (${shardCache} left)`);
  pendingShardFreePull = true;   // recordPull flags it → shows "Free Pull", no item
  simulatePulls(1);
}

/* ===================== UNLOCK KEYS =====================
 * Cards can carry an `unlock` tag (data-only, like `passive`):
 *   unlock: { id: "hardMode", blurb: "Unlocks Hard Mode" }
 * First ownership records the unlock permanently in alexia_unlocks —
 * burning/losing dupes later never revokes it. The features behind each
 * unlock id are built separately; this is just the detection + record.
 */
const UNLOCKS_KEY = 'alexia_unlocks';

function checkUnlocks() {
  if (!cardDefs) return;
  let changed = false;
  for (const id in collectionCache) {
    const def = cardDefs[id];
    if (def && def.unlock && !unlocksCache[def.unlock.id]) {
      unlocksCache[def.unlock.id] = { cardId: id, ts: Date.now() };
      changed = true;
      console.log(`unlock earned: ${def.unlock.id} (via ${def.name})`);
    }
  }
  if (changed) storageSet({ [UNLOCKS_KEY]: JSON.stringify(unlocksCache) });
}

function hasUnlock(id) { return !!unlocksCache[id]; }

/* ===================== OVERLAY SKINS ===================== */
/* Cosmetic themes gated on collection progress. Unlock checks run on the
   owned-cards map; the chosen skin persists in chrome.storage.local and
   self-heals back to default if the unlock is ever lost.               */

const SKINS = {
  default: { id: 'default', label: 'Plum',       cls: '', hint: 'the classic~ always yours' },
  crimson: { id: 'crimson', label: 'Crimson Haze', cls: 'skin-crimson', hint: 'own a soul card',
             unlocked: owned => Object.keys(owned).some(id => cardDefs[id] && cardDefs[id].tier === 4) },
  moonlit: { id: 'moonlit', label: 'Moonlit',    cls: 'skin-moonlit', hint: 'collect all 3 bronze cards',
             unlocked: owned => Object.keys(owned).filter(id => cardDefs[id] && cardDefs[id].tier === 1).length >= 3 },
  golden:  { id: 'golden',  label: 'Golden Hour', cls: 'skin-golden', hint: 'reach Devotion Lv 5',
             unlocked: owned => devotionLevelFromXP(devotionComputeXP(owned)) >= 5 },
  void:    { id: 'void',    label: 'Void',        cls: 'skin-void', hint: 'own 10 total cards (dupes count)',
             unlocked: owned => Object.values(owned).reduce((s, n) => s + n, 0) >= 10 },
  sakura:  { id: 'sakura',  label: 'Sakura',      cls: 'skin-sakura', hint: 'own a duplicate card (×2)',
             unlocked: owned => Object.values(owned).some(n => n >= 2) },
  silver:  { id: 'silver',  label: 'Silver',      cls: 'skin-silver', hint: 'own 5 distinct cards',
             unlocked: owned => Object.keys(owned).filter(id => cardDefs[id]).length >= 5 },
  ember:   { id: 'ember',   label: 'Ember',       cls: 'skin-ember', hint: 'own a soul card + reach Devotion Lv 5',
             unlocked: owned => Object.keys(owned).some(id => cardDefs[id] && cardDefs[id].tier === 4)
                              && devotionLevelFromXP(devotionComputeXP(owned)) >= 5 },
  reaper:  { id: 'reaper',  label: "Reaper's Crown", cls: 'skin-reaper', hint: 'own 3 soul cards',
             unlocked: owned => Object.keys(owned).filter(id => cardDefs[id] && cardDefs[id].tier === 4)
                                   .reduce((s, id) => s + owned[id], 0) >= 3 },
};
const SKIN_KEY = 'alexia_overlaySkin';

function loadSkinChoice() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(SKIN_KEY, res => resolve(res[SKIN_KEY] || 'default'));
    } catch (e) {
      resolve('default');
    }
  });
}

function saveSkinChoice(id) {
  try { chrome.storage.local.set({ [SKIN_KEY]: id }); } catch (e) {}
}

function applySkin(id) {
  const body = document.querySelector('.overlayBody');
  if (!body) return;
  Object.values(SKINS).forEach(s => { if (s.cls) body.classList.remove(s.cls); });
  const skin = SKINS[id] || SKINS.default;
  if (skin.cls) body.classList.add(skin.cls);
  // banner panel lives on body — re-render to pick up the new skin class
  if (document.getElementById('bannerSpot')) renderBannerSpot();
}

// apply saved skin (validated against the collection)
function initSkins() {
  if (!cardDefs) { setTimeout(initSkins, 500); return; }  // decrypt in flight
  Promise.all([getCollection(), loadSkinChoice()]).then(([data, savedId]) => {
    const owned = data.cards;
    const skin = SKINS[savedId];
    const valid = skin && (!skin.unlocked || skin.unlocked(owned));
    applySkin(valid ? savedId : 'default');
    if (!valid) saveSkinChoice('default');  // unlock lost — fall back
  });
}

/* ---- themes view: every skin, its unlock condition, tap-to-apply ---- */
function renderThemes() {
  const list = document.getElementById('themesList');
  const progress = document.getElementById('themesProgress');
  if (!list) return;
  if (!cardDefs) {
    progress.textContent = 'summoning themes~';
    setTimeout(renderThemes, 500);
    return;
  }
  Promise.all([getCollection(), loadSkinChoice()]).then(([data, activeId]) => {
    const owned = data.cards;
    const skins = Object.values(SKINS);
    const unlockedCount = skins.filter(s => !s.unlocked || s.unlocked(owned)).length;
    progress.textContent = `${unlockedCount} / ${skins.length} unlocked`;

    list.innerHTML = skins.map(s => {
      const isUnlocked = !s.unlocked || s.unlocked(owned);
      const isActive = s.id === activeId;
      return `<div class="themeRow ${isUnlocked ? 'unlocked' : 'locked'}${isActive ? ' active' : ''}" data-skin="${s.id}">
        <div class="themeSwatch ${s.cls || 'swatch-default'}"></div>
        <div class="themeInfo">
          <p class="themeName">${s.label}${isActive ? ' ✦' : ''}</p>
          <p class="themeHint">${isUnlocked ? (isActive ? 'active~' : 'tap to apply~') : '🔒 ' + s.hint}</p>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.themeRow.unlocked').forEach(row => {
      row.addEventListener('click', () => {
        applySkin(row.dataset.skin);
        saveSkinChoice(row.dataset.skin);
        sparkleBurst(20);
        renderThemes();  // re-render so the ✦ active marker moves
      });
    });
  });
}

/* ===================== DEVOTION LEVEL ===================== */
/* Every card feeds one global XP bar. XP is recomputed from the collection
   on load (self-healing if storage is edited); the stored value only
   remembers the last-known level so level-ups can be celebrated once.

   XP: new card = 100 × tierMult, duplicate = 20 × tierMult
   tier multipliers: bronze 1×, silver 3×, soul 10×
   curve: xpForLevel(n) = 100 · n^1.6  (level 1 starts at 0)              */

const DEVOTION_KEY = 'alexia_devotionXP';
const DEVOTION_XP = { new: 100, dupe: 20 };
const DEVOTION_TIER_MULT = { 1: 1, 2: 3, 4: 10 };

function xpForLevel(n) { return Math.floor(100 * Math.pow(n, 1.6)); }

function devotionComputeXP(cards) {
  if (!cardDefs) return 0;
  // BASE XP only — Court XP boosts are forward-only, credited at award time
  // into the bonusXP accumulator (see addCard), never retroactive
  let xp = 0;
  for (const id in cards) {
    const def = cardDefs[id];
    if (!def) continue;  // stale id from an old card set — ignore
    const n = cards[id];
    const mult = DEVOTION_TIER_MULT[def.tier] || 1;
    xp += DEVOTION_XP.new * mult + (n - 1) * DEVOTION_XP.dupe * mult;
  }
  return xp;
}

function devotionLevelFromXP(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

function loadDevotionState() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(DEVOTION_KEY, res => {
        const d = res[DEVOTION_KEY];
        resolve(d && typeof d.xp === 'number' ? d : { xp: 0, level: 1 });
      });
    } catch (e) {
      resolve({ xp: 0, level: 1 });
    }
  });
}

function saveDevotionState(state) {
  try { chrome.storage.local.set({ [DEVOTION_KEY]: state }); } catch (e) {}
}

function updateDevotionUI(xp, level) {
  const lvlEl = document.getElementById('devotionLevel');
  const bar = document.getElementById('devotionFill');
  const next = document.getElementById('devotionNext');
  if (!lvlEl || !bar || !next) return;
  const floor = xpForLevel(level);
  const span = xpForLevel(level + 1) - floor;
  lvlEl.textContent = 'Lv ' + level;
  bar.max = span;
  bar.value = Math.min(span, Math.max(0, xp - floor));
  next.textContent = `${xp - floor}/${span} EXP`;
}

// full recompute from the collection; celebrates if the level went up
function refreshDevotion() {
  if (!cardDefs) return;  // decrypt still in flight — initDevotion will retry
  Promise.all([getCollection(), loadDevotionState()]).then(([data, stored]) => {
    // total = base (collection recompute) + forward-only Court bonus
    const xp = Math.round(devotionComputeXP(data.cards)) + (stored.bonusXP || 0);
    const level = devotionLevelFromXP(xp);
    updateDevotionUI(xp, level);
    if (level > stored.level) {
      celebrateLevelUp(stored.level + 1, level);  // one banner per level gained
    }
    saveDevotionState({ xp, level, bonusXP: stored.bonusXP || 0 });
  });
}

function initDevotion() {
  if (cardDefs) { refreshDevotion(); return; }
  // card decrypt still in flight — retry shortly
  setTimeout(initDevotion, 500);
}

/* ===================== LEVEL REWARDS =====================
 * Clicking the devotion bar opens a scrollable list — one row per level.
 * Reaching a level arms its reward; clicking the reward claims it (shards).
 * Claims persist in alexia_levelRewards so each level pays out exactly once.
 * Table: Lv2-3 150 · Lv4 200 · Lv5 250 · Lv6 300 · Lv7-10 350 · Lv11+ 400.
 */
const LEVEL_REWARDS_KEY = 'alexia_levelRewards';
let levelRewardsCache = {};   // { "2": true, "3": true, ... } claimed levels

function levelRewardAmount(level) {
  if (level < 2) return 0;          // Lv 1 is the starting point — no reward
  if (level <= 3) return 150;
  if (level === 4) return 200;
  if (level === 5) return 250;
  if (level === 6) return 300;
  if (level <= 10) return 350;
  return 400;
}

function loadLevelRewards() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(LEVEL_REWARDS_KEY, res => {
        try { resolve(JSON.parse(res[LEVEL_REWARDS_KEY]) || {}); } catch (e) { resolve({}); }
      });
    } catch (e) { resolve({}); }
  });
}

function saveLevelRewards() {
  storageSet({ [LEVEL_REWARDS_KEY]: JSON.stringify(levelRewardsCache) });
}

// open the rewards modal — rows from Lv 2 up to (current level + 5 preview)
function showLevelRewards() {
  Promise.all([loadDevotionState(), loadLevelRewards()]).then(([stored, claimed]) => {
    levelRewardsCache = claimed;
    const xp = Math.round(devotionComputeXP(collectionCache)) + (stored.bonusXP || 0);
    const curLevel = devotionLevelFromXP(xp);
    const maxShown = Math.max(10, curLevel + 5);

    let rows = '';
    for (let lv = 2; lv <= maxShown; lv++) {
      const amount = levelRewardAmount(lv);
      const reached = curLevel >= lv;
      const isClaimed = !!claimed[lv];
      const state = isClaimed ? 'claimed' : reached ? 'ready' : 'locked';
      const label = isClaimed ? 'claimed ✓' : reached ? `claim 💠${amount}` : `💠${amount}`;
      rows += `<div class="lrRow ${state}">
        <p class="lrLevel">Lv ${lv}</p>
        <button class="lrClaim" data-lv="${lv}" data-amount="${amount}" ${state !== 'ready' ? 'disabled' : ''}>${label}</button>
      </div>`;
    }

    const modal = document.createElement('div');
    modal.id = 'levelRewardsModal';
    modal.innerHTML = `
      <div class="lrCard">
        <h2>✦ Devotion Rewards ✦</h2>
        <p class="lrSub">Level ${curLevel} · claim each milestone once~</p>
        <div class="lrScroll">${rows}</div>
        <p class="ratesClose">Tap anywhere to close~</p>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('.lrClaim');
      if (btn && !btn.disabled) {
        claimLevelReward(parseInt(btn.dataset.lv), parseInt(btn.dataset.amount), btn);
      } else if (!e.target.closest('.lrCard')) {
        modal.remove();
      }
    });
  });
}

function claimLevelReward(level, amount, btn) {
  if (levelRewardsCache[level]) return;  // already claimed
  levelRewardsCache[level] = true;
  saveLevelRewards();
  awardShards(amount);
  console.log(`✦ level ${level} reward claimed: +${amount} 💠 (${shardCache} total)`);
  btn.disabled = true;
  btn.textContent = 'claimed ✓';
  btn.closest('.lrRow').classList.remove('ready');
  btn.closest('.lrRow').classList.add('claimed');
  sparkleBurst(20);
}

function initLevelRewards() {
  loadLevelRewards().then(c => { levelRewardsCache = c; });
  const bar = document.getElementById('devotionBar');
  if (bar) {
    bar.style.cursor = 'pointer';
    bar.title = 'Devotion rewards~';
    bar.addEventListener('click', (e) => { e.stopPropagation(); showLevelRewards(); });
  }
}

/* ===================== BANNER UI ===================== */
let bannerCountdownTimer = null;

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function renderBannerSpot() {
  const spot = document.getElementById('bannerSpot');
  if (!spot) return;
  // escape the overlay stacking context: store-page ghosts sit at global
  // z 2147483545 (above the overlay's ...644) and would swallow panel clicks
  if (spot.parentElement !== document.body) document.body.appendChild(spot);
  // mirror the active skin onto the panel so the per-skin CSS vars cascade
  const overlay = document.querySelector('.overlayBody');
  spot.className = '';
  if (overlay) Object.values(SKINS).forEach(s => {
    if (s.cls && overlay.classList.contains(s.cls)) spot.classList.add(s.cls);
  });
  const banner = currentBanner();
  if (!banner) { spot.style.display = 'none'; spot.innerHTML = ''; return; }

  const cards = banner.cardIds.map(id => cardDefs && cardDefs[id]).filter(Boolean);
  // highest tier headlines the banner, regardless of cardIds order
  const featured = cards.reduce((best, c) => (!best || c.tier > best.tier ? c : best), null);
  const sidekicks = cards.filter(c => c !== featured);
  // always render — the welcome gate floats above and blurs it; the Pulls-tab
  // gate lives in switchView()
  spot.style.display = '';
  spot.innerHTML = `
    <p class="bannerLabel">✦ Limited ✦</p>
    ${featured ? `<div class="bannerArt"><img src="${featured.url}" alt="${featured.name}"></div>` : ''}
    ${sidekicks.length ? `<div class="bannerArtRow">${sidekicks.map(c =>
      `<img src="${c.url}" alt="${c.name}" title="${c.name}">`).join('')}</div>` : ''}
    <p class="bannerName">${(cards.find(c => c.tier === 4) || featured || {}).name || banner.name}</p>
    <p class="bannerCountdown">ends in <span id="bannerCountdownText">${fmtCountdown(Date.parse(banner.endsAt) - Date.now())}</span></p>
    <p class="bannerHint">tap for details~</p>`;
  spot.onclick = (e) => { e.stopPropagation(); showBannerModal(banner); };

  if (bannerCountdownTimer) clearInterval(bannerCountdownTimer);
  bannerCountdownTimer = setInterval(() => {
    const el = document.getElementById('bannerCountdownText');
    if (!el) { clearInterval(bannerCountdownTimer); bannerCountdownTimer = null; return; }
    const left = Date.parse(banner.endsAt) - Date.now();
    if (left <= 0) {  // expired — tear the whole thing down
      clearInterval(bannerCountdownTimer); bannerCountdownTimer = null;
      renderBannerSpot();
      return;
    }
    el.textContent = fmtCountdown(left);
  }, 1000);
}

// rules blurb for the banner modal — reflects the actual mechanics per
// featured tier, plus any Court effects currently bending the odds
function bannerRulesText(cards) {
  const mods = aggregateCourtMods();
  const tiers = new Set(cards.map(c => c.tier));
  const lines = [];
  if (tiers.has(4) || tiers.has(2)) {
    if (mods.bannerGuarantee) {
      lines.push('Silver & soul draws: the exclusive wins <b>every time</b> (her Throne demands it)');
    } else {
      const pct = Math.round((0.5 + (mods.bannerLuck || 0)) * 100);
      lines.push(`Silver & soul draws flip a coin: <b>${pct}%</b> the exclusive · else the standard pool`);
    }
  }
  if (tiers.has(1)) {
    if (mods.bannerGuarantee) {
      lines.push('Bronze draws: the exclusive wins <b>every time</b> (her Throne demands it)');
    } else {
      const n = Math.max(1, 5 - (mods.commonPityHaste || 0));
      lines.push(`Bronze draws: the exclusive is guaranteed every <b>${n}</b> bronze cards`);
    }
  }
  lines.push("When the banner ends, they're <b>gone forever</b>~");
  return lines.join('<br>');
}

// expanded detail modal: big card + rules + which banner cards are owned
function showBannerModal(banner) {
  const cards = banner.cardIds.map(id => cardDefs && cardDefs[id]).filter(Boolean);
  // headline card first: soul reap leads, then silver, then bronze
  cards.sort((a, b) => b.tier - a.tier);
  const tierLabel = t => CARD_TIER_NAMES[t] || t;
  getCollection().then(data => {
    const ownedSet = data.cards;
    const modal = document.createElement('div');
    modal.id = 'bannerModal';
    modal.innerHTML = `
      <div class="bannerCardModal">
        <p class="bannerLabel">✦ Limited Banner ✦</p>
        <h2>${(cards.find(c => c.tier === 4) || cards[0] || {}).name || banner.name}</h2>
        ${cards.map(c => `
          <div class="bannerCardRow">
            <div class="bannerBigCard tier${c.tier}"><img src="${c.url}" alt="${c.name}"></div>
            <p class="bannerBigName">${c.name} <span class="bannerBigMeta">${tierLabel(c.tier)} · LIMITED${ownedSet[c.id] ? ' · owned ×' + ownedSet[c.id] : ''}</span></p>
            ${c.passive ? `<p class="bannerBigPassive">⚔ ${c.passive.blurb}</p>` : c.unlock ? `<p class="bannerBigPassive">🔓 ${c.unlock.blurb}</p>` : ''}
          </div>`).join('')}
        <hr>
        <p class="bannerRule">${bannerRulesText(cards)}</p>
        <p class="bannerCountdown big">ends in ${fmtCountdown(Date.parse(banner.endsAt) - Date.now())}</p>
        <p class="ratesClose">Tap anywhere to close~</p>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    // defer binding so the opening click can't close it instantly
    setTimeout(() => modal.addEventListener('click', () => modal.remove()), 50);
  });
}

function initBanner() {
  if (cardDefs) { renderBannerSpot(); return; }
  setTimeout(initBanner, 500);  // decrypt in flight
}

function celebrateLevelUp(fromLevel, toLevel) {
  sparkleBurst(60);
  sfxClick();
  // one banner for the highest level reached — first load after the update
  // would otherwise stack a banner for every backlogged level
  const lvl = toLevel;
  const banner = document.createElement('div');
  banner.id = 'devotionLevelUp';
  banner.innerHTML = `
    <div class="devCard">
      <h2>✦ Devotion Level ${lvl} ✦</h2>
      <p>Alexia acknowledges your worship~</p>
      <p class="devReward">reward: ???</p>
      <p class="ratesClose">Tap anywhere to close~</p>
    </div>`;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('open'));
  banner.addEventListener('click', () => banner.remove());
}

function loadOverlay() {
  if (overlayLoaded) return;
  overlayLoaded = true;
  fetch(chrome.runtime.getURL("overlay.html"))
    .then(response => response.text())
    .then(html => {
      document.body.insertAdjacentHTML("beforeend", html);
      document.body.style.overflow = "hidden";
      const sigil = document.getElementById('sigil');
      if (sigil) sigil.src = chrome.runtime.getURL("Sigil.png");
      wireOverlayButtons();
      wireButtonSfx(document.querySelector('.overlayBody'));
      updateOverlayPity();
      initEula();
      initCards();
      wireNavTabs();
      initDevotion();
      initSkins();
      initBanner();
      initShards();
      initLevelRewards();
      renderCourtStrip();
      renderBirthdayRibbon();
    });
}
chrome.runtime.sendMessage({ action: 'shouldShowOverlay' }, (resp) => {
  if (resp && resp.ok && resp.show) {
    loadOverlay();
  }
});

// pull chrome.storage mirrors into the sync caches (pity bars paint correctly
// on first open, history/mode follow chrome.storage instead of localStorage)
initStorageCaches();

// Load overlay
// loadOverlay();

/* ============ EULA GATE (one-time, before everything else) ============ */
const EULA_KEY = 'alexia_eulaAcceptedV1';

function initEula() {
  chrome.storage.local.get(EULA_KEY, res => {
    if (res[EULA_KEY]) {
      initWelcome();
      return;
    }
    fetch(chrome.runtime.getURL('eula.html'))
      .then(r => r.text())
      .then(html => {
        document.body.insertAdjacentHTML('beforeend', html);
        const modal = document.getElementById('eulaModal');
        if (!modal) { initWelcome(); return; }
        requestAnimationFrame(() => modal.classList.add('open'));
        document.getElementById('eulaAccept').addEventListener('click', () => {
          chrome.storage.local.set({ [EULA_KEY]: Date.now() });
          modal.classList.remove('open');
          setTimeout(() => modal.remove(), 500);
          sparkleBurst(25);
          initWelcome();
        });
      })
      .catch(() => initWelcome());
  });
}

/* ============ WELCOME GATE (doubles as the audio-unlock gesture) ============ */
function initWelcome() {
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  // escape the overlay stacking context: the banner panel floats at global
  // z ...646, so the gate must sit at ...max for its blur to cover the panel
  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  document.getElementById('welcomeYes').addEventListener('click', () => {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 500);
    sparkleBurst(25);
  });
}

/* ============ SYNTHESIZED UI AUDIO (no files, Web Audio API) ============ */
let uiAudioCtx = null;
let uiAudioUnlocked = false;

// Chrome only allows AudioContext after a real user gesture (click, not hover)
document.addEventListener('pointerdown', () => {
  uiAudioUnlocked = true;
  if (uiAudioCtx && uiAudioCtx.state === 'suspended') {
    uiAudioCtx.resume().catch(() => {});
  }
}, { once: true });

function getUiAudioCtx() {
  if (!uiAudioUnlocked) return null;  // stay silent until first click
  if (!uiAudioCtx) {
    try { uiAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  return uiAudioCtx;
}

// soft pink "tick" — short filtered blip, for hovers
function sfxHover() {
  const ctx = getUiAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  filter.Q.value = 6;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(1700, t + 0.05);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

// deeper pluck with a shimmer partial — for clicks
function sfxClick() {
  const ctx = getUiAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // body pluck
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.16);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.1, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.24);

  // shimmer partial
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1980, t);
  gain2.gain.setValueAtTime(0.0001, t);
  gain2.gain.exponentialRampToValueAtTime(0.03, t + 0.01);
  gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start(t);
  osc2.stop(t + 0.14);
}

// deep bass drop for the card reveal — sub-bass sine slam + low thump
function sfxCardDrop() {
  const ctx = getUiAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // sub-bass slam: rounded swell, 100Hz → 34Hz, long smooth tail
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(100, t);
  sub.frequency.exponentialRampToValueAtTime(34, t + 0.6);
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.exponentialRampToValueAtTime(0.45, t + 0.06);
  subGain.gain.setValueAtTime(0.4, t + 0.5);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  sub.connect(subGain).connect(ctx.destination);
  sub.start(t);
  sub.stop(t + 1.35);

  // low thump transient (filtered noise burst)
  const noiseLen = 0.08;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 220;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.35, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseLen);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(t);

  // faint harmonic body so it doesn't vanish on small speakers
  const mid = ctx.createOscillator();
  const midGain = ctx.createGain();
  mid.type = 'triangle';
  mid.frequency.setValueAtTime(180, t);
  mid.frequency.exponentialRampToValueAtTime(76, t + 0.3);
  midGain.gain.setValueAtTime(0.0001, t);
  midGain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
  midGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  mid.connect(midGain).connect(ctx.destination);
  mid.start(t);
  mid.stop(t + 0.45);
}

// attach hover/click sfx to every button inside a root element
function wireButtonSfx(root) {
  root.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', sfxHover);
    btn.addEventListener('click', sfxClick);
  });
}

function wireOverlayButtons() {
  const b1 = document.getElementById('b1');
  if (b1) b1.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startPulls', count: 1 }, (resp) => {
      if (resp && resp.ok) {
        playTauntSound('pull', 'sounds/Pull.mp3', { volume: 0.5 });
        showPullProgress(1);
        addExactlyOneItem();  // kick off pull #1 directly
        promoteImagesToForeground();
        startImageSpawning();
      }
    });
  });
  // same for 10-pull
  const b10 = document.getElementById('b10');
  if (b10) b10.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startPulls', count: 10 }, (resp) => {
      if (resp && resp.ok) {
        playTauntSound('pull', 'sounds/Pull.mp3', { volume: 0.5 });
        showPullProgress(10);
        addExactlyOneItem();  // kick off pull #1 directly
        promoteImagesToForeground();
        startImageSpawning();
      }
    });
  });

  // rates popup
  const ratesBtn = document.getElementById('ratesBtn');
  const ratesModal = document.getElementById('ratesModal');
  if (ratesBtn && ratesModal) {
    ratesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      buildRatesTable();
      ratesModal.classList.add('open');
    });
    ratesModal.addEventListener('click', () => ratesModal.classList.remove('open'));
  }

  // history popup
  const histBtn = document.getElementById('histBtn');
  if (histBtn) {
    histBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showHistory();
    });
  }

  // mode selector (normal / easy / hard) + hover explanations
  const MODE_DESCRIPTIONS = {
    normal: "The full bratty experience~ all 8 items, Soul Buffet can reap you",
    easy: "Training wheels~ no Soul Buffet, Hot Meal is the jackpot",
    hard: "No cheap sends~ Soul Buffet is only the beginning — Surrender is the true jackpot"
  };

  // hard mode button appears once unlocked (owning Bunny takeover)
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect && hasUnlock('hardMode') && !modeSelect.querySelector('[data-mode="hard"]')) {
    const hardBtn = document.createElement('button');
    hardBtn.className = 'modeBtn';
    hardBtn.dataset.mode = 'hard';
    hardBtn.textContent = 'Hard';
    modeSelect.insertBefore(hardBtn, document.getElementById('modeTip'));
  }
  const modeTip = document.getElementById('modeTip');
  updateModeButtons();
  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      saveMode(btn.dataset.mode);
      updateModeButtons();
      updateOverlayPity();  // bars reflect the newly selected mode's counters
    });
    btn.addEventListener('mouseenter', () => {
      if (modeTip) {
        modeTip.textContent = MODE_DESCRIPTIONS[btn.dataset.mode] || '';
        modeTip.classList.add('show');
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (modeTip) modeTip.classList.remove('show');
    });
  });

  // sim buttons — full pull feedback (rolls, pity, taunts, summary) but
  // overlay-only: no background messages, no throne interaction
  const sim1 = document.getElementById('sim1');
  if (sim1) sim1.addEventListener('click', () => simulatePulls(1));
  const sim10 = document.getElementById('sim10');
  if (sim10) sim10.addEventListener('click', () => simulatePulls(10));
  const simDestroy = document.getElementById('simDestroy');
  if (simDestroy) simDestroy.addEventListener('click', () => simulatePulls(1, { forceDestroy: true }));
  // birthday event preview: forces the date check on + shows the ribbon
  const simBirthday = document.getElementById('simBirthday');
  if (simBirthday) simBirthday.addEventListener('click', () => {
    birthdayOverride = true;
    renderBirthdayRibbon();
    console.log('🎂 birthday override ON — every roll is now ' + BIRTHDAY_ITEM);
  });

  // shard free-pull button — spends 150 💠 on one sim-style pull
  const shardPullBtn = document.getElementById('shardPull');
  if (shardPullBtn) shardPullBtn.addEventListener('click', shardBuyPull);
}

// overlay-only pull simulation for testing feedback visuals
// pacing mirrors a real pull: ~6s add-to-cart, ~4s checkout, ~5s payment
// opts.forceDestroy → the resolved card is destroyed (Censored anim) instead of crowned
let simRunning = false;
let simForceDestroy = false;
function simulatePulls(count, opts = {}) {
  if (simRunning) return;
  simRunning = true;
  simForceDestroy = !!opts.forceDestroy;
  playTauntSound('pull', 'sounds/Pull.mp3', { volume: 0.5 });
  showPullProgress(count);
  promoteImagesToForeground();
  startImageSpawning();

  let i = 0;
  const doOne = () => {
    randomItemChosen = null;      // reset the memoized roll
    chooseOneRandomItem();        // real roll: pity, taunts, history recording
    tickPullProgress();           // stage 1: "added to cart"
    setTimeout(tickPullProgress, 2000);  // stage 2: "checkout"
    setTimeout(() => { tickPullProgress(); resolveCardDraw(); }, 4000);  // stage 3: "payment" + crown card
    i++;
    if (i < count) setTimeout(doOne, 6000);   // real-cycle cadence
    else setTimeout(() => {
      stopImageSpawning();
      showSessionSummary();
      startImageSpawning(3000, { background: true });
      simRunning = false;
    }, 6000);
  };
  setTimeout(doOne, 2000);  // initial ramp-in, like the first page load
}

function updateModeButtons() {
  const mode = loadMode();
  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// build the rates view — both modes side by side, active one highlighted
function buildRatesTable() {
  const container = document.getElementById('ratesColumns');
  if (!container) return;

  const activeMode = loadMode();
  const cap = (s) => s.replace(/(^|\s)\S/g, c => c.toUpperCase());

  container.innerHTML = ['normal', 'easy', 'hard']
    .filter(modeName => modeName !== 'hard' || hasUnlock('hardMode'))
    .map(modeName => {
    const cfg = MODES[modeName];
    const total = cfg.items.reduce((s, i) => s + (cfg.weights[i] || 0), 0);
    const pct = (item) => ((cfg.weights[item] / total) * 100).toFixed(1) + '%';
    const commons = cfg.items.filter(i => !cfg.rareGroup.includes(i) && i !== cfg.reapItem);

    let rows = '<tr class="tierHead"><td colspan="2">Common</td></tr>';
    commons.forEach(i => rows += `<tr><td>${cap(i)}</td><td>${pct(i)}</td></tr>`);
    rows += '<tr class="tierHead rare"><td colspan="2">Rare</td></tr>';
    cfg.rareGroup.forEach(i => rows += `<tr class="rare"><td>${cap(i)}</td><td>${pct(i)}</td></tr>`);
    rows += '<tr class="tierHead reap"><td colspan="2">Soul Reap</td></tr>';
    rows += `<tr class="reap"><td>${cap(cfg.reapItem)}</td><td>${pct(cfg.reapItem)}</td></tr>`;

    const isActive = modeName === activeMode;
    return `<div class="ratesCol${isActive ? ' active' : ''}">
      <p class="ratesColTitle">${cap(modeName)}${isActive ? ' ✦' : ''}</p>
      <table>${rows}</table>
    </div>`;
  }).join('');
}

function updateOverlayPity() {
  const { pullsSince8pct, pullsSinceSoulReap } = loadPityCounters();
  const bar8 = document.getElementById('bar8pct');
  if (!bar8) return;  // overlay not injected
  // Court: bars show the thresholds the roll logic actually uses —
  // Schlllrp halves both tracks, reapPityHaste lowers the reap one
  const mods = aggregateCourtMods();
  const pityDiv = mods.halfPity ? 2 : 1;
  const shrink = 1 - (mods.pityShrink || 0);
  const reapBaseMax = mods.pityExtend ? mods.pityExtend : 80;
  const rareMax = Math.max(1, Math.floor((10 / pityDiv) * shrink));
  const reapMax = Math.floor((reapBaseMax / pityDiv) * shrink * (1 - (mods.reapPityHaste || 0)));
  bar8.max = rareMax;
  bar8.value = Math.min(pullsSince8pct, rareMax);
  const barReap = document.getElementById('barSoulReap');
  barReap.max = reapMax;
  barReap.value = Math.min(pullsSinceSoulReap, reapMax);
  document.getElementById('bar8pctText').textContent = pullsSince8pct + '/' + rareMax;
  document.getElementById('barSoulReapText').textContent = pullsSinceSoulReap + '/' + reapMax;
  // rates modal footnote tracks the same thresholds
  const noteRare = document.getElementById('pityNoteRare');
  if (noteRare) noteRare.textContent = rareMax;
  const noteReap = document.getElementById('pityNoteReap');
  if (noteReap) noteReap.textContent = reapMax;
}

var audioOpened = false;
var payClicked = false;
var itemAdded = false;

const imageURLs = [ 
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705738/e5gpcyvjml2fj8dkwjcq.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705740/bcsqtm3raqb6amimu79q.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705742/vsobwgapufhhxnp6dnov.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705744/cmxkdmc0wvknjjahk25n.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705746/gijlrh8aw1i0vigxz07w.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705749/ajuqxqfd3meokkvc6qy5.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705751/xwfigpscir8tytka29kb.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705753/fehizewadip1xu3ksv8o.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705755/ovzfyj9eivm64tubrgqg.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705757/cmu8uxkddtyxumclbsoa.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705760/edb9alsdupmtk9947bga.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705763/o5ay25iuvv1p8awdig1f.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705765/u7jorany8wlo7j4va2rt.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705767/fie0mrz2gzc5dnupoujg.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705770/slarwohgb108whsurpor.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705772/o0fobmmrfjbopypia3hc.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705774/l5jrcutxshakyz2uznro.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705777/yximcfmnkgwjen6wkrxp.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705779/s2suuiw8zikvghdiorwa.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705781/omimfvllpsewqbmnvkgl.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705783/z6ssfpqt0majkfrljwfs.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705785/ii5zqhynft1mklez0m2k.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705787/nv12djuhvt5cdmfsrifu.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705789/pnq4xdz4qu1b0omwkzbd.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705791/teums8bxjwldbpy1hgwp.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705793/kcinex3lwrknlvtv62k9.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705795/pyvp9w6y1iuplzw0um6a.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705797/zdpkgbnkwvjh1hdtkmyw.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705799/znodtgqjc1rsvabrjowz.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705802/jdbtduuzq1uvbhqn5cx3.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705805/i0kzuwq9c9v5io0xpy2t.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705807/ymcqlzb52j1f2wdk0o1r.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705809/wpkla6ixkltkcjl7h6nh.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705811/w0nhqhtaftimkpvbbqrd.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705813/jx6lv1bkznrfnwhozjxg.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705816/todbmeincc9xvne6xl7j.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705818/zlkhg6wlkexzmshnhyhy.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705821/fgwyjtjoh5qbb3h9piin.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705823/il3snvavp7gree1teeoe.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705825/eqrfztseigf0zq2avljn.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705828/p24a2bfpbndupbjxrzsi.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705830/jg9c3z7fjd08kxqzkxv1.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705832/fihtbqqr5x9301wmhzib.png",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705834/gnwodhfldaignlfn5dx6.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705836/hph9crbxtxd2tn1vydc6.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705838/sdn71ro7eftz2bmvk02b.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705839/nppc4jtnje4udmttfvw6.jpg",
"https://res.cloudinary.com/ddjjknjpb/image/upload/v1785705841/j3c8dg71coocjr2jft40.jpg"
];
  
const style = document.createElement('style');
style.textContent = `
  .popup-image {
    border-color: rgb(255, 117, 237);
    box-shadow: 0 0 10px rgb(255, 117, 237), 0 0 20px rgb(255, 117, 237), 0 0 30px rgb(255, 117, 237);
    max-width: 450px; /* or whatever you want */
    min-width: 150px;
    height: auto; /* maintains aspect ratio */
  }

  .popup-image:hover {
    border-color:rgb(163, 15, 163);
    box-shadow: 0 0 10px rgb(163, 15, 163), 0 0 20px rgb(163, 15, 163), 0 0 30px rgb(163, 15, 163);
  }
`;

document.head.appendChild(style);

/* ============ BIRTHDAY EVENT (October 9) ============
 * On Alexia's birthday every pull — common, rare, or reap — is overridden
 * to the birthday item. Pity counters are left untouched (the day is a
 * celebration, not a setback); the card draw + history still happen.
 * NOTE: "Birthday send~" must exist as an item on the Throne store or the
 * add-to-cart step will find nothing to click. */
const BIRTHDAY_ITEM = "Birthday send~";
let birthdayOverride = false;  // 🎂 Sim Birthday test button flips this on
function isBirthdayToday() {
  if (birthdayOverride) return true;
  const d = new Date();
  return d.getMonth() === 9 && d.getDate() === 9;  // Oct 9 (local time)
}

// slim ribbon pinned to the top of the screen while the event is live
function renderBirthdayRibbon() {
  if (!isBirthdayToday() || document.getElementById('birthdayRibbon')) return;
  const el = document.createElement('div');
  el.id = 'birthdayRibbon';
  el.innerHTML = `<p>🎂 It's her birthday — every pull is <b>${BIRTHDAY_ITEM}</b> today~</p>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
}

/* ============ GACHA MODES ============ */
const MODES = {
  normal: {
    items: ["pathetic snack~", "coffee", "milk snack~", "spit drink~", "cute meal~",
            "swipe meal~", "hot meal~", "soul buffet~"],
    weights: {
      "pathetic snack~": 225, "coffee": 225, "milk snack~": 225, "spit drink~": 225,
      "cute meal~": 32, "swipe meal~": 32, "hot meal~": 16, "soul buffet~": 6
    },
    rareGroup: ["cute meal~", "swipe meal~", "hot meal~"],
    reapItem: "soul buffet~"
  },
  easy: {
    items: ["pathetic snack~", "coffee", "milk snack~", "spit drink~",
            "swipe meal~", "cute meal~", "hot meal~"],
    weights: {
      "pathetic snack~": 225, "coffee": 225, "milk snack~": 225,
      "spit drink~": 32, "swipe meal~": 32, "cute meal~": 32,
      "hot meal~": 6
    },
    rareGroup: ["spit drink~", "swipe meal~", "cute meal~"],
    reapItem: "hot meal~"
  },
  // unlocked by owning Bunny takeover (unlock tag → alexia_unlocks.hardMode)
  hard: {
    items: ["spit drink~", "cute meal~", "swipe meal~",
            "hot meal~", "soul buffet~", "surrender buffet~"],
    weights: {
      "spit drink~": 225, "cute meal~": 225, "swipe meal~": 225,
      "hot meal~": 16, "soul buffet~": 9, "surrender buffet~": 4
    },
    rareGroup: ["hot meal~", "soul buffet~"],
    reapItem: "surrender buffet~"
  }
};

/* ===================== PERSISTENT STORAGE ===================== */
/* localStorage lives on throne.com — clearing site data (or certain
   reinstall flows) wipes mode/pity/history. chrome.storage.local survives
   extension updates, so everything is mirrored there. On first load after
   this change, legacy localStorage values are migrated in one batch.     */

const MIGRATION_KEY = 'alexia_storageMigrationV1';

function storageSet(pairs) {
  try { chrome.storage.local.set(pairs); } catch (e) {}
}

function migrateLocalStorageToChrome() {
  try {
    chrome.storage.local.get(MIGRATION_KEY, res => {
      if (res[MIGRATION_KEY]) return;
      const dump = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('alexia_')) dump[k] = localStorage.getItem(k);
      }
      dump[MIGRATION_KEY] = true;
      storageSet(dump);
    });
  } catch (e) {}
}

// cache mirrors for synchronous reads (async loads resolved at startup)
let pityCache = {};
let modeCache = 'normal';
let historyCache = [];
let collectionCache = {};   // { cardId → count } for sync ownership checks
let bannerScheduleCache = null;  // remote { bannerId, startsAt, endsAt } from background.js
let courtCache = { equipped: [null, null, null] };  // Court loadout (card ids)
let lifetimePullsCache = 0;      // alexia_lifetimePulls — freePullEvery modulo
let unlocksCache = {};           // alexia_unlocks — permanent milestone flags

function initStorageCaches() {
  migrateLocalStorageToChrome();
  try {
    chrome.storage.local.get(null, all => {
      for (const k in all) {
        if (!k.startsWith('alexia_')) continue;
        if (k.includes('pullsSince')) pityCache[k] = parseInt(all[k]) || 0;
        else if (k === 'alexia_mode') modeCache = all[k];
        else if (k === 'alexia_pullHistory') {
          try { historyCache = JSON.parse(all[k]) || []; } catch (e) { historyCache = []; }
        }
        else if (k === COLLECTION_KEY) {
          try { collectionCache = (all[k] && all[k].cards) || {}; } catch (e) { collectionCache = {}; }
        }
        else if (k === 'alexia_remoteBanner') {
          try { bannerScheduleCache = (typeof all[k] === 'string' ? JSON.parse(all[k]) : all[k]) || null; } catch (e) { bannerScheduleCache = null; }
        }
        else if (k === COURT_KEY) {
          try {
            const c = (typeof all[k] === 'string' ? JSON.parse(all[k]) : all[k]);
            if (c && Array.isArray(c.equipped)) courtCache = { equipped: [c.equipped[0] || null, c.equipped[1] || null, c.equipped[2] || null] };
          } catch (e) {}
        }
        else if (k === LIFETIME_PULLS_KEY) lifetimePullsCache = parseInt(all[k]) || 0;
        else if (k === UNLOCKS_KEY) {
          try { unlocksCache = (typeof all[k] === 'string' ? JSON.parse(all[k]) : all[k]) || {}; } catch (e) { unlocksCache = {}; }
        }
      }
      updateOverlayPity();
    });
  } catch (e) {}
}

// live banner per the cached remote schedule (null when none/expired)
function currentBanner() {
  return typeof activeBanner === 'function' ? activeBanner(Date.now(), bannerScheduleCache) : null;
}

/* ===================== THE COURT (equipment) =====================
 * Owned cards equip into ≤3 slots (unlocked at Devotion Lv 1/5/10); each
 * equipped card's passive bends the gacha. Dupe breakpoints: count≥3 →
 * value×1.5, count≥9 → value×2 (replace, not stack). Fail-closed: any
 * inconsistency resolves to "no passive", never a crash.
 */
const COURT_KEY = 'alexia_court';
const LIFETIME_PULLS_KEY = 'alexia_lifetimePulls';

function courtSlots(level) { return level >= 10 ? 3 : level >= 5 ? 2 : 1; }

function courtLevel() {
  try { return devotionLevelFromXP(devotionComputeXP(collectionCache)); } catch (e) { return 1; }
}

// equipped card defs with passives — single read path, everything filters through here
function getEquippedPassives() {
  const slots = courtSlots(courtLevel());
  return (courtCache.equipped || [])
    .slice(0, slots)
    .filter(id => id && collectionCache[id])
    .map(id => cardDefs && cardDefs[id])
    .filter(def => def && def.passive);
}

// dupe breakpoint multiplier for one card's own count
function dupeBuffMult(count) { return count >= 9 ? 2 : count >= 3 ? 1.5 : 1; }

// sum same-kind values across equipped cards (additive), each scaled by its
// own dupe breakpoint; static passives skip the breakpoint and overwrite
// rather than stack; list-valued kinds concatenate; caps keep the economy safe
const COURT_CAPS = { reapPityHaste: 0.30, bannerLuck: 0.20, dupeReroll: 0.30 };
function aggregateCourtMods() {
  const mods = {};
  const addMod = (kind, v, isStatic) => {
    if (Array.isArray(v)) {
      mods[kind] = (mods[kind] || []).concat(v);
    } else if (isStatic) {
      mods[kind] = v;  // static: last equipped wins, no stacking
    } else {
      mods[kind] = (mods[kind] || 0) + v;
    }
  };
  getEquippedPassives().forEach(def => {
    const p = def.passive;
    const v = p.static ? p.value : (typeof p.value === 'number' ? p.value * dupeBuffMult(collectionCache[def.id] || 0) : p.value);
    addMod(p.kind, v, p.static);
    // easy-mode variant list rides alongside (removeCommons/removeItems)
    if (Array.isArray(p.easyValue)) addMod(p.kind + 'Easy', p.easyValue, true);
    // normalOnly flag rides alongside (Mina's Dog removeRare)
    if (p.normalOnly) mods[p.kind + 'NormalOnly'] = true;
    // optional second effect on the same card (Access Denied: rare + soul)
    if (p.secondKind) {
      const sv = p.static ? p.secondValue : (typeof p.secondValue === 'number' ? p.secondValue * dupeBuffMult(collectionCache[def.id] || 0) : p.secondValue);
      addMod(p.secondKind, sv, p.static);
    }
  });
  for (const k in COURT_CAPS) if (mods[k] > COURT_CAPS[k]) mods[k] = COURT_CAPS[k];
  return mods;
}

function saveCourt() { storageSet({ [COURT_KEY]: JSON.stringify(courtCache) }); }

function equipCard(slot, cardId) {
  if (slot < 0 || slot >= courtSlots(courtLevel())) return;
  // conflictsWith (e.g. Tailjob vs Bunny supremacy): refuse the pairing
  const def = cardDefs && cardDefs[cardId];
  const foe = def && def.passive && def.passive.conflictsWith;
  if (foe && courtCache.equipped.includes(foe)) {
    const foeName = (cardDefs[foe] || {}).name || foe;
    console.log(`Court: ${def.name} refuses to serve alongside ${foeName}~`);
    return false;
  }
  // one copy per loadout — unequip from any other slot first
  courtCache.equipped = courtCache.equipped.map(id => id === cardId ? null : id);
  courtCache.equipped[slot] = cardId;
  saveCourt();
  return true;
}

function unequipCard(slot) {
  if (slot < 0 || slot > 2) return;
  courtCache.equipped[slot] = null;
  saveCourt();
}

// keep the schedule cache hot — background.js rewrites it every 6h
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('alexia_remoteBanner' in changes)) return;
    const raw = changes.alexia_remoteBanner.newValue;
    try { bannerScheduleCache = (typeof raw === 'string' ? JSON.parse(raw) : raw) || null; }
    catch (e) { bannerScheduleCache = null; }
    renderBannerSpot();  // swap the panel without a reload
  });
} catch (e) {}

function loadMode() {
  // hard mode requires the unlock (Bunny takeover ownership, recorded once)
  if (modeCache === 'hard') return hasUnlock('hardMode') ? 'hard' : 'normal';
  return modeCache === 'easy' ? 'easy' : 'normal';
}

function saveMode(mode) {
  modeCache = mode;
  storageSet({ alexia_mode: mode });
}

// active-mode accessors (used by all gacha logic)
function currentMode() { return MODES[loadMode()]; }
function activeItems() { return currentMode().items; }
function activeWeights() { return currentMode().weights; }
function activeRareGroup() { return currentMode().rareGroup; }
function activeReapItem() { return currentMode().reapItem; }

let randomItemChosen = null;

// pity counters are tracked PER MODE (normal/easy have different pools)
function pityKey(base) { return 'alexia_' + loadMode() + '_' + base; }

function loadPityCounters() {
  const p = pityKey('pullsSince8pct');
  const r = pityKey('pullsSinceSoulReap');
  return {
    pullsSince8pct: pityCache[p] || 0,
    pullsSinceSoulReap: pityCache[r] || 0
  };
}

function savePityCounters(pullsSince8pct, pullsSinceSoulReap) {
  const p = pityKey('pullsSince8pct');
  const r = pityKey('pullsSinceSoulReap');
  pityCache[p] = pullsSince8pct;
  pityCache[r] = pullsSinceSoulReap;
  storageSet({ [p]: String(pullsSince8pct), [r]: String(pullsSinceSoulReap) });
  updateOverlayPity();
  chrome.runtime.sendMessage({ action: 'updatePity', pullsSince8pct, pullsSinceSoulReap });
}

function chooseOneRandomItem() {
  if (!randomItemChosen) {
    let { pullsSince8pct, pullsSinceSoulReap } = loadPityCounters();

    const baseItems = activeItems();
    const baseWeights = activeWeights();
    const baseRareGroup = activeRareGroup();
    const reapItem = activeReapItem();
    const isEasy = loadMode() === 'easy';

    // ---- Court modifiers ----
    const mods = aggregateCourtMods();

    // pool surgery (static passives): removeCommons keeps only the listed
    // commons; removeItems drops listed commons; removeRare drops listed rares
    let items = baseItems.slice();
    let rareGroup = baseRareGroup.slice();
    const commons = items.filter(i => !baseRareGroup.includes(i) && i !== reapItem);
    if (mods.removeCommons) {
      const keep = (isEasy && mods.removeCommonsEasy) ? mods.removeCommonsEasy : mods.removeCommons;
      items = items.filter(i => baseRareGroup.includes(i) || i === reapItem || keep.includes(i));
    }
    if (mods.removeItems) {
      const drop = (isEasy && mods.removeItemsEasy) ? mods.removeItemsEasy : mods.removeItems;
      items = items.filter(i => !drop.includes(i) || baseRareGroup.includes(i) || i === reapItem);
    }
    if (mods.removeRare && (!mods.removeRareNormalOnly || loadMode() === 'normal')) {
      rareGroup = rareGroup.filter(i => !mods.removeRare.includes(i));
      items = items.filter(i => !mods.removeRare.includes(i));
    }
    if (!rareGroup.length) { rareGroup = baseRareGroup.slice(); items = baseItems.slice(); }  // never empty the rare pool

    // weight conservation: removed items' weight flows to same-tier survivors
    // (proportional to base weights) so pool surgery filters WHICH item you
    // get, never the overall common/rare/reap distribution — e.g. Virgin
    // killer turns milk snack~ into a 900-weight common, commons stay ~91%
    const weights = { ...baseWeights };
    const redistribute = (survivors, removed) => {
      if (!removed.length || !survivors.length) return;
      const removedW = removed.reduce((s, i) => s + (baseWeights[i] || 0), 0);
      const survW = survivors.reduce((s, i) => s + (baseWeights[i] || 0), 0);
      if (!removedW || !survW) return;
      const mult = (survW + removedW) / survW;
      survivors.forEach(i => { weights[i] = (baseWeights[i] || 0) * mult; });
    };
    redistribute(commons.filter(i => items.includes(i)), commons.filter(i => !items.includes(i)));
    redistribute(rareGroup, baseRareGroup.filter(i => !rareGroup.includes(i)));

    // rate scaling: reap/rare rate-ups; Holy Nun doubles both on Sundays
    const sunday = mods.sundayBoost && new Date().getDay() === 0 ? (1 + mods.sundayBoost) : 1;
    if (mods.reapRateUp || sunday > 1) weights[reapItem] = (weights[reapItem] || 0) * (1 + (mods.reapRateUp || 0)) * sunday;
    if (mods.rareRateUp || sunday > 1) rareGroup.forEach(i => { weights[i] = (weights[i] || 0) * (1 + (mods.rareRateUp || 0)) * sunday; });

    // pity thresholds: Schlllrp halves both tracks (static); Gym sweat
    // shrinks both 30% (static); Knight's pet RAISES the reap base to 119
    // (→120 pulls); reapPityHaste scales
    const pityDiv = mods.halfPity ? 2 : 1;
    const shrink = 1 - (mods.pityShrink || 0);
    const reapBase = mods.pityExtend ? mods.pityExtend - 1 : 79;
    const reapThreshold = Math.floor((reapBase / pityDiv) * shrink * (1 - (mods.reapPityHaste || 0)));
    const rareThreshold = Math.max(1, Math.floor((9 / pityDiv) * shrink));

    if (pullsSinceSoulReap >= reapThreshold) {
      // 80-pull reap pity (threshold may be Court-lowered)
      randomItemChosen = reapItem;
      console.log(`PITY: ${reapItem} guaranteed after ${pullsSinceSoulReap + 1} pulls!`);
    } else if (pullsSince8pct >= rareThreshold) {
      // rare-group pity — Ass Hypno forces the item, else weighted pick
      if (mods.forceRareItem && rareGroup.includes(mods.forceRareItem)) {
        randomItemChosen = mods.forceRareItem;
      } else {
        const groupTotal = rareGroup.reduce((s, i) => s + (weights[i] || 0), 0);
        let roll = Math.random() * groupTotal;
        for (const item of rareGroup) {
          roll -= weights[item] || 0;
          if (roll <= 0) { randomItemChosen = item; break; }
        }
        if (!randomItemChosen) randomItemChosen = rareGroup[0];
      }
      console.log(`PITY: rare group guaranteed after ${pullsSince8pct + 1} pulls! Got: "${randomItemChosen}"`);
    } else {
      // Normal weighted random — Ass Hypno hijacks a rare outcome to cute meal~
      const totalWeight = items.reduce((sum, item) => sum + (weights[item] || 0), 0);
      let roll = Math.random() * totalWeight;
      for (const item of items) {
        roll -= weights[item] || 0;
        if (roll <= 0) {
          randomItemChosen = item;
          break;
        }
      }
      if (mods.forceRareItem && rareGroup.includes(randomItemChosen) && rareGroup.includes(mods.forceRareItem)) {
        randomItemChosen = mods.forceRareItem;
      }
    }

    // Update pity counters
    if (randomItemChosen === reapItem) {
      pullsSinceSoulReap = 0;
      pullsSince8pct = 0;
    } else if (rareGroup.includes(randomItemChosen)) {
      pullsSince8pct = 0;
      pullsSinceSoulReap++;
    } else {
      pullsSince8pct++;
      pullsSinceSoulReap++;
    }

    savePityCounters(pullsSince8pct, pullsSinceSoulReap);
    console.log(`Alexia has chosen: "${randomItemChosen}" | Until 8% pity: ${Math.max(0, 10 - pullsSince8pct)} | Until soul reap pity: ${Math.max(0, 80 - pullsSinceSoulReap)}`);

    // rarity celebration + pick this pull's card
    let cardTier = 1;
    if (randomItemChosen === reapItem) {
      triggerTauntFeedback('reap');
      cardTier = 4;
    } else if (rareGroup.includes(randomItemChosen)) {
      triggerTauntFeedback('rare');
      cardTier = 2;
    }
    pendingCardDraw = rollCard(cardTier);
    preparePullCardParade(pendingCardDraw);

    // rarity tier of the roll — captured BEFORE any birthday swap
    const rolledTier = randomItemChosen === reapItem ? 'reap' :
      rareGroup.includes(randomItemChosen) ? 'rare' : 'common';

    // Birthday event: the ROLL stands (rarity, pity, taunts, card tier all
    // resolved above) — only the item sent to the store is swapped out.
    if (isBirthdayToday()) {
      console.log(`🎂 BIRTHDAY: "${randomItemChosen}" becomes "${BIRTHDAY_ITEM}"`);
      randomItemChosen = BIRTHDAY_ITEM;
    }

    // record pull for session summary + history — AFTER the birthday swap so
    // the ledger prices what was actually sent (tier still reflects the roll)
    recordPull(randomItemChosen, rolledTier);
  }

  return randomItemChosen;
}

/* ===================== PULL HISTORY ===================== */

function loadPullHistory() {
  return historyCache;
}

function savePullHistory(h) {
  historyCache = h.slice(-200);
  storageSet({ alexia_pullHistory: JSON.stringify(historyCache) });
}

let pendingFreePull = false;       // runFreePull (card effect) arms this
let pendingShardFreePull = false;  // shardBuyPull arms this — shows "Free Pull", no item

function recordPull(item, tier) {
  const entry = { item, tier, mode: loadMode(), ts: Date.now() };
  if (pendingShardFreePull) { entry.free = true; entry.shardFree = true; pendingShardFreePull = false; }
  else if (pendingFreePull) { entry.free = true; pendingFreePull = false; }
  const h = loadPullHistory();
  h.push(entry);
  savePullHistory(h);
  sessionPulls.push(entry);

  // lifetime counter — seeds freePullEvery (and later, achievements)
  lifetimePullsCache++;
  storageSet({ [LIFETIME_PULLS_KEY]: String(lifetimePullsCache) });

  updateLedgerCounter();  // Mob Boss live $ counter (no-op when unequipped)
}

/* ---- free pulls (Court: freePullEvery / freePullChance) ----
 * Decided BEFORE the pull starts: a free pull never touches Throne — it
 * runs exactly like a sim-button pull (roll, pity, taunts, card crown,
 * progress ticks, summary entry) and the batch counter is NOT decremented
 * for it. After it resolves, content.js tells the background to fire the
 * next pull (freePullDone) — except when it was the last pull of the batch.
 */
function rollFreePull() {
  const mods = aggregateCourtMods();
  const fpe = mods.freePullEvery;
  if (fpe && (lifetimePullsCache + 1) % Math.round(fpe) === 0) return true;
  if (mods.freePullChance && !sessionFreePullUsed && Math.random() < mods.freePullChance) {
    sessionFreePullUsed = true;
    return true;
  }
  return false;
}

// sim-style pull inside a real batch — mirrors simulatePulls' doOne(), then
// signals the background so the next real pull (or the summary) can proceed
function runFreePull() {
  console.log('Court: this one\'s free — no throne interaction~');
  randomItemChosen = null;      // reset the memoized roll
  pendingFreePull = true;       // recordPull flags the entry (history + summary)
  chooseOneRandomItem();        // real roll: pity, taunts, history recording
  tickPullProgress();           // stage 1: "added to cart"
  setTimeout(tickPullProgress, 2000);  // stage 2: "checkout"
  setTimeout(() => { tickPullProgress(); resolveCardDraw(); }, 4000);  // stage 3: "payment" + crown card
  setTimeout(() => chrome.runtime.sendMessage({ action: 'freePullDone' }), 6000);
}

let sessionFreePullUsed = false;  // reset when the session summary shows

let sessionPulls = [];
let sessionTotal = 0;
let sessionStages = 0;  // each pull = 3 stages: cart, checkout, payment

/* ===================== PULL PROGRESS BAR ===================== */

function showPullProgress(total) {
  sessionTotal = total;
  sessionStages = 0;
  const bar = document.getElementById('pullProgress');
  if (!bar) return;
  renderPullProgress();
  bar.classList.add('show');
  const veil = document.getElementById('sessionVeil');
  if (veil) {
    // escape the overlay stacking context so the veil blurs the banner panel too
    if (veil.parentElement !== document.body) document.body.appendChild(veil);
    veil.classList.add('show');
  }
}

// advance one stage (cart → checkout → payment); 3 stages per pull
function tickPullProgress() {
  if (!sessionTotal) return;
  sessionStages = Math.min(sessionStages + 1, sessionTotal * 3);
  renderPullProgress();
}

function renderPullProgress() {
  const fill = document.getElementById('pullProgressFill');
  const text = document.getElementById('pullProgressText');
  if (!fill || !text || !sessionTotal) return;
  const totalStages = sessionTotal * 3;
  fill.style.height = Math.min(100, (sessionStages / totalStages) * 100) + '%';
  const pullsDone = Math.floor(sessionStages / 3);
  text.textContent = `${pullsDone}/${sessionTotal}`;
}

function hidePullProgress() {
  const bar = document.getElementById('pullProgress');
  if (!bar) return;
  bar.classList.remove('show');
  const veil = document.getElementById('sessionVeil');
  if (veil) veil.classList.remove('show');
  sessionTotal = 0;
  sessionStages = 0;
}

/* ===================== SUMMARY POPUP + SPARKLES ===================== */

function sparkleBurst(count = 40) {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    s.textContent = ['✦', '✧', '❋', '⋆'][Math.floor(Math.random() * 4)];
    s.style.left = (15 + Math.random() * 70) + 'vw';
    s.style.top = (20 + Math.random() * 55) + 'vh';
    s.style.fontSize = (10 + Math.random() * 26) + 'px';
    s.style.animationDelay = (Math.random() * 0.8) + 's';
    s.style.animationDuration = (1.2 + Math.random() * 1.4) + 's';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 3200);
  }
}

// Throne item prices ($) — used by the Court sessionLedger passive
const ITEM_PRICES = {
  "pathetic snack~": 5, "coffee": 10, "milk snack~": 15, "spit drink~": 25,
  "swipe meal~": 50, "cute meal~": 75, "hot meal~": 100, "soul buffet~": 250,
  "surrender buffet~": 500, "Birthday send~": 7.5
};

function showSessionSummary() {
  hidePullProgress();
  if (!sessionPulls.length) return;
  const cap = (s) => s.replace(/(^|\s)\S/g, c => c.toUpperCase());

  const counts = {};
  let bestTier = 'common';
  let freeCount = 0;
  sessionPulls.forEach(p => {
    // free pulls group separately — a free coffee never merges with a paid one
    const key = `${p.item}|${p.tier}|${p.free ? 'f' : 'p'}|${p.shardFree ? 's' : ''}`;
    counts[key] = counts[key] || { item: p.item, tier: p.tier, free: !!p.free, shardFree: !!p.shardFree, n: 0 };
    counts[key].n++;
    if (p.free) freeCount++;
    if (p.tier === 'reap') bestTier = 'reap';
    else if (p.tier === 'rare' && bestTier !== 'reap') bestTier = 'rare';
  });

  const order = { reap: 0, rare: 1, common: 2 };
  const rows = Object.values(counts)
    .sort((a, b) => order[a.tier] - order[b.tier])
    .map(c => {
      // shard-bought: bare "Free Pull"; card-effect free: item + free tag
      const label = c.shardFree ? 'Free Pull'
                  : c.free ? `${cap(c.item)} <span class="freeTag">free</span>`
                  : cap(c.item);
      return `<tr class="${c.tier}"><td>${label}${c.n > 1 ? ' ×' + c.n : ''}</td></tr>`;
    })
    .join('');

  // devotion XP: stored state still holds pre-session totals (refreshDevotion
  // hasn't saved yet), so the delta is exactly what this session earned —
  // base XP from new cards/dupes plus any Court bonus credited along the way
  Promise.all([getCollection(), loadDevotionState()]).then(([data, stored]) => {
    const totalNow = devotionComputeXP(data.cards) + (stored.bonusXP || 0);
    const gained = Math.max(0, Math.round(totalNow - stored.xp));
    const xpLine = document.getElementById('summaryXP');
    if (xpLine) xpLine.textContent = gained > 0 ? `+${gained} Devotion XP` : '';
  });

  // Court: sessionLedger adds a running $ total line
  const ledgerLine = aggregateCourtMods().sessionLedger
    ? `<p class="summaryLedger">💸 $${sessionPulls.reduce((s, p) => s + (ITEM_PRICES[p.item] || 0), 0)} spent on her~</p>`
    : '';
  const freeLine = freeCount
    ? `<p class="summaryFree">🎀 ${freeCount} pull${freeCount > 1 ? 's' : ''} free — she's feeling generous~</p>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'summaryModal';
  modal.innerHTML = `
    <div class="summaryCard ${bestTier}">
      <h2>${bestTier === 'reap' ? '💀 Reaped~' : bestTier === 'rare' ? '✦ Lucky You~' : '✦ All Done~'}</h2>
      <p class="summaryCount">${sessionPulls.length} Pull${sessionPulls.length > 1 ? 's' : ''}</p>
      <table>${rows}</table>
      ${ledgerLine}
      ${freeLine}
      <p id="summaryXP"></p>
      <p class="ratesClose">Tap anywhere to close~</p>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  modal.addEventListener('click', () => modal.remove());

  playTauntSound('summary', 'sounds/Summary.mp3', { volume: 0.5 });
  sparkleBurst(bestTier === 'reap' ? 80 : bestTier === 'rare' ? 55 : 35);
  sessionPulls = [];
  sessionFreePullUsed = false;  // new session — the freebie chance arms again
  updateLedgerCounter();
  refreshDevotion();   // session over — recompute XP + celebrate any level-ups
}

// Court: Mob Boss — live $ counter, top-right of the Pulls view
function updateLedgerCounter() {
  let el = document.getElementById('ledgerCounter');
  const active = aggregateCourtMods().sessionLedger && sessionPulls.length;
  if (!active) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('p');
    el.id = 'ledgerCounter';
    const main = document.getElementById('view-main');
    if (main) main.appendChild(el);
    else return;
  }
  const total = sessionPulls.reduce((s, p) => s + (ITEM_PRICES[p.item] || 0), 0);
  el.textContent = `💸 $${total}`;
}

/* ===================== HISTORY MODAL ===================== */

function showHistory() {
  const cap = (s) => s.replace(/(^|\s)\S/g, c => c.toUpperCase());
  const h = loadPullHistory().slice().reverse();

  const rows = h.length
    ? h.map(p => {
        const d = new Date(p.ts);
        const when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const label = p.shardFree ? 'Free Pull'
                    : p.free ? `${cap(p.item)} <span class="freeTag">free</span>`
                    : cap(p.item);
        return `<tr class="${p.tier}"><td>${label}</td><td class="histMeta">${cap(p.mode)}</td><td class="histMeta">${when}</td></tr>`;
      }).join('')
    : '<tr><td class="histMeta" style="text-align:center">No pulls yet~ go tempt fate</td></tr>';

  const modal = document.createElement('div');
  modal.id = 'historyModal';
  // carry the active overlay skin onto the modal (it lives outside .overlayBody)
  const overlayBody = document.querySelector('.overlayBody');
  if (overlayBody) {
    Object.values(SKINS).forEach(s => {
      if (s.cls && overlayBody.classList.contains(s.cls)) modal.classList.add(s.cls);
    });
  }
  modal.innerHTML = `
    <div class="summaryCard">
      <h2>✦ Pull History ✦</h2>
      <div class="histScroll"><table>${rows}</table></div>
      <p class="ratesClose">Tap anywhere to close~</p>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  modal.addEventListener('click', () => modal.remove());
}

/* ===================== TAUNT FEEDBACK ===================== */

const TAUNT = {
  WORDS: ["LOSER~", "IDIOT~", "SLAVE~", "BRAINDEAD~", "DRONE~"],
  RARE_HOLD_MS: 1500,
  REAP_DURATION_MS: 9000,
  REAP_WORD_INTERVAL_MS: 363,   // one word per half-beat (beat = 725ms)
  REAP_SPAWN_RATE_MS: 2200,   // slowed image spawn during reap
  MAX_WORDS_ALIVE: 8,
};

let tauntWashEl = null;
let tauntWordInterval = null;
let tauntEndTimeout = null;
let reapActive = false;

/* ---- taunt audio ---- */
const tauntAudio = {
  giggle: null,     // rare
  heartbeat: null,  // reap (looping)
};

function getTauntAudio(key, file, { loop = false, volume = 0.35, rate = 1.0 } = {}) {
  if (!tauntAudio[key]) {
    const a = new Audio(chrome.runtime.getURL(file));
    a.loop = loop;
    a.preload = 'auto';
    tauntAudio[key] = a;
  }
  tauntAudio[key].volume = volume;      // always apply latest volume
  tauntAudio[key].playbackRate = rate;  // always apply latest pitch/speed
  return tauntAudio[key];
}

function playTauntSound(key, file, opts) {
  try {
    const a = getTauntAudio(key, file, opts);
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch (e) {}
}

function stopTauntSound(key) {
  const a = tauntAudio[key];
  if (a) { a.pause(); a.currentTime = 0; }
}

function ensureWashDiv() {
  if (!tauntWashEl || !document.body.contains(tauntWashEl)) {
    tauntWashEl = document.createElement('div');
    tauntWashEl.id = 'tauntWash';
    document.body.appendChild(tauntWashEl);
  }
  return tauntWashEl;
}

function spawnTauntWord(word) {
  // cap simultaneous words — fade the oldest
  const alive = document.querySelectorAll('.taunt-word');
  if (alive.length >= TAUNT.MAX_WORDS_ALIVE) {
    alive[0].classList.remove('slam');
    alive[0].classList.add('fade');
    setTimeout(() => alive[0].remove(), 850);
  }

  const el = document.createElement('div');
  el.className = 'taunt-word';
  el.textContent = word || TAUNT.WORDS[Math.floor(Math.random() * TAUNT.WORDS.length)];
  el.style.left = (12 + Math.random() * 76) + 'vw';
  el.style.top = (15 + Math.random() * 65) + 'vh';
  el.style.fontSize = (3 + Math.random() * 4) + 'rem';
  el.style.setProperty('--tilt', (Math.random() * 24 - 12).toFixed(1) + 'deg');
  document.body.appendChild(el);

  // force reflow so the slam animation always restarts
  void el.offsetWidth;
  el.classList.add('slam');

  return el;
}

function fadeAndRemoveWord(el, delay) {
  setTimeout(() => {
    el.classList.remove('slam');
    el.classList.add('fade');
    setTimeout(() => el.remove(), 850);
  }, delay);
}

function rareTaunt() {
  const wash = ensureWashDiv();
  wash.className = '';
  void wash.offsetWidth;
  wash.classList.add('beat-rare');

  playTauntSound('giggle', 'sounds/giggle.wav', { volume: 0.35, rate: 0.96 });

  document.documentElement.classList.remove('taunt-shake-reap');
  document.documentElement.classList.add('taunt-shake-rare');

  const word = spawnTauntWord("LOSER~");
  word.style.fontSize = '9rem';
  word.style.left = '50vw';
  word.style.top = '42vh';

  fadeAndRemoveWord(word, TAUNT.RARE_HOLD_MS);
  setTimeout(() => {
    wash.classList.remove('beat-rare');
    document.documentElement.classList.remove('taunt-shake-rare');
  }, 1000);
}

function reapTaunt() {
  if (reapActive) return;
  reapActive = true;

  const wash = ensureWashDiv();
  wash.className = '';
  void wash.offsetWidth;
  wash.classList.add('beat-reap');

  document.documentElement.classList.remove('taunt-shake-rare');
  document.documentElement.classList.add('taunt-shake-reap');

  playTauntSound('heartbeat', 'sounds/heartbeat.mp3', { loop: true, volume: 0.3, rate: 0.8 });

  // slow the image spam down
  startImageSpawning(TAUNT.REAP_SPAWN_RATE_MS);

  // one taunt word per heartbeat
  spawnTauntWord();  // first word immediately
  tauntWordInterval = setInterval(spawnTauntWord, TAUNT.REAP_WORD_INTERVAL_MS);

  tauntEndTimeout = setTimeout(endReapTaunt, TAUNT.REAP_DURATION_MS);
}

function endReapTaunt() {
  reapActive = false;
  if (tauntWordInterval) { clearInterval(tauntWordInterval); tauntWordInterval = null; }
  if (tauntEndTimeout) { clearTimeout(tauntEndTimeout); tauntEndTimeout = null; }

  stopTauntSound('heartbeat');

  document.documentElement.classList.remove('taunt-shake-reap');
  if (tauntWashEl) tauntWashEl.classList.remove('beat-reap');

  // fade every surviving word
  document.querySelectorAll('.taunt-word').forEach(el => {
    el.classList.remove('slam');
    el.classList.add('fade');
    setTimeout(() => el.remove(), 850);
  });
}

function triggerTauntFeedback(tier) {
  if (tier === 'reap') reapTaunt();
  else if (tier === 'rare') rareTaunt();
}

// Court: Team Rocket tier-up celebration — "TEAM ROCKET~" slam + 4 copies
// of the card blasting across the screen (same slam/fade language as LOSER~)
function teamRocketTaunt() {
  const word = spawnTauntWord('TEAM ROCKET~');
  word.style.fontSize = '9rem';
  word.style.left = '50vw';
  word.style.top = '38vh';
  fadeAndRemoveWord(word, 1600);

  const art = cardDefs && cardDefs.b06 && cardDefs.b06.url;
  if (art) {
    for (let i = 0; i < 4; i++) {
      const img = document.createElement('img');
      img.src = art;
      img.className = 'team-rocket-card';
      img.style.left = (10 + Math.random() * 70) + 'vw';
      img.style.top = (15 + Math.random() * 60) + 'vh';
      img.style.setProperty('--tilt', (Math.random() * 40 - 20).toFixed(1) + 'deg');
      img.style.animationDelay = (i * 0.12) + 's';
      document.body.appendChild(img);
      setTimeout(() => img.remove(), 2100 + i * 120);
    }
  }
}

function addExactlyOneItem() {
  if (itemAdded) return;  

  setTimeout(() => {
    if (itemAdded) return;

    const target = chooseOneRandomItem();
    // Throne's new store markup: no more #parent wrappers — each item is a
    // card (div.group) holding an "Add to cart" button. Find the button,
    // walk up to its card, and match the item name against the card text.
    const addBtns = [...document.querySelectorAll('button')].filter(b =>
      (b.textContent || '').trim().toLowerCase() === 'add to cart' && !b.disabled);

    for (const btn of addBtns) {
      let card = btn;
      for (let i = 0; i < 6 && card; i++) {
        card = card.parentElement;
        if (card && card.className && card.className.toString().includes('group')) break;
      }
      if (card && card.textContent.toLowerCase().includes(target.toLowerCase())) {
        console.log(`Clicking "${target}"...`);
        btn.click();
        itemAdded = true;
        randomItemChosen = null;
        tickPullProgress();  // stage 1: added to cart
        break;
      }
    }

    clickCheckoutIfExists();
  }, 6000);
}

function clickCheckoutIfExists() {
  setTimeout(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === "checkout") {
        console.log("Clicking Checkout...");
        btn.click();
        tickPullProgress();  // stage 2: checkout
        return;
      }
    }
  }, 4000);
}

function clickPayNowIfExists() {
  // Throne's new payment flow: select "Credit Card" first, then click
  // "Pay Now" 2s later (the PayPal/Apple/Google radios must not steal focus).
  const clickPayNow = () => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const span = btn.querySelector("span");
      const spanText = span ? span.textContent.trim().toLowerCase() : '';
      const btnText = btn.textContent.trim().toLowerCase();
      if ((spanText === "pay now" || btnText === "pay now") && !btn.disabled) {
        console.log("Clicking Pay Now...");
        chrome.runtime.sendMessage({ action: 'pullComplete' });
        btn.click();
        payClicked = true;
        itemAdded = false;
        tickPullProgress();  // stage 3: payment done
        resolveCardDraw();   // crown this pull's card
        return;
      }
    }
  };

  setTimeout(() => {
    const radios = document.querySelectorAll('[role="radio"], button, label');
    let creditClicked = false;
    for (const el of radios) {
      if (el.textContent.trim().toLowerCase().includes("credit card")) {
        console.log("Clicking Credit Card...");
        el.click();
        creditClicked = true;
        break;
      }
    }
    if (!creditClicked) console.log("Credit Card option not found — trying Pay Now directly");
    setTimeout(clickPayNow, creditClicked ? 2000 : 0);
  }, 5000);
}

// Court: Only Pixels — image spam becomes sentence spam (taunt-styled).
const PIXEL_SENTENCES = [
  "Loser~",
  "Dumbass~",
  "Passive income~",
  "All4Alexia~",
  "Wallet~",
  "Gooner~",
  "Snuff bait~",
  "You're mine~",
  "It's all mine~",
  "All of it~",
  "I'm going to steal it all~",
  "You're just an EXP-snack~",
  "You're just prey~",
  "Only Alexia~",
  "Puppet~",
  "Pump pump pump~",
  "Stroke stroke stroke~"
];

function spawnSentence(bg, overlay) {
  const el = document.createElement('div');
  el.className = 'pixel-sentence';
  el.textContent = PIXEL_SENTENCES[Math.floor(Math.random() * PIXEL_SENTENCES.length)];
  el.style.left = (12 + Math.random() * 76) + 'vw';
  el.style.top = (15 + Math.random() * 65) + 'vh';
  el.style.fontSize = (1.6 + Math.random() * 2.2) + 'rem';
  el.style.setProperty('--tilt', (Math.random() * 24 - 12).toFixed(1) + 'deg');
  // foreground sentences need the same z-index as spam images
  el.style.position = 'fixed';
  el.style.zIndex = bg ? "2147483545" : SPAM_Z;
  if (bg) el.classList.add('behind-glass');
  (bg && overlay ? overlay : document.body).appendChild(el);
  void el.offsetWidth;
  el.classList.add('slam');
  const isGhost = bg && !overlay;
  setTimeout(() => {
    el.classList.remove('slam');
    el.classList.add('fade');
    setTimeout(() => el.remove(), 850);
  }, isGhost ? 2000 : 9000);
}

function spawnImage() {
  const bg = spawnBackgroundMode;
  const overlay = document.querySelector('.overlayBody');
  // Court: Only Pixels — sentences replace the pictures entirely
  if (aggregateCourtMods().sentenceSpam) { spawnSentence(bg, overlay); return; }
  // store-page ghosts follow the active skin's hue
  const skinHue = overlay && overlay.classList.contains('skin-crimson') ? '-100deg'
                : overlay && overlay.classList.contains('skin-moonlit') ? '145deg'
                : overlay && overlay.classList.contains('skin-golden')  ? '-55deg'
                : overlay && overlay.classList.contains('skin-void')    ? '35deg'
                : overlay && overlay.classList.contains('skin-sakura')  ? '-25deg'
                : overlay && overlay.classList.contains('skin-silver')  ? '190deg'
                : overlay && overlay.classList.contains('skin-ember')   ? '-75deg'
                : overlay && overlay.classList.contains('skin-reaper')  ? '-60deg'
                : '-15deg';
  // during foreground pulls, ~35% of spawns are cards from the parade
  let cardSrc = null;
  if (!bg && currentPullCardIds.length && Math.random() < 0.35) {
    const c = pickSpamCard();
    if (c) cardSrc = c.url;
  }
  // bg + overlay open: child of overlay (z 1 — above opaque bg, below content)
  // bg, no overlay: just under the overlay layer, above the page
  // foreground: max z-index on body
  const imageElement = createImage("fixed", (bg && overlay) ? "1" : (bg ? "2147483545" : SPAM_Z), cardSrc || undefined);
  if (cardSrc) imageElement.classList.add('spam-card');
  if (bg) {
    imageElement.classList.add('behind-glass');
    // on the bare store page, ghost intensity scales with pity
    if (!overlay) {
      const { pullsSince8pct, pullsSinceSoulReap } = loadPityCounters();
      const intensity = Math.min(1, (pullsSince8pct / 10) * 0.5 + (pullsSinceSoulReap / 80) * 0.5);
      imageElement.style.opacity = (0.15 + intensity * 0.45).toFixed(2);
      imageElement.style.filter = `brightness(${(0.45 + intensity * 0.35).toFixed(2)}) saturate(${(0.3 + intensity * 0.7).toFixed(2)}) blur(${Math.max(0.5, 3 - intensity * 2.5).toFixed(1)}px) hue-rotate(${skinHue})`;
    }
  }
  imageElement.style.left = Math.random() * (window.innerWidth - 450) + "px";
  imageElement.style.top = Math.random() * (window.innerHeight - 600) + "px";
  (bg && overlay ? overlay : document.body).appendChild(imageElement);

  // store-page ghosts flicker briefly; aquarium + pull spam linger
  const isGhost = bg && !overlay;
  setTimeout(() => imageElement.remove(), isGhost ? 2000 : 10000);
}

function createImage(positionType, index, imgSrc = imageURLs[Math.floor(Math.random() * imageURLs.length)]) {
  const randomImage = imgSrc;
  const tempImage = document.createElement('img');
  tempImage.src = randomImage;
  tempImage.className = "popup-image";
  tempImage.style.position = positionType;
  tempImage.style.zIndex = index;

  return tempImage;
}

let imageInterval = null;
let spawnBackgroundMode = false;

// ambient spawn rate on the store page scales with pity:
// one ghost every ~15s at 0 pity, every ~1s as soul-reap pity nears 80
function ambientSpawnDelay() {
  const { pullsSince8pct, pullsSinceSoulReap } = loadPityCounters();
  const intensity = Math.min(1, (pullsSince8pct / 10) * 0.4 + (pullsSinceSoulReap / 80) * 0.6);
  return Math.round(15000 - intensity * 14000);  // 15000ms → 1000ms
}

function startImageSpawning(rate = 1000, { background = false } = {}) {
  spawnBackgroundMode = background;
  if (imageInterval) { clearInterval(imageInterval); clearTimeout(imageInterval); imageInterval = null; }
  if (background) {
    // self-rescheduling: overlay aquarium stays at a gentle fixed rate,
    // store-page ghosts follow the pity-scaled ramp
    const tick = () => {
      spawnImage();
      schedule();
    };
    const schedule = () => {
      const delay = document.querySelector('.overlayBody') ? 3000 : ambientSpawnDelay();
      imageInterval = setTimeout(tick, delay);
    };
    // seed the tank immediately — no dead air on open, 1s stagger
    spawnImage();
    setTimeout(spawnImage, 1000);
    setTimeout(spawnImage, 2000);
    schedule();
  } else {
    imageInterval = setInterval(spawnImage, rate);
  }
}

// bring any behind-glass images to the front (used when a pull begins)
function promoteImagesToForeground() {
  spawnBackgroundMode = false;
  document.querySelectorAll('.popup-image.behind-glass').forEach(el => {
    el.classList.remove('behind-glass');
    el.style.zIndex = SPAM_Z;
    if (el.parentElement && el.parentElement.classList.contains('overlayBody')) {
      document.body.appendChild(el);  // escape the overlay stacking context
    }
  });
}

function stopImageSpawning() {
  if (imageInterval) {
    clearInterval(imageInterval);
    clearTimeout(imageInterval);
    imageInterval = null;
  }
  spawnBackgroundMode = false;
  // cancel any running reap taunt state
  if (reapActive) endReapTaunt();
  stopTauntSound('giggle');
  stopTauntSound('heartbeat');
  // sweep up lingering spam images, taunt words, wash
  document.querySelectorAll('.popup-image, .taunt-word, #tauntWash').forEach(el => el.remove());
  tauntWashEl = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'doPull') {
    promoteImagesToForeground();
    startImageSpawning();
    // free-pull check happens BEFORE any throne interaction — a free pull
    // runs sim-style and never touches the store page
    if (rollFreePull()) {
      setTimeout(() => runFreePull(), 2000);
    } else {
      setTimeout(() => addExactlyOneItem(), 2000);
    }
    sendResponse({ ok: true });
  }
  if (msg.action === 'doPayment') {
    // no promoteImagesToForeground/startImageSpawning here — checkout is an SPA
    // transition, the spam from doPull is already running; restarting the
    // interval just churns the page while reCAPTCHA is trying to work
    clickPayNowIfExists();    // pays and signals pullComplete to background
    sendResponse({ ok: true });
  }
  if (msg.action === 'allPullsDone') {
    stopImageSpawning();
    // single pull: let the crown moment breathe an extra second before the summary
    const summaryDelay = sessionTotal === 1 ? 1000 : 0;
    setTimeout(() => showSessionSummary(), summaryDelay);
    startImageSpawning(3000, { background: true });  // aquarium resumes behind the card
    sendResponse({ ok: true });
  }
  return true;
});

// ambient behind-glass spam while idle
startImageSpawning(3000, { background: true });
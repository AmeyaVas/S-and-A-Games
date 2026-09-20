/* Pentakeover — DOM wiring, input handling and the turn runner. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let game = null;
  let hover = null;
  let sel = { region: null, units: new Set(), mode: null, targets: new Set(), tone: 'move' };
  let ai = null;
  let aiTimer = null;
  let logDrawn = 0;
  let overShown = false;
  let aiSteps = 0;
  let expandGlow = new Set();      // Free Holds the selected station could buy

  /* ---------- helpers ---------- */

  function human() {
    return game && game.winner === null && !game.factions[game.current].isAI;
  }

  function selectedRegion() {
    return sel.region === null ? null : game.regions[sel.region];
  }

  function selectedUnits() {
    const r = selectedRegion();
    if (!r) return [];
    return r.units.filter(u => sel.units.has(u.id));
  }

  function clearOrders() {
    sel.units.clear();
    sel.mode = null;
    sel.targets = new Set();
  }

  /* The war can end on anyone's turn — including in the middle of an AI's,
   * when it takes a rival's last region. Every path that could have ended it
   * runs through here, so the result screen is never missed. */
  function finishIfOver() {
    if (!game || game.winner === null || overShown) return false;
    overShown = true;
    stopAI();
    syncAll();
    showGameOver();
    return true;
  }

  /* ---------- setup ---------- */

  function showSetup() {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const p = FACTION_PRESETS[i];
      const on = i < 3;
      rows.push(`
        <div class="setup-row${on ? '' : ' off'}" data-idx="${i}">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="fname">${p.name}</span>
          <select class="role" data-idx="${i}">
            <option value="off"${on ? '' : ' selected'}>Not playing</option>
            <option value="human"${i === 0 ? ' selected' : ''}>Human</option>
            <option value="ai"${on && i !== 0 ? ' selected' : ''}>Computer</option>
          </select>
          <select class="diff" data-idx="${i}">
            <option value="levy">Levy</option>
            <option value="veteran" selected>Veteran</option>
            <option value="warlord">Warlord</option>
          </select>
        </div>`);
    }

    openOverlay(`
      <h1 class="ovtitle">PENTA<span>KEOVER</span></h1>
      <p class="ovlead">Five unit types. Five factions. Five citadels.<br>
        Hold every citadel through a full round — or be the last banner standing.</p>
      <div class="setup">${rows.join('')}</div>
      <div class="setup-opts">
        <label>Map size
          <select id="optScale">
            <option value="0.75">Cramped</option>
            <option value="1" selected>Standard</option>
            <option value="1.3">Sprawling</option>
          </select>
        </label>
        <label>Seed <input id="optSeed" type="text" value="${(Math.random() * 1e9) | 0}"></label>
      </div>
      <p id="setupWarn" class="ovwarn" hidden></p>
      <div class="ovbtns">
        <button id="btnGuide2" class="ghost" type="button">How to play</button>
        <button id="btnCodex2" class="ghost" type="button">Read the codex</button>
        <button id="btnStart" class="primary big" type="button">Begin the war</button>
      </div>
      <!-- The overlay covers the top bar's own back link on first load, so the
           way out of the game has to be repeated in here. -->
      <p class="ovback"><a href="../index.html">&larr; All games</a></p>`, false);

    $('overlayCard').addEventListener('change', e => {
      if (e.target.classList.contains('role')) {
        const row = e.target.closest('.setup-row');
        row.classList.toggle('off', e.target.value === 'off');
        row.querySelector('.diff').disabled = e.target.value !== 'ai';
      }
    });
    $('overlayCard').querySelectorAll('.role').forEach(s => {
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    $('btnStart').addEventListener('click', startFromSetup);
    $('btnGuide2').addEventListener('click', showHowToPlay);
    $('btnCodex2').addEventListener('click', () => showCodex(showSetup));
  }

  function startFromSetup() {
    const factions = [];
    let humans = 0;
    $('overlayCard').querySelectorAll('.setup-row').forEach(row => {
      const idx = +row.dataset.idx;
      const role = row.querySelector('.role').value;
      if (role === 'off') return;
      if (role === 'human') humans++;
      factions.push({
        isAI: role === 'ai',
        difficulty: row.querySelector('.diff').value,
        label: FACTION_PRESETS[idx].name
      });
    });

    if (factions.length < 2) {
      const w = $('setupWarn');
      w.textContent = 'A war needs at least two factions.';
      w.hidden = false;
      return;
    }
    if (humans === 0) {
      const w = $('setupWarn');
      w.textContent = 'Set at least one faction to Human, or there is nobody to play.';
      w.hidden = false;
      return;
    }

    const raw = $('optSeed').value.trim();
    let seed = 0;
    for (let i = 0; i < raw.length; i++) seed = (seed * 31 + raw.charCodeAt(i)) >>> 0;
    if (!seed) seed = (Math.random() * 1e9) >>> 0;

    closeOverlay();
    newGame({ factions, seed, mapScale: parseFloat($('optScale').value) });
  }

  function newGame(opts) {
    stopAI();
    game = createGame(opts);
    sel = { region: null, units: new Set(), mode: null, targets: new Set(), tone: 'move' };
    hover = null;
    logDrawn = 0;
    overShown = false;
    $('log').innerHTML = '';
    Renderer.resize();
    syncAll();
    maybeRunAI();
  }

  /* ---------- overlays ---------- */

  function openOverlay(html, dismissible) {
    $('overlayCard').innerHTML = html;
    $('overlayCard').dataset.dismissible = dismissible ? '1' : '0';
    $('overlay').hidden = false;
  }

  function closeOverlay() { $('overlay').hidden = true; }

  /* ---------- how to play ---------- */

  // Shown once, the first time someone opens the game. After that it is a
  // button, not a gate. Storage can be unavailable on file:// pages, in which
  // case the guide simply greets every visit — no worse than not having it.
  const GUIDE_KEY = 'pentakeover.guideSeen';

  function guideSeen() {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; }
  }
  function markGuideSeen() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* nothing to do */ }
  }

  function counterTriangle() {
    return `
      <svg class="tri" viewBox="0 0 340 210" role="img"
           aria-label="Lancer beats Ballista, Ballista beats Warden, Warden beats Lancer">
        <defs>
          <marker id="pkArrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#ffd76a"></path>
          </marker>
        </defs>
        <g stroke="#ffd76a" stroke-width="2" fill="none" marker-end="url(#pkArrow)">
          <path d="M193 65 L261 133"></path>
          <path d="M256 160 L90 160"></path>
          <path d="M75 137 L143 69"></path>
        </g>
        <g font-size="10" fill="#8ca0b6" font-style="italic">
          <text x="250" y="95">beats</text>
          <text x="173" y="151" text-anchor="middle">beats</text>
          <text x="90" y="99" text-anchor="end">beats</text>
        </g>
        <g stroke="#4d6076" stroke-width="1.5" fill="#1a222c">
          <circle cx="170" cy="42" r="30"></circle>
          <circle cx="288" cy="160" r="30"></circle>
          <circle cx="52" cy="160" r="30"></circle>
        </g>
        <g text-anchor="middle" font-family="ui-monospace, Consolas, monospace">
          <text x="170" y="42" font-size="15" font-weight="700" fill="#dfe6ee">L</text>
          <text x="170" y="56" font-size="8.5" fill="#8ca0b6">Lancer</text>
          <text x="288" y="160" font-size="15" font-weight="700" fill="#dfe6ee">B</text>
          <text x="288" y="174" font-size="8.5" fill="#8ca0b6">Ballista</text>
          <text x="52" y="160" font-size="15" font-weight="700" fill="#dfe6ee">W</text>
          <text x="52" y="174" font-size="8.5" fill="#8ca0b6">Warden</text>
        </g>
      </svg>`;
  }

  function legend() {
    const star = `<svg width="22" height="22" viewBox="0 0 22 22"><polygon
      points="11,2 13,8.5 19.5,8.5 14.2,12.5 16.2,19 11,15 5.8,19 7.8,12.5 2.5,8.5 9,8.5"
      fill="#ffd76a" stroke="rgba(40,28,0,.8)" stroke-width="1"/></svg>`;
    const crown = `<svg width="22" height="22" viewBox="0 0 22 22"><path
      d="M3,16 L3,9 L6.5,12.5 L9,6 L11,12 L13,6 L15.5,12.5 L19,9 L19,16 Z"
      fill="#c9d2dc" stroke="rgba(10,14,18,.85)" stroke-width="1"/></svg>`;
    const chip = `<svg width="30" height="22" viewBox="0 0 30 22"><rect x="2" y="4" width="26"
      height="15" rx="4" fill="rgba(8,11,15,.9)" stroke="#d2463f" stroke-width="1.3"/>
      <text x="15" y="12.5" text-anchor="middle" dominant-baseline="middle" font-size="9"
      font-weight="700" font-family="ui-monospace, Consolas, monospace" fill="#ffd9d6">M3</text></svg>`;
    const border = `<svg width="30" height="22" viewBox="0 0 30 22">
      <path d="M2,3 L13,3 L13,19 L2,19 Z" fill="#5c6b4a"/>
      <path d="M17,3 L28,3 L28,19 L17,19 Z" fill="#6e2f2b"/>
      <path d="M15,2 L15,20" stroke="#d2463f" stroke-width="2.6"/></svg>`;
    const bar = `<svg width="30" height="22" viewBox="0 0 30 22">
      <rect x="2" y="9" width="26" height="4" rx="2" fill="#0b0f14"/>
      <rect x="2" y="9" width="11" height="4" rx="2" fill="#e8c35a"/></svg>`;

    return `
      <div class="legend">
        <div class="legend-row">${star}<span>A <b>citadel</b>. Hold all five to win.</span></div>
        <div class="legend-row">${crown}<span>A <b>seat</b> — someone's capital. Seats and citadels are <b>stations</b>: recruiting and expansion happen there.</span></div>
        <div class="legend-row">${chip}<span>A <b>garrison</b>: unit letter and how many. This is three Militia.</span></div>
        <div class="legend-row">${border}<span>A bright border is a <b>frontier</b> with someone else. Hairlines are your own seams.</span></div>
        <div class="legend-row">${bar}<span>A bar under the chips means that stack is <b>wounded</b>. It heals when it rests.</span></div>
      </div>`;
  }

  function showHowToPlay() {
    openOverlay(`
      <h1 class="ovtitle">PENTA<span>KEOVER</span></h1>
      <p class="guide-lead">
        You command one faction on a map of contested regions. Take ground, raise an
        army you can afford, and either <b>hold all five citadels through a full
        round</b> or knock every rival off the map.
      </p>

      <div class="guide">
        <section class="gsec">
          <h4>A turn, in order</h4>
          <ol class="steps">
            <li><b>Income arrives</b> automatically, minus the wages of your army.</li>
            <li><b>Recruit</b> at any station — your seat or a citadel you hold. New troops march next turn.</li>
            <li><b>Expand</b> from a station into a neighbouring Free Hold, for gold. As many as
                you can pay for, though each one this turn costs more than the last.</li>
            <li><b>Give orders</b> — click one of your regions, then click a highlighted neighbour.</li>
            <li><b>End your turn</b> and watch everyone else move.</li>
          </ol>
        </section>

        <section class="gsec">
          <h4>Giving orders</h4>
          <p>Clicking a region you own picks up everything that can still move. Untick
             anyone you want left behind, then click a highlighted region.</p>
          <p><b>Move / Attack</b> goes into a neighbour. <b>Bombard</b> (Ballistas only)
             shells an adjacent region without entering it and takes no return fire — but
             never captures. <b>Redeploy</b> rails unmoved troops anywhere in your own
             connected territory for a little gold.</p>
          <p>Before you commit, the <b>battle forecast</b> shows your real odds and what
             the fight is likely to cost.</p>
        </section>

        <section class="gsec">
          <h4>Moving the map</h4>
          <p>Drag the map to slide it, and use the wheel or the <b>+</b> and <b>−</b>
             buttons to zoom; <b>⤢</b> puts the whole continent back in view. On a
             touch screen pinch to zoom and use <b>two fingers</b> to slide — one
             finger scrolls the page, so a phone can always get past the map.</p>
          <p>The grip on the map's edge resizes it: drag it sideways to trade space
             with the sidebar, or up and down once the page has stacked.</p>
        </section>

        <section class="gsec">
          <h4>Buying land</h4>
          <p>Select a station and the <b>Expand</b> panel prices every unclaimed Free Hold
             on its border; the map dashes them in gold. There is no limit but your
             treasury — each expansion in the same turn costs
             ${Math.round((EXPAND_STEP - 1) * 100)}% more than the one before, and the
             tariff resets next turn.</p>
          <p>The ground arrives <b>empty</b> — the Free Hold garrison goes home rather than
             joining you — so walk somebody in before a rival does. Citadels and other
             factions' land are never for sale.</p>
        </section>

        <section class="gsec">
          <h4>The counter triangle</h4>
          ${counterTriangle()}
          <p>The bonus is biggest against a <b>pure</b> army and small against a mixed one,
             so fielding a bit of everything is itself a defence.</p>
        </section>

        <section class="gsec">
          <h4>Reading the map</h4>
          ${legend()}
        </section>

        <section class="gsec">
          <h4>Three things that win games</h4>
          <p><b>Bring militia.</b> Casualties always land on your cheapest units first, so a
             screen of militia is armour for the expensive troops behind it.</p>
          <p><b>Respect the ground.</b> Defenders multiply their strength by terrain. A
             citadel on hills defends at nearly double — walk cavalry into one and it dies.</p>
          <p><b>Concentrate.</b> Two units per region everywhere means a front nobody can
             cross. Mass a stack in one place and push there.</p>
        </section>

        <section class="gsec">
          <h4>Keys</h4>
          <p class="keys">
            <span><kbd>Space</kbd> end turn</span>
            <span><kbd>Esc</kbd> clear selection</span>
            <span><kbd>C</kbd> unit codex</span>
            <span><kbd>H</kbd> this page</span>
          </p>
          <p>Every unit's exact numbers live in the codex. You do not need them to start.</p>
        </section>
      </div>

      <div class="ovbtns">
        <button id="btnGuideCodex" class="ghost" type="button">Unit codex</button>
        <button id="btnGuidePlay" class="primary big" type="button">Start a game</button>
      </div>
      <p class="ovback"><a href="../index.html">&larr; All games</a></p>`, true);

    $('btnGuidePlay').addEventListener('click', () => { markGuideSeen(); showSetup(); });
    $('btnGuideCodex').addEventListener('click', () => showCodex(showHowToPlay));
  }

  function showCodex(onBack) {
    // `onBack` is only a function when a caller passed one; a click handler
    // hands us an Event instead, which falls through to the default.
    const back = typeof onBack === 'function' ? onBack : null;
    const rows = UNIT_ORDER.map(t => {
      const u = UNITS[t];
      const counter = COUNTERS[t] ? UNITS[COUNTERS[t]].name : '—';
      return `<tr>
        <td class="uname"><span class="uglyph">${u.glyph}</span>${u.name}</td>
        <td>${u.cost}</td><td>${u.upkeep}</td><td>${u.hp}</td>
        <td>${u.atk}</td><td>${u.def}</td><td>${u.move}</td>
        <td class="ctr">${counter}</td>
        <td class="ublurb">${u.blurb}</td>
      </tr>`;
    }).join('');

    openOverlay(`
      <h2 class="ovtitle small">Codex</h2>
      <table class="codex">
        <thead><tr>
          <th>Unit</th><th>Cost</th><th>Upkeep</th><th>HP</th>
          <th>Atk</th><th>Def</th><th>Move</th><th>Strong vs</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="codex-notes">
        <div>
          <h4>The triangle</h4>
          <p>Lancer beats Ballista beats Warden beats Lancer. The bonus is up to
             <b>+75%</b>, scaled by how much of the enemy stack is actually that type —
             so a counter is worth most against a pure army and little against a mixed one.</p>
        </div>
        <div>
          <h4>Casualties</h4>
          <p>Damage lands on the <b>cheapest units first</b>. Three militia in front of a
             ballista is not padding, it is armour.</p>
        </div>
        <div>
          <h4>Ground</h4>
          <p>Defenders multiply their power by terrain: plains +0%, forest +20%,
             hills +40%, mountains +65%. A capital adds +30%, a citadel +50%.</p>
        </div>
        <div>
          <h4>Orders</h4>
          <p><b>Move/Attack</b> into a neighbour. <b>Bombard</b> hits an adjacent region
             without entering it, and never captures. <b>Redeploy</b> rails unmoved units
             anywhere in your connected territory for ${REDEPLOY_COST} gold each.</p>
        </div>
        <div>
          <h4>Winning</h4>
          <p>Hold all ${CITADEL_COUNT} citadels at the start of your turn — meaning you survived a
             full round holding them — or eliminate everyone else.</p>
        </div>
        <div>
          <h4>Money</h4>
          <p>Income arrives at the start of your turn, minus upkeep. Go into the red and
             your cheapest paid troops desert. Recruit only at your stations — your seat
             and the citadels you hold.</p>
        </div>
        <div>
          <h4>Expansion</h4>
          <p>A station can buy an adjacent <b>Free Hold</b> outright, as many times a turn as
             the treasury allows — but each one costs ${Math.round((EXPAND_STEP - 1) * 100)}%
             more than the last, and the ground arrives undefended.</p>
        </div>
      </div>
      <div class="ovbtns">
        <button id="btnCodexGuide" class="ghost" type="button">How to play</button>
        <button id="btnCloseCodex" class="primary" type="button">Back</button>
      </div>`, true);
    $('btnCodexGuide').addEventListener('click', showHowToPlay);
    $('btnCloseCodex').addEventListener('click', () => {
      if (back) { back(); return; }
      closeOverlay();
      if (!game) showSetup();
    });
  }

  function showGameOver() {
    const w = game.winner;
    const name = w.faction === null ? 'Nobody' : game.factions[w.faction].label;
    const color = w.faction === null ? '#888' : game.factions[w.faction].color;
    openOverlay(`
      <h2 class="ovtitle small" style="color:${color}">${name} wins</h2>
      <p class="ovlead">${w.how === 'citadels'
        ? 'All five citadels held through a full round. That is a pentakeover.'
        : 'Every rival banner has been torn down.'}</p>
      <p class="ovsub">Round ${game.round} · seed ${game.seed}</p>
      <div class="ovbtns"><button id="btnAgain" class="primary big" type="button">New game</button></div>`, true);
    $('btnAgain').addEventListener('click', () => { closeOverlay(); showSetup(); });
  }

  /* ---------- panels ---------- */

  function syncAll() {
    syncTop();
    syncRegion();
    syncLog();
  }

  function syncTop() {
    if (!game) return;
    const f = game.factions[game.current];
    $('roundLabel').textContent = `Round ${game.round}`;
    const chip = $('factionChip');
    chip.textContent = f.label + (f.isAI ? ' · CPU' : '');
    chip.style.background = f.color;
    chip.style.color = '#0b0e12';
    $('statGold').textContent = f.gold;
    const inc = netIncome(game, f.id);
    $('statIncome').textContent = (inc >= 0 ? '+' : '') + inc;
    $('statIncome').className = inc >= 0 ? '' : 'neg';
    $('statRegions').textContent = ownedRegions(game, f.id).length;
    $('statCitadels').textContent = `${citadelsHeld(game, f.id)}/${CITADEL_COUNT}`;
    $('btnEnd').disabled = !human();

    const banner = $('banner');
    if (game.winner !== null) {
      banner.hidden = true;
    } else if (f.isAI) {
      banner.hidden = false;
      banner.textContent = `${f.label} is moving…`;
      banner.style.borderColor = f.color;
    } else {
      banner.hidden = true;
    }
  }

  function syncRegion() {
    const r = selectedRegion();
    const facts = $('regionFacts');
    const garrison = $('garrisonPanel');
    const recruitP = $('recruitPanel');

    if (!r) {
      $('regionName').textContent = 'No region selected';
      $('regionHint').hidden = false;
      $('regionHint').textContent = 'Click a region on the map to inspect it.';
      facts.hidden = true;
      garrison.hidden = true;
      recruitP.hidden = true;
      $('expandPanel').hidden = true;
      expandGlow = new Set();
      $('forecastPanel').hidden = true;
      return;
    }

    $('regionName').textContent = regionLabel(r);
    $('regionHint').hidden = true;
    facts.hidden = false;
    $('factOwner').textContent = factionName(game, r.owner);
    $('factOwner').style.color = factionColor(game, r.owner);
    $('factTerrain').textContent = TERRAIN[r.terrain].name;
    $('factIncome').textContent = r.owner === null ? '—' : `${regionIncome(game, r)} gold`;
    $('factDefence').textContent = `×${defenceMultiplier(r).toFixed(2)}`;

    // Garrison
    garrison.hidden = r.units.length === 0;
    $('garrisonCount').textContent = r.units.length ? `· ${r.units.length}` : '';
    renderUnits(r);

    // A station — your seat or a citadel you hold — recruits troops and buys land.
    const atStation = human() && isStation(game, r, game.current);
    recruitP.hidden = !atStation;
    if (atStation) renderRecruit(r);
    $('expandPanel').hidden = !atStation;
    if (atStation) renderExpand(r); else expandGlow = new Set();

    syncForecast();
  }

  function renderUnits(r) {
    const list = $('unitList');
    const mine = human() && r.owner === game.current;
    list.innerHTML = '';

    const sorted = r.units.slice().sort((a, b) =>
      UNIT_ORDER.indexOf(a.type) - UNIT_ORDER.indexOf(b.type) || a.id - b.id);

    for (const u of sorted) {
      const t = UNITS[u.type];
      const row = document.createElement('div');
      const spent = u.mp <= 0;
      row.className = 'unit' + (sel.units.has(u.id) ? ' picked' : '') + (spent ? ' spent' : '') + (mine ? ' mine' : '');
      row.innerHTML = `
        <span class="uglyph" style="border-color:${factionColor(game, u.owner)}">${t.glyph}</span>
        <span class="uinfo">
          <b>${t.name}</b>
          <small>${Math.ceil(u.hp)}/${u.maxHp} hp · ${t.atk}/${t.def} · ${spent ? 'spent' : u.mp + ' mp'}</small>
        </span>
        <span class="uhp"><i style="width:${Math.max(4, (u.hp / u.maxHp) * 100)}%;background:${
          u.hp / u.maxHp > 0.5 ? '#6fd98a' : u.hp / u.maxHp > 0.25 ? '#e8c35a' : '#e86a5a'}"></i></span>`;
      if (mine) {
        row.addEventListener('click', () => {
          if (sel.units.has(u.id)) sel.units.delete(u.id); else sel.units.add(u.id);
          afterSelectionChange();
        });
      }
      list.appendChild(row);
    }

    const any = mine && r.units.length > 0;
    $('selectionBar').hidden = !any;
    $('orderBar').hidden = !any;
    if (any) {
      const picked = selectedUnits();
      $('selectionText').textContent = picked.length
        ? `${picked.length} selected`
        : 'Select units to give orders';
      const movable = picked.filter(u => u.mp > 0);
      $('btnMove').disabled = movable.length !== picked.length || picked.length === 0;
      $('btnBombard').disabled = picked.length === 0 ||
        !picked.every(u => u.type === 'ballista' && u.mp > 0 && !u.bombarded);
      $('btnRedeploy').disabled = picked.length === 0 ||
        !picked.every(u => u.mp >= UNITS[u.type].move) ||
        game.factions[game.current].gold < picked.length * REDEPLOY_COST;
      for (const [id, mode] of [['btnMove', 'move'], ['btnBombard', 'bombard'], ['btnRedeploy', 'redeploy']]) {
        $(id).classList.toggle('active', sel.mode === mode);
      }
      const hint = $('orderHint');
      if (sel.mode) {
        hint.hidden = false;
        hint.textContent = sel.mode === 'move'
          ? 'Click a highlighted neighbour to march or attack.'
          : sel.mode === 'bombard'
            ? 'Click a highlighted enemy region to shell it. No ground is taken.'
            : `Click any highlighted region in your territory. ${REDEPLOY_COST} gold per unit.`;
      } else hint.hidden = true;
    }
  }

  function renderRecruit(r) {
    const list = $('recruitList');
    const f = game.factions[game.current];
    list.innerHTML = '';
    for (const t of UNIT_ORDER) {
      const u = UNITS[t];
      const ok = f.gold >= u.cost;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recruit' + (ok ? '' : ' broke');
      btn.disabled = !ok;
      btn.innerHTML = `
        <span class="uglyph">${u.glyph}</span>
        <span class="rinfo"><b>${u.name}</b><small>${u.hp}hp · ${u.atk}/${u.def} · mv${u.move}</small></span>
        <span class="rcost">${u.cost}g</span>`;
      btn.addEventListener('click', () => {
        if (recruit(game, r, game.current, t)) { syncAll(); }
      });
      list.appendChild(btn);
    }
  }

  /* Territory expansion. Every station offers the Free Holds on its own border,
   * cheapest first, and there is no limit but the treasury: each purchase this
   * turn raises the price of the next one. */
  function renderExpand(station) {
    const list = $('expandList');
    const f = game.factions[game.current];
    const opts = station.neighbors
      .map(n => game.regions[n])
      .filter(t => t.owner === null && t.kind !== 'citadel')
      .map(t => ({ region: t, cost: expandCost(game, t, f.id) }))
      .sort((a, b) => a.cost - b.cost);

    expandGlow = new Set(opts.map(o => o.region.id));
    list.innerHTML = '';

    const hint = $('expandHint');
    if (opts.length === 0) {
      hint.textContent = 'No Free Holds border this station. Citadels and rival land are never for sale.';
      return;
    }

    for (const o of opts) {
      const t = o.region;
      const ok = f.gold >= o.cost;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recruit expand' + (ok ? '' : ' broke');
      btn.disabled = !ok;
      btn.innerHTML = `
        <span class="uglyph">+</span>
        <span class="rinfo">
          <b>${regionLabel(t)}</b>
          <small>${TERRAIN[t.terrain].name} · +${
            TERRAIN[t.terrain].income + KIND_BONUS[t.kind].income} gold · ${
            t.units.length} defender${t.units.length === 1 ? '' : 's'}</small>
        </span>
        <span class="rcost">${o.cost}g</span>`;
      btn.addEventListener('click', () => {
        // Stay on the station afterwards so another expansion is one click away.
        if (expand(game, station, t, game.current)) syncAll();
      });
      list.appendChild(btn);
    }

    const surcharge = Math.round((Math.pow(EXPAND_STEP, f.expansions) - 1) * 100);
    hint.textContent = f.expansions === 0
      ? 'Buy as many as you can pay for. Each expansion this turn raises the price of the next.'
      : `${f.expansions} bought this turn — prices are up ${surcharge}%. They reset next turn.`;
  }

  function syncForecast() {
    const panel = $('forecastPanel');
    const from = selectedRegion();
    const picked = selectedUnits();
    if (!from || picked.length === 0 || hover === null || !sel.targets.has(hover)) {
      panel.hidden = true;
      return;
    }
    const to = game.regions[hover];
    if (sel.mode === 'move' && to.units.length > 0 && to.owner !== game.current) {
      const fc = forecast(picked, to.units, to);
      panel.hidden = false;
      $('fcAtt').textContent = fc.att.toFixed(1);
      $('fcDef').textContent = fc.def.toFixed(1);
      $('fcOdds').textContent = Math.round(fc.odds * 100) + '%';
      $('fcBarFill').style.width = Math.round(fc.odds * 100) + '%';
      $('fcBarFill').style.background = fc.odds > 0.66 ? '#6fd98a' : fc.odds > 0.4 ? '#e8c35a' : '#e86a5a';
      $('fcNote').textContent =
        `Expect to lose about ${fc.attLossHp.toFixed(0)} hp of ${fc.attHp.toFixed(0)}, ` +
        `dealing about ${fc.defLossHp.toFixed(0)} of ${fc.defHp.toFixed(0)}.`;
    } else if (sel.mode === 'bombard' && to.units.length > 0) {
      const p = sidePower(picked, to.units, 'atk', 1);
      const dmg = p * BATTLE_SCALE * BOMBARD_SCALE / defenceMultiplier(to);
      panel.hidden = false;
      $('fcAtt').textContent = p.toFixed(1);
      $('fcDef').textContent = totalHp(to.units).toFixed(0);
      $('fcOdds').textContent = dmg.toFixed(0);
      $('fcBarFill').style.width = Math.min(100, (dmg / Math.max(totalHp(to.units), 1)) * 100) + '%';
      $('fcBarFill').style.background = '#e8c35a';
      $('fcNote').textContent = 'Expected bombardment damage. The defenders cannot answer.';
    } else {
      panel.hidden = true;
    }
  }

  function syncLog() {
    const box = $('log');
    for (; logDrawn < game.log.length; logDrawn++) {
      const e = game.log[logDrawn];
      const div = document.createElement('div');
      div.className = 'logline ' + e.tone;
      if (e.fid !== null && game.factions[e.fid]) {
        div.style.borderLeftColor = game.factions[e.fid].color;
      }
      div.textContent = e.text;
      box.appendChild(div);
    }
    while (box.children.length > 160) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- orders ---------- */

  function afterSelectionChange() {
    const picked = selectedUnits();
    if (picked.length === 0) { sel.mode = null; sel.targets = new Set(); }
    else if (!sel.mode) setMode('move');
    else setMode(sel.mode);
    syncRegion();
  }

  function setMode(mode) {
    const from = selectedRegion();
    const picked = selectedUnits();
    sel.mode = mode;
    sel.targets = new Set();
    sel.tone = mode === 'move' ? 'move' : mode === 'bombard' ? 'attack' : 'move';
    if (!from || picked.length === 0) { sel.mode = null; return; }

    if (mode === 'move') {
      let hostile = false;
      for (const n of from.neighbors) {
        const to = game.regions[n];
        if (orderKind(game, from, to, picked, game.current)) {
          sel.targets.add(n);
          if (to.owner !== game.current && to.units.length > 0) hostile = true;
        }
      }
      sel.tone = hostile ? 'attack' : 'move';
    } else if (mode === 'bombard') {
      for (const n of from.neighbors) {
        if (canBombard(game, from, game.regions[n], picked, game.current)) sel.targets.add(n);
      }
      sel.tone = 'attack';
    } else if (mode === 'redeploy') {
      for (const id of supplyNetwork(game, from.id, game.current)) {
        if (canRedeploy(game, from, game.regions[id], picked, game.current)) sel.targets.add(id);
      }
    }
  }

  function issueOrder(toId) {
    const from = selectedRegion();
    const picked = selectedUnits();
    if (!from || picked.length === 0) return;
    const to = game.regions[toId];

    if (sel.mode === 'move') moveUnits(game, from, to, picked, game.current);
    else if (sel.mode === 'bombard') bombard(game, from, to, picked, game.current);
    else if (sel.mode === 'redeploy') redeploy(game, from, to, picked, game.current);

    clearOrders();
    // Follow the troops if they actually went somewhere.
    if (to.units.some(u => u.owner === game.current)) sel.region = to.id;
    syncAll();
    finishIfOver();
  }

  /* ---------- turn flow ---------- */

  function endHumanTurn() {
    if (!human()) return;
    clearOrders();
    sel.region = null;
    endTurn(game);
    syncAll();
    if (finishIfOver()) return;
    maybeRunAI();
  }

  function maybeRunAI() {
    stopAI();
    if (!game || game.winner !== null) return;
    if (!game.factions[game.current].isAI) return;
    ai = createAI(game, game.current);
    aiSteps = 0;
    syncTop();
    aiTimer = setTimeout(stepAI, 420);
  }

  function stepAI() {
    if (!ai || !game) { stopAI(); return; }
    if (finishIfOver()) return;
    const acted = ai.step();
    if (acted) { syncAll(); }
    if (finishIfOver()) return;
    if (ai.done) {
      stopAI();
      endTurn(game);
      syncAll();
      if (finishIfOver()) return;
      maybeRunAI();
      return;
    }
    // Early orders play at a readable pace; a sprawling empire's twentieth
    // move of the turn does not need the same dwell time.
    if (acted) aiSteps++;
    const dwell = aiSteps < 8 ? 300 : aiSteps < 20 ? 140 : 60;
    aiTimer = setTimeout(stepAI, acted ? dwell : 30);
  }

  function stopAI() {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = null;
    ai = null;
  }

  /* ---------- input ---------- */

  function onCanvasMove(e) {
    if (!game) return;
    if (drag.panning) return;   // the window listener is doing the panning
    const r = Renderer.regionAt(game, e.clientX, e.clientY);
    const id = r ? r.id : null;
    if (id !== hover) { hover = id; syncForecast(); }
  }

  /* ---------- moving and resizing the map ----------
   *
   * The map pans under the mouse and zooms under the wheel; on touch one finger
   * is left alone so the page can still scroll past a map that fills a phone,
   * and two fingers pan and pinch. A drag has to be told apart from a click,
   * since both start with a press on a region — anything that travels more than
   * a few pixels stops being an order and becomes a pan.
   */

  const DRAG_SLOP = 5;   // px of travel before a press stops counting as a click
  let drag = { panning: false, moved: false, x: 0, y: 0 };
  let pinch = null;

  function beginPan(x, y) {
    drag = { panning: true, moved: false, x, y };
    $('map').classList.add('dragging');
  }

  function dragPanTo(x, y) {
    const dx = x - drag.x, dy = y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    drag.moved = true;
    drag.x = x;
    drag.y = y;
    Renderer.panBy(dx, dy);
  }

  function endPan() {
    drag.panning = false;
    $('map').classList.remove('dragging');
  }

  function onCanvasWheel(e) {
    if (!game) return;
    e.preventDefault();
    Renderer.zoomBy(Math.pow(0.9988, e.deltaY), e.clientX, e.clientY);
  }

  function touchMid(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }
  function touchSpan(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 2) { pinch = null; return; }
    const t = [e.touches[0], e.touches[1]];
    pinch = { span: touchSpan(t), mid: touchMid(t) };
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const t = [e.touches[0], e.touches[1]];
    const span = touchSpan(t), mid = touchMid(t);
    if (pinch.span > 0) Renderer.zoomBy(span / pinch.span, mid.x, mid.y);
    Renderer.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
    pinch = { span, mid };
  }

  function onCanvasClick(e) {
    if (!game || game.winner !== null) return;
    // The mouse-up that ends a pan lands here too; it was not an order.
    if (drag.moved) { drag.moved = false; return; }
    const r = Renderer.regionAt(game, e.clientX, e.clientY);
    if (!r) return;

    if (human() && sel.mode && sel.targets.has(r.id)) { issueOrder(r.id); return; }

    sel.region = r.id;
    clearOrders();
    // Picking up a friendly stack you can actually move is the common case.
    if (human() && r.owner === game.current) {
      for (const u of r.units) if (u.mp > 0) sel.units.add(u.id);
      afterSelectionChange();
    } else {
      syncRegion();
    }
  }

  function onKey(e) {
    // A focused button should answer Space and Enter itself rather than ending
    // the turn out from under whoever was tabbing through the controls, and a
    // field being typed into owns every key — including the shortcut letters.
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if (!$('overlay').hidden) {
      if (e.key === 'Escape' && $('overlayCard').dataset.dismissible === '1') {
        closeOverlay();
        if (!game) showSetup();
      }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endHumanTurn(); }
    else if (e.key === 'Escape') { clearOrders(); sel.region = null; syncRegion(); }
    else if (e.key.toLowerCase() === 'c') showCodex();
    else if (e.key.toLowerCase() === 'h') showHowToPlay();
  }

  /* Dragging the handle on the map's trailing edge resizes the pane: the
   * sidebar column while there is room for one, the map's own height once the
   * layout has stacked. Both land on a custom property #main already reads. */
  const STACKED = () => window.matchMedia('(max-width: 900px)').matches;
  const MIN_SIDE = 260, MAX_SIDE = 560;
  const MIN_MAP = 180;
  let mapHPinned = false;   // true once the player has sized the map themselves

  /* Stacked, a pane taller than the continent is dead space above and below it,
   * and on a phone that is most of the screen. Give the map the height its own
   * shape asks for until the player drags the handle and takes over. */
  function autoMapHeight() {
    if (mapHPinned || !STACKED()) return;
    const w = $('mapWrap').getBoundingClientRect().width;
    if (w <= 0) return;
    const wanted = w * (MAP_H / MAP_W);
    const h = Math.max(MIN_MAP, Math.min(window.innerHeight * 0.72, wanted));
    $('main').style.setProperty('--map-h', Math.round(h) + 'px');
  }

  function startResize(e) {
    e.preventDefault();
    const handle = $('mapHandle');
    const main = $('main');
    const stacked = STACKED();
    const startX = e.clientX, startY = e.clientY;
    const wrap = $('mapWrap').getBoundingClientRect();
    const startSide = $('sidebar').getBoundingClientRect().width;
    const startMap = wrap.height;

    handle.classList.add('dragging');
    if (stacked) mapHPinned = true;
    // Capture keeps a fast drag from escaping the 10px strip; the listeners go
    // on the window regardless, so the drag survives if capture is refused.
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ }

    const move = ev => {
      if (stacked) {
        const h = Math.max(MIN_MAP, Math.min(window.innerHeight * 1.4, startMap + (ev.clientY - startY)));
        main.style.setProperty('--map-h', Math.round(h) + 'px');
      } else {
        const w = Math.max(MIN_SIDE, Math.min(MAX_SIDE, startSide - (ev.clientX - startX)));
        main.style.setProperty('--side-w', Math.round(w) + 'px');
      }
      Renderer.resize();
    };
    const up = () => {
      handle.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* The handle is focusable, so the arrow keys resize it too. */
  function resizeByKey(e) {
    const step = e.shiftKey ? 48 : 16;
    const main = $('main');
    const stacked = STACKED();
    let delta = 0;
    if (e.key === 'ArrowLeft')  delta = stacked ? 0 : +step;
    else if (e.key === 'ArrowRight') delta = stacked ? 0 : -step;
    else if (e.key === 'ArrowUp')    delta = stacked ? -step : 0;
    else if (e.key === 'ArrowDown')  delta = stacked ? +step : 0;
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (stacked) {
      mapHPinned = true;
      const h = Math.max(MIN_MAP, $('mapWrap').getBoundingClientRect().height + delta);
      main.style.setProperty('--map-h', h + 'px');
    } else {
      const w = Math.max(MIN_SIDE, Math.min(MAX_SIDE, $('sidebar').getBoundingClientRect().width + delta));
      main.style.setProperty('--side-w', w + 'px');
    }
    Renderer.resize();
  }

  /* ---------- boot ---------- */

  function frame() {
    if (game) {
      Renderer.draw(game, {
        hover,
        selected: sel.region,
        targets: sel.targets,
        targetTone: sel.tone,
        expand: expandGlow,
        selectedUnits: sel.units
      });
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', function () {
    Renderer.init($('map'));
    autoMapHeight();
    Renderer.resize();
    window.addEventListener('resize', () => { autoMapHeight(); Renderer.resize(); });
    $('map').addEventListener('mousemove', onCanvasMove);
    $('map').addEventListener('mouseleave', () => { hover = null; syncForecast(); });
    $('map').addEventListener('click', onCanvasClick);
    $('map').addEventListener('mousedown', e => { if (e.button === 0) beginPan(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => { if (drag.panning) dragPanTo(e.clientX, e.clientY); });
    window.addEventListener('mouseup', endPan);
    $('map').addEventListener('wheel', onCanvasWheel, { passive: false });
    $('map').addEventListener('touchstart', onTouchStart, { passive: false });
    $('map').addEventListener('touchmove', onTouchMove, { passive: false });
    $('map').addEventListener('touchend', () => { pinch = null; });
    $('btnZoomIn').addEventListener('click', () => Renderer.zoomBy(1.35));
    $('btnZoomOut').addEventListener('click', () => Renderer.zoomBy(1 / 1.35));
    $('btnZoomFit').addEventListener('click', () => Renderer.resetView());
    $('mapHandle').addEventListener('pointerdown', startResize);
    $('mapHandle').addEventListener('keydown', resizeByKey);
    $('btnEnd').addEventListener('click', endHumanTurn);
    $('btnCodex').addEventListener('click', showCodex);
    $('btnNew').addEventListener('click', () => { stopAI(); showSetup(); });
    $('btnMove').addEventListener('click', () => { setMode('move'); syncRegion(); });
    $('btnBombard').addEventListener('click', () => { setMode('bombard'); syncRegion(); });
    $('btnRedeploy').addEventListener('click', () => { setMode('redeploy'); syncRegion(); });
    $('btnSelectAll').addEventListener('click', () => {
      const r = selectedRegion();
      if (!r) return;
      for (const u of r.units) if (u.owner === game.current && u.mp > 0) sel.units.add(u.id);
      afterSelectionChange();
    });
    $('btnSelectNone').addEventListener('click', () => { clearOrders(); syncRegion(); });
    document.addEventListener('keydown', onKey);
    if (guideSeen()) showSetup(); else showHowToPlay();
    frame();
  });
})();

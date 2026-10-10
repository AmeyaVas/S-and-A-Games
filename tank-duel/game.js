/* Tank Duel — two tanks, one hill, one keyboard.

   Turn-based artillery. Set an angle, set a power, fire, and watch the shell
   arc over the ridge or into it. The ground is a heightmap that craters where
   shells land, so a long match slowly digs the field out from under both tanks
   and a shot that was safe on turn one can be lethal on turn ten.

   Controls are shared rather than split between the players. Only one tank
   acts per turn, so a second set of keys would be dead half the time; the
   dash says whose turn it is instead. */

(() => {
  'use strict';

  const cv = document.getElementById('canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  // ---- tuning ----------------------------------------------------------
  const GRAVITY   = 0.22;   // px per step squared
  /* Wind has to be felt without taking over. At 0.0015 a full-strength 20
     blows a long shot about 50px off line — a correction you learn to make —
     whereas 0.012 accelerated the shell sideways harder than gravity pulled it
     down, which made aiming guesswork. */
  const WIND_ACC  = 0.0014; // sideways px per step squared, per unit of wind

  /* Wind is the one thing players argue about, so it is adjustable rather than
     baked in. windMax is the most it can ever blow; windStep is how far it may
     move between shots, never below 1 so the wind is never simply static.
     These survive a restart — you set them for the group, not for the round. */
  const cfg = { windOn: true, windMax: 12, windStep: 4 };
  const SPEED      = 0.18;  // muzzle px per step, per unit of power
  const SUBSTEPS   = 4;     // collision accuracy within one animation frame
  const BLAST_R    = 30;    // crater radius
  const HURT_R     = 48;    // damage reaches further than the crater
  const MAX_DMG    = 42;
  const DIRECT_R   = 15;    // closer than this counts as a direct hit
  const DIRECT_DMG = 16;    // added on top of the blast damage

  const ANGLE_MIN = 5, ANGLE_MAX = 175;
  const POWER_MIN = 10, POWER_MAX = 100;

  // ---- state -----------------------------------------------------------
  let ground;        // Float32Array(W): surface y for each column
  let tanks;         // two of them, index 0 left and 1 right
  let turn;          // 0 or 1
  let wind;          // -20..20, positive blows right
  let shell;         // null when nobody is mid-flight
  let phase;         // 'aim' | 'fly' | 'over'
  let shake;         // screen-shake frames left
  let puffs;         // short-lived explosion marks

  const held = new Set();

  // ---- terrain ---------------------------------------------------------

  /* Three sine layers plus a centre ridge. The ridge is the point of the
     game — without something in the middle, every shot is a flat lob and
     angle stops mattering. */
  function makeGround() {
    ground = new Float32Array(W);
    const base = H * 0.72;
    const p1 = Math.random() * Math.PI * 2;
    const p2 = Math.random() * Math.PI * 2;
    const p3 = Math.random() * Math.PI * 2;
    // One height for the whole ridge. Rolling this inside the column loop
    // gives every column its own random offset, which renders as grass.
    const ridge = 90 + Math.random() * 30;

    for (let x = 0; x < W; x++) {
      const t = x / W;
      let y = base
        + Math.sin(t * Math.PI * 2 + p1) * 26
        + Math.sin(t * Math.PI * 5.5 + p2) * 13
        + Math.sin(t * Math.PI * 11 + p3) * 5;

      // A hill in the middle, tapering to nothing by the time it reaches
      // either tank's platform.
      const d = Math.abs(t - 0.5) / 0.32;
      if (d < 1) y -= Math.cos(d * Math.PI / 2) * ridge;

      ground[x] = Math.max(70, Math.min(H - 24, y));
    }

    // Flatten a short shelf under each tank so neither starts on a slope.
    flatten(90, 26);
    flatten(W - 90, 26);
  }

  function flatten(cx, half) {
    const y = ground[Math.round(cx)];
    for (let x = Math.max(0, cx - half); x <= Math.min(W - 1, cx + half); x++) {
      ground[x] = y;
    }
  }

  function groundAt(x) {
    const i = Math.round(x);
    if (i < 0 || i >= W) return H + 999;   // off-field: nothing to hit
    return ground[i];
  }

  // ---- setup -----------------------------------------------------------

  function reset() {
    makeGround();
    tanks = [
      { x: 90,     hp: 100, angle: 45,  power: 55, colour: '#e0683c', name: 'Player 1' },
      { x: W - 90, hp: 100, angle: 135, power: 55, colour: '#4f9fd4', name: 'Player 2' },
    ];
    for (const t of tanks) t.y = groundAt(t.x);
    turn = 0;
    shell = null;
    phase = 'aim';
    shake = 0;
    puffs = [];
    wind = cfg.windOn ? Math.round((Math.random() * 2 - 1) * cfg.windMax) : 0;
    document.getElementById('overlay').hidden = true;
    syncHud();
  }

  /* Wind drifts rather than being re-rolled. An independent draw each turn
     meant it could go from 10 left to 15 right between two shots, which threw
     away everything the last shot taught you — and with a shell that leaves
     the field quickly, that could happen inside a second. Nudging it by a few
     points keeps a reading useful for a turn or two while still turning right
     round over the course of a match. */
  /* The drift bounces off the limits rather than stopping dead at them.
     Clamping made a random walk pile up against the cap and sit there for
     turns on end — technically still moving, but reading the same every shot.
     Reflecting sends it back the way it came, so the wind keeps circulating
     through the whole range. The loop is bounded and backed by a clamp because
     a single reflection is not enough when the step is wide relative to the
     cap, which it is once strength is turned right down. */
  function newWind() {
    if (!cfg.windOn) { wind = 0; return; }
    if (admin.freezeWind) return;
    let next = wind + (Math.random() * 2 - 1) * cfg.windStep;
    for (let i = 0; i < 4 && Math.abs(next) > cfg.windMax; i++) {
      next = (next > 0 ? 2 : -2) * cfg.windMax - next;
    }
    wind = Math.round(Math.max(-cfg.windMax, Math.min(cfg.windMax, next)));
  }

  /* Called when a setting changes mid-match: bring the wind now in play inside
     whatever the new limits are, rather than waiting a turn to take effect. */
  function applyCfg() {
    if (!cfg.windOn) wind = 0;
    else wind = Math.round(Math.max(-cfg.windMax, Math.min(cfg.windMax, wind)));
    syncHud();
  }

  // ---- firing ----------------------------------------------------------

  function fire() {
    if (phase !== 'aim') return;
    const t = tanks[turn];
    const rad = t.angle * Math.PI / 180;
    const v = t.power * SPEED;
    const muzzle = barrelTip(t);
    shell = {
      x: muzzle.x,
      y: muzzle.y,
      vx: Math.cos(rad) * v,
      vy: -Math.sin(rad) * v,
      trail: [],
    };
    phase = 'fly';
    syncHud();
  }

  function barrelTip(t) {
    const rad = t.angle * Math.PI / 180;
    return {
      x: t.x + Math.cos(rad) * 24,
      y: t.y - 11 - Math.sin(rad) * 24,
    };
  }

  function stepShell() {
    for (let s = 0; s < SUBSTEPS; s++) {
      shell.vy += GRAVITY / SUBSTEPS;
      shell.vx += wind * WIND_ACC / SUBSTEPS;
      shell.x += shell.vx / SUBSTEPS;
      shell.y += shell.vy / SUBSTEPS;

      // A shell that leaves the sides is simply gone. Leaving the top is
      // fine — high lobs are a legitimate way over the ridge.
      if (shell.x < -40 || shell.x > W + 40) { endTurn(); return; }

      for (const t of tanks) {
        if (Math.hypot(shell.x - t.x, shell.y - (t.y - 10)) < DIRECT_R) {
          boom(shell.x, shell.y, true);
          return;
        }
      }

      if (shell.y >= groundAt(shell.x)) { boom(shell.x, shell.y, false); return; }
    }

    shell.trail.push({ x: shell.x, y: shell.y });
    if (shell.trail.length > 90) shell.trail.shift();
  }

  /* Carve the crater, hurt whoever was standing near it, then let both tanks
     fall onto whatever ground is left. */
  function boom(x, y, direct) {
    for (let i = Math.max(0, Math.round(x - BLAST_R)); i <= Math.min(W - 1, Math.round(x + BLAST_R)); i++) {
      const dx = i - x;
      const bite = Math.sqrt(Math.max(0, BLAST_R * BLAST_R - dx * dx));
      ground[i] = Math.min(H - 6, Math.max(ground[i], y + bite));
    }

    for (const t of tanks) {
      const d = Math.hypot(x - t.x, y - (t.y - 10));
      if (d < HURT_R && !admin.god[tanks.indexOf(t)]) {
        let dmg = MAX_DMG * (1 - d / HURT_R);
        if (direct && d < DIRECT_R) dmg += DIRECT_DMG;
        t.hp = Math.max(0, Math.round(t.hp - dmg));
      }
    }

    for (const t of tanks) t.y = groundAt(t.x);

    puffs.push({ x, y, r: 4, life: 18 });
    shake = 9;
    shell = null;

    const dead = tanks.filter(t => t.hp <= 0);
    if (dead.length) {
      phase = 'over';
      const winner = dead.length === 2 ? null : tanks[dead[0] === tanks[0] ? 1 : 0];
      showOver(winner);
    } else {
      endTurn();
    }
    syncHud();
  }

  function endTurn() {
    shell = null;
    if (phase === 'over') return;
    turn = 1 - turn;
    newWind();
    phase = 'aim';
    syncHud();
  }

  function showOver(winner) {
    const o = document.getElementById('overlay');
    document.getElementById('overlayTitle').textContent =
      winner ? winner.name + ' wins' : 'Both destroyed';
    document.getElementById('overlaySub').textContent =
      winner ? 'Direct hits and a dug-up hill did the rest.' : 'A draw, of sorts.';
    o.hidden = false;
    document.getElementById('again').focus();
  }

  // ---- input -----------------------------------------------------------

  const AIM_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);

  addEventListener('keydown', e => {
    // Typing into the testing panel is not play.
    if (e.target.closest && e.target.closest('#admin')) return;
    /* While the panel is open the sliders own the arrow keys and Space, so
       stealing either here would leave the controls unusable. */
    if (settingsOpen()) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { reset(); return; }
    if (AIM_KEYS.has(e.key)) e.preventDefault();
    if (e.key === ' ') { fire(); return; }
    held.add(e.key);
  });

  addEventListener('keyup', e => held.delete(e.key));
  addEventListener('blur', () => held.clear());

  document.getElementById('again').addEventListener('click', reset);

  // ---- touch pad -------------------------------------------------------

  /* Each aim button holds its arrow key for as long as the finger stays on
     it, so the numbers sweep just as they do from the keyboard. Pointer
     capture keeps the hold even if the finger slides off the button. */
  for (const btn of document.querySelectorAll('#pad [data-key]')) {
    const key = btn.dataset.key;
    const release = () => { held.delete(key); btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (settingsOpen()) return;
      held.add(key); btn.classList.add('down');
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ }
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }
  document.getElementById('padFire').addEventListener('click', () => { if (!settingsOpen()) fire(); });
  document.getElementById('padNew').addEventListener('click', reset);

  // ---- settings --------------------------------------------------------

  const panel = document.getElementById('settings');
  const onBox = document.getElementById('setWindOn');
  const maxRange = document.getElementById('setWindMax');
  const stepRange = document.getElementById('setWindStep');

  const settingsOpen = () => !panel.hidden;

  function openSettings() {
    held.clear();   // a key still down as the panel opens would otherwise stick
    panel.hidden = false;
    /* Focus Done, not the checkbox. Space is fire everywhere else in this
       game, and Space on a focused checkbox silently flips it — so a player
       reaching for the key they have been pressing all match would turn the
       wind off without meaning to. On Done it just closes the panel. */
    document.getElementById('closeSettings').focus();
  }

  function closeSettings() {
    panel.hidden = true;
    document.getElementById('openSettings').focus();
  }

  /* Grey the sliders out when wind is off. They keep their values — turning
     wind back on should restore what you had, not a default. */
  function syncPanel() {
    document.getElementById('outWindMax').textContent = cfg.windMax;
    document.getElementById('outWindStep').textContent = cfg.windStep;
    maxRange.disabled = stepRange.disabled = !cfg.windOn;
    maxRange.closest('.row').classList.toggle('off', !cfg.windOn);
    stepRange.closest('.row').classList.toggle('off', !cfg.windOn);
  }

  document.getElementById('openSettings').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);

  onBox.addEventListener('change', () => {
    cfg.windOn = onBox.checked; syncPanel(); applyCfg();
  });
  maxRange.addEventListener('input', () => {
    cfg.windMax = Number(maxRange.value); syncPanel(); applyCfg();
  });
  stepRange.addEventListener('input', () => {
    // Floor it here as well as on the input, so the rule holds whatever
    // route the value arrives by.
    cfg.windStep = Math.max(1, Number(stepRange.value)); syncPanel(); applyCfg();
  });

  syncPanel();

  /* Held keys nudge the numbers every frame, so a long press sweeps smoothly
     instead of stepping once per key repeat. */
  function readAim() {
    if (phase !== 'aim' || settingsOpen()) return;
    const t = tanks[turn];

    /* Up raises the barrel and down drops it, for whichever tank is firing.
       That needs a sign: angles run counter-clockwise from the right, so the
       left tank raises by counting up towards 90 and the right tank, aiming
       back the other way from 135, raises by counting down towards it. Without
       the flip, up would lower player 2's barrel. */
    const raise = turn === 0 ? 1 : -1;
    if (held.has('ArrowUp'))    t.angle += 0.9 * raise;
    if (held.has('ArrowDown'))  t.angle -= 0.9 * raise;
    t.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, t.angle));

    if (held.has('ArrowRight')) t.power = Math.min(POWER_MAX, t.power + 0.8);
    if (held.has('ArrowLeft'))  t.power = Math.max(POWER_MIN, t.power - 0.8);
  }

  // ---- HUD -------------------------------------------------------------

  function syncHud() {
    const t = tanks[turn];
    document.getElementById('hp1').style.width = tanks[0].hp + '%';
    document.getElementById('hp2').style.width = tanks[1].hp + '%';
    document.getElementById('angleVal').textContent = Math.round(t.angle) + '°';
    document.getElementById('powerVal').textContent = Math.round(t.power);
    document.getElementById('turnWho').textContent = t.name;
    document.getElementById('turnWho').style.color = t.colour;

    const arrow = wind === 0 ? '—' : (wind > 0 ? '→' : '←');
    document.getElementById('windVal').textContent =
      cfg.windOn ? arrow + ' ' + Math.abs(wind) : 'off';
  }

  // ---- drawing ---------------------------------------------------------

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake--;
    }

    // Sky: dusk, lighter at the horizon.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b0d07');
    sky.addColorStop(0.72, '#2b2f1d');
    sky.addColorStop(1, '#3a3a22');
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Ground, with a lit top edge so the surface reads clearly.
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, ground[x]);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#3c4529';
    ctx.fill();

    ctx.beginPath();
    for (let x = 0; x < W; x++) x ? ctx.lineTo(x, ground[x]) : ctx.moveTo(x, ground[x]);
    ctx.strokeStyle = '#5c6b3c';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const t of tanks) drawTank(t);

    if (shell) {
      ctx.beginPath();
      shell.trail.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = '#f0a52c66';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(shell.x, shell.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd98a';
      ctx.fill();
    }

    if (admin.preview && phase === 'aim') drawPreview();

    puffs = puffs.filter(p => p.life > 0);
    for (const p of puffs) {
      p.r += 3.4;
      p.life--;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,165,44,' + (p.life / 26) + ')';
      ctx.fill();
    }

    ctx.restore();
  }

  function drawTank(t) {
    const dead = t.hp <= 0;
    ctx.save();
    ctx.translate(t.x, t.y);

    // Barrel first, so the hull covers where it joins.
    if (!dead) {
      const tip = barrelTip(t);
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(tip.x - t.x, tip.y - t.y);
      ctx.strokeStyle = t.colour;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    ctx.fillStyle = dead ? '#4a4a3c' : t.colour;
    ctx.fillRect(-15, -9, 30, 9);               // hull
    ctx.beginPath();                            // turret
    ctx.arc(0, -9, 7, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b1d13';                  // tracks
    for (let i = -12; i <= 12; i += 6) {
      ctx.fillRect(i - 2, -2, 4, 3);
    }

    // A marker above whoever is about to fire, so you never lose your turn.
    if (!dead && turn === tanks.indexOf(t) && phase === 'aim') {
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(-5, -38);
      ctx.lineTo(5, -38);
      ctx.closePath();
      ctx.fillStyle = '#f0a52c';
      ctx.fill();
    }

    ctx.restore();
  }

  // ---- loop ------------------------------------------------------------

  function frame() {
    readAim();
    if (phase === 'fly' && shell) stepShell();
    if (phase === 'aim') syncHud();
    draw();
    if (adminOn && (admin.tick = (admin.tick + 1) % 10) === 0) refreshAdmin();
    requestAnimationFrame(frame);
  }

  // ---- testing tools ---------------------------------------------------

  const ADMIN_KEY = 'tankduel.admin';
  let adminOn = false;
  try { adminOn = localStorage.getItem(ADMIN_KEY) === '1'; } catch (_) { /* stays off */ }
  const admin = { god: [false, false], freezeWind: false, preview: false, el: null, info: null, btn: null, tick: 0 };

  let typed = '';
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('#admin, #settings')) return;
    if (adminOn && e.code === 'Backquote') { toggleAdmin(); return; }
    if (!adminOn && /^[a-z]$/i.test(e.key)) {
      typed = (typed + e.key.toLowerCase()).slice(-5);
      if (typed === 'admin') unlockAdmin();
    }
  });
  let titleTaps = [];
  document.querySelector('h1').addEventListener('click', () => {
    if (adminOn) return;
    const now = performance.now();
    titleTaps = titleTaps.filter(t => now - t < 3000).concat(now);
    if (titleTaps.length >= 5) unlockAdmin();
  });

  function unlockAdmin() {
    adminOn = true; typed = ''; titleTaps = [];
    try { localStorage.setItem(ADMIN_KEY, '1'); } catch (_) { /* this visit only */ }
    showAdminButton();
    toggleAdmin();
  }
  function lockAdmin() {
    adminOn = false;
    Object.assign(admin, { god: [false, false], freezeWind: false, preview: false });
    try { localStorage.removeItem(ADMIN_KEY); } catch (_) { /* nothing stored */ }
    if (admin.el) admin.el.hidden = true;
    if (admin.btn) admin.btn.hidden = true;
  }
  // Phones have no backtick, so the wind line gets a button while unlocked.
  function showAdminButton() {
    if (!admin.btn) {
      admin.btn = document.createElement('button');
      admin.btn.id = 'openAdmin';
      admin.btn.type = 'button';
      admin.btn.textContent = 'Admin';
      admin.btn.addEventListener('click', toggleAdmin);
      document.getElementById('openSettings').after(admin.btn);
    }
    admin.btn.hidden = false;
  }
  function toggleAdmin() {
    if (!adminOn) return;
    if (!admin.el) buildAdmin();
    admin.el.hidden = !admin.el.hidden;
    held.clear();
    refreshAdmin();
  }

  function buildAdmin() {
    const btn = (act, label, arg = '') => `<button type="button" data-a="${act}" data-arg="${arg}">${label}</button>`;
    const el = document.createElement('aside');
    el.id = 'admin'; el.hidden = true;
    el.innerHTML = `<header><b>Admin</b><span>${btn('lock', 'Lock admin')}<button type="button" data-a="close" aria-label="Close">&times;</button></span></header>
      <section><h3>Tanks</h3>
        ${[0, 1].map(i => `<div class="btns"><span class="who p${i + 1}">P${i + 1}</span>${btn('heal', 'Heal', i)}<input id="adHp${i}" inputmode="numeric" placeholder="hp">${btn('sethp', 'Set', i)}${btn('god', 'No damage', i)}</div>`).join('')}
        <div class="btns">${btn('swap', 'Switch turn')}${btn('move', '◀ Move', -20)}${btn('move', 'Move ▶', 20)}</div></section>
      <section><h3>Aim</h3>
        <div class="btns">${btn('preview', 'Show path')}${btn('aimpow', 'Power to hit')}${btn('aimbest', 'Best shot')}</div></section>
      <section><h3>Wind</h3>
        <div class="btns"><input id="adWind" inputmode="numeric" placeholder="-25…25">${btn('setwind', 'Set')}${btn('calm', 'Calm')}${btn('freeze', 'Freeze')}</div></section>
      <section><h3>Ground</h3>
        <div class="btns">${btn('terrain', 'New terrain')}${btn('flat', 'Flatten')}</div></section>
      <section><h3>Result</h3>
        <div class="btns">${btn('win', 'P1 wins', 0)}${btn('win', 'P2 wins', 1)}${btn('draw', 'Draw')}${btn('new', 'New match')}</div></section>
      <section><h3>Live</h3><pre id="adInfo"></pre></section>`;
    document.body.appendChild(el);
    admin.el = el; admin.info = el.querySelector('#adInfo');
    // A panel button lets go of focus once pressed, or the next Space would
    // press it again instead of firing.
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { b.blur(); adminAct(b.dataset.a, b.dataset.arg); } });
  }

  /* The shell's flight without firing it: the same steps stepShell takes,
     against the current ground and wind. Ends on the ground, a tank or the
     side of the field. */
  function simulate(t, angle, power, keepPath) {
    const rad = angle * Math.PI / 180, v = power * SPEED;
    const tip = { x: t.x + Math.cos(rad) * 24, y: t.y - 11 - Math.sin(rad) * 24 };
    let x = tip.x, y = tip.y, vx = Math.cos(rad) * v, vy = -Math.sin(rad) * v;
    const path = keepPath ? [{ x, y }] : null;
    for (let n = 0; n < 3000; n++) {
      for (let s = 0; s < SUBSTEPS; s++) {
        vy += GRAVITY / SUBSTEPS; vx += wind * WIND_ACC / SUBSTEPS;
        x += vx / SUBSTEPS; y += vy / SUBSTEPS;
        if (x < -40 || x > W + 40) return { x, y, out: true, path };
        for (const k of tanks) if (Math.hypot(x - k.x, y - (k.y - 10)) < DIRECT_R) return { x, y, tank: k, path };
        if (y >= groundAt(x)) return { x, y, path };
      }
      if (path) path.push({ x, y });
    }
    return { x, y, out: true, path };
  }
  const missBy = (r, foe) => r.tank === foe ? 0 : r.out ? 1e6 : Math.hypot(r.x - foe.x, r.y - (foe.y - 10));

  function drawPreview() {
    const t = tanks[turn];
    const r = simulate(t, t.angle, t.power, true);
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    r.path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.lineTo(r.x, r.y);
    ctx.strokeStyle = 'rgba(255,217,138,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!r.out) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(r.x, r.y, BLAST_R, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(240,165,44,0.5)'; ctx.stroke(); }
    ctx.restore();
  }

  function adminAct(a, arg) {
    if (a === 'close') { admin.el.hidden = true; return; }
    if (a === 'lock') { lockAdmin(); return; }
    if (a === 'new') { reset(); refreshAdmin(); return; }
    const t = tanks[turn], foe = tanks[1 - turn], i = +arg;
    if (a === 'god') admin.god[i] = !admin.god[i];
    if (a === 'preview') admin.preview = !admin.preview;
    if (a === 'freeze') admin.freezeWind = !admin.freezeWind;
    if (phase === 'over' && a !== 'god' && a !== 'preview' && a !== 'freeze') { refreshAdmin(); return; }
    if (a === 'heal') tanks[i].hp = 100;
    if (a === 'sethp') {
      const v = Math.round(+document.getElementById('adHp' + i).value);
      if (Number.isFinite(v) && v > 0) tanks[i].hp = Math.min(100, v);
    }
    if (a === 'swap' && phase === 'aim') { turn = 1 - turn; }
    if (a === 'move') {
      t.x = Math.max(20, Math.min(W - 20, t.x + i));
      t.y = groundAt(t.x);
    }
    if (a === 'setwind' && cfg.windOn) {
      const v = Math.round(+document.getElementById('adWind').value);
      if (Number.isFinite(v)) wind = Math.max(-25, Math.min(25, v));
    }
    if (a === 'calm') wind = 0;
    // Search the power for this angle, or every angle and power, for the
    // shot that lands closest to the other tank.
    if ((a === 'aimpow' || a === 'aimbest') && phase === 'aim') {
      let best = null;
      const angles = a === 'aimpow' ? [t.angle] : Array.from({ length: ANGLE_MAX - ANGLE_MIN + 1 }, (_, k) => ANGLE_MIN + k);
      for (const ang of angles) for (let pw = POWER_MIN; pw <= POWER_MAX; pw += 0.5) {
        const d = missBy(simulate(t, ang, pw), foe);
        if (!best || d < best.d) best = { d, ang, pw };
      }
      if (best) { t.angle = best.ang; t.power = best.pw; }
    }
    if (a === 'terrain' || a === 'flat') {
      if (a === 'terrain') makeGround();
      else { const y = H * 0.72; ground.fill(y); }
      for (const k of tanks) k.y = groundAt(k.x);
    }
    if (a === 'win' || a === 'draw') {
      shell = null;
      if (a === 'win') tanks[1 - i].hp = 0; else tanks[0].hp = tanks[1].hp = 0;
      phase = 'over';
      showOver(a === 'win' ? tanks[i] : null);
    }
    syncHud();
    refreshAdmin();
  }

  function refreshAdmin() {
    if (!admin.el || admin.el.hidden) return;
    const on = (sel, v) => { for (const b of admin.el.querySelectorAll(sel)) b.classList.toggle('on', v(b)); };
    on('[data-a=god]', b => admin.god[+b.dataset.arg]);
    on('[data-a=preview]', () => admin.preview);
    on('[data-a=freeze]', () => admin.freezeWind);
    const t = tanks[turn], foe = tanks[1 - turn];
    const shot = phase === 'aim' ? simulate(t, t.angle, t.power) : null;
    admin.info.textContent = [
      `phase ${phase}   turn ${t.name}`,
      `wind ${wind}${cfg.windOn ? '' : ' (off)'}   max ${cfg.windMax} step ${cfg.windStep}${admin.freezeWind ? '   frozen' : ''}`,
      '',
      ...tanks.map((k, n) => `P${n + 1} hp ${k.hp}${admin.god[n] ? ' (no damage)' : ''}  x ${Math.round(k.x)} y ${Math.round(k.y)}  ${Math.round(k.angle)}° pw ${Math.round(k.power)}`),
      '',
      shot ? `this shot lands x ${Math.round(shot.x)}${shot.out ? ' (off field)' : shot.tank ? ' — direct hit on ' + shot.tank.name : `, ${Math.round(missBy(shot, foe))}px from ${foe.name}`}` : '',
      shell ? `shell x ${Math.round(shell.x)} y ${Math.round(shell.y)}  v ${shell.vx.toFixed(1)},${shell.vy.toFixed(1)}` : '',
    ].join('\n');
  }

  if (adminOn) showAdminButton();

  reset();
  frame();
})();

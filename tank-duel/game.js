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
  const WIND_ACC  = 0.0015; // sideways px per step squared, per unit of wind
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
    newWind();
    document.getElementById('overlay').hidden = true;
    syncHud();
  }

  function newWind() {
    wind = Math.round((Math.random() * 2 - 1) * 20);
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
      if (d < HURT_R) {
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
    if (e.key === 'r' || e.key === 'R') { reset(); return; }
    if (AIM_KEYS.has(e.key)) e.preventDefault();
    if (e.key === ' ') { fire(); return; }
    held.add(e.key);
  });

  addEventListener('keyup', e => held.delete(e.key));
  addEventListener('blur', () => held.clear());

  document.getElementById('again').addEventListener('click', reset);

  /* Held keys nudge the numbers every frame, so a long press sweeps smoothly
     instead of stepping once per key repeat. */
  function readAim() {
    if (phase !== 'aim') return;
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
    document.getElementById('windVal').textContent = arrow + ' ' + Math.abs(wind);
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
    requestAnimationFrame(frame);
  }

  reset();
  frame();
})();

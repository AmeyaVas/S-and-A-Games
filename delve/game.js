// Delve — a descent through five cave depths with one life.
//
// The world is a square tile grid; everything alive moves freely on top of it.
// Physics runs on a fixed 120 Hz step, collision resolves x then y, and the
// lighting is an offscreen darkness mask with radial holes cut for every light.
'use strict';

(() => {
  const T = 16, VW = 960, VH = 544, STEP = 1 / 120, DEPTHS = DELVE_LEVELS.length;

  // ---------------------------------------------------------------- tuning
  const GRAV = 1700, MAX_FALL = 820, RUN = 215, ACC_GROUND = 2600, ACC_AIR = 1700;
  const JUMP_V = 585, PAD_V = 830, DOUBLE_V = 520, GLIDE_FALL = 110;
  const COYOTE = 0.1, BUFFER = 0.12, DASH_V = 640, DASH_T = 0.16;
  const SHOT_V = 760, SHOT_LIFE = 0.9, SHOT_DMG = 10, FIRE_GAP = 0.17;
  const BASE_HP = 100, LANTERN = 170;

  const AIR = 0, ROCK = 1, PLANK = 2, SPIKE = 3, LAVA = 4, PAD = 5, VOID = 6, EXIT = 7;

  const POWERS = {
    splitter:  { name: 'Splitter',    color: '#7fe3ff', perm: true, what: 'Shots fork into three' },
    ricochet:  { name: 'Ricochet',    color: '#b48cff', perm: true, what: 'Shots bounce off rock twice' },
    overclock: { name: 'Overclock',   color: '#ffd166', time: 20,   what: 'Fire rate doubled' },
    feather:   { name: 'Featherfall', color: '#9cf6c8', time: 45,   what: 'Double jump, hold jump to glide' },
    aegis:     { name: 'Aegis',       color: '#8fb8ff',             what: 'Absorbs the next two hits' },
    blink:     { name: 'Blink',       color: '#ff8fd0',             what: 'Shift dashes through enemies' },
    flare:     { name: 'Flare',       color: '#fff3a0', time: 10,   what: 'A huge light radius' },
  };
  const ROLLABLE = ['overclock', 'feather', 'aegis', 'blink', 'flare'];

  const RELIC_CAP = 3;
  const RELICS = {
    hide:   { name: 'Thick Hide',       what: '+25 max HP' },
    flint:  { name: 'Knapped Flint',    what: '+30% shot damage' },
    wick:   { name: 'Long Wick',        what: '+35% light radius' },
    ember:  { name: 'Ember Heart',      what: 'Life sparks heal 60% more' },
    candle: { name: 'Slow Candle',      what: 'Timed powerups last 40% longer' },
    eye:    { name: "Prospector's Eye", what: 'Kills have a 10% chance to drop a crystal' },
    hands:  { name: 'Quick Hands',      what: '+20% fire rate' },
    lungs:  { name: 'Deep Lungs',       what: 'Heal 30 HP on reaching each depth' },
  };

  const FOES = {
    C: { w: 18, h: 12, hp: 22,   dmg: 12, color: '#e0703a', spark: 0.25 },
    B: { w: 16, h: 12, hp: 14,   dmg: 9,  color: '#f0a040', spark: 0.22 },
    S: { w: 18, h: 16, hp: 30,   dmg: 14, color: '#d8a030', spark: 0.3 },
    R: { w: 30, h: 28, hp: 110,  dmg: 24, color: '#c8462c', spark: 0.6 },
    N: { w: 28, h: 18, hp: 80,   dmg: 10, color: '#b45a30', spark: 1 },
    W: { w: 72, h: 72, hp: 1100, dmg: 26, color: '#ff6a3a', spark: 0 },
  };

  // Rock, back-wall and accent per depth: brown, slate, mossy, ember, violet slate.
  const PALETTES = [
    { rock: [74, 58, 44], back: [30, 24, 19] },
    { rock: [60, 66, 74], back: [22, 25, 30] },
    { rock: [66, 62, 46], back: [26, 25, 18] },
    { rock: [78, 48, 38], back: [32, 18, 14] },
    { rock: [56, 50, 66], back: [22, 19, 27] },
  ];

  // ---------------------------------------------------------------- DOM
  const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas'); dark.width = VW; dark.height = VH;
  const dctx = dark.getContext('2d');
  const $ = id => document.getElementById(id);
  const overlay = $('overlay');

  // ---------------------------------------------------------------- utils
  function mulberry(seed){
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const hash = (x, y, s = 0) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519);
    h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
  const rgb = (c, k = 1) => `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;
  const fmtTime = s => { const m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };

  // ---------------------------------------------------------------- save
  const SAVE_KEY = 'delve.save.v1';
  let save = { deepest: 0, bestTime: 0, kills: 0 };
  try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) {}
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

  // ---------------------------------------------------------------- input
  const keys = new Set(), pressed = new Set();
  const mouse = { x: VW / 2, y: VH / 2, down: false };
  const KEYMAP = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyW: 'jump', ArrowUp: 'jump', Space: 'jump', KeyS: 'down', ArrowDown: 'down',
    ShiftLeft: 'dash', ShiftRight: 'dash', KeyF: 'fire' };
  addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if(k){ if(!keys.has(k)) pressed.add(k); keys.add(k); if(mode === 'play') e.preventDefault(); }
    if(e.code === 'Escape'){ if(mode === 'play') setMode('pause'); else if(mode === 'pause') setMode('play'); }
    if(mode === 'relic' && /^Digit[123]$/.test(e.code)) chooseRelic(+e.code[5] - 1);
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if(k) keys.delete(k); });
  addEventListener('blur', () => { keys.clear(); mouse.down = false; if(mode === 'play') setMode('pause'); });
  const toCanvas = e => { const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * VW / r.width; mouse.y = (e.clientY - r.top) * VH / r.height; };
  addEventListener('mousemove', toCanvas);
  canvas.addEventListener('mousedown', e => { toCanvas(e); if(e.button === 0) mouse.down = true; });
  addEventListener('mouseup', e => { if(e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---------------------------------------------------------------- state
  let mode = 'title';
  let run = null, lvl = null, player = null;
  let foes = [], bullets = [], hostile = [], drops = [], parts = [], frags = [], flashes = [], texts = [];
  let cam = { x: 0, y: 0, shake: 0 }, toast = null, hurtFlash = 0, dripClock = 0;
  const motes = Array.from({ length: 40 }, () => ({ x: Math.random() * VW, y: Math.random() * VH,
    vx: rand(-6, 6), vy: rand(-4, 4), s: rand(1, 2.5) }));

  // ---------------------------------------------------------------- level
  // Parse a depth's rows into tiles and entities, rolling every variant spot.
  // Index -1 is the tutorial, which rolls nothing.
  const TUTORIAL = -1;
  function loadDepth(index){
    const def = index === TUTORIAL ? DELVE_TUTORIAL : DELVE_LEVELS[index], rows = def.rows, H = rows.length, W = rows[0].length;
    const r = mulberry((run ? run.seed : 1) ^ Math.imul(index + 1, 0x9E3779B1));
    const tiles = new Uint8Array(W * H);
    const L = { index, def, W, H, tiles, moss: [], lifts: [], beacons: [], sealed: def.boss,
      arena: null, start: [0, 0], canvas: null, lavaTops: [], exitCells: [],
      pal: PALETTES[Math.max(0, index) % PALETTES.length], signs: (def.signs || []).slice().sort((a, b) => a.x - b.x), stands: [] };
    foes = []; bullets = []; hostile = []; drops = []; parts = []; frags = []; flashes = []; texts = [];

    // J/P groups: J cells cluster by touch; each P joins the nearest cluster.
    const groupOf = new Map(), groups = [];
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
      if(rows[y][x] !== 'J' || groupOf.has(x + ',' + y)) continue;
      const g = { pad: false, cells: [] }, q = [[x, y]]; groups.push(g); groupOf.set(x + ',' + y, g);
      while(q.length){ const [cx, cy] = q.pop(); g.cells.push([cx, cy]);
        for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){
          const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
          if(rows[ny] && rows[ny][nx] === 'J' && !groupOf.has(k)){ groupOf.set(k, g); q.push([nx, ny]); } } }
    }
    for(const g of groups) g.pad = r() < 0.5;
    const padGroup = (x, y) => { let best = null, bd = 1e9;
      for(const g of groups) for(const [cx, cy] of g.cells){ const d = Math.abs(cx - x) + Math.abs(cy - y); if(d < bd){ bd = d; best = g; } }
      return best; };

    const liftTops = [];
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
      const c = rows[y][x], i = y * W + x, px = x * T + T / 2, py = y * T + T;
      let t = AIR;
      switch(c){
        case '#': t = ROCK; break;
        case '=': t = PLANK; break;
        case '^': t = SPIKE; break;
        case '~': t = LAVA; break;
        case 'v': t = VOID; break;
        case 'X': t = EXIT; L.exitCells.push([x, y]); break;
        case 'L': t = r() < 0.08 ? LAVA : ROCK; break;
        case 'J': t = groupOf.get(x + ',' + y).pad ? AIR : ROCK; break;
        case 'P': { const g = padGroup(x, y); t = def.tutorial || (g && g.pad) ? PAD : ROCK; break; }
        case 'm': L.moss.push({ x, y, lit: 0 }); break;
        case '@': L.start = [px, py]; break;
        case 'b': L.beacons.push({ x: px, y: py, lit: false }); break;
        case 'h': drops.push({ kind: 'spark', x: px, y: py - 8, vx: 0, vy: 0, t: rand(0, 6), rest: true }); break;
        case '*': if(r() < 0.55) drops.push({ kind: 'crystal', type: pick(ROLLABLE, r), x: px, y: py - 8, rest: true }); break;
        case '$': drops.push({ kind: 'crystal', type: r() < 0.5 ? 'splitter' : 'ricochet', x: px, y: py - 8, rest: true }); break;
        case 'T': if(rows[y][x - 1] !== 'T') liftTops.push([x, y]); break;
        case '?': { const k = r() < 0.3 ? null : pick(def.roll.split(''), r); if(k) spawnFoe(k, x, y, rows); break; }
        default: if(FOES[c]) spawnFoe(c, x, y, rows);
      }
      tiles[i] = t;
    }
    for(const c of def.crystals || []) drops.push({ kind: 'crystal', type: c.type, x: c.x * T + T / 2, y: c.y * T + T - 8, rest: true });
    for(const s of def.relics || []) L.stands.push({ x: s.x * T + T / 2, y: s.y * T + T, key: s.key });
    for(const [x, y] of liftTops){
      let by = y + 1; while(by < H && rows[by][x] !== 't') by++;
      L.lifts.push({ x: x * T, w: 3 * T, top: y * T, bottom: by * T, y: by * T, dy: 0, dir: -1, wait: 1 });
    }
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++)
      if(tiles[y * W + x] === LAVA && (y === 0 || tiles[(y - 1) * W + x] !== LAVA)) L.lavaTops.push([x, y]);
    // Moss needs something to grow on, judged after the rolls: a floor of rock,
    // pad or plank (side 0), else rock to the left (-1) or right (1). Moss over
    // a pit, lava or open air is dropped rather than drawn floating.
    const rock = (x, y) => x >= 0 && x < W && y < H && (tiles[y * W + x] === ROCK || tiles[y * W + x] === PAD);
    L.moss = L.moss.filter(m => {
      m.side = rock(m.x, m.y + 1) || tiles[(m.y + 1) * W + m.x] === PLANK ? 0
        : rock(m.x - 1, m.y) ? -1 : rock(m.x + 1, m.y) ? 1 : null;
      return m.side !== null;
    });
    // Tutorial enemies sleep until you enter their lesson room, and stay in it.
    if(def.rooms) for(const f of foes){ const c = (f.x + f.w / 2) / T;
      f.room = def.rooms.find(([a, b]) => c >= a && c < b); f.asleep = true; }
    lvl = L;
    const w = foes.find(f => f.type === 'W');
    if(w) lvl.arena = findArena(Math.floor((w.x + w.w / 2) / T), Math.floor((w.y + w.h / 2) / T));
    prerender();
    return L;
  }

  // The open box around the Warden's spawn: as far as rock in each direction.
  function findArena(cx, cy){
    const open = (x, y) => lvl.tiles[y * lvl.W + x] !== ROCK;
    let l = cx, r = cx, t = cy, b = cy;
    while(open(l - 1, cy)) l--; while(open(r + 1, cy)) r++;
    while(open(cx, t - 1)) t--; while(open(cx, b + 1)) b++;
    return { x0: l * T, x1: (r + 1) * T, y0: t * T, y1: (b + 1) * T };
  }

  const tileAt = (x, y) => (x < 0 || x >= lvl.W || y < 0) ? ROCK : y >= lvl.H ? VOID : lvl.tiles[y * lvl.W + x];
  const solidT = t => t === ROCK || t === PAD || (t === EXIT && lvl.sealed);
  const solidAt = (x, y) => solidT(tileAt(x, y));
  const solidPx = (px, py) => solidAt(Math.floor(px / T), Math.floor(py / T));

  // ---------------------------------------------------------------- run
  function newRun(seed){
    const forced = new URLSearchParams(location.search).get('seed');
    seed = seed ?? (forced !== null ? (+forced >>> 0) : (Math.random() * 2 ** 32) >>> 0);
    run = { seed, depth: 0, hp: BASE_HP, maxHp: BASE_HP, relics: {}, perm: {}, kills: 0, time: 0,
      rng: mulberry(seed ^ 0x51ED) };
    enterDepth(0);
    setMode('play');
  }

  // The tutorial is a run of its own: nothing it does reaches the records,
  // and dying there puts you back at the last sign you passed.
  function startTutorial(){
    run = { seed: 1, depth: TUTORIAL, tutorial: true, hp: BASE_HP, maxHp: BASE_HP, relics: {}, perm: {}, kills: 0, time: 0,
      rng: mulberry(1), checkpoint: -1, respawn: null };
    player = null;
    enterDepth(TUTORIAL);
    setMode('play');
  }

  function finishTutorial(){
    save.tutorialDone = true; persist();
    setMode('tutorialDone');
  }

  // First-timers go through the tutorial; anyone who has played goes straight down.
  const begin = () => (save.tutorialDone || save.deepest) ? newRun() : startTutorial();

  function enterDepth(i){
    run.depth = i;
    loadDepth(i);
    const keep = player;
    player = { x: lvl.start[0] - 6, y: lvl.start[1] - 22, w: 12, h: 22, vx: 0, vy: 0, face: 1,
      ground: false, coyote: 0, buffer: 0, jumpHeld: false, cut: false, air: 0, onLift: null, drop: 0,
      inv: 1, fireCd: 0, dash: 0, dashDir: 1, walk: 0, timers: {}, aegis: 0, blink: 0, doubleUsed: false };
    if(keep){ player.timers = keep.timers; player.aegis = keep.aegis; player.blink = keep.blink; }
    if(run.relics.lungs) heal(30 * run.relics.lungs);
    if(!run.tutorial){ save.deepest = Math.max(save.deepest, i + 1); persist(); }
    cam.x = clamp(player.x - VW / 2, 0, lvl.W * T - VW); cam.y = clamp(player.y - VH / 2, 0, lvl.H * T - VH);
    showToast(run.tutorial ? 'Tutorial — ' + lvl.def.name : `Depth ${i + 1} — ${lvl.def.name}`);
  }

  function depthCleared(){
    if(run.tutorial){ finishTutorial(); return; }
    save.kills += run.kills - (run.savedKills || 0); run.savedKills = run.kills; persist();
    if(run.depth + 1 >= DEPTHS){
      if(!save.bestTime || run.time < save.bestTime) { save.bestTime = run.time; run.newBest = true; }
      persist(); setMode('won'); return;
    }
    // Relics stack up to RELIC_CAP copies; a maxed one is never offered again.
    const pool = Object.keys(RELICS).filter(k => (run.relics[k] || 0) < RELIC_CAP), choice = [];
    while(choice.length < Math.min(3, pool.length)){ const k = pick(pool, run.rng); if(!choice.includes(k)) choice.push(k); }
    if(!choice.length){ enterDepth(run.depth + 1); setMode('play'); return; }
    run.offer = choice;
    setMode('relic');
  }

  function chooseRelic(n){
    if(mode !== 'relic' || !run.offer[n]) return;
    const k = run.offer[n];
    run.relics[k] = (run.relics[k] || 0) + 1;
    if(k === 'hide'){ run.maxHp += 25; run.hp += 25; }
    enterDepth(run.depth + 1);
    setMode('play');
  }

  function die(why){
    if(mode !== 'play') return;
    if(run.tutorial){
      // Back to the last sign passed, healed, with a moment of safety.
      const [x, y] = run.respawn || [lvl.start[0] - 6, lvl.start[1] - 22];
      burst(player.x + 6, player.y + 11, '#5fe3f0', 14, 0.9);
      Object.assign(player, { x, y, vx: 0, vy: 0, inv: 1.5, onLift: null, dash: 0, knock: 0 });
      run.hp = run.maxHp; hostile = [];
      showToast(why + ' — try again');
      return;
    }
    run.hp = 0; run.cause = why;
    burst(player.x + 6, player.y + 11, '#5fe3f0', 18, 1.3);
    save.kills += run.kills - (run.savedKills || 0); run.savedKills = run.kills; persist();
    player.dead = true;
    setMode('dead');
  }

  // ---------------------------------------------------------------- foes
  function spawnFoe(type, cx, cy, rows){
    // Enemies toughen with depth; the Warden is tuned as-is and does not.
    const d = FOES[type], depth = run && type !== 'W' ? run.depth : 0, scale = 1 + 0.15 * depth;
    const f = { type, w: d.w, h: d.h, hp: d.hp * scale, maxHp: d.hp * scale, dmg: d.dmg * (1 + 0.1 * depth),
      x: cx * T + T / 2 - d.w / 2, y: (cy + 1) * T - d.h, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1,
      flash: 0, t: rand(0, 3), state: 'idle', cd: rand(0.5, 2), ground: false, anim: rand(0, 6) };
    if(type === 'B'){ f.y = cy * T + 1; f.homeY = f.y; f.state = 'hang'; }
    if(type === 'S'){
      // Stick to whichever rock is next to the slot: ceiling first, then walls, then floor.
      const rock = (x, y) => rows && rows[y] && rows[y][x] === '#';
      if(rock(cx, cy - 1)){ f.nx = 0; f.ny = 1; f.y = cy * T; }
      else if(rock(cx - 1, cy)){ f.nx = 1; f.ny = 0; f.x = cx * T; f.y = cy * T; }
      else if(rock(cx + 1, cy)){ f.nx = -1; f.ny = 0; f.x = (cx + 1) * T - d.w; f.y = cy * T; }
      else { f.nx = 0; f.ny = -1; }
    }
    if(type === 'N'){ f.children = 0; }
    if(type === 'W'){ f.x = cx * T - d.w / 2; f.y = cy * T - d.h / 2; f.state = 'dormant'; f.phase = 1; f.attacks = 0; }
    foes.push(f);
    return f;
  }

  // ---------------------------------------------------------------- physics
  function moveX(b, dx){
    b.x += dx;
    const top = Math.floor(b.y / T), bot = Math.floor((b.y + b.h - 0.01) / T);
    if(dx > 0){ const c = Math.floor((b.x + b.w) / T);
      for(let r = top; r <= bot; r++) if(solidAt(c, r)){ b.x = c * T - b.w - 0.01; return true; } }
    else if(dx < 0){ const c = Math.floor(b.x / T);
      for(let r = top; r <= bot; r++) if(solidAt(c, r)){ b.x = (c + 1) * T + 0.01; return true; } }
    return false;
  }
  // Returns the tile landed on (or -1 for a ceiling bump, 0 for nothing).
  function moveY(b, dy, drop){
    const prevBot = b.y + b.h; b.y += dy;
    const l = Math.floor(b.x / T), r = Math.floor((b.x + b.w - 0.01) / T);
    if(dy > 0){ const row = Math.floor((b.y + b.h) / T);
      for(let c = l; c <= r; c++){ const t = tileAt(c, row);
        if(solidT(t) || (t === PLANK && !drop && prevBot <= row * T + 0.5)){ b.y = row * T - b.h; return t; } } }
    else if(dy < 0){ const row = Math.floor(b.y / T);
      for(let c = l; c <= r; c++) if(solidAt(c, row)){ b.y = (row + 1) * T + 0.01; return -1; } }
    return 0;
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------------------------------------------------------------- player
  // Permanent crystals stack up to three pickups: Splitter fires 3, 4 then 5
  // shots, Ricochet bounces 2, 3 then 4 times. Past that a pickup heals.
  const PERM_CAP = 3;
  const has = k => (run && run.perm[k]) || 0;
  const shotCount = () => has('splitter') ? 2 + has('splitter') : 1;
  const bounces = () => has('ricochet') ? 1 + has('ricochet') : 0;
  const timed = k => player.timers[k] > 0;

  function heal(n){ if(!run) return; const before = run.hp; run.hp = Math.min(run.maxHp, run.hp + n);
    if(run.hp > before) floatText(player.x + 6, player.y - 6, '+' + Math.round(run.hp - before), '#7cf0a0'); }

  function hurt(n, fromX, why){
    if(mode !== 'play' || player.inv > 0 || player.dash > 0) return false;
    if(player.aegis > 0){
      player.aegis--; player.inv = 0.6;
      burst(player.x + 6, player.y + 11, POWERS.aegis.color, 10, 0.6);
      floatText(player.x + 6, player.y - 6, player.aegis ? 'Aegis -1' : 'Aegis broke', POWERS.aegis.color);
      return true;
    }
    run.hp -= n; player.inv = 0.9; hurtFlash = 0.35; cam.shake = Math.max(cam.shake, 6);
    player.vx = (player.x + 6 < fromX ? -1 : 1) * 260; player.vy = Math.min(player.vy, -300); player.cut = true;
    floatText(player.x + 6, player.y - 6, '-' + Math.round(n), '#ff7a5c');
    if(run.hp <= 0) die(why || 'Overwhelmed');
    return true;
  }

  // Which way out of a lava pool or spike bed is shortest, so the knockback
  // throws you clear instead of straight back into it. Ties go the way you face.
  function escape(cx, cy){
    const reach = s => { for(let d = 1; d < 12; d++){ const x = cx + s * d, t = tileAt(x, cy);
      if(solidT(tileAt(x, cy - 1))) return 99; // a wall: no way out on this side
      if(t !== LAVA && t !== SPIKE && (solidT(t) || solidT(tileAt(x, cy + 1)))) return d; } return 99; };
    const first = Math.sign(player.vx) || player.face;
    return reach(-first) < reach(first) ? -first : first;
  }

  function updatePlayer(dt){
    const p = player;
    p.inv = Math.max(0, p.inv - dt);
    for(const k in p.timers) if(p.timers[k] > 0){ p.timers[k] -= dt;
      if(p.timers[k] <= 0){ p.timers[k] = 0; showToast(POWERS[k].name + ' wore off'); } }

    const want = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    if(want) p.face = want;
    const aimX = cam.x + mouse.x, aimY = cam.y + mouse.y;

    // Blink: a short dash that passes through enemies.
    if(pressed.has('dash') && p.blink > 0 && p.dash <= 0){
      p.blink--; p.dash = DASH_T; p.dashDir = want || (aimX > p.x + 6 ? 1 : -1);
      burst(p.x + 6, p.y + 11, POWERS.blink.color, 8, 0.4);
      if(!p.blink) showToast('Blink spent');
    }
    if(p.dash > 0){
      p.dash -= dt; p.vx = p.dashDir * DASH_V; p.vy = 0;
      if(Math.random() < 0.6) parts.push({ x: p.x + 6, y: p.y + rand(2, 20), vx: 0, vy: 0, life: 0.3, max: 0.3, size: 3, color: POWERS.blink.color });
    } else if(p.knock > 0){
      p.knock -= dt;
    } else {
      const acc = p.ground ? ACC_GROUND : ACC_AIR;
      if(want) p.vx = clamp(p.vx + want * acc * dt, -RUN, RUN);
      else { const f = (p.ground ? 2800 : 900) * dt; p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f; }
    }

    // Jumping: coyote time, buffering, variable height, featherfall extras.
    p.coyote = p.ground ? COYOTE : Math.max(0, p.coyote - dt);
    if(pressed.has('jump')) p.buffer = BUFFER; else p.buffer = Math.max(0, p.buffer - dt);
    const jumpHeld = keys.has('jump');
    if(p.buffer > 0 && p.coyote > 0){
      p.vy = -JUMP_V; p.buffer = 0; p.coyote = 0; p.ground = false; p.onLift = null; p.cut = false; p.jumpT = 0;
      dust(p.x + 6, p.y + p.h, 5);
    } else if(pressed.has('jump') && !p.ground && timed('feather') && !p.doubleUsed){
      p.vy = -DOUBLE_V; p.doubleUsed = true; p.cut = false; p.buffer = 0; p.jumpT = 0;
      burst(p.x + 6, p.y + p.h, POWERS.feather.color, 6, 0.4);
    }
    // Letting go early cuts the rise, but never below a short minimum hop.
    p.jumpT = (p.jumpT || 0) + dt;
    if(!jumpHeld && p.jumpT > 0.08 && p.vy < -120 && !p.cut && !p.padLaunch){ p.vy *= 0.5; p.cut = true; }
    if(pressed.has('down')) p.drop = 0.25;
    p.drop = Math.max(0, p.drop - dt);

    if(p.dash <= 0){
      p.vy = Math.min(p.vy + GRAV * dt, MAX_FALL);
      if(timed('feather') && jumpHeld && p.vy > GLIDE_FALL) p.vy = GLIDE_FALL;
    }
    if(p.onLift){ p.y += p.onLift.dy; }

    moveX(p, p.vx * dt);
    const was = p.ground;
    const prevBot = p.y + p.h;
    const landed = moveY(p, p.vy * dt, p.drop > 0);
    p.ground = false; p.onLift = null;
    if(landed > 0){ if(p.vy > 400) dust(p.x + 6, p.y + p.h, 4); p.vy = 0; p.ground = true; }
    else if(landed < 0) p.vy = Math.max(p.vy, 0);
    if(!p.ground && p.vy >= 0) for(const l of lvl.lifts){
      if(p.x + p.w > l.x && p.x < l.x + l.w && prevBot <= l.y + 1 && p.y + p.h >= l.y){
        p.y = l.y - p.h; p.vy = 0; p.ground = true; p.onLift = l; break; }
    }
    if(p.ground){ p.doubleUsed = false; p.padLaunch = false; }
    if(run.tutorial && p.ground && !p.onLift && landed !== PAD){
      const s = lvl.signs[run.checkpoint + 1];
      const safe = [p.x + 1, p.x + p.w - 1].every(x => { const t = tileAt(Math.floor(x / T), Math.floor((p.y + p.h - 1) / T)); return t !== SPIKE && t !== LAVA; });
      if(s && safe && p.x > s.x * T){ run.checkpoint++; run.respawn = [p.x, p.y]; }
    }
    if(landed === PAD){
      p.vy = -PAD_V; p.ground = false; p.padLaunch = true; p.cut = true;
      burst(p.x + 6, p.y + p.h, '#5ff0b0', 10, 0.5);
    }
    if(!was && p.ground) p.cut = false;
    p.walk += Math.abs(p.vx) * dt * 0.08;

    // Hazards and the exit, from the tiles the body overlaps.
    const l = Math.floor((p.x + 2) / T), r = Math.floor((p.x + p.w - 2) / T);
    const t = Math.floor((p.y + 2) / T), b = Math.floor((p.y + p.h - 1) / T);
    for(let cy = t; cy <= b; cy++) for(let cx = l; cx <= r; cx++){
      const tt = tileAt(cx, cy);
      if(tt === VOID){ die('Fell into the abyss'); return; }
      if(tt === LAVA){ if(hurt(34, p.x + 6, 'Burned in lava')){ p.vy = -620; p.cut = true; p.vx = escape(cx, cy) * 240; p.knock = 0.35; burst(p.x + 6, p.y + p.h, '#ff8a3a', 12, 0.6); } }
      if(tt === SPIKE && p.y + p.h > cy * T + 7){ if(hurt(22, p.x + 6, 'Impaled on spikes')){ p.vy = -430; p.cut = true; p.vx = escape(cx, cy) * 200; p.knock = 0.3; } }
      if(tt === EXIT && !lvl.sealed){ depthCleared(); return; }
    }
    if(p.y > lvl.H * T + 40){ die('Fell into the abyss'); return; }

    // Beacons: one full heal each.
    for(const bc of lvl.beacons) if(!bc.lit && Math.abs(bc.x - (p.x + 6)) < 18 && Math.abs(bc.y - (p.y + p.h)) < 26){
      bc.lit = true; run.hp = run.maxHp;
      flashes.push({ x: bc.x, y: bc.y - 14, r: 260, life: 0.8, max: 0.8, color: '120,240,170' });
      burst(bc.x, bc.y - 14, '#8fdc6a', 20, 0.9);
      showToast('Beacon lit — fully healed');
    }

    // Firing.
    p.fireCd -= dt;
    if((mouse.down || keys.has('fire')) && p.fireCd <= 0 && p.dash <= 0){
      const rate = (1 + 0.2 * (run.relics.hands || 0)) * (timed('overclock') ? 2 : 1);
      p.fireCd = FIRE_GAP / rate;
      const ox = p.x + 6, oy = p.y + 9, a = Math.atan2(aimY - oy, aimX - ox);
      const dmg = SHOT_DMG * (1 + 0.3 * (run.relics.flint || 0));
      const n = shotCount(), spread = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 0.16);
      for(const s of spread) bullets.push({ x: ox + Math.cos(a) * 10, y: oy + Math.sin(a) * 10,
        vx: Math.cos(a + s) * SHOT_V, vy: Math.sin(a + s) * SHOT_V, life: SHOT_LIFE, dmg, bounce: bounces() });
      flashes.push({ x: ox + Math.cos(a) * 12, y: oy + Math.sin(a) * 12, r: 70, life: 0.06, max: 0.06, color: '95,227,240' });
    }
  }

  // ---------------------------------------------------------------- lifts
  function updateLifts(dt){
    for(const l of lvl.lifts){
      const before = l.y;
      if(l.wait > 0) l.wait -= dt;
      else { l.y += l.dir * 70 * dt;
        if(l.y <= l.top){ l.y = l.top; l.dir = 1; l.wait = 1; }
        if(l.y >= l.bottom){ l.y = l.bottom; l.dir = -1; l.wait = 1; } }
      l.dy = l.y - before;
    }
  }

  // ---------------------------------------------------------------- shots
  function updateBullets(dt){
    for(let i = bullets.length; i--;){
      const s = bullets[i];
      s.life -= dt;
      const ox = s.x, oy = s.y; s.x += s.vx * dt; s.y += s.vy * dt;
      let dead = s.life <= 0;
      if(!dead && solidPx(s.x, s.y)){
        if(s.bounce > 0){
          s.bounce--;
          const hx = solidPx(s.x, oy), hy = solidPx(ox, s.y);
          if(hx) s.vx = -s.vx; if(hy) s.vy = -s.vy; if(!hx && !hy){ s.vx = -s.vx; s.vy = -s.vy; }
          s.x = ox; s.y = oy; s.life = Math.max(s.life, 0.35);
          spark(s.x, s.y, '#b48cff', 3);
        } else { dead = true; spark(ox, oy, '#9feff7', 4); }
      }
      if(!dead) for(const f of foes){
        if(f.dead || s.x < f.x || s.x > f.x + f.w || s.y < f.y || s.y > f.y + f.h) continue;
        damageFoe(f, s.dmg, s.vx); spark(s.x, s.y, '#ffe0a0', 4); dead = true; break;
      }
      if(dead) bullets.splice(i, 1);
    }
    for(let i = hostile.length; i--;){
      const s = hostile[i];
      s.life -= dt; s.vy += (s.g || 0) * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      let dead = s.life <= 0;
      if(!dead && solidPx(s.x, s.y)){ dead = true; spark(s.x, s.y, s.color, 6); }
      if(!dead && s.x > player.x - s.r && s.x < player.x + player.w + s.r && s.y > player.y - s.r && s.y < player.y + player.h + s.r){
        hurt(s.dmg, s.x, s.kind === 'orb' ? 'Struck down by the Warden' : 'Dissolved by acid'); dead = true; spark(s.x, s.y, s.color, 6);
      }
      if(dead) hostile.splice(i, 1);
    }
  }

  function damageFoe(f, n, push){
    if(f.type === 'W' && f.state === 'rest') n *= 1.5;
    f.hp -= n; f.flash = 0.08; f.asleep = false;
    if(f.type === 'W' && f.state === 'dormant') wakeWarden(f);
    if(f.type === 'B' && f.state === 'hang') f.state = 'swoop';
    if(f.type !== 'W' && f.type !== 'N' && f.type !== 'S') f.vx += Math.sign(push) * (f.type === 'R' ? 20 : 60);
    if(f.hp <= 0) killFoe(f);
  }

  function killFoe(f, silent){
    if(f.dead) return;
    f.dead = true;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, d = FOES[f.type];
    if(f.parent) f.parent.children--;
    if(silent) return;
    run.kills++;
    const n = f.type === 'W' ? 46 : Math.round(7 + (f.w + f.h) / 6);
    for(let i = 0; i < n; i++){
      const a = rand(0, Math.PI * 2), sp = rand(80, f.type === 'W' ? 520 : 300), pts = [];
      const k = 3 + (Math.random() * 3 | 0), size = rand(3, f.type === 'W' ? 12 : 7);
      for(let j = 0; j < k; j++) pts.push([Math.cos(j / k * 6.283 + rand(-0.3, 0.3)) * size * rand(0.6, 1), Math.sin(j / k * 6.283 + rand(-0.3, 0.3)) * size * rand(0.6, 1)]);
      frags.push({ x: cx + rand(-f.w / 3, f.w / 3), y: cy + rand(-f.h / 3, f.h / 3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        rot: rand(0, 6), vr: rand(-12, 12), pts, color: Math.random() < 0.25 ? '#ffd9a0' : d.color, life: rand(0.9, 1.6), max: 1.6 });
    }
    burst(cx, cy, '#ffb070', f.type === 'W' ? 40 : 10, 0.6);
    flashes.push({ x: cx, y: cy, r: f.type === 'W' ? 420 : 130, life: f.type === 'W' ? 1.2 : 0.35, max: f.type === 'W' ? 1.2 : 0.35, color: '255,170,90' });
    cam.shake = Math.max(cam.shake, f.type === 'W' ? 18 : f.type === 'R' ? 6 : 2);
    if(Math.random() < d.spark * (f.parent ? 0.4 : 1)) drops.push({ kind: 'spark', x: cx, y: cy, vx: rand(-60, 60), vy: rand(-160, -60), t: 0, life: 18 });
    const crystalChance = 0.03 + 0.1 * (run.relics.eye || 0);
    if(f.type !== 'W' && Math.random() < crystalChance * (f.parent ? 0.4 : 1))
      drops.push({ kind: 'crystal', type: Math.random() < 0.12 ? pick(['splitter', 'ricochet']) : pick(ROLLABLE), x: cx, y: cy - 6, t: 0, life: 25 });
    if(f.type === 'W'){
      lvl.sealed = false; prerender();
      showToast('The Warden falls — the way down is open');
      for(const e of foes) if(e.type === 'B' && e.summoned) killFoe(e);
    }
  }

  // ---------------------------------------------------------------- foe AI
  const LOS = (x0, y0, x1, y1) => {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 8);
    for(let i = 1; i < n; i++) if(solidPx(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
    return true;
  };
  const footing = (x, y) => { const t = tileAt(Math.floor(x / T), Math.floor(y / T)); return t === ROCK || t === PLANK || t === PAD; };

  function walker(f, dt, speed, edgeTurn = true){
    f.vy = Math.min(f.vy + GRAV * dt, MAX_FALL);
    const target = f.dir * speed;
    f.vx += clamp(target - f.vx, -600 * dt, 600 * dt);
    const hit = moveX(f, f.vx * dt);
    const landed = moveY(f, f.vy * dt, false);
    f.ground = landed > 0; if(landed) f.vy = 0;
    // Stop dead on a wall bump: velocity eases toward the new direction, so
    // without this it still points into the wall next step and flips back.
    if(hit && f.ground){ f.dir = -f.dir; f.vx = 0; }
    if(edgeTurn && f.ground){
      const ahead = f.dir > 0 ? f.x + f.w + 2 : f.x - 2;
      const below = tileAt(Math.floor(ahead / T), Math.floor((f.y + f.h + 2) / T));
      if(!footing(ahead, f.y + f.h + 2) || below === LAVA || tileAt(Math.floor(ahead / T), Math.floor((f.y + f.h - 2) / T)) === SPIKE) f.dir = -f.dir;
    }
    if(tileAt(Math.floor((f.x + f.w / 2) / T), Math.floor((f.y + f.h) / T)) === VOID) killFoe(f, true);
  }

  function updateFoes(dt){
    const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
    for(const f of foes){
      if(f.dead) continue;
      f.flash = Math.max(0, f.flash - dt);
      if(f.asleep){ const c = pcx / T; if(c >= f.room[0] && c < f.room[1]) f.asleep = false; else continue; }
      f.t += dt; f.anim += dt;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2, dx = pcx - cx, dy = pcy - cy, dist = Math.hypot(dx, dy);
      if(dist > 900 && f.type !== 'W') continue; // far away foes sleep
      switch(f.type){
        case 'C': walker(f, dt, 55 + 6 * run.depth); break;
        case 'B': {
          if(f.state === 'hang'){ if(dist < 260 && LOS(cx, cy, pcx, pcy)) f.state = 'swoop'; break; }
          if(f.state === 'swoop'){
            const sp = 190 + 10 * run.depth;
            f.vx += clamp(dx / (dist || 1) * sp - f.vx, -500 * dt, 500 * dt);
            f.vy += clamp(dy / (dist || 1) * sp - f.vy, -500 * dt, 500 * dt);
            if(f.t > 2.4 || dist < 14){ f.state = 'rise'; f.t = 0; }
          } else if(f.state === 'rise'){
            f.vy += (-160 - f.vy) * 3 * dt; f.vx *= 1 - 2 * dt;
            if(f.t > 0.9){ f.state = 'swoop'; f.t = 0; }
          }
          if(moveX(f, f.vx * dt)) f.vx = -f.vx * 0.5;
          if(moveY(f, f.vy * dt, true)) f.vy = -f.vy * 0.5;
          break;
        }
        case 'S': {
          f.cd -= dt;
          if(f.cd <= 0 && dist < 420 && LOS(cx, cy, pcx, pcy)){
            f.cd = 2.2 - 0.15 * run.depth;
            const g = 900, tt = clamp(dist / 320, 0.55, 1.3);
            const sx = cx + f.nx * 8, sy = cy + f.ny * 8;
            hostile.push({ kind: 'acid', x: sx, y: sy, vx: (pcx - sx) / tt, vy: (pcy - sy - 0.5 * g * tt * tt) / tt, g, r: 5,
              dmg: f.dmg, life: 3, color: '#b8e040' });
            f.anim = 0;
          }
          break;
        }
        case 'R': {
          if(f.state === 'idle'){
            walker(f, dt, 40);
            if(Math.abs(dy) < 44 && Math.abs(dx) < 320 && LOS(cx, cy, pcx, pcy)){ f.state = 'wind'; f.t = 0; f.dir = Math.sign(dx) || 1; }
          } else if(f.state === 'wind'){
            walker(f, dt, 0, false);
            if(f.t > 0.45){ f.state = 'charge'; f.t = 0; }
          } else if(f.state === 'charge'){
            f.vx = f.dir * (330 + 15 * run.depth);
            f.vy = Math.min(f.vy + GRAV * dt, MAX_FALL);
            const hit = moveX(f, f.vx * dt); const landed = moveY(f, f.vy * dt, false); if(landed) f.vy = 0;
            const ahead = f.dir > 0 ? f.x + f.w + 2 : f.x - 2;
            if(hit || f.t > 1.3 || (landed > 0 && !footing(ahead, f.y + f.h + 2))){
              f.state = 'stun'; f.t = 0; f.vx = 0; if(hit){ cam.shake = Math.max(cam.shake, 4); dust(ahead, f.y + f.h - 4, 6); } }
            if(Math.random() < 0.5) dust(cx - f.dir * 12, f.y + f.h, 1);
          } else if(f.state === 'stun'){
            walker(f, dt, 0, false);
            if(f.t > 0.8){ f.state = 'idle'; f.t = 0; }
          }
          break;
        }
        case 'N': {
          f.cd -= dt;
          if(f.cd <= 0 && dist < 420 && f.children < 3){
            f.cd = 3.5; f.children++;
            const c = spawnFoe('C', Math.floor(cx / T), Math.floor((f.y + f.h - 1) / T));
            c.parent = f; c.room = f.room; c.vy = -260; c.dir = Math.sign(dx) || 1;
            burst(cx, f.y + 4, '#d08a50', 6, 0.4);
          }
          break;
        }
        case 'W': updateWarden(f, dt, dx, dy, dist, pcx, pcy); break;
      }
      if(f.room){ const lo = f.room[0] * T, hi = f.room[1] * T - f.w;
        if(f.x < lo || f.x > hi){ f.x = clamp(f.x, lo, hi); f.vx = 0; f.dir = f.x <= lo ? 1 : -1;
          if(f.state === 'charge'){ f.state = 'stun'; f.t = 0; } } }
      if(!f.dead && overlap(f, player)) hurt(f.dmg, cx, f.type === 'W' ? 'Crushed by the Warden' : 'Killed by a ' + ({ C: 'crawler', B: 'bat', S: 'spitter', R: 'brute', N: 'grub nest' })[f.type]);
    }
    foes = foes.filter(f => !f.dead);
  }

  function wakeWarden(f){
    f.state = 'hover'; f.t = 0; f.cd = 1.2;
    showToast('The Warden wakes'); cam.shake = 10;
  }

  function updateWarden(f, dt, dx, dy, dist, pcx, pcy){
    const A = lvl.arena, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    if(f.state === 'dormant'){ if(pcx > A.x0 && pcx < A.x1 && pcy > A.y0 && pcy < A.y1) wakeWarden(f); return; }
    const phase = f.hp < f.maxHp / 3 ? 3 : f.hp < f.maxHp * 2 / 3 ? 2 : 1;
    if(phase !== f.phase){ f.phase = phase; cam.shake = 14; burst(cx, cy, '#ff6a3a', 24, 0.8);
      flashes.push({ x: cx, y: cy, r: 300, life: 0.6, max: 0.6, color: '255,110,60' });
      showToast(phase === 2 ? 'The Warden calls the swarm' : 'The Warden is enraged'); }
    const orbs = (n, sp, spread) => { const a0 = Math.atan2(pcy - cy, pcx - cx);
      for(let i = 0; i < n; i++){ const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
        hostile.push({ kind: 'orb', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, dmg: 11, life: 5, color: '#ff8a4a' }); } };
    if(f.state === 'hover'){
      const tx = clamp(pcx + Math.sin(f.t * 0.7) * 200, A.x0 + f.w, A.x1 - f.w) - f.w / 2;
      const ty = A.y0 + 4 * T + Math.sin(f.t * 1.3) * 18;
      const k = phase === 3 ? 2.4 : 1.6;
      f.vx += ((tx - f.x) * k - f.vx) * 2 * dt; f.vy += ((ty - f.y) * k - f.vy) * 2 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.cd -= dt;
      if(f.cd <= 0){
        f.attacks++;
        if(phase === 3 && f.attacks % 2 === 0){ f.state = 'rise'; f.t = 0; }
        else if(phase >= 2 && f.attacks % 3 === 0 && foes.filter(e => e.summoned).length < 4){
          for(const s of [-1, 1]){ const b = spawnFoe('B', Math.floor((cx + s * 40) / T), Math.floor(cy / T));
            b.state = 'swoop'; b.summoned = true; b.x = cx + s * 40; b.y = cy; }
          burst(cx, cy, '#f0a040', 14, 0.6);
        }
        else orbs(phase === 1 ? 5 : phase === 2 ? 7 : 9, 230 + 30 * phase, 0.9 + 0.15 * phase);
        f.cd = phase === 1 ? 1.7 : phase === 2 ? 1.4 : 1.1;
      }
    } else if(f.state === 'rise'){
      f.vx *= 1 - 4 * dt; f.vy = -260; f.x += f.vx * dt; f.y = Math.max(A.y0 + T, f.y + f.vy * dt);
      if(f.t > 0.5){ f.state = 'dive'; f.t = 0; f.x = clamp(pcx - f.w / 2, A.x0 + T, A.x1 - f.w - T); }
    } else if(f.state === 'dive'){
      f.y += 900 * dt;
      if(f.y + f.h >= A.y1){ f.y = A.y1 - f.h; f.state = 'rest'; f.t = 0; cam.shake = 16;
        for(let i = 0; i < 14; i++){ const a = Math.PI + i / 13 * Math.PI;
          hostile.push({ kind: 'orb', x: f.x + f.w / 2, y: f.y + f.h - 8, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 6, dmg: 11, life: 4, color: '#ff8a4a' }); }
        dust(f.x + f.w / 2, f.y + f.h, 20); }
    } else if(f.state === 'rest'){
      if(f.t > 1){ f.state = 'hover'; f.t = 0; f.cd = 0.8; }
    }
  }

  // ---------------------------------------------------------------- drops
  function updateDrops(dt){
    const pcx = player.x + 6, pcy = player.y + 11;
    for(let i = drops.length; i--;){
      const d = drops[i];
      d.t = (d.t || 0) + dt;
      const dx = pcx - d.x, dy = pcy - d.y, dist = Math.hypot(dx, dy);
      if(d.kind === 'spark'){
        if(dist < 240){ const k = 900 / Math.max(dist, 30); d.vx += dx * k * dt; d.vy += dy * k * dt; }
        else if(!d.rest){ d.vy += 200 * dt; }
        d.vx *= 1 - 2.5 * dt; d.vy *= 1 - 2.5 * dt;
        if(!d.rest || dist < 240){ d.x += d.vx * dt; d.y += d.vy * dt; if(solidPx(d.x, d.y)){ d.x -= d.vx * dt; d.y -= d.vy * dt; d.vx = 0; d.vy = 0; } }
        if(dist < 16){ heal(12 * (1 + 0.6 * (run.relics.ember || 0))); burst(d.x, d.y, '#7cf0a0', 8, 0.4); drops.splice(i, 1); continue; }
      } else if(dist < 18){ grant(d.type); drops.splice(i, 1); continue; }
      if(d.life && d.t > d.life) drops.splice(i, 1);
    }
  }

  function grant(k){
    const P = POWERS[k], dur = 1 + 0.4 * (run.relics.candle || 0);
    burst(player.x + 6, player.y + 11, P.color, 14, 0.6);
    flashes.push({ x: player.x + 6, y: player.y + 11, r: 160, life: 0.4, max: 0.4, color: '255,255,255' });
    // A crystal you already hold stacks onto what you have.
    let again = '';
    if(P.perm){
      if(run.perm[k] >= PERM_CAP){ heal(30); showToast(P.name + ' is maxed — healed'); return; }
      run.perm[k] = (run.perm[k] || 0) + 1;
      if(run.perm[k] > 1) again = k === 'splitter' ? `shots fork into ${shotCount()}` : `shots bounce ${bounces()} times`;
    }
    else if(P.time){
      if(player.timers[k] > 0) again = `+${Math.round(P.time * dur)}s`;
      player.timers[k] = Math.max(0, player.timers[k] || 0) + P.time * dur;
    }
    else if(k === 'aegis'){ if(player.aegis > 0) again = '+2 hits'; player.aegis += 2; }
    else if(k === 'blink'){ if(player.blink > 0) again = '+2 dashes'; player.blink += player.blink > 0 ? 2 : 3; }
    showToast(P.name + ' — ' + (again || P.what));
  }

  // ---------------------------------------------------------------- particles
  function burst(x, y, color, n, life){ for(let i = 0; i < n; i++){ const a = rand(0, 6.283), s = rand(40, 260);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), max: life, size: rand(1.5, 3.5), color, g: 300 }); } }
  function spark(x, y, color, n){ burst(x, y, color, n, 0.25); }
  function dust(x, y, n){ for(let i = 0; i < n; i++) parts.push({ x: x + rand(-6, 6), y, vx: rand(-60, 60), vy: rand(-60, -10),
    life: rand(0.3, 0.6), max: 0.6, size: rand(2, 4), color: '#8a7a66', g: 60 }); }
  function floatText(x, y, s, color){ texts.push({ x, y, s, color, life: 0.9 }); }
  function showToast(s){ toast = { s, life: 2.6 }; }

  function updateParticles(dt){
    for(let i = parts.length; i--;){ const p = parts[i];
      p.life -= dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if(p.drip && solidPx(p.x, p.y)){ spark(p.x, p.y - 2, '#6c8a96', 2); p.life = 0; }
      if(p.life <= 0) parts.splice(i, 1); }
    for(let i = frags.length; i--;){ const f = frags[i];
      f.life -= dt; f.vy += 900 * dt; f.rot += f.vr * dt;
      const ox = f.x, oy = f.y; f.x += f.vx * dt; f.y += f.vy * dt;
      if(solidPx(f.x, f.y)){ if(solidPx(f.x, oy)) { f.vx *= -0.4; f.x = ox; } else { f.vy *= -0.35; f.vx *= 0.7; f.vr *= 0.6; f.y = oy; } }
      if(f.life <= 0) frags.splice(i, 1); }
    for(let i = flashes.length; i--;){ flashes[i].life -= dt; if(flashes[i].life <= 0) flashes.splice(i, 1); }
    for(let i = texts.length; i--;){ texts[i].life -= dt; texts[i].y -= 30 * dt; if(texts[i].life <= 0) texts.splice(i, 1); }
    if(toast && (toast.life -= dt) <= 0) toast = null;
    // Drips fall from ceilings near the camera.
    dripClock -= dt;
    if(dripClock <= 0){
      dripClock = 0.12;
      const x = Math.floor((cam.x + Math.random() * VW) / T);
      for(let y = Math.floor(cam.y / T); y < (cam.y + VH) / T; y++)
        if(tileAt(x, y) === ROCK && tileAt(x, y + 1) === AIR){
          parts.push({ x: x * T + rand(3, 13), y: (y + 1) * T + 1, vx: 0, vy: 0, g: 700, life: 3, max: 3, size: 2, color: '#7896a4', drip: true }); break; }
    }
    for(const m of motes){ m.x = (m.x + m.vx * dt + VW) % VW; m.y = (m.y + m.vy * dt + VH) % VH; }
  }

  function updateMoss(dt){
    const pcx = player.x + 6, pcy = player.y + 11;
    for(const m of lvl.moss){
      const d = Math.hypot(m.x * T + 8 - pcx, m.y * T + 8 - pcy);
      if(d < 300) m.lit = Math.min(1, m.lit + dt * 3 * (1 - d / 300) + dt * 0.5);
      else if(m.lit > 0.4) m.lit = Math.max(0.4, m.lit - dt * 0.15);
    }
  }

  // ---------------------------------------------------------------- loop
  function step(dt){
    if(mode !== 'play') return;
    run.time += dt;
    updateLifts(dt);
    updatePlayer(dt);
    if(mode !== 'play'){ pressed.clear(); return; }
    updateBullets(dt);
    updateFoes(dt);
    updateDrops(dt);
    updateParticles(dt);
    updateMoss(dt);
    hurtFlash = Math.max(0, hurtFlash - dt);
    cam.shake = Math.max(0, cam.shake - 30 * dt);
    let tx = player.x + 6 - VW / 2 + (mouse.x - VW / 2) * 0.18, ty = player.y + 11 - VH / 2 + (mouse.y - VH / 2) * 0.18;
    // In the Warden's hollow, frame the whole arena height rather than the player.
    const A = lvl.arena;
    if(A && player.x > A.x0 && player.x < A.x1 && player.y > A.y0) ty = (A.y0 + A.y1) / 2 - VH / 2 + 24;
    const k = 1 - Math.exp(-7 * dt);
    cam.x = clamp(cam.x + (tx - cam.x) * k, 0, lvl.W * T - VW);
    cam.y = clamp(cam.y + (ty - cam.y) * k, 0, lvl.H * T - VH);
    pressed.clear();
  }

  let last = performance.now(), acc = 0;
  function frame(now){
    acc = Math.min(acc + (now - last) / 1000, 0.1); last = now;
    while(acc >= STEP){ step(STEP); acc -= STEP; }
    if(mode !== 'play') updateParticlesIdle(1 / 60);
    render(now / 1000);
    hud();
    requestAnimationFrame(frame);
  }
  // Out of play the cave keeps breathing: dust and drips, nothing else.
  function updateParticlesIdle(dt){ if(lvl && mode !== 'pause'){ for(const m of motes){ m.x = (m.x + m.vx * dt + VW) % VW; m.y = (m.y + m.vy * dt + VH) % VH; } } }

  // ---------------------------------------------------------------- render
  // The static cave is drawn once per depth onto a big offscreen canvas.
  function prerender(){
    const { W, H, tiles } = lvl, pal = lvl.pal.rock;
    const c = lvl.canvas || document.createElement('canvas');
    c.width = W * T; c.height = H * T;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
      const t = tiles[y * W + x], px = x * T, py = y * T;
      if(t === ROCK){
        const h = hash(x, y, lvl.index), k = 0.78 + h * 0.34;
        g.fillStyle = rgb(pal, k); g.fillRect(px, py, T, T);
        // Square-pixel grain: a couple of 4x4 flecks per tile.
        for(let j = 0; j < 3; j++){ const hh = hash(x, y, j + 9);
          if(hh < 0.55){ g.fillStyle = rgb(pal, hh < 0.3 ? k * 0.8 : k * 1.15);
            g.fillRect(px + (hash(x, y, j + 20) * 3 | 0) * 4, py + (hash(x, y, j + 30) * 3 | 0) * 4, 4, 4); } }
        const air = (dx, dy) => { const n = tileAt(x + dx, y + dy); return n !== ROCK && n !== PAD; };
        if(air(0, -1)){ g.fillStyle = rgb(pal, k * 1.35); g.fillRect(px, py, T, 3); }
        if(air(0, 1)){ g.fillStyle = rgb(pal, k * 0.55); g.fillRect(px, py + T - 3, T, 3); }
        if(air(-1, 0)){ g.fillStyle = rgb(pal, k * 0.85); g.fillRect(px, py, 2, T); }
        if(air(1, 0)){ g.fillStyle = rgb(pal, k * 0.7); g.fillRect(px + T - 2, py, 2, T); }
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
      } else if(t === PLANK){
        g.fillStyle = '#6b4a2c'; g.fillRect(px, py, T, 5);
        g.fillStyle = '#8a6238'; g.fillRect(px, py, T, 2);
        g.fillStyle = '#3c2817'; g.fillRect(px + (x % 2 ? 3 : 10), py + 1, 2, 4);
      } else if(t === SPIKE){
        g.fillStyle = '#9a9aa4';
        for(const sx of [2, 9]){ g.fillRect(px + sx, py + 12, 6, 4); g.fillRect(px + sx + 1, py + 8, 4, 4); g.fillRect(px + sx + 2, py + 4, 2, 4); }
        g.fillStyle = '#d8d8e0'; g.fillRect(px + 4, py + 4, 1, 4); g.fillRect(px + 11, py + 4, 1, 4);
      } else if(t === PAD){
        g.fillStyle = '#1d5a4a'; g.fillRect(px, py, T, T);
        g.fillStyle = '#3fd0a0'; g.fillRect(px, py, T, 4);
        g.fillStyle = '#9ff7d8'; g.fillRect(px + 2, py, 4, 2); g.fillRect(px + 10, py, 4, 2);
        g.fillStyle = '#123a30'; g.fillRect(px + 4, py + 8, 8, 4);
      } else if(t === VOID){
        g.fillStyle = '#000'; g.fillRect(px, py, T, T);
      } else if(t === EXIT && lvl.sealed){
        g.fillStyle = '#2a1a14'; g.fillRect(px, py, T, T);
        g.fillStyle = '#8a3a22'; g.fillRect(px + 2, py, 3, T); g.fillRect(px + 10, py, 3, T);
      }
    }
    lvl.canvas = c;
  }

  function render(time){
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if(!lvl){ ctx.fillStyle = '#050404'; ctx.fillRect(0, 0, VW, VH); return; }
    const pal = lvl.pal;
    const sx = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0, sy = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0;
    const ox = Math.round(cam.x + sx), oy = Math.round(cam.y + sy);
    const lights = [];

    // Back wall: dim squares on a slower parallax.
    ctx.fillStyle = rgb(pal.back, 0.45); ctx.fillRect(0, 0, VW, VH);
    const B = 24, bx = ox * 0.5, by = oy * 0.5;
    for(let y = Math.floor(by / B); y * B < by + VH; y++) for(let x = Math.floor(bx / B); x * B < bx + VW; x++){
      const h = hash(x, y, 77);
      ctx.fillStyle = rgb(pal.back, 0.6 + h * 0.3);
      ctx.fillRect(x * B - bx + 1, y * B - by + 1, B - 2, B - 2);
      if(h > 0.82){ ctx.fillStyle = rgb(pal.back, 0.45); ctx.fillRect(x * B - bx + 6, y * B - by + 6, 6, 6); }
    }

    ctx.save(); ctx.translate(-ox, -oy);
    ctx.drawImage(lvl.canvas, ox, oy, VW, VH, ox, oy, VW, VH);
    const x0 = Math.floor(ox / T) - 1, x1 = Math.ceil((ox + VW) / T) + 1, y0 = Math.floor(oy / T) - 1, y1 = Math.ceil((oy + VH) / T) + 1;
    const inView = (x, y, m = 0) => x > ox - m && x < ox + VW + m && y > oy - m && y < oy + VH + m;

    // Lava, re-coloured each frame so it shimmers.
    for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++){
      const t = tileAt(x, y);
      if(t === LAVA){
        const top = tileAt(x, y - 1) !== LAVA;
        for(let j = 0; j < 4; j++) for(let i = 0; i < 4; i++){
          const v = 0.5 + 0.5 * Math.sin(time * 3 + (x * 4 + i) * 0.9 + (y * 4 + j) * 1.3 + hash(x * 4 + i, y * 4 + j) * 6);
          ctx.fillStyle = `rgb(${200 + v * 55 | 0},${70 + v * 90 * (top && j === 0 ? 1.4 : 1) | 0},${20 + v * 20 | 0})`;
          ctx.fillRect(x * T + i * 4, y * T + j * 4, 4, 4);
        }
      } else if(t === EXIT && !lvl.sealed){
        for(let j = 0; j < 4; j++) for(let i = 0; i < 4; i++){
          const v = 0.5 + 0.5 * Math.sin(time * 2.4 - (y * 4 + j) * 0.6 + hash(x * 4 + i, y * 4 + j, 3) * 4);
          ctx.fillStyle = `rgb(${10 + v * 30 | 0},${30 + v * 70 | 0},${30 + v * 60 | 0})`;
          ctx.fillRect(x * T + i * 4, y * T + j * 4, 4, 4);
        }
      }
    }
    for(const [x, y] of lvl.lavaTops) if(inView(x * T, y * T, 60)) lights.push([x * T + 8, y * T + 4, 70, 0.7, '255,120,40']);
    if(!lvl.sealed){ const e = lvl.exitCells; if(e.length){ const [ex, ey] = e[0];
      lights.push([ex * T + 32, ey * T, 120 + Math.sin(time * 2) * 10, 0.9, '90,240,200']); } }

    // Glow-moss: tiny squares on the floor of the route, brighter the closer you have come.
    for(const m of lvl.moss){
      const px = m.x * T, py = m.y * T;
      if(!inView(px, py, 40)) continue;
      const pulse = 0.85 + 0.15 * Math.sin(time * 2 + m.x * 0.7), a = Math.max(0.15, m.lit) * pulse;
      ctx.fillStyle = `rgba(143,220,106,${a})`;
      if(m.side === 0){ ctx.fillRect(px + 1, py + 12, 4, 4); ctx.fillRect(px + 7, py + 10, 4, 6); ctx.fillRect(px + 12, py + 13, 3, 3); }
      else { const lx = m.side < 0 ? px : px + 12; ctx.fillRect(lx, py + 2, 4, 4); ctx.fillRect(lx, py + 9, 4, 5); }
      if(m.lit > 0.2) lights.push([px + 8, py + 12, 44 * m.lit, 0.75 * m.lit, '143,220,106']);
    }

    // Lifts: rows of squares on a cable.
    for(const l of lvl.lifts){
      ctx.fillStyle = '#3a3428'; ctx.fillRect(l.x + l.w / 2 - 1, l.top - 40, 2, l.y - l.top + 40);
      for(let i = 0; i < 3; i++){ ctx.fillStyle = '#8a7a5a'; ctx.fillRect(l.x + i * T, l.y, T, 6); ctx.fillStyle = '#b8a070'; ctx.fillRect(l.x + i * T + 1, l.y, T - 2, 2); }
      ctx.fillStyle = '#ffd166'; ctx.fillRect(l.x + l.w / 2 - 2, l.y + 6, 4, 3);
      lights.push([l.x + l.w / 2, l.y + 8, 40, 0.5, '255,210,120']);
    }

    // Relic stands in the tutorial: a stone plinth with an ember glyph.
    for(const s of lvl.stands){
      if(!inView(s.x, s.y, 60)) continue;
      ctx.fillStyle = '#4e463c'; ctx.fillRect(s.x - 8, s.y - 10, 16, 10);
      ctx.fillStyle = '#6a6052'; ctx.fillRect(s.x - 8, s.y - 10, 16, 2);
      const bob = Math.sin(time * 2 + s.x) * 2;
      ctx.fillStyle = '#f08a3c'; ctx.fillRect(s.x - 4, s.y - 22 + bob, 8, 8);
      ctx.fillStyle = '#ffd9a0'; ctx.fillRect(s.x - 2, s.y - 20 + bob, 4, 4);
      lights.push([s.x, s.y - 18, 60, 0.8, '240,138,60']);
    }

    // Beacons: stacked stones with a moss-green flame once lit.
    for(const b of lvl.beacons){
      if(!inView(b.x, b.y, 80)) continue;
      ctx.fillStyle = '#5c544a'; ctx.fillRect(b.x - 8, b.y - 8, 16, 8); ctx.fillRect(b.x - 6, b.y - 16, 12, 8);
      ctx.fillStyle = '#7a7064'; ctx.fillRect(b.x - 8, b.y - 8, 16, 2); ctx.fillRect(b.x - 6, b.y - 16, 12, 2);
      if(b.lit){ const f = Math.sin(time * 12) * 2;
        ctx.fillStyle = '#8fdc6a'; ctx.fillRect(b.x - 4, b.y - 26 + f, 8, 10 - f);
        ctx.fillStyle = '#e8ffd0'; ctx.fillRect(b.x - 2, b.y - 22, 4, 5);
        lights.push([b.x, b.y - 20, 190, 1, '143,220,106']); }
      else { ctx.fillStyle = '#2a2620'; ctx.fillRect(b.x - 4, b.y - 20, 8, 4); lights.push([b.x, b.y - 18, 34, 0.5, '143,220,106']); }
    }

    // Drops: resting crystals sit on the grid, dropped ones float.
    for(const d of drops){
      if(!inView(d.x, d.y, 40)) continue;
      if(d.kind === 'spark'){
        const r = 4 + Math.sin(time * 6 + d.x) * 1.2;
        ctx.fillStyle = '#7cf0a0'; ctx.beginPath(); ctx.arc(d.x, d.y + (d.rest ? Math.sin(time * 2 + d.x) * 2 : 0), r, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#eafff0'; ctx.beginPath(); ctx.arc(d.x, d.y + (d.rest ? Math.sin(time * 2 + d.x) * 2 : 0), r * 0.45, 0, 6.283); ctx.fill();
        lights.push([d.x, d.y, 60, 0.8, '124,240,160']);
      } else {
        const P = POWERS[d.type], bob = d.rest ? 0 : Math.sin(time * 3 + d.x) * 3;
        const cx = d.rest ? Math.floor(d.x / T) * T + 8 : d.x, cy = d.y + bob;
        const fade = d.life && d.life - d.t < 4 ? (Math.sin(time * 20) > 0 ? 1 : 0.3) : 1;
        ctx.globalAlpha = fade;
        ctx.fillStyle = P.color;
        ctx.fillRect(cx - 2, cy - 10, 4, 4); ctx.fillRect(cx - 6, cy - 6, 12, 4); ctx.fillRect(cx - 4, cy - 2, 8, 4); ctx.fillRect(cx - 2, cy + 2, 4, 4);
        ctx.fillStyle = '#fff'; ctx.fillRect(cx - 2, cy - 6, 2, 4);
        if(P.perm){ ctx.strokeStyle = P.color; ctx.strokeRect(cx - 9.5, cy - 12.5, 19, 19); }
        ctx.globalAlpha = 1;
        lights.push([cx, cy, P.perm ? 110 : 80, 0.9, hexToRgb(P.color)]);
      }
    }

    for(const f of foes) if(inView(f.x, f.y, 80)) drawFoe(f, time, lights);
    if(player && !player.dead) drawPlayer(time, lights);

    for(const s of bullets){
      ctx.strokeStyle = '#5fe3f0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.012, s.y - s.vy * 0.012); ctx.stroke();
      ctx.fillStyle = '#e8feff'; ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, 6.283); ctx.fill();
      // A small glint only: shots must not work as a torch for scouting the dark.
      lights.push([s.x, s.y, 14, 0.3, '95,227,240']);
    }
    for(const s of hostile){
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff6'; ctx.beginPath(); ctx.arc(s.x - 1.5, s.y - 1.5, s.r * 0.4, 0, 6.283); ctx.fill();
      lights.push([s.x, s.y, 46, 0.7, s.kind === 'orb' ? '255,138,74' : '184,224,64']);
    }
    for(const f of frags){
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.globalAlpha = clamp(f.life / 0.5, 0, 1);
      ctx.fillStyle = f.color; ctx.beginPath(); ctx.moveTo(f.pts[0][0], f.pts[0][1]);
      for(const p of f.pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    for(const p of parts){ ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1); ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    ctx.globalAlpha = 1;
    for(const f of flashes) lights.push([f.x, f.y, f.r * (0.6 + 0.4 * f.life / f.max), f.life / f.max, f.color]);

    // Coloured glow, added before the darkness so it is only visible where lit.
    ctx.globalCompositeOperation = 'lighter';
    for(const [x, y, r, a, c] of lights){ if(!inView(x, y, r)) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},${0.22 * a})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Darkness mask with holes for every light, the player's lantern biggest.
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, VW, VH);
    dctx.fillStyle = 'rgba(4,3,2,0.95)'; dctx.fillRect(0, 0, VW, VH);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => { x -= ox; y -= oy; if(x < -r || y < -r || x > VW + r || y > VH + r) return;
      const g = dctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.5, `rgba(0,0,0,${a * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g; dctx.fillRect(x - r, y - r, r * 2, r * 2); };
    if(player){
      const lr = LANTERN * (1 + 0.35 * (run ? run.relics.wick || 0 : 0)) * (player.timers.flare > 0 ? 2.8 : 1) * (0.97 + 0.03 * Math.sin(time * 9));
      hole(player.x + 6, player.y + 8, lr, 1);
    }
    for(const [x, y, r, a] of lights) hole(x, y, r * 1.2, Math.min(1, a));
    ctx.drawImage(dark, 0, 0);

    // Dust motes catch the light: drawn over the mask, but faint.
    ctx.fillStyle = 'rgba(200,190,170,0.10)';
    for(const m of motes) ctx.fillRect(m.x, m.y, m.s, m.s);

    // Unlit overlays: floating text, aim, the Warden's bar, toast, hurt vignette.
    ctx.save(); ctx.translate(-ox, -oy);
    ctx.font = 'bold 12px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
    for(const t of texts){ ctx.globalAlpha = clamp(t.life / 0.4, 0, 1); ctx.fillStyle = t.color; ctx.fillText(t.s, t.x, t.y); }
    ctx.globalAlpha = 1;
    for(const s of lvl.signs) if(inView(s.x * T, s.y * T, 260)) drawSign(s);
    ctx.restore();
    if(mode === 'play'){
      ctx.strokeStyle = 'rgba(95,227,240,0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 7, 0, 6.283); ctx.stroke();
      ctx.fillStyle = '#5fe3f0'; ctx.fillRect(mouse.x - 1, mouse.y - 1, 2, 2);
    }
    const w = foes.find(f => f.type === 'W' && f.state !== 'dormant');
    if(w){
      ctx.fillStyle = '#000a'; ctx.fillRect(VW / 2 - 202, 14, 404, 14);
      ctx.fillStyle = '#ff6a3a'; ctx.fillRect(VW / 2 - 200, 16, 400 * Math.max(0, w.hp / w.maxHp), 10);
      ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd9c0';
      ctx.fillText('THE WARDEN', VW / 2, 42);
    }
    if(toast && mode === 'play'){
      ctx.globalAlpha = clamp(toast.life / 0.5, 0, 1);
      ctx.font = 'bold 15px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#000a'; const tw = ctx.measureText(toast.s).width + 28;
      ctx.fillRect(VW / 2 - tw / 2, VH - 58, tw, 28);
      ctx.fillStyle = '#e6e1d6'; ctx.fillText(toast.s, VW / 2, VH - 39);
      ctx.globalAlpha = 1;
    }
    if(hurtFlash > 0){
      const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VW * 0.65);
      g.addColorStop(0, 'rgba(224,80,60,0)'); g.addColorStop(1, `rgba(224,80,60,${hurtFlash})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    }
  }

  // Tutorial signs are painted on the cave wall, OvO-style, and stay readable in
  // the dark. Text in [brackets] is drawn as a key cap.
  function drawSign(s){
    const lines = s.text.split('\n'), LH = 18, cx = s.x * T + T / 2;
    ctx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const parts = lines.map(l => l.split(/(\[[^\]]+\])/).filter(Boolean));
    const width = seg => seg.startsWith('[') ? ctx.measureText(seg.slice(1, -1)).width + 12 : ctx.measureText(seg).width;
    const widths = parts.map(ps => ps.reduce((a, p) => a + width(p), 0));
    const w = Math.max(...widths) + 20, h = lines.length * LH + 10, top = s.y * T - h / 2;
    ctx.fillStyle = 'rgba(10,9,8,0.72)'; ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = 'rgba(143,220,106,0.5)'; ctx.fillRect(cx - w / 2, top, 3, h);
    parts.forEach((ps, i) => {
      let x = cx - widths[i] / 2; const y = top + 5 + LH * i + LH / 2;
      for(const p of ps){
        if(p.startsWith('[')){ const k = p.slice(1, -1), kw = ctx.measureText(k).width + 8;
          ctx.strokeStyle = '#8fdc6a'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y - 9, kw, 18);
          ctx.fillStyle = '#e8ffd0'; ctx.fillText(k, x + 5, y + 1); x += kw + 4; }
        else { ctx.fillStyle = i === 0 ? '#e6e1d6' : '#c9c2b4'; ctx.fillText(p, x, y + 1); x += ctx.measureText(p).width; }
      }
    });
    ctx.textBaseline = 'alphabetic';
  }

  const rgbCache = {};
  function hexToRgb(h){ return rgbCache[h] || (rgbCache[h] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',')); }

  function drawPlayer(time, lights){
    const p = player, cx = p.x + p.w / 2, feet = p.y + p.h;
    if(p.inv > 0 && Math.floor(time * 20) % 2 && p.aegis === 0) return;
    const aimX = cam.x + mouse.x, aimY = cam.y + mouse.y, a = Math.atan2(aimY - (p.y + 9), aimX - cx);
    const face = Math.cos(a) >= 0 ? 1 : -1, stride = p.ground ? Math.sin(p.walk * 6) : 0.6;
    ctx.lineCap = 'round';
    // legs
    ctx.strokeStyle = '#1f7d8c'; ctx.lineWidth = 3;
    for(const s of [-1, 1]){ ctx.beginPath(); ctx.moveTo(cx + s * 2, feet - 8);
      ctx.lineTo(cx + s * 2 + stride * s * 4, feet - 1); ctx.stroke(); }
    // cloak body
    ctx.fillStyle = '#2aa7c0';
    ctx.beginPath(); ctx.moveTo(cx - 6, feet - 6); ctx.lineTo(cx + 6, feet - 6); ctx.lineTo(cx + 4, p.y + 8); ctx.lineTo(cx - 4, p.y + 8); ctx.closePath(); ctx.fill();
    // hooded head
    ctx.fillStyle = '#3fc6dc'; ctx.beginPath(); ctx.arc(cx, p.y + 6, 6, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#0d2a30'; ctx.beginPath(); ctx.arc(cx + face * 2, p.y + 6.5, 3.6, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#e8feff'; ctx.fillRect(cx + face * 3 - 1, p.y + 5, 2, 2);
    // arm and sling-gun pointing at the mouse
    ctx.strokeStyle = '#5fe3f0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, p.y + 11); ctx.lineTo(cx + Math.cos(a) * 11, p.y + 11 + Math.sin(a) * 11); ctx.stroke();
    ctx.fillStyle = '#e8feff'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 12, p.y + 11 + Math.sin(a) * 12, 2, 0, 6.283); ctx.fill();
    if(p.aegis > 0){ ctx.strokeStyle = `rgba(143,184,255,${0.5 + 0.2 * Math.sin(time * 6)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); for(let i = 0; i <= 6; i++){ const t = i / 6 * 6.283 + time; ctx.lineTo(cx + Math.cos(t) * 17, p.y + 11 + Math.sin(t) * 17); } ctx.stroke(); }
    if(timed('feather') && !p.ground && keys.has('jump') && p.vy >= GLIDE_FALL - 1){
      ctx.fillStyle = 'rgba(156,246,200,0.6)';
      ctx.beginPath(); ctx.moveTo(cx, p.y + 9); ctx.lineTo(cx - 16, p.y + 4); ctx.lineTo(cx - 12, p.y + 13); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, p.y + 9); ctx.lineTo(cx + 16, p.y + 4); ctx.lineTo(cx + 12, p.y + 13); ctx.closePath(); ctx.fill();
    }
    lights.push([cx, p.y + 8, 26, 0.6, '95,227,240']);
  }

  function drawFoe(f, time, lights){
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, base = FOES[f.type].color, col = f.flash > 0 ? '#ffffff' : base;
    ctx.lineCap = 'round';
    switch(f.type){
      case 'C': { // segmented crawler on six legs
        const leg = Math.sin(f.anim * 14);
        ctx.strokeStyle = '#7a3418'; ctx.lineWidth = 2;
        for(let i = -1; i <= 1; i++){ const lx = cx + i * 5, s = (i % 2 ? leg : -leg) * 3;
          ctx.beginPath(); ctx.moveTo(lx, cy + 2); ctx.lineTo(lx + s - 3, f.y + f.h); ctx.moveTo(lx, cy + 2); ctx.lineTo(lx - s + 3, f.y + f.h); ctx.stroke(); }
        ctx.fillStyle = col;
        for(let i = -1; i <= 1; i++){ ctx.beginPath(); ctx.ellipse(cx + i * 5, cy, 5.5, 5, 0, 0, 6.283); ctx.fill(); }
        ctx.fillStyle = '#ffd36a'; ctx.fillRect(cx + f.dir * 8 - 1, cy - 2, 2, 2);
        break; }
      case 'B': { // bat with flapping wings
        const flap = f.state === 'hang' ? -0.2 : Math.sin(f.anim * 22);
        ctx.fillStyle = f.flash > 0 ? '#fff' : '#a0502a';
        for(const s of [-1, 1]){ ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + s * 13, cy - 6 * flap - 2); ctx.lineTo(cx + s * 9, cy + 4); ctx.lineTo(cx + s * 4, cy + 2); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#ffe080'; ctx.fillRect(cx - 3, cy - 2, 2, 2); ctx.fillRect(cx + 1, cy - 2, 2, 2);
        break; }
      case 'S': { // a bulb stuck to rock, mouth facing out
        const swell = 1 + Math.max(0, 0.25 - f.anim) * 1.2 + 0.05 * Math.sin(time * 4 + f.x);
        const bx = cx - f.nx * 4, by = cy - f.ny * 4;
        ctx.fillStyle = '#6a4a1a'; ctx.beginPath(); ctx.ellipse(bx, by, 9, 9, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx + f.nx * 2, cy + f.ny * 2, 8 * swell, 7 * swell, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#b8e040'; ctx.beginPath(); ctx.arc(cx + f.nx * 7, cy + f.ny * 7, 3, 0, 6.283); ctx.fill();
        lights.push([cx + f.nx * 7, cy + f.ny * 7, 30, 0.5, '184,224,64']);
        break; }
      case 'R': { // brute: a hulking polygon with horns
        const shake = f.state === 'wind' ? rand(-1.5, 1.5) : 0, d = f.dir, x = cx + shake, b = f.y + f.h;
        const step = f.ground ? Math.sin(f.anim * (f.state === 'charge' ? 18 : 6)) * 3 : 0;
        ctx.fillStyle = '#5a1e14'; ctx.fillRect(x - 10 + step, b - 7, 6, 7); ctx.fillRect(x + 4 - step, b - 7, 6, 7);
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(x - 15, b - 6); ctx.lineTo(x - 14, f.y + 9); ctx.lineTo(x - 6, f.y + 2); ctx.lineTo(x + 8, f.y + 3);
        ctx.lineTo(x + 15, f.y + 11); ctx.lineTo(x + 14, b - 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8d0b0'; ctx.beginPath(); ctx.moveTo(x + d * 6, f.y + 4); ctx.lineTo(x + d * 16, f.y - 4); ctx.lineTo(x + d * 10, f.y + 7); ctx.closePath(); ctx.fill();
        const eye = f.state === 'wind' || f.state === 'charge';
        ctx.fillStyle = eye ? '#fff3a0' : '#ffb060'; ctx.fillRect(x + d * 8 - 2, f.y + 10, 4, 3);
        if(eye) lights.push([x + d * 8, f.y + 11, 40, 0.8, '255,200,90']);
        break; }
      case 'N': { // grub nest: a pulsing lumpy mound
        const pulse = 1 + 0.08 * Math.sin(time * 5 + f.x);
        ctx.fillStyle = f.flash > 0 ? '#fff' : '#6e3a1e';
        for(const [ox, oy, r] of [[-9, 4, 7], [8, 4, 7], [0, 0, 9], [-4, -5, 5], [5, -4, 5]]){
          ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r * pulse, 0, 6.283); ctx.fill(); }
        ctx.fillStyle = col;
        for(const [ox, oy] of [[-6, 1], [3, -2], [7, 4]]){ ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 2.5 * pulse, 0, 6.283); ctx.fill(); }
        lights.push([cx, cy, 36, 0.5, '240,140,70']);
        break; }
      case 'W': { // the Warden: a huge eye inside turning plates
        const n = 6, spin = time * (0.6 + 0.4 * f.phase), r = f.w / 2;
        for(let i = 0; i < n; i++){ const a = spin + i / n * 6.283;
          ctx.save(); ctx.translate(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); ctx.rotate(a);
          ctx.fillStyle = f.flash > 0 ? '#fff' : '#5a2a1c'; ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(12, -6); ctx.lineTo(10, 8); ctx.lineTo(-10, 6); ctx.closePath(); ctx.fill();
          ctx.restore(); }
        ctx.fillStyle = f.flash > 0 ? '#fff' : '#3a1810'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, 6.283); ctx.fill();
        const awake = f.state !== 'dormant', la = Math.atan2(player.y - cy, player.x - cx);
        ctx.fillStyle = awake ? (f.phase === 3 ? '#ffec7a' : col) : '#5a2a1c';
        ctx.beginPath(); ctx.ellipse(cx + Math.cos(la) * 8, cy + Math.sin(la) * 8, r * 0.36, r * (awake ? 0.36 : 0.06), 0, 0, 6.283); ctx.fill();
        if(awake){ ctx.fillStyle = '#1a0805'; ctx.beginPath(); ctx.arc(cx + Math.cos(la) * 13, cy + Math.sin(la) * 13, r * 0.13, 0, 6.283); ctx.fill(); }
        lights.push([cx, cy, awake ? 200 : 80, awake ? 0.9 : 0.4, '255,110,60']);
        break; }
    }
    if(f.type !== 'W' && f.hp < f.maxHp && (f.type === 'R' || f.type === 'N')){
      ctx.fillStyle = '#000a'; ctx.fillRect(cx - 14, f.y - 8, 28, 4);
      ctx.fillStyle = base; ctx.fillRect(cx - 14, f.y - 8, 28 * Math.max(0, f.hp / f.maxHp), 4);
    }
  }

  // ---------------------------------------------------------------- HUD
  let hudCache = '';
  function hud(){
    if(!run) return;
    const p = player, chips = [];
    if(has('splitter')) chips.push(chip('splitter', shotCount() + ' shots'));
    if(has('ricochet')) chips.push(chip('ricochet', bounces() + ' bounces'));
    for(const k of ['overclock', 'feather', 'flare']) if(p.timers[k] > 0) chips.push(chip(k, Math.ceil(p.timers[k]) + 's'));
    if(p.aegis > 0) chips.push(chip('aegis', '×' + p.aegis));
    if(p.blink > 0) chips.push(chip('blink', p.blink > 3 ? '×' + p.blink : '●'.repeat(p.blink) + '○'.repeat(3 - p.blink)));
    const relics = Object.entries(run.relics).map(([k, n]) => `<span class="chip relic" title="${RELICS[k].what}">${RELICS[k].name}${n > 1 ? '<b>×' + n + '</b>' : ''}</span>`);
    const s = [Math.ceil(Math.max(0, run.hp)), run.maxHp, run.depth, run.kills, Math.floor(run.time), chips.join(''), relics.join('')].join('|');
    if(s === hudCache) return; hudCache = s;
    const frac = Math.max(0, run.hp) / run.maxHp;
    $('hpFill').style.width = (frac * 100) + '%';
    $('hpFill').classList.toggle('low', frac < 0.3);
    $('hpText').textContent = Math.ceil(Math.max(0, run.hp)) + '/' + run.maxHp;
    $('depthText').textContent = run.tutorial ? 'Tutorial' : (run.depth + 1) + '/' + DEPTHS;
    $('killText').textContent = run.kills;
    const t = Math.floor(run.time); $('timeText').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    $('powers').innerHTML = chips.join('');
    $('relics').innerHTML = relics.join('');
  }
  const chip = (k, v) => `<span class="chip" style="--c:${POWERS[k].color}" title="${POWERS[k].what}">${POWERS[k].name}${v ? '<b>' + v + '</b>' : ''}</span>`;

  // ---------------------------------------------------------------- overlays
  function setMode(m){
    mode = m; mouse.down = false; pressed.clear();
    const records = `<p>Deepest <b>${save.deepest || '—'}</b> &nbsp; Best run <b>${save.bestTime ? fmtTime(save.bestTime) : '—'}</b> &nbsp; Total kills <b>${save.kills}</b></p>`;
    const keysHelp = `<p class="keys"><kbd>A</kbd><kbd>D</kbd> move &nbsp; <kbd>W</kbd>/<kbd>Space</kbd> jump (hold for higher) &nbsp; <kbd>S</kbd> drop through planks<br>
      mouse aims, click or hold (or <kbd>F</kbd>) to fire &nbsp; <kbd>Shift</kbd> blink &nbsp; <kbd>Esc</kbd> pause</p>`;
    let html = '';
    if(m === 'play'){ overlay.hidden = true; overlay.innerHTML = ''; canvas.focus && canvas.focus(); return; }
    if(m === 'title') html = `<h2>Delve</h2>
      <p>Five cave depths, one life. Follow the glow-moss down, light beacons to heal, take a relic at the bottom of every depth, and break the Warden at the end.</p>
      ${keysHelp}${records}<div class="row"><button data-act="begin">Begin descent</button><button class="quiet" data-act="tutorial">Tutorial</button></div>`;
    else if(m === 'relic') html = `<h2>Depth ${run.depth + 1} cleared</h2><p>Take one relic for the rest of this run.</p>
      <div class="relics">${run.offer.map((k, i) => `<button class="card" data-relic="${i}"><kbd>${i + 1}</kbd><span class="name">${RELICS[k].name}</span><span class="what">${RELICS[k].what}</span>${run.relics[k] ? `<span class="owned">You have ×${run.relics[k]} of ${RELIC_CAP}</span>` : ''}</button>`).join('')}</div>`;
    else if(m === 'pause' && run.tutorial) html = `<h2>Paused</h2><p>Tutorial</p>
      <div class="row"><button data-act="resume">Resume</button><button class="quiet" data-act="skip">Skip tutorial</button></div>`;
    else if(m === 'pause') html = `<h2>Paused</h2><p>Depth <b>${run.depth + 1}</b> &nbsp; HP <b>${Math.ceil(run.hp)}</b> &nbsp; Time <b>${fmtTime(run.time)}</b></p>
      <div class="row"><button data-act="resume">Resume</button><button class="quiet" data-act="abandon">Abandon run</button></div>`;
    else if(m === 'tutorialDone') html = `<h2 class="good">Ready</h2><p>That's everything. A real run is five depths and one life: no checkpoints, fresh rolls every time, and a relic at the bottom of each depth.</p>
      <div class="row"><button data-act="start">Begin descent</button></div>`;
    else if(m === 'dead') html = `<h2 class="bad">Run over</h2><p>${run.cause || 'The cave keeps you'} on depth <b>${run.depth + 1}</b> after <b>${fmtTime(run.time)}</b>, with <b>${run.kills}</b> kills.</p>
      <p>The next run starts again at Depth 1 with fresh rolls and no relics.</p>${records}<div class="row"><button data-act="start">Delve again</button></div>`;
    else if(m === 'won') html = `<h2 class="good">The Warden falls</h2><p>All five depths in <b>${fmtTime(run.time)}</b> with <b>${run.kills}</b> kills.${run.newBest ? ' A new best run.' : ''}</p>
      ${records}<div class="row"><button data-act="start">Delve again</button></div>`;
    overlay.innerHTML = html; overlay.hidden = false;
    const first = overlay.querySelector('button'); if(first) first.focus();
  }
  overlay.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.relic) chooseRelic(+b.dataset.relic);
    const a = b.dataset.act;
    if(a === 'start') newRun();
    if(a === 'begin') begin();
    if(a === 'tutorial') startTutorial();
    if(a === 'skip'){ save.tutorialDone = true; persist(); newRun(); }
    if(a === 'resume') setMode('play');
    if(a === 'abandon'){ save.kills += run.kills - (run.savedKills || 0); run.savedKills = run.kills; persist(); run.cause = 'Abandoned'; setMode('dead'); }
  });

  // The title screen shows the first depth behind it, lit by an idle lantern.
  run = null;
  loadDepth(0);
  player = { x: lvl.start[0] - 6, y: lvl.start[1] - 22, w: 12, h: 22, vx: 0, vy: 0, timers: {}, aegis: 0, blink: 0, walk: 0, ground: true, inv: 0, face: 1 };
  cam.x = clamp(player.x - VW / 3, 0, lvl.W * T - VW); cam.y = clamp(player.y - VH / 2, 0, lvl.H * T - VH);
  for(const m of lvl.moss) m.lit = 0.6;
  setMode('title');
  requestAnimationFrame(frame);

  // Test hooks for the headless checks; the game never reads them.
  window.__delve = {
    get mode(){ return mode; }, get run(){ return run; }, get player(){ return player; }, get lvl(){ return lvl; },
    get foes(){ return foes; }, get bullets(){ return bullets; }, get drops(){ return drops; }, get frags(){ return frags; }, get cam(){ return cam; },
    newRun, startTutorial, chooseRelic, grant, spawnFoe, killFoe, hurt, depthCleared, step,
    goto(i){ enterDepth(i); setMode('play'); },
    T, tiles: { AIR, ROCK, PLANK, SPIKE, LAVA, PAD, VOID, EXIT },
  };
})();

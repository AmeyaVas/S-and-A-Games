(() => {
  'use strict';

  // ---------- Grid / Map ----------
  const COLS = 15;
  const ROWS = 10;
  const CELL = 50;

  // Waypoints given as grid cells; consecutive waypoints share a row or column
  // so every cell in between can be derived (used for path drawing + blocking
  // tower placement on the path).
  const WAYPOINT_CELLS = [
    { col: 0, row: 4 },
    { col: 3, row: 4 },
    { col: 3, row: 1 },
    { col: 7, row: 1 },
    { col: 7, row: 7 },
    { col: 11, row: 7 },
    { col: 11, row: 3 },
    { col: 14, row: 3 },
  ];

  function cellCenter(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
  }

  const WAYPOINTS = WAYPOINT_CELLS.map(c => cellCenter(c.col, c.row));

  const PATH_CELLS = new Set();
  for (let i = 0; i < WAYPOINT_CELLS.length - 1; i++) {
    const a = WAYPOINT_CELLS[i];
    const b = WAYPOINT_CELLS[i + 1];
    const stepCol = Math.sign(b.col - a.col);
    const stepRow = Math.sign(b.row - a.row);
    let { col, row } = a;
    PATH_CELLS.add(`${col},${row}`);
    while (col !== b.col || row !== b.row) {
      col += stepCol;
      row += stepRow;
      PATH_CELLS.add(`${col},${row}`);
    }
  }

  function isPathCell(col, row) {
    return PATH_CELLS.has(`${col},${row}`);
  }

  // ---------- Tower definitions ----------
  const TOWER_TYPES = [
    { id: 'archer', name: 'Archer Tower', cost: 50, range: 100, fireRate: 0.15, damage: 8, splash: 0, color: '#8b5a2b', roofColor: '#dcb877', projectileColor: '#f4e4c1' },
    { id: 'cannon', name: 'Cannon Bastion', cost: 100, range: 90, fireRate: 1.2, damage: 40, splash: 45, color: '#6b6f76', roofColor: '#3a3d42', projectileColor: '#2b2b2b' },
    { id: 'mage', name: 'Mage Tower', cost: 150, range: 220, fireRate: 1.8, damage: 70, splash: 0, color: '#4b2e83', roofColor: '#8e5bd6', projectileColor: '#c9a6ff' },
    { id: 'mine', name: 'Gold Mine', cost: 80, isEconomy: true, income: 5, incomeInterval: 3, color: '#c9a227', roofColor: '#8a6d1a' },
  ];

  // ---------- Upgrades ----------
  const UPGRADE_MAX_LEVEL = 3;
  const DAMAGE_UPGRADE_STEP = 0.35; // +35% damage per level
  const SPEED_UPGRADE_FACTOR = 0.85; // fire rate cooldown *= 0.85 per level (faster)
  const RANGE_UPGRADE_STEP = 20; // +20px range per level
  const INCOME_UPGRADE_STEP = 0.4; // +40% income per level

  const UPGRADE_STATS = [
    { key: 'damage', label: 'Damage' },
    { key: 'speed', label: 'Fire Speed' },
    { key: 'range', label: 'Range' },
  ];

  function upgradeCost(tower, key) {
    return Math.round(tower.type.cost * 0.6 * (tower.levels[key] + 1));
  }

  // ---------- Wave config ----------
  const TOTAL_WAVES = 100;
  const START_GOLD = 200;
  const START_LIVES = 20;
  const SPAWN_INTERVAL = 0.7; // seconds between enemy spawns within a wave
  const BOSS_WAVE_INTERVAL = 10; // a boss shows up every 10th wave

  function waveEnemyCount(wave) {
    return 5 + (wave - 1) * 2;
  }
  function waveEnemyHp(wave) {
    // 3x (i.e. 200% more) the original baseline, still scaling up every wave
    return (50 + (wave - 1) * 18) * 3;
  }
  function waveEnemySpeed(wave) {
    return 60 + (wave - 1) * 4;
  }

  function isBossWave(wave) {
    return wave > 0 && wave % BOSS_WAVE_INTERVAL === 0;
  }
  function waveTargetCount(wave) {
    return waveEnemyCount(wave) + (isBossWave(wave) ? 1 : 0);
  }
  function waveBossHp(wave) {
    return 600 + wave * 200;
  }
  function waveBossSpeed() {
    return 40;
  }
  function waveBossReward(wave) {
    return 100 + wave * 15;
  }

  // ---------- Entities ----------
  class Enemy {
    constructor(wave) {
      const start = WAYPOINTS[0];
      this.x = start.x;
      this.y = start.y;
      this.waypointIndex = 0;
      this.maxHp = waveEnemyHp(wave);
      this.hp = this.maxHp;
      this.speed = waveEnemySpeed(wave);
      this.reward = 10;
      this.dead = false;
      this.reachedBase = false;
      this.radius = 12;
    }

    update(dt) {
      let remaining = this.speed * dt;
      while (remaining > 0 && this.waypointIndex < WAYPOINTS.length - 1) {
        const target = WAYPOINTS[this.waypointIndex + 1];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= remaining) {
          this.x = target.x;
          this.y = target.y;
          remaining -= dist;
          this.waypointIndex++;
        } else {
          this.x += (dx / dist) * remaining;
          this.y += (dy / dist) * remaining;
          remaining = 0;
        }
      }
      if (this.waypointIndex >= WAYPOINTS.length - 1) {
        this.reachedBase = true;
      }
    }

    takeDamage(amount) {
      if (this.dead) return;
      this.hp -= amount;
      if (this.hp <= 0) this.dead = true;
    }

    draw(ctx) {
      const x = this.x, y = this.y, r = this.radius;

      // raider body
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#7a2626';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3a0e0e';
      ctx.stroke();

      // iron helm
      ctx.beginPath();
      ctx.arc(x, y - 3, r * 0.75, Math.PI, 0);
      ctx.fillStyle = '#5a5a5a';
      ctx.fill();
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 1;
      ctx.stroke();

      // glowing eyes
      ctx.fillStyle = '#ffcf4d';
      ctx.fillRect(x - 5, y - 1, 3, 3);
      ctx.fillRect(x + 2, y - 1, 3, 3);

      const barW = 26;
      const pct = Math.max(0, this.hp / this.maxHp);
      ctx.fillStyle = '#2b1c12';
      ctx.fillRect(x - barW / 2, y - r - 10, barW, 5);
      ctx.fillStyle = pct > 0.4 ? '#5a8a3a' : '#c0392b';
      ctx.fillRect(x - barW / 2, y - r - 10, barW * pct, 5);
    }
  }

  class Boss extends Enemy {
    constructor(wave) {
      super(wave);
      this.maxHp = waveBossHp(wave);
      this.hp = this.maxHp;
      this.speed = waveBossSpeed(wave);
      this.reward = waveBossReward(wave);
      this.radius = 22;
      this.isBoss = true;
    }

    draw(ctx) {
      const x = this.x, y = this.y, r = this.radius;

      // trailing cape
      ctx.fillStyle = '#3a0e0e';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.8, y + r * 0.3);
      ctx.lineTo(x - r * 1.3, y + r * 1.3);
      ctx.lineTo(x + r * 1.3, y + r * 1.3);
      ctx.lineTo(x + r * 0.8, y + r * 0.3);
      ctx.closePath();
      ctx.fill();

      // armored body
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1712';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#8b0000';
      ctx.stroke();

      // steel helm
      ctx.beginPath();
      ctx.arc(x, y - 4, r * 0.75, Math.PI, 0);
      ctx.fillStyle = '#4a4a4a';
      ctx.fill();
      ctx.strokeStyle = '#1c1712';
      ctx.lineWidth = 1;
      ctx.stroke();

      // horns
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x - r * 0.9, y - r * 1.4);
      ctx.lineTo(x - r * 0.3, y - r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.9, y - r * 1.4);
      ctx.lineTo(x + r * 0.3, y - r * 0.7);
      ctx.closePath();
      ctx.fill();

      // glowing eyes
      ctx.fillStyle = '#ff2b2b';
      ctx.fillRect(x - 8, y - 2, 4, 4);
      ctx.fillRect(x + 4, y - 2, 4, 4);

      // wide health bar
      const barW = 44;
      const pct = Math.max(0, this.hp / this.maxHp);
      ctx.fillStyle = '#2b1c12';
      ctx.fillRect(x - barW / 2, y - r - 14, barW, 6);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(x - barW / 2, y - r - 14, barW * pct, 6);
    }
  }

  class DamageNumber {
    constructor(x, y, value) {
      this.x = x + (Math.random() * 10 - 5);
      this.y = y;
      this.value = Math.round(value);
      this.life = 0.6;
      this.maxLife = 0.6;
    }

    update(dt) {
      this.y -= 22 * dt;
      this.life -= dt;
    }
  }

  class GoldPopup {
    constructor(x, y, value) {
      this.x = x + (Math.random() * 10 - 5);
      this.y = y;
      this.value = Math.round(value);
      this.life = 0.9;
      this.maxLife = 0.9;
    }

    update(dt) {
      this.y -= 16 * dt;
      this.life -= dt;
    }
  }

  class Projectile {
    constructor(x, y, target, damage, splash, color) {
      this.x = x;
      this.y = y;
      this.target = target;
      this.damage = damage;
      this.splash = splash;
      this.color = color;
      this.speed = 400;
      this.done = false;
      this.impactX = target.x;
      this.impactY = target.y;
    }

    update(dt, enemies, damageNumbers) {
      if (!this.target.dead) {
        this.impactX = this.target.x;
        this.impactY = this.target.y;
      }
      const dx = this.impactX - this.x;
      const dy = this.impactY - this.y;
      const dist = Math.hypot(dx, dy);
      const step = this.speed * dt;
      if (dist <= step) {
        this.x = this.impactX;
        this.y = this.impactY;
        this.hit(enemies, damageNumbers);
        this.done = true;
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
    }

    hit(enemies, damageNumbers) {
      if (this.splash > 0) {
        for (const e of enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - this.impactX, e.y - this.impactY) <= this.splash) {
            e.takeDamage(this.damage);
            damageNumbers.push(new DamageNumber(e.x, e.y - e.radius - 14, this.damage));
          }
        }
      } else if (!this.target.dead) {
        this.target.takeDamage(this.damage);
        damageNumbers.push(new DamageNumber(this.target.x, this.target.y - this.target.radius - 14, this.damage));
      }
    }

    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();
    }
  }

  class Tower {
    constructor(type, col, row) {
      this.type = type;
      this.col = col;
      this.row = row;
      const c = cellCenter(col, row);
      this.x = c.x;
      this.y = c.y;
      this.cooldown = 0;
      this.target = null;
      this.levels = { damage: 0, speed: 0, range: 0, income: 0 };
      this.incomeTimer = type.incomeInterval || 0;
    }

    get damage() {
      return this.type.damage * (1 + DAMAGE_UPGRADE_STEP * this.levels.damage);
    }

    get fireRate() {
      return this.type.fireRate * Math.pow(SPEED_UPGRADE_FACTOR, this.levels.speed);
    }

    get range() {
      return this.type.range + RANGE_UPGRADE_STEP * this.levels.range;
    }

    get income() {
      return this.type.income * (1 + INCOME_UPGRADE_STEP * this.levels.income);
    }

    update(dt, enemies, projectiles) {
      this.cooldown -= dt;
      if (this.target && (this.target.dead || this.outOfRange(this.target))) {
        this.target = null;
      }
      if (!this.target) {
        this.target = this.acquireTarget(enemies);
      }
      if (this.target && this.cooldown <= 0) {
        this.cooldown = this.fireRate;
        projectiles.push(new Projectile(this.x, this.y, this.target, this.damage, this.type.splash, this.type.projectileColor));
      }
    }

    outOfRange(enemy) {
      return Math.hypot(enemy.x - this.x, enemy.y - this.y) > this.range;
    }

    acquireTarget(enemies) {
      let best = null;
      let bestProgress = -1;
      for (const e of enemies) {
        if (e.dead) continue;
        if (this.outOfRange(e)) continue;
        if (e.waypointIndex > bestProgress) {
          bestProgress = e.waypointIndex;
          best = e;
        }
      }
      return best;
    }

    draw(ctx, showRange) {
      const cx = this.x, cy = this.y;

      if (this.type.isEconomy) {
        this.drawMine(ctx);
        return;
      }

      if (showRange) {
        ctx.beginPath();
        ctx.arc(cx, cy, this.range, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.stroke();
      }

      // stone foundation slab
      const base = CELL - 12;
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(cx - base / 2, cy - base / 2, base, base);

      // crenellations ringing the turret (castle battlements)
      ctx.fillStyle = this.type.color;
      const merlonCount = 8;
      const merlonR = base / 2 - 1;
      for (let i = 0; i < merlonCount; i++) {
        const angle = (i / merlonCount) * Math.PI * 2;
        const mx = cx + Math.cos(angle) * merlonR - 3;
        const my = cy + Math.sin(angle) * merlonR - 3;
        ctx.fillRect(mx, my, 6, 6);
      }

      // turret body
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2b2b2b';
      ctx.stroke();

      // roof / accent
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = this.type.roofColor;
      ctx.fill();

      // per-type flourish
      if (this.type.id === 'archer') {
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx, cy - 24);
        ctx.stroke();
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 24);
        ctx.lineTo(cx + 10, cy - 20);
        ctx.lineTo(cx, cy - 16);
        ctx.closePath();
        ctx.fill();
      } else if (this.type.id === 'cannon') {
        const angle = this.target ? Math.atan2(this.target.y - cy, this.target.x - cx) : -Math.PI / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(0, -3, 17, 6);
        ctx.restore();
      } else if (this.type.id === 'mage') {
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(230,217,255,0.3)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e6d9ff';
        ctx.fill();
      }

      if (this.target) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(this.target.x, this.target.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.stroke();
      }
    }

    drawMine(ctx) {
      const cx = this.x, cy = this.y;

      // dirt mound
      ctx.beginPath();
      ctx.arc(cx, cy, 16, Math.PI, 0);
      ctx.fillStyle = '#6b5a3e';
      ctx.fill();
      ctx.fillRect(cx - 16, cy, 32, 8);

      // timber support beams
      ctx.fillStyle = '#4a3524';
      ctx.fillRect(cx - 12, cy - 14, 4, 18);
      ctx.fillRect(cx + 8, cy - 14, 4, 18);

      // dark mine shaft entrance
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 8, Math.PI, 0);
      ctx.fillStyle = '#1c1712';
      ctx.fill();
      ctx.fillRect(cx - 8, cy - 2, 16, 10);

      // glinting gold ore
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx - 14, cy + 4, 3, 3);
      ctx.fillRect(cx + 11, cy + 6, 3, 3);
      ctx.fillRect(cx + 1, cy + 9, 3, 3);
    }
  }

  // ---------- Game state ----------
  const canvas = document.getElementById('canvas');
  const screenCtx = canvas.getContext('2d');

  // Everything is drawn at a fraction of the real resolution onto this
  // offscreen canvas, then blown back up with smoothing disabled — that's
  // what gives the whole scene its chunky pixel-art look.
  const PIXEL_SCALE = 3;
  const pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = Math.round(canvas.width / PIXEL_SCALE);
  pixelCanvas.height = Math.round(canvas.height / PIXEL_SCALE);
  const ctx = pixelCanvas.getContext('2d');
  ctx.scale(1 / PIXEL_SCALE, 1 / PIXEL_SCALE);

  function hashCell(col, row) {
    let h = (col * 374761393 + row * 668265263) ^ (col * row * 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  const goldEl = document.getElementById('gold-value');
  const livesEl = document.getElementById('lives-value');
  const waveEl = document.getElementById('wave-value');
  const startWaveBtn = document.getElementById('start-wave-btn');
  const towerListEl = document.getElementById('tower-list');
  const upgradePanelEl = document.getElementById('upgrade-panel');
  const overlayEl = document.getElementById('overlay');
  const overlayMessageEl = document.getElementById('overlay-message');
  const restartBtn = document.getElementById('restart-btn');

  const state = {
    gold: START_GOLD,
    lives: START_LIVES,
    wave: 0,
    phase: 'idle', // idle | wave | gameover | win
    towers: [],
    towerGrid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    enemies: [],
    projectiles: [],
    damageNumbers: [],
    goldPopups: [],
    selectedTowerId: null,
    selectedTower: null,
    hoverCell: null,
    spawnedThisWave: 0,
    spawnTimer: 0,
    lastTime: null,
  };

  function buildTowerButtons() {
    towerListEl.innerHTML = '';
    for (const type of TOWER_TYPES) {
      const btn = document.createElement('button');
      btn.className = 'tower-btn';
      btn.dataset.id = type.id;
      btn.innerHTML = `
        <span class="tower-swatch" style="background:${type.color}"></span>
        <span class="tower-info">
          <span class="tower-name">${type.name}</span>
          <span class="tower-cost">${type.cost}g</span>
        </span>`;
      btn.addEventListener('click', () => {
        if (state.phase === 'gameover' || state.phase === 'win') return;
        state.selectedTowerId = state.selectedTowerId === type.id ? null : type.id;
        state.selectedTower = null;
        refreshTowerButtons();
        renderUpgradePanel();
      });
      towerListEl.appendChild(btn);
    }
  }

  function refreshTowerButtons() {
    for (const btn of towerListEl.children) {
      const type = TOWER_TYPES.find(t => t.id === btn.dataset.id);
      btn.classList.toggle('selected', state.selectedTowerId === type.id);
      btn.disabled = state.gold < type.cost;
    }
  }

  function updateStats() {
    goldEl.textContent = state.gold;
    livesEl.textContent = state.lives;
    waveEl.textContent = `${Math.min(state.wave, TOTAL_WAVES)} / ${TOTAL_WAVES}`;
    waveEl.classList.toggle('boss-wave', isBossWave(state.wave) && state.phase === 'wave');
    startWaveBtn.disabled = state.phase === 'wave' || state.phase === 'gameover' || state.phase === 'win';
    startWaveBtn.textContent = isBossWave(state.wave + 1) && state.phase === 'idle'
      ? 'Start Boss Wave ⚔'
      : 'Start Wave';
    refreshTowerButtons();
    renderUpgradePanel();
  }

  function renderUpgradePanel() {
    const tower = state.selectedTower;
    if (!tower) {
      upgradePanelEl.innerHTML = '<p class="muted">Click a placed tower to upgrade it.</p>';
      return;
    }

    const statsList = tower.type.isEconomy
      ? [{ key: 'income', label: 'Income' }]
      : UPGRADE_STATS;

    const rows = statsList.map(stat => {
      const level = tower.levels[stat.key];
      const maxed = level >= UPGRADE_MAX_LEVEL;
      const cost = upgradeCost(tower, stat.key);
      const afford = state.gold >= cost;
      const dots = '●'.repeat(level) + '○'.repeat(UPGRADE_MAX_LEVEL - level);
      return `
        <div class="upgrade-row">
          <div class="upgrade-row-top">
            <span>${stat.label}</span>
            <span class="upgrade-dots">${dots}</span>
          </div>
          <button class="upgrade-btn" data-stat="${stat.key}" ${maxed || !afford ? 'disabled' : ''}>
            ${maxed ? 'Max Level' : `Upgrade (${cost}g)`}
          </button>
        </div>`;
    }).join('');

    const statsLine = tower.type.isEconomy
      ? `Income ${tower.income.toFixed(1)}g / ${tower.type.incomeInterval}s`
      : `DMG ${tower.damage.toFixed(0)} &middot; SPD ${(1 / tower.fireRate).toFixed(1)}/s &middot; RNG ${tower.range.toFixed(0)}`;

    upgradePanelEl.innerHTML = `
      <div class="upgrade-tower-name">${tower.type.name} <span class="upgrade-cell">(${tower.col}, ${tower.row})</span></div>
      <div class="upgrade-stats-line">${statsLine}</div>
      ${rows}
    `;

    for (const btn of upgradePanelEl.querySelectorAll('.upgrade-btn')) {
      btn.addEventListener('click', () => {
        const stat = btn.dataset.stat;
        const cost = upgradeCost(tower, stat);
        if (tower.levels[stat] >= UPGRADE_MAX_LEVEL || state.gold < cost) return;
        state.gold -= cost;
        tower.levels[stat]++;
        updateStats();
      });
    }
  }

  function canvasCell(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (evt.clientX - rect.left) * scaleX;
    const y = (evt.clientY - rect.top) * scaleY;
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    return { col, row, x, y };
  }

  canvas.addEventListener('mousemove', evt => {
    const { col, row } = canvasCell(evt);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
      state.hoverCell = { col, row };
    } else {
      state.hoverCell = null;
    }
  });

  canvas.addEventListener('mouseleave', () => {
    state.hoverCell = null;
  });

  canvas.addEventListener('click', evt => {
    if (state.phase === 'gameover' || state.phase === 'win') return;
    const { col, row } = canvasCell(evt);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

    const existing = state.towerGrid[row][col];
    if (existing) {
      state.selectedTower = existing;
      state.selectedTowerId = null;
      updateStats();
      return;
    }

    if (!state.selectedTowerId) {
      state.selectedTower = null;
      renderUpgradePanel();
      return;
    }

    const type = TOWER_TYPES.find(t => t.id === state.selectedTowerId);
    if (isPathCell(col, row)) return;
    if (state.gold < type.cost) return;

    const tower = new Tower(type, col, row);
    state.towers.push(tower);
    state.towerGrid[row][col] = tower;
    state.gold -= type.cost;
    updateStats();
  });

  startWaveBtn.addEventListener('click', () => {
    if (state.phase !== 'idle') return;
    state.wave++;
    state.phase = 'wave';
    state.spawnedThisWave = 0;
    state.spawnTimer = 0;
    updateStats();
  });

  restartBtn.addEventListener('click', resetGame);

  function resetGame() {
    state.gold = START_GOLD;
    state.lives = START_LIVES;
    state.wave = 0;
    state.phase = 'idle';
    state.towers = [];
    state.towerGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    state.enemies = [];
    state.projectiles = [];
    state.damageNumbers = [];
    state.goldPopups = [];
    state.selectedTowerId = null;
    state.selectedTower = null;
    state.spawnedThisWave = 0;
    state.spawnTimer = 0;
    overlayEl.classList.add('hidden');
    updateStats();
  }

  function showOverlay(message) {
    overlayMessageEl.textContent = message;
    overlayEl.classList.remove('hidden');
  }

  // ---------- Update ----------
  function update(dt) {
    if (state.phase === 'wave') {
      const targetCount = waveTargetCount(state.wave);
      state.spawnTimer -= dt;
      if (state.spawnedThisWave < targetCount && state.spawnTimer <= 0) {
        const isBossSpawn = isBossWave(state.wave) && state.spawnedThisWave === targetCount - 1;
        state.enemies.push(isBossSpawn ? new Boss(state.wave) : new Enemy(state.wave));
        state.spawnedThisWave++;
        state.spawnTimer = SPAWN_INTERVAL;
      }

      for (const enemy of state.enemies) {
        if (enemy.dead || enemy.reachedBase) continue;
        enemy.update(dt);
        if (enemy.reachedBase) {
          state.lives--;
        }
      }

      for (const enemy of state.enemies) {
        if (enemy.dead && !enemy.rewarded) {
          enemy.rewarded = true;
          state.gold += enemy.reward;
        }
      }

      state.enemies = state.enemies.filter(e => !e.dead && !e.reachedBase);

      if (state.lives <= 0) {
        state.lives = 0;
        state.phase = 'gameover';
        showOverlay(`Game Over — Reached Wave ${state.wave}`);
      } else if (state.spawnedThisWave >= targetCount && state.enemies.length === 0) {
        if (state.wave >= TOTAL_WAVES) {
          state.phase = 'win';
          showOverlay('Victory! The Kingdom is Saved!');
        } else {
          state.phase = 'idle';
        }
      }
      updateStats();
    }

    for (const tower of state.towers) {
      if (tower.type.isEconomy) {
        tower.incomeTimer -= dt;
        if (tower.incomeTimer <= 0) {
          tower.incomeTimer += tower.type.incomeInterval;
          const amount = tower.income;
          state.gold += amount;
          state.goldPopups.push(new GoldPopup(tower.x, tower.y - 20, amount));
          updateStats();
        }
        continue;
      }
      tower.update(dt, state.enemies, state.projectiles);
    }

    for (const p of state.projectiles) {
      p.update(dt, state.enemies, state.damageNumbers);
    }
    state.projectiles = state.projectiles.filter(p => !p.done);

    for (const dn of state.damageNumbers) {
      dn.update(dt);
    }
    state.damageNumbers = state.damageNumbers.filter(dn => dn.life > 0);

    for (const gp of state.goldPopups) {
      gp.update(dt);
    }
    state.goldPopups = state.goldPopups.filter(gp => gp.life > 0);

    // Re-check deaths/rewards caused by projectile hits this frame
    for (const enemy of state.enemies) {
      if (enemy.dead && !enemy.rewarded) {
        enemy.rewarded = true;
        state.gold += enemy.reward;
      }
    }
  }

  // ---------- Draw ----------
  const GRASS_SHADES = ['#3f6b2f', '#3a6329', '#457234'];
  const STONE_SHADES = ['#8a7a63', '#83735c', '#8f7f68'];

  function drawField() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const h = hashCell(col, row);
        if (isPathCell(col, row)) {
          ctx.fillStyle = STONE_SHADES[Math.floor(h * STONE_SHADES.length)];
          ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
          // cobblestone grout lines
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          const offset = (row % 2 === 0) ? 0 : CELL / 2;
          ctx.beginPath();
          ctx.moveTo(col * CELL + offset, row * CELL);
          ctx.lineTo(col * CELL + offset, row * CELL + CELL);
          ctx.moveTo(col * CELL, row * CELL + CELL / 2);
          ctx.lineTo(col * CELL + CELL, row * CELL + CELL / 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = GRASS_SHADES[Math.floor(h * GRASS_SHADES.length)];
          ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
          // sparse tufts of grass texture
          if (h > 0.6) {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(col * CELL + 10, row * CELL + 30, 6, 6);
            ctx.fillRect(col * CELL + 30, row * CELL + 12, 6, 6);
          }
        }
      }
    }
  }

  function drawCastleGate(col, row) {
    const x = col * CELL, y = row * CELL;
    ctx.fillStyle = '#5b5147';
    ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
    ctx.fillStyle = '#6b6f76';
    ctx.fillRect(x + 4, y + 4, 12, CELL - 8);
    ctx.fillRect(x + CELL - 16, y + 4, 12, CELL - 8);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(x + 6 + i * 4, y, 3, 6);
      ctx.fillRect(x + CELL - 18 + i * 4, y, 3, 6);
    }
    ctx.fillStyle = '#1c1712';
    ctx.fillRect(x + CELL / 2 - 7, y + 16, 14, CELL - 20);
  }

  function drawCamp(col, row) {
    const x = col * CELL + CELL / 2, y = row * CELL + CELL / 2;
    const trees = [
      { dx: -14, dy: -10, s: 10, c: '#2f4d22' },
      { dx: 12, dy: -12, s: 12, c: '#274420' },
      { dx: -4, dy: 10, s: 11, c: '#345c28' },
    ];
    for (const t of trees) {
      ctx.beginPath();
      ctx.moveTo(x + t.dx, y + t.dy - t.s);
      ctx.lineTo(x + t.dx - t.s * 0.7, y + t.dy + t.s * 0.6);
      ctx.lineTo(x + t.dx + t.s * 0.7, y + t.dy + t.s * 0.6);
      ctx.closePath();
      ctx.fillStyle = t.c;
      ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawField();

    const spawnC = WAYPOINT_CELLS[0];
    const baseC = WAYPOINT_CELLS[WAYPOINT_CELLS.length - 1];
    drawCamp(spawnC.col, spawnC.row);
    drawCastleGate(baseC.col, baseC.row);

    // hover preview
    if (state.hoverCell && state.selectedTowerId && state.phase !== 'gameover' && state.phase !== 'win') {
      const { col, row } = state.hoverCell;
      const type = TOWER_TYPES.find(t => t.id === state.selectedTowerId);
      const valid = !isPathCell(col, row) && !state.towerGrid[row][col] && state.gold >= type.cost;
      const c = cellCenter(col, row);
      ctx.beginPath();
      ctx.arc(c.x, c.y, type.range, 0, Math.PI * 2);
      ctx.fillStyle = valid ? 'rgba(255,255,255,0.10)' : 'rgba(230,57,70,0.12)';
      ctx.fill();
      ctx.strokeStyle = valid ? 'rgba(255,255,255,0.4)' : 'rgba(230,57,70,0.5)';
      ctx.stroke();

      ctx.fillStyle = valid ? 'rgba(255,255,255,0.25)' : 'rgba(230,57,70,0.35)';
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }

    // towers
    for (const tower of state.towers) {
      const isHovered = state.hoverCell && state.hoverCell.col === tower.col && state.hoverCell.row === tower.row;
      const isSelected = tower === state.selectedTower;
      tower.draw(ctx, (isHovered || isSelected) && !state.selectedTowerId);
      if (isSelected) {
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 2;
        ctx.strokeRect(tower.col * CELL + 2, tower.row * CELL + 2, CELL - 4, CELL - 4);
      }
    }

    // enemies
    for (const enemy of state.enemies) {
      enemy.draw(ctx);
    }

    // projectiles
    for (const p of state.projectiles) {
      p.draw(ctx);
    }

    // blow the low-res scene back up onto the real canvas, blocky and unsmoothed
    screenCtx.imageSmoothingEnabled = false;
    screenCtx.clearRect(0, 0, canvas.width, canvas.height);
    screenCtx.drawImage(pixelCanvas, 0, 0, pixelCanvas.width, pixelCanvas.height, 0, 0, canvas.width, canvas.height);

    // text is drawn crisp on the real canvas (not pixelated) so small numbers stay legible
    screenCtx.textAlign = 'center';
    screenCtx.textBaseline = 'middle';

    screenCtx.font = '7px Arial';
    for (const enemy of state.enemies) {
      const tx = enemy.x, ty = enemy.y - enemy.radius - 7.5;
      screenCtx.fillStyle = 'rgba(0,0,0,0.85)';
      screenCtx.fillText(`${Math.max(0, Math.ceil(enemy.hp))}`, tx + 0.6, ty + 0.6);
      screenCtx.fillStyle = '#fff';
      screenCtx.fillText(`${Math.max(0, Math.ceil(enemy.hp))}`, tx, ty);
    }

    screenCtx.font = 'bold 13px Georgia, serif';
    for (const dn of state.damageNumbers) {
      const alpha = Math.max(0, dn.life / dn.maxLife);
      screenCtx.fillStyle = `rgba(0,0,0,${alpha * 0.85})`;
      screenCtx.fillText(`-${dn.value}`, dn.x + 0.6, dn.y + 0.6);
      screenCtx.fillStyle = `rgba(255,120,90,${alpha})`;
      screenCtx.fillText(`-${dn.value}`, dn.x, dn.y);
    }

    screenCtx.font = 'bold 13px Georgia, serif';
    for (const gp of state.goldPopups) {
      const alpha = Math.max(0, gp.life / gp.maxLife);
      screenCtx.fillStyle = `rgba(0,0,0,${alpha * 0.85})`;
      screenCtx.fillText(`+${gp.value}g`, gp.x + 0.6, gp.y + 0.6);
      screenCtx.fillStyle = `rgba(255,215,60,${alpha})`;
      screenCtx.fillText(`+${gp.value}g`, gp.x, gp.y);
    }
  }

  // ---------- Main loop ----------
  function loop(timestamp) {
    if (state.lastTime === null) state.lastTime = timestamp;
    let dt = (timestamp - state.lastTime) / 1000;
    state.lastTime = timestamp;
    dt = Math.min(dt, 0.05); // clamp to avoid huge jumps on tab-switch

    if (state.phase !== 'gameover' && state.phase !== 'win') {
      update(dt);
    }
    draw();
    requestAnimationFrame(loop);
  }

  buildTowerButtons();
  updateStats();
  requestAnimationFrame(loop);
})();

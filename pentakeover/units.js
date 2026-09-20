/* Pentakeover — units, terrain and combat maths.
 *
 * Five unit types, five roles: swarm, speed, wall, siege, support.
 * Three of them form a counter triangle; the other two bend the numbers
 * for everyone around them.
 */

const UNIT_ORDER = ['militia', 'lancer', 'warden', 'ballista', 'herald'];

const UNITS = {
  militia: {
    name: 'Militia', glyph: 'M', cost: 3, upkeep: 0,
    hp: 6, atk: 2, def: 3, move: 1,
    blurb: 'Cheap bodies. Dies first in every battle, which is exactly the point — a militia screen soaks the damage your expensive units would have taken.'
  },
  lancer: {
    name: 'Lancer', glyph: 'L', cost: 8, upkeep: 1,
    hp: 7, atk: 7, def: 3, move: 2,
    blurb: 'Fast and sharp, but brittle on defence. Rides down artillery before it can fire again.'
  },
  warden: {
    name: 'Warden', glyph: 'W', cost: 7, upkeep: 1,
    hp: 12, atk: 3, def: 8, move: 1,
    blurb: 'A wall with a pulse. Braces against cavalry, holds ground, and is miserable at taking it.'
  },
  ballista: {
    name: 'Ballista', glyph: 'B', cost: 11, upkeep: 2,
    hp: 5, atk: 10, def: 1, move: 1,
    blurb: 'Enormous damage, no survivability. Can bombard an adjacent region from safety instead of marching in.'
  },
  herald: {
    name: 'Herald', glyph: 'H', cost: 9, upkeep: 1,
    hp: 6, atk: 1, def: 2, move: 2,
    blurb: 'Fights badly, wins battles anyway. Grants every friendly unit stacked with it +20% attack and defence, and its region earns +2 gold.'
  }
};

/* The counter triangle: attacker type -> the type it is strong against. */
const COUNTERS = { lancer: 'ballista', ballista: 'warden', warden: 'lancer' };
const COUNTER_BONUS = 0.75;   // at most +75%, scaled by how much of the enemy is that type
const HERALD_AURA = 0.2;      // +20% attack and defence, does not stack

const TERRAIN = {
  plains:    { name: 'Plains',    income: 3, def: 0.00, color: '#5c6b4a' },
  forest:    { name: 'Forest',    income: 2, def: 0.20, color: '#3d5a3c' },
  hills:     { name: 'Hills',     income: 2, def: 0.40, color: '#6b5f42' },
  mountains: { name: 'Mountains', income: 1, def: 0.65, color: '#5a5450' }
};

const KIND_BONUS = {
  normal:  { def: 0.00, income: 0 },
  capital: { def: 0.30, income: 5 },
  citadel: { def: 0.50, income: 6 }
};

/* Battles are decided by comparing two rolls, each the side's power shaken by
 * a log-normal wobble. That shape has no hard ceiling, so an upset is always
 * possible, and it makes the win chance a closed form the forecast can show
 * honestly rather than approximate. */
const SIGMA = 0.22;            // spread of the wobble; ~1.5x power wins 9 times in 10
const WIN_LOSS = 0.80;         // share of your hit points spent winning a dead-even fight
const LOSS_FALLOFF = 1.6;      // how fast those losses fall away as your edge grows
const HOLD_LOSS = 0.85;        // share the losing side sheds at parity

const BOMBARD_SCALE = 0.45;    // bombardment is chip damage, not a knockout
const REDEPLOY_COST = 2;       // gold per unit railed across your own territory

/* Expansion: buying a Free Hold out of its independence instead of storming it.
 * The price is the ground's worth plus a payoff for every militiaman who has to
 * be persuaded to go home, and it climbs steeply with each further expansion in
 * the same turn — there is no limit on how many you may buy, only on how long
 * your treasury holds out. */
const EXPAND_BASE = 5;         // floor price of an annexation
const EXPAND_PER_INCOME = 2;   // plus two turns of what the ground earns
const EXPAND_PER_DEFENDER = 3; // plus a payoff per Free Hold soldier standing down
const EXPAND_STEP = 1.6;       // each expansion after the first costs this much more

/* Logistics: land feeds troops. Everything past your supply cap costs a gold
 * a turn each, which is what stops anyone stacking a free peasant horde. */
const SUPPLY_BASE = 3;
const SUPPLY_PER_REGION = 2;

let _unitSeq = 0;
function makeUnit(type, owner) {
  const t = UNITS[type];
  return { id: ++_unitSeq, type, owner, hp: t.hp, maxHp: t.hp, mp: 0, bombarded: false };
}

function unitPower(units, mode) {
  // `mode` is 'atk' or 'def'; returns the pooled score before terrain.
  return units.reduce((sum, u) => sum + UNITS[u.type][mode], 0);
}

/* Fraction of a side's remaining hit points made up of one unit type. */
function hpFraction(units, type) {
  let total = 0, match = 0;
  for (const u of units) { total += u.hp; if (u.type === type) match += u.hp; }
  return total > 0 ? match / total : 0;
}

function hasHerald(units) {
  return units.some(u => u.type === 'herald');
}

function totalHp(units) {
  return units.reduce((s, u) => s + u.hp, 0);
}

/* Terrain + fortification multiplier applied to whoever is defending. */
function defenceMultiplier(region) {
  return 1 + TERRAIN[region.terrain].def + KIND_BONUS[region.kind].def;
}

/* Pooled combat power for one side of a battle.
 * Each unit's contribution is scaled by how much of the enemy it counters,
 * then by the herald aura, then (defenders only) by the ground they stand on. */
function sidePower(units, enemy, mode, terrainMult) {
  if (units.length === 0) return 0;
  const aura = hasHerald(units) ? 1 + HERALD_AURA : 1;
  let power = 0;
  for (const u of units) {
    const target = COUNTERS[u.type];
    const counter = target ? 1 + COUNTER_BONUS * hpFraction(enemy, target) : 1;
    power += UNITS[u.type][mode] * counter;
  }
  return power * aura * (terrainMult || 1);
}

/* Damage lands on the cheapest units first, so a militia screen genuinely
 * shields the ballistas standing behind it. Returns the units that died. */
function applyDamage(units, damage) {
  const order = units.slice().sort((a, b) =>
    (UNITS[a.type].cost - UNITS[b.type].cost) || (a.hp - b.hp));
  const dead = [];
  let left = damage;
  for (const u of order) {
    if (left <= 0) break;
    if (left >= u.hp) { left -= u.hp; u.hp = 0; dead.push(u); }
    else { u.hp -= left; left = 0; }
  }
  for (const u of dead) {
    const i = units.indexOf(u);
    if (i >= 0) units.splice(i, 1);
  }
  return dead;
}

/* Casualty share for the side that wins an exchange, given how decisively. */
function winnerLossFrac(edge) {
  return Math.min(0.95, WIN_LOSS / Math.pow(edge, LOSS_FALLOFF));
}
/* ...and for the side that loses it. At a big enough deficit, everyone dies. */
function loserLossFrac(edge) {
  return Math.min(1, HOLD_LOSS * Math.pow(edge, 0.9));
}

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26, good to ~1e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
            t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/* A forecast the player can read before committing. The odds are exact: with
 * log-normal rolls, P(attacker wins) is just the normal CDF of the log of the
 * power ratio. */
function forecast(attackers, defenders, region) {
  const tMult = defenceMultiplier(region);
  const att = sidePower(attackers, defenders, 'atk', 1);
  const def = sidePower(defenders, attackers, 'def', tMult);
  const attHp = totalHp(attackers), defHp = totalHp(defenders);

  if (defHp <= 0) {
    return { att, def, attHp, defHp, odds: 1, attLossHp: 0, defLossHp: 0 };
  }
  if (attHp <= 0 || att <= 0) {
    return { att, def, attHp, defHp, odds: 0, attLossHp: attHp, defLossHp: 0 };
  }

  const ratio = att / Math.max(def, 1e-6);
  const odds = normalCdf(Math.log(ratio) / (SIGMA * Math.SQRT2));

  // Blend the two possible outcomes by how likely each is.
  const attLossHp = attHp * (odds * winnerLossFrac(ratio) + (1 - odds) * loserLossFrac(1 / ratio));
  const defLossHp = defHp * (odds * 1 + (1 - odds) * winnerLossFrac(1 / ratio));

  return { att, def, attHp, defHp, ratio, odds, attLossHp, defLossHp };
}

/* One exchange. Whoever wins takes the ground; how much it cost them depends
 * entirely on how lopsided the fight was. */
function resolveBattle(attackers, defenders, region, rng) {
  const tMult = defenceMultiplier(region);
  const att = sidePower(attackers, defenders, 'atk', 1);
  const def = sidePower(defenders, attackers, 'def', tMult);
  const attHp = totalHp(attackers), defHp = totalHp(defenders);

  const rollA = att * Math.exp(SIGMA * gaussian(rng));
  const rollD = def * Math.exp(SIGMA * gaussian(rng));

  let attDead, defDead;
  if (rollA > rollD) {
    const edge = rollA / Math.max(rollD, 1e-6);
    defDead = applyDamage(defenders, defHp);                       // the line breaks
    attDead = applyDamage(attackers, attHp * winnerLossFrac(edge));
  } else {
    const edge = rollD / Math.max(rollA, 1e-6);
    attDead = applyDamage(attackers, attHp * loserLossFrac(edge));
    defDead = applyDamage(defenders, defHp * winnerLossFrac(edge));
  }

  return {
    attDead, defDead,
    captured: defenders.length === 0 && attackers.length > 0,
    mutual: defenders.length === 0 && attackers.length === 0
  };
}

function resolveBombard(crews, defenders, region, rng) {
  const power = sidePower(crews, defenders, 'atk', 1);
  const roll = power * Math.exp(SIGMA * gaussian(rng));
  // Ground cover still helps, but the defenders never get to swing back.
  const damage = roll * BOMBARD_SCALE / defenceMultiplier(region);
  return { dead: applyDamage(defenders, damage), damage };
}

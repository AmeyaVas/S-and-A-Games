/* Pentakeover — game state, turn structure and the legal moves.
 *
 * Everything that changes the world goes through a function in here, so the
 * UI and the AI issue exactly the same orders and play by the same rules.
 */

const FACTION_PRESETS = [
  { name: 'Crimson Pact',    color: '#d2463f', ink: '#ffd9d6' },
  { name: 'Azure Covenant',  color: '#3d84d6', ink: '#d6e8ff' },
  { name: 'Verdant Order',   color: '#41a367', ink: '#d6ffe6' },
  { name: 'Amber League',    color: '#d99a2b', ink: '#fff0cf' },
  { name: 'Violet Conclave', color: '#9a5fd0', ink: '#eddaff' }
];

const NEUTRAL = { name: 'Free Holds', color: '#7f868f', ink: '#dfe3e8' };

const CITADEL_COUNT = 5;
const START_GOLD = 24;

const DIFFICULTY = {
  levy:    { name: 'Levy',    bonus: 0.85, aggression: 0.75 },
  veteran: { name: 'Veteran', bonus: 1.00, aggression: 1.00 },
  warlord: { name: 'Warlord', bonus: 1.25, aggression: 1.25 }
};

function createGame(opts) {
  const playerCount = opts.factions.length;
  const regionCount = Math.round((12 + 8 * playerCount) * (opts.mapScale || 1));
  const seed = opts.seed >>> 0;
  const { regions, bounds } = generateMap({ seed, regions: regionCount });
  const rng = mulberry32(seed ^ 0x9e3779b9);

  const factions = opts.factions.map((f, i) => ({
    id: i,
    name: FACTION_PRESETS[i].name,
    color: FACTION_PRESETS[i].color,
    ink: FACTION_PRESETS[i].ink,
    isAI: f.isAI,
    difficulty: f.difficulty || 'veteran',
    label: f.label || FACTION_PRESETS[i].name,
    alive: true,
    gold: START_GOLD,
    capital: -1,
    expansions: 0          // annexations bought this turn; each one raises the price
  }));

  // Capitals first, spread as far apart as the continent allows. Citadels then
  // fill the gaps between them, so every one of the five is contested ground.
  const capitals = spreadPick(regions, playerCount, [], r => r.neighbors.length >= 2);
  capitals.forEach((r, i) => {
    r.kind = 'capital';
    r.terrain = 'plains';
    r.owner = i;
    factions[i].capital = r.id;
  });

  const citadels = spreadPick(regions, CITADEL_COUNT, capitals,
    r => r.kind === 'normal' && !capitals.some(c => c.neighbors.includes(r.id)));
  for (const r of citadels) { r.kind = 'citadel'; r.terrain = 'hills'; }

  const state = {
    regions, bounds, factions, rng, seed,
    citadels: citadels.map(r => r.id),
    current: 0,
    round: 1,
    winner: null,
    log: []
  };

  // Opening armies.
  for (const f of factions) {
    const cap = regions[f.capital];
    cap.units.push(makeUnit('warden', f.id), makeUnit('militia', f.id), makeUnit('militia', f.id));
  }
  // Free Holds garrison everything else, so the first expansion still costs blood.
  for (const r of regions) {
    if (r.kind === 'capital') continue;
    const n = r.kind === 'citadel' ? 3 : (rng() < 0.35 ? 2 : 1);
    for (let i = 0; i < n; i++) {
      r.units.push(makeUnit(r.kind === 'citadel' && i === 0 ? 'warden' : 'militia', null));
    }
  }

  logMsg(state, 'The continent fractures. Five citadels stand unclaimed.', 'system');
  beginTurn(state);
  return state;
}

/* ---------- queries ---------- */

function ownedRegions(state, fid) {
  return state.regions.filter(r => r.owner === fid);
}

function citadelsHeld(state, fid) {
  return state.citadels.filter(id => state.regions[id].owner === fid).length;
}

function regionIncome(state, region) {
  if (region.owner === null) return 0;
  let gold = TERRAIN[region.terrain].income + KIND_BONUS[region.kind].income;
  if (region.units.some(u => u.type === 'herald' && u.owner === region.owner)) gold += 2;
  return gold;
}

function grossIncome(state, fid) {
  return ownedRegions(state, fid).reduce((s, r) => s + regionIncome(state, r), 0);
}

function armySize(state, fid) {
  let n = 0;
  for (const r of state.regions) for (const u of r.units) if (u.owner === fid) n++;
  return n;
}

/* Land feeds troops. You may field `supplyCap` units on their listed wages;
 * every soldier past that costs another gold a turn to keep in the field. */
function supplyCap(state, fid) {
  return SUPPLY_BASE + SUPPLY_PER_REGION * ownedRegions(state, fid).length;
}

function upkeepOf(state, fid) {
  let total = 0, n = 0;
  for (const r of state.regions) {
    for (const u of r.units) {
      if (u.owner !== fid) continue;
      total += UNITS[u.type].upkeep;
      n++;
    }
  }
  return total + Math.max(0, n - supplyCap(state, fid));
}

function netIncome(state, fid) {
  const f = state.factions[fid];
  const mult = f.isAI ? DIFFICULTY[f.difficulty].bonus : 1;
  return Math.round(grossIncome(state, fid) * mult) - upkeepOf(state, fid);
}

/* A station: your seat or a citadel you hold. Troops muster here and territory
 * expansions are bought from here. */
function isStation(state, region, fid) {
  return region.owner === fid && (region.kind === 'capital' || region.kind === 'citadel');
}

/* Every owned region reachable from `fromId` without leaving your own land. */
function supplyNetwork(state, fromId, fid) {
  const seen = new Set([fromId]);
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of state.regions[cur].neighbors) {
      if (seen.has(n)) continue;
      if (state.regions[n].owner !== fid) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  seen.delete(fromId);
  return [...seen];
}

function factionName(state, fid) {
  return fid === null ? NEUTRAL.name : state.factions[fid].label;
}

function factionColor(state, fid) {
  return fid === null ? NEUTRAL.color : state.factions[fid].color;
}

/* ---------- turn structure ---------- */

function beginTurn(state) {
  const f = state.factions[state.current];

  // Citadel victory is checked here rather than on capture: holding all five
  // at the top of your turn means you survived a full round holding them.
  if (citadelsHeld(state, f.id) === CITADEL_COUNT) {
    return declareWinner(state, f.id, 'citadels');
  }

  // The expansion tariff is a per-turn thing: the price resets every turn, so
  // buying land is limited by the treasury rather than by a counter.
  f.expansions = 0;

  const income = netIncome(state, f.id);
  f.gold += income;

  // An army you cannot pay deserts, cheapest first.
  if (f.gold < 0) {
    const disbanded = [];
    while (f.gold < 0) {
      const pool = [];
      // Anyone can be sent home, militia included — an over-supplied horde is
      // exactly the thing that bankrupts you.
      for (const r of state.regions) {
        for (const u of r.units) if (u.owner === f.id) pool.push({ r, u });
      }
      if (pool.length === 0) { f.gold = 0; break; }
      pool.sort((a, b) => UNITS[a.u.type].cost - UNITS[b.u.type].cost);
      const { r, u } = pool[0];
      r.units.splice(r.units.indexOf(u), 1);
      f.gold += UNITS[u.type].cost;
      disbanded.push(UNITS[u.type].name);
    }
    if (disbanded.length) {
      logMsg(state, `${f.label} cannot pay the wages — ${disbanded.join(', ')} desert.`, 'bad', f.id);
    }
  }

  for (const r of state.regions) {
    for (const u of r.units) {
      if (u.owner !== f.id) continue;
      u.mp = UNITS[u.type].move;
      u.bombarded = false;
      u.blitzed = false;
      if (r.owner === f.id) {
        const rate = (r.kind === 'capital' || r.kind === 'citadel') ? 0.30 : 0.12;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rate);
      }
    }
  }

  logMsg(state, `${f.label} — ${income >= 0 ? '+' : ''}${income} gold (${f.gold} in treasury).`, 'turn', f.id);
}

function endTurn(state) {
  if (state.winner !== null) return;
  const alive = state.factions.filter(f => f.alive);
  if (alive.length <= 1) {
    return declareWinner(state, alive.length ? alive[0].id : null, 'conquest');
  }
  let guard = 0;
  do {
    state.current = (state.current + 1) % state.factions.length;
    if (state.current === 0) state.round++;
  } while (!state.factions[state.current].alive && guard++ < 20);
  beginTurn(state);
}

function checkElimination(state) {
  for (const f of state.factions) {
    if (!f.alive) continue;
    if (ownedRegions(state, f.id).length === 0) {
      f.alive = false;
      logMsg(state, `${f.label} is wiped from the map.`, 'bad', f.id);
    }
  }
  const alive = state.factions.filter(f => f.alive);
  if (alive.length === 1 && state.winner === null) declareWinner(state, alive[0].id, 'conquest');
}

function declareWinner(state, fid, how) {
  state.winner = { faction: fid, how };
  const name = fid === null ? 'Nobody' : state.factions[fid].label;
  logMsg(state, how === 'citadels'
    ? `${name} holds all five citadels. Pentakeover complete.`
    : `${name} stands alone on the continent.`, 'win', fid);
}

/* ---------- orders ---------- */

function canRecruit(state, region, fid, type) {
  const f = state.factions[fid];
  return state.winner === null && isStation(state, region, fid) && f.gold >= UNITS[type].cost;
}

function recruit(state, region, fid, type) {
  if (!canRecruit(state, region, fid, type)) return false;
  state.factions[fid].gold -= UNITS[type].cost;
  const u = makeUnit(type, fid);
  u.mp = 0;                       // mustered this turn, marches the next
  region.units.push(u);
  logMsg(state, `${state.factions[fid].label} musters a ${UNITS[type].name}.`, 'info', fid);
  return true;
}

/* ---------- expansion ----------
 *
 * A station — your seat, or any citadel you hold — can buy an adjacent Free
 * Hold out of its independence instead of storming it. There is no cap on how
 * many you may take in a turn; the price simply climbs with each one, so the
 * limit is what your treasury will bear.
 *
 * Only Free Holds are for sale. Rival land is never for sale at any price, and
 * neither are citadels: the five regions that end the game have to be taken.
 */

function expandCost(state, region, fid) {
  const f = state.factions[fid];
  const worth = TERRAIN[region.terrain].income + KIND_BONUS[region.kind].income;
  const raw = EXPAND_BASE + worth * EXPAND_PER_INCOME + region.units.length * EXPAND_PER_DEFENDER;
  return Math.round(raw * Math.pow(EXPAND_STEP, f.expansions));
}

function canExpand(state, station, region, fid) {
  if (state.winner !== null) return false;
  if (!isStation(state, station, fid)) return false;
  if (!station.neighbors.includes(region.id)) return false;
  if (region.owner !== null) return false;              // nobody sells their own land
  if (region.kind === 'citadel') return false;          // citadels are taken, not bought
  return state.factions[fid].gold >= expandCost(state, region, fid);
}

/* Every Free Hold this faction could annex right now, as {region, cost} pairs,
 * cheapest first. The UI lists them and the AI shops from the same list. */
function expandOptions(state, fid) {
  const out = [];
  const seen = new Set();
  for (const station of state.regions) {
    if (!isStation(state, station, fid)) continue;
    for (const n of station.neighbors) {
      if (seen.has(n)) continue;
      const r = state.regions[n];
      if (r.owner !== null || r.kind === 'citadel') continue;
      seen.add(n);
      out.push({ station, region: r, cost: expandCost(state, r, fid) });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

function expand(state, station, region, fid) {
  if (!canExpand(state, station, region, fid)) return false;
  const f = state.factions[fid];
  const cost = expandCost(state, region, fid);
  f.gold -= cost;
  f.expansions++;
  // The Free Hold garrison stands down and goes home; the ground changes hands
  // undefended, which is the real price of taking it with coin instead of blood.
  region.units = [];
  region.owner = fid;
  logMsg(state, `${f.label} expands into ${regionLabel(region)} for ${cost} gold.`, 'good', fid);
  return true;
}

/* What a stack of selected units may legally do with a given neighbour. */
function orderKind(state, from, to, units, fid) {
  if (!from.neighbors.includes(to.id)) return null;
  if (units.length === 0 || units.some(u => u.mp <= 0)) return null;
  if (to.owner === fid) return 'move';
  if (to.units.length === 0) return 'claim';
  return 'attack';
}

function moveUnits(state, from, to, units, fid) {
  const kind = orderKind(state, from, to, units, fid);
  if (!kind || state.winner !== null) return null;

  if (kind === 'move' || kind === 'claim') {
    const wasOwner = to.owner;
    for (const u of units) {
      from.units.splice(from.units.indexOf(u), 1);
      u.mp -= 1;
      to.units.push(u);
    }
    if (kind === 'claim') {
      to.owner = fid;
      logMsg(state, `${state.factions[fid].label} claims ${regionLabel(to)} unopposed.`, 'good', fid);
      if (wasOwner !== null) checkElimination(state);
    }
    return { kind, captured: kind === 'claim' };
  }

  const defenders = to.units;
  const defOwner = to.owner;
  const attackers = units.slice();
  const before = { att: attackers.length, def: defenders.length };

  // Detach the attacking stack so casualties on both sides resolve cleanly.
  for (const u of attackers) from.units.splice(from.units.indexOf(u), 1);

  const result = resolveBattle(attackers, defenders, to, state.rng);

  let outcome;
  if (result.captured) {
    to.owner = fid;
    to.units = attackers;
    for (const u of attackers) {
      // A lancer that breaks a line keeps enough momentum for one more push.
      u.mp = (u.type === 'lancer' && !u.blitzed) ? 1 : 0;
      if (u.type === 'lancer') u.blitzed = true;
    }
    outcome = 'captured';
  } else if (result.mutual) {
    to.units = [];
    outcome = 'mutual';
  } else {
    // Repulsed: the survivors fall back to where they set out from.
    for (const u of attackers) { u.mp = 0; from.units.push(u); }
    outcome = 'repulsed';
  }

  const lostA = before.att - attackers.length;
  const lostD = before.def - defenders.length;
  const verb = outcome === 'captured' ? 'takes' : outcome === 'mutual' ? 'bleeds out over' : 'is thrown back from';
  logMsg(state,
    `${state.factions[fid].label} ${verb} ${regionLabel(to)} — ${lostA} lost, ${lostD} of ${factionName(state, defOwner)} killed.`,
    outcome === 'captured' ? 'good' : 'bad', fid);

  if (defOwner !== null) checkElimination(state);
  return { kind: 'attack', outcome, lostA, lostD, captured: outcome === 'captured' };
}

function canBombard(state, from, to, crews, fid) {
  if (state.winner !== null) return false;
  if (!from.neighbors.includes(to.id)) return false;
  if (to.owner === fid || to.units.length === 0) return false;
  return crews.length > 0 && crews.every(u => u.type === 'ballista' && u.mp > 0 && !u.bombarded);
}

function bombard(state, from, to, crews, fid) {
  if (!canBombard(state, from, to, crews, fid)) return null;
  const targetOwner = to.owner;
  const before = to.units.length;
  const res = resolveBombard(crews, to.units, to, state.rng);
  for (const u of crews) { u.mp = 0; u.bombarded = true; }
  logMsg(state,
    `${state.factions[fid].label} bombards ${regionLabel(to)} — ${before - to.units.length} of ${factionName(state, targetOwner)} killed.`,
    'good', fid);
  // Shelling can empty a region but never takes it; somebody has to walk in.
  return res;
}

function canRedeploy(state, from, to, units, fid) {
  if (state.winner !== null) return false;
  if (from.owner !== fid || to.owner !== fid || from.id === to.id) return false;
  if (units.length === 0) return false;
  if (units.some(u => u.mp < UNITS[u.type].move)) return false;   // must not have marched yet
  if (state.factions[fid].gold < units.length * REDEPLOY_COST) return false;
  return supplyNetwork(state, from.id, fid).includes(to.id);
}

function redeploy(state, from, to, units, fid) {
  if (!canRedeploy(state, from, to, units, fid)) return false;
  state.factions[fid].gold -= units.length * REDEPLOY_COST;
  for (const u of units) {
    from.units.splice(from.units.indexOf(u), 1);
    u.mp = 0;
    to.units.push(u);
  }
  logMsg(state, `${state.factions[fid].label} rails ${units.length} unit${units.length > 1 ? 's' : ''} to ${regionLabel(to)}.`, 'info', fid);
  return true;
}

/* ---------- misc ---------- */

function regionLabel(region) {
  const suffix = region.kind === 'citadel' ? ' Citadel' : region.kind === 'capital' ? ' Seat' : '';
  // Maps built before grid references existed, and any region assembled by hand
  // in a test, still need something to be called.
  return (region.grid || 'R' + region.id) + suffix;
}

function logMsg(state, text, tone, fid) {
  state.log.push({ text, tone: tone || 'info', fid: fid === undefined ? null : fid, round: state.round });
  if (state.log.length > 300) state.log.shift();
}

/* Pentakeover — the opposing factions.
 *
 * A heuristic commander rather than a search: it prices every region, works
 * out how much of each garrison it can spare, and takes the best-value fight
 * available. It plays one action per `step()` so the UI can show its turn
 * happening instead of teleporting the board.
 */

const AI_PHASES = ['recruit', 'bombard', 'attack', 'stage', 'redeploy', 'done'];

function createAI(state, fid) {
  return {
    state, fid,
    phase: 0,
    guard: 0,
    /* Performs at most one action. Returns a short description, or null when
     * the phase produced nothing and we have moved on. Done when phase hits
     * 'done'. */
    step() {
      if (this.state.winner !== null) { this.phase = AI_PHASES.length - 1; return null; }
      if (this.guard++ > 260) { this.phase = AI_PHASES.length - 1; return null; }
      const phase = AI_PHASES[this.phase];
      let acted = null;
      if (phase === 'recruit')       acted = aiRecruit(this.state, this.fid);
      else if (phase === 'bombard')  acted = aiBombard(this.state, this.fid);
      else if (phase === 'attack')   acted = aiAttack(this.state, this.fid);
      else if (phase === 'stage')    acted = aiStage(this.state, this.fid);
      else if (phase === 'redeploy') acted = aiRedeploy(this.state, this.fid);
      if (!acted && phase !== 'done') this.phase++;
      return acted;
    },
    get done() { return AI_PHASES[this.phase] === 'done'; }
  };
}

function aggressionOf(state, fid) {
  const f = state.factions[fid];
  return DIFFICULTY[f.difficulty || 'veteran'].aggression;
}

/* What a region is worth, in gold. Land is an annuity, so it is priced over a
 * payback horizon rather than at one turn of income — otherwise no conquest
 * ever looks worth its casualties. */
const VALUE_HORIZON = 5;

function regionValue(state, r, fid) {
  let v = (TERRAIN[r.terrain].income + KIND_BONUS[r.kind].income) * VALUE_HORIZON;
  if (r.kind === 'citadel') v += 45;                 // five of these ends the game
  if (r.kind === 'capital') v += r.owner === fid ? 60 : 30;
  // More supply cap, more army. Worth something on its own.
  v += SUPPLY_PER_REGION * 2;
  // Ground that touches our own land is worth more than a far-flung prize.
  v += r.neighbors.filter(n => state.regions[n].owner === fid).length * 3;
  return v;
}

/* Roughly what a hit point of this force cost to buy, so casualties can be
 * weighed against a region's value in the same currency. */
function goldPerHp(units) {
  const hp = totalHp(units);
  if (hp <= 0) return 1;
  return units.reduce((s, u) => s + UNITS[u.type].cost, 0) / hp;
}

const NEUTRAL_MENACE = 0.2;   // Free Holds sit still; they are not a threat

function adjacentThreat(state, r, fid) {
  let worst = 0;
  for (const n of r.neighbors) {
    const o = state.regions[n];
    if (o.owner === fid) continue;
    const p = sidePower(o.units, r.units, 'atk', 1) * (o.owner === null ? NEUTRAL_MENACE : 1);
    worst = Math.max(worst, p);
  }
  return worst;
}

/* Units in a region beyond what it needs to hold itself. */
function spareUnits(state, r, fid) {
  const movable = r.units.filter(u => u.owner === fid && u.mp > 0);
  if (movable.length === 0) return [];
  const threat = adjacentThreat(state, r, fid);
  if (threat <= 0.5) return movable;

  // A garrison that cannot plausibly hold is not a garrison, it is a donation.
  // Send it somewhere it can do something instead of dying in place.
  const standing = r.units.reduce((s, u) => s + UNITS[u.type].def, 0) * defenceMultiplier(r);
  if (standing < threat * 0.4) return movable;

  const need = threat * 0.55 * (r.kind === 'citadel' || r.kind === 'capital' ? 1.35 : 1);
  // Keep the best defenders home; send the rest.
  const byDefence = r.units.slice().sort((a, b) => UNITS[b.type].def - UNITS[a.type].def);
  const keep = new Set();
  let held = 0;
  for (const u of byDefence) {
    if (held >= need) break;
    keep.add(u.id);
    held += UNITS[u.type].def * defenceMultiplier(r);
  }
  return movable.filter(u => !keep.has(u.id));
}

/* ---------- recruiting ---------- */

function aiRecruit(state, fid) {
  const f = state.factions[fid];
  const musters = state.regions.filter(r => isMusterPoint(state, r, fid));
  if (musters.length === 0) return null;

  // Keep a float for redeploys and next turn's upkeep.
  const reserve = 4 + upkeepOf(state, fid);
  if (f.gold <= reserve) return null;

  // The supply cap is a price, not a wall: past it every soldier costs an
  // extra gold a turn. Keep hiring as long as the books still balance,
  // otherwise a rich faction sits on its treasury and the war freezes.
  const overCap = armySize(state, fid) >= supplyCap(state, fid);
  const headroom = netIncome(state, fid) - (overCap ? 1 : 0);
  if (headroom < 1) return null;

  // What are we actually up against?
  const enemy = [];
  for (const r of state.regions) {
    if (r.owner === fid) continue;
    const near = r.neighbors.some(n => state.regions[n].owner === fid);
    if (near) enemy.push(...r.units);
  }

  const mine = [];
  for (const r of state.regions) for (const u of r.units) if (u.owner === fid) mine.push(u);
  const army = Math.max(mine.length, 1);
  const share = t => mine.filter(u => u.type === t).length / army;
  const enemyShare = t => enemy.length ? hpFraction(enemy, t) : 0;

  const want = {
    // Bodies to soak damage — but only up to a screen. Past that they are
    // just mouths, and militia are cheap enough to crowd out everything else.
    militia:  share('militia') < 0.40 ? 1.7 : 0.12,
    // Counters, weighted by what the enemy actually fields.
    lancer:   0.55 + enemyShare('ballista') * 2.0,
    warden:   0.60 + enemyShare('lancer') * 1.8,
    ballista: 0.35 + enemyShare('warden') * 2.2,
    // One banner per handful of troops, never a third.
    herald:   share('herald') * army >= Math.min(2, Math.floor(army / 6) + 1) ? 0 : 0.9
  };

  let best = null, bestScore = 0;
  for (const type of UNIT_ORDER) {
    const cost = UNITS[type].cost;
    if (f.gold - cost < reserve) continue;
    if (headroom - UNITS[type].upkeep < 0) continue;      // cannot cover the wages
    const score = want[type] / Math.sqrt(cost);
    if (score > bestScore) { bestScore = score; best = type; }
  }
  if (!best) return null;

  // Muster where the pressure is; fall back to the capital.
  musters.sort((a, b) => adjacentThreat(state, b, fid) - adjacentThreat(state, a, fid));
  const where = musters[0];
  if (!recruit(state, where, fid, best)) return null;
  return `${UNITS[best].name} at ${regionLabel(where)}`;
}

/* ---------- shelling ---------- */

function aiBombard(state, fid) {
  for (const r of state.regions) {
    if (r.owner !== fid) continue;
    const crews = r.units.filter(u => u.owner === fid && u.type === 'ballista' && u.mp > 0 && !u.bombarded);
    if (crews.length === 0) continue;
    let best = null, bestScore = 0;
    for (const n of r.neighbors) {
      const to = state.regions[n];
      if (!canBombard(state, r, to, crews, fid)) continue;
      // Soften whatever we most want to walk into next.
      const score = regionValue(state, to, fid) + totalHp(to.units) * 0.4;
      if (score > bestScore) { bestScore = score; best = to; }
    }
    if (best) {
      bombard(state, r, best, crews, fid);
      return `bombards ${regionLabel(best)}`;
    }
  }
  return null;
}

/* ---------- attacking ---------- */

function aiAttack(state, fid) {
  const aggression = aggressionOf(state, fid);
  let best = null;

  for (const from of state.regions) {
    if (from.owner !== fid) continue;
    const movable = from.units.filter(u => u.owner === fid && u.mp > 0);
    if (movable.length === 0) continue;

    // Two ways to commit: send only what the region can spare, or throw in
    // the whole garrison and accept that home is left open. Price the second
    // rather than forbidding it — refusing to ever strip a border region is
    // what freezes a front line into permanent stalemate.
    const spare = spareUnits(state, from, fid);
    const options = [{ force: spare, exposure: 0 }];
    if (movable.length > spare.length) {
      const exposed = adjacentThreat(state, from, fid) > 0.5
        ? regionValue(state, from, fid) * 0.35 : 0;
      options.push({ force: movable, exposure: exposed });
    }

    for (const n of from.neighbors) {
      const to = state.regions[n];
      if (to.owner === fid) continue;

      const value = regionValue(state, to, fid);

      // Walking into empty ground is free real estate — grab it with the
      // cheapest thing that can get there.
      if (to.units.length === 0) {
        const cheap = movable.slice().sort((a, b) => UNITS[a.type].cost - UNITS[b.type].cost)[0];
        const score = value * 1.2 * aggression;
        if (!best || score > best.score) best = { from, to, units: [cheap], score, claim: true };
        continue;
      }

      for (const opt of options) {
        if (opt.force.length === 0) continue;
        // Try committing progressively more, and keep whichever commitment
        // buys the most ground per unit of blood.
        const ordered = opt.force.slice().sort((a, b) =>
          UNITS[b.type].atk / UNITS[b.type].cost - UNITS[a.type].atk / UNITS[a.type].cost);
        for (let take = 1; take <= ordered.length; take++) {
          const force = ordered.slice(0, take);
          const fc = forecast(force, to.units, to);
          if (fc.odds < 0.5 / aggression) continue;
          const committing = take === ordered.length ? opt.exposure : 0;
          const gain = value * fc.odds * aggression;
          const cost = fc.attLossHp * goldPerHp(force) + committing;
          const score = gain - cost;
          if (score > 1 && (!best || score > best.score)) {
            best = { from, to, units: force, score, claim: false };
          }
          if (fc.odds > 0.92) break;   // no need to send more than this
        }
      }
    }
  }

  if (!best) return null;
  const label = regionLabel(best.to);
  moveUnits(state, best.from, best.to, best.units, fid);
  return best.claim ? `claims ${label}` : `assaults ${label}`;
}

/* ---------- massing ---------- */

const STAGE_ODDS = 0.7;

/* The single prize most worth the whole army's attention, and the region to
 * gather in before taking a swing at it. Derived fresh from the board each
 * turn rather than remembered, so it stays stable while the board does and
 * shifts the moment the board shifts. */
function frontFocus(state, fid) {
  let best = null;
  for (const to of state.regions) {
    if (to.owner === fid) continue;
    const borders = to.neighbors.map(n => state.regions[n]).filter(r => r.owner === fid);
    if (borders.length === 0) continue;
    // Cheap ground first: the prize discounted by what it is defended with.
    const value = regionValue(state, to, fid) - totalHp(to.units) * 0.35;
    if (!best || value > best.value) {
      const staging = borders.slice().sort((a, b) =>
        b.units.length - a.units.length || defenceMultiplier(b) - defenceMultiplier(a))[0];
      best = { to, staging, borders, value };
    }
  }
  return best;
}

/* A front line where every region holds two units is a front line nobody can
 * ever cross: the defender's terrain bonus beats an even fight every time.
 * Breaking one needs a spearhead, so funnel spare troops from anywhere in the
 * empire into a single staging region and swing next turn. */
function aiStage(state, fid) {
  const focus = frontFocus(state, fid);
  if (!focus) return null;

  const garrison = focus.staging.units.filter(u => u.owner === fid);
  if (garrison.length && forecast(garrison, focus.to.units, focus.to).odds >= STAGE_ODDS) {
    return null;                      // strong enough already; the attack phase has it
  }

  // Nearest first: walking is free, railing is not.
  const neighbours = focus.staging.neighbors
    .map(n => state.regions[n])
    .filter(r => r.owner === fid);
  for (const b of neighbours) {
    const movers = spareUnits(state, b, fid);
    if (movers.length === 0) continue;
    moveUnits(state, b, focus.staging, movers, fid);
    return `masses at ${regionLabel(focus.staging)}`;
  }

  // Then pull from the quiet interior, cheapest fronts first.
  const f = state.factions[fid];
  if (f.gold < REDEPLOY_COST * 2) return null;
  const interior = supplyNetwork(state, focus.staging.id, fid)
    .map(id => state.regions[id])
    .sort((a, b) => adjacentThreat(state, a, fid) - adjacentThreat(state, b, fid));

  for (const b of interior) {
    const movers = spareUnits(state, b, fid).filter(u => u.mp >= UNITS[u.type].move);
    if (movers.length === 0) continue;
    const affordable = Math.min(movers.length, Math.floor((f.gold - 2) / REDEPLOY_COST));
    if (affordable < 1) continue;
    const force = movers.slice(0, affordable);
    if (!canRedeploy(state, b, focus.staging, force, fid)) continue;
    redeploy(state, b, focus.staging, force, fid);
    return `masses at ${regionLabel(focus.staging)}`;
  }
  return null;
}

/* ---------- logistics ---------- */

function aiRedeploy(state, fid) {
  const f = state.factions[fid];
  if (f.gold < REDEPLOY_COST * 2) return null;

  // Do not undo the spearhead the staging phase just built.
  const focus = frontFocus(state, fid);
  const spearhead = focus ? focus.staging.id : -1;

  // Quietest region with idle troops -> loudest region that needs them.
  let source = null, sourceSpare = null, quiet = Infinity;
  for (const r of state.regions) {
    if (r.owner !== fid || r.id === spearhead) continue;
    const idle = r.units.filter(u => u.owner === fid && u.mp >= UNITS[u.type].move);
    if (idle.length === 0) continue;
    const threat = adjacentThreat(state, r, fid);
    if (threat > 0.5) continue;                      // it is needed where it stands
    const keep = r.kind === 'capital' || r.kind === 'citadel' ? 1 : 0;
    if (idle.length <= keep) continue;
    if (threat < quiet) { quiet = threat; source = r; sourceSpare = idle.slice(keep); }
  }
  if (!source) return null;

  let target = null, loudest = 0;
  for (const id of supplyNetwork(state, source.id, fid)) {
    const r = state.regions[id];
    const threat = adjacentThreat(state, r, fid);
    const pull = threat + (r.kind === 'citadel' ? 6 : 0);
    if (pull > loudest) { loudest = pull; target = r; }
  }
  if (!target || loudest < 2) return null;

  const affordable = Math.min(sourceSpare.length, Math.floor((f.gold - 2) / REDEPLOY_COST));
  if (affordable < 1) return null;
  const force = sourceSpare.slice(0, affordable);
  if (!redeploy(state, source, target, force, fid)) return null;
  return `reinforces ${regionLabel(target)}`;
}

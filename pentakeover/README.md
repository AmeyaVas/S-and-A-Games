# Pentakeover

A turn-based game of territory. Five unit types, up to five factions, and five
citadels scattered across a procedurally generated continent. Hold every citadel
through a full round and you win — or take the slow road and remove everyone else
from the map.

Open `index.html` in a browser. No build step, no dependencies.

The first time you open it you get a **How to play** page covering the goal, the
shape of a turn, the counter triangle and what the marks on the map mean. After
that it goes straight to the faction picker, and the page is still there behind
the *How to play* button or the `H` key.

```sh
start index.html      # Windows
open  index.html      # macOS
xdg-open index.html   # Linux
```

## The five units

| Unit | Cost | Upkeep | HP | Atk | Def | Move | Strong against |
|---|---|---|---|---|---|---|---|
| Militia  | 3  | 0 | 6  | 2  | 3 | 1 | — |
| Lancer   | 8  | 1 | 7  | 7  | 3 | 2 | Ballista |
| Warden   | 7  | 1 | 12 | 3  | 8 | 1 | Lancer |
| Ballista | 11 | 2 | 5  | 10 | 1 | 1 | Warden |
| Herald   | 9  | 1 | 6  | 1  | 2 | 2 | — |

**Lancer beats Ballista beats Warden beats Lancer.** The counter bonus is up to
+75%, scaled by how much of the enemy stack is actually that type — so a counter
is worth a great deal against a pure army and very little against a mixed one.
Building one of everything is a real defence against being countered.

The two units outside the triangle bend the numbers instead of winning fights.
**Militia** are cheap bodies, and casualties always land on the cheapest units
first, so a militia screen is armour for the expensive things behind it.
**Herald** fights terribly but grants every friendly unit stacked with it +20%
attack and defence, and earns its region an extra 2 gold.

## Winning

Two paths:

- **Citadels** — hold all five at the *start* of your turn. Because the check
  happens at the top of your turn and not the moment you capture, you have to
  survive a full round of everyone else's turns still holding them.
- **Conquest** — be the last faction with any land left.

## Orders

Select a region you own, pick units from the garrison list, then choose an order.
Highlighted regions are the legal targets.

- **Move / Attack** — into an adjacent region. Attacking spends all of a unit's
  movement. A Lancer that breaks a line keeps one point of movement and can push
  on once more that turn.
- **Bombard** — Ballistas only. Hits an adjacent region without entering it and
  takes no return damage, but never captures ground. Shelling a region empty
  still means somebody has to walk in afterwards.
- **Redeploy** — rails units that have not yet moved anywhere in your connected
  territory, for 2 gold each. This is how you concentrate an army; a front line
  where every region holds two units is a front line nobody can cross.

Space or Enter ends your turn, Escape clears a selection, C opens the codex,
and H reopens the how-to-play page.

## How a battle resolves

Each side pools its power — attack stats for the attacker, defence stats for the
defender — adjusted for counters, the Herald aura, and the ground being defended.
Both rolls get a log-normal wobble, and the higher roll wins the region.

The win chance shown in the battle forecast is exact, not an estimate: with
log-normal rolls it is just the normal CDF of the log of the power ratio. Roughly
1.25× power wins three quarters of the time and 1.5× wins nine times in ten.

How much winning costs depends on how lopsided the fight was. Win narrowly and
you lose most of your force taking the ground; win decisively and you walk in
nearly intact. Losing badly kills everyone; losing narrowly leaves survivors who
fall back to where they set out from.

Terrain is multiplied onto the defender: plains +0%, forest +20%, hills +40%,
mountains +65%, with another +30% for a capital and +50% for a citadel. A citadel
on hills defends at ×1.9, which is why cavalry bounces off one and siege engines
do not.

## Money and supply

Income arrives at the start of your turn, minus upkeep. Recruiting only happens
at your capital and at citadels you hold, which is what gives movement a point.

Land also feeds troops: you can field `3 + 2 × regions` units on their listed
wages, and every soldier past that costs another gold a turn. It is a price
rather than a hard ceiling — a rich empire can carry an oversized army — but go
into the red and your cheapest troops desert until the books balance. Wanting a
bigger army is a reason to take more ground.

## Layout

```
pentakeover/
├─ index.html   markup
├─ style.css    styling
├─ units.js     unit stats, terrain, combat maths
├─ map.js       Voronoi map generation
├─ game.js      state, turn structure, legal orders
├─ ai.js        the opposing factions
├─ render.js    canvas drawing
└─ ui.js        DOM wiring, input, turn runner
```

Plain `<script>` tags in that order, deliberately not ES modules — modules are
blocked by CORS on `file://`, and this game is meant to run by double-clicking
`index.html` like the others in this repo.

Every order the AI gives goes through the same functions in `game.js` that the
interface calls, so the computer cannot make a move you could not.

## Notes on the map

The continent is a convex blob; regions are Voronoi cells clipped out of it by
half-planes. Each polygon edge remembers which neighbour's bisector cut it, so
adjacency is exact rather than inferred from a distance tolerance. Capitals and
citadels are placed by farthest-point sampling so they never bunch up, and any
region the clipping strands gets bridged to the mainland — a faction walled off
from the war would have nothing to do.

Maps are seeded. The seed is shown on the result screen, and typing the same seed
into the setup box rebuilds the same continent.

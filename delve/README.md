# Delve

A cave-dweller roguelite platformer, built with plain HTML5 Canvas and vanilla JavaScript — no frameworks, no build step, no dependencies. One run is a descent through five cave depths with a single life: follow the glow-moss down winding tunnels and tall shafts, shoot whatever crawls, flies or spits at you, take a relic at the bottom of every depth, and break the Warden waiting under the fifth.

The levels are hand-made, but marked spots in them reroll every run, so no two descents play quite the same.

## Setup

There's nothing to install. Just open `index.html` in a browser:

- **Windows**: double-click `index.html`, or right-click → Open with → your browser.
- **Or from a terminal**:

  ```
  start index.html       (Windows)
  open index.html        (macOS)
  xdg-open index.html    (Linux)
  ```

Your records (deepest depth, best full run, total kills) are kept in `localStorage`. Some browsers refuse that to `file://` pages; the game still plays, it just won't remember. Serving the repo root over HTTP avoids it — see the [top-level README](../README.md).

## How to play

| Key | Does |
|---|---|
| <kbd>A</kbd> <kbd>D</kbd> or <kbd>&larr;</kbd> <kbd>&rarr;</kbd> | Move |
| <kbd>W</kbd>, <kbd>&uarr;</kbd> or <kbd>Space</kbd> | Jump — hold for higher |
| <kbd>S</kbd> or <kbd>&darr;</kbd> | Drop through a plank |
| Mouse | Aim |
| Click / hold, or <kbd>F</kbd> | Fire |
| <kbd>Shift</kbd> | Blink dash (while you have charges) |
| <kbd>Esc</kbd> | Pause |

Jumps forgive a late press off a ledge and an early press before landing.

1. **Follow the moss.** Glow-moss lines the main route and lights up as you come near, so the way deeper is always the lit one. Side pockets off the tunnel hold crystals and tougher nests.
2. **Stay alive.** Spikes and lava hurt badly but don't kill outright; only a bottomless pit does. Life sparks drift out of some kills and float toward you. Each beacon heals you to full once — there are no respawn points.
3. **Drop into the descent hole** at the end of a depth, then pick one of three relics. Relics last for the rest of the run.
4. **Break the Warden.** Depth 5 ends in its hollow, and the way out stays sealed until it falls.

Dying ends the run. The next one starts again at Depth 1 with fresh rolls and no relics.

## Enemies

| Enemy | Does |
|---|---|
| Crawler | Patrols ledges and turns at edges |
| Bat | Hangs until it sees you, then swoops |
| Spitter | Clings to rock and lobs arcing acid |
| Brute | Tanky. Charges when you are level with it |
| Grub nest | Keeps spawning crawlers until destroyed |
| Warden | Three-phase boss: orb fans, then a summoned swarm, then slams |

## Powerups

Crystals sit in the levels and occasionally drop from kills. *Permanent* means for the rest of the run; picking up a permanent one you already have heals you instead.

| Crystal | Effect |
|---|---|
| Splitter | Permanent — shots fork into three |
| Ricochet | Permanent — shots bounce off rock twice |
| Overclock | 20 s — fire rate doubled |
| Featherfall | 45 s — double jump, and hold jump to glide |
| Aegis | Absorbs the next two hits |
| Blink | Three dashes through enemies on <kbd>Shift</kbd> |
| Flare | 10 s — a huge light radius that shows side pockets |

Splitter and Ricochet are rarer: at most one fixed spot per depth, plus a small drop chance.

## Relics

Thick Hide (+25 max HP), Knapped Flint (+30% damage), Long Wick (+35% light), Ember Heart (sparks heal more), Slow Candle (timed powerups last longer), Prospector's Eye (kills may drop crystals), Quick Hands (+20% fire rate) and Deep Lungs (heal on reaching each depth). Taking the same relic twice stacks it.

## What rerolls

The depth maps in `levels.js` carry variant markers, rolled from the run's seed when it starts:

- **`L`** — a rock that turns to lava about 8% of the time. Only ever placed where it is not the sole foothold.
- **`J` / `P`** — a wall climbed by a jump pad *or* a staircase. Both reach the same ledge.
- **`?`** — an enemy slot that may be empty or one of the depth's allowed types.
- **`*`** — a crystal slot that may hold a random timed powerup, or nothing.

Every depth was checked with every variant at its worst — all `L` as lava, every wall both ways — so a run can always be finished. Add `?seed=1234` to the URL to replay a particular set of rolls.

## Files

- [`index.html`](index.html) — the canvas, HUD and overlays
- [`style.css`](style.css) — layout and the wet-stone theme
- [`levels.js`](levels.js) — the five depth maps as row strings, with a legend
- [`game.js`](game.js) — input, physics, variant rolling, the run, enemies, powerups, lighting and rendering

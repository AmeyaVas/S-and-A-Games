# Gravity Golf

A tiny physics mini-golf game. One file, no build, no dependencies —
double-click `index.html` to play in any browser.

## How to play

- **Drag back from the ball and release** to putt (slingshot style).
  The dotted line previews your path; the ring around the ball shows power.
- Planets **pull** the ball with real gravity — bank shots off their wells,
  slingshot around them, or hit one dead-on and bounce straight back.
- **Suns** (orange) burn the ball up — you respawn at your last resting spot,
  losing the stroke.
- **Repulsors** (purple) push the ball away instead of pulling.
- Get the ball into the cup moving slowly enough and it drops. Fewest strokes wins.
- 9 hand-made holes, par tracked against the field.

## The three sections

The course introduces one hazard at a time, and the holes are grouped to match. A
hole belongs to the section of the hardest body it contains, so a hole with both a
sun and a repulsor sits with the repulsors.

| Section | What's new | Holes |
|---|---|---|
| **Planets** | pull only | 1-2 |
| **Suns** | a sun on the board | 3-5 |
| **Repulsors** | a repulsor on the board | 6-9 |

Sink the last hole of a section and the card tells you which hazard is coming next.
The grouping is derived from each hole's bodies (`holeSection` in `index.html`) — only
the *order* of `HOLES` is hand-maintained, and `#debug` warns if it falls out of
section order.

## Getting around

- **Start screen** — the title card. **Start** begins a fresh round on hole 1;
  **Continue** appears only if you have progress saved and drops you at the furthest
  hole you have reached.
- **Hole selector** — the numbered row under the scoreboard. A hole unlocks once
  you reach it, so you can jump back to any hole you have played, but not skip
  ahead. Green means holed, highlighted is where you are, dimmed is still locked.
  The row is split into the three sections above, each with its own label.
- **Replay hole** — restart the current hole
- **New game** — back to hole 1 with a clean scorecard. Holes you have already
  reached stay unlocked.

Your unlocked holes and scorecard are saved in the browser, so closing the tab
and coming back keeps your progress. Replaying a hole overwrites that hole's
score rather than adding to your total.

Saving works when you double-click `index.html` in Chrome, and over a local
server — both verified. Browsers do differ on whether they allow storage for
`file://` pages, though, so if progress ever resets between sessions on some
other browser, that is why. Nothing breaks either way: the game plays the same,
it just starts over. Serving the folder over HTTP sidesteps it entirely:

```sh
npx serve .        # or any static file server
```

## Tinkering

Open `index.html#debug` to expose `window.gg` in the console:

```js
gg.state           // current hole / section / strokes / score / scores[] / furthest unlocked
gg.ball            // live ball: {x, y, vx, vy, alive, captured}
gg.load(4)         // jump to hole 5 (0-indexed)
gg.putt(300, -200) // fire the ball with a velocity vector
gg.sim(2.5)        // fast-forward the physics 2.5s, return where the ball ended up
gg.audit()         // check every body actually reaches its hole's line
gg.sections()      // per hole: section, par, body types, and whether it ends a section
```

`gg.audit()` exists because gravity is a *finite* well: a body more than `FIELD_R`
radii from a hole's tee-to-cup line exerts nothing on the direct route and is just
scenery. It returns a row per body with its distance, reach and margin, and anything
out of reach — or within `AUDIT_THIN` px of it — is flagged in the console on load
under `#debug`. Run it after editing `HOLES`.

It measures the *straight* line only, so read it as a smell rather than a verdict.
Hole 7 is the standing example: its planet is 183px out against a 184px reach and
gets flagged, but the hole plays fine, because the real route curves around the
repulsor before reaching it.

`gg.sim()` steps the physics directly instead of waiting on animation frames,
so it is the quick way to test a shot from the console. It stops early if the
ball sinks, and reports where things ended up:

```js
gg.sim(6) // -> {x, y, v, sunk, strokes, captured, atRest}
```

Course layout and physics constants are all near the top of the `<script>`
block in `index.html` (`HOLES`, `G`, `FRICTION`, `CUP_MOUTH`, …).

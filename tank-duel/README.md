# Tank Duel

A two-player artillery duel for one keyboard, built with plain HTML5 Canvas and vanilla JavaScript — no frameworks, no build step, no dependencies. Two tanks sit either side of a hill, take turns setting an angle and a power, and fire. The ground is a heightmap that craters where shells land, so the field slowly digs itself out from under both players.

This is the only game here you cannot play alone — it needs a second person in the room.

## Setup

There's nothing to install. Just open `index.html` in a browser:

- **Windows**: double-click `index.html`, or right-click → Open with → your browser.
- **Or from a terminal**:

  ```
  start index.html       (Windows)
  open index.html        (macOS)
  xdg-open index.html    (Linux)
  ```

That's it — the game runs entirely client-side.

## How to play

Both players share the same keys, because only one tank acts per turn. The dash
at the bottom says whose turn it is, and an amber arrow sits above the tank that
is about to fire.

| Key | Does |
|---|---|
| <kbd>&uarr;</kbd> <kbd>&darr;</kbd> | Raise and lower the barrel |
| <kbd>&rarr;</kbd> <kbd>&larr;</kbd> | More and less power |
| <kbd>Space</kbd> | Fire |
| <kbd>R</kbd> | Start a new match |

Hold an arrow key rather than tapping it — the numbers sweep while it is held.

Up always *raises* the firing tank's barrel, whichever side it is on. The two
tanks aim in opposite directions, so the key has to mean "raise" rather than a
fixed direction of rotation, or it would be inverted for player 2.

1. **Read the wind** at the top of the screen. It changes every turn and is the only thing the two numbers don't tell you.
2. **Set an angle and a power**, then fire. The shell arcs under gravity, drifts with the wind, and explodes on whatever it meets first.
3. **Watch where it landed.** A miss still craters the hill, which changes what is possible next turn — including for you.
4. A near miss hurts; a direct hit hurts considerably more. First tank to zero loses.

Shells that fly off the left or right edge are simply gone, and the turn passes. Going off the **top** is fine — lobbing a shell high over the ridge is a legitimate way to reach someone dug in on the far side.

## Notes on the physics

Gravity, wind and muzzle speed are the three constants at the top of `game.js`, and they interact more than you would expect. Wind in particular is tuned to about an eighth of gravity at full strength: enough that a long shot needs a correction of roughly fifty pixels, but not enough to make aiming guesswork. An earlier build had it accelerating the shell sideways *harder* than gravity pulled it down, and the game was unplayable — a point-blank shot drifted forty pixels off target.

Each frame is stepped four times for collision, so a fast shell cannot tunnel through a thin ridge or past a tank.

## Files

- [`index.html`](index.html) — page structure, health tracks and the dash
- [`style.css`](style.css) — layout and the painted-steel theme
- [`game.js`](game.js) — terrain, ballistics, turns, damage and rendering

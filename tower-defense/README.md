# Castle Defense

A minimal 2D tower defense prototype with a pixelated medieval theme, built with plain HTML5 Canvas and vanilla JavaScript — no frameworks, no build step, no dependencies. The whole scene is rendered at a fraction of its resolution and scaled back up unsmoothed for a chunky pixel-art look, and each tower is a distinct castle turret.

## Setup

There's nothing to install. Just open `index.html` in a browser:

- **Windows**: double-click `index.html`, or right-click → Open with → your browser.
- **Or from a terminal**:

  ```bash
  start index.html      # Windows
  open index.html        # macOS
  xdg-open index.html    # Linux
  ```

That's it — the game runs entirely client-side.

## How to play

1. Select a tower from the sidebar (**Archer Tower**, **Cannon Bastion**, **Mage Tower**, or **Gold Mine**).
2. Click an open grid cell to garrison it (can't build on the enemy path or on top of another tower).
3. Click **Start Wave** to send raiders down the road toward your gate. There are 100 waves, and every 10th (10, 20, 30…) ends with a tough boss — regular mobs also carry 200% more health than the base amount, and both get harder every wave.
4. Earn gold for each raider (or boss) defeated, spend it on more towers.
5. Lose a life for every raider that reaches your castle gate. Run out of lives and it's game over — the overlay shows the wave you reached. Survive and defeat the boss on wave 100 to win.
6. Click a tower you've already placed to select it and upgrade it — combat towers get **Damage**, **Fire Speed**, and **Range**; the Gold Mine gets **Income**. Each stat has 3 levels, with rising gold costs.

| Tower | Cost | Style |
|---|---|---|
| Archer Tower | 50g | Fast fire rate, low damage, short range |
| Cannon Bastion | 100g | Slow, high damage, small splash radius |
| Mage Tower | 150g | Long range, high damage, slow fire rate |
| Gold Mine | 80g | No attack — passively generates 5g every 3s |

## Files

- [`index.html`](index.html) — page structure and sidebar UI
- [`style.css`](style.css) — layout and styling
- [`game.js`](game.js) — game loop, map, towers, enemies, waves, and rendering

# S & A Games

Three browser games in one repo. None has a build step, a package manager, or a
single dependency — every game is plain HTML, CSS and JavaScript, and runs by
opening a file.

| Game | What it is |
|---|---|
| [**Gravity Golf**](gravity-golf/) | Slingshot mini-golf played through real gravity. Planets pull, suns burn, repulsors push. 9 hand-made holes in three sections. |
| [**Castle Defense**](tower-defense/) | Pixel-art tower defense. Four upgradable turret types, a boss every tenth wave, 100 waves to survive. |
| [**Pentakeover**](pentakeover/) | Turn-based territory conquest. Five unit types, five factions, five citadels on a procedural map. Computer opponents or hotseat. |

Each game has its own README with full instructions:
[Gravity Golf](gravity-golf/README.md) · [Castle Defense](tower-defense/README.md) ·
[Pentakeover](pentakeover/README.md).

## Playing

Open either game's `index.html` in a browser — double-click it, or:

```sh
start gravity-golf/index.html    # Windows
open  gravity-golf/index.html    # macOS
xdg-open gravity-golf/index.html # Linux
```

To serve every game from one place, the way GitHub Pages does, run a static
server at the repo root and use the landing page:

```sh
npx serve .    # then open the printed URL
```

Serving over HTTP is also the more reliable way to play Gravity Golf, since some
browsers refuse `localStorage` to `file://` pages and its saved progress depends
on it. See [its README](gravity-golf/README.md) for the details.

## Layout

```
.
├─ index.html         landing page linking to every game
├─ gravity-golf/      Gravity Golf, self-contained
├─ tower-defense/     Castle Defense, self-contained
└─ pentakeover/       Pentakeover, self-contained
```

Each game owns its folder completely and shares no code with the others. That is
deliberate: they all happen to draw to a canvas and track a score, but they are
free to diverge, and a shared helper only earns its place once the same thing has
actually been written twice.

The repo root holds the config the games share:

- **`.gitattributes`** pins every text file to LF in the repository and on
  checkout, so the tree looks identical on Windows, macOS and Linux.
- **`.gitignore`** covers every game folder at any depth.

## Working on it

Gravity Golf's and Castle Defense's full histories are preserved here. Gravity Golf's is the trunk;
Castle Defense's was grafted in with `git subtree`, every commit keeping its
original author.

One wrinkle worth knowing: `git subtree` grafts the imported tree under a new
prefix, but the imported commits still refer to the paths they had in their own
repo (`game.js`, not `tower-defense/game.js`). So a path-filtered log does *not*
reach Castle Defense's pre-merge commits:

```sh
git log --oneline -- tower-defense/       # only changes made since the merge
git log --oneline castle-defense-import   # its 7 original commits
```

The `castle-defense-import` tag marks that history as it stood when it came in.

Changes land on a branch and go in through a pull request.

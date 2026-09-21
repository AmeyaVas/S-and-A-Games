# S & A Games

Three self-contained browser games: Gravity Golf, Castle Defense, Pentakeover.
[README.md](README.md) covers what they are and how to play them. This file
covers how to work on them.

## Hard constraints

- **No build step, no package manager, no dependencies.** Every game is plain
  HTML, CSS and JavaScript that runs by opening a file. Do not add a bundler, a
  `package.json`, or a runtime dependency — write more vanilla JS instead.
- **The games share no code.** Each folder owns itself completely. They all
  happen to draw to a canvas and track a score, but they are meant to be free to
  diverge, and a shared helper only earns its place once the same thing has
  actually been written twice.
- **LF line endings.** `.gitattributes` pins every text file to LF in the
  repository and on checkout, so the tree is identical on Windows, macOS and
  Linux. Don't reintroduce CRLF.

## Running it

Serve from the repo root rather than opening `file://` directly — Gravity Golf's
saved progress depends on `localStorage`, which some browsers refuse to
`file://` pages. Serving the root also makes `/` the landing page and each game
`/<game>/`, matching GitHub Pages.

Two preview configurations in `.claude/launch.json`:

| Name | Command | When |
|---|---|---|
| `s-and-a-games` | `python -m http.server 8777` | local development |
| `s-and-a-games-node` | `node .claude/serve.js . 4173` | anywhere bare `python` may not resolve, including cloud sessions |

Prefer `s-and-a-games-node` when you are not on the usual Windows machine.

## Git

- Changes land on a branch and go in through a pull request. Never commit
  directly to `main` — with one exception.
- **Small visual changes may go straight to `main`.** A CSS-only tweak to
  colour, spacing, size, a label's wording, or similar polish, that cannot
  change how anything behaves. Anything touching logic, data, config, build or
  deployment takes the branch-and-PR route however small the diff looks. If you
  are unsure which side of the line a change falls on, ask me rather than
  deciding for yourself. With nobody there to answer, open the PR.
- Castle Defense's history was grafted in with `git subtree`, so its pre-merge
  commits still refer to the paths they had in their own repo (`game.js`, not
  `tower-defense/game.js`). A path-filtered log does not reach them:

  ```sh
  git log --oneline -- tower-defense/       # only changes since the merge
  git log --oneline castle-defense-import   # its 7 original commits
  ```

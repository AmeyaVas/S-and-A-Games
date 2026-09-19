/* Pentakeover — procedural map generation.
 *
 * The continent is a convex blob. Regions are Voronoi cells clipped out of it
 * by half-planes, which keeps every cell convex and makes adjacency exact:
 * each polygon edge remembers which site's bisector cut it.
 */

const MAP_W = 1040;
const MAP_H = 720;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- geometry ---------- */

function polyArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

function polyCentroid(p) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    const f = p[i].x * q.y - q.x * p[i].y;
    cx += (p[i].x + q.x) * f;
    cy += (p[i].y + q.y) * f;
    a += f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { x: p[0].x, y: p[0].y };
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function convexHull(pts) {
  const s = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function pointInConvex(poly, x, y) {
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/* Clip a tagged polygon to the half-plane { p : dot(p - m, n) <= 0 }.
 * Every edge created by the cut is tagged with `tag`, so the finished cell
 * knows exactly which neighbour each of its edges borders. */
function clipHalfPlane(poly, mx, my, nx, ny, tag) {
  const out = [];
  const side = p => (p.x - mx) * nx + (p.y - my) * ny;
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % n];
    const dc = side(cur), dn = side(nxt);
    const curIn = dc <= 0, nxtIn = dn <= 0;
    if (curIn) {
      out.push(cur);
      if (!nxtIn) {
        const t = dc / (dc - dn);
        out.push({ x: cur.x + (nxt.x - cur.x) * t, y: cur.y + (nxt.y - cur.y) * t, tag });
      }
    } else if (nxtIn) {
      const t = dc / (dc - dn);
      out.push({ x: cur.x + (nxt.x - cur.x) * t, y: cur.y + (nxt.y - cur.y) * t, tag: cur.tag });
    }
  }
  return out;
}

function voronoiCell(sites, i, bounds) {
  let cell = bounds.map(p => ({ x: p.x, y: p.y, tag: -1 }));
  const a = sites[i];
  for (let j = 0; j < sites.length && cell.length >= 3; j++) {
    if (j === i) continue;
    const b = sites[j];
    const nx = b.x - a.x, ny = b.y - a.y;
    cell = clipHalfPlane(cell, (a.x + b.x) / 2, (a.y + b.y) / 2, nx, ny, j);
  }
  return cell;
}

/* ---------- terrain noise ---------- */

function makeNoise(rng) {
  const size = 8;
  const grid = [];
  for (let y = 0; y <= size; y++) {
    grid[y] = [];
    for (let x = 0; x <= size; x++) grid[y][x] = rng();
  }
  const fade = t => t * t * (3 - 2 * t);
  return function (px, py) {
    const gx = Math.min(Math.max(px, 0) / MAP_W, 0.9999) * size;
    const gy = Math.min(Math.max(py, 0) / MAP_H, 0.9999) * size;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = fade(gx - x0), ty = fade(gy - y0);
    const a = grid[y0][x0], b = grid[y0][x0 + 1];
    const c = grid[y0 + 1][x0], d = grid[y0 + 1][x0 + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/* ---------- map assembly ---------- */

function generateMap(opts) {
  const rng = mulberry32(opts.seed);
  const count = opts.regions;

  // A convex, slightly ragged continent so the map is not a rectangle.
  const outlinePts = [];
  const lobes = 12;
  for (let i = 0; i < lobes; i++) {
    const ang = (i / lobes) * Math.PI * 2;
    const r = 0.80 + rng() * 0.20;
    outlinePts.push({
      x: MAP_W / 2 + Math.cos(ang) * (MAP_W / 2 - 18) * r,
      y: MAP_H / 2 + Math.sin(ang) * (MAP_H / 2 - 18) * r
    });
  }
  const bounds = convexHull(outlinePts);

  // Scatter sites inside the continent, then relax them so the cells come out
  // evenly sized instead of a mess of slivers.
  const sites = [];
  let guard = 0;
  while (sites.length < count && guard++ < count * 400) {
    const x = rng() * MAP_W, y = rng() * MAP_H;
    if (pointInConvex(bounds, x, y)) sites.push({ x, y });
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < sites.length; i++) {
      const cell = voronoiCell(sites, i, bounds);
      if (cell.length >= 3) {
        const c = polyCentroid(cell);
        sites[i].x += (c.x - sites[i].x) * 0.9;
        sites[i].y += (c.y - sites[i].y) * 0.9;
      }
    }
  }

  const noise = makeNoise(rng);
  const regions = sites.map((s, i) => {
    const cell = voronoiCell(sites, i, bounds);
    const centroid = polyCentroid(cell);
    const n = noise(centroid.x, centroid.y) * 0.7 + noise(centroid.y * 1.7, centroid.x * 1.3) * 0.3;
    let terrain = 'plains';
    if (n > 0.66) terrain = 'mountains';
    else if (n > 0.54) terrain = 'hills';
    else if (n > 0.40) terrain = 'forest';
    return {
      id: i,
      poly: cell,
      site: s,
      centroid,
      area: Math.abs(polyArea(cell)),
      neighbors: [],
      terrain,
      kind: 'normal',
      owner: null,
      units: []
    };
  });

  // Adjacency straight off the edge tags — no tolerance guessing.
  for (const r of regions) {
    const seen = new Set();
    for (let i = 0, n = r.poly.length; i < n; i++) {
      const a = r.poly[i], b = r.poly[(i + 1) % n];
      if (a.tag < 0) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;   // a corner touch is not a border
      seen.add(a.tag);
    }
    r.neighbors = [...seen];
  }
  // A border one side recorded and the other did not is still a border.
  for (const r of regions) {
    for (const nId of r.neighbors) {
      if (!regions[nId].neighbors.includes(r.id)) regions[nId].neighbors.push(r.id);
    }
  }

  // Stitch up anything the clipping left stranded.
  for (const r of regions) {
    if (r.neighbors.length > 0) continue;
    let best = -1, bestD = Infinity;
    for (const o of regions) {
      if (o.id === r.id) continue;
      const d = Math.hypot(o.centroid.x - r.centroid.x, o.centroid.y - r.centroid.y);
      if (d < bestD) { bestD = d; best = o.id; }
    }
    if (best >= 0) { r.neighbors.push(best); regions[best].neighbors.push(r.id); }
  }

  connectIslands(regions);
  assignGridRefs(regions);
  return { regions, bounds };
}

/* Map references, the way a chart labels ground: a letter for the north-south
 * band you are in, a number for how far down that band you sit. Neighbouring
 * regions get neighbouring references, so a dispatch about D3 tells you roughly
 * where the fighting is before you go looking for it.
 *
 * Numbering within a band rather than across a fixed row grid is what keeps
 * every reference unique — two regions can share a band, but never a place in
 * its running order. I and O are skipped, as charts skip them, so the letter is
 * never mistaken for a 1 or a 0. */
function assignGridRefs(regions) {
  if (regions.length === 0) return;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  // Bands sized so a typical map comes out roughly square in the hand: about as
  // many bands across as there are regions deep in each one.
  const cols = Math.max(2, Math.min(LETTERS.length,
    Math.round(Math.sqrt((regions.length * MAP_W) / MAP_H))));

  let minX = Infinity, maxX = -Infinity;
  for (const r of regions) {
    if (r.centroid.x < minX) minX = r.centroid.x;
    if (r.centroid.x > maxX) maxX = r.centroid.x;
  }
  const span = Math.max(maxX - minX, 1e-6);

  const bands = Array.from({ length: cols }, () => []);
  for (const r of regions) {
    const t = (r.centroid.x - minX) / span;
    bands[Math.min(cols - 1, Math.floor(t * cols))].push(r);
  }

  bands.forEach((band, i) => {
    band.sort((a, b) => a.centroid.y - b.centroid.y || a.id - b.id);
    band.forEach((r, j) => { r.grid = LETTERS[i] + (j + 1); });
  });
}

/* The continent must be one connected landmass, or a faction can be walled
 * off from the war entirely. Bridge any stray component to the mainland. */
function connectIslands(regions) {
  const comp = new Array(regions.length).fill(-1);
  let groups = 0;
  for (const r of regions) {
    if (comp[r.id] !== -1) continue;
    const stack = [r.id];
    comp[r.id] = groups;
    while (stack.length) {
      const cur = stack.pop();
      for (const n of regions[cur].neighbors) {
        if (comp[n] === -1) { comp[n] = groups; stack.push(n); }
      }
    }
    groups++;
  }
  if (groups <= 1) return;

  const sizes = new Array(groups).fill(0);
  for (const c of comp) sizes[c]++;
  const main = sizes.indexOf(Math.max(...sizes));

  for (let g = 0; g < groups; g++) {
    if (g === main) continue;
    let a = -1, b = -1, bestD = Infinity;
    for (const r of regions) {
      if (comp[r.id] !== g) continue;
      for (const o of regions) {
        if (comp[o.id] !== main) continue;
        const d = Math.hypot(o.centroid.x - r.centroid.x, o.centroid.y - r.centroid.y);
        if (d < bestD) { bestD = d; a = r.id; b = o.id; }
      }
    }
    if (a >= 0) {
      regions[a].neighbors.push(b);
      regions[b].neighbors.push(a);
      for (let i = 0; i < comp.length; i++) if (comp[i] === g) comp[i] = main;
    }
  }
}

/* Greedy farthest-point picks, so capitals and citadels never bunch up. */
function spreadPick(regions, n, anchorsIn, filter) {
  const anchors = anchorsIn.slice();
  const taken = new Set(anchors.map(r => r.id));
  const pool = regions.filter(r => !taken.has(r.id) && (!filter || filter(r)));
  const chosen = [];
  while (chosen.length < n && pool.length > 0) {
    let best = null, bestScore = -Infinity;
    for (const r of pool) {
      const score = anchors.length === 0
        // First pick: something central, so the map does not start lopsided.
        ? -Math.hypot(r.centroid.x - MAP_W / 2, r.centroid.y - MAP_H / 2)
        : Math.min.apply(null, anchors.map(a =>
            Math.hypot(a.centroid.x - r.centroid.x, a.centroid.y - r.centroid.y)));
      if (score > bestScore) { bestScore = score; best = r; }
    }
    chosen.push(best);
    anchors.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return chosen;
}

if (typeof module !== 'undefined') {
  module.exports = { generateMap, spreadPick, mulberry32, assignGridRefs, MAP_W, MAP_H };
}

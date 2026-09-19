/* Pentakeover — canvas rendering.
 *
 * Draws the continent, then paints ownership on top of terrain. Borders carry
 * most of the information: a frontier with someone else is bright and thick,
 * an internal border is a hairline, so the shape of every empire reads at a
 * glance without needing labels.
 */

const Renderer = (function () {
  let canvas, ctx, dpr = 1;
  let scale = 1, offX = 0, offY = 0;
  let pulse = 0;

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    scale = Math.min(rect.width / MAP_W, rect.height / MAP_H);
    offX = (rect.width - MAP_W * scale) / 2;
    offY = (rect.height - MAP_H * scale) / 2;
  }

  function screenToMap(px, py) {
    const rect = canvas.getBoundingClientRect();
    return { x: (px - rect.left - offX) / scale, y: (py - rect.top - offY) / scale };
  }

  function regionAt(state, px, py) {
    const p = screenToMap(px, py);
    for (const r of state.regions) if (pointInConvex(r.poly, p.x, p.y)) return r;
    return null;
  }

  /* ---------- colour helpers ---------- */

  function hex2rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function rgba(h, a) {
    const c = hex2rgb(h);
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  function regionFill(state, r) {
    const base = TERRAIN[r.terrain].color;
    if (r.owner === null) return mix(base, '#0f1318', 0.34);
    return mix(base, state.factions[r.owner].color, 0.52);
  }

  /* ---------- drawing ---------- */

  function tracePoly(poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  function draw(state, view) {
    if (!ctx) return;
    pulse = (pulse + 0.05) % (Math.PI * 2);
    const glow = 0.5 + 0.5 * Math.sin(pulse);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0d11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    // Sea shelf around the landmass.
    ctx.save();
    tracePoly(state.bounds);
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 38;
    ctx.fillStyle = '#12181f';
    ctx.fill();
    ctx.restore();

    for (const r of state.regions) {
      tracePoly(r.poly);
      ctx.fillStyle = regionFill(state, r);
      ctx.fill();
      drawTerrain(r);
    }

    // Borders, drawn per edge so frontiers can look different from seams.
    for (const r of state.regions) {
      for (let i = 0, n = r.poly.length; i < n; i++) {
        const a = r.poly[i], b = r.poly[(i + 1) % n];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (a.tag < 0) {
          ctx.strokeStyle = 'rgba(150,190,220,0.30)';
          ctx.lineWidth = 2.4;
        } else if (state.regions[a.tag].owner !== r.owner) {
          ctx.strokeStyle = r.owner === null ? 'rgba(20,24,30,0.75)' : rgba(state.factions[r.owner].color, 0.95);
          ctx.lineWidth = 2.6;
        } else {
          ctx.strokeStyle = 'rgba(12,16,20,0.40)';
          ctx.lineWidth = 0.9;
        }
        ctx.stroke();
      }
    }

    // Highlights.
    if (view.targets && view.targets.size) {
      for (const id of view.targets) {
        const r = state.regions[id];
        tracePoly(r.poly);
        ctx.strokeStyle = view.targetTone === 'attack'
          ? `rgba(255,120,96,${0.55 + glow * 0.45})`
          : `rgba(120,230,190,${0.5 + glow * 0.4})`;
        ctx.lineWidth = 3.4;
        ctx.stroke();
        ctx.fillStyle = view.targetTone === 'attack'
          ? `rgba(255,120,96,${0.07 + glow * 0.07})`
          : `rgba(120,230,190,${0.06 + glow * 0.06})`;
        ctx.fill();
      }
    }

    if (view.hover != null) {
      tracePoly(state.regions[view.hover].poly);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (view.selected != null) {
      const r = state.regions[view.selected];
      tracePoly(r.poly);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }

    for (const r of state.regions) drawMarker(state, r, glow);
    for (const r of state.regions) drawGarrison(state, r, view);

    if (view.hover != null) drawName(state, state.regions[view.hover]);
    else if (view.selected != null) drawName(state, state.regions[view.selected]);

    ctx.restore();
  }

  function drawTerrain(r) {
    const c = r.centroid;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#0b0e12';
    ctx.lineWidth = 1.6;
    const spread = Math.min(26, Math.sqrt(r.area) * 0.18);
    if (r.terrain === 'mountains' || r.terrain === 'hills') {
      const peaks = r.terrain === 'mountains' ? 3 : 2;
      const h = r.terrain === 'mountains' ? 9 : 5;
      for (let i = 0; i < peaks; i++) {
        const x = c.x + (i - (peaks - 1) / 2) * spread * 0.8;
        const y = c.y + 20;
        ctx.beginPath();
        ctx.moveTo(x - 7, y);
        ctx.lineTo(x, y - h);
        ctx.lineTo(x + 7, y);
        ctx.stroke();
      }
    } else if (r.terrain === 'forest') {
      for (let i = 0; i < 3; i++) {
        const x = c.x + (i - 1) * spread * 0.7;
        const y = c.y + 20;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 4);
        ctx.moveTo(x - 4, y - 4);
        ctx.lineTo(x, y - 10);
        ctx.lineTo(x + 4, y - 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMarker(state, r, glow) {
    if (r.kind === 'normal') return;
    const c = r.centroid;
    const y = c.y - 19;
    ctx.save();
    if (r.kind === 'citadel') {
      const held = r.owner !== null;
      ctx.translate(c.x, y);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? 10 : 4.4;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = held ? '#ffd76a' : `rgba(255,215,106,${0.55 + glow * 0.45})`;
      ctx.shadowColor = 'rgba(255,200,80,0.9)';
      ctx.shadowBlur = held ? 10 : 6 + glow * 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(40,28,0,0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.translate(c.x, y);
      ctx.beginPath();
      ctx.moveTo(-9, 5);
      ctx.lineTo(-9, -3);
      ctx.lineTo(-5, 1); ctx.lineTo(-2, -5); ctx.lineTo(2, 1);
      ctx.lineTo(5, -5); ctx.lineTo(9, 1); ctx.lineTo(9, 5);
      ctx.closePath();
      ctx.fillStyle = r.owner === null ? '#c9d2dc' : state.factions[r.owner].ink;
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,18,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGarrison(state, r, view) {
    if (r.units.length === 0) return;
    const counts = new Map();
    for (const u of r.units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const types = UNIT_ORDER.filter(t => counts.has(t));

    const chipW = 21, chipH = 16, gap = 3;
    const perRow = Math.min(types.length, 3);
    const rows = Math.ceil(types.length / 3);
    const startY = r.centroid.y + 2 - ((rows - 1) * (chipH + gap)) / 2;
    const owner = r.owner === null ? NEUTRAL : state.factions[r.owner];

    types.forEach((t, i) => {
      const row = Math.floor(i / 3);
      const inRow = row === rows - 1 ? types.length - row * 3 : 3;
      const idx = i - row * 3;
      const rowW = inRow * chipW + (inRow - 1) * gap;
      const x = r.centroid.x - rowW / 2 + idx * (chipW + gap);
      const y = startY + row * (chipH + gap);

      ctx.save();
      roundRect(x, y - chipH / 2, chipW, chipH, 4);
      ctx.fillStyle = 'rgba(8,11,15,0.82)';
      ctx.fill();
      ctx.strokeStyle = rgba(owner.color, 0.9);
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.fillStyle = owner.ink;
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${UNITS[t].glyph}${counts.get(t)}`, x + chipW / 2, y + 0.5);
      ctx.restore();
    });

    // Health of the whole stack, so a battered garrison looks battered.
    const hp = totalHp(r.units);
    const max = r.units.reduce((s, u) => s + u.maxHp, 0);
    if (hp < max - 0.01) {
      const w = 34, y = startY + (rows - 1) * (chipH + gap) + chipH / 2 + 4;
      ctx.fillStyle = 'rgba(8,11,15,0.8)';
      roundRect(r.centroid.x - w / 2, y, w, 3.5, 2); ctx.fill();
      ctx.fillStyle = hp / max > 0.5 ? '#6fd98a' : hp / max > 0.25 ? '#e8c35a' : '#e86a5a';
      roundRect(r.centroid.x - w / 2, y, w * (hp / max), 3.5, 2); ctx.fill();
    }

    // Ring the units the player has picked up.
    if (view.selected === r.id && view.selectedUnits && view.selectedUnits.size) {
      const n = view.selectedUnits.size;
      ctx.beginPath();
      ctx.arc(r.centroid.x, r.centroid.y, 30, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${n} picked`, r.centroid.x, r.centroid.y - 34);
    }
  }

  function drawName(state, r) {
    const text = regionLabel(r);
    const sub = `${TERRAIN[r.terrain].name} · ${factionName(state, r.owner)}`;
    ctx.save();
    ctx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif';
    const w = Math.max(ctx.measureText(text).width, ctx.measureText(sub).width * 0.86) + 18;
    const x = Math.max(6, Math.min(MAP_W - w - 6, r.centroid.x - w / 2));
    const y = r.centroid.y - 56;
    roundRect(x, y, w, 36, 6);
    ctx.fillStyle = 'rgba(8,11,15,0.9)';
    ctx.fill();
    ctx.strokeStyle = rgba(factionColor(state, r.owner), 0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#eef2f6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + 12);
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,230,240,0.72)';
    ctx.fillText(sub, x + w / 2, y + 26);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { init, resize, draw, regionAt, screenToMap };
})();

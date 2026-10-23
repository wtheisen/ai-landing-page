// "Try it: drag the points" — a linear soft-margin SVM (SMO) re-solved while you drag.
// Same data, colours and marks as the street figure: +1 blue circles, -1 gold triangles,
// boundary and street purple, support vectors (alpha > 0) ringed red.
(function () {
const NS = 'http://www.w3.org/2000/svg';
function street(root) {
  if (root._live) return; root._live = true;
  let svg = root.querySelector('svg.live');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'live web-only'); svg.setAttribute('viewBox', '0 0 384 252'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Interactive street: drag the points and the SVM is re-solved');
    const bar = document.createElement('div'); bar.className = 'live-bar web-only';
    bar.innerHTML = '<span>Drag the points. Ringed points are the current support vectors.</span><button type="button" class="btn" data-reset>Reset</button>';
    root.prepend(svg, bar);
  }
  root.classList.add('live-on');
  const W = 384, H = 252, S = 60, CX = 192, CY = 126;     // pixel <-> data: u = (px - CX) / S, v = (CY - py) / S
  const START = [
    [189.2, 38.2, 1], [228.4, 118.5, 1], [245, 74.8, 1], [228.4, 45.3, 1], [213.5, 74.8, 1], [277.9, 154.9, 1], [268.2, 109, 1],
    [109, 166, -1], [151.5, 186, -1], [91.2, 152, -1], [109, 121.5, -1], [162.2, 227, -1], [135.7, 212, -1], [104.6, 203.5, -1], [117.9, 234.5, -1]];
  let pts = START.map(p => p.slice());
  const C = 50;

  function solve() {   // simplified SMO for a linear kernel
    const n = pts.length, X = pts.map(p => [(p[0] - CX) / S, (CY - p[1]) / S]), Y = pts.map(p => p[2]);
    const K = (i, j) => X[i][0] * X[j][0] + X[i][1] * X[j][1];
    const a = new Array(n).fill(0); let b = 0;
    const f = i => { let s = b; for (let k = 0; k < n; k++) if (a[k]) s += a[k] * Y[k] * K(k, i); return s; };
    let passes = 0, iter = 0;
    while (passes < 3 && iter < 2000) {
      let changed = 0; iter++;
      for (let i = 0; i < n; i++) {
        const Ei = f(i) - Y[i];
        if (!((Y[i] * Ei < -1e-4 && a[i] < C) || (Y[i] * Ei > 1e-4 && a[i] > 0))) continue;
        const order = [...Array(n).keys()].filter(k => k !== i)
          .map(k => [Math.abs(Ei - (f(k) - Y[k])), k]).sort((p, q) => q[0] - p[0]).map(p => p[1]);
        for (const j of order) {   // try partners, best first, until one makes progress
          const Ej = f(j) - Y[j], ai = a[i], aj = a[j];
          const L = Y[i] !== Y[j] ? Math.max(0, aj - ai) : Math.max(0, ai + aj - C);
          const Hh = Y[i] !== Y[j] ? Math.min(C, C + aj - ai) : Math.min(C, ai + aj);
          const eta = 2 * K(i, j) - K(i, i) - K(j, j);
          if (L === Hh || eta >= 0) continue;
          a[j] = Math.min(Hh, Math.max(L, aj - Y[j] * (Ei - Ej) / eta));
          if (Math.abs(a[j] - aj) < 1e-7) { a[j] = aj; continue; }
          a[i] = ai + Y[i] * Y[j] * (aj - a[j]);
          const b1 = b - Ei - Y[i] * (a[i] - ai) * K(i, i) - Y[j] * (a[j] - aj) * K(i, j);
          const b2 = b - Ej - Y[i] * (a[i] - ai) * K(i, j) - Y[j] * (a[j] - aj) * K(j, j);
          b = (a[i] > 0 && a[i] < C) ? b1 : (a[j] > 0 && a[j] < C) ? b2 : (b1 + b2) / 2;
          changed++;
          break;
        }
      }
      passes = changed ? 0 : passes + 1;
    }
    const w = [0, 0];
    for (let k = 0; k < n; k++) { w[0] += a[k] * Y[k] * X[k][0]; w[1] += a[k] * Y[k] * X[k][1]; }
    return { w, b, a };
  }

  // clip the rectangle [0,W]x[0,H] (pixels) to the half-plane s * (score - c) >= 0
  const score = (m, px, py) => m.w[0] * (px - CX) / S + m.w[1] * (CY - py) / S + m.b;
  function clip(poly, m, c, s) {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const P = poly[k], Q = poly[(k + 1) % poly.length];
      const fp = s * (score(m, ...P) - c), fq = s * (score(m, ...Q) - c);
      if (fp >= 0) out.push(P);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return out;
  }
  function segment(m, c) {   // the line score = c, clipped to the canvas
    const R = [[0, 0], [W, 0], [W, H], [0, H]], hits = [];
    for (let k = 0; k < 4; k++) {
      const P = R[k], Q = R[(k + 1) % 4], fp = score(m, ...P) - c, fq = score(m, ...Q) - c;
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); hits.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return hits.length >= 2 ? hits.slice(0, 2) : null;
  }
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  function draw() {
    const m = solve();
    svg.replaceChildren();
    const street = clip(clip([[0, 0], [W, 0], [W, H], [0, H]], m, -1, 1), m, 1, -1);
    if (street.length > 2) svg.append(el('polygon', { points: street.map(p => p.join(',')).join(' '), fill: '#D9D2E9', 'fill-opacity': 0.75 }));
    for (const [c, dash, wd] of [[-1, '4.5 3', 1.5], [1, '4.5 3', 1.5], [0, null, 3]]) {
      const s = segment(m, c); if (!s) continue;
      const ln = el('line', { x1: s[0][0], y1: s[0][1], x2: s[1][0], y2: s[1][1], stroke: c ? '#8E7CC3' : '#674EA7', 'stroke-width': wd });
      if (dash) ln.setAttribute('stroke-dasharray', dash);
      svg.append(ln);
    }
    pts.forEach((p, i) => {
      const g = el('g', { class: 'pt', 'data-i': i, tabindex: 0, role: 'button', 'aria-label': (p[2] > 0 ? 'class +1' : 'class -1') + ' point' + (m.a[i] > 1e-5 ? ', support vector' : '') });
      if (p[2] > 0) g.append(el('circle', { cx: p[0], cy: p[1], r: 10.2, fill: '#1155CC' }));
      else g.append(el('polygon', { points: `${p[0]},${p[1] - 11.7} ${p[0] + 10.2},${p[1] + 5.9} ${p[0] - 10.2},${p[1] + 5.9}`, fill: '#DCB439' }));
      if (m.a[i] > 1e-5) g.append(el('circle', { cx: p[0], cy: p[1], r: 15, fill: 'none', stroke: '#CC0000', 'stroke-width': 1.5 }));
      g.append(el('circle', { cx: p[0], cy: p[1], r: 16, fill: 'transparent' }));
      svg.append(g);
    });
  }

  let drag = -1;
  const toSvg = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  svg.addEventListener('pointerdown', e => { const g = e.target.closest('.pt'); if (!g) return; drag = +g.dataset.i; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => { if (drag < 0) return; const [x, y] = toSvg(e); pts[drag][0] = Math.max(8, Math.min(W - 8, x)); pts[drag][1] = Math.max(8, Math.min(H - 8, y)); draw(); });
  const end = () => { if (drag >= 0) { drag = -1; } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', e => {   // arrow keys move a focused point
    const g = e.target.closest('.pt'); if (!g) return;
    const d = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key]; if (!d) return;
    e.preventDefault(); const i = +g.dataset.i; pts[i][0] += d[0]; pts[i][1] += d[1]; draw();
    const again = svg.querySelector(`.pt[data-i="${i}"]`); if (again) again.focus();
  });
  root.querySelector('[data-reset]').addEventListener('click', () => { pts = START.map(p => p.slice()); draw(); });
  draw();
}

window.BookLive = { street };
// static pages (no runtime): start any live figure already in the document
document.querySelectorAll('b-fig[live]').forEach(f => { const k = f.getAttribute('live'); if (window.BookLive[k] && f.querySelector('svg') && !window.Book) window.BookLive[k](f); });
})();

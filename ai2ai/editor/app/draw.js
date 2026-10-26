// Drawing tools for the Book Editor: rectangles, ellipses, triangles, polygons, lines, arrows, curves and labels as
// plain SVG. A shape lives either in a drawing block (<svg class="draw"> in the text flow) or in the page's overlay
// (<svg class="draw overlay" viewBox="0 0 432 648">, on top of the text). Shapes are ordinary SVG elements, one per
// line in chapter.html; everything editor-only (handles, guides, the label box) is drawn in #overlay, never in the SVG.
//   rotation      transform="rotate(deg cx cy)" about the shape's own centre (polygons are rotated point by point)
//   connectors    a line or curve with data-a / data-b = the id of the shape that end is attached to
//   groups        <g> … </g>          locked shapes   data-lock="1" (not selectable by clicking; use the Layers list)
document.addEventListener('editor-ready', function () {
'use strict';
const E = window.Editor, NS = 'http://www.w3.org/2000/svg';
const $ = s => document.querySelector(s);
const book = $('#book'), desk = $('#desk'), hbox = $('#drawh'), gx = $('#gx'), gy = $('#gy');
const esc = Book.esc;
const r1 = v => +(+v).toFixed(1);
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };
const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
const f = v => parseFloat(v) || 0;

let tool = 'select', locked = false, shapes = [], layer = null, clip = null, ptMode = false, draft = null, editing = null;
const last = { fill: '#C9DAF8', stroke: '#1155CC', sw: 1.5 };   // style of the next new shape (follows what you last set)

// ---------------------------------------------------------------- geometry
const vbox = svg => { const v = svg.viewBox.baseVal; return v && v.width ? v : { x: 0, y: 0, width: svg.clientWidth || 384, height: svg.clientHeight || 200 }; };
function toSvg(svg, cx, cy) { const r = svg.getBoundingClientRect(), v = vbox(svg); return [v.x + (cx - r.left) * v.width / r.width, v.y + (cy - r.top) * v.height / r.height]; }
function toClient(svg, x, y) { const r = svg.getBoundingClientRect(), v = vbox(svg); return [r.left + (x - v.x) * r.width / v.width, r.top + (y - v.y) * r.height / v.height]; }
const unit = svg => svg.getBoundingClientRect().width / vbox(svg).width;   // screen px per drawing unit
const kids = svg => [...svg.children].filter(c => !/^(defs|title|desc|style|metadata)$/.test(c.localName));
const leaves = list => list.flatMap(s => s.localName === 'g' ? leaves([...s.children]) : [s]);
const parsePts = str => (str || '').trim().split(/[\s,]+/).map(Number).reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), []).filter(p => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));
const pts = el => parsePts(el.getAttribute('points'));
const ptStr = p => p.map(q => r1(q[0]) + ',' + r1(q[1])).join(' ');
const parseRot = t => { const m = /^\s*rotate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)\s*\)\s*$/.exec(t || ''); return m ? { a: +m[1], cx: +m[2], cy: +m[3] } : null; };
const rotOf = el => parseRot(el.getAttribute('transform'));
const qp = d => { const m = /^\s*M\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*Q\s*([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)\s*$/.exec(d || ''); return m ? m.slice(1).map(Number) : null; };
const qd = q => `M${r1(q[0])} ${r1(q[1])} Q${r1(q[2])} ${r1(q[3])} ${r1(q[4])} ${r1(q[5])}`;
const isCurve = el => el.localName === 'path' && !!qp(el.getAttribute('d'));
const GEO = /^(rect|ellipse|circle|line|polygon|polyline|text)$/;
// "plain": the element's own attributes say where it is (no transform, or only our rotate-about-centre)
const plain = el => (GEO.test(el.localName) || isCurve(el)) && (!el.getAttribute('transform') || (!!rotOf(el) && /^(rect|ellipse|text)$/.test(el.localName)));
const rotP = (x, y, r, sign) => { if (!r || !r.a) return [x, y]; const t = (sign || 1) * r.a * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [r.cx + (x - r.cx) * c - (y - r.cy) * s, r.cy + (x - r.cx) * s + (y - r.cy) * c]; };
function lbox(el) {   // the shape's own box, before any rotation
  const t = el.localName;
  if (t === 'rect') return { x0: num(el, 'x'), y0: num(el, 'y'), x1: num(el, 'x') + num(el, 'width'), y1: num(el, 'y') + num(el, 'height') };
  if (t === 'ellipse') return { x0: num(el, 'cx') - num(el, 'rx'), y0: num(el, 'cy') - num(el, 'ry'), x1: num(el, 'cx') + num(el, 'rx'), y1: num(el, 'cy') + num(el, 'ry') };
  if (t === 'circle') return { x0: num(el, 'cx') - num(el, 'r'), y0: num(el, 'cy') - num(el, 'r'), x1: num(el, 'cx') + num(el, 'r'), y1: num(el, 'cy') + num(el, 'r') };
  if (t === 'line') return { x0: Math.min(num(el, 'x1'), num(el, 'x2')), y0: Math.min(num(el, 'y1'), num(el, 'y2')), x1: Math.max(num(el, 'x1'), num(el, 'x2')), y1: Math.max(num(el, 'y1'), num(el, 'y2')) };
  if (t === 'polygon' || t === 'polyline') { const p = pts(el); if (p.length) return { x0: Math.min(...p.map(q => q[0])), y0: Math.min(...p.map(q => q[1])), x1: Math.max(...p.map(q => q[0])), y1: Math.max(...p.map(q => q[1])) }; }
  if (t === 'text') { try { const b = el.getBBox(); return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; } catch (e) { /* not rendered */ } }
  return box(el, true);
}
function box(el, screen) {   // bounding box on the canvas, in drawing units
  if (!screen && plain(el) && !el.getAttribute('transform') && !isCurve(el) && el.localName !== 'text') return lbox(el);
  const svg = el.ownerSVGElement, r = el.getBoundingClientRect(), a = toSvg(svg, r.left, r.top), b = toSvg(svg, r.right, r.bottom);
  return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
}
const union = list => list.map(s => box(s)).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
const ATTRS = ['x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'd'];
const snapshot = el => { const o = { tag: el.localName, tspans: [...el.querySelectorAll('tspan[x], tspan[y]')].map(t => [t, t.getAttribute('x'), t.getAttribute('y')]) }; for (const a of ATTRS) o[a] = el.getAttribute(a); o.rot = parseRot(o.transform); o.plain = plain(el); o.q = el.localName === 'path' ? qp(o.d) : null; return o; };
const setRot = (el, r) => { if (r && Math.abs(r.a) > 0.05 && Math.abs(r.a - 360) > 0.05) el.setAttribute('transform', `rotate(${r1(r.a)} ${r1(r.cx)} ${r1(r.cy)})`); else el.removeAttribute('transform'); };
function moveTo(el, o, dx, dy) {   // place el at its snapshot o shifted by (dx, dy)
  const t = el.localName, set = (a, v) => el.setAttribute(a, r1(v));
  if (!o.plain) {
    const m = /translate\(\s*([-\d.e]+)[ ,]*([-\d.e]+)?\s*\)/.exec(o.transform || ''), rest = (o.transform || '').replace(/translate\([^)]*\)\s*/, '');
    const tx = (m ? +m[1] : 0) + dx, ty = (m ? +(m[2] || 0) : 0) + dy;
    const s = (Math.abs(tx) > 0.04 || Math.abs(ty) > 0.04 ? `translate(${r1(tx)} ${r1(ty)}) ` : '') + rest;
    if (s.trim()) el.setAttribute('transform', s.trim()); else el.removeAttribute('transform');
    return;
  }
  if (t === 'rect' || t === 'text') { set('x', f(o.x) + dx); set('y', f(o.y) + dy); o.tspans.forEach(([n, x, y]) => { if (x != null) n.setAttribute('x', r1(f(x) + dx)); if (y != null) n.setAttribute('y', r1(f(y) + dy)); }); }
  else if (t === 'ellipse' || t === 'circle') { set('cx', f(o.cx) + dx); set('cy', f(o.cy) + dy); }
  else if (t === 'line') { set('x1', f(o.x1) + dx); set('y1', f(o.y1) + dy); set('x2', f(o.x2) + dx); set('y2', f(o.y2) + dy); }
  else if (o.q) el.setAttribute('d', qd(o.q.map((v, i) => v + (i % 2 ? dy : dx))));
  else el.setAttribute('points', ptStr(parsePts(o.points).map(q => [q[0] + dx, q[1] + dy])));
  if (o.rot) setRot(el, { a: o.rot.a, cx: o.rot.cx + dx, cy: o.rot.cy + dy });
}
function resizeTo(el, o, from, to) {   // map el's snapshot from its own box `from` onto box `to` (both before rotation)
  const t = el.localName, fw = from.x1 - from.x0 || 1, fh = from.y1 - from.y0 || 1;
  const mx = x => to.x0 + (x - from.x0) * (to.x1 - to.x0) / fw, my = y => to.y0 + (y - from.y0) * (to.y1 - to.y0) / fh;
  const set = (a, v) => el.setAttribute(a, r1(v));
  if (!o.plain || t === 'text') return moveTo(el, o, to.x0 - from.x0, to.y0 - from.y0);
  if (t === 'rect') { const a = mx(f(o.x)), b = mx(f(o.x) + f(o.width)), c = my(f(o.y)), d = my(f(o.y) + f(o.height)); set('x', Math.min(a, b)); set('y', Math.min(c, d)); set('width', Math.abs(b - a)); set('height', Math.abs(d - c)); }
  else if (t === 'ellipse') { set('cx', mx(f(o.cx))); set('cy', my(f(o.cy))); set('rx', Math.abs(f(o.rx) * (to.x1 - to.x0) / fw)); set('ry', Math.abs(f(o.ry) * (to.y1 - to.y0) / fh)); }
  else if (t === 'circle') { set('cx', mx(f(o.cx))); set('cy', my(f(o.cy))); set('r', Math.abs(f(o.r) * Math.min(Math.abs(to.x1 - to.x0) / fw, Math.abs(to.y1 - to.y0) / fh))); }
  else if (t === 'line') { set('x1', mx(f(o.x1))); set('y1', my(f(o.y1))); set('x2', mx(f(o.x2))); set('y2', my(f(o.y2))); }
  else if (o.q) el.setAttribute('d', qd(o.q.map((v, i) => i % 2 ? my(v) : mx(v))));
  else el.setAttribute('points', ptStr(parsePts(o.points).map(q => [mx(q[0]), my(q[1])])));
  if (o.rot) {   // keep every point where it was on the page: the new centre is the old rotation applied to the new box's centre
    const c = [(to.x0 + to.x1) / 2, (to.y0 + to.y1) / 2], w = rotP(c[0], c[1], o.rot);
    el.removeAttribute('transform'); const s = snapshot(el);
    moveTo(el, s, w[0] - c[0], w[1] - c[1]); setRot(el, { a: o.rot.a, cx: w[0], cy: w[1] });
  }
}
function rotateTo(el, o, deg) {   // absolute angle for rect/ellipse/text; polygons turn point by point from their snapshot
  const t = el.localName;
  if (t === 'polygon' || t === 'polyline') { const p = parsePts(o.points), cx = (Math.min(...p.map(q => q[0])) + Math.max(...p.map(q => q[0]))) / 2, cy = (Math.min(...p.map(q => q[1])) + Math.max(...p.map(q => q[1]))) / 2; el.setAttribute('points', ptStr(p.map(q => rotP(q[0], q[1], { a: deg, cx, cy })))); return; }
  if (!/^(rect|ellipse|text)$/.test(t)) return;
  const b = lbox(el);
  setRot(el, { a: ((deg % 360) + 360) % 360, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });
}
const endsOf = (tag, get) => tag === 'line' ? [[f(get('x1')), f(get('y1'))], [f(get('x2')), f(get('y2'))]] : (q => q ? [[q[0], q[1]], [q[4], q[5]]] : null)(tag === 'path' ? qp(get('d')) : null);
const ends = el => endsOf(el.localName, a => el.getAttribute(a));
function setEnd(el, i, x, y) {
  if (el.localName === 'line') { el.setAttribute(i ? 'x2' : 'x1', r1(x)); el.setAttribute(i ? 'y2' : 'y1', r1(y)); return; }
  const q = qp(el.getAttribute('d')); if (!q) return; q[i ? 4 : 0] = x; q[i ? 5 : 1] = y; el.setAttribute('d', qd(q));
}
const curvePt = (q, t) => [(1 - t) * (1 - t) * q[0] + 2 * t * (1 - t) * q[2] + t * t * q[4], (1 - t) * (1 - t) * q[1] + 2 * t * (1 - t) * q[3] + t * t * q[5]];
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
const nearPath = (p, cx, cy, d) => { for (let i = 0; i + 1 < p.length; i++) if (segDist(cx, cy, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= d) return true; return false; };
function hit(svg, cx, cy) {   // topmost shape under the pointer, with a few px of tolerance for thin lines and outlines
  const list = kids(svg), tol = 5;
  for (let k = list.length - 1; k >= 0; k--) {
    const el = list[k], t = el.localName, r = el.getBoundingClientRect();
    if (el.hasAttribute('data-lock') || cx < r.left - tol || cx > r.right + tol || cy < r.top - tol || cy > r.bottom + tol) continue;
    const hollow = (el.getAttribute('fill') || '') === 'none', sw = (parseFloat(el.getAttribute('stroke-width')) || 1) * unit(svg), d = tol + sw / 2;
    let ok = true;
    if (t === 'line' && plain(el)) ok = nearPath(ends(el).map(q => toClient(svg, q[0], q[1])), cx, cy, d);
    else if (isCurve(el) && plain(el)) { const q = qp(el.getAttribute('d')); ok = nearPath([...Array(17).keys()].map(i => toClient(svg, ...curvePt(q, i / 16))), cx, cy, d); }
    else if ((t === 'polyline' || (t === 'polygon' && hollow)) && plain(el)) { const p = pts(el).map(q => toClient(svg, q[0], q[1])); if (t === 'polygon') p.push(p[0]); ok = nearPath(p, cx, cy, d); }
    else if (hollow && (t === 'ellipse' || t === 'circle') && !rotOf(el)) { const a = r.width / 2, b = r.height / 2, e = Math.hypot((cx - r.left - a) / (a || 1), (cy - r.top - b) / (b || 1)); ok = Math.abs(e - 1) * Math.min(a, b) <= d; }
    else if (hollow && t === 'rect' && !rotOf(el)) ok = !(cx > r.left + d && cx < r.right - d && cy > r.top + d && cy < r.bottom - d);
    if (ok) return el;
  }
  return null;
}
function overlayOf(pg, create) {
  let o = pg.querySelector(':scope > svg.overlay');
  if (!o && create) { o = svgEl('svg', { class: 'draw overlay', viewBox: '0 0 ' + Book.pageW(pg) + ' ' + Book.pageH(pg) }); pg.insertBefore(o, pg.querySelector(':scope > .foot')); }
  return o;
}
function marker(svg, color) {   // arrowhead in the line's colour, shared per drawing
  const hex = color.replace('#', '').toUpperCase(), id = 'ah' + hex;
  let defs = svg.querySelector(':scope > defs');
  if (!defs) { defs = svgEl('defs'); svg.prepend(defs); }
  if (![...defs.children].some(m => m.id === id)) {
    const m = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
    m.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#' + hex })); defs.append(m);
  }
  return `url(#${id})`;
}
const heads = el => (el.getAttribute('marker-start') ? 1 : 0) + (el.getAttribute('marker-end') ? 2 : 0);
function setHeads(el, h) {
  const c = el.getAttribute('stroke') || '#000000', svg = el.ownerSVGElement;
  if (h & 1) el.setAttribute('marker-start', marker(svg, c)); else el.removeAttribute('marker-start');
  if (h & 2) el.setAttribute('marker-end', marker(svg, c)); else el.removeAttribute('marker-end');
  const used = new Set([...svg.querySelectorAll('[marker-start], [marker-end]')].flatMap(n => [n.getAttribute('marker-start'), n.getAttribute('marker-end')]));
  svg.querySelectorAll(':scope > defs > marker[id^="ah"]').forEach(m => { if (!used.has(`url(#${m.id})`)) m.remove(); });   // drop arrowheads no line uses any more
}

// ---------------------------------------------------------------- connectors: line ends that follow the shape they sit on
const byId = (svg, id) => id ? [...svg.querySelectorAll('[id]')].find(n => n.id === id && n.ownerSVGElement === svg) : null;
function edgePoint(target, toward) {   // where the ray from the shape's centre toward a point leaves the shape (plus a small gap)
  const b = box(target), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = (b.x1 - b.x0) / 2 || 0.1, hh = (b.y1 - b.y0) / 2 || 0.1;
  let dx = toward[0] - cx, dy = toward[1] - cy; const l = Math.hypot(dx, dy); if (l < 0.01) return [cx, cy]; dx /= l; dy /= l;
  const round = /^(ellipse|circle)$/.test(target.localName) && !rotOf(target);
  const t = round ? 1 / Math.hypot(dx / hw, dy / hh) : Math.min(dx ? hw / Math.abs(dx) : 1e9, dy ? hh / Math.abs(dy) : 1e9);
  return [cx + dx * (t + 2), cy + dy * (t + 2)];
}
function reconnect(svg) {
  if (!svg || !svg.isConnected) return;
  svg.querySelectorAll('[data-a], [data-b]').forEach(el => {
    const e = ends(el); if (!e) return;
    const ta = byId(svg, el.getAttribute('data-a')), tb = byId(svg, el.getAttribute('data-b'));
    if (!ta && el.hasAttribute('data-a')) el.removeAttribute('data-a'); if (!tb && el.hasAttribute('data-b')) el.removeAttribute('data-b');
    const centre = t => { const b = box(t); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
    const q = el.localName === 'path' ? qp(el.getAttribute('d')) : null, bend = q ? [q[2], q[3]] : null;   // a curve leaves each shape toward its bend
    if (ta) { const p = edgePoint(ta, bend || (tb ? centre(tb) : e[1])); if (Math.hypot(p[0] - e[0][0], p[1] - e[0][1]) > 0.05) setEnd(el, 0, p[0], p[1]); }
    if (tb) { const p = edgePoint(tb, bend || (ta ? centre(ta) : e[0])); if (Math.hypot(p[0] - e[1][0], p[1] - e[1][1]) > 0.05) setEnd(el, 1, p[0], p[1]); }
  });
}
function attach(el, i, cx, cy) {   // end i of a line/curve was dropped at this screen point: stick it to the closed shape there, if any
  const svg = el.ownerSVGElement, key = i ? 'data-b' : 'data-a';
  const t = kids(svg).reverse().find(s => s !== el && /^(rect|ellipse|circle|polygon|text|g)$/.test(s.localName) && !s.hasAttribute('data-lock') && (r => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom)(s.getBoundingClientRect()));
  if (!t) return el.removeAttribute(key);
  if (!t.id) t.id = 's' + Math.random().toString(36).slice(2, 7);
  el.setAttribute(key, t.id); reconnect(svg);
}

// ---------------------------------------------------------------- selection + handles
function setShapes(list, svg, keepMode) {
  if (!keepMode) ptMode = false;
  shapes = list.filter(s => s.isConnected); layer = shapes.length ? (svg || shapes[0].ownerSVGElement) : null;
  drawHandles(); E.renderInspector();
}
function drawHandles() {
  hbox.querySelectorAll(':scope > :not(input)').forEach(n => n.remove());
  shapes = shapes.filter(s => s.isConnected);
  if (layer) reconnect(layer);
  if (!shapes.length) return;
  for (const s of shapes) {
    const r = s.getBoundingClientRect(), [x, y] = E.deskXY(r);
    const d = document.createElement('div'); d.className = 'box'; Object.assign(d.style, { left: x - 2 + 'px', top: y - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' }); hbox.append(d);
  }
  if (tool !== 'select' || editing) return;
  const s = shapes[0], t = s.localName, svg = s.ownerSVGElement;
  if (shapes.length > 1 || t === 'g') {   // several shapes, or a group: handles on the box around all of them scale the lot
    const rs = shapes.map(x => x.getBoundingClientRect()), L = Math.min(...rs.map(r => r.left)), R = Math.max(...rs.map(r => r.right)), T = Math.min(...rs.map(r => r.top)), B = Math.max(...rs.map(r => r.bottom));
    if (R - L < 4 && B - T < 4) return;
    const g = (cx, cy, name) => { const [x, y] = E.deskXY({ left: cx, top: cy }); const d = document.createElement('div'); d.className = 'hd grp'; d.dataset.h = 'g-' + name; d.title = 'Drag to resize them together (Shift keeps the proportions)'; d.style.left = x + 'px'; d.style.top = y + 'px'; hbox.append(d); };
    g(L, T, 'nw'); g(R, T, 'ne'); g(R, B, 'se'); g(L, B, 'sw');
    if (R - L > 40) { g((L + R) / 2, T, 'n'); g((L + R) / 2, B, 's'); } if (B - T > 40) { g(L, (T + B) / 2, 'w'); g(R, (T + B) / 2, 'e'); }
    return;
  }
  const hd = (cx, cy, name, cls) => { const [x, y] = E.deskXY({ left: cx, top: cy }); const d = document.createElement('div'); d.className = 'hd ' + (cls || ''); d.dataset.h = name; d.style.left = x + 'px'; d.style.top = y + 'px'; hbox.append(d); };
  if (!plain(s)) return;
  const e = ends(s);
  if (e) {
    hd(...toClient(svg, e[0][0], e[0][1]), 'p1', 'round' + (s.hasAttribute('data-a') ? ' att' : '')); hd(...toClient(svg, e[1][0], e[1][1]), 'p2', 'round' + (s.hasAttribute('data-b') ? ' att' : ''));
    if (isCurve(s)) hd(...toClient(svg, ...curvePt(qp(s.getAttribute('d')), 0.5)), 'bend', 'round bend');
    return;
  }
  if (ptMode && (t === 'polygon' || t === 'polyline')) { pts(s).forEach((q, i) => hd(...toClient(svg, q[0], q[1]), 'v' + i, 'round')); return; }
  const r = rotOf(s), b = lbox(s), at = (x, y) => toClient(svg, ...rotP(x, y, r)), mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  if (t !== 'text') { hd(...at(b.x0, b.y0), 'nw'); hd(...at(mx, b.y0), 'n'); hd(...at(b.x1, b.y0), 'ne'); hd(...at(b.x1, my), 'e'); hd(...at(b.x1, b.y1), 'se'); hd(...at(mx, b.y1), 's'); hd(...at(b.x0, b.y1), 'sw'); hd(...at(b.x0, my), 'w'); }
  if (/^(rect|ellipse|text|polygon|polyline)$/.test(t)) hd(...at(mx, b.y0 - 18 / unit(svg)), 'rot', 'round rot');
}
E.onDeskScroll(drawHandles); window.addEventListener('resize', drawHandles); book.addEventListener('book-refresh', drawHandles);
function guides(svg, vx, vy) {
  const r = svg.getBoundingClientRect();
  gx.hidden = vx == null; gy.hidden = vy == null;
  if (vx != null) { const [x, y] = E.deskXY({ left: toClient(svg, vx, 0)[0], top: r.top }); Object.assign(gx.style, { left: x + 'px', top: y + 'px', width: '1px', height: r.height + 'px' }); }
  if (vy != null) { const [x, y] = E.deskXY({ left: r.left, top: toClient(svg, 0, vy)[1] }); Object.assign(gy.style, { left: x + 'px', top: y + 'px', height: '1px', width: r.width + 'px' }); }
}
function dragLoop(move, done) {
  E.hold(true);
  const mv = e => { e.preventDefault(); move(e); drawHandles(); };
  const up = e => { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); gx.hidden = gy.hidden = true; if (done) done(e); E.hold(false); Book.refreshSoon(); drawHandles(); E.renderInspector(); };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}

// ---------------------------------------------------------------- tools
function setTool(t, lock) {
  if (draft && t !== draft.tool) finishPoly(true);
  tool = t; locked = !!lock && t !== 'select'; document.body.classList.toggle('ed-tool', t !== 'select');
  if (t !== 'select' && shapes.length && !draft) setShapes([]);   // a tool is for drawing: no handles in the way
  document.querySelectorAll('#tools button').forEach(b => { b.classList.toggle('on', b.dataset.tool === t); b.classList.toggle('lock', b.dataset.tool === t && locked); });
}
const doneTool = (el, svg) => { if (locked) setShapes([]); else { setTool('select'); setShapes([el], svg); } };
$('#tools').addEventListener('mousedown', e => e.preventDefault());
$('#tools').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTool(b.dataset.tool, e.detail >= 2); });   // double-click keeps the tool on

function finishPoly(cancel) {
  if (!draft) return;
  const d = draft; draft = null;
  const p = d.pts.filter((q, i) => !i || Math.hypot(q[0] - d.pts[i - 1][0], q[1] - d.pts[i - 1][1]) > 0.5);
  if (cancel || p.length < 2) { d.el.remove(); E.hold(false); setTool('select'); return setShapes([]); }
  let el = d.el;
  if (p.length === 2) { el = svgEl('line', { x1: p[0][0], y1: p[0][1], x2: p[1][0], y2: p[1][1], stroke: d.open || last.stroke === 'none' ? '#000000' : last.stroke, 'stroke-width': d.open ? 1.5 : last.sw }); d.el.replaceWith(el); }
  else el.setAttribute('points', ptStr(p));
  E.hold(false); doneTool(el, d.svg); Book.refreshSoon();
}
const ortho = (q, p) => Math.abs(p[0] - q[0]) > Math.abs(p[1] - q[1]) ? [p[0], q[1]] : [q[0], p[1]];
function polyClick(e, pg) {
  if (!draft) {
    const flow = e.target.closest && e.target.closest('svg.draw:not(.overlay)'), svg = flow || overlayOf(pg, true);
    const p = toSvg(svg, e.clientX, e.clientY).map(r1);
    const open = tool === 'pline';
    const el = open ? svgEl('polyline', { points: p.join(','), fill: 'none', stroke: '#000000', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })
      : svgEl('polygon', { points: p.join(','), fill: last.fill, stroke: last.stroke, 'stroke-width': last.sw, 'stroke-linejoin': 'round' }); svg.append(el);
    E.hold(true); draft = { el, svg, pts: [p], tool, open }; shapes = [el]; layer = svg; return;
  }
  const p = toSvg(draft.svg, e.clientX, e.clientY).map(r1), a = toClient(draft.svg, ...draft.pts[0]);
  if (!draft.open && draft.pts.length >= 3 && Math.hypot(e.clientX - a[0], e.clientY - a[1]) < 7) return finishPoly();
  draft.pts.push(e.shiftKey ? ortho(draft.pts[draft.pts.length - 1], p) : p);
  draft.el.setAttribute('points', ptStr(draft.pts));
}
window.addEventListener('pointermove', e => { if (!draft) return; let p = toSvg(draft.svg, e.clientX, e.clientY).map(r1); if (e.shiftKey) p = ortho(draft.pts[draft.pts.length - 1], p); draft.el.setAttribute('points', ptStr([...draft.pts, p])); }, true);
function thin(p, eps) {   // Ramer-Douglas-Peucker: drop the points a freehand stroke does not need
  if (p.length < 3) return p;
  let far = 0, at = 0; const a = p[0], b = p[p.length - 1];
  for (let i = 1; i < p.length - 1; i++) { const d = segDist(p[i][0], p[i][1], a[0], a[1], b[0], b[1]); if (d > far) { far = d; at = i; } }
  return far > eps ? [...thin(p.slice(0, at + 1), eps).slice(0, -1), ...thin(p.slice(at), eps)] : [a, b];
}
function penDraw(e, pg) {   // freehand: the stroke is kept as an open polygon, so it moves, resizes and edits like any other
  const flow = e.target.closest && e.target.closest('svg.draw:not(.overlay)'), svg = flow || overlayOf(pg, true);
  const p = [toSvg(svg, e.clientX, e.clientY)];
  const el = svgEl('polyline', { points: ptStr(p), fill: 'none', stroke: '#000000', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); svg.append(el);
  shapes = [el]; layer = svg;
  dragLoop(ev => { const q = toSvg(svg, ev.clientX, ev.clientY), l = p[p.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) * unit(svg) < 1.5) return; p.push(q); el.setAttribute('points', ptStr(p)); },
    () => { const out = thin(p, 0.6); if (out.length < 2 || (out.length === 2 && Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1]) < 2)) { el.remove(); return setShapes([]); } el.setAttribute('points', ptStr(out)); doneTool(el, svg); });
}
function create(e, pg) {
  if (tool === 'poly' || tool === 'pline') return polyClick(e, pg);
  if (tool === 'pen') return penDraw(e, pg);
  const flow = e.target.closest && e.target.closest('svg.draw:not(.overlay)');
  const svg = flow || overlayOf(pg, true);
  const gd = flow ? { v: [], h: [] } : E.guides(), gs = (v, arr, ev) => { if (ev.metaKey || ev.ctrlKey) return v; for (const g of arr) if (Math.abs(v - g) * unit(svg) < 5) return g; return v; };   // new shapes on the page catch the guides
  const at = ev => { const [x, y] = toSvg(svg, ev.clientX, ev.clientY); return [gs(x, gd.v, ev), gs(y, gd.h, ev)]; }, [x0, y0] = at(e);
  const line = tool === 'line' || tool === 'arrow' || tool === 'curve';
  let el;
  if (tool === 'text') {
    el = svgEl('text', { x: r1(x0), y: r1(y0), 'font-size': 11, fill: '#000000' }); el.textContent = 'Label'; svg.append(el);
    const keep = locked ? tool : null;
    setTool('select'); setShapes([el], svg); E.commit(true);
    return editLabel(el, true, keep);
  }
  if (tool === 'rect') el = svgEl('rect', { x: r1(x0), y: r1(y0), width: 0, height: 0, fill: last.fill, stroke: last.stroke, 'stroke-width': last.sw });
  else if (tool === 'ellipse') el = svgEl('ellipse', { cx: r1(x0), cy: r1(y0), rx: 0, ry: 0, fill: last.fill, stroke: last.stroke, 'stroke-width': last.sw });
  else if (tool === 'tri') el = svgEl('polygon', { points: `${r1(x0)},${r1(y0)}`, fill: last.fill, stroke: last.stroke, 'stroke-width': last.sw, 'stroke-linejoin': 'round' });
  else if (tool === 'curve') el = svgEl('path', { d: qd([x0, y0, x0, y0, x0, y0]), fill: 'none', stroke: '#000000', 'stroke-width': 1.5 });
  else el = svgEl('line', { x1: r1(x0), y1: r1(y0), x2: r1(x0), y2: r1(y0), stroke: '#000000', 'stroke-width': 1.5 });
  svg.append(el);
  if (tool === 'arrow' || tool === 'curve') setHeads(el, 2);
  const kind = tool; let moved = false;
  const shape = (x, y, shift) => {
    if (line) {
      if (shift) { const a = Math.round(Math.atan2(y - y0, x - x0) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - x0, y - y0); x = x0 + l * Math.cos(a); y = y0 + l * Math.sin(a); }
      if (kind === 'curve') { const mx = (x0 + x) / 2, my = (y0 + y) / 2; el.setAttribute('d', qd([x0, y0, mx + (y - y0) * 0.25, my - (x - x0) * 0.25, x, y])); }
      else { el.setAttribute('x2', r1(x)); el.setAttribute('y2', r1(y)); }
      return;
    }
    let w = x - x0, hh = y - y0; if (shift) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
    const ax = Math.min(x0, x0 + w), ay = Math.min(y0, y0 + hh), bw = Math.abs(w), bh = Math.abs(hh);
    if (kind === 'rect') { el.setAttribute('x', r1(ax)); el.setAttribute('y', r1(ay)); el.setAttribute('width', r1(bw)); el.setAttribute('height', r1(bh)); }
    else if (kind === 'ellipse') { el.setAttribute('cx', r1(ax + bw / 2)); el.setAttribute('cy', r1(ay + bh / 2)); el.setAttribute('rx', r1(bw / 2)); el.setAttribute('ry', r1(bh / 2)); }
    else el.setAttribute('points', `${r1(ax + bw / 2)},${r1(ay)} ${r1(ax + bw)},${r1(ay + bh)} ${r1(ax)},${r1(ay + bh)}`);
  };
  shapes = [el]; layer = svg;
  dragLoop(ev => { const [x, y] = at(ev); if (Math.hypot(x - x0, y - y0) > 2) moved = true; shape(x, y, ev.shiftKey); },
    ev => {
      if (!moved) { if (line) shape(x0 + 80, y0, false); else shape(x0 + (kind === 'rect' ? 90 : 60), y0 + (kind === 'rect' ? 50 : 60), false); }
      else if (line) { attach(el, 0, e.clientX, e.clientY); attach(el, 1, ev.clientX, ev.clientY); }
      doneTool(el, svg);
    });
}
function startMove(e) {
  if (e.altKey) { const copies = shapes.map(s => { const c = s.cloneNode(true); c.removeAttribute('id'); s.after(c); return c; }); shapes = copies; }   // Option-drag leaves a copy behind
  const svg = layer, orig = shapes.map(snapshot), [sx, sy] = toSvg(svg, e.clientX, e.clientY), b0 = union(shapes), v = vbox(svg);
  const others = kids(svg).filter(k => !shapes.includes(k)).map(s => box(s));
  const gd = svg.classList.contains('overlay') ? E.guides() : { v: [], h: [] };
  const xs = [v.x, v.x + v.width / 2, v.x + v.width, ...(svg.classList.contains('overlay') ? [24, Book.pageW(svg) - 24] : []), ...gd.v, ...others.flatMap(o => [o.x0, (o.x0 + o.x1) / 2, o.x1])];
  const ys = [v.y, v.y + v.height / 2, v.y + v.height, ...gd.h, ...others.flatMap(o => [o.y0, (o.y0 + o.y1) / 2, o.y1])];
  let moved = false;
  dragLoop(ev => {
    let [x, y] = toSvg(svg, ev.clientX, ev.clientY), dx = x - sx, dy = y - sy;
    if (!moved && Math.hypot(dx, dy) * unit(svg) < 3) return; moved = true;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    let vx = null, vy = null, ndx, ndy;
    if (!ev.metaKey && !ev.ctrlKey) {
      let best = 3 / Math.max(unit(svg), 0.5) + 1.5;
      for (const g of xs) for (const m of [b0.x0, (b0.x0 + b0.x1) / 2, b0.x1]) if (Math.abs(m + dx - g) < best) { best = Math.abs(m + dx - g); vx = g; ndx = g - m; }
      if (vx != null) dx = ndx;
      best = 3 / Math.max(unit(svg), 0.5) + 1.5;
      for (const g of ys) for (const m of [b0.y0, (b0.y0 + b0.y1) / 2, b0.y1]) if (Math.abs(m + dy - g) < best) { best = Math.abs(m + dy - g); vy = g; ndy = g - m; }
      if (vy != null) dy = ndy;
    }
    guides(svg, vx, vy);
    shapes.forEach((s, k) => moveTo(s, orig[k], dx, dy));
  });
}
function offsetOf(el) {   // how far the groups around a shape shift it; null when a group does more than shift
  let tx = 0, ty = 0;
  for (let n = el.parentNode; n && n.localName !== 'svg'; n = n.parentNode) { const t = n.getAttribute('transform'); if (!t) continue; const m = /^\s*translate\(\s*([-\d.e]+)[ ,]*([-\d.e]+)?\s*\)\s*$/.exec(t); if (!m) return null; tx += +m[1]; ty += +(m[2] || 0); }
  return [tx, ty];
}
function groupResize(e, name) {
  e.preventDefault(); e.stopPropagation();
  const svg = layer, U = union(shapes), W = U.x1 - U.x0 || 1, H = U.y1 - U.y0 || 1;
  const lv = leaves(shapes).map(s => ({ s, o: snapshot(s), from: lbox(s), b: box(s), off: offsetOf(s) })).filter(l => l.off);
  dragLoop(ev => {
    const [x, y] = toSvg(svg, ev.clientX, ev.clientY), to = Object.assign({}, U);
    if (name.includes('w')) to.x0 = Math.min(x, U.x1 - 3); if (name.includes('e')) to.x1 = Math.max(x, U.x0 + 3);
    if (name.includes('n')) to.y0 = Math.min(y, U.y1 - 3); if (name.includes('s')) to.y1 = Math.max(y, U.y0 + 3);
    if (ev.shiftKey && name.length === 2) { const k = Math.max((to.x1 - to.x0) / W, (to.y1 - to.y0) / H); if (name.includes('w')) to.x0 = to.x1 - W * k; else to.x1 = to.x0 + W * k; if (name.includes('n')) to.y0 = to.y1 - H * k; else to.y1 = to.y0 + H * k; }
    const sx = (to.x1 - to.x0) / W, sy = (to.y1 - to.y0) / H, mx = X => to.x0 + (X - U.x0) * sx, my = Y => to.y0 + (Y - U.y0) * sy;
    for (const l of lv) {
      const [tx, ty] = l.off, f = l.from;
      if (!l.o.plain) { const cx = (l.b.x0 + l.b.x1) / 2, cy = (l.b.y0 + l.b.y1) / 2; moveTo(l.s, l.o, mx(cx) - cx, my(cy) - cy); }   // shapes we cannot reshape keep their size and follow along
      else if (l.o.rot || l.s.localName === 'text') { const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2; moveTo(l.s, l.o, mx(cx + tx) - tx - cx, my(cy + ty) - ty - cy); }
      else resizeTo(l.s, l.o, f, { x0: mx(f.x0 + tx) - tx, y0: my(f.y0 + ty) - ty, x1: mx(f.x1 + tx) - tx, y1: my(f.y1 + ty) - ty });
    }
  });
}
hbox.addEventListener('pointerdown', e => {
  const name = e.target.dataset && e.target.dataset.h; if (!name) return;
  if (name.startsWith('g-')) return groupResize(e, name.slice(2));
  if (shapes.length !== 1) return;
  e.preventDefault(); e.stopPropagation();
  const s = shapes[0], svg = s.ownerSVGElement, o = snapshot(s), from = lbox(s);
  const cb = o.rot ? [o.rot.cx, o.rot.cy] : [(from.x0 + from.x1) / 2, (from.y0 + from.y1) / 2];
  const a0 = o.rot ? o.rot.a : 0, [px0, py0] = toSvg(svg, e.clientX, e.clientY), grab = Math.atan2(py0 - cb[1], px0 - cb[0]) * 180 / Math.PI;
  dragLoop(ev => {
    let [x, y] = toSvg(svg, ev.clientX, ev.clientY);
    if (name === 'rot') {   // turn by how far the pointer has swung around the centre
      let d = Math.atan2(y - cb[1], x - cb[0]) * 180 / Math.PI - grab; const poly = /^poly/.test(s.localName);
      let a = (poly ? 0 : a0) + d; if (ev.shiftKey) a = Math.round(a / 15) * 15;
      return rotateTo(s, o, a);
    }
    if (name === 'bend') { const q = o.q.slice(); q[2] = 2 * x - (q[0] + q[4]) / 2; q[3] = 2 * y - (q[1] + q[5]) / 2; s.setAttribute('d', qd(q)); return; }
    if (name[0] === 'v') { const p = pts(s), i = +name.slice(1); if (ev.shiftKey) { const q = p[(i + p.length - 1) % p.length]; if (Math.abs(x - q[0]) < Math.abs(y - q[1])) x = q[0]; else y = q[1]; } p[i] = [x, y]; s.setAttribute('points', ptStr(p)); return; }
    if (name === 'p1' || name === 'p2') {
      const other = endsOf(o.tag, a => o[a])[name === 'p1' ? 1 : 0];
      if (ev.shiftKey) { const a = Math.round(Math.atan2(y - other[1], x - other[0]) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - other[0], y - other[1]); x = other[0] + l * Math.cos(a); y = other[1] + l * Math.sin(a); }
      s.removeAttribute(name === 'p1' ? 'data-a' : 'data-b'); setEnd(s, name === 'p1' ? 0 : 1, x, y); return;
    }
    if (o.rot) [x, y] = rotP(x, y, o.rot, -1);   // work in the shape's own, unrotated frame
    const to = Object.assign({}, from);
    if (name.includes('w')) to.x0 = x; if (name.includes('e')) to.x1 = x; if (name.includes('n')) to.y0 = y; if (name.includes('s')) to.y1 = y;
    if (ev.shiftKey && name.length === 2) { const k = Math.max(Math.abs(to.x1 - to.x0) / (from.x1 - from.x0 || 1), Math.abs(to.y1 - to.y0) / (from.y1 - from.y0 || 1)); const w = (from.x1 - from.x0) * k, hh = (from.y1 - from.y0) * k; if (name.includes('w')) to.x0 = to.x1 - w; else to.x1 = to.x0 + w; if (name.includes('n')) to.y0 = to.y1 - hh; else to.y1 = to.y0 + hh; }
    resizeTo(s, o, from, to);
  }, ev => { if (name === 'p1' || name === 'p2') attach(s, name === 'p1' ? 0 : 1, ev.clientX, ev.clientY); });
});

// pointer on the pages: draw with a tool, or pick shapes with the select tool
book.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const pg = E.pageOf(e.target); if (!pg) return;
  if (editing) endLabel(true);
  if (tool !== 'select') { e.preventDefault(); e.stopPropagation(); if (document.activeElement && book.contains(document.activeElement)) document.activeElement.blur(); E.select(null, true); E.setPage(pg); return create(e, pg); }
  const flow = e.target.closest && e.target.closest('svg.draw:not(.overlay)'), over = overlayOf(pg, false);
  let svg = over, s = null;
  if (shapes.length && layer && layer.isConnected && pg.contains(layer) && !e.shiftKey) {   // anywhere inside the current selection drags it (hollow shapes included)
    const rs = shapes.map(x => x.getBoundingClientRect()), L = Math.min(...rs.map(r => r.left)), R = Math.max(...rs.map(r => r.right)), T = Math.min(...rs.map(r => r.top)), B = Math.max(...rs.map(r => r.bottom));
    if (e.clientX >= L - 3 && e.clientX <= R + 3 && e.clientY >= T - 3 && e.clientY <= B + 3) { svg = layer; s = shapes[0]; }
  }
  if (!s) s = over && hit(over, e.clientX, e.clientY);
  if (!s && flow) { svg = flow; s = hit(flow, e.clientX, e.clientY); }
  if (!s) {
    if (shapes.length) setShapes([]);
    if (flow && E.sel === flow && !e.altKey) { e.preventDefault(); e.stopPropagation(); return marquee(e, flow); }
    return;
  }
  e.preventDefault(); e.stopPropagation();
  if (document.activeElement && book.contains(document.activeElement)) { document.activeElement.blur(); getSelection().removeAllRanges(); }
  let list = shapes;
  if (e.shiftKey && layer === svg) list = shapes.includes(s) ? shapes.filter(x => x !== s) : [...shapes, s];
  else if (!shapes.includes(s) || layer !== svg) list = [s];
  const sameOne = list.length === 1 && shapes.length === 1 && list[0] === shapes[0];
  if (svg.classList.contains('overlay')) { if (E.sel) E.select(null, true); E.setPage(pg); } else if (E.sel !== svg) E.select(svg, true);
  if (sameOne) { shapes = list; layer = svg; } else setShapes(list, svg);
  if (list.includes(s)) startMove(e);
}, true);
function marquee(e, svg) {   // drag on empty canvas of the selected drawing: select the shapes inside
  const x0 = e.clientX, y0 = e.clientY, m = document.createElement('div'); m.className = 'marq'; let moved = false;
  const mv = ev => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; if (!moved) { moved = true; hbox.append(m); }
    const [x, y] = E.deskXY({ left: Math.min(x0, ev.clientX), top: Math.min(y0, ev.clientY) }); Object.assign(m.style, { left: x + 'px', top: y + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' }); };
  const up = ev => {
    window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); m.remove();
    if (!moved) return;
    const L = Math.min(x0, ev.clientX), R = Math.max(x0, ev.clientX), T = Math.min(y0, ev.clientY), B = Math.max(y0, ev.clientY);
    setShapes(kids(svg).filter(k => { if (k.hasAttribute('data-lock')) return false; const r = k.getBoundingClientRect(); return r.left >= L && r.right <= R && r.top >= T && r.bottom <= B; }), svg);
  };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}
book.addEventListener('dblclick', e => {
  if (draft) { e.preventDefault(); return finishPoly(); }
  if (shapes.length !== 1) return;
  if (/^(polygon|polyline)$/.test(shapes[0].localName) && hit(layer, e.clientX, e.clientY) === shapes[0]) { ptMode = !ptMode; return drawHandles(); }
  if (shapes[0].localName === 'text') { e.preventDefault(); editLabel(shapes[0]); }
});
book.addEventListener('pointermove', e => {   // show that a shape can be grabbed
  if (e.buttons || tool !== 'select') return;
  const pg = E.pageOf(e.target), over = pg && overlayOf(pg, false), flow = e.target.closest && e.target.closest('svg.draw:not(.overlay)');
  const h = (over && over.childElementCount && hit(over, e.clientX, e.clientY)) || (flow && hit(flow, e.clientX, e.clientY));
  book.style.cursor = h ? 'move' : '';
});

// ---------------------------------------------------------------- labels: type on the canvas
// a label is plain text, or one styled <tspan>; labels mixing several styled runs are edited in the file
const leaf = s => s.childElementCount === 0 ? s : (s.childElementCount === 1 && ![...s.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim()) && s.firstElementChild.childElementCount === 0 ? s.firstElementChild : null);
function editLabel(el, fresh, thenTool) {
  const target = leaf(el); if (!target) return E.toast('This label mixes several styles; change its words in chapter.html');
  if (editing) endLabel(true);
  const svg = el.ownerSVGElement, r = el.getBoundingClientRect(), cs = getComputedStyle(el), anchor = el.getAttribute('text-anchor') || 'start';
  const inp = document.createElement('input'); inp.className = 'lbl'; inp.value = target.textContent; inp.spellcheck = false;
  const size = Math.max(9, r.height * 0.82);
  const place = () => {
    const w = Math.max(60, inp.value.length * size * 0.62 + 24), b = el.getBoundingClientRect(), base = b.width ? b : r;
    const left = anchor === 'middle' ? base.left + base.width / 2 - w / 2 : anchor === 'end' ? base.right - w + 5 : base.left - 5;
    const [x, y] = E.deskXY({ left, top: r.top - 4 });
    Object.assign(inp.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: r.height + 8 + 'px', fontSize: size + 'px', fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, color: el.getAttribute('fill') || '#000', textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left' });
  };
  editing = { el, target, inp, before: target.textContent, fresh, thenTool };
  el.setAttribute('data-ed-hide', ''); hbox.append(inp); place(); drawHandles();
  inp.oninput = () => { target.textContent = inp.value || ' '; place(); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); endLabel(true); } else if (e.key === 'Escape') { e.preventDefault(); endLabel(false); } };
  inp.onblur = () => { if (editing && editing.inp === inp) endLabel(true); };
  inp.onpointerdown = e => e.stopPropagation();
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
function endLabel(keep) {
  const ed = editing; if (!ed) return; editing = null;
  ed.inp.onblur = null; ed.inp.remove(); ed.el.removeAttribute('data-ed-hide');
  if (!keep) ed.target.textContent = ed.before;
  if ((!keep && ed.fresh) || !ed.target.textContent.trim()) { ed.el.remove(); setShapes([]); } else { drawHandles(); E.renderInspector(); }
  E.commit(true);
  if (ed.thenTool) setTool(ed.thenTool, true);
}

// ---------------------------------------------------------------- group, order, keyboard
function remove() { if (!shapes.length) return; E.commit(true); shapes.forEach(s => s.remove()); setShapes([]); E.commit(true); }
function duplicate(list, into, d) {
  const out = list.map(s => { const c = s.cloneNode(true); into.append(c); c.removeAttribute('id'); c.removeAttribute('data-a'); c.removeAttribute('data-b'); moveTo(c, snapshot(c), d, d);
    for (const n of [c, ...c.querySelectorAll('*')]) for (const a of ['marker-start', 'marker-end']) if (n.getAttribute(a)) n.setAttribute(a, marker(into, n.getAttribute('stroke') || '#000000')); return c; });
  setShapes(out, into); E.commit(true);
}
function group() {
  if (shapes.length < 2) return; E.commit(true);
  const order = kids(layer).filter(k => shapes.includes(k)), g = svgEl('g'); order[order.length - 1].after(g); order.forEach(s => g.append(s));
  setShapes([g], layer); E.commit(true);
}
function ungroup() {
  const gs = shapes.filter(s => s.localName === 'g'); if (!gs.length) return; E.commit(true);
  const out = shapes.filter(s => s.localName !== 'g');
  gs.forEach(g => { const [tx, ty] = (m => m ? [+m[1], +(m[2] || 0)] : [0, 0])(/translate\(\s*([-\d.e]+)[ ,]*([-\d.e]+)?\s*\)/.exec(g.getAttribute('transform') || '')); [...g.children].forEach(c => { g.before(c); if (tx || ty) moveTo(c, snapshot(c), tx, ty); out.push(c); }); g.remove(); });
  setShapes(out, layer); E.commit(true);
}
window.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const typing = document.activeElement && document.activeElement.isContentEditable;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (draft && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); e.stopImmediatePropagation(); return finishPoly(e.key === 'Escape'); }
  if (e.key === 'Escape' && tool !== 'select') { setTool('select'); return; }
  if (typing) return;
  if (mod && k === 'v' && clip) { e.preventDefault(); e.stopImmediatePropagation(); const pg = E.curPage || Book.pages()[0]; const into = clip.flow && E.sel && E.sel.localName === 'svg' ? E.sel : (layer && layer.isConnected ? layer : overlayOf(pg, true)); const tmp = svgEl('svg'); tmp.innerHTML = clip.html; E.commit(true); return duplicate([...tmp.children], into, 10); }
  if (!shapes.length) return;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (e.key === 'Escape') { stop(); return setShapes([]); }
  if (e.key === 'Enter' && shapes.length === 1 && shapes[0].localName === 'text') { stop(); return editLabel(shapes[0]); }
  if (e.key === 'Backspace' || e.key === 'Delete') { stop(); return remove(); }
  if (mod && k === 'd') { stop(); E.commit(true); return duplicate(shapes, layer, 10); }
  if (mod && k === 'g') { stop(); return e.shiftKey ? ungroup() : group(); }
  if (mod && (k === 'c' || k === 'x')) { stop(); clip = { html: shapes.map(s => s.outerHTML).join(''), flow: !layer.classList.contains('overlay') }; E.clearClip(); if (k === 'x') remove(); return; }
  if (mod && k === 'a') { stop(); return setShapes(kids(layer).filter(s => !s.hasAttribute('data-lock')), layer); }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) { stop(); const n = e.shiftKey ? 10 : 1; shapes.forEach(s => moveTo(s, snapshot(s), d[0] * n, d[1] * n)); drawHandles(); E.commit(); }
}, true);

// ---------------------------------------------------------------- side panel for the selected shapes
const FILLS = ['none', '#FFFFFF', '#C9DAF8', '#FFF2CC', '#D9D2E9', '#D9EAD3', '#F4CCCC', '#F5F5F5', '#6D9EEB', '#FFD966', '#8E7CC3', '#93C47D', '#E06666', '#002B5B', '#DCB439', '#674EA7', '#38761D', '#CC0000', '#000000'];
const LINES = ['none', '#000000', '#666666', '#DDDDDD', '#002B5B', '#DCB439', '#674EA7', '#38761D', '#CC0000', '#6D9EEB', '#FFD966', '#8E7CC3', '#93C47D', '#E06666'];
const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
const NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', circle: 'Circle', polygon: 'Polygon', polyline: 'Bent line', text: 'Label', g: 'Group', path: 'Path' };
const nameOf = s => s.localName === 'line' ? (heads(s) ? 'Arrow' : 'Line') : isCurve(s) ? 'Curve' : (NAMES[s.localName] || 'Shape');
const adder = insp => html => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; insp.append(el); return el; };
function inspect(insp) {
  shapes = shapes.filter(s => s.isConnected);
  if (!shapes.length) return false;
  const n = shapes.length, lv = leaves(shapes), s0 = lv[0] || shapes[0], all = t => lv.length && lv.every(s => t.test(s.localName));
  const add = adder(insp);
  const each = (fn, now) => { E.commit(true); lv.forEach(fn); drawHandles(); E.commit(!!now); };
  add(`<h4>${n > 1 ? n + ' shapes' : nameOf(shapes[0])}</h4>`);
  const isText = all(/^text$/), isLine = lv.every(s => /^(line|polyline)$/.test(s.localName) || isCurve(s)), closed = lv.some(s => /^(rect|ellipse|circle|polygon|path)$/.test(s.localName) && !isCurve(s));
  const swatches = (label, list, attr) => {
    add(`<label>${label}</label>`);
    const row = add(`<div class="sw">${list.map(c => `<button data-c="${c}" title="${c === 'none' ? 'none' : c}" class="${c === 'none' ? 'none ' : ''}${same(s0.getAttribute(attr) || (attr === 'fill' ? '#000000' : 'none'), c) ? 'cur' : ''}" style="${c === 'none' ? '' : 'background:' + c}"></button>`).join('')}</div>`);
    row.onclick = e => { const c = e.target.dataset.c; if (!c) return;
      each(s => { s.setAttribute(attr, c); if (attr === 'stroke' && heads(s) && c !== 'none') setHeads(s, heads(s)); }, true);
      if (attr === 'fill' && !isText && c !== 'none') last.fill = c; if (attr === 'stroke' && closed && c !== 'none') last.stroke = c;
      E.renderInspector(); };
  };
  if (isText) {
    const editable = lv.every(leaf);
    add(`<label>Text (double-click the label to type on the canvas)</label>`); const t = add(`<input type="text" data-k="text" ${editable ? '' : 'readonly title="This label mixes several styles; change its words in chapter.html"'} value="${esc(s0.textContent).replace(/"/g, '&quot;')}">`);
    t.oninput = () => { if (!editable) return; lv.forEach(s => { leaf(s).textContent = t.value; }); drawHandles(); };
    t.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') t.blur(); };
    const row = add(`<div class="row">Size <input type="number" min="5" max="60" step="0.5" style="width:60px" value="${parseFloat(s0.getAttribute('font-size')) || 11}">
      <select style="width:auto"><option value="start">left</option><option value="middle">centred</option><option value="end">right</option></select></div>`);
    row.querySelector('input').oninput = e => { lv.forEach(s => s.setAttribute('font-size', +e.target.value || 11)); drawHandles(); };
    const anc = row.querySelector('select'); anc.value = s0.getAttribute('text-anchor') || 'start'; anc.onchange = () => each(s => s.setAttribute('text-anchor', anc.value), true);
    const b = add(`<label class="check"><input type="checkbox" ${/^(700|bold)$/.test(s0.getAttribute('font-weight') || '') ? 'checked' : ''}>Bold</label>`); b.firstChild.onchange = e => each(s => e.target.checked ? s.setAttribute('font-weight', 700) : s.removeAttribute('font-weight'), true);
    const m = add(`<label class="check"><input type="checkbox" ${/Inconsolata/.test(s0.getAttribute('font-family') || '') ? 'checked' : ''}>Math font (Inconsolata)</label>`); m.firstChild.onchange = e => each(s => e.target.checked ? s.setAttribute('font-family', "'Inconsolata LGC', Consolas, monospace") : s.removeAttribute('font-family'), true);
    swatches('Colour', FILLS.filter(c => c !== 'none'), 'fill');
  } else {
    if (!isLine) swatches('Fill', FILLS, 'fill');
    if (!isLine && closed) { add(`<label>Fill opacity</label>`); const o = add(`<select>${[100, 80, 60, 40, 20].map(v => `<option value="${v / 100}">${v}%</option>`).join('')}</select>`); o.value = String(+(s0.getAttribute('fill-opacity') || 1)); o.onchange = () => each(s => +o.value === 1 ? s.removeAttribute('fill-opacity') : s.setAttribute('fill-opacity', o.value), true); }
    swatches(isLine ? 'Colour' : 'Outline', isLine ? LINES.filter(c => c !== 'none') : LINES, 'stroke');
    const row = add(`<div class="row">Width <select style="width:64px">${[0.5, 0.8, 1, 1.2, 1.5, 2, 3, 4].map(v => `<option>${v}</option>`).join('')}</select> <select style="width:auto"><option value="">solid</option><option value="4.5 3">dashed</option><option value="1.5 3">dotted</option></select></div>`);
    const [w, dash] = row.querySelectorAll('select'); const cw = String(parseFloat(s0.getAttribute('stroke-width')) || 1);
    if (![...w.options].some(o => o.value === cw)) w.add(new Option(cw, cw)); w.value = cw; dash.value = s0.getAttribute('stroke-dasharray') || '';
    if (dash.value !== (s0.getAttribute('stroke-dasharray') || '')) { dash.add(new Option('custom', s0.getAttribute('stroke-dasharray'))); dash.value = s0.getAttribute('stroke-dasharray'); }
    w.onchange = () => { each(s => s.setAttribute('stroke-width', w.value), true); if (closed) last.sw = +w.value; };
    dash.onchange = () => each(s => dash.value ? s.setAttribute('stroke-dasharray', dash.value) : s.removeAttribute('stroke-dasharray'), true);
    if (isLine) { add(`<label>Arrowheads</label>`); const a = add(`<select data-k="heads"><option value="0">none</option><option value="2">at the end</option><option value="1">at the start</option><option value="3">both ends</option></select>`); a.value = String(heads(s0)); a.onchange = () => { each(s => setHeads(s, +a.value), true); E.renderInspector(); }; }
    if (n === 1 && ends(shapes[0]) && (shapes[0].hasAttribute('data-a') || shapes[0].hasAttribute('data-b'))) { const d = add(`<div class="row"><span class="help" style="margin:0">Attached to ${[shapes[0].hasAttribute('data-a') && 'a shape at its start', shapes[0].hasAttribute('data-b') && 'a shape at its end'].filter(Boolean).join(' and ')}; it follows when they move.</span><button>Detach</button></div>`); d.querySelector('button').onclick = () => { E.commit(true); shapes[0].removeAttribute('data-a'); shapes[0].removeAttribute('data-b'); drawHandles(); E.commit(true); E.renderInspector(); }; }
    if (all(/^(polygon|polyline)$/)) { const c = add(`<label class="check"><input type="checkbox" ${s0.localName === 'polygon' ? 'checked' : ''}>Closed shape</label>`); c.firstChild.onchange = e => { E.commit(true); const out = shapes.map(s => { const nn = svgEl(e.target.checked ? 'polygon' : 'polyline'); for (const a of s.attributes) nn.setAttribute(a.name, a.value); if (!e.target.checked) nn.setAttribute('fill', 'none'); s.replaceWith(nn); return nn; }); setShapes(out, layer); E.commit(true); }; }
    if (all(/^rect$/)) { add(`<label>Corners</label>`); const c = add(`<select><option value="0">square</option><option value="3">slightly round</option><option value="6">round</option></select>`); c.value = String(parseFloat(s0.getAttribute('rx')) || 0); c.onchange = () => each(s => +c.value ? s.setAttribute('rx', c.value) : s.removeAttribute('rx'), true); }
  }
  add('<hr>');
  if (n === 1 && plain(shapes[0]) && !ends(shapes[0])) {
    const s = shapes[0], b = lbox(s), noSize = s.localName === 'text', canRot = /^(rect|ellipse|text)$/.test(s.localName);
    const row = add(`<div class="row">x <input type="number" step="1" style="width:56px" data-g="x" value="${r1(b.x0)}"> y <input type="number" step="1" style="width:56px" data-g="y" value="${r1(b.y0)}">${noSize ? '' : ` w <input type="number" step="1" style="width:56px" data-g="w" value="${r1(b.x1 - b.x0)}"> h <input type="number" step="1" style="width:56px" data-g="h" value="${r1(b.y1 - b.y0)}">`}${canRot ? ` turn <input type="number" step="5" style="width:56px" data-g="a" value="${r1((rotOf(s) || { a: 0 }).a)}">°` : ''}</div>`);
    row.oninput = e => { const g = k => +row.querySelector(`[data-g=${k}]`).value || 0;
      if (e.target.dataset.g === 'a') rotateTo(s, snapshot(s), g('a'));
      else { const keep = rotOf(s); s.removeAttribute('transform'); const from = lbox(s), o = snapshot(s); const to = noSize ? { x0: g('x'), y0: g('y'), x1: g('x') + (from.x1 - from.x0), y1: g('y') + (from.y1 - from.y0) } : { x0: g('x'), y0: g('y'), x1: g('x') + g('w'), y1: g('y') + g('h') }; resizeTo(s, o, from, to); if (keep) rotateTo(s, snapshot(s), keep.a); }
      drawHandles(); E.commit(); };
  }
  if (n > 1) {
    add(`<label>Align</label>`);
    const al = add(`<div class="seg"><button data-a="l">Left</button><button data-a="c">Centre</button><button data-a="r">Right</button><button data-a="t">Top</button><button data-a="m">Middle</button><button data-a="b">Bottom</button>${n > 2 ? '<button data-a="dh">Space across</button><button data-a="dv">Space down</button>' : ''}</div>`);
    al.onclick = e => { const a = e.target.dataset.a; if (!a) return; const u = union(shapes); E.commit(true);
      if (a === 'dh' || a === 'dv') { const ax = a === 'dh', bs = shapes.map(s => [s, box(s)]).sort((p, q) => ax ? p[1].x0 - q[1].x0 : p[1].y0 - q[1].y0); const total = bs.reduce((t, p) => t + (ax ? p[1].x1 - p[1].x0 : p[1].y1 - p[1].y0), 0), gap = ((ax ? u.x1 - u.x0 : u.y1 - u.y0) - total) / (bs.length - 1); let pos = ax ? u.x0 : u.y0; bs.forEach(([s, b]) => { moveTo(s, snapshot(s), ax ? pos - b.x0 : 0, ax ? 0 : pos - b.y0); pos += (ax ? b.x1 - b.x0 : b.y1 - b.y0) + gap; }); }
      else shapes.forEach(s => { const b = box(s); const dx = a === 'l' ? u.x0 - b.x0 : a === 'r' ? u.x1 - b.x1 : a === 'c' ? (u.x0 + u.x1 - b.x0 - b.x1) / 2 : 0, dy = a === 't' ? u.y0 - b.y0 : a === 'b' ? u.y1 - b.y1 : a === 'm' ? (u.y0 + u.y1 - b.y0 - b.y1) / 2 : 0; moveTo(s, snapshot(s), dx, dy); });
      drawHandles(); E.commit(true); };
  }
  const act = add(`<div class="row"><button data-a="front">To front</button><button data-a="back">To back</button><button data-a="dup" title="Cmd+D">Duplicate</button>${n > 1 ? '<button data-a="group" title="Cmd+G">Group</button>' : ''}${shapes.some(s => s.localName === 'g') ? '<button data-a="ungroup" title="Shift+Cmd+G">Ungroup</button>' : ''}<button data-a="del">Delete</button></div>`);
  act.onclick = e => { const a = e.target.dataset.a; if (!a) return;
    if (a === 'del') return remove(); if (a === 'dup') { E.commit(true); return duplicate(shapes, layer, 10); } if (a === 'group') return group(); if (a === 'ungroup') return ungroup();
    E.commit(true); if (a === 'front') shapes.forEach(s => layer.append(s)); else { const defs = layer.querySelector(':scope > defs'); [...shapes].reverse().forEach(s => defs ? defs.after(s) : layer.prepend(s)); } drawHandles(); E.commit(true); E.renderInspector(); };
  layers(insp);
  add(`<div class="help">Drag to move (Shift keeps it straight, Option-drag leaves a copy, Cmd turns snapping off). Square handles resize; the round one above turns the shape (Shift: 15° steps). On a line or curve the round handles move its ends: drop an end on a shape and it stays attached. Double-click a polygon to move its corners, a label to retype it. Arrow keys nudge by 1, Shift+arrow by 10. Cmd+C / V / D copy, paste, duplicate; Cmd+G groups.${layer && layer.classList.contains('overlay') ? ' This shape sits on the page itself, on top of the text; coordinates are in pt from the page\'s top-left.' : ''}</div>`);
  return true;
}

// ---------------------------------------------------------------- layers: every shape of the current drawing, front first
function describe(s) {
  if (s.localName === 'text') return '“' + s.textContent.trim().slice(0, 22) + '”';
  if (s.localName === 'g') return `Group of ${s.childElementCount}`;
  return nameOf(s);
}
function chip(s) {
  const l = s.localName === 'g' ? (leaves([s])[0] || s) : s, fill = l.getAttribute('fill'), stroke = l.getAttribute('stroke');
  const c = s.localName === 'text' ? (fill || '#000') : (fill && fill !== 'none' ? fill : 'transparent'), b = stroke && stroke !== 'none' ? stroke : (c === 'transparent' ? '#bbb' : c);
  return `<span class="chip" style="background:${esc(c)};border-color:${esc(b)}"></span>`;
}
let dragRow = null;
function layers(insp, forSvg) {
  let svg = forSvg || (shapes.length ? layer : null);
  if (!svg && E.sel && E.sel.localName === 'svg') svg = E.sel;
  if (!svg && E.curPage) { const o = overlayOf(E.curPage, false); if (o && kids(o).length) svg = o; }
  if (!svg || !svg.isConnected) return;
  const list = kids(svg).reverse(); if (!list.length) return;
  const add = adder(insp);
  add(`<h4 style="margin-top:14px">Layers <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink-muted)">· ${svg.classList.contains('overlay') ? 'on this page' : 'this drawing'}, front first</span></h4>`);
  const ul = add('<ol class="layers"></ol>');
  list.forEach(s => {
    const li = document.createElement('li'); li.draggable = true; li.className = (shapes.includes(s) ? 'cur ' : '') + (s.hasAttribute('data-lock') ? 'locked' : '');
    li.innerHTML = `${chip(s)}<span class="nm">${esc(describe(s))}</span><button class="lk" title="${s.hasAttribute('data-lock') ? 'Locked: clicks pass through it. Click to unlock.' : 'Lock: keep it from being picked by clicks on the canvas'}">${s.hasAttribute('data-lock') ? 'locked' : 'lock'}</button>`;
    li.onclick = e => {
      if (e.target.classList.contains('lk')) { E.commit(true); if (s.hasAttribute('data-lock')) s.removeAttribute('data-lock'); else { s.setAttribute('data-lock', '1'); shapes = shapes.filter(x => x !== s); } E.commit(true); drawHandles(); return E.renderInspector(); }
      if (tool !== 'select') setTool('select');
      const add2 = (e.shiftKey || e.metaKey) && layer === svg, pick = add2 ? (shapes.includes(s) ? shapes.filter(x => x !== s) : [...shapes, s]) : [s];
      if (!svg.classList.contains('overlay') && E.sel !== svg) E.select(svg, true); else if (svg.classList.contains('overlay') && E.sel) E.select(null, true);
      setShapes(pick, svg);
    };
    li.onmouseenter = () => { const r = s.getBoundingClientRect(), [x, y] = E.deskXY(r); const d = document.createElement('div'); d.className = 'box hover'; Object.assign(d.style, { left: x - 3 + 'px', top: y - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' }); hbox.append(d); li._h = d; };
    li.onmouseleave = () => { if (li._h) li._h.remove(); };
    li.ondragstart = e => { dragRow = s; e.dataTransfer.effectAllowed = 'move'; };
    li.ondragover = e => { if (!dragRow || dragRow === s) return; e.preventDefault(); const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; ul.querySelectorAll('li').forEach(x => x.classList.remove('above', 'below')); li.classList.add(after ? 'below' : 'above'); };
    li.ondrop = e => { e.preventDefault(); if (!dragRow || dragRow === s) return; const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; E.commit(true); if (after) s.before(dragRow); else s.after(dragRow); dragRow = null; E.commit(true); drawHandles(); E.renderInspector(); };   // the list is front-first: below in the list = further back
    li.ondragend = () => { dragRow = null; ul.querySelectorAll('li').forEach(x => x.classList.remove('above', 'below')); };
    ul.append(li);
  });
  if (!shapes.length) add(`<div class="help">Click a row to select that shape, even when it is hidden under another one. Shift-click adds to the selection. Drag rows to change what is in front. Lock keeps a shape (a background, say) from being picked on the canvas.</div>`);
}

// ---------------------------------------------------------------- figures -> drawings, canvas fitting
async function convertFigure(fig) {
  const src = fig.getAttribute('src'), text = await (await fetch(Book.url(src), { cache: 'no-cache' })).text();
  if (text.length > 80000 || /<(path|use|image)\b/.test(text) && (text.match(/<path\b/g) || []).length > 40) return E.toast('This figure is generated (see figsrc/), so it is better changed in its script. Only hand-built SVGs convert.');
  const t = document.createElement('template'); t.innerHTML = text.replace(/<\?xml[^>]*\?>\s*|<!DOCTYPE[^>]*>\s*|<!--[\s\S]*?-->/g, '');
  const svg = t.content.querySelector('svg'); if (!svg) return E.toast('Could not read ' + src);
  svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('xmlns'); svg.removeAttribute('xmlns:xlink');
  svg.setAttribute('class', 'draw');
  [...svg.attributes].filter(x => x.name !== 'class').forEach(x => { svg.removeAttribute(x.name); svg.setAttribute(x.name, x.value); });   // class first, so the file reads <svg class="draw" …>
  const w = fig.style.width || (fig.classList.contains('sm') ? '80%' : ''); if (w) svg.style.width = w;
  if (fig.style.position === 'absolute') svg.setAttribute('style', fig.getAttribute('style'));
  E.commit(true); fig.replaceWith(svg); E.prep(); E.select(svg); E.commit(true); Book.refresh();
  E.toast('Converted. The file ' + src + ' is no longer used by this page.', 'Undo', E.doUndo);
}
function fit(svg) {
  const list = kids(svg); if (!list.length) return;
  const u = union(list), v = vbox(svg), pad = 4;
  E.commit(true);
  const dy = pad - u.y0; list.forEach(s => moveTo(s, snapshot(s), 0, dy));
  svg.setAttribute('viewBox', `${r1(v.x)} 0 ${r1(v.width)} ${r1(u.y1 - u.y0 + 2 * pad)}`);
  drawHandles(); E.commit(true); Book.refresh(); E.place();
}
window.Draw = { inspect, layers, convertFigure, fit, clearClip() { clip = null; }, onBlockSelect(el) { if (shapes.length && layer !== el) { shapes = []; layer = null; drawHandles(); } }, get shapes() { return shapes; }, get tool() { return tool; }, get locked() { return locked; }, setTool };
E.renderInspector();
});

// Book Editor: a visual front end over chapter.html. The DOM on screen *is* the document; Book.serialize()
// turns it back into the chapter file. Undo, save and reload all work on that serialized text.
(async function () {
'use strict';
const $ = s => document.querySelector(s);
const ch = location.pathname.split('/').filter(Boolean).pop();
const book = $('#book'), desk = $('#desk'), insp = $('#insp'), status = $('#status');
// the canvas: #gsizer (takes the scaled size, so scrolling covers it) > #gworld (laid out once at 100%, then scaled
// as a whole by a CSS transform) > the chapter plus the preview columns. Zooming the canvas never re-lays anything out.
const gsizer = document.createElement('div'), gworld = document.createElement('div'); gsizer.id = 'gsizer'; gworld.id = 'gworld';
book.before(gsizer); gsizer.append(gworld); gworld.append(book);
const glabels = document.createElement('div'); glabels.id = 'glabels'; gsizer.before(glabels);   // column names, kept at the top of the canvas
const esc = Book.esc;
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const NOEDIT = /^(B-EQ|B-FIG|B-CODE|B-OUT|B-ANSWERS|B-TOC|B-EMBED|FIGURE|IMG|HR|SVG)$/i;

Book.mode = 'edit'; Book.chapter = ch; Book.base = '../c/' + ch + '/';
const info = await (await fetch('../api/info')).json();
Book.kit = info.kit;
let disk = await (await fetch('../api/chapter/' + ch)).json();
let mtime = disk.mtime;
Book.load(book, disk.content);
document.title = (Book.meta.title || ch) + ' · Book Editor';
$('#title').textContent = Book.meta.title || ch;
$('#view').href = '../view/' + ch;

// ---------------------------------------------------------------- state: selection, undo, save
let sel = null, curPage = null, extra = [], blockClip = null;   // sel = the main selected block, extra = the others in a multi-selection
let cur = '', saved = '', undo = [], redo = [], applying = false, saving = false, conflict = false, held = 0;
let savedLocal = !!info.offline;
if (info.offline) { const home = document.createElement('a'); home.href = '../'; home.className = 'btnlink'; home.textContent = '⌂'; home.title = 'All chapters'; home.style.cssText = 'color:#fff;background:transparent;border-color:rgba(255,255,255,.35)'; $('#bar').prepend(home); }   // the offline edition (service worker) saves to this device; GitHub sync is separate

function prep() {   // make text blocks editable; equations, figures and code are edited from the side panel
  for (const pg of Book.pages()) for (const el of Book.blocks(pg)) {
    if (NOEDIT.test(el.tagName) || (el.tagName === 'DIV' && !el.firstChild && el.className === 'rule')) continue;
    if (el.getAttribute('contenteditable') !== 'true') { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); }
  }
}
prep();
status.addEventListener('click', () => { commit(true); save(); });
poolSync(); if (Book.split) Book.markStale();
cur = saved = Book.serialize();
const normalized = cur !== disk.content;   // first save rewrites the file in the editor's fixed layout

function setStatus() {
  const dirty = cur !== saved;
  status.textContent = conflict ? (savedLocal ? 'Changed elsewhere' : 'Changed on disk') : saving ? 'Saving…' : dirty ? 'Unsaved' : savedLocal ? '✓ Saved on device' : '✓ Saved';
  status.className = conflict ? 'bad' : saving || dirty ? 'dirty' : 'ok';
  status.title = conflict ? 'chapter.html changed on disk while you had unsaved edits: choose in the banner' : dirty ? 'Click (or Cmd+S) to save now. Edits also save by themselves about a second after you stop.' : savedLocal ? 'Everything is saved on this device (it reaches GitHub when this device syncs)' : 'Everything is saved to chapter.html';
  $('#undo').disabled = !undo.length; $('#redo').disabled = !redo.length;
}
// Chrome types a non-breaking space next to elements and at the ends of text; turn those back into ordinary
// spaces (keeping the caret where it is), except at the very edge of a block where a plain space would collapse.
function denbsp() {
  const host = document.activeElement && document.activeElement.isContentEditable && book.contains(document.activeElement) ? document.activeElement : null;
  if (!host || host.textContent.indexOf('\u00a0') < 0) return;
  const s = getSelection(), keep = s.rangeCount ? [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset] : null;
  // judge each nbsp by the real characters around it in the block's text (empty text nodes and element
  // boundaries don't count); a <br> ends a line. Only a space with visible text on both sides becomes plain.
  const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: x => x.nodeType === 3 || x.nodeName === 'BR' ? 1 : 3 });
  const runs = []; let x; while ((x = w.nextNode())) runs.push(x);
  const charAt = (k, i, dir) => {   // the nearest character before (dir -1) or after (+1) position i of runs[k]
    for (let v = runs[k].nodeValue; ; ) {
      i += dir; if (i >= 0 && i < v.length) return v[i];
      k += dir; if (k < 0 || k >= runs.length || runs[k].nodeName === 'BR') return '';
      v = runs[k].nodeValue; i = dir > 0 ? -1 : v.length;
    }
  };
  let changed = false;
  runs.forEach((n, k) => {
    if (n.nodeType !== 3) return;
    const v = n.nodeValue; if (v.indexOf('\u00a0') < 0) return;
    let out = '';
    for (let i = 0; i < v.length; i++) {
      if (v[i] !== '\u00a0') { out += v[i]; continue; }
      const prev = charAt(k, i, -1), next = charAt(k, i, 1);
      out += prev && next && !/\s/.test(prev) && !/\s/.test(next) ? ' ' : '\u00a0';
    }
    if (out !== v) { n.nodeValue = out; changed = true; }
  });
  if (changed && keep && keep[0] && keep[0].isConnected) try { s.setBaseAndExtent(keep[0], keep[1], keep[2], keep[3]); } catch (e) {}
}
// Inline math must never lose its source. Some edits (seen once in the wild, likely the browser re-creating the
// element while typing around it) leave an empty <b-m>. If the paragraph still has the same number of math spans as
// in the last good version, put the lost sources back; otherwise leave it alone (it may be brand new math).
function mathGuard() {
  const empty = [...book.querySelectorAll('b-m')].filter(m => !(m.getAttribute('tex') || '').trim());
  if (!empty.length || !cur) return;
  const t = document.createElement('template'); t.innerHTML = Book.parse(cur).body;
  let fixed = 0;
  empty.forEach(m => {
    const pg = m.closest('section.page'), blk = pg && Book.blocks(pg).find(b => b.contains(m)); if (!blk) return;
    const old = t.content.getElementById ? t.content.getElementById(pg.id) : t.content.querySelector('#' + CSS.escape(pg.id)); if (!old) return;
    const k = Book.blocks(pg).indexOf(blk), ob = Book.blocks(old)[k]; if (!ob || ob.tagName !== blk.tagName) return;
    const now = [...blk.querySelectorAll('b-m')], was = [...ob.querySelectorAll('b-m')].map(x => (x.getAttribute('tex') || x.textContent).trim());
    if (now.length !== was.length) return;
    const i = now.indexOf(m); if (was[i]) { m.setAttribute('tex', was[i]); fixed++; }
  });
  if (fixed) toast(fixed === 1 ? 'Kept a piece of inline math that the browser had emptied' : `Kept ${fixed} pieces of inline math that the browser had emptied`);
}
let commitT = 0, saveT = 0;
// ---------------------------------------------------------------- split chapters: shared material and "slides changed" marks
// A block with data-pool="id" (figure, equation, code, table) appears once in the Lecture and once in the Reading.
// Edit either copy and the other follows on the next commit; each keeps its own layout (size, class, blanks).
var poolLast;   // pool id -> its content as of the last sync
const POOL_LAYOUT = ['style', 'class', 'data-view', 'data-fill', 'data-pool', 'contenteditable', 'spellcheck', 'draggable'];
function poolKey(el) { return Book.serializeBlock(el).replace(/ (style|class|data-view|data-fill|data-pool)="[^"]*"/g, ''); }
function poolSync() {
  const groups = {}; book.querySelectorAll('section.page > [data-pool]').forEach(el => { (groups[el.dataset.pool] = groups[el.dataset.pool] || []).push(el); });
  if (!poolLast) { poolLast = {}; for (const id in groups) poolLast[id] = poolKey(groups[id][0]); return; }
  let n = 0;
  for (const id in groups) {
    const els = groups[id], keys = els.map(poolKey);
    if (keys.every(k => k === keys[0])) { poolLast[id] = keys[0]; continue; }
    const k = keys.findIndex(x => x !== poolLast[id]); if (k < 0) continue;
    els.forEach((el, j) => {
      if (j === k || keys[j] === keys[k]) return;
      const t = h(Book.serializeBlock(els[k]));
      for (const a of [...t.attributes]) if (POOL_LAYOUT.includes(a.name)) t.removeAttribute(a.name);
      for (const a of [...el.attributes]) if (POOL_LAYOUT.includes(a.name)) t.setAttribute(a.name, a.value);
      el.replaceWith(t); n++;
    });
    poolLast[id] = keys[k];
  }
  if (n) { prep(); toast(n === 1 ? 'Updated the same piece in the ' + (Book.view === 'reading' ? 'Lecture' : 'Reading') + ' too' : `Updated ${n} shared pieces in the other document too`); }
}
let staleT = 0;
function staleSoon() { if (!Book.split) return; clearTimeout(staleT); staleT = setTimeout(() => { Book.markStale(); renderPages(); }, 400); }
function commit(now) {
  clearTimeout(commitT);
  const run = () => {
    if (applying || held) return;
    prep(); denbsp(); mathGuard(); poolSync();
    const s = Book.serialize();
    if (s === cur) return;
    undo.push(cur); if (undo.length > 300) undo.shift();
    redo = []; cur = s; setStatus();
    clearTimeout(saveT); saveT = setTimeout(save, 900);
    Book.refreshSoon(); staleSoon();
  };
  if (now) run(); else commitT = setTimeout(run, 350);
}
async function save(force) {
  if (saving || (conflict && !force) || cur === saved) return setStatus();
  saving = true; setStatus();
  const content = cur;
  try {
    const r = await fetch('../api/chapter/' + ch, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, base: mtime, force: !!force }) });
    const d = await r.json();
    if (r.status === 409) { conflict = true; showConflict(); }
    else if (r.ok) { mtime = d.mtime; saved = content; savedLocal = !!d.local; conflict = false; $('#banner').hidden = true; gridAfterSave(); }
    else toast('Could not save: ' + (d.error || r.status));
  } catch (e) { toast('Could not save (is the server still running?)'); }
  saving = false; setStatus();
  if (cur !== saved && !conflict) { clearTimeout(saveT); saveT = setTimeout(save, 900); }
}
function apply(s, external) {   // replace the document with chapter text s, touching only the pages that changed
  applying = true;
  const { meta, body } = Book.parse(s);
  const metaChanged = JSON.stringify(meta) !== JSON.stringify(Book.meta);
  Book.meta = meta;
  const chunks = body.trim().split(/\n\n(?=<section[ >])/), now = Book.pages();
  const idOf = c => (/^<section[^>]*\bid="([^"]*)"/.exec(c) || [])[1];
  const same = !metaChanged && chunks.length === now.length && book.childElementCount === now.length && chunks.every((c, k) => idOf(c) === now[k].id);
  const keepId = sel && sel.parentElement ? [sel.parentElement.id, Book.blocks(sel.parentElement).indexOf(sel)] : null, pageId = curPage && curPage.id;
  select(null, true);
  if (same) {
    now.forEach((pg, k) => {
      if (Book.serializePage(pg) === chunks[k]) return;
      const t = document.createElement('template'); t.innerHTML = chunks[k]; pg.replaceWith(t.content.firstElementChild);
    });
  } else book.innerHTML = body;
  curPage = null;
  prep(); Book.refresh();
  cur = external ? Book.serialize() : s; applying = false; poolLast = null; poolSync(); staleSoon();
  const pg = keepId && pageById(keepId[0]), b = pg && Book.blocks(pg)[keepId[1]];
  if (b) select(b); else { setPage(pageId && pageById(pageId)); renderInspector(); }
  if (metaChanged) $('#title').textContent = Book.meta.title || ch;
  setStatus(); renderPages();
  mo.takeRecords();
}
function doUndo() { commit(true); if (!undo.length) return; redo.push(cur); apply(undo.pop()); clearTimeout(saveT); saveT = setTimeout(save, 900); }
function doRedo() { commit(true); if (!redo.length) return; undo.push(cur); apply(redo.pop()); clearTimeout(saveT); saveT = setTimeout(save, 900); }
const mo = new MutationObserver(() => { if (!applying) commit(); });
mo.observe(book, { childList: true, subtree: true, characterData: true, attributes: true });

// external changes (Claude or a text editor writing chapter.html)
function showConflict() {
  const b = $('#banner'); b.hidden = false;
  b.innerHTML = '<b>chapter.html changed on disk</b> while you have unsaved edits here. <button id="c-disk">Load the disk version</button><button id="c-mine">Keep mine (overwrite)</button>';
  $('#c-disk').onclick = async () => { const d = await (await fetch('../api/chapter/' + ch)).json(); undo.push(cur); mtime = d.mtime; apply(d.content, true); saved = cur; conflict = false; b.hidden = true; setStatus(); };
  $('#c-mine').onclick = () => { b.hidden = true; save(true); };
}
setInterval(async () => {
  if (document.hidden || saving || conflict) return;
  try {
    const d = await (await fetch('../api/stat/' + ch)).json();
    if (d.mtime === mtime || saving) return;
    if (cur !== saved) { conflict = true; setStatus(); return showConflict(); }
    const f = await (await fetch('../api/chapter/' + ch)).json();
    mtime = f.mtime;
    const before = cur; apply(f.content, true); saved = cur;
    if (cur !== before) { undo.push(before); redo = []; setStatus(); toast('Reloaded: chapter.html changed on disk', 'Undo', doUndo); }
  } catch (e) { /* server down; the save path reports it */ }
}, 2000);

// ---------------------------------------------------------------- small UI helpers
let toastT = 0;
function toast(msg, action, fn) {
  const t = $('#toast'); t.hidden = false; t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action; b.onclick = () => { t.hidden = true; fn(); }; t.append(b); }
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}
function modal(html) { const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="box">${html}</div>`; m.onclick = e => { if (e.target === m) m.hidden = true; }; return m.firstElementChild; }
const blockOf = n => { while (n && n !== book) { if (n.parentElement && n.parentElement.matches && n.parentElement.matches('section.page') && n.parentElement.parentElement === book) return n.hasAttribute && (n.hasAttribute('data-rt') || n.classList.contains('overlay')) ? null : n; n = n.parentNode; } return null; };
const pageOf = n => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return e ? e.closest('section.page') : null; };
const deskXY = r => { const d = desk.getBoundingClientRect(); return [r.left - d.left + desk.scrollLeft, r.top - d.top + desk.scrollTop]; };
const ptScale = pg => pg.getBoundingClientRect().width / 432;   // screen px per pt, zoom included
const pageById = id => id ? book.querySelector(':scope > section.page#' + CSS.escape(id)) : null;
// review comments sit right after the block they are about (<div class="cmt">); they move, and go, with it
const tail = el => { const out = []; let n = el && el.nextElementSibling; while (n && n.classList.contains('cmt')) { out.push(n); n = n.nextElementSibling; } return out; };
const lastOf = el => tail(el).pop() || el;
const carry = (el, t) => { let at = el; t.forEach(c => { at.after(c); at = c; }); };
const uid = () => 'p-' + Math.random().toString(36).slice(2, 7);

// ---------------------------------------------------------------- selection + block bar
const allSel = () => { extra = extra.filter(b => b.isConnected && b !== sel); return sel && sel.isConnected ? [sel, ...extra] : []; };
const inOrder = list => { const pages = Book.pages(); return [...list].sort((a, b) => pages.indexOf(a.parentElement) - pages.indexOf(b.parentElement) || (a.compareDocumentPosition(b) & 4 ? -1 : 1)); };
function select(el, keepPanel, add) {
  if (add && sel && el && el !== sel) {   // add to / take out of the selection
    if (extra.includes(el)) { extra = extra.filter(b => b !== el); el.classList.remove('ed-sel'); el = sel; }
    else extra.push(sel);
  } else if (!add) { extra.forEach(b => b.classList.remove('ed-sel')); extra = []; }
  if (sel && sel !== el && !extra.includes(sel)) sel.classList.remove('ed-sel');
  sel = el;
  if (el) { el.classList.add('ed-sel'); setPage(el.parentElement); }
  if (el && !el.isContentEditable && document.activeElement && book.contains(document.activeElement)) { document.activeElement.blur(); getSelection().removeAllRanges(); }
  if (window.Draw) Draw.onBlockSelect(el);
  place();
  if (!keepPanel) renderInspector();
}
function setPage(pg) {
  if (curPage === pg) return;
  if (curPage) curPage.classList.remove('ed-cur');
  curPage = pg; if (pg) pg.classList.add('ed-cur');
  focusChanged(); placeAdders();
  document.querySelectorAll('#pages > li').forEach(li => li.classList.toggle('cur', pg && li.dataset.id === pg.id));
  revealPageRow();
}
// keep the current page's row visible in the page list (scrolls only the list, centring the row when it's out of view)
function revealPageRow() {
  const ol = $('#pages'), li = ol && ol.querySelector(':scope > li.cur'); if (!li || !ol.clientHeight) return;
  const r = li.getBoundingClientRect(), b = ol.getBoundingClientRect();
  if (r.top < b.top || r.bottom > b.bottom) ol.scrollTo({ top: ol.scrollTop + (r.top - b.top) - (b.height - r.height) / 2, behavior: 'smooth' });
}
function place() {
  placeAdders();
  const bar = $('#blockbar'), rsz = $('#rsz');
  if (!sel || !sel.isConnected) { bar.hidden = rsz.hidden = true; $('#rszb').hidden = true; placeCrop(); placeMarkers(); placeRulers(); return; }
  const r = sel.getBoundingClientRect(), [x, y] = deskXY(r);
  bar.hidden = false; bar.style.left = Math.max(2, x - 34) + 'px'; bar.style.top = y + 'px';
  bar.querySelector('[data-act=pin]').classList.toggle('on', Book.isPinned(sel));
  bar.querySelector('[data-act=code]').hidden = sel.tagName !== 'B-FIG' || !!extra.length;
  bar.querySelector('[data-act=center]').classList.toggle('on', sel.getAttribute('data-align') === 'center');
  const sizable = Book.isPinned(sel) || sel.tagName === 'B-FIG' || sel.localName === 'svg';
  rsz.hidden = !sizable;
  if (sizable) { rsz.style.left = (x + r.width - 3) + 'px'; rsz.style.top = (y + r.height / 2 - 13) + 'px'; }
  const canvas = sel.localName === 'svg' && !extra.length; $('#rszb').hidden = !canvas;
  if (canvas) { $('#rszb').style.left = (x + r.width / 2 - 13) + 'px'; $('#rszb').style.top = (y + r.height - 5) + 'px'; }
  placeCrop(); placeMarkers(); placeRulers();
  if (typeof placeFigCode === 'function') placeFigCode();
}
desk.addEventListener('scroll', place);
window.addEventListener('resize', place);
book.addEventListener('book-refresh', () => { place(); renderPages(); });

book.addEventListener('mousedown', e => {
  const b = blockOf(e.target);
  if (b && (e.shiftKey || e.metaKey || e.ctrlKey) && sel && b !== sel) { e.preventDefault(); if (document.activeElement && book.contains(document.activeElement)) { document.activeElement.blur(); getSelection().removeAllRanges(); } return select(b, false, true); }
  if (b && extra.length && allSel().includes(b) && !b.isContentEditable) return;   // keep the group when grabbing one of its members
  if (b) { if (b !== sel || extra.length) select(b); }
  else { const pg = pageOf(e.target); if (document.activeElement && book.contains(document.activeElement)) document.activeElement.blur(); select(null); setPage(pg); renderInspector(); }
});
book.addEventListener('dblclick', e => { const q = e.target.closest && e.target.closest('b-eq'); if (q && blockOf(q) === q) { const ta = insp.querySelector('.eqrow textarea'); if (ta) { ta.focus(); ta.select(); } } });
book.addEventListener('focusin', e => { const b = blockOf(e.target); if (b && b !== sel && !extra.includes(b)) select(b); });
book.addEventListener('click', e => {
  const m = e.target.closest && e.target.closest('b-m');
  if (m) return mathPop(m);
  const r = e.target.closest && e.target.closest('b-ref');
  if (r) { e.preventDefault(); return refPop(r); }
  const a = e.target.closest && e.target.closest('a'); if (a && !a.closest('[data-rt]') && a.closest('[contenteditable=true]')) { e.preventDefault(); return linkPop(a); }
  if (a) e.preventDefault();
});

// ---------------------------------------------------------------- block operations
function insertAfter(node, ref) {
  let pg = ref ? ref.parentElement : curPage || Book.pages().find(p => { const r = p.getBoundingClientRect(), d = desk.getBoundingClientRect(); return r.bottom > d.top + 80; }) || Book.pages()[0];
  if (ref) lastOf(ref).after(node); else { const foot = pg.querySelector(':scope > .foot'); pg.insertBefore(node, foot); }
  prep(); select(node); commit(true); Book.refresh();
  node.scrollIntoView({ block: 'nearest' });
  return node;
}
function focusIn(el, atEnd) {
  const host = el.closest('[contenteditable=true]') || el; host.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
const TEMPLATES = {
  p: '<p></p>', h3: '<h3>Subheading</h3>', aside: '<p class="aside"><b>Note:</b> text</p>',
  eq: '<b-eq><eq-row>x = y</eq-row></b-eq>',
  ul: '<ul class="cases"><li>First point</li><li>Second point</li></ul>',
  table: '<table class="tbl"><thead><tr><th>Column</th><th>Column</th><th>Column</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td></tr><tr><td>—</td><td>—</td><td>—</td></tr></tbody></table>',
  qc: '<aside class="qc"><b>Quick check:</b> question<div class="ans">answer</div></aside>',
  draw: '<svg class="draw" viewBox="0 0 384 180"></svg>',
  toc: '<b-toc></b-toc>',
  embed: '<b-embed src="" title="Interactive" height="640"></b-embed>',
};
function insert(kind) {
  if (kind === 'fig') return pickFigure(src => insertAfter(h(`<b-fig src="${src}"></b-fig>`), sel));
  if (kind === 'viz') { const f = insertAfter(h('<b-fig src="" viz=""></b-fig>'), sel); select(f); return setupViz(f, true); }
  if (kind === 'code') { const c = insertAfter(h('<b-code lang="python">\nprint("hello")\n</b-code>'), sel); c.after(h('<b-out>\nhello\n</b-out>')); select(c); commit(true); return; }
  const n = insertAfter(h(TEMPLATES[kind]), sel);
  if (n.isContentEditable) { focusIn(n.tagName === 'UL' ? n.firstElementChild : n, kind === 'p'); if (kind !== 'p') getSelection().selectAllChildren(n.tagName === 'UL' ? n.firstElementChild : n); }
  if (kind === 'eq') { const ta = insp.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } }
}
$('#insert').addEventListener('mousedown', e => e.preventDefault());
$('#insert').addEventListener('click', e => { const k = e.target.dataset && e.target.dataset.ins; if (k) insert(k); });

function removeAll() { const list = allSel(); if (list.length < 2) return removeBlock(sel); commit(true); select(null); list.forEach(b => { tail(b).forEach(c => c.remove()); b.remove(); }); commit(true); Book.refresh(); }
function duplicateAll() { const list = inOrder(allSel()); if (list.length < 2) return duplicate(sel); commit(true); const last = list[list.length - 1]; const copies = list.map(b => h(Book.serializeBlock(b))); let at = last; copies.forEach(c => { at.after(c); at = c; }); prep(); selectMany(copies); commit(true); Book.refresh(); }
function selectMany(list) { select(null, true); if (!list.length) return renderInspector(); select(list[0], true); list.slice(1).forEach(b => select(b, true, true)); place(); renderInspector(); }
function moveAll(d) { const list = inOrder(allSel()); if (list.length < 2) return moveBy(sel, d); const pg = list[0].parentElement; if (list.some(b => b.parentElement !== pg)) return; const flow = Book.blocks(pg), idx = list.map(b => flow.indexOf(b)); const other = d < 0 ? flow[Math.min(...idx) - 1] : flow[Math.max(...idx) + 1]; if (!other) return; commit(true); const ot = tail(other); if (d < 0) lastOf(list[list.length - 1]).after(other); else list[0].before(other); carry(other, ot); commit(true); Book.refresh(); place(); }
function copyBlocks(cut) { const list = inOrder(allSel()); if (!list.length) return; blockClip = list.map(b => Book.serializeBlock(b)); if (window.Draw) Draw.clearClip(); toast(`${list.length} block${list.length > 1 ? 's' : ''} copied: Cmd+V pastes after the selected block, on any page`); if (cut) removeAll(); }
function pasteBlocks() { if (!blockClip) return false; commit(true); const copies = blockClip.map(src => h(src)); let at = sel && sel.isConnected ? inOrder(allSel()).pop() : null; const pg = curPage || Book.pages()[0]; copies.forEach(c => { if (at) at.after(c); else pg.insertBefore(c, pg.querySelector(':scope > .foot')); at = c; }); prep(); selectMany(copies); commit(true); Book.refresh(); copies[0].scrollIntoView({ block: 'nearest' }); return true; }
function alignBlocks(a) {
  const list = allSel().filter(Book.isPinned); if (list.length < 2) return;
  commit(true);
  const pg = list[0].parentElement, s = ptScale(pg), q = pg.getBoundingClientRect(), bs = list.map(b => { const r = b.getBoundingClientRect(); return { b, x0: (r.left - q.left) / s, y0: (r.top - q.top) / s, x1: (r.right - q.left) / s, y1: (r.bottom - q.top) / s }; });
  const u = { x0: Math.min(...bs.map(o => o.x0)), y0: Math.min(...bs.map(o => o.y0)), x1: Math.max(...bs.map(o => o.x1)), y1: Math.max(...bs.map(o => o.y1)) };
  const shift = (o, dx, dy) => { o.b.style.left = (parseFloat(o.b.style.left) + dx).toFixed(1) + 'pt'; o.b.style.top = (parseFloat(o.b.style.top) + dy).toFixed(1) + 'pt'; };
  if (a === 'dh' || a === 'dv') { const ax = a === 'dh'; bs.sort((m, n) => ax ? m.x0 - n.x0 : m.y0 - n.y0); const total = bs.reduce((t, o) => t + (ax ? o.x1 - o.x0 : o.y1 - o.y0), 0), gap = ((ax ? u.x1 - u.x0 : u.y1 - u.y0) - total) / (bs.length - 1); let pos = ax ? u.x0 : u.y0; bs.forEach(o => { shift(o, ax ? pos - o.x0 : 0, ax ? 0 : pos - o.y0); pos += (ax ? o.x1 - o.x0 : o.y1 - o.y0) + gap; }); }
  else if (a === 'w') { const w = Math.max(...bs.map(o => o.x1 - o.x0)); bs.forEach(o => { o.b.style.width = w.toFixed(1) + 'pt'; }); }
  else bs.forEach(o => shift(o, a === 'l' ? u.x0 - o.x0 : a === 'r' ? u.x1 - o.x1 : a === 'c' ? (u.x0 + u.x1 - o.x0 - o.x1) / 2 : a === 'pc' ? 216 - (o.x0 + o.x1) / 2 : 0, a === 't' ? u.y0 - o.y0 : a === 'b' ? u.y1 - o.y1 : a === 'm' ? (u.y0 + u.y1 - o.y0 - o.y1) / 2 : 0));
  commit(true); Book.refresh(); place();
}
function removeBlock(el) {
  const next = el.nextElementSibling && !el.nextElementSibling.hasAttribute('data-rt') ? el.nextElementSibling : el.previousElementSibling;
  commit(true); tail(el).forEach(c => c.remove()); el.remove(); select(next && !next.hasAttribute('data-rt') && !next.classList.contains('cmt') ? next : null); commit(true); Book.refresh();
}
// split the page: this block and everything after it in the flow move to a new page right after this one
// (the new page keeps this page's settings, e.g. which editions it is in; pinned blocks and drawings stay where they are)
function splitPage(el) {
  if (!el || !el.isConnected || Book.isPinned(el)) return toast('Select a block in the text flow to split the page there');
  const pg = el.closest('section.page'); if (!pg || pg.classList.contains('cover')) return;
  if (Book.blocks(pg).filter(b => !Book.isPinned(b))[0] === el) return toast('That is already the first block on the page');
  commit(true);
  const np = document.createElement('section');
  np.className = [...pg.classList].filter(c => !c.startsWith('ed-')).join(' '); np.id = uid();
  for (const a of [...pg.attributes]) if (!['id', 'class', 'data-part', 'contenteditable', 'spellcheck'].includes(a.name)) np.setAttribute(a.name, a.value);
  const moving = []; let n = el;
  while (n) { if (!n.hasAttribute('data-rt') && !n.classList.contains('foot') && !n.matches('svg.overlay') && !Book.isPinned(n)) moving.push(n); n = n.nextElementSibling; }
  moving.forEach(m => np.append(m));
  pg.after(np); prep(); Book.refresh(); commit(true); setPage(np); select(el);
  np.scrollIntoView({ block: 'start' }); toast('Split: the rest of the page is now on a new page', 'Undo', doUndo);
}
function duplicate(el) { commit(true); const c = h(Book.serializeBlock(el)); el.after(c); prep(); select(c); commit(true); Book.refresh(); }
function togglePin(el) {
  commit(true);
  if (Book.isPinned(el)) { for (const p of ['position', 'left', 'top', 'width', 'z-index']) el.style.removeProperty(p); if (!el.getAttribute('style')) el.removeAttribute('style'); }
  else {
    const pg = el.parentElement, s = ptScale(pg), r = el.getBoundingClientRect(), q = pg.getBoundingClientRect();
    el.style.position = 'absolute';
    el.style.left = ((r.left - q.left) / s).toFixed(1) + 'pt'; el.style.top = ((r.top - q.top) / s).toFixed(1) + 'pt'; el.style.width = (r.width / s).toFixed(1) + 'pt';
  }
  commit(true); Book.refresh(); select(el);
}
function moveBy(el, d) {
  const flow = Book.blocks(el.parentElement), k = flow.indexOf(el), other = flow[k + d];
  if (!other) return;
  commit(true); const t = tail(el); if (d < 0) other.before(el); else lastOf(other).after(el); carry(el, t); commit(true); Book.refresh(); place();
}
$('#blockbar').addEventListener('mousedown', e => e.preventDefault());
$('#blockbar').addEventListener('click', e => {
  const btn = e.target.closest('button'), a = btn && btn.dataset.act; if (!a || !sel) return;
  if (a === 'cmt') return addComment(sel);
  if (a === 'code') return flipFig(sel);
  if (a === 'center') return toggleCenter();
  if (a === 'split') return splitPage(sel);
  if (a === 'up') moveAll(-1); else if (a === 'down') moveAll(1); else if (a === 'dup') duplicateAll(); else if (a === 'pin') { const list = allSel(), on = !Book.isPinned(sel); list.forEach(b => { if (Book.isPinned(b) !== on) togglePin(b); }); if (list.length > 1) selectMany(list); } else if (a === 'del') removeAll();
});

// ---------------------------------------------------------------- drag: reorder in the flow, or move a pinned block freely (with snapping)
var dragMoved = false;
function startDrag(e, el) {
  const group = allSel().includes(el) && extra.length ? inOrder(allSel()) : [el];
  const mates = group.filter(b => b !== el && Book.isPinned(b)).map(b => [b, parseFloat(b.style.left), parseFloat(b.style.top)]);
  const pinned = Book.isPinned(el), x0 = e.clientX, y0 = e.clientY;
  let moved = false, target = null;
  const pg0 = el.parentElement, r0 = el.getBoundingClientRect(), q0 = pg0.getBoundingClientRect();
  const drop = $('#drop'), gx = $('#gx'), gy = $('#gy');
  let last = null, scroll0 = desk.scrollTop;
  const auto = setInterval(() => {   // scroll the desk while dragging near its top or bottom edge
    if (!moved || !last) return;
    const d = desk.getBoundingClientRect(), v = last.clientY < d.top + 45 ? -16 : last.clientY > d.bottom - 45 ? 16 : 0;
    if (v) { desk.scrollTop += v; move(last); }
  }, 30);
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    if (!moved) { moved = true; commit(true); el.classList.add('ed-dragging'); closePop(); }
    if (ev.preventDefault && ev.cancelable) ev.preventDefault();
    last = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
    const under = document.elementsFromPoint(ev.clientX, ev.clientY).find(n => n.matches && n.matches('section.page'));
    if (pinned) {
      const pg = el.parentElement, s = ptScale(pg), q = pg.getBoundingClientRect();
      let x = (r0.left - q0.left + ev.clientX - x0) / s, y = (r0.top - q0.top + ev.clientY - y0 + desk.scrollTop - scroll0) / s;
      const w = r0.width / s, hh = r0.height / s;
      gx.hidden = gy.hidden = true;
      if (!ev.altKey) {
        const others = Book.blocks(pg).filter(b => b !== el).map(b => { const r = b.getBoundingClientRect(); return { l: (r.left - q.left) / s, t: (r.top - q.top) / s, b: (r.bottom - q.top) / s, r: (r.right - q.left) / s }; });
        const xs = [[24, 0], [408, w], [216, w / 2], ...others.flatMap(o => [[o.l, 0], [o.r, w]]), ...(rulersOn ? guides.v.flatMap(g => [[g, 0], [g, w], [g, w / 2]]) : [])];
        const ys = [[20, 0], ...others.flatMap(o => [[o.t, 0], [o.b, hh], [o.b + 10, 0], [o.t - 10, hh]]), ...(rulersOn ? guides.h.flatMap(g => [[g, 0], [g, hh], [g, hh / 2]]) : [])];
        let best = 4;
        for (const [g, off] of xs) if (Math.abs(x + off - g) < best) { best = Math.abs(x + off - g); gx._v = g; gx._x = g - off; }
        if (best < 4) { x = gx._x; const [ax, ay] = deskXY({ left: q.left + gx._v * s, top: q.top }); gx.hidden = false; Object.assign(gx.style, { left: ax + 'px', top: ay + 'px', width: '1px', height: q.height + 'px' }); }
        best = 4;
        for (const [g, off] of ys) if (Math.abs(y + off - g) < best) { best = Math.abs(y + off - g); gy._v = g; gy._y = g - off; }
        if (best < 4) { y = gy._y; const [ax, ay] = deskXY({ left: q.left, top: q.top + gy._v * s }); gy.hidden = false; Object.assign(gy.style, { left: ax + 'px', top: ay + 'px', height: '1px', width: q.width + 'px' }); }
      }
      const mdx = x - parseFloat(el.dataset.edX0 || (el.dataset.edX0 = el.style.left)), mdy = y - parseFloat(el.dataset.edY0 || (el.dataset.edY0 = el.style.top));
      el.style.left = x.toFixed(1) + 'pt'; el.style.top = y.toFixed(1) + 'pt';
      mates.forEach(([b, l, t]) => { b.style.left = (l + mdx).toFixed(1) + 'pt'; b.style.top = (t + mdy).toFixed(1) + 'pt'; });
      target = under && under !== pg && !mates.length ? under : null;
      place(); return;
    }
    if (!under) { drop.hidden = true; target = null; return; }
    const flow = Book.blocks(under).filter(b => !group.includes(b) && !Book.isPinned(b));
    const before = flow.find(b => { const r = b.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) || null;
    target = { page: under, before };
    const q = under.getBoundingClientRect(), s = q.width / 432;
    let yy; if (before) yy = before.getBoundingClientRect().top - 5 * s; else if (flow.length) yy = flow[flow.length - 1].getBoundingClientRect().bottom + 5 * s; else yy = q.top + 20 * s;
    const [ax, ay] = deskXY({ left: q.left + 24 * s, top: yy });
    drop.hidden = false; Object.assign(drop.style, { left: ax + 'px', top: ay + 'px', width: (384 * s) + 'px' });
  };
  const up = () => {
    window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    if (moved) { dragMoved = true; setTimeout(() => { dragMoved = false; }, 0); }   // the click that ends a drag doesn't open the code for typing
    clearInterval(auto);
    drop.hidden = gx.hidden = gy.hidden = true;
    delete el.dataset.edX0; delete el.dataset.edY0;
    if (!moved) return;
    el.classList.remove('ed-dragging');
    if (pinned && target) {   // dropped on another page: keep the spot under the pointer
      const r = el.getBoundingClientRect(), q = target.getBoundingClientRect(), s = q.width / 432;
      target.insertBefore(el, target.querySelector(':scope > .foot'));
      el.style.left = ((r.left - q.left) / s).toFixed(1) + 'pt'; el.style.top = ((r.top - q.top) / s).toFixed(1) + 'pt';
    } else if (!pinned && target) {
      const movers = group.filter(b => !Book.isPinned(b));
      movers.forEach(b => { const t = tail(b); if (target.before) target.before.before(b); else target.page.insertBefore(b, target.page.querySelector(':scope > svg.overlay, :scope > .foot')); carry(b, t); });
    }
    if (group.length > 1) selectMany(group); else select(el);
    commit(true); Book.refresh(); place();
  };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
}
$('#grip').addEventListener('pointerdown', e => { if (sel) { e.preventDefault(); startDrag(e, sel); } });
book.addEventListener('pointerdown', e => { const b = blockOf(e.target); if (e.target.closest && e.target.closest('.ed-code, .ed-coderun')) return; if (b && NOEDIT.test(b.tagName) && e.button === 0 && !(e.shiftKey || e.metaKey || e.ctrlKey)) { if (!(extra.length && allSel().includes(b))) select(b); startDrag(e, b); } });
$('#rsz').addEventListener('pointerdown', e => {
  if (!sel) return; e.preventDefault(); commit(true);
  const el = sel, pg = el.parentElement, pinned = Book.isPinned(el);
  const move = ev => {
    const s = ptScale(pg), r = el.getBoundingClientRect();
    if (pinned) el.style.width = Math.max(30, (ev.clientX - r.left) / s).toFixed(1) + 'pt';
    else { const c = r.left + r.width / 2; let pct = Math.round(2 * Math.abs(ev.clientX - c) / (384 * s) * 100); pct = Math.max(15, Math.min(100, pct)); el.style.width = pct + '%'; }
    place();
  };
  const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); commit(true); Book.refresh(); renderInspector(); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
});

// ---------------------------------------------------------------- text: emphasis, math, references
const editHost = () => { const s = getSelection(); if (!s.rangeCount) return null; const n = s.anchorNode; const e = n && (n.nodeType === 1 ? n : n.parentElement); const hst = e && e.closest('[contenteditable=true]'); return hst && book.contains(hst) ? hst : null; };
function unwrap(el) { const p = el.parentNode; while (el.firstChild) p.insertBefore(el.firstChild, el); el.remove(); p.normalize(); }
function wrapSel(tag, cls) {
  const host = editHost(); if (!host) return toast('Click into some text first');
  const s = getSelection(), r = s.getRangeAt(0);
  const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  const inside = anc.closest(tag);
  if (inside && host.contains(inside) && inside !== host) {
    if ((inside.className || '') === (cls || '')) unwrap(inside); else inside.className = cls || '';
    return commit(true);
  }
  if (r.collapsed) return toast('Select some text first');
  const frag = r.extractContents();
  frag.querySelectorAll(tag).forEach(unwrap);
  const el = document.createElement(tag); if (cls) el.className = cls; el.append(frag);
  r.insertNode(el); s.selectAllChildren(el); commit(true);
}
function clearSel() {
  const host = editHost(); if (!host) return;
  const s = getSelection(), r = s.getRangeAt(0);
  let n = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  const hit = [];
  while (n && n !== host) { if (/^(B|I|CODE|EM|STRONG|U)$/.test(n.tagName) || n.matches('span.key, span.mono, span.num')) hit.push(n); n = n.parentElement; }
  if (!r.collapsed) host.querySelectorAll('b,i,code,em,strong,u,span.key,span.mono,span.num').forEach(e => { if (r.intersectsNode(e) && !hit.includes(e) && !e.closest('.ans, th') ) hit.push(e); });
  hit.forEach(unwrap); commit(true);
}
const ALIAS = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', phi: 'φ', varphi: 'φ', eta: 'η', rho: 'ρ', tau: 'τ', omega: 'ω', xi: 'ξ',
  Sigma: 'Σ', sum: 'Σ', ge: '≥', geq: '≥', le: '≤', leq: '≤', ne: '≠', neq: '≠', cdot: '·', times: '×', pm: '±', in: '∈', approx: '≈', infty: '∞', sqrt: '√', norm: '‖', half: '½', prime: '′', yhat: 'ŷ', to: '→', partial: '∂' };
const mathNorm = (s, final) => (final ? s + '\n' : s).replace(/\\([A-Za-z]+)(?=[^A-Za-z])/g, (m, w) => ALIAS[w] ? ALIAS[w] : m).replace(/'/g, '′').normalize('NFC');
function insertMath() {
  const host = editHost(); if (!host) return toast('Click into some text first');
  const s = getSelection(), r = s.getRangeAt(0);
  const m = document.createElement('b-m'); m.setAttribute('tex', mathNorm(r.toString(), true).trim());
  r.deleteContents(); r.insertNode(m);
  commit(true); mathPop(m);
}
function caretAfter(el) { const host = el.closest('[contenteditable=true]'); if (!host) return; host.focus(); const r = document.createRange(); r.setStartAfter(el); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
let popFor = null;
function closePop() { const p = $('#pop'); if (p.hidden) return; p.hidden = true; if (popFor) { popFor.classList.remove('ed-open'); if (!popFor.getAttribute('class')) popFor.removeAttribute('class'); if (popFor.tagName === 'B-M' && !(popFor.getAttribute('tex') || '').trim()) popFor.remove(); else if (popFor.tagName === 'A' && !popFor.getAttribute('href')) unwrap(popFor); } popFor = null; }
function openPop(el, html) {
  closePop(); const p = $('#pop'); p.innerHTML = html; p.hidden = false; popFor = el; el.classList.add('ed-open');
  const r = el.getBoundingClientRect(), [x, y] = deskXY(r);
  p.style.left = Math.max(4, Math.min(x, desk.scrollLeft + desk.clientWidth - 340)) + 'px'; p.style.top = (y + r.height + 6) + 'px';
  return p;
}
function mathPop(m) {
  const p = openPop(m, `<input type="text" spellcheck="false"><div class="hint"><code>x_i</code> subscript · <code>^2</code> power · <code>x_{ij}</code> group · <code>\\T</code> transpose · <code>\\alpha \\ge \\sum \\norm \\half \\yhat</code> become α ≥ Σ ‖ ½ ŷ · <code>'</code> prime. Symbols in the chapter's colour list are coloured automatically. Enter to finish.</div>`);
  const inp = p.querySelector('input'); inp.value = m.getAttribute('tex') || ''; inp.focus(); inp.select();
  inp.oninput = () => { const a = inp.selectionStart, before = inp.value, v = mathNorm(before); if (v !== before) { inp.value = v; const pos = Math.max(0, a - (before.length - v.length)); inp.setSelectionRange(pos, pos); } m.setAttribute('tex', v); place(); };
  inp.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); m.setAttribute('tex', mathNorm(inp.value, true).trim()); const keep = m.getAttribute('tex'); closePop(); if (keep) caretAfter(m); commit(true); } };
}
function refPop(r) {
  const pages = Book.pages(), cur = r.getAttribute('page') || (r.getAttribute('pages') || '').split(':')[0];
  const opts = sel0 => pages.map((p, k) => `<option value="${p.id}"${p.id === sel0 ? ' selected' : ''}>${k + 1} · ${esc((p.querySelector('h2,h1') || {}).textContent || p.id)}</option>`).join('');
  const kind = r.hasAttribute('eq') ? 'eq' : r.hasAttribute('pages') ? 'pages' : 'page';
  const nums = Object.entries(Book.eqNums).map(([l, n]) => [l, `[${n}] ` + ((book.querySelector(`eq-row[label="${l}"]`) || { getAttribute: () => '' }).getAttribute('note') || l)]);
  const p = openPop(r, `<select id="rk"><option value="page">Page</option><option value="pages">Page range</option><option value="eq">Equation</option></select>
    <div id="rb" style="margin-top:6px"></div>`);
  const body = p.querySelector('#rb'), rk = p.querySelector('#rk'); rk.value = kind;
  const draw = () => {
    const k = rk.value;
    body.innerHTML = k === 'eq' ? `<select id="r1">${nums.map(([l, t]) => `<option value="${esc(l)}"${l === r.getAttribute('eq') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : k === 'page' ? `<select id="r1">${opts(cur)}</select>` : `<select id="r1">${opts(cur)}</select><select id="r2" style="margin-top:4px">${opts((r.getAttribute('pages') || '').split(':')[1])}</select>`;
    const set = () => { for (const a of ['page', 'pages', 'eq']) r.removeAttribute(a); const v1 = body.querySelector('#r1').value; r.setAttribute(k, k === 'pages' ? v1 + ':' + body.querySelector('#r2').value : v1); Book.refresh(); commit(true); };
    body.querySelectorAll('select').forEach(s => { s.onchange = set; });
    if (k !== kind || !r.getAttribute(k)) set();
  };
  rk.onchange = draw; draw();
}
function linkPop(a) {   // add, change or remove a link on the selected text
  const host = editHost();
  if (!a) {
    if (!host) return toast('Click into some text first');
    const s = getSelection(), r = s.getRangeAt(0), anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    a = anc.closest('a');
    if (!a) { if (r.collapsed) return toast('Select the words to turn into a link'); a = document.createElement('a'); a.setAttribute('href', ''); a.append(r.extractContents()); r.insertNode(a); }
  }
  const p = openPop(a, `<input type="text" spellcheck="false" placeholder="https://… (or #page-id)" style="font-family:var(--font-mono);font-size:12px"><div class="row" style="margin-top:6px;display:flex;gap:4px"><button data-a="ok" class="primary">Done</button><button data-a="rm">Remove link</button></div>`);
  const inp = p.querySelector('input'); inp.value = a.getAttribute('href') || ''; inp.focus(); inp.select();
  const done = rm => { const v = inp.value.trim(); if (rm || !v) unwrap(a); else a.setAttribute('href', /^(https?:|mailto:|#|\/)/.test(v) ? v : 'https://' + v); popFor = null; $('#pop').hidden = true; a.classList && a.classList.remove('ed-open'); if (!a.getAttribute('class')) a.removeAttribute('class'); commit(true); };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(false); } };
  p.querySelector('[data-a=ok]').onclick = () => done(false); p.querySelector('[data-a=rm]').onclick = () => done(true);
}
function insertRef() {
  const host = editHost(); if (!host) return toast('Click into some text first');
  const r = getSelection().getRangeAt(0); const el = document.createElement('b-ref'); el.setAttribute('page', (curPage || Book.pages()[0]).id);
  r.deleteContents(); r.insertNode(el); Book.refresh(); commit(true); refPop(el);
}
document.addEventListener('mousedown', e => { if (!$('#pop').hidden && !e.target.closest('#pop') && !(e.target.closest && e.target.closest('b-m,b-ref'))) closePop(); }, true);
function style(k) {
  if (k === 'math') return insertMath(); if (k === 'ref') return insertRef(); if (k === 'link') return linkPop(); if (k === 'clear') return clearSel();
  if (k === 'fill') return wrapSel('u', 'fill');
  if (k === 'key') return wrapSel('span', 'key');
  if (k === 'mono') return wrapSel('span', 'mono');
  if (k === 'num') return wrapSel('span', 'num');
  if (k === 'b') return wrapSel('b', ''); if (k === 'i') return wrapSel('i', ''); if (k === 'code') return wrapSel('code', '');
  wrapSel('b', k);
}
$('#styles').addEventListener('mousedown', e => e.preventDefault());
$('#styles').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.style) style(b.dataset.style); });

// typing "/" in an empty paragraph offers the Insert list; keep typing to filter it
const SLASH = [['p', 'Text', ''], ['h3', 'Heading', 'subheading'], ['eq', 'Equation', 'LaTeX'], ['fig', 'Figure', 'from a file'], ['draw', 'Drawing', 'canvas'], ['table', 'Table', ''], ['ul', 'List', 'bullets'], ['code', 'Code', 'with output'], ['aside', 'Note', 'small grey'], ['qc', 'Quick check', 'with answer'], ['toc', 'Contents', 'list of sections'], ['embed', 'Interactive', 'a web page in a frame']];
function slashMenu(host) {
  const t = host.textContent;
  if (host.tagName !== 'P' || !/^\/[a-z ]{0,14}$/i.test(t) || host.children.length) { if (!menu.hidden && menuPick === slashPick) closeMenu(); return; }
  const q = t.slice(1).toLowerCase(), items = SLASH.filter(i => (i[1] + ' ' + i[2]).toLowerCase().includes(q)); if (!items.length) return closeMenu();
  const r = host.getBoundingClientRect(); slashHost = host; openMenu(r.left, r.bottom + 4, items, slashPick);
}
let slashHost = null;
function slashPick(kind) {
  const host = slashHost; if (!host || !host.isConnected) return;
  if (kind === 'p') { host.textContent = ''; return focusIn(host, true); }
  const prev = host.previousElementSibling, pg = host.parentElement; commit(true); host.remove();
  select(prev && !prev.hasAttribute('data-rt') ? prev : null); if (!sel) setPage(pg);
  if (!sel && pg.firstElementChild && !pg.firstElementChild.hasAttribute('data-rt')) { /* page had only this paragraph */ }
  insert(kind);
}
book.addEventListener('input', e => { const host = editHost(); if (host) slashMenu(host); });
document.addEventListener('keydown', e => { if (menuKey(e)) { e.preventDefault(); e.stopPropagation(); } }, true);

// typing: $x_i$ becomes inline math
book.addEventListener('input', () => {
  const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return;
  const n = s.anchorNode; if (!n || n.nodeType !== 3) return;
  const m = /\$([^$\n]+)\$$/.exec(n.nodeValue.slice(0, s.anchorOffset)); if (!m) return;
  const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, s.anchorOffset); r.deleteContents();
  const el = document.createElement('b-m'); el.setAttribute('tex', mathNorm(m[1], true).trim()); r.insertNode(el); caretAfter(el);
});

// paste: keep our own inline markup, drop everything else to plain text
const KEEP = { B: 1, I: 1, CODE: 1, SUB: 1, SUP: 1, BR: 1, U: 1, SPAN: 1 };
function clean(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) out += esc(n.nodeValue.replace(/\s+/g, ' '));
    else if (n.nodeType !== 1) continue;
    else if (n.tagName === 'B-M') out += `<b-m>${esc(n.getAttribute('tex') || n.textContent)}</b-m>`;
    else if (n.tagName === 'B-REF') { const a = ['page', 'pages', 'eq'].find(x => n.hasAttribute(x)); if (a) out += `<b-ref ${a}="${esc(n.getAttribute(a))}"></b-ref>`; }
    else if (n.hasAttribute('data-rt') || /^(STYLE|SCRIPT|META|TITLE)$/.test(n.tagName)) continue;
    else {
      const tag = n.tagName === 'STRONG' ? 'B' : n.tagName === 'EM' ? 'I' : n.tagName, inner = clean(n);
      if (tag === 'BR') out += ' ';
      else if (tag === 'SPAN' && !/^(key|mono|num)$/.test(n.className)) out += inner;
      else if (KEEP[tag]) { const cls = (tag === 'B' && /^(def|name|take|warn|ex|gray|lead)$/.test(n.className)) || (tag === 'U' && n.className === 'fill') || (tag === 'SPAN' && /^(key|mono|num)$/.test(n.className)) ? ` class="${n.className}"` : ''; out += `<${tag.toLowerCase()}${cls}>${inner}</${tag.toLowerCase()}>`; }
      else out += inner + (/^(P|DIV|LI|H[1-6]|TR)$/.test(n.tagName) ? ' ' : '');
    }
  }
  return out;
}
book.addEventListener('paste', e => {
  const host = editHost(); if (!host) return;
  const cd = e.clipboardData;
  const img = [...cd.files].find(f => /^image\//.test(f.type));
  if (img) { e.preventDefault(); return uploadFigure(img).then(src => insertAfter(h(`<b-fig src="${src}"></b-fig>`), sel)); }
  e.preventDefault();
  const html = cd.getData('text/html');
  if (html) { const t = document.createElement('template'); t.innerHTML = html; document.execCommand('insertHTML', false, clean(t.content).trim()); }
  else document.execCommand('insertText', false, cd.getData('text/plain').replace(/\s*\n\s*/g, ' '));
});

// ---------------------------------------------------------------- keyboard
// arrow keys walk out of a block into the next editable one, like in a document
function caretRect() {
  const s = getSelection(); if (!s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange(), n = r.startContainer, o = r.startOffset; let rc = r.getClientRects()[0];
  if (rc && (rc.height || rc.width)) return rc;
  if (n.nodeType === 3 && o < n.length) { r.setEnd(n, o + 1); rc = r.getClientRects()[0]; if (rc) return { left: rc.left, top: rc.top, bottom: rc.bottom, height: rc.height }; }
  if (n.nodeType === 3 && o > 0) { r.setStart(n, o - 1); r.setEnd(n, o); const all = r.getClientRects(); rc = all[all.length - 1]; if (rc) return { left: rc.right, top: rc.top, bottom: rc.bottom, height: rc.height }; }
  const el = (n.nodeType === 1 ? (n.childNodes[o] || n.childNodes[o - 1] || n) : n.parentElement), q = (el.nodeType === 1 ? el : el.parentElement).getBoundingClientRect();
  return { left: n.nodeType === 1 && n.childNodes[o] ? q.left : q.right, top: q.top, bottom: q.bottom, height: q.height };
}
function editableNeighbour(host, dir) {
  const pages = Book.pages(); let pg = host.closest('section.page'), list = Book.blocks(pg), k = list.indexOf(blockOf(host)) + dir;
  for (let guard = 0; guard < 400; guard++) {
    if (k < 0 || k >= list.length) { const np = pages[pages.indexOf(pg) + dir]; if (!np) return null; pg = np; list = Book.blocks(pg); k = dir > 0 ? 0 : list.length - 1; continue; }
    if (list[k].isContentEditable && !Book.isPinned(list[k])) return list[k];
    k += dir;
  }
  return null;
}
function crossBlock(host, key) {
  const s = getSelection(); if (!s.isCollapsed) return false;
  const dir = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
  if (key === 'ArrowLeft' && !atStart(host)) return false;
  if (key === 'ArrowRight' && !atEnd(host)) return false;
  const rc = caretRect(), hr = host.getBoundingClientRect(); if (!rc) return false;
  const lh = parseFloat(getComputedStyle(host).lineHeight) || rc.height || 20;
  if (key === 'ArrowUp' && rc.top - hr.top > lh * 0.9) return false;
  if (key === 'ArrowDown' && hr.bottom - rc.bottom > lh * 0.9) return false;
  if (blockOf(host) !== host && (key === 'ArrowUp' || key === 'ArrowDown')) { /* inside a list or table: only leave from its first/last line */ }
  const n = editableNeighbour(host, dir); if (!n) return false;
  select(n); n.focus();
  if (key === 'ArrowUp' || key === 'ArrowDown') {   // keep the horizontal position
    const nr = n.getBoundingClientRect(), y = dir < 0 ? nr.bottom - Math.min(lh / 2, nr.height / 2) : nr.top + Math.min(lh / 2, nr.height / 2);
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(Math.max(nr.left + 1, Math.min(nr.right - 1, rc.left)), y) : null;
    if (pos && n.contains(pos.startContainer)) { const sel2 = getSelection(); sel2.removeAllRanges(); sel2.addRange(pos); } else focusIn(n, dir < 0);
  } else focusIn(n, dir < 0);
  n.scrollIntoView({ block: 'nearest' });
  return true;
}
function atEnd(host) {
  const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return false;
  const r = document.createRange(); r.selectNodeContents(host); r.setStart(s.anchorNode, s.anchorOffset);
  return r.toString() === '' && !r.cloneContents().querySelector('b-m,b-ref,b-eq');
}
// lists: Tab nests an item under the one above, Shift+Tab lifts it back out
function indentItem(li, out) {
  const list = li.parentElement; commit(true);
  if (out) {
    const outer = list.parentElement && list.parentElement.closest('li'); if (!outer) return;
    const rest = []; let n = li.nextElementSibling; while (n) { rest.push(n); n = n.nextElementSibling; }
    outer.after(li); if (rest.length) { const sub = document.createElement(list.localName); rest.forEach(x => sub.append(x)); li.append(sub); }
    if (!list.children.length) list.remove();
  } else {
    const prev = li.previousElementSibling; if (!prev) return;
    let sub = [...prev.children].reverse().find(c => /^(UL|OL)$/.test(c.tagName)); if (!sub) { sub = document.createElement(list.localName); prev.append(sub); }
    sub.append(li);
  }
  const r = document.createRange(), first = [...li.childNodes].find(c => !(c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName))) || li; r.selectNodeContents(li); if (first !== li) { r.setStart(first, 0); r.setEndBefore([...li.children].find(c => /^(UL|OL)$/.test(c.tagName)) || li.lastChild); if (![...li.children].some(c => /^(UL|OL)$/.test(c.tagName))) r.selectNodeContents(li); } r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); commit(true); Book.refresh();
}
function atStart(host) {
  const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return false;
  const r = document.createRange(); r.selectNodeContents(host); r.setEnd(s.anchorNode, s.anchorOffset);
  return r.toString() === '' && !r.cloneContents().querySelector('b-m,b-ref,br,b-eq');
}
function splitBlock(host) {
  const s = getSelection(), r = s.getRangeAt(0); r.deleteContents();
  const tail = document.createRange(); tail.selectNodeContents(host); tail.setStart(r.endContainer, r.endOffset);
  const frag = tail.extractContents();
  const p = document.createElement('p'); if (host.tagName === 'P' && host.className) p.className = host.className;
  p.append(frag); p.querySelectorAll('b:empty,i:empty,code:empty').forEach(n => n.remove());
  host.querySelectorAll('b:empty,i:empty,code:empty').forEach(n => n.remove());
  lastOf(host).after(p); prep(); select(p); focusIn(p, false); commit(true);
}
function cellMove(cell, back) {
  const cells = [...cell.closest('table').querySelectorAll('th,td')]; let k = cells.indexOf(cell) + (back ? -1 : 1);
  if (k >= cells.length) { tableOp(cell, 'row-after'); return cellMove(cell, false); }
  if (k >= 0) getSelection().selectAllChildren(cells[k]);
}
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === 'Escape' && !$('#pop').hidden) { e.preventDefault(); const f = popFor; closePop(); if (f && f.isConnected) caretAfter(f); return; }
  if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; return; }
  if (mod && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
  if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); return doRedo(); }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); commit(true); return save(); }
  if (inField) return;
  const host = editHost(), typing = host && document.activeElement === host;
  if (typing) {
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); return style('b'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); return style('i'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); return toggleCenter(); }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); return style('math'); }
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyM') { e.preventDefault(); return style('mono'); }
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyN') { e.preventDefault(); return style('num'); }
    if (e.altKey && /^Digit[0-6]$/.test(e.code)) { e.preventDefault(); return style(['clear', 'def', 'name', 'take', 'warn', 'ex', 'gray'][+e.code.slice(5)]); }
    if (e.key === 'Escape') { host.blur(); getSelection().removeAllRanges(); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return linkPop(); }
    if (!mod && !e.shiftKey && !e.altKey && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && crossBlock(host, e.key)) { e.preventDefault(); return; }
    const li0 = e.key === 'Tab' && !e.target.closest('table') && (n => n && (n.nodeType === 1 ? n : n.parentElement).closest('li'))(getSelection().anchorNode);
    if (li0 && host.contains(li0)) { e.preventDefault(); return indentItem(li0, e.shiftKey); }
    const cell = getSelection().anchorNode && (getSelection().anchorNode.nodeType === 1 ? getSelection().anchorNode : getSelection().anchorNode.parentElement).closest('td,th');
    if (e.key === 'Tab' && cell) { e.preventDefault(); return cellMove(cell, e.shiftKey); }
    if (e.key === 'Enter') {
      if (e.shiftKey) { e.preventDefault(); return document.execCommand('insertLineBreak'); }
      if (/^(P|H1|H2|H3|H4)$/.test(host.tagName)) { e.preventDefault(); return splitBlock(host); }
      if (/^(UL|OL)$/.test(host.tagName)) return;   // the browser adds the next list item
      e.preventDefault(); if (!cell) document.execCommand('insertLineBreak'); return;
    }
    if (e.key === 'Backspace' && host.tagName === 'P' && atStart(host)) {
      const prev = host.previousElementSibling;
      if (!host.textContent.trim() && !host.querySelector('b-m,b-ref')) { e.preventDefault(); commit(true); host.remove(); if (prev && prev.isContentEditable) { select(prev); focusIn(prev, true); } else select(prev || null); return commit(true); }
      if (prev && prev.tagName === 'P' && prev.isContentEditable && !Book.isPinned(host)) {
        e.preventDefault(); commit(true);
        const mark = document.createTextNode(''); prev.append(mark); while (host.firstChild) prev.append(host.firstChild); host.remove();
        select(prev); prev.focus(); const r = document.createRange(); r.setStartBefore(mark); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); mark.remove();
        return commit(true);
      }
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'v' && blockClip) { e.preventDefault(); return pasteBlocks(); }
  if (mod && e.key.toLowerCase() === 'a' && curPage) { e.preventDefault(); return selectMany(Book.blocks(curPage)); }
  if (!sel) return;
  if (e.key === 'Escape' && extra.length) { e.preventDefault(); return select(sel); }
  if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) { e.preventDefault(); return copyBlocks(e.key.toLowerCase() === 'x'); }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return duplicateAll(); }
  if (mod && e.shiftKey && e.key === 'Enter' && sel) { e.preventDefault(); return splitPage(sel); }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return removeAll(); }
  if (e.key === 'Enter' && sel.isContentEditable) { e.preventDefault(); return focusIn(sel, true); }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    if (Book.isPinned(sel)) { const k = e.shiftKey ? 10 : 1; allSel().filter(Book.isPinned).forEach(b => { b.style.left = (parseFloat(b.style.left) + d[0] * k).toFixed(1) + 'pt'; b.style.top = (parseFloat(b.style.top) + d[1] * k).toFixed(1) + 'pt'; }); place(); commit(); }
    else if (d[1]) { if (e.altKey) moveAll(d[1]); else { const flow = Book.blocks(sel.parentElement), n = flow[flow.indexOf(sel) + d[1]]; if (n) { select(n); n.scrollIntoView({ block: 'nearest' }); } } }
  }
});

// ---------------------------------------------------------------- live figures (snapshots of the course site's visualizers)
const SITE = 'https://ai.williamtheisen.com/', VIS = [['astar', 'A* Pathfinding'], ['minimax', 'Minimax & Alpha-Beta'], ['knn', 'K-Nearest Neighbors'], ['dtree', 'Decision Tree'], ['mnist', 'Embeddings'], ['shidoku', 'Constraint Satisfaction'], ['bbn', 'Bayesian Networks'], ['expert', 'Expert Systems'], ['perceptron', 'Perceptron Learning'], ['entropy', 'Shannon Entropy'], ['cross-entropy', 'Cross-Entropy Loss'], ['linear-transform', 'Linear Transformations'], ['linear-regression', 'Linear Regression'], ['clustering', 'Clustering'], ['neural-network', 'Feed-Forward Neural Network'], ['reinforcement-learning', 'Reinforcement Learning'], ['svm', 'Support Vector Machines'], ['logistic-regression', 'Logistic Regression'], ['backpropagation', 'Backpropagation'], ['cnn', 'Convolutional Neural Networks'], ['markov-babbler', 'Markov Babbler'], ['pca', 'Principal Component Analysis'], ['pca-explorer', 'PCA Explorer'], ['transformer', 'Transformers & Attention'], ['naive-bayes', 'Naive Bayes Classifier'], ['diffusion', 'Diffusion Models'], ['bpe', 'BPE Tokenizer'], ['rlhf', 'RLHF Pipeline'], ['attention', 'Attention Mechanism'], ['regularization', 'L1 & L2 Regularization'], ['normalization', 'Normalization Techniques']];   // the visualizers on the course site
const withParam = (u, p) => u.replace(/#.*$/, '') + (u.includes('?') ? '&' : '?') + p;
const pause = ms => new Promise(r => setTimeout(r, ms));
// post a message to a framed visualizer (or just wait) and resolve with its answer of the wanted type
function askFrame(win, msg, want, ms = 8000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { removeEventListener('message', on); rej(new Error('no answer')); }, ms);
    function on(e) { if (e.source !== win || !e.data || e.data.type !== want) return; clearTimeout(t); removeEventListener('message', on); res(e.data); }
    addEventListener('message', on); if (msg) win.postMessage(msg, '*');
  });
}
// load the visualizer in figure mode at the figure's own width, three device pixels to the pixel, and save its canvas as the figure's picture
async function snapshotViz(el, url) {
  const w = Math.max(240, Math.round(el.offsetWidth) || 512);
  const f = h(`<iframe style="position:fixed;left:-4000px;top:0;width:${w}px;height:900px;border:0"></iframe>`); document.body.append(f);
  try {
    const ready = askFrame(f.contentWindow, null, 'eai-ready', 15000);
    f.src = withParam(url, 'embed=fig&dpr=3&theme=light');   // book figures are always light
    await ready; await pause(1200);   // let any opening animation in the visualizer settle
    const d = await askFrame(f.contentWindow, { type: 'eai-snapshot' }, 'eai-snapshot');
    if (!d.png || d.png.length < 4000 || !(d.width > 40)) throw new Error(document.hidden ? 'this window is in the background, so the visualizer did not draw. Bring it to the front and try again' : 'the visualizer gave an empty picture');
    const page = (url.split('?')[0].split('/').pop() || 'figure').replace(/\.html$/, '');
    const blob = await (await fetch(d.png)).blob();
    const src = await uploadFigure(new File([blob], `viz-${page}-${Date.now().toString(36)}.png`, { type: 'image/png' }));
    commit(true); el.removeAttribute('crop'); el.setAttribute('viz', url); el.setAttribute('src', src); commit(true); renderInspector();
    return true;
  } catch (e) {
    toast(e.message === 'no answer' ? 'The visualizer did not answer in figure mode. Is the address right, and is the site up to date?' : 'Could not take the snapshot: ' + e.message);
    return false;
  } finally { f.remove(); }
}
function setupViz(el, fresh) {
  const cur = el.getAttribute('viz') || '';
  const box = modal(`<h3>Live figure</h3>
    <div class="crow"><select id="vz-pick"><option value="">(another address)</option>${VIS.map(v => `<option value="${SITE}${v[0]}.html">${esc(v[1])}</option>`).join('')}</select>
    <input id="vz-url" type="text" spellcheck="false" placeholder="https://…" style="flex:1;width:auto;font:inherit" value="${esc(cur)}"></div>
    <iframe id="vz-frame" title="Visualizer"></iframe>
    <div class="help">Set the visualizer up the way the figure should look: pick the data, drag things into place. The PDF gets a picture of it; the web edition starts from the same state and stays interactive.</div>
    <div class="actions"><button id="vz-cancel">Cancel</button><button id="vz-ok" class="primary">Use this as the figure</button></div>`);
  box.classList.add('wide');
  const pick = box.querySelector('#vz-pick'), url = box.querySelector('#vz-url'), frame = box.querySelector('#vz-frame');
  const close = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; if (fresh && !el.getAttribute('src')) { el.remove(); select(null); commit(true); } };
  let shown = ''; const show = () => { const u = url.value.trim(); if (/^https?:\/\//.test(u) && u !== shown) { shown = u; frame.src = withParam(u, 'embed=1&theme=light'); } pick.value = VIS.some(v => u.split('?')[0] === SITE + v[0] + '.html') ? u.split('?')[0] : ''; };
  pick.onchange = () => { if (pick.value) { url.value = pick.value; show(); } };
  url.onchange = show; show();
  box.querySelector('#vz-cancel').onclick = close;
  box.querySelector('#vz-ok').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Taking the picture…';
    const st = await askFrame(frame.contentWindow, { type: 'eai-get-state' }, 'eai-state', 3000).catch(() => null);
    if (!st) { toast('This page does not answer. Live figures need a visualizer from the course site.'); e.target.disabled = false; e.target.textContent = 'Use this as the figure'; return; }
    if (await snapshotViz(el, st.url)) { fresh = false; close(); if (!st.full) toast('Saved. This visualizer restores its controls only, so random data may differ on the web.'); }
    else { e.target.disabled = false; e.target.textContent = 'Use this as the figure'; }
  };
}

// ---------------------------------------------------------------- figures
async function uploadFigure(file, replace) {
  const name = file.name && file.name !== 'image.png' ? file.name : 'pasted-' + Date.now().toString(36) + '.' + (file.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const r = await fetch(`../api/upload/${ch}?name=${encodeURIComponent(replace || name)}${replace ? '&replace=1' : ''}`, { method: 'POST', body: file });
  const d = await r.json(); if (!r.ok) { toast(d.error || 'Upload failed'); throw new Error(d.error); }
  return d.src;
}
function pickFigure(then) { const f = $('#file'); f.value = ''; f.onchange = async () => { if (f.files[0]) then(await uploadFigure(f.files[0])); }; f.click(); }
desk.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
desk.addEventListener('drop', async e => {
  const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return; e.preventDefault();
  const src = await uploadFigure(f), b = blockOf(e.target), pg = pageOf(e.target);
  if (!b && pg) setPage(pg);
  insertAfter(h(`<b-fig src="${src}"></b-fig>`), b || (pg ? null : sel));
});

// ---------------------------------------------------------------- tables
function tableOp(cell, op) {
  const tr = cell.parentElement, table = cell.closest('table'), col = [...tr.children].indexOf(cell);
  commit(true);
  if (op === 'row-after' || op === 'row-before') {
    const body = table.tBodies[0] || table, src = tr.parentElement.tagName === 'THEAD' ? null : tr;
    const n = document.createElement('tr'); for (let k = 0; k < tr.children.length; k++) n.append(h('<td>—</td>'));
    if (!src) body.prepend(n); else if (op === 'row-after') src.after(n); else src.before(n);
  } else if (op === 'row-del') { if (table.rows.length > 1) tr.remove(); }
  else for (const row of table.rows) {
    const c = row.children[col]; if (!c) continue;
    if (op === 'col-del') { if (row.children.length > 1) c.remove(); }
    else { const n = document.createElement(c.tagName.toLowerCase()); n.textContent = c.tagName === 'TH' ? 'Column' : '—'; if (op === 'col-after') c.after(n); else c.before(n); }
  }
  commit(true); Book.refresh();
}
let lastCell = null;
document.addEventListener('selectionchange', () => { const n = getSelection().anchorNode; const c = n && (n.nodeType === 1 ? n : n.parentElement); const cell = c && c.closest && c.closest('td,th'); if (cell && book.contains(cell)) lastCell = cell; });

// ---------------------------------------------------------------- side panel
const KIND = el => el.localName === 'svg' ? 'Drawing' : el.tagName === 'B-EQ' ? 'Equation' : el.tagName === 'B-FIG' ? 'Figure' : el.tagName === 'B-CODE' ? 'Code' : el.tagName === 'B-OUT' ? 'Code output' : el.tagName === 'TABLE' ? 'Table'
  : /^(UL|OL)$/.test(el.tagName) ? 'List' : el.classList.contains('qc') ? 'Quick check' : /^H\d$/.test(el.tagName) ? 'Heading' : el.tagName === 'B-ANSWERS' ? 'Quick-check answers' : el.tagName === 'B-TOC' ? 'Contents' : el.tagName === 'B-EMBED' ? 'Interactive' : 'Text';
const TEXT_TYPES = [['p', '', 'Paragraph'], ['h2', '', 'Page title'], ['h3', '', 'Subheading'], ['p', 'aside', 'Note (small grey)'], ['div', 'callout', 'Callout']];
function userClass(el) { return [...el.classList].filter(c => !c.startsWith('ed-') && !['over', 'busy', 'bad', 'live-on'].includes(c)).join(' '); }
// ---------------------------------------------------------------- code blocks
// A <b-code> carries: lang ("python" runs on the web; "text" for pseudo-code), files (data the code reads, fetched into
// the browser's Python before it runs), marks (tinted boxes: "3:4-18:gold"), and norun (python shown but not runnable).
// "Run and fill in Output" runs the code here with the same in-browser Python as the web edition and writes what it
// prints into the Output block underneath, so the PDF shows real output.
// on an equation: add (or jump to) its code version, an editable <b-code dual> right after it
function dualForEq(el) {
  const add = html => { const n = h(html); insp.append(n); return n; };
  const nx = el.nextElementSibling, has = nx && nx.tagName === 'B-CODE' && nx.hasAttribute('dual');
  let mm = el.nextElementSibling; while (mm && !(mm.tagName === 'B-MATMUL' && mm.hasAttribute('dual')) && (mm.hasAttribute('dual') || mm.tagName === 'B-OUT')) mm = mm.nextElementSibling;
  if (mm && mm.tagName !== 'B-MATMUL') mm = null;
  const mrow = add(`<div class="row"><button>${mm ? 'Edit its matrix walk-through' : 'Add a matrix walk-through'}</button></div>`);
  mrow.firstChild.onclick = () => {
    if (mm) return select(mm);
    commit(true);
    const spec = { vars: { X: [[1, 2], [1, 3], [1, 4]], 'wᵀ': [[-5.2], [9]] }, colors: Book.meta.colors ? { X: 'blue', y: 'green', w: 'purple', 'ŷ': 'gold' } : {}, steps: [{ op: 'mul', a: 'X', b: 'wᵀ', out: 'ŷ', title: 'every prediction at once' }] };
    const m = document.createElement('b-matmul'); m.setAttribute('dual', ''); m.setAttribute('data-view', 'reading'); m.setAttribute('spec', JSON.stringify(spec));
    el.after(m); prep(); select(m); commit(true); Book.refresh();
  };
  const row = add(`<div class="row"><button>${has ? 'Edit its code version' : 'Add a code version'}</button></div>`);
  add(`<div class="help">A code version sits under the equation in the editor. On the web, readers get a Math | Code switch on this equation (and one in the navbar for the whole chapter). The PDF shows the equation only. Usually shown in Reading only, since a code version would give away fill-in answers in Lecture and Workbook.</div>`);
  add(`<div class="help"><b>Linking pieces:</b> wrap part of the equation in <code>\\lk{name}{…}</code> (for example <code>\\lk{err}{y_i - \\yhat_i}</code>) and end the code line that computes it with <code>#~ name</code> (several names: <code>#~ sum err</code>). On the web, hovering either one lights up the other. The marker comments are hidden from readers; up to 7 names per equation.</div>`);
  row.firstChild.onclick = () => {
    if (has) return select(nx);
    commit(true);
    const c = h('<b-code lang="python" dual="" data-view="reading">\nimport numpy as np\n\n# the equation above, in code\n</b-code>');
    el.after(c); prep(); select(c); commit(true); Book.refresh();
  };
}
function codeInspector(el, add) {
  const attr = (k, v) => { commit(true); if (v) el.setAttribute(k, v); else el.removeAttribute(k); el.render(); commit(true); Book.refresh(); };
  add(`<label>Language</label>`);
  const lang = add(`<select><option value="python">Python</option><option value="text">Pseudo-code or other (not run)</option></select>`);
  lang.value = el.getAttribute('lang') === 'python' ? 'python' : 'text';
  lang.onchange = () => { attr('lang', lang.value); renderInspector(); };
  const prevEq = el.previousElementSibling && el.previousElementSibling.tagName === 'B-EQ';
  if (prevEq || el.hasAttribute('dual')) {
    const du = add(`<label class="check"><input type="checkbox" ${el.hasAttribute('dual') ? 'checked' : ''}>Code version of the equation above (readers switch between Math and Code)</label>`);
    du.firstChild.onchange = e => { commit(true); e.target.checked ? el.setAttribute('dual', '') : el.removeAttribute('dual'); commit(true); Book.refresh(); };
  }
  if (lang.value === 'python') {
    const nr = add(`<label class="check"><input type="checkbox" ${el.hasAttribute('norun') ? '' : 'checked'}>Students can run and edit it on the web</label>`);
    nr.firstChild.onchange = e => attr('norun', e.target.checked ? '' : 'true');
    add(`<label>Data files it reads (web addresses, one per line)</label>`);
    const fl = add(`<textarea rows="2" spellcheck="false" style="font-family:var(--font-mono);font-size:11px" placeholder="https://ai.williamtheisen.com/static/data/ai2ai/nd_football.csv"></textarea>`);
    fl.value = (el.getAttribute('files') || '').split(/\s+/).filter(Boolean).join('\n');
    fl.onchange = () => attr('files', fl.value.split(/\s+/).filter(Boolean).join(' '));
    add(`<div class="help">Each file is downloaded before the code runs and saved under its own name, so <code>pd.read_csv("nd_football.csv")</code> works. The address must be public (the site's <code>static/data/</code> folder is).</div>`);
    const run = add(`<div class="row"><button data-a="run">Run and fill in Output</button><button data-a="all">Fill every Output in this chapter</button><span class="help" style="margin:0"></span></div>`);
    run.querySelector('[data-a=run]').onclick = e => runIntoOutput(el, run.lastChild, e.target);
    run.querySelector('[data-a=all]').onclick = async e => {
      const blocks = [...book.querySelectorAll('b-code[lang="python"]:not([norun])')];
      for (let k = 0; k < blocks.length; k++) { await runIntoOutput(blocks[k], run.lastChild, e.target); if (/error|Could not/.test(run.lastChild.textContent)) return; }
      run.lastChild.textContent = `Filled ${blocks.length} Output block${blocks.length === 1 ? '' : 's'}.`;
    };
  }
  add(`<label>Highlights (line:from-to:colour, separated by spaces)</label>`);
  const mk = add(`<input type="text" spellcheck="false" style="font-family:var(--font-mono);font-size:11px" placeholder="3:4-18:gold">`);
  mk.value = el.getAttribute('marks') || ''; mk.onchange = () => attr('marks', mk.value.trim());
  add(`<div class="help">Line numbers start at 1, columns at 0. Colours: gold, blue, red, green, purple. Python is highlighted automatically; extra type names to colour purple go in the chapter settings.</div>`);
}
let pyBoot = null, torchBoot = null;
// same PyTorch as the web edition (see eaiRunCode in book.js), loaded when the code imports torch
function editorTorch(py) {
  if (torchBoot) return torchBoot;
  const url = window.EAI_TORCH_URL || 'https://ai.williamtheisen.com/static/py/torch-ai2ai-5fa3763.tar.gz';
  torchBoot = py.loadPackage('numpy').then(() => fetch(url)).then(r => { if (!r.ok) throw new Error('could not fetch PyTorch for the browser'); return r.arrayBuffer(); })
    .then(b => { py.unpackArchive(b, 'gztar'); });
  torchBoot.catch(() => { torchBoot = null; });
  return torchBoot;
}
function editorPython() {
  if (pyBoot) return pyBoot;
  const PY = window.EAI_PY || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  pyBoot = new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = PY + 'pyodide.js';
    s.onload = () => window.loadPyodide({ indexURL: PY }).then(py => { py.runPython("import os, warnings\nos.environ['MPLBACKEND'] = 'Agg'\nwarnings.filterwarnings('ignore', message='.*(non-interactive|non-GUI backend).*')"); ok(py); }, bad);
    s.onerror = () => bad(new Error('could not load Python (offline?)')); document.head.append(s);
  });
  pyBoot.catch(() => { pyBoot = null; });
  return pyBoot;
}
// ---------------------------------------------------------------- code cells: edit in place
// Click a code (or Output) cell to type in it directly: a transparent textarea sits over the cell, and the coloured
// code underneath is redrawn on every keystroke, so it looks like typing into the cell. Escape or clicking away ends it.
// Lines ending "#~ name" (links to the equation) show in full while editing. A Run button fills in the Output below.
let codeEd = null;
function codeEditView(el, text) {
  const lines = text.split('\n');
  if (el.tagName === 'B-OUT') { el.querySelector('pre').textContent = text; return; }
  el.querySelector('.gutter').innerHTML = lines.map((_, k) => `<div>${k + 1}</div>`).join('');
  el.querySelector('.src').innerHTML = lines.map(l => `<div class="ln">${Book.highlight(l)}</div>`).join('');
}
function startCodeEdit(el, ev) {
  if (codeEd && codeEd.el === el) return;
  endCodeEdit();
  el.classList.add('ed-editing');
  codeEditView(el, el.src);
  const isOut = el.tagName === 'B-OUT', area = isOut ? el.querySelector('pre') : el.querySelector('.src');
  const ta = document.createElement('textarea');
  ta.setAttribute('data-ed', ''); ta.className = 'ed-code'; ta.spellcheck = false; ta.wrap = 'off'; ta.value = el.src;
  ta.style.top = area.offsetTop + 'px'; ta.style.left = area.offsetLeft + 'px';
  el.append(ta);
  let run = null;
  if (!isOut && el.getAttribute('lang') === 'python') {
    run = document.createElement('div'); run.setAttribute('data-ed', ''); run.className = 'ed-coderun';
    run.innerHTML = '<span></span><button title="Run this code and write what it prints into the Output below">Run ▸</button>';
    run.addEventListener('mousedown', e => e.preventDefault());   // keep typing focus
    run.lastChild.onclick = () => runIntoOutput(el, run.firstChild, run.lastChild);
    el.append(run);
  }
  codeEd = { el, ta, run };
  ta.oninput = () => { el.setAttribute('data-src', ta.value); codeEditView(el, ta.value); place(); commit(); };
  ta.onkeydown = e => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
    else if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && run) { e.preventDefault(); run.lastChild.click(); }
    else if (e.key === 'Enter' && !e.shiftKey) {   // keep the indentation of the line above
      const v = ta.value, at = ta.selectionStart, ind = /^[ \t]*/.exec(v.slice(v.lastIndexOf('\n', at - 1) + 1, at))[0], extra = /:\s*$/.test(v.slice(0, at)) ? '    ' : '';
      e.preventDefault(); document.execCommand('insertText', false, '\n' + ind + extra);
    }
  };
  ta.onblur = () => setTimeout(() => { if (codeEd && codeEd.ta === ta && document.activeElement !== ta) endCodeEdit(); }, 0);
  ta.focus();
  // put the caret where the click was
  let pos = ta.value.length;
  if (ev) {
    // measure on screen (the canvas may be zoomed): one character's width and one line's height as drawn
    const probe = document.createElement('span'); probe.setAttribute('data-ed', ''); probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;font-family:var(--font-mono);font-size:9.4pt;line-height:1.4';
    el.append(probe); const pr = probe.getBoundingClientRect(); probe.remove();
    const r = ta.getBoundingClientRect(), cs = getComputedStyle(ta), z = pr.height / (parseFloat(cs.lineHeight) || pr.height) || 1;
    const cw = pr.width / 10 || 7, lh = pr.height || 13, lines = ta.value.split('\n');
    const x = ev.clientX - r.left - parseFloat(cs.paddingLeft) * z, y = ev.clientY - r.top - parseFloat(cs.paddingTop) * z;
    const row = Math.max(0, Math.min(lines.length - 1, Math.floor(y / lh))), col = Math.max(0, Math.min(lines[row].length, Math.round(x / cw)));
    pos = lines.slice(0, row).reduce((a, l) => a + l.length + 1, 0) + col;
  }
  ta.setSelectionRange(pos, pos);
}
function endCodeEdit() {
  if (!codeEd) return;
  const { el, ta } = codeEd; codeEd = null;
  if (ta.isConnected) { el.setAttribute('data-src', ta.value); }
  el.classList.remove('ed-editing');
  el.render(); commit(true); place();
  if (sel === el) renderInspector();
}
book.addEventListener('click', e => {
  const c = e.target.closest && e.target.closest('b-code, b-out');
  if (!c || blockOf(c) !== c || (codeEd && codeEd.el === c) || e.shiftKey || e.metaKey || e.ctrlKey || dragMoved) return;
  if (sel !== c) select(c);
  startCodeEdit(c, e);
});

async function runIntoOutput(el, status, btn) {
  btn.disabled = true; status.textContent = 'Starting Python (the first run takes a few seconds)…';
  const lines = [];
  let py;
  try { py = await editorPython(); } catch (e) { btn.disabled = false; status.textContent = 'Could not start Python here (is this computer online?). The Output was left as it was.'; return; }
  try {
    for (const u of (el.getAttribute('files') || '').split(/\s+/).filter(Boolean)) {
      status.textContent = 'Fetching ' + u.split('/').pop() + '…';
      const r = await fetch(u); if (!r.ok) throw new Error('could not fetch ' + u);
      py.FS.writeFile(u.split('/').pop().split('?')[0], new Uint8Array(await r.arrayBuffer()));
    }
    if (/^\s*(import|from)\s+torch\b/m.test(el.src)) { status.textContent = 'Loading PyTorch…'; await editorTorch(py); }
    status.textContent = 'Running…';
    await py.loadPackagesFromImports(el.src);
    py.setStdout({ batched: t => lines.push(t) }); py.setStderr({ batched: t => lines.push(t) });
    await py.runPythonAsync(el.src, { globals: py.toPy({}) });
    try { py.runPython("import sys\nif 'matplotlib.pyplot' in sys.modules:\n    import matplotlib.pyplot as _p\n    _p.close('all')"); } catch (e) {}
    status.textContent = 'Done.';
  } catch (e) {
    const m = String(e && e.message || e).trim().split('\n'), k = m.findIndex(l => l.includes('File "<exec>"'));
    lines.push(...(k >= 0 ? ['Traceback (most recent call last):', ...m.slice(k)] : m.slice(-4)));
    status.textContent = 'The code raised an error; the Output shows it.';
  }
  btn.disabled = false;
  commit(true);
  let out = el.nextElementSibling;
  if (!out || out.tagName !== 'B-OUT') { out = h('<b-out>\n</b-out>'); el.after(out); prep(); }
  out.src = lines.join('\n') || '(no output)';
  commit(true); Book.refresh(); place();
}

function renderInspector() {
  insp.innerHTML = '';
  if (window.Draw && Draw.inspect(insp)) return;
  renderBlockInspector();
  viewsPanel();
  commentPanel();
  if (window.Draw) Draw.layers(insp);
}
function renderBlockInspector() {
  if (sel && allSel().length > 1) return multiInspector();
  renderOneInspector();
}
function multiInspector() {
  const list = allSel(), pinned = list.filter(Book.isPinned), add = html => { const n = h(html); insp.append(n); return n; };
  add(`<h4>${list.length} blocks</h4>`);
  const act = add(`<div class="row"><button data-a="up">Move up</button><button data-a="down">Move down</button><button data-a="dup">Duplicate</button><button data-a="copy">Copy</button><button data-a="del">Delete</button></div>`);
  act.onclick = e => { const a = e.target.dataset.a; if (a === 'up') moveAll(-1); else if (a === 'down') moveAll(1); else if (a === 'dup') duplicateAll(); else if (a === 'copy') copyBlocks(); else if (a === 'del') removeAll(); };
  const pin = add(`<div class="row"><button data-a="pin">Pin all</button><button data-a="unpin">Unpin all</button></div>`);
  pin.onclick = e => { const a = e.target.dataset.a; if (!a) return; list.forEach(b => { if (Book.isPinned(b) !== (a === 'pin')) togglePin(b); }); selectMany(list); };
  if (pinned.length > 1) {
    add(`<label>Align the ${pinned.length} pinned blocks</label>`);
    const al = add(`<div class="row"><button data-a="l">Left</button><button data-a="c">Centre</button><button data-a="r">Right</button><button data-a="t">Top</button><button data-a="m">Middle</button><button data-a="b">Bottom</button><button data-a="pc" title="Centre each block on the page">Page centre</button><button data-a="w">Same width</button>${pinned.length > 2 ? '<button data-a="dh">Space across</button><button data-a="dv">Space down</button>' : ''}</div>`);
    al.onclick = e => { if (e.target.dataset.a) alignBlocks(e.target.dataset.a); };
  } else add(`<div class="help">Blocks in the text flow already line up with the column. Pin them to place and align them freely.</div>`);
  add(`<div class="help">Shift-click (or Cmd-click) blocks to add or remove them; Cmd+A takes every block on the page; Esc goes back to one. Dragging one of them moves them all. Cmd+C then Cmd+V copies them, also to another page.</div>`);
}
function renderOneInspector() {
  if (!sel) { pageInspector(); return; }
  const el = sel, add = html => { const n = h(html); insp.append(n); return n; };
  add(`<h4>${KIND(el)}</h4>`);
  if (el.tagName === 'B-EQ') { eqInspector(el); dualForEq(el); }
  else if (el.tagName === 'B-FIG') {
    const w = el.style.width ? parseInt(el.style.width) : el.classList.contains('sm') ? 80 : el.hasAttribute('live') ? 90 : 100;
    add(`<label>File</label>`); add(`<input type="text" readonly value="${esc(el.getAttribute('src') || '')}">`);
    const row = add(`<div class="row"><button id="f-rep">Replace file…</button><button id="f-new">Choose another…</button><button id="f-rel" title="Reload after editing the file on disk">Reload</button></div>`);
    row.querySelector('#f-rep').onclick = () => { const f = $('#file'); f.value = ''; f.onchange = async () => { if (!f.files[0]) return; const name = el.getAttribute('src').replace(/^fig\//, ''); await uploadFigure(f.files[0], name); Book.reloadFigure(el.getAttribute('src')); }; f.click(); };
    row.querySelector('#f-new').onclick = () => pickFigure(src => { el.setAttribute('src', src); commit(true); renderInspector(); });
    row.querySelector('#f-rel').onclick = () => Book.reloadFigure(el.getAttribute('src'));
    if (/\.svg$/i.test(el.getAttribute('src') || '') && !el.hasAttribute('live')) {
      const mk = add(`<div class="row"><button title="Copy this figure into the chapter as a drawing, so its shapes, lines and labels can be edited here">Make editable (convert to drawing)</button></div>`);
      mk.firstChild.onclick = () => window.Draw && Draw.convertFigure(el);
    }
    if (!el.hasAttribute('live')) {
      const v = el.getAttribute('viz');
      add(`<label>Live figure (web edition)</label>`);
      const vr = add(v ? `<div class="row"><button title="Open the visualizer at this figure's state, change it, and take a new picture">Set up…</button><button title="Take the picture again from the saved state (after the visualizer's look has changed)">Re-snapshot</button><button title="Keep the picture, drop the link to the visualizer">Make static</button></div>`
        : `<div class="row"><button title="Make this figure a snapshot of one of your visualizers: a picture in the PDF, interactive on the web">Link to a visualizer…</button></div>`);
      vr.children[0].onclick = () => setupViz(el);
      if (v) {
        vr.children[1].onclick = async e => { e.target.disabled = true; if (await snapshotViz(el, v)) toast('Picture retaken'); else e.target.disabled = false; };
        vr.children[2].onclick = () => { commit(true); el.removeAttribute('viz'); commit(true); renderInspector(); };
        add(`<div class="help">A snapshot of <a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.split('?')[0].replace(/^https?:\/\//, ''))}</a>. The PDF shows the picture; on the web the visualizer itself sits in its place, starting from this state.</div>`);
      }
    }
    if (!el.hasAttribute('live')) {
      const c = el.cropBox().map(v => Math.round(v * 100));
      add(`<label>Crop: trim from each side, in % (or drag the black handles on the figure)</label>`);
      const cr = add(`<div class="row">left <input type="number" min="0" max="90" style="width:50px" value="${c[0]}"> top <input type="number" min="0" max="90" style="width:50px" value="${c[1]}"> right <input type="number" min="0" max="90" style="width:50px" value="${c[2]}"> bottom <input type="number" min="0" max="90" style="width:50px" value="${c[3]}"> <button>Reset</button></div>`);
      const ins = [...cr.querySelectorAll('input')];
      cr.oninput = () => { setCrop(el, ins.map(i => (+i.value || 0) / 100)); place(); commit(); };
      cr.querySelector('button').onclick = () => { commit(true); setCrop(el, [0, 0, 0, 0]); commit(true); Book.refresh(); renderInspector(); };
    }
    if (!Book.isPinned(el)) {
      add(`<label>Width: <span id="f-wv">${w}</span>% of the text column</label>`);
      const r = add(`<input type="range" min="15" max="100" value="${w}">`);
      r.oninput = () => { el.classList.remove('sm'); el.style.width = r.value + '%'; insp.querySelector('#f-wv').textContent = r.value; place(); commit(); };
    }
    if (el.stretched && el.stretched()) {
      const pr = add(`<div class="row">Proportions: stretched <button title="Back to the picture's own width-to-height ratio, keeping the width">Restore</button></div>`);
      pr.querySelector('button').onclick = () => { commit(true); el.style.removeProperty('aspect-ratio'); el.applyCrop(); commit(true); Book.refresh(); renderInspector(); };
    }
    add(`<div class="help">Drag a corner to resize; hold Shift to keep the proportions.</div>`);
    add(`<label>Description (alt text)</label>`); const alt = add(`<input type="text" value="${esc(el.getAttribute('alt') || '')}">`);
    alt.oninput = () => { if (alt.value) el.setAttribute('alt', alt.value); else el.removeAttribute('alt'); };
  } else if (el.tagName === 'B-EMBED') {
    add(`<label>Pick one of your visualizers</label>`);
    const pick = add(`<select><option value="">(another address)</option>${VIS.map(v => `<option value="${SITE}${v[0]}.html">${esc(v[1])}</option>`).join('')}</select>`);
    add(`<label>Address</label>`); const url = add(`<input type="text" spellcheck="false" placeholder="https://…" value="${esc(el.getAttribute('src') || '')}">`);
    add(`<label>Title</label>`); const ttl = add(`<input type="text" value="${esc(el.getAttribute('title') || '')}">`);
    add(`<label>Show</label>`);
    const sh = add(`<select><option value="">The visualization and its info tabs</option><option value="viz">The visualization only</option></select>`); sh.value = el.getAttribute('show') === 'viz' ? 'viz' : '';
    sh.onchange = () => { commit(true); if (sh.value) el.setAttribute('show', sh.value); else el.removeAttribute('show'); commit(true); };
    add(`<label>Height of the frame in the web page (px)</label>`); const hh = add(`<input type="number" min="200" step="20" value="${parseInt(el.getAttribute('height')) || 640}">`);
    add(`<label>Picture for the PDF (optional)</label>`);
    const prow = add(`<div class="row"><input type="text" readonly style="flex:1" value="${esc(el.getAttribute('poster') || '')}"><button>Choose…</button><button>None</button></div>`);
    pick.value = VIS.some(v => SITE + v[0] + '.html' === el.getAttribute('src')) ? el.getAttribute('src') : '';
    pick.onchange = () => { if (!pick.value) return; commit(true); el.setAttribute('src', pick.value); const v = VIS.find(v => SITE + v[0] + '.html' === pick.value); if (!el.getAttribute('title') || el.getAttribute('title') === 'Interactive' || VIS.some(x => x[1] + ' visualizer' === el.getAttribute('title'))) el.setAttribute('title', v[1] + ' visualizer'); commit(true); renderInspector(); };
    url.onchange = () => { commit(true); el.setAttribute('src', url.value.trim()); commit(true); renderInspector(); };
    ttl.oninput = () => { el.setAttribute('title', ttl.value); commit(); };
    hh.oninput = () => { el.setAttribute('height', Math.max(200, +hh.value || 640)); commit(); };
    prow.children[1].onclick = () => pickFigure(src => { commit(true); el.setAttribute('poster', src); commit(true); renderInspector(); });
    prow.children[2].onclick = () => { commit(true); el.removeAttribute('poster'); commit(true); renderInspector(); };
    add(`<div class="help">The web edition shows this page in a frame, wider than the text when the window allows. Pages from your site come without the site header, and the frame fits their height by itself. The PDF shows the picture (if you choose one) and the address. Use <b>View</b> to see the frame.</div>`);
  } else if (el.localName === 'svg') {
    const vb = el.viewBox.baseVal;
    add(`<label>Canvas height (the width is 384 = the text column, in pt)</label>`);
    const hh = add(`<input type="number" min="20" step="10" value="${Math.round(vb.height)}">`);
    hh.oninput = () => { el.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${Math.max(20, +hh.value || 20)}`); place(); commit(); };
    const fit = add(`<div class="row"><button>Fit height to contents</button></div>`);
    fit.firstChild.onclick = () => { if (window.Draw) { Draw.fit(el); renderInspector(); } };
    add(`<div class="help">Pick a tool under <b>Draw</b> and drag inside the canvas. Click a shape to select it (Shift-click for several); its colours, line style and arrowheads appear here. Drawing outside a canvas puts the shape on the page itself, on top of the text.</div>`);
  } else if (el.tagName === 'B-CODE' || el.tagName === 'B-OUT') {
    const ta = add(`<textarea rows="${Math.min(24, el.src.split('\n').length + 2)}" spellcheck="false" style="font-family:var(--font-mono);font-size:11px;white-space:pre;overflow-x:auto"></textarea>`);
    ta.value = el.src; ta.oninput = () => { el.src = ta.value; place(); };
    ta.onkeydown = e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); } };
    if (el.tagName === 'B-CODE') codeInspector(el, add);
  } else if (el.tagName === 'B-MATMUL') {
    add(`<label>Matrix walk-through (JSON)</label>`);
    const ta = add(`<textarea rows="16" spellcheck="false" style="font-family:var(--font-mono);font-size:11px;white-space:pre"></textarea>`);
    try { ta.value = JSON.stringify(JSON.parse(el.getAttribute('spec') || '{}'), null, 1); } catch (e) { ta.value = el.getAttribute('spec') || ''; }
    const msg = add(`<div class="err"></div>`);
    ta.oninput = () => { try { JSON.parse(ta.value); msg.textContent = ''; el.setAttribute('spec', JSON.stringify(JSON.parse(ta.value))); place(); commit(); } catch (e) { msg.textContent = 'Not valid JSON yet: ' + e.message; } };
    add(`<div class="help"><b>vars</b>: the starting matrices by name, each a list of rows (a column vector is <code>[[14],[20],[31]]</code>). <b>steps</b>, in order, each making a new matrix called <code>out</code>: <code>{"op":"T","a":"X","out":"Xᵀ"}</code> transpose, <code>{"op":"mul","a":"Xᵀ","b":"X","out":"XᵀX"}</code> multiply, <code>{"op":"add",…}</code> add, <code>{"op":"inv","a":"XᵀX","out":"(XᵀX)⁻¹"}</code> invert a 2×2. Optional per step: <code>title</code>, <code>note</code>. <b>colors</b>: a family (blue, gold, purple, green, red) per name or first letter. Readers see it as the Matrices tab on the equation above, one step at a time; tapping a result cell lights its row and column and writes the sum out. Not printed.</div>`);
  } else if (el.tagName === 'TABLE') {
    const row = add(`<div class="row"><button data-t="row-before">Row above</button><button data-t="row-after">Row below</button><button data-t="row-del">Delete row</button><button data-t="col-before">Column left</button><button data-t="col-after">Column right</button><button data-t="col-del">Delete column</button></div>`);
    row.onmousedown = e => e.preventDefault();
    row.onclick = e => { const op = e.target.dataset.t; if (!op) return; const c = lastCell && el.contains(lastCell) ? lastCell : el.querySelector('td,th'); tableOp(c, op); place(); };
    for (const [c, label] of [['small', 'Small text'], ['num', 'Right-align numbers (all but first column)']]) {
      const k = add(`<label class="check"><input type="checkbox" ${el.classList.contains(c) ? 'checked' : ''}>${label}</label>`); k.firstChild.onchange = e => { el.classList.toggle(c, e.target.checked); commit(true); Book.refresh(); };
    }
    add(`<div class="help">Click a cell, then use the buttons. Tab moves to the next cell (and adds a row at the end).</div>`);
  } else if (/^(P|H2|H3|DIV)$/.test(el.tagName) && !el.querySelector(':scope > div, :scope > dl') && el.isContentEditable) {
    add(`<label>Style</label>`);
    const s = add(`<select>${TEXT_TYPES.map(([t, c, n], k) => `<option value="${k}"${el.localName === t && (el.classList.contains(c) || (!c && !el.classList.contains('aside') && !el.classList.contains('callout'))) ? ' selected' : ''}>${n}</option>`).join('')}</select>`);
    s.onchange = () => { const [t, c] = TEXT_TYPES[+s.value]; commit(true); const n = document.createElement(t); if (c) n.className = c; if (el.getAttribute('style')) n.setAttribute('style', el.getAttribute('style')); while (el.firstChild) n.append(el.firstChild); el.replaceWith(n); prep(); select(n); commit(true); Book.refresh(); };
  } else if (/^(UL|OL)$/.test(el.tagName)) {
    add(`<label>Markers</label>`); const lt = add(`<select><option value="ul">bullets</option><option value="ol">numbers</option></select>`); lt.value = el.localName;
    lt.onchange = () => { commit(true); const n = document.createElement(lt.value); for (const a of el.attributes) if (a.name !== 'contenteditable' && a.name !== 'spellcheck') n.setAttribute(a.name, a.value); while (el.firstChild) n.append(el.firstChild); el.replaceWith(n); prep(); select(n); commit(true); Book.refresh(); };
    add(`<div class="help">Tab nests an item under the one above; Shift+Tab lifts it back out.</div>`);
    add(`<div class="help">Enter adds an item. The classes below change the look: <code>cases</code> normal, <code>tight</code> small, <code>problems</code> numbered practice problems, <code>roadmap</code> the numbered road map.</div>`);
  } else if (el.classList.contains('qc')) add(`<div class="help">The answer line shows here only. In the web edition it sits behind “Show answer”; in print it is listed on the answers page (wherever the chapter has a quick-check answers block).</div>`);
  add('<hr>');
  if (Book.isPinned(el)) {
    add(`<label>Pinned position (pt from the page's top-left; the page is 432 × 648)</label>`);
    const row = add(`<div class="row">x <input type="number" step="1" style="width:64px" data-p="left"> y <input type="number" step="1" style="width:64px" data-p="top"> w <input type="number" step="1" style="width:64px" data-p="width"></div>`);
    row.querySelectorAll('input').forEach(i => { i.value = parseFloat(el.style[i.dataset.p]) || 0; i.oninput = () => { el.style[i.dataset.p] = (+i.value || 0) + 'pt'; place(); commit(); }; });
    const ord = add(`<div class="row"><button data-o="front">To front</button><button data-o="back">To back</button><label class="check" style="margin:0"><input type="checkbox" ${el.style.zIndex === '-1' ? 'checked' : ''}>Behind the text</label></div>`);
    ord.onclick = e => { const o = e.target.dataset.o; if (!o) return; commit(true); const pg = el.parentElement; if (o === 'front') pg.insertBefore(el, pg.querySelector(':scope > svg.overlay, :scope > .foot')); else pg.prepend(el); commit(true); Book.refresh(); place(); };
    ord.querySelector('input').onchange = e => { if (e.target.checked) el.style.zIndex = '-1'; else el.style.removeProperty('z-index'); commit(true); };
    add(`<div class="help">Drag with the ⠿ handle; it snaps to the margins, the centre and other blocks (hold Option to turn snapping off). Arrow keys nudge by 1pt, Shift+arrow by 10pt.</div>`);
  }
  add(`<label>Classes</label>`); const cls = add(`<input type="text" value="${esc(userClass(el))}" spellcheck="false">`);
  cls.onchange = () => { const keep = [...el.classList].filter(c => c.startsWith('ed-')); el.className = [...cls.value.split(/\s+/).filter(Boolean), ...keep].join(' '); commit(true); Book.refresh(); };
}
function pageInspector() {
  const pg = curPage; if (!pg) { insp.innerHTML = '<h4>Nothing selected</h4><div class="help">Click a block to select it, or a page to see its settings.</div>' + HELP; return; }
  const add = html => { const n = h(html); insp.append(n); return n; };
  add(`<h4>Page ${Book.pages().indexOf(pg) + 1}</h4>`);
  add(`<label>Id (used by page references)</label>`); const id = add(`<input type="text" value="${esc(pg.id)}" spellcheck="false">`);
  id.onchange = () => {
    const v = id.value.trim().replace(/[^\w-]+/g, '-'); if (!v || v === pg.id) return void (id.value = pg.id);
    if (document.getElementById(v) || book.querySelector('#' + CSS.escape(v))) { id.value = pg.id; return toast('That id is already in use'); }
    commit(true); const old = pg.id;
    book.querySelectorAll('b-ref').forEach(r => { if (r.getAttribute('page') === old) r.setAttribute('page', v); if (r.hasAttribute('pages')) r.setAttribute('pages', r.getAttribute('pages').split(':').map(x => x === old ? v : x).join(':')); });
    pg.id = v; commit(true); Book.refresh();
  };
  add(`<label>Starts a section (name shown in the footer from here on)</label>`); const part = add(`<input type="text" value="${esc(pg.dataset.part || '')}" placeholder="none">`);
  part.onchange = () => { if (part.value.trim()) pg.dataset.part = part.value.trim(); else delete pg.dataset.part; commit(true); Book.refresh(); };
  const over = (Book.report || []).find(r => r.id === pg.id);
  if (over) add(`<div class="err">Content ends at ${over.bottom}pt (the limit is 622pt)${over.right > 409 ? ', and something sticks out on the right' : ''}.</div>`);
  insp.append(h('<div>' + HELP + '</div>'));
}
const HELP = `<hr><div class="help"><b>Text</b>: click and type. Enter starts a new paragraph, Shift+Enter a line break.<br>
<b>Emphasis</b>: select text, then a colour circle, or Option+1 gold, +2 navy, +3 green, +4 red, +5 teal, +6 dark grey, +0 clear; Option+M Consolas; Option+N number (bold Consolas, dark grey); Cmd+B bold.<br>
<b>Inline math</b>: type <code>$x_i$</code>, or Cmd+E. Click math to edit it.<br>
<b>Blocks</b>: the blue bar moves, copies, pins and deletes the selected block; drag ⠿ to reorder, also across pages. Equations, figures and code drag by their body.<br>
<b>Undo</b>: Cmd+Z, as far back as this session goes. Saving is automatic.</div>`;

const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function freshLabel(base) { const b = slug(base) || 'eq'; let l = b, k = 2; while (book.querySelector(`eq-row[label="${l}"]`)) l = b + '-' + k++; return l; }
function eqInspector(el) {
  const add = html => { const n = h(html); insp.append(n); return n; };
  const list = add('<div></div>'), err = add('<div class="err"></div>');
  let t = 0;
  const rerender = () => { clearTimeout(t); t = setTimeout(() => el.render(), 350); };
  const showErr = () => { err.textContent = el.error || ''; place(); };
  el.addEventListener('eq-rendered', () => { showErr(); list.querySelectorAll('.eqrow').forEach((b, i) => { const r = [...el.children].filter(c => /^EQ-(ROW|STEP)$/.test(c.tagName))[i], t = b.querySelector('.numtag'); if (r && t && r.tagName === 'EQ-ROW') { const n = Book.eqNum(r); t.textContent = n ? '[' + n + ']' : ''; } }); }); showErr();
  const draw = () => {
    list.innerHTML = '';
    [...el.children].filter(c => /^EQ-(ROW|STEP)$/.test(c.tagName)).forEach((row, k, all) => {
      const isEq = row.tagName === 'EQ-ROW';
      const mode = !isEq ? '' : row.hasAttribute('same') ? 'same' : row.hasAttribute('label') ? 'num' : 'none', shown = isEq ? Book.eqNum(row) : null;
      const labels = Object.entries(Book.eqNums).filter(([l]) => l !== row.getAttribute('label'));
      const box = h(`<div class="eqrow"><div class="top"><select class="kind"><option value="eq-row">Equation</option><option value="eq-step">Step ↓</option></select>${isEq ? `<select class="mode" title="Numbered equations get the next number automatically"><option value="none">no number</option><option value="num">numbered</option><option value="same">repeats…</option></select><span class="numtag">${shown ? '[' + esc(shown) + ']' : ''}</span>` : ''}<span class="sp"></span><button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button><button data-a="del" title="Remove row">✕</button></div>${mode === 'num' ? `<input type="text" class="label" placeholder="name used by references" title="Name of this equation: references point at it, so they survive renumbering" value="${esc(row.getAttribute('label') || '')}" style="margin-bottom:4px" spellcheck="false">` : ''}${mode === 'same' ? `<select class="same" style="margin-bottom:4px">${labels.map(([l, n]) => `<option value="${esc(l)}"${l === row.getAttribute('same') ? ' selected' : ''}>[${esc(n)}] ${esc(l)}</option>`).join('')}</select>` : ''}${isEq ? `<input type="text" class="note" placeholder="note above the equation (optional)" value="${esc(row.getAttribute('note') || '')}" style="margin-bottom:4px">` : ''}<textarea rows="${Math.max(2, Book.texOf(row).split('\n').length + 1)}" spellcheck="false"></textarea></div>`);
      const kind = box.querySelector('select.kind'), ta = box.querySelector('textarea'), note = box.querySelector('.note'), md = box.querySelector('select.mode'), lab = box.querySelector('.label'), sm = box.querySelector('select.same');
      kind.value = row.localName; ta.value = Book.texOf(row);
      ta.oninput = () => { row.textContent = ta.value; rerender(); };
      if (md) { md.value = mode; md.onchange = () => {
        commit(true); row.removeAttribute('same'); row.removeAttribute('num');
        if (md.value === 'num') { if (!row.getAttribute('label')) row.setAttribute('label', freshLabel(row.getAttribute('note') || 'eq')); }
        else { const old = row.getAttribute('label'); row.removeAttribute('label'); if (md.value === 'same') { const first = Object.keys(Book.eqNums).find(l => l !== old); if (first) row.setAttribute('same', first); } }
        Book.refresh(); commit(true); draw(); }; }
      if (lab) lab.onchange = () => {
        const v = slug(lab.value), old = row.getAttribute('label'); if (!v || v === old) return void (lab.value = old);
        if (book.querySelector(`eq-row[label="${v}"]`)) { lab.value = old; return toast('Another equation already has that name'); }
        commit(true); row.setAttribute('label', v);
        book.querySelectorAll('b-ref').forEach(r => { if (r.getAttribute('eq') === old) r.setAttribute('eq', v); }); book.querySelectorAll('eq-row[same]').forEach(r => { if (r.getAttribute('same') === old) r.setAttribute('same', v); });
        Book.refresh(); commit(true); lab.value = v; };
      if (sm) sm.onchange = () => { row.setAttribute('same', sm.value); Book.refresh(); commit(true); draw(); };
      if (note) note.oninput = () => { if (note.value.trim()) row.setAttribute('note', note.value); else row.removeAttribute('note'); rerender(); };
      kind.onchange = () => { const n = document.createElement(kind.value); n.textContent = row.textContent; row.replaceWith(n); Book.refresh(); draw(); };
      box.querySelector('.top').onclick = e => {
        const a = e.target.dataset.a; if (!a) return;
        if (a === 'del') { if (all.length > 1) row.remove(); } else if (a === 'up' && k > 0) all[k - 1].before(row); else if (a === 'down' && k < all.length - 1) all[k + 1].after(row);
        Book.refresh(); draw();
      };
      list.append(box);
    });
  };
  draw();
  const row = add(`<div class="row"><button data-k="eq-row">+ Equation row</button><button data-k="eq-step">+ Step row</button></div>`);
  row.onclick = e => { const k = e.target.dataset.k; if (!k) return; const n = document.createElement(k); n.textContent = k === 'eq-step' ? '\\text{substitute}' : '= x'; const img = el.querySelector(':scope > [data-rt]'); el.insertBefore(n, null); if (img) el.append(...el.querySelectorAll(':scope > [data-rt]')); el.render(); draw(); const tas = list.querySelectorAll('textarea'); tas[tas.length - 1].focus(); tas[tas.length - 1].select(); };
  add(`<div class="help">LaTeX, rendered by the equation kit${info.tex ? '' : ' (<b style="color:var(--red-text)">no TeX found on this computer: existing equations show, changes need xelatex or tectonic</b>)'}. Symbols in the chapter's colour list are coloured and bolded for you.<br>
<code>x w\\T</code> transpose · <code>\\yhat</code> ŷ · <code>\\norm{w}</code> ‖w‖ · <code>x\\p</code> prime · <code>\\cd</code> dot<br>
<code>\\frac{a}{b}</code> · <code>\\tfrac{1}{2}</code> · <code>\\sum_i</code> · <code>\\text{words}</code><br>
tall brackets: <code>\\bp{}</code> ( ) · <code>\\bb{}</code> [ ] · <code>\\Bp{}</code> <code>\\Bb{}</code> bigger · <code>\\Hp{}</code> biggest<br>
lined-up rows: <code>\\begin{aligned} a &amp;= b\\\\ &amp;= c \\end{aligned}</code><br>
force a colour: <code>\\blue{x}</code> <code>\\gold{}</code> <code>\\purple{}</code> <code>\\green{}</code> <code>\\red{}</code><br>
A <b>step</b> row is the grey “↓ do this” line between two equations. <b>Numbered</b> rows get the next number in the chapter automatically, and every later number and reference updates; number only the equations you refer to. <b>Repeats</b> shows another equation's number again (for a recap).</div>`);
}

// ---------------------------------------------------------------- find and replace (Cmd+F)
const findBar = $('#x-find'), fIn = $('#f-find'), fRep = $('#f-rep'), fCount = $('#f-count'), fCase = $('#f-case');
let hits = [], hitAt = -1;
function findAll() {
  hits = []; const q = fIn.value; if (CSS.highlights) CSS.highlights.delete('find');
  if (!q) { fCount.textContent = ''; return; }
  const cs = fCase.checked, needle = cs ? q : q.toLowerCase();
  const w = document.createTreeWalker(book, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[data-rt], b-m, b-ref, b-eq, b-code, b-out, b-fig, b-answers, b-toc, b-embed, svg, .foot') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n; while ((n = w.nextNode())) { const t = cs ? n.nodeValue : n.nodeValue.toLowerCase(); let i = -1; while ((i = t.indexOf(needle, i + 1)) >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); hits.push(r); } }
  if (CSS.highlights && hits.length) CSS.highlights.set('find', new Highlight(...hits));
  fCount.textContent = hits.length ? `${Math.min(hitAt + 1, hits.length) || 1} of ${hits.length}` : 'none';
}
function findGo(d) {
  if (!hits.length) return; hitAt = (hitAt + d + hits.length) % hits.length; const r = hits[hitAt];
  if (CSS.highlights) CSS.highlights.set('find-cur', new Highlight(r));
  const el = r.startContainer.parentElement; el.scrollIntoView({ block: 'center' }); const b = blockOf(el); if (b && b !== sel) select(b, true);
  fCount.textContent = `${hitAt + 1} of ${hits.length}`;
}
function findReplace(all) {
  if (!hits.length) return; commit(true);
  const list = all ? [...hits].reverse() : [hits[Math.max(0, hitAt)]];
  list.forEach(r => { r.deleteContents(); r.insertNode(document.createTextNode(fRep.value)); r.startContainer.parentNode && r.startContainer.parentNode.normalize(); });
  commit(true); Book.refresh(); const at = hitAt; findAll(); if (!all && hits.length) { hitAt = Math.min(at, hits.length) - 1; findGo(1); } else if (CSS.highlights) CSS.highlights.delete('find-cur');
  if (all) toast(`${list.length} replaced`, 'Undo', doUndo);
}
function findOpen() { findBar.hidden = false; const t = String(getSelection()); if (t && !t.includes('\n') && t.length < 80) fIn.value = t; fIn.focus(); fIn.select(); hitAt = -1; findAll(); }
function findClose() { findBar.hidden = true; hits = []; if (CSS.highlights) { CSS.highlights.delete('find'); CSS.highlights.delete('find-cur'); } }
fIn.oninput = () => { hitAt = -1; findAll(); if (hits.length) findGo(1); }; fCase.onchange = fIn.oninput;
fIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); } };
fRep.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findReplace(false); } };
findBar.addEventListener('click', e => { const a = e.target.dataset.a; if (a === 'next') findGo(1); else if (a === 'prev') findGo(-1); else if (a === 'rep') findReplace(false); else if (a === 'all') findReplace(true); else if (a === 'close') findClose(); });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); findOpen(); } else if (e.key === 'Escape' && !findBar.hidden && findBar.contains(e.target)) { e.stopPropagation(); findClose(); } }, true);

// ---------------------------------------------------------------- page list
// one row per page: number, title and (optionally) a small live copy of the page. Rows are kept and updated in place;
// a thumbnail is only rebuilt when its page changed and the row is on screen.
let pagesT = 0, thumbs = true;
try { thumbs = localStorage.getItem('book-thumbs') !== '0'; } catch (x) {}
const rowOf = new Map(), thumbSrc = new Map();
const seen = new IntersectionObserver(es => es.forEach(en => { en.target._vis = en.isIntersecting; if (en.isIntersecting) paintThumb(en.target); }), { root: $('#pages'), rootMargin: '300px' });
function paintThumb(li) {
  if (!thumbs) return;
  const pg = pageById(li.dataset.id); if (!pg) return;
  const src = Book.serializePage(pg) + '|' + pg.querySelectorAll('b-eq.busy').length + '|' + (pg.querySelector(':scope > .foot') || {}).textContent;
  if (thumbSrc.get(li) === src && li.querySelector('.thumb')) return;
  thumbSrc.set(li, src);
  let box = li.querySelector('.thumb'); if (!box) { box = document.createElement('div'); box.className = 'thumb'; box.setAttribute('data-thumb', ''); li.append(box); }
  const c = pg.cloneNode(true);
  c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); c.removeAttribute('id');
  c.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  c.querySelectorAll('.ed-guide').forEach(n => n.remove());
  c.querySelectorAll('.ed-sel, .ed-cur').forEach(n => n.classList.remove('ed-sel', 'ed-cur')); c.classList.remove('ed-cur', 'ed-sel');
  box.replaceChildren(c);
}
function renderPages() { clearTimeout(pagesT); pagesT = setTimeout(() => {
  const ol = $('#pages'), pages = Book.pages().filter(p => !Book.split || Book.inView(p)), live = new Set();
  ol.classList.toggle('thumbs', thumbs);
  pages.forEach((p, k) => {
    let li = rowOf.get(p.id);
    if (!li) { li = document.createElement('li'); li.draggable = true; li.dataset.id = p.id; li.innerHTML = '<div class="row1"><span class="n"></span><span class="t"></span></div>'; rowOf.set(p.id, li); seen.observe(li); }
    live.add(p.id);
    const stale = p.getAttribute('data-ed-stale');
    li.className = (p.classList.contains('over') ? 'over ' : '') + (p === curPage ? 'cur ' : '') + (p.dataset.part ? 'part ' : '') + (stale ? 'stale' : '');
    li.title = p.classList.contains('over') ? 'Content runs past the page' : stale ? 'The Lecture changed since this page was last brought in step (' + stale + ')' : '';
    const n = String(k + 1), t = p.classList.contains('cover') ? 'Cover' : ((p.querySelector('h2') || {}).textContent || '(untitled)');
    if (li.querySelector('.n').textContent !== n) li.querySelector('.n').textContent = n;
    if (li.querySelector('.t').textContent !== t) li.querySelector('.t').textContent = t;
    if (ol.children[k] !== li) ol.insertBefore(li, ol.children[k] || null);
    if (!thumbs) { const b = li.querySelector('.thumb'); if (b) b.remove(); } else if (li._vis) paintThumb(li);
  });
  for (const [id, li] of rowOf) if (!live.has(id)) { seen.unobserve(li); li.remove(); rowOf.delete(id); thumbSrc.delete(li); }
  if (curPage && curPage !== lastRevealed) { lastRevealed = curPage; revealPageRow(); }   // the list was rebuilt: bring the current row into view once
}, 150); }
var lastRevealed = null;
$('#pg-thumbs').onclick = () => { thumbs = !thumbs; try { localStorage.setItem('book-thumbs', thumbs ? '1' : '0'); } catch (x) {} $('#pg-thumbs').classList.toggle('on', thumbs); renderPages(); setTimeout(() => rowOf.forEach(li => { if (li._vis) paintThumb(li); }), 250); };
$('#pg-thumbs').classList.toggle('on', thumbs);
$('#pages').addEventListener('click', e => { const li = e.target.closest('li'); if (!li) return; const pg = pageById(li.dataset.id); if (document.activeElement) document.activeElement.blur(); select(null); setPage(pg); renderInspector(); pg.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
// drag a row to reorder pages: the top half of a row drops before it, the bottom half after it,
// and holding the pointer near the top or bottom edge of the list scrolls it
let dragId = null, dropAt = null, dragY = 0, dragScroll = 0;
const pagesOl = $('#pages');
const clearDrop = () => { pagesOl.querySelectorAll(':scope > li').forEach(l => l.classList.remove('dropbefore', 'dropafter')); dropAt = null; };
const endPageDrag = () => { dragId = null; clearDrop(); cancelAnimationFrame(dragScroll); dragScroll = 0; };
function dragAutoScroll() {
  const r = pagesOl.getBoundingClientRect(), edge = Math.min(60, r.height / 4);
  let v = 0;
  if (dragY < r.top + edge) v = -Math.ceil(16 * (1 - Math.max(0, dragY - r.top) / edge));
  else if (dragY > r.bottom - edge) v = Math.ceil(16 * (1 - Math.max(0, r.bottom - dragY) / edge));
  if (v) pagesOl.scrollTop += v;
  dragScroll = dragId ? requestAnimationFrame(dragAutoScroll) : 0;
}
pagesOl.addEventListener('dragstart', e => {
  const li = e.target.closest('li'); dragId = li && li.dataset.id; if (!dragId) return;
  e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
  dragY = e.clientY; cancelAnimationFrame(dragScroll); dragScroll = requestAnimationFrame(dragAutoScroll);
});
pagesOl.addEventListener('dragover', e => {
  if (!dragId) return; e.preventDefault(); dragY = e.clientY;
  const li = e.target.closest('li');
  if (!li || li.parentElement !== pagesOl) { // empty space below the last row: drop at the end
    const last = pagesOl.lastElementChild; clearDrop();
    if (last && e.clientY > last.getBoundingClientRect().bottom) { last.classList.add('dropafter'); dropAt = { li: last, after: true }; }
    return;
  }
  const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
  if (dropAt && dropAt.li === li && dropAt.after === after) return;
  clearDrop(); li.classList.add(after ? 'dropafter' : 'dropbefore'); dropAt = { li, after };
});
pagesOl.addEventListener('dragleave', e => { if (!pagesOl.contains(e.relatedTarget)) { clearDrop(); } });
pagesOl.addEventListener('drop', e => {
  e.preventDefault(); const pg = pageById(dragId), at = dropAt; endPageDrag();
  if (!pg || !at || at.li.dataset.id === pg.id) return;
  const target = pageById(at.li.dataset.id); if (!target) return;
  if ((at.after ? target.nextElementSibling : target.previousElementSibling) === pg) return;   // already there
  commit(true); if (at.after) target.after(pg); else target.before(pg); commit(true); Book.refresh();
});
pagesOl.addEventListener('dragend', endPageDrag);
// ---------------------------------------------------------------- small pop-up menu (page layouts, slash commands)
const menu = document.createElement('div'); menu.id = 'x-menu'; menu.hidden = true; document.body.append(menu);
let menuItems = [], menuAt = 0, menuPick = null;
function openMenu(x, y, items, pick) {
  menuItems = items; menuAt = 0; menuPick = pick; menu.hidden = false;
  menu.innerHTML = items.map((it, k) => `<div data-k="${k}" class="${k ? '' : 'cur'}"><span>${esc(it[1])}</span><small>${esc(it[2] || '')}</small></div>`).join('');
  menu.style.left = Math.min(x, innerWidth - 230) + 'px'; menu.style.top = Math.min(y, innerHeight - Math.min(320, items.length * 28 + 12)) + 'px';
}
const closeMenu = () => { menu.hidden = true; menuItems = []; menu.className = ''; };
menu.addEventListener('mousedown', e => { e.preventDefault(); const d = e.target.closest('div[data-k]'); if (d) { const it = menuItems[+d.dataset.k], f = menuPick; closeMenu(); f(it[0]); } });
document.addEventListener('mousedown', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
const menuKey = e => {
  if (menu.hidden) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { menuAt = (menuAt + (e.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length; [...menu.children].forEach((d, k) => d.classList.toggle('cur', k === menuAt)); menu.children[menuAt].scrollIntoView({ block: 'nearest' }); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { const it = menuItems[menuAt], f = menuPick; closeMenu(); if (it) f(it[0]); return true; }
  if (e.key === 'Escape') { closeMenu(); return true; }
  return false;
};
// page layouts
const LAYOUTS = [
  ['text', 'Title and text', '', '<h2>New page</h2><p></p>'],
  ['fig', 'Title, text, drawing, text', '', '<h2>New page</h2><p>Text before the figure.</p><svg class="draw" viewBox="0 0 384 200"></svg><p>Text after the figure.</p>'],
  ['eq', 'Title, text, equation, text', '', '<h2>New page</h2><p>Text leading in.</p><b-eq><eq-row>x = y</eq-row></b-eq><p>What it means.</p>'],
  ['sub', 'Title with subheadings', '', '<h2>New page</h2><h3>First point</h3><p></p><h3>Second point</h3><p></p>'],
  ['code', 'Title, text, code', '', '<h2>New page</h2><p>What the code does.</p><b-code lang="python">\nprint("hello")\n</b-code><b-out>\nhello\n</b-out><p>What to notice.</p>'],
  ['qc', 'Title, text, quick check', '', '<h2>New page</h2><p></p><aside class="qc"><b>Quick check:</b> question<div class="ans">answer</div></aside>'],
  ['toc', 'Contents (list of sections)', '', '<h2>Contents</h2><b-toc></b-toc>'],
  ['blank', 'Blank', '', ''],
];
function docTag() { return Book.view === 'reading' ? 'reading' : 'slides workbook'; }   // split chapters: the tag of the document being edited
function addPage(kind) { return addPageAt(kind, curPage || Book.pages().slice(-1)[0], false); }
function addPageAt(kind, ref, before) {   // a new page with the chosen layout, just before or just after ref
  commit(true);
  const pg = h(`<section class="page" id="${uid()}">${LAYOUTS.find(l => l[0] === kind)[3]}</section>`);
  if (Book.split) { pg.setAttribute('data-view', docTag()); const t = ref && ref.getAttribute('data-topic'); if (t && !ref.classList.contains('cover')) pg.setAttribute('data-topic', t); }   // a split chapter: the page joins the document you're editing, on the same topic
  if (before) ref.before(pg); else ref.after(pg); prep(); Book.refresh(); commit(true); setPage(pg);
  const t = pg.querySelector('h2'); if (t) { select(t); getSelection().selectAllChildren(t); t.focus(); } else { select(null); renderInspector(); }
  pg.scrollIntoView({ block: 'start' });
}
$('#pg-add').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.top - LAYOUTS.length * 28 - 16, LAYOUTS, addPage); };
$('#pg-dup').onclick = () => { if (!curPage) return toast('Click a page first'); commit(true); const pg = h(Book.serializePage(curPage)); pg.id = uid(); delete pg.dataset.part; curPage.after(pg); prep(); Book.refresh(); commit(true); setPage(pg); pg.scrollIntoView({ block: 'start' }); };
$('#pg-del').onclick = () => { if (!curPage) return toast('Click a page first'); if (Book.pages().length < 2) return; commit(true); const pg = curPage, next = pg.nextElementSibling || pg.previousElementSibling; select(null); pg.remove(); setPage(next); Book.refresh(); commit(true); renderInspector(); toast('Page deleted', 'Undo', doUndo); };

// ---------------------------------------------------------------- bar: undo, zoom, settings, export
$('#undo').onclick = doUndo; $('#redo').onclick = doRedo;
function applyZoom(v) {
  let z = +v;
  if (v === 'fit' || v === 'two') { const w = desk.clientWidth - 48 - (v === 'two' ? 24 : 0); z = Math.max(0.3, Math.min(2, +(w / (v === 'two' ? 2 : 1) / 578).toFixed(3))); if (v === 'fit') z = Math.min(z, +((desk.clientHeight - 60) / 866).toFixed(3)); }
  if (gridOn && typeof gworld !== 'undefined') {   // canvas: the menu sets the magnification, the pages stay laid out at 100%
    const W = gworld.offsetWidth || 3 * 624, one = 624;
    const cz = v === 'three' ? (desk.clientWidth - 24) / W : v === 'two' ? (desk.clientWidth - 24) / (2 * one) : v === 'fit' ? (desk.clientHeight - 40) / 900 : +v;
    if (cz > 0) { setCanvasZoom(cz); return; }
  }
  if (v === 'three') z = Math.max(0.2, Math.min(2, +((desk.clientWidth - 3 * 48 - 2 * 16) / 3 / 578).toFixed(3)));
  book.style.setProperty('--zoom', z); gridLayout(); setTimeout(() => { Book.refresh(); place(); }, 50);
}
$('#zoom').onchange = e => { try { localStorage.setItem('book-zoom', e.target.value); } catch (x) {} applyZoom(e.target.value); };
try { const z = localStorage.getItem('book-zoom'); if (z) { const zs = $('#zoom'); if (![...zs.options].some(o => o.value === z)) { const o = document.createElement('option'); o.value = z; o.textContent = Math.round(+z * 100) + '%'; zs.prepend(o); } zs.value = z; applyZoom(z); } } catch (x) {}
window.addEventListener('resize', () => { if (/fit|two|three/.test($('#zoom').value)) applyZoom($('#zoom').value); else gridLayout(); if (typeof canvasSize === 'function' && gridOn) canvasSize(); });
$('#x-margins').onclick = () => { const on = book.classList.toggle('ed-margins'); $('#x-margins').classList.toggle('on', on); try { localStorage.setItem('book-margins', on ? '1' : '0'); } catch (x) {} };
try { if (localStorage.getItem('book-margins') === '1') $('#x-margins').click(); } catch (x) {}
// pages that run over: a counter in the bar that jumps to the next one
book.addEventListener('book-refresh', () => { const n = (Book.report || []).length, b = $('#x-over'); b.hidden = !n; b.textContent = n + (n === 1 ? ' page over' : ' pages over'); });
$('#x-over').onclick = () => { const list = Book.report || []; if (!list.length) return; const pages = Book.pages(), at = curPage ? pages.indexOf(curPage) + 1 : 0; const next = list.find(r => r.page > at) || list[0]; const pg = pages[next.page - 1]; select(null); setPage(pg); renderInspector(); pg.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
// keyboard shortcuts
const KEYS = [['Writing'], ['Enter', 'new paragraph'], ['Shift+Enter', 'line break'], ['/', 'in an empty paragraph: insert menu'], ['$x_i$', 'inline math (or Cmd+E)'], ['Option+1 … 6', 'gold, navy, green, red, teal, dark grey (bold)'], ['Option+N', 'number: bold Consolas in dark grey'], ['Option+M', 'Consolas on or off (numbers, technical bits)'], ['Cmd+Shift+E', 'centre the block (again: back to the left)'], ['Option+0', 'clear emphasis'], ['Cmd+B / Cmd+I', 'bold / italic'], ['Cmd+K', 'link'], ['Tab / Shift+Tab', 'next cell in a table; nest / un-nest in a list'], ['Arrow keys', 'walk into the next block'], ['Cmd+F', 'find and replace'],
  ['Blocks'], ['Esc', 'stop typing, keep the block selected'], ['Shift-click', 'select several blocks'], ['Cmd+A', 'every block on the page (when not typing)'], ['Cmd+C / X / V', 'copy, cut, paste blocks (also to another page)'], ['Cmd+D', 'duplicate'], ['Backspace', 'delete the selected block'], ['Option+↑ ↓', 'move the block up or down'], ['Arrows', 'nudge a pinned block (Shift: by 10)'],
  ['Drawing'], ['double-click a tool', 'keep drawing with it (Esc stops)'], ['Shift while drawing', 'square, circle, 45° line'], ['Option-drag', 'leave a copy'], ['Cmd while dragging', 'no snapping'], ['double-click', 'polygon: move corners; label: retype'], ['Cmd+G / Shift+Cmd+G', 'group / ungroup'],
  ['Everywhere'], ['Cmd+Z / Shift+Cmd+Z', 'undo / redo'], ['Cmd+S', 'save now (it also saves by itself)'], ['?', 'this list']];
const showHelp = () => { modal(`<h3>Shortcuts</h3><table class="keys">${KEYS.map(k => k.length === 1 ? `<tr class="h"><td colspan="2">${k[0]}</td></tr>` : `<tr><td>${esc(k[0])}</td><td>${esc(k[1])}</td></tr>`).join('')}</table><div class="actions"><button onclick="document.getElementById('modal').hidden=true">Close</button></div>`).classList.add('wide'); };
$('#x-help').onclick = showHelp;
document.addEventListener('keydown', e => { if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !(document.activeElement && document.activeElement.isContentEditable)) { e.preventDefault(); showHelp(); } });
// earlier versions
$('#x-history').onclick = async () => {
  commit(true); await save();
  const d = await (await fetch('../api/history/' + ch)).json().catch(() => null);
  if (!d || !d.versions) return toast('History needs the newer server: restart it (Ctrl+C, then python3 server.py)');
  const ids = t => (t.match(/<section[^>]*\bid="([^"]*)"/g) || []).length;
  const box = modal(`<h3>Earlier versions</h3><div class="row" style="display:flex;gap:6px;margin-bottom:8px"><input type="text" id="v-label" placeholder="name for a version of the chapter as it is now" style="flex:1"><button id="v-keep">Keep a version</button></div><div id="v-list">${d.versions.length ? '' : '<p>No earlier versions yet. One is kept automatically every 10 minutes of editing.</p>'}</div><div class="actions"><button onclick="document.getElementById('modal').hidden=true">Close</button></div>`); box.classList.add('wide');
  const list = box.querySelector('#v-list');
  d.versions.slice(0, 60).forEach(v => {
    const m = /^chapter-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)(?:-(.*))?\.html$/.exec(v.name), when = m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : v.name;
    const row = h(`<div class="ver"><span class="when">${esc(when)}</span><span class="what">${m && m[7] ? '<b>' + esc(m[7].replace(/-/g, ' ')) + '</b> · ' : ''}${Math.round(v.size / 1024)} KB</span><a class="btnlink" target="_blank" href="../view/${ch}?version=${encodeURIComponent(v.name)}">Open</a><button data-a="diff">What changed</button><button data-a="restore">Restore</button></div>`);
    row.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return;
      const old = (await (await fetch(`../api/history/${ch}?name=${encodeURIComponent(v.name)}`)).json()).content;
      if (a === 'restore') { undo.push(cur); redo = []; apply(old, true); setStatus(); clearTimeout(saveT); saveT = setTimeout(save, 300); $('#modal').hidden = true; return toast('Restored the version from ' + when, 'Undo', doUndo); }
      const chunks = t => { const o = {}; Book.parse(t).body.trim().split(/\n\n(?=<section[ >])/).forEach(c => { const id = (/^<section[^>]*\bid="([^"]*)"/.exec(c) || [])[1]; if (id) o[id] = c; }); return o; };
      const A = chunks(old), B = chunks(cur), pages = Book.pages().map(p => p.id);
      const changed = Object.keys(B).filter(id => id in A && A[id] !== B[id]).map(id => 'p. ' + (pages.indexOf(id) + 1)), added = Object.keys(B).filter(id => !(id in A)).length, gone = Object.keys(A).filter(id => !(id in B)).length;
      row.querySelector('.what').textContent = (changed.length ? 'differs on ' + changed.slice(0, 12).join(', ') + (changed.length > 12 ? '…' : '') : 'same text on every shared page') + (added ? `; ${added} page(s) added since` : '') + (gone ? `; ${gone} page(s) removed since` : '');
    };
    list.append(row);
  });
  box.querySelector('#v-keep').onclick = async () => { const r = await fetch('../api/history/' + ch, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: box.querySelector('#v-label').value }) }); if (r.ok) { $('#modal').hidden = true; toast('Version kept'); } else toast('Could not keep a version (restart the server to get this feature)'); };
};
$('#settings').onclick = () => {
  const m = Book.meta, FAM = ['blue', 'gold', 'purple', 'green', 'red'];
  const box = modal(`<h3>Chapter</h3>
    <label>Title (footer and web page)</label><input type="text" id="m-title" style="width:100%" value="${esc(m.title || '')}">
    <label>Chapter number (equations are numbered [chapter.1], [chapter.2], …; leave empty for [1], [2], …)</label><input type="text" id="m-chap" style="width:80px" value="${esc(m.chapter == null ? '' : m.chapter)}">
    <label>PDF file name</label><input type="text" id="m-pdf" style="width:100%" value="${esc(m.pdf || '')}">
    <label>Symbol colours: each symbol is bold and coloured everywhere, in inline math and in equations</label><div id="m-colors"></div>
    <button id="m-add">+ Symbol</button>
    <label>Extra type names coloured purple in code (space separated)</label><input type="text" id="m-types" style="width:100%" value="${esc((m.types || []).join(' '))}">
    <div class="actions"><button id="m-cancel">Cancel</button><button id="m-ok" class="primary">Apply</button></div>`);
  const list = box.querySelector('#m-colors');
  const row = (k, v) => { const r = h(`<div class="crow"><input type="text" maxlength="2" value="${esc(k)}"><select>${FAM.map(f => `<option${f === v ? ' selected' : ''}>${f}</option>`).join('')}</select><button>✕</button></div>`); r.querySelector('button').onclick = () => r.remove(); r.querySelector('input').oninput = e => { e.target.value = mathNorm(e.target.value, false); }; list.append(r); };
  Object.entries(m.colors || {}).forEach(([k, v]) => row(k, v));
  box.querySelector('#m-add').onclick = () => row('', 'blue');
  box.querySelector('#m-cancel').onclick = () => { $('#modal').hidden = true; };
  box.querySelector('#m-ok').onclick = () => {
    commit(true);
    const colors = {}; list.querySelectorAll('.crow').forEach(r => { const k = r.querySelector('input').value.trim().normalize('NFC'); if (k) colors[k] = r.querySelector('select').value; });
    const types = box.querySelector('#m-types').value.split(/\s+/).filter(Boolean);
    Book.meta = Object.assign({}, m, { title: box.querySelector('#m-title').value.trim(), pdf: box.querySelector('#m-pdf').value.trim(), colors });
    if (types.length) Book.meta.types = types; else delete Book.meta.types;
    const chap = box.querySelector('#m-chap').value.trim(); if (chap) Book.meta.chapter = /^\d+$/.test(chap) ? +chap : chap; else delete Book.meta.chapter;
    $('#modal').hidden = true; $('#title').textContent = Book.meta.title;
    book.querySelectorAll('b-m').forEach(e => e.setAttribute('tex', e.getAttribute('tex')));
    book.querySelectorAll('b-eq').forEach(e => e.render()); book.querySelectorAll('b-code').forEach(e => e.render());
    Book.refresh(); commit(true);
  };
};
$('#export').onclick = async () => {   // builds all three editions (Reading, Lecture, Workbook), one after another
  commit(true); await save();
  if (cur !== saved) return toast('Save first (see the status at the top)');
  const btn = $('#export'); btn.disabled = true;
  const VIEWS = [['reading', 'Reading'], ['slides', 'Lecture'], ['workbook', 'Workbook']], done = [];
  try {
    for (const [v, label] of VIEWS) {
      btn.textContent = 'Exporting ' + label + '…';
      const r = await fetch('../api/export/' + ch + '?view=' + v, { method: 'POST' }), d = await r.json();
      if (!r.ok) { modal(`<h3>${label} export failed</h3><pre>${esc(d.error || '')}</pre><div class="actions"><button onclick="document.getElementById('modal').hidden=true">Close</button></div>`); btn.disabled = false; btn.textContent = 'Export'; return; }
      done.push({ v, label, d });
    }
    const link = f => '../' + f.split('/').map(encodeURIComponent).join('/').replace(/^chapters\//, 'c/');
    const over = done.flatMap(x => x.d.report.map(o => `${x.label}, page ${o.page} (${esc(o.id)}): content ends at ${o.bottom}pt, limit 622`));
    const logs = done.flatMap(x => x.d.log.map(l => x.label + ': ' + l));
    const rows = done.map(x => {
      const pdf = x.d.files.find(f => /\.pdf$/.test(f) && !/markup/.test(f)) || '', page = x.d.files.find(f => /\.html$/.test(f)) || '';
      return `<tr><td><b>${x.label}</b></td><td>${x.d.report.length ? '<b style="color:var(--red-text)">' + x.d.report.length + ' over</b>' : 'fits'}</td><td><a target="_blank" href="${link(pdf)}">PDF</a> · <a target="_blank" href="${link(page)}">web page</a></td></tr>`;
    }).join('');
    modal(`<h3>Exported all three editions</h3><table class="tbl small">${rows}</table>
      ${over.length ? '<p><b>Pages that run over (fix these before publishing):</b></p><pre>' + over.join('\n') + '</pre>' : '<p>Every page fits in every edition.</p>'}
      ${logs.length ? '<pre>' + esc(logs.join('\n')) + '</pre>' : ''}
      <div class="actions"><button onclick="document.getElementById('modal').hidden=true">Close</button></div>`);
  } catch (e) { toast('Export failed: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Export';
};
window.addEventListener('beforeunload', e => { if (cur !== saved) { commit(true); save(); e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- figures: crop; drawings: canvas height
function setCrop(el, c) {
  c = c.map(v => Math.max(0, Math.min(0.9, v))); if (c[0] + c[2] > 0.95) c[2] = 0.95 - c[0]; if (c[1] + c[3] > 0.95) c[3] = 0.95 - c[1];
  if (c.every(v => v < 0.002)) el.removeAttribute('crop'); else el.setAttribute('crop', c.map(v => +(v * 100).toFixed(1)).join(' '));
}
function placeCrop() {
  const box = $('#croph'); box.innerHTML = '';
  if (!sel || !sel.isConnected || sel.tagName !== 'B-FIG' || sel.hasAttribute('live') || extra.length) return;
  const r = sel.getBoundingClientRect(); if (!r.width) return;
  const mk = (cx, cy, side) => { const [x, y] = deskXY({ left: cx, top: cy }); const d = document.createElement('div'); d.className = 'ch ' + (side === 'l' || side === 'r' ? 'v' : 'h'); d.dataset.side = side; d.title = 'Drag inward to crop'; d.style.left = x + 'px'; d.style.top = y + 'px'; box.append(d); };
  mk(r.left, r.top + r.height / 3, 'l'); mk(r.right, r.top + r.height / 3, 'r'); mk(r.left + r.width / 2, r.top, 't'); mk(r.left + r.width / 2, r.bottom, 'b');
  // corners resize: drag to any shape, Shift keeps the proportions
  for (const [cx, cy, k] of [[r.left, r.top, 'nw'], [r.right, r.top, 'ne'], [r.left, r.bottom, 'sw'], [r.right, r.bottom, 'se']]) {
    const [x, y] = deskXY({ left: cx, top: cy }), d = document.createElement('div');
    d.className = 'ch c ' + k; d.dataset.corner = k; d.title = 'Drag to resize (hold Shift to keep the proportions)';
    d.style.left = x + 'px'; d.style.top = y + 'px'; box.append(d);
  }
}
$('#croph').addEventListener('pointerdown', e => {
  const k = e.target.dataset.corner; if (!k || !sel) return; e.preventDefault(); e.stopPropagation(); commit(true); held++;
  const el = sel, pg = el.parentElement, pinned = Book.isPinned(el), s = ptScale(pg), r0 = el.getBoundingClientRect();
  const W = k.includes('w'), N = k.includes('n'), ax = W ? r0.right : r0.left, ay = N ? r0.bottom : r0.top, cx = r0.left + r0.width / 2;
  const left0 = parseFloat(el.style.left) || 0, top0 = parseFloat(el.style.top) || 0, ar0 = r0.width / r0.height, keep0 = el.style.aspectRatio;
  const move = ev => {
    let w = pinned ? Math.abs(ev.clientX - ax) : 2 * Math.abs(ev.clientX - cx), hh = Math.abs(ev.clientY - ay);
    const col = 384 * s, wMin = pinned ? 30 * s : 0.15 * col, wMax = pinned ? 432 * s : col;
    if (ev.shiftKey) { const f = (w * r0.width + hh * r0.height) / (r0.width * r0.width + r0.height * r0.height); w = r0.width * f; }   // the pointer projected onto the diagonal
    w = Math.max(wMin, Math.min(wMax, w));
    if (ev.shiftKey) hh = w / ar0; else hh = Math.max(12 * s, hh);
    if (pinned) {
      el.style.width = (w / s).toFixed(1) + 'pt';
      if (W) el.style.left = (left0 + (r0.width - w) / s).toFixed(1) + 'pt';
      if (N) el.style.top = (top0 + (r0.height - hh) / s).toFixed(1) + 'pt';
    } else { el.classList.remove('sm'); el.style.width = (w / col * 100).toFixed(1) + '%'; }
    if (ev.shiftKey) { if (keep0) el.style.aspectRatio = keep0; else el.style.removeProperty('aspect-ratio'); }
    else {
      const ratio = w / hh, nat = el.naturalRatio();
      if (nat && Math.abs(ratio / nat - 1) < 0.02) el.style.removeProperty('aspect-ratio'); else el.style.aspectRatio = ratio.toFixed(4);
    }
    el.applyCrop(); place();
  };
  const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); held = Math.max(0, held - 1); commit(true); Book.refresh(); renderInspector(); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
});
$('#croph').addEventListener('pointerdown', e => {
  const side = e.target.dataset.side; if (!side || !sel) return; e.preventDefault(); e.stopPropagation(); commit(true); held++;
  const el = sel, c0 = el.cropBox(), r0 = el.getBoundingClientRect(), fullW = r0.width / (1 - c0[0] - c0[2]), fullH = r0.height / (1 - c0[1] - c0[3]), x0 = e.clientX, y0 = e.clientY;
  const w0 = el.style.width ? parseFloat(el.style.width) : el.classList.contains('sm') ? 80 : 100, pinned = Book.isPinned(el);
  const move = ev => {
    const c = c0.slice(), dx = (ev.clientX - x0) / fullW, dy = (ev.clientY - y0) / fullH;
    if (side === 'l') c[0] = c0[0] + dx; if (side === 'r') c[2] = c0[2] - dx; if (side === 't') c[1] = c0[1] + dy; if (side === 'b') c[3] = c0[3] - dy;
    setCrop(el, c);
    const now = el.cropBox(), k = (1 - now[0] - now[2]) / (1 - c0[0] - c0[2]);   // keep the picture's scale: the block narrows as its sides are trimmed
    if (side === 'l' || side === 'r') { if (pinned) el.style.width = (parseFloat(el.style.width) || 100) + 'pt'; else { el.classList.remove('sm'); el.style.width = Math.max(10, Math.min(100, w0 * k)).toFixed(1) + '%'; } }
    place();
  };
  const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); held = Math.max(0, held - 1); commit(true); Book.refresh(); renderInspector(); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
});
$('#rszb').addEventListener('pointerdown', e => {
  if (!sel || sel.localName !== 'svg') return; e.preventDefault(); commit(true); held++;
  const el = sel, v = el.viewBox.baseVal, h0 = v.height, y0 = e.clientY, k = el.getBoundingClientRect().width / v.width;
  const move = ev => { el.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${Math.max(20, Math.round(h0 + (ev.clientY - y0) / k))}`); place(); };
  const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); held = Math.max(0, held - 1); commit(true); Book.refresh(); renderInspector(); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
});

// ---------------------------------------------------------------- rulers and guides
// Guides are a working aid, not part of the chapter: they are remembered in this browser (per chapter) and appear
// on every page, in pt from the page's top-left. Pinned blocks and shapes drawn on the page snap to them.
let rulersOn = false, guides = { v: [], h: [] };
try { guides = JSON.parse(localStorage.getItem('book-guides-' + ch)) || guides; rulersOn = localStorage.getItem('book-rulers') === '1'; } catch (x) {}
const saveGuides = () => { try { localStorage.setItem('book-guides-' + ch, JSON.stringify(guides)); } catch (x) {} drawGuides(); };
function drawGuides() {
  const sig = JSON.stringify(guides);
  Book.pages().forEach(pg => {
    if (pg._guides === sig && pg.querySelector(':scope > .ed-guide') !== null === (guides.v.length + guides.h.length > 0)) return; pg._guides = sig;
    pg.querySelectorAll(':scope > .ed-guide').forEach(n => n.remove());
    if (pg.classList.contains('cover')) return;
    const mk = (cls, k, v) => { const d = document.createElement('div'); d.className = 'ed-guide ' + cls; d.setAttribute('data-rt', ''); d.setAttribute('contenteditable', 'false'); d.dataset.k = k; d.style[cls === 'v' ? 'left' : 'top'] = v + 'pt'; d.title = `${cls === 'v' ? 'x' : 'y'} = ${v}pt · drag to move, drag off the page to remove`; pg.append(d); };
    guides.v.forEach((v, k) => mk('v', k, v)); guides.h.forEach((v, k) => mk('h', k, v));
  });
}
function dragGuide(e, axis, k, pg) {   // k = index of an existing guide, or -1 for a new one pulled out of a ruler
  e.preventDefault(); e.stopPropagation();
  const arr = guides[axis]; if (k < 0) { arr.push(axis === 'v' ? 24 : 20); k = arr.length - 1; }
  const move = ev => { const q = pg.getBoundingClientRect(), s = q.width / 432; let v = axis === 'v' ? (ev.clientX - q.left) / s : (ev.clientY - q.top) / s; v = Math.round(v); if (!ev.metaKey) for (const m of (axis === 'v' ? [24, 216, 408] : [20, 324, 622])) if (Math.abs(v - m) < 4) v = m; arr[k] = v; arr._out = axis === 'v' ? (v < -6 || v > 438) : (v < -6 || v > 654); pg._guides = ''; Book.pages().forEach(p => { p._guides = ''; }); drawGuides(); placeRulers(); };
  const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); if (arr._out) arr.splice(k, 1); delete arr._out; saveGuides(); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
}
book.addEventListener('pointerdown', e => { const g = e.target.closest && e.target.closest('.ed-guide'); if (g && rulersOn) dragGuide(e, g.classList.contains('v') ? 'v' : 'h', +g.dataset.k, g.parentElement); }, true);
book.addEventListener('dblclick', e => { const g = e.target.closest && e.target.closest('.ed-guide'); if (g) { guides[g.classList.contains('v') ? 'v' : 'h'].splice(+g.dataset.k, 1); saveGuides(); } }, true);
function placeRulers() {
  const box = $('#rulers'); const pg = rulersOn ? (curPage || Book.pages().find(p => { const r = p.getBoundingClientRect(), d = desk.getBoundingClientRect(); return r.bottom > d.top + 120; })) : null;
  if (!pg || !pg.isConnected) { box.innerHTML = ''; box._pg = null; return; }
  const q = pg.getBoundingClientRect(), s = q.width / 432, [x, y] = deskXY(q), sig = [pg.id, s.toFixed(3)].join();
  const ticks = (len, top) => { let hh = ''; for (let v = 0; v <= len; v += 12) { const major = v % 72 === 0, mid = v % 36 === 0; hh += top ? `<i style="left:${v * s}px;height:${major ? 15 : mid ? 8 : 4}px"></i>` : `<i style="top:${v * s}px;width:${major ? 15 : mid ? 8 : 4}px"></i>`; if (major && v) hh += top ? `<span style="left:${v * s + 2}px;top:1px">${v}</span>` : `<span style="top:${v * s + 2}px;left:1px;writing-mode:vertical-rl">${v}</span>`; } return hh + '<i class="cur" hidden></i>'; };
  if (box._sig !== sig || !box.firstChild) { box._sig = sig; box.innerHTML = `<div class="rule top" title="Drag down onto the page for a horizontal guide (measures are in pt)">${ticks(432, true)}</div><div class="rule left" title="Drag right onto the page for a vertical guide">${ticks(648, false)}</div>`; }
  box._pg = pg;
  // the rulers stay in view: they sit just outside the page, or along the edge of the desk when that is scrolled away
  const dr = desk.getBoundingClientRect(), [ex, ey] = deskXY({ left: dr.left, top: dr.top }), t = box.firstChild, l = box.lastChild;
  t.style.cssText = `left:${x}px;top:${Math.min(Math.max(y - 17, ey), y + q.height - 17)}px;width:${q.width}px`;
  l.style.cssText = `left:${Math.max(x - 17, ex)}px;top:${y}px;height:${q.height}px`;
}
$('#rulers').addEventListener('pointerdown', e => { const r = e.target.closest('.rule'); if (r && $('#rulers')._pg) dragGuide(e, r.classList.contains('top') ? 'h' : 'v', -1, $('#rulers')._pg); });
book.addEventListener('pointermove', e => {   // show the pointer on the rulers
  const box = $('#rulers'), pg = box._pg; if (!rulersOn || !pg) return;
  const q = pg.getBoundingClientRect(), inside = e.clientX >= q.left && e.clientX <= q.right && e.clientY >= q.top && e.clientY <= q.bottom, cur = box.querySelectorAll('.cur');
  if (cur[0]) { cur[0].hidden = !inside; cur[0].style.left = (e.clientX - q.left) + 'px'; } if (cur[1]) { cur[1].hidden = !inside; cur[1].style.top = (e.clientY - q.top) + 'px'; }
});
function setRulers(on) { rulersOn = on; book.classList.toggle('ed-rulers', on); $('#x-rulers').classList.toggle('on', on); try { localStorage.setItem('book-rulers', on ? '1' : '0'); } catch (x) {} $('#rulers')._sig = ''; drawGuides(); placeRulers(); }
$('#x-rulers').onclick = () => setRulers(!rulersOn);
book.addEventListener('book-refresh', drawGuides);

// ---------------------------------------------------------------- review comments
let me = 'Eric'; try { me = localStorage.getItem('book-name') || me; } catch (x) {}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const openCmts = () => [...book.querySelectorAll('.cmt:not([data-done]):not([data-re])')];
const targetOf = c => { let n = c.previousElementSibling; while (n && n.classList.contains('cmt')) n = n.previousElementSibling; return n && !n.hasAttribute('data-rt') ? n : null; };   // null = a note on the page itself
// show the side panel at its Comments section, with the caret at the end of the newest open comment
function openCommentPanel(focus) {
  if (document.body.classList.contains('review')) return;
  if (document.body.classList.contains('no-insp')) togglePanel('no-insp', false);
  requestAnimationFrame(() => {
    const hd = [...insp.querySelectorAll('h4')].find(x => x.textContent.startsWith('Comments')); if (hd) hd.scrollIntoView({ block: 'start' });
    if (!focus) return;
    const t = [...insp.querySelectorAll('.cmt-item:not(.done) .txt')].pop() || [...insp.querySelectorAll('.cmt-item .txt')].pop(); if (!t) return;
    t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}
function addComment(block, text) {
  const pg = block ? block.parentElement : curPage; if (!pg) return toast('Click a block or a page first');
  if (document.body.classList.contains('no-insp') && !text) togglePanel('no-insp', false);
  commit(true);
  const c = document.createElement('div'); c.className = 'cmt'; c.dataset.by = me; c.dataset.when = stamp(); c.textContent = text || '';
  if (block) lastOf(block).after(c); else { let first = pg.firstElementChild; while (first && first.classList.contains('cmt')) first = first.nextElementSibling; pg.insertBefore(c, first); }
  commit(true); renderInspector(); placeMarkers();
  if (!text) openCommentPanel(true);
}
function commentItem(c, withWhere) {
  const done = c.hasAttribute('data-done'), d = h(`<div class="cmt-item ${done ? 'done' : ''}"><div class="meta"><b>${esc(c.dataset.by || '')}</b>${c.dataset.verdict ? `<span class="vd">${esc(c.dataset.verdict)}</span>` : ''}${c.dataset.re ? '<span>↳ reply</span>' : ''}<span>${esc(c.dataset.when || '')}</span><span class="sp"></span><button data-a="done">${done ? 'Reopen' : 'Resolve'}</button><button data-a="del">Delete</button></div><div class="txt" contenteditable="plaintext-only" spellcheck="true"></div></div>`);
  const txt = d.querySelector('.txt'); txt.textContent = c.textContent;
  txt.oninput = () => { c.textContent = txt.textContent; };
  txt.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); txt.blur(); } };
  txt.onblur = () => { if (!c.textContent.trim() && c.isConnected) { c.remove(); commit(true); renderInspector(); } placeMarkers(); };
  d.querySelector('.meta').onclick = e => { const a = e.target.dataset.a; if (!a) return; commit(true); const th = [c, ...cmtReplies(c)]; if (a === 'del') th.forEach(x => x.remove()); else if (done) th.forEach(x => x.removeAttribute('data-done')); else th.forEach(x => x.setAttribute('data-done', '1')); commit(true); renderInspector(); placeMarkers(); if ($('#modal').hidden === false) showComments(); };
  if (withWhere) { const t = targetOf(c), pg = c.closest('section.page'), n = Book.pages().indexOf(pg) + 1; const w = h(`<div class="where">p. ${n} · ${esc(t ? (t.textContent.trim().slice(0, 60) || KIND(t)) : 'the page')}</div>`); w.onclick = () => { $('#modal').hidden = true; if (t) select(t); else { select(null); setPage(pg); renderInspector(); } (t || pg).scrollIntoView({ block: 'center' }); }; d.append(w); }
  return d;
}
// ---------------------------------------------------------------- views: reading / slides / workbook
const VIEW_NAMES = { reading: 'Reading', slides: 'Slides', workbook: 'Workbook' };
function topicsPanel(pg) {   // split chapters: which topics this page covers (links Lecture and Reading pages)
  const doc = Book.inView(pg, 'reading') ? 'Reading' : 'Lecture', other = doc === 'Reading' ? 'Lecture' : 'Reading';
  const all = [...new Set(Book.pages().flatMap(Book.topicsOf))].sort();
  insp.append(h(`<h4 style="margin-top:14px">${doc} page · topics</h4>`));
  const row = h(`<div class="row"><input id="pg-topics" list="topic-list" placeholder="e.g. overfitting ridge" style="width:100%"><datalist id="topic-list">${all.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>`), inp = row.querySelector('input');
  inp.value = Book.topicsOf(pg).join(' ');
  inp.onchange = () => { commit(true); const v = inp.value.trim().split(/[\s,]+/).filter(Boolean).join(' '); if (v) pg.setAttribute('data-topic', v); else pg.removeAttribute('data-topic'); commit(true); Book.refresh(); focusChanged(); renderInspector(); };
  insp.append(row);
  const mates = Book.pages().filter(p => p !== pg && !p.classList.contains('cover') && Book.inView(p, 'reading') !== Book.inView(pg, 'reading') && Book.topicsOf(p).some(t => Book.topicsOf(pg).includes(t)));
  insp.append(h(`<div class="help">${mates.length ? `Same topic in the ${other}: ` + mates.map(p => esc((p.querySelector('h2') || {}).textContent || p.id)).join(', ') + '.' : `Nothing in the ${other} shares a topic with this page yet.`} Separate topics with spaces.</div>`));
  const stale = pg.getAttribute('data-ed-stale');
  if (stale) insp.append(h(`<div class="help" style="color:var(--gold-text,#8a6d10)">The Lecture changed since this page was last brought in step (${esc(stale)}). Ask Claude to sync the Reading, or use More ▸ Reading is in step with the Lecture.</div>`));
}
function viewsPanel() {
  if (Book.split && curPage && !curPage.classList.contains('cover') && !allSel().length) return topicsPanel(curPage);
  const list = allSel().length ? allSel() : (curPage && !curPage.classList.contains('cover') ? [curPage] : []); if (!list.length) return;
  const isPage = list[0] === curPage && !allSel().length;
  insp.append(h(`<h4 style="margin-top:14px">Shown in</h4>`));
  const pgOf = list[0].closest && list[0].closest('section.page'), vs = Book.split && pgOf ? Book.views.filter(v => Book.inView(pgOf, v)) : Book.views;   // split: a block can only be in its own document's views
  if (Book.split && vs.length < 2) return;
  const row = h(`<div class="row viewrow">${vs.map(v => `<label><input type="checkbox" data-v="${v}"> ${VIEW_NAMES[v]}</label>`).join('')}</div>`);
  const boxes = [...row.querySelectorAll('input')];
  boxes.forEach(b => { const on = list.filter(el => Book.inView(el, b.dataset.v)).length; b.checked = on === list.length; b.indeterminate = on > 0 && on < list.length; });
  row.onchange = e => {
    const want = boxes.filter(b => b.checked).map(b => b.dataset.v);
    if (!want.length) { e.target.checked = true; return toast('It has to be in at least one view. To remove it everywhere, delete it.'); }
    commit(true);
    list.forEach(el => {
      el.removeAttribute('data-view');
      if (!vs.every(v => Book.inView(el, v) === want.includes(v))) el.setAttribute('data-view', want.join(' '));   // only tag it when the automatic rules would not give the same result
    });
    commit(true); Book.refresh(); place(); renderPages();
  };
  insp.append(row);
  if (!isPage) {
    const f = h(`<div class="row viewrow"><label title="Reading shows it. Slides and Workbook keep its space but leave it empty, for working it in class."><input type="checkbox"> Leave empty in Slides and Workbook</label></div>`), fb = f.querySelector('input');
    fb.checked = list.every(el => el.hasAttribute('data-fill'));
    fb.onchange = () => { commit(true); list.forEach(el => { if (fb.checked) el.setAttribute('data-fill', ''); else el.removeAttribute('data-fill'); }); commit(true); Book.refresh(); place(); };
    insp.append(f);
  }
  insp.append(h(`<div class="help">${isPage ? 'Untick a view to leave this whole page out of it.' : 'Blocks left out of the view you are in show as a striped bar. Select words and press Key to mark what Slides and Workbook show of a paragraph, or Fill for a fill-in.'}</div>`));
}
book.addEventListener('book-refresh', () => {   // blocks that are not in the current view become bars
  let changed = false;
  Book.pages().forEach(pg => Book.blocks(pg).forEach(el => { const out = !Book.inView(el); if (el.classList.contains('ed-out') !== out) { el.classList.toggle('ed-out', out); changed = true; } }));
  if (changed) Book.refreshSoon();   // the bars take no room, so the spacing has to be worked out again
});
const modeSel = $('#x-mode');
function setMode(v) { modeSel.value = Book.views.includes(v) ? v : 'reading'; Book.setView(modeSel.value); try { localStorage.setItem('book-view-' + ch, modeSel.value); } catch (x) {} document.body.dataset.mode = modeSel.value; gridLayout(); $('#view').href = '../view/' + ch + (modeSel.value === 'reading' ? '' : '?view=' + modeSel.value); select(null); renderInspector(); place(); }
modeSel.onchange = () => setMode(modeSel.value);
function commentPanel() {
  if (extra.length) return;
  const list = sel ? tail(sel) : curPage ? (() => { const out = []; let n = curPage.firstElementChild; while (n && n.classList.contains('cmt')) { out.push(n); n = n.nextElementSibling; } return out; })() : null;
  if (!list) return;
  insp.append(h(`<h4 style="margin-top:14px">Comments${list.length ? ' · ' + list.length : ''}</h4>`));
  list.forEach(c => insp.append(commentItem(c)));
  const row = h(`<div class="row"><button>${list.length ? 'Reply' : 'Add a comment'} ${sel ? 'on this block' : 'on this page'}</button></div>`); row.firstChild.onclick = () => addComment(sel); insp.append(row);
}
function placeMarkers() {
  const box = $('#cmtm'); box.innerHTML = '';
  const seenT = new Map();
  openCmts().forEach(c => { const pg = c.closest('section.page'), t = targetOf(c) || pg; if (!pg) return; const e = seenT.get(t) || { n: 0, text: [], pg }; e.n++; e.text.push((c.dataset.by || '') + ': ' + c.textContent); seenT.set(t, e); });
  seenT.forEach((e, t) => {
    const r = t.getBoundingClientRect(), q = e.pg.getBoundingClientRect(); if (!q.width) return;
    const [x, y] = deskXY({ left: q.right - 22 * (q.width / 576), top: t === e.pg ? q.top + 4 : r.top });
    const d = document.createElement('div'); d.className = 'cm'; d.textContent = e.n; d.title = e.text.join('\n'); d.style.left = x + 'px'; d.style.top = y + 'px';
    d.onclick = () => { if (t === e.pg) { select(null); setPage(e.pg); renderInspector(); } else select(t); openCommentPanel(true); };
    box.append(d);
  });
  if (typeof placeRev === 'function') placeRev();
  const n = openCmts().length, b = $('#x-cmts'); b.textContent = n ? `Comments (${n})` : 'Comments'; b.classList.toggle('has', n > 0);
}
function showComments() {
  const all = [...book.querySelectorAll('.cmt')], open = all.filter(c => !c.hasAttribute('data-done'));
  const box = modal(`<h3>Comments</h3><div class="row" style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:12px">Your name on new comments <input type="text" id="c-name" value="${esc(me)}" style="width:120px"><span style="flex:1"></span><select id="c-by" title="Show comments from"><option value="">everyone</option>${[...new Set(all.map(c => c.dataset.by || ''))].filter(Boolean).map(b => `<option>${esc(b)}</option>`).join('')}</select><label style="margin:0;display:flex;gap:4px;align-items:center;color:var(--ink)"><input type="checkbox" id="c-all"> show resolved (${all.length - open.length})</label></div><div id="c-list"></div><div class="actions">${open.some(c => c.dataset.by === 'Claude') ? `<button id="c-claude" title="Mark every open comment from Claude as resolved. They stay in the chapter (tick 'show resolved' to see them).">Resolve all from Claude (${open.filter(c => c.dataset.by === 'Claude').length})</button>` : ''}<button onclick="document.getElementById('modal').hidden=true">Close</button></div>`); box.classList.add('wide');
  const list = box.querySelector('#c-list'); list.id = 'c-list'; list.style.cssText = 'max-height:55vh;overflow:auto';
  const draw = () => { list.innerHTML = ''; const by = box.querySelector('#c-by').value, show = (box.querySelector('#c-all').checked ? all : open).filter(c => !by || c.dataset.by === by); if (!show.length) list.innerHTML = '<p>No comments. Select a block and use the speech-bubble button beside it, or “Add a comment” in the side panel.</p>'; show.forEach(c => { const it = commentItem(c, true); list.append(it); }); };
  box.querySelector('#c-all').onchange = draw; box.querySelector('#c-by').onchange = draw;
  const rc = box.querySelector('#c-claude'); if (rc) rc.onclick = () => { commit(true); open.filter(c => c.dataset.by === 'Claude').forEach(c => c.setAttribute('data-done', '1')); commit(true); renderInspector(); placeMarkers(); showComments(); }; box.querySelector('#c-name').onchange = e => { me = e.target.value.trim() || 'Eric'; try { localStorage.setItem('book-name', me); } catch (x) {} };
  draw();
}
$('#x-cmts').onclick = showComments;
book.addEventListener('book-refresh', placeMarkers);
window.Editor && 0;

await Book.ready(); Book.refresh(); renderPages(); renderInspector(); setStatus();
setRulers(rulersOn); placeMarkers();
try { const v = localStorage.getItem('book-view-' + ch); if (v && v !== 'reading') setMode(v); } catch (x) {}
mo.takeRecords();
if (normalized) status.title = 'The file will be rewritten in the editor\'s fixed layout on the first save.';
window.Editor = { guides: () => (rulersOn ? guides : { v: [], h: [] }), clearClip() { blockClip = null; }, selectMany, commit, save, apply, select, place, toast, deskXY, blockOf, pageOf, setPage, insertAfter, renderInspector, prep, h, doUndo, hold(on) { held = Math.max(0, held + (on ? 1 : -1)); if (!held) commit(true); }, get sel() { return sel; }, get curPage() { return curPage; }, get cur() { return cur; }, get saved() { return saved; } };
document.dispatchEvent(new Event('editor-ready'));
document.documentElement.dataset.ready = '1';

// ---------------------------------------------------------------- canvas: every page in all three editions (rows = pages, columns = editions)
// The editable chapter sits in the column of the edition you are editing; the other two columns are live previews
// (/view/<chapter>?grid=1&view=…), one frame per edition, with each page placed level with its row in the editor.
// Click a page in a preview to edit that edition there. Two-finger scroll pans in any direction, pinch zooms.
var GLABEL = { reading: 'Reading', slides: 'Lecture', workbook: 'Workbook' };
var gcols = {}, gridOn = true, gridT = 0, gridRaf = 0, gridReload = 0, gridHeights = {};   // var: zoom and mode code earlier in the file call gridLayout() before this runs
try { gridOn = localStorage.getItem('book-grid') !== '0'; } catch (x) {}
Book.views.forEach((v, k) => {
  const col = h(`<div class="gcol" data-view="${v}" style="order:${k}"><div class="glab"><span>${GLABEL[v]}</span></div><iframe title="${GLABEL[v]} preview" scrolling="no"></iframe></div>`);
  gworld.append(col); gcols[v] = col;
});
var canvasZ = 0.5; try { canvasZ = +localStorage.getItem('book-canvas-zoom') || 0.5; } catch (x) {}
function gridZoom() { return parseFloat(book.style.getPropertyValue('--zoom')) || 1; }   // the page zoom (single-column mode)
function gridLayout() {
  if (gridRaf) return; gridRaf = setTimeout(() => { gridRaf = 0; gridApply(); }, 16);   // a timer, not rAF: rAF never fires while the tab is hidden
}
function canvasPad() { return [Math.round(desk.clientWidth * 0.5), Math.round(desk.clientHeight * 0.5)]; }   // room on every side, so the canvas can always be panned
function canvasSize() {   // scale the world; the sizer takes its scaled size plus the margins, so scrolling covers it
  const [px, py] = canvasPad();
  gworld.style.transform = gridOn ? `scale(${canvasZ})` : '';
  gworld.style.left = gridOn ? px + 'px' : ''; gworld.style.top = gridOn ? py + 'px' : '';
  gsizer.style.width = gridOn ? Math.ceil(gworld.offsetWidth * canvasZ + 2 * px) + 'px' : '';
  gsizer.style.height = gridOn ? Math.ceil(gworld.offsetHeight * canvasZ + 2 * py) + 'px' : '';
  placeLabels();
}
function placeLabels() {
  glabels.hidden = !gridOn; if (!gridOn) return;
  const d = desk.getBoundingClientRect();
  const cols = [[book, GLABEL[Book.view] + ' (editing)', true], ...Book.views.filter(v => !gcols[v].hidden).map(v => [gcols[v], GLABEL[v], false])];
  glabels.innerHTML = cols.map(([el, t, ed]) => { const q = el.getBoundingClientRect(); return `<span class="${ed ? 'ed' : ''}" style="left:${Math.round(q.left - d.left + q.width / 2)}px">${t}</span>`; }).join('');
}
desk.addEventListener('scroll', () => { if (gridOn) placeLabels(); }, { passive: true });
var canvasStarted = false;
function gridApply() {
  if (!GLABEL || !gcols || !gcols.reading) return;   // still loading: the canvas code at the end of this file lays out once it has run
  document.body.classList.toggle('grid', gridOn); $('#x-grid').classList.toggle('on', gridOn);
  if (gridOn && gridZoom() !== 1) { book.style.setProperty('--zoom', 1); Book.refresh(); }   // the canvas is always laid out at 100%
  desk.style.setProperty('--gcolw', (576 + 48) + 'px');
  book.style.order = Book.views.indexOf(Book.view); book.dataset.glabel = GLABEL[Book.view] + ' (editing)';
  Book.views.forEach(v => { gcols[v].hidden = !gridOn || v === Book.view; });
  canvasSize();
  if (!gridOn) return;
  const tops = Book.pages().filter(p => !Book.split || Book.inView(p)).map(p => ({ id: p.id, top: p.offsetTop })), height = book.offsetHeight;
  Book.views.forEach(v => {
    const col = gcols[v], fr = col.querySelector('iframe'); if (col.hidden) return;
    fr.style.height = (Book.split && gridHeights[v] ? gridHeights[v] : height) + 'px';
    if (!fr.src) fr.src = `../view/${ch}?view=${v}&grid=1`;
    else if (fr.contentWindow) fr.contentWindow.postMessage({ gridLayout: { zoom: 1, tops, height } }, '*');
  });
  canvasSize();
  if (!canvasStarted) { canvasStarted = true; const [px, py] = canvasPad(); desk.scrollLeft = px - 16; desk.scrollTop = py - 40; placeLabels(); const zs = $('#zoom'); let o = zs.querySelector('option[value="custom"]'); if (!o) { o = document.createElement('option'); o.value = 'custom'; zs.prepend(o); } o.textContent = Math.round(canvasZ * 100) + '%'; zs.value = 'custom'; }
}
var canvasAnchor = null;
function setCanvasZoom(z, cx0, cy0) {   // scale the canvas, keeping the point under (cx0, cy0) where it is on screen
  z = Math.max(0.1, Math.min(3, z));
  const r = desk.getBoundingClientRect(); if (cx0 == null) { cx0 = r.left + r.width / 2; cy0 = r.top + r.height / 2; }
  if (!canvasAnchor || canvasAnchor.cx0 !== cx0 || canvasAnchor.cy0 !== cy0) {   // a new gesture (or a moved pointer): note which world point is under it
    const w = gworld.getBoundingClientRect(); canvasAnchor = { cx0, cy0, wx: (cx0 - w.left) / canvasZ, wy: (cy0 - w.top) / canvasZ };
  }
  canvasZ = z; canvasSize();
  const [px, py] = canvasPad();
  desk.scrollLeft = px + canvasAnchor.wx * z - (cx0 - r.left); desk.scrollTop = py + canvasAnchor.wy * z - (cy0 - r.top);
  placeLabels();
  const zs = $('#zoom'); let o = zs.querySelector('option[value="custom"]'); if (!o) { o = document.createElement('option'); o.value = 'custom'; zs.prepend(o); } o.textContent = Math.round(z * 100) + '%'; zs.value = 'custom';
  document.body.classList.add('zooming'); clearTimeout(gridT); gridT = setTimeout(() => { canvasAnchor = null; document.body.classList.remove('zooming'); place(); try { localStorage.setItem('book-canvas-zoom', String(+z.toFixed(3))); } catch (x) {} }, 150);
}
function gridAfterSave() { if (!gridOn || !gcols || !gcols.reading) return; clearTimeout(gridReload); gridReload = setTimeout(() => Book.views.forEach(v => { const fr = gcols[v].querySelector('iframe'); if (!gcols[v].hidden && fr.contentWindow) fr.contentWindow.postMessage({ gridReload: 1 }, '*'); }), 500); }
window.addEventListener('message', e => {
  const d = e.data || {};
  if (d.gridReady) { gridLayout(); setTimeout(focusChanged, 50); }
  if (d.gridMatch && gcols[d.gridMatch.view]) {   // split: slide the other document's column so its first page on this topic sits level with the page being edited
    const col = gcols[d.gridMatch.view], fr = col.querySelector('iframe');
    const dy = d.gridMatch.top != null && curPage && curPage.isConnected ? curPage.offsetTop - d.gridMatch.top : null;
    if (dy != null) { fr.style.transition = 'transform .25s ease'; fr.style.transform = `translateY(${Math.round(dy)}px)`; }
  }
  if (d.gridHeight && gcols[d.view]) { gridHeights[d.view] = d.gridHeight; const fr = gcols[d.view].querySelector('iframe'); if (fr && fr.style.height !== d.gridHeight + 'px') { fr.style.height = d.gridHeight + 'px'; canvasSize(); } }
  if (d.gridPick && Book.views.includes(d.view)) {   // edit this page in that edition
    const pg = Book.pages().find(p => p.id === d.gridPick);
    if (d.view !== Book.view) setMode(d.view);
    if (pg) { setPage(pg); renderInspector(); }
  }
});
book.addEventListener('book-refresh', gridLayout);
$('#x-grid').onclick = () => { gridOn = !gridOn; try { localStorage.setItem('book-grid', gridOn ? '1' : '0'); } catch (x) {} if (!gridOn) { let z = '1'; try { z = localStorage.getItem('book-zoom') || '1'; } catch (x) {} book.style.setProperty('--zoom', isNaN(+z) ? 1 : +z); Book.refresh(); } else canvasStarted = false; gridApply(); place(); const zs = $('#zoom'); if (gridOn) { let o = zs.querySelector('option[value="custom"]'); if (!o) { o = document.createElement('option'); o.value = 'custom'; zs.prepend(o); } o.textContent = Math.round(canvasZ * 100) + '%'; zs.value = 'custom'; } };
// pinch (a trackpad pinch arrives as a ctrl+wheel event) zooms the canvas around the pointer, never the whole page.
// Caught on the window so a pinch over the toolbar or side panels can't zoom the browser either; the preview
// frames forward theirs (see view.html, grid mode).
// During a pinch only a CSS transform changes (cheap, so it follows the fingers smoothly); when the fingers stop, the
// real zoom is applied once: pages re-laid out, the previews re-placed, and the scroll set so the point under the
// fingers stays put.
var pinch = null;   // { z0, z1, cx, cy (pointer, desk coords), els: [[el, ox, oy]] }
function zoomAt(dy, cx0, cy0) {
  if (gridOn) return setCanvasZoom(canvasZ * Math.exp(-dy * 0.01), cx0, cy0);   // canvas: pure magnification
  const r = desk.getBoundingClientRect();
  if (!pinch) {
    const els = [book, ...document.querySelectorAll('.gcol:not([hidden])')].map(el => { const q = el.getBoundingClientRect(); return [el, cx0 - q.left, cy0 - q.top]; });
    // anchor: the column and the page under the pointer, as fractions of their size, so that spot stays under the fingers
    const col = els.map(e => e[0]).find(el => { const q = el.getBoundingClientRect(); return cx0 >= q.left && cx0 <= q.right; }) || book;
    const cq = col.getBoundingClientRect();
    const pg = Book.pages().reduce((best, p) => { const q = p.getBoundingClientRect(), d = cy0 < q.top ? q.top - cy0 : cy0 > q.bottom ? cy0 - q.bottom : 0; return !best || d < best.d ? { p, d, q } : best; }, null);
    pinch = { z0: gridZoom(), z1: gridZoom(), cx0, cy0, els, col, fx: (cx0 - cq.left) / cq.width, pg: pg && pg.p, fy: pg ? (cy0 - pg.q.top) / pg.q.height : 0 };
    document.body.classList.add('zooming');
  }
  pinch.z1 = Math.max(0.15, Math.min(2.5, pinch.z1 * Math.exp(-dy * 0.01)));
  const k = pinch.z1 / pinch.z0;
  pinch.els.forEach(([el, ox, oy]) => { el.style.transformOrigin = ox + 'px ' + oy + 'px'; el.style.transform = 'scale(' + k + ')'; });
  const zs = $('#zoom'); let o = zs.querySelector('option[value="custom"]'); if (!o) { o = document.createElement('option'); o.value = 'custom'; zs.prepend(o); } o.textContent = Math.round(pinch.z1 * 100) + '%'; zs.value = 'custom';
  clearTimeout(gridT); gridT = setTimeout(endPinch, 150);
}
function endPinch() {
  const p = pinch; if (!p) return; pinch = null;
  p.els.forEach(([el]) => { el.style.transform = ''; el.style.transformOrigin = ''; });
  book.style.setProperty('--zoom', +p.z1.toFixed(3));
  gridApply();
  const cq = p.col.getBoundingClientRect(); desk.scrollLeft += cq.left + p.fx * cq.width - p.cx0;
  if (p.pg && p.pg.isConnected) { const q = p.pg.getBoundingClientRect(); desk.scrollTop += q.top + p.fy * q.height - p.cy0; }
  document.body.classList.remove('zooming');
  Book.refresh(); place();
  try { localStorage.setItem('book-zoom', String(+p.z1.toFixed(3))); } catch (x) {}
}
window.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); zoomAt(e.deltaY, e.clientX, e.clientY); }, { passive: false, capture: true });
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => window.addEventListener(t, e => e.preventDefault(), { passive: false }));   // Safari's own pinch
window.addEventListener('message', e => {
  const d = e.data || {}; if (!d.gridWheel) return;
  const fr = [...document.querySelectorAll('.gcol iframe')].find(f => f.contentWindow === e.source); if (!fr) return;
  const r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width);   // the frame's own coordinates are unscaled
  zoomAt(d.gridWheel.dy, r.left + d.gridWheel.x * k, r.top + d.gridWheel.y * k);
});
gridLayout();

// ---------------------------------------------------------------- toolbar menus (Insert, Draw, More)
document.querySelectorAll('#bar details.dd > summary').forEach(sm => sm.addEventListener('mousedown', e => e.preventDefault()));   // keep the text selection
document.addEventListener('mousedown', e => document.querySelectorAll('#bar details.dd[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
['#dd-insert', '#dd-more'].forEach(id => $(id).querySelector('.ddp').addEventListener('click', e => { if (e.target.closest('button')) $(id).open = false; }));   // Draw stays open so a tool can be double-clicked
document.querySelectorAll('#bar details.dd').forEach(d => d.addEventListener('toggle', () => { if (d.open) document.querySelectorAll('#bar details.dd[open]').forEach(o => { if (o !== d) o.open = false; }); }));
new MutationObserver(() => { const t = document.querySelector('#tools button.on'); $('#dd-draw > summary').classList.toggle('on', !!t && t.dataset.tool !== 'select'); }).observe($('#tools'), { subtree: true, attributes: true, attributeFilter: ['class'] });

// ---------------------------------------------------------------- side panels and focus
var focusOn = false;
function panelsChanged() {
  $('#tg-side').textContent = document.body.classList.contains('no-side') ? '›' : '‹';
  $('#tg-insp').textContent = document.body.classList.contains('no-insp') ? '‹' : '›';
  $('#tg-side').title = (document.body.classList.contains('no-side') ? 'Show' : 'Hide') + ' the page list (Cmd+\\ toggles both side panels)';
  $('#tg-insp').title = (document.body.classList.contains('no-insp') ? 'Show' : 'Hide') + ' the settings panel (Cmd+\\ toggles both side panels)';
  try { localStorage.setItem('book-panels', (document.body.classList.contains('no-side') ? 's' : '') + (document.body.classList.contains('no-insp') ? 'i' : '')); } catch (x) {}
  if (typeof canvasSize === 'function' && gridOn) { canvasSize(); placeLabels(); }
  place();
}
function togglePanel(cls, on) { document.body.classList.toggle(cls, on); panelsChanged(); }
$('#tg-side').onclick = () => togglePanel('no-side');
$('#tg-insp').onclick = () => togglePanel('no-insp');
try { const p = localStorage.getItem('book-panels') || ''; document.body.classList.toggle('no-side', p.includes('s')); document.body.classList.toggle('no-insp', p.includes('i')); } catch (x) {}
panelsChanged();
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); const hide = !(document.body.classList.contains('no-side') && document.body.classList.contains('no-insp')); document.body.classList.toggle('no-side', hide); document.body.classList.toggle('no-insp', hide); panelsChanged(); }
}, true);
function focusChanged() {
  if (typeof gcols === 'undefined' || !gcols || !gcols.reading) return;
  let id = focusOn ? '-none-' : null;   // in focus mode every preview page fades: only the page being edited stays bright
  if (Book.split && curPage && curPage.isConnected && !curPage.classList.contains('cover')) id = { id: curPage.id, topics: Book.topicsOf(curPage), dim: focusOn };   // split: the other document's pages on the same topics light up
  Book.views.forEach(v => { const fr = gcols[v].querySelector('iframe'); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ gridFocus: id }, '*'); });
  if (focusOn && curPage && curPage.isConnected && !followQuiet) { const pg = curPage; clearTimeout(focusT); focusT = setTimeout(() => { if (gridRaf) return focusChanged(); centerOn(pg); }, 40); }   // after any pending re-layout (e.g. the editing column just moved)
}
var focusT = 0;
// glide the canvas so the page fills most of the window, centred (a short zoom-and-pan animation)
var centerAnim = 0;
function centerOn(pg) {
  if (!document.body.classList.contains('grid')) { pg.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const W = desk.clientWidth, H = desk.clientHeight, [px, py] = canvasPad();
  const w = gworld.getBoundingClientRect(), r = pg.getBoundingClientRect(), d = desk.getBoundingClientRect();
  const TOP = 34, AV = H - TOP - 64;   // room for the column labels on top and the + buttons above and below
  const z0 = canvasZ, z1 = Math.max(0.1, Math.min(3, Math.min(AV / (r.height / z0), W * 0.92 / (r.width / z0))));
  const c0 = [(d.left + W / 2 - w.left) / z0, (d.top + TOP / 2 + H / 2 - w.top) / z0];                    // world point now at the centre of the window
  const c1 = [(r.left + r.width / 2 - w.left) / z0, (r.top + r.height / 2 - w.top) / z0];       // world point at the centre of the page
  const t0 = performance.now(), T = 320, ease = t => 1 - Math.pow(1 - t, 3);
  cancelAnimationFrame(centerAnim); document.body.classList.add('zooming');
  const step = now => {
    const t = Math.min(1, (now - t0) / T), e = ease(t);
    const z = z0 * Math.pow(z1 / z0, e), cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
    canvasZ = z; canvasSize();
    desk.scrollLeft = px + cx * z - W / 2; desk.scrollTop = py + cy * z - H / 2 - TOP / 2;
    placeLabels();
    if (t < 1 && !document.hidden) centerAnim = requestAnimationFrame(step);
    else {
      if (t < 1) { canvasZ = z1; canvasSize(); desk.scrollLeft = px + c1[0] * z1 - W / 2; desk.scrollTop = py + c1[1] * z1 - H / 2 - TOP / 2; placeLabels(); }
      document.body.classList.remove('zooming'); place();
      const zs = $('#zoom'); let o = zs.querySelector('option[value="custom"]'); if (!o) { o = document.createElement('option'); o.value = 'custom'; zs.prepend(o); } o.textContent = Math.round(canvasZ * 100) + '%'; zs.value = 'custom';
      try { localStorage.setItem('book-canvas-zoom', String(+canvasZ.toFixed(3))); } catch (x) {}
    }
  };
  if (document.hidden) step(t0 + T); else centerAnim = requestAnimationFrame(step);
}
$('#x-focus').onclick = () => {
  focusOn = !focusOn; document.body.classList.toggle('focus', focusOn); $('#x-focus').classList.toggle('on', focusOn);
  if (focusOn && !curPage) { const d = desk.getBoundingClientRect(); const pg = Book.pages().find(p => { const q = p.getBoundingClientRect(); return q.bottom > d.top + d.height / 3; }); if (pg) setPage(pg); }
  try { localStorage.setItem('book-focus', focusOn ? '1' : '0'); } catch (x) {}
  focusChanged(); placeAdders();
};
window.addEventListener('message', e => { if ((e.data || {}).gridReady) focusChanged(); });
try { if (localStorage.getItem('book-focus') === '1') $('#x-focus').click(); } catch (x) {}

// focus follows the scroll: the page nearest the middle of the window becomes the focused one (no zoom-and-centre,
// which is only for a click). Off during a centring animation, a pinch, and in review mode (which picks its own page).
var followT = 0, followQuiet = false;
desk.addEventListener('scroll', () => { if (!focusOn || revOn) return; clearTimeout(followT); followT = setTimeout(followScroll, 90); }, { passive: true });
function followScroll() {
  if (!focusOn || revOn || document.body.classList.contains('zooming')) return;
  const d = desk.getBoundingClientRect(), cy = d.top + d.height / 2;
  let best = null, bd = Infinity;
  for (const pg of Book.pages()) {
    const r = pg.getBoundingClientRect(); if (!r.height) continue;
    const dy = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
    if (dy < bd) { bd = dy; best = pg; }
    if (r.top > cy) break;
  }
  if (!best || best === curPage) return;
  followQuiet = true; try { setPage(best); } finally { followQuiet = false; }
  if (!sel) renderInspector();
}

// ---------------------------------------------------------------- + buttons above and below the selected page
var padd;   // no initializer: placeAdders() can run (and create it) before this line does
function placeAdders() {
  if (!padd) {
    if (typeof desk === 'undefined' || !desk) return;
    padd = document.createElement('div'); padd.id = 'padd';
    padd.innerHTML = '<button data-w="before" title="Add a page above this one">+</button><button data-w="after" title="Add a page below this one">+</button><button data-w="del" class="pdel" title="Delete this page (undo with Cmd+Z)">×</button>';
    padd.addEventListener('mousedown', e => e.preventDefault());
    padd.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !curPage) return;
      if (b.dataset.w === 'del') return $('#pg-del').click();
      const pg = curPage, before = b.dataset.w === 'before', q = b.getBoundingClientRect();
      openMenu(q.left, q.bottom + 4, LAYOUTS.filter(l => l[0] !== 'toc'), kind => addPageAt(kind, pg, before));
    });
    desk.append(padd);
  }
  const pg = curPage;
  if (!pg || !pg.isConnected) { padd.hidden = true; return; }
  padd.hidden = false;
  const r = pg.getBoundingClientRect(), span = (document.body.classList.contains('grid') ? gworld : pg).getBoundingClientRect();
  const gap = (r.height / 648) * 9;   // half the 24px space between pages, in screen px
  const cx = focusOn ? r.left + r.width / 2 : span.left + span.width / 2;   // focus mode: line up with the page itself
  const [ax, ay] = deskXY({ left: cx, top: r.top - gap }), [bx, by] = deskXY({ left: cx, top: r.bottom + gap });
  const [up, down, del] = padd.children;
  del.hidden = !focusOn || Book.pages().length < 2;
  if (!del.hidden) { const [dx, dy] = deskXY({ left: r.left, top: r.top }); del.style.left = dx + 'px'; del.style.top = dy + 'px'; }
  up.hidden = pg.classList.contains('cover'); up.style.left = ax + 'px'; up.style.top = ay + 'px';
  down.style.left = bx + 'px'; down.style.top = by + 'px';
}

// ---------------------------------------------------------------- review mode: answer comments one at a time
// A thread is a comment (data-id) plus the replies that point at it (data-re = that id). A reply can carry a verdict
// (data-verdict: fix | leave | discuss). A comment can quote the words it is about (data-quote), which get highlighted.
var revOn = false, revAt = null, revWasFocus = false, revAll = false, revPanel = null, revBox = null;
function cmtReplies(c) { return c && c.dataset.id ? [...book.querySelectorAll('.cmt[data-re]')].filter(r => r.dataset.re === c.dataset.id) : []; }
function cmtRoots() { return [...book.querySelectorAll('.cmt')].filter(c => !c.hasAttribute('data-re')); }
function needsYou(c) {   // open, and the last word in the thread isn't yours
  if (c.hasAttribute('data-done')) return false;
  const t = [c, ...cmtReplies(c)]; return (t[t.length - 1].dataset.by || '') !== me;
}
function revQueue() { return cmtRoots().filter(c => revAll || needsYou(c)); }
function revCount() { const n = cmtRoots().filter(needsYou).length, b = $('#x-review'); if (b) { b.textContent = n ? `Review (${n})` : 'Review'; b.classList.toggle('has', n > 0); b.classList.toggle('on', revOn); } return n; }
function quoteRange(el, q) {   // the range of the words q inside el (whitespace-insensitive), or null
  if (!el || !q) return null;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[data-rt], .cmt, .foot, svg, b-m') ? 2 : 1 });
  let n, text = ''; const map = [];
  while ((n = w.nextNode())) for (let i = 0; i < n.nodeValue.length; i++) {
    const ch = n.nodeValue[i], sp = /\s/.test(ch);
    if (sp && (!text || text.endsWith(' '))) continue;
    text += sp ? ' ' : ch; map.push([n, i]);
  }
  const want = q.replace(/\s+/g, ' ').trim(); let k = text.indexOf(want);
  if (k < 0) k = text.toLowerCase().indexOf(want.toLowerCase());
  if (k < 0 || !want) return null;
  const [a, ai] = map[k], [b, bi] = map[k + want.length - 1], r = document.createRange(); r.setStart(a, ai); r.setEnd(b, bi + 1); return r;
}
function revTarget(c) { const pg = c.closest('section.page'), t = targetOf(c); const r = quoteRange(t, c.dataset.quote) || quoteRange(pg, c.dataset.quote); return { pg, t, r }; }
function placeRev() {
  if (!revBox) return;
  if (!revOn || !revAt || !revAt.isConnected) { revBox.hidden = true; if (CSS.highlights) CSS.highlights.delete('rev'); return; }
  const { pg, t, r } = revTarget(revAt);
  if (CSS.highlights) { if (r) CSS.highlights.set('rev', new Highlight(r)); else CSS.highlights.delete('rev'); }
  const el = t || pg, q = (r || el).getBoundingClientRect(); if (!q.width) { revBox.hidden = true; return; }
  const pad = 4, [x, y] = deskXY({ left: q.left - pad, top: q.top - pad });
  revBox.hidden = false; Object.assign(revBox.style, { left: x + 'px', top: y + 'px', width: q.width + 2 * pad + 'px', height: q.height + 2 * pad + 'px' });
}
const VERDICT = { fix: 'Fix it', leave: 'Leave it', discuss: 'Discuss' };
function revRender() {
  if (!revPanel) return;
  const q = revQueue(), all = cmtRoots(), left = cmtRoots().filter(needsYou).length;
  if (revAt && !revAt.isConnected) revAt = null;
  const c = revAt, k = c ? q.indexOf(c) : -1;
  let html = `<div class="rv-top"><b>Review</b><span class="rv-n">${left ? left + ' waiting on you' : 'All answered'}</span><span class="sp"></span><button data-a="prev" title="Previous (K)">◀</button><button data-a="next" title="Next (J)">▶</button><button data-a="exit" title="Leave review (Esc)">Done</button></div>
    <label class="rv-all"><input type="checkbox" ${revAll ? 'checked' : ''}> Show answered and resolved too</label>`;
  if (!c) html += `<div class="rv-empty">${all.length ? 'Nothing waiting on you. Tick the box above to look back through the answered ones.' : 'No comments in this chapter yet.'}</div>`;
  else {
    const { pg, t } = revTarget(c), n = Book.pages().indexOf(pg) + 1, done = c.hasAttribute('data-done');
    const thread = [c, ...cmtReplies(c)];
    const mine = thread.slice(1).filter(r => (r.dataset.by || '') === me).pop();
    const msg = r => `<div class="rv-msg ${(r.dataset.by || '') === me ? 'me' : ''}"><div class="rv-meta"><b>${esc(r.dataset.by || '')}</b>${r.dataset.kind ? `<span class="rv-kind k-${esc(r.dataset.kind)}">${esc(r.dataset.kind)}</span>` : ''}${r.dataset.verdict ? `<span class="rv-verd v-${esc(r.dataset.verdict)}">${esc(VERDICT[r.dataset.verdict] || r.dataset.verdict)}</span>` : ''}<span>${esc(r.dataset.when || '')}</span></div>${r.textContent.trim() ? `<div class="rv-txt">${esc(r.textContent)}</div>` : ''}</div>`;
    html += `<div class="rv-card ${done ? 'done' : ''}">
      <div class="rv-where" title="Go to it">${k >= 0 ? (k + 1) + ' of ' + q.length + ' · ' : ''}p. ${n} · ${esc((pg.querySelector('h2') || {}).textContent || pg.id)}${done ? ' · resolved' : ''}</div>
      ${c.dataset.quote ? `<div class="rv-quote">“${esc(c.dataset.quote)}”</div>` : ''}
      ${thread.map(msg).join('')}
      <textarea class="rv-reply" placeholder="Your reply (optional). Then pick what to do:" spellcheck="true"></textarea>
      <div class="rv-acts">${Object.entries(VERDICT).map(([v, l], i) => `<button data-v="${v}" class="${mine && mine.dataset.verdict === v ? 'cur' : ''}">${l} <kbd>${i + 1}</kbd></button>`).join('')}</div>
      <div class="rv-row2">${done ? '<button data-a="reopen">Reopen</button>' : '<button data-a="resolve">Resolve (nothing to do)</button>'}${mine ? '<button data-a="unreply">Remove my reply</button>' : ''}</div>
      <div class="help"><b>1</b> fix it, <b>2</b> leave it, <b>3</b> discuss: saves your reply and moves on. <b>J</b>/<b>K</b> next and previous, <b>R</b> to type a reply, <b>Cmd+Enter</b> in the box saves it as Discuss, <b>Esc</b> leaves review. You can edit the page while reviewing.</div>
    </div>`;
  }
  revPanel.innerHTML = html;
  const ta = revPanel.querySelector('.rv-reply');
  if (ta && c) {
    const mine = cmtReplies(c).filter(r => (r.dataset.by || '') === me).pop();
    if (mine) ta.value = mine.textContent;
    ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); revAnswer('discuss'); } else if (e.key === 'Escape') { e.preventDefault(); ta.blur(); } else if ((e.metaKey || e.ctrlKey) && /^[123]$/.test(e.key)) { e.preventDefault(); revAnswer(Object.keys(VERDICT)[+e.key - 1]); } };
  }
  revCount();
}
function revGo(c) {
  revAt = c || null;
  if (c) { const { pg, t } = revTarget(c); select(null, true); if (curPage === pg) focusChanged(); else setPage(pg); renderInspector(); if (!document.body.classList.contains('grid')) (t || pg).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  revRender(); setTimeout(placeRev, 380);
}
function revStep(d) {   // next / previous in the queue, by position in the chapter
  const roots = cmtRoots(), q = revQueue(); if (!q.length) return revGo(null);
  const at = revAt ? roots.indexOf(revAt) : -1;
  const pick = d > 0 ? q.find(c => roots.indexOf(c) > at) || q[0] : [...q].reverse().find(c => roots.indexOf(c) < at) || q[q.length - 1];
  revGo(pick);
}
function revAnswer(v) {
  const c = revAt; if (!c || !c.isConnected) return;
  const ta = revPanel.querySelector('.rv-reply'), text = ta ? ta.value.trim() : '';
  commit(true);
  if (!c.dataset.id) c.dataset.id = 'c-' + uid().slice(2);
  let r = cmtReplies(c).filter(x => (x.dataset.by || '') === me).pop();
  const last = [c, ...cmtReplies(c)].pop();
  if (!r || r !== last) {   // a new reply goes at the end of the thread (if someone answered you since, yours comes after that)
    r = document.createElement('div'); r.className = 'cmt'; r.dataset.by = me; r.dataset.re = c.dataset.id; last.after(r);
  }
  r.dataset.when = stamp(); r.dataset.verdict = v; r.textContent = text;
  commit(true); placeMarkers(); renderInspector();
  if (revAll) revRender(); else revStep(1);
}
function revAct(a) {
  const c = revAt; if (!c) return;
  commit(true);
  if (a === 'resolve') [c, ...cmtReplies(c)].forEach(x => x.setAttribute('data-done', '1'));
  else if (a === 'reopen') [c, ...cmtReplies(c)].forEach(x => x.removeAttribute('data-done'));
  else if (a === 'unreply') { const r = cmtReplies(c).filter(x => (x.dataset.by || '') === me).pop(); if (r) r.remove(); }
  commit(true); placeMarkers(); renderInspector();
  if (a === 'resolve' && !revAll) revStep(1); else revRender();
}
function setReview(on) {
  if (on === revOn) return;
  revOn = on; document.body.classList.toggle('review', on);
  if (!revPanel) {
    revPanel = document.createElement('aside'); revPanel.id = 'rev'; $('#insp').after(revPanel);
    revPanel.addEventListener('click', e => {
      const b = e.target.closest('button'), w = e.target.closest('.rv-where');
      if (w && revAt) return revGo(revAt);
      if (!b) return;
      if (b.dataset.v) return revAnswer(b.dataset.v);
      const a = b.dataset.a; if (a === 'exit') setReview(false); else if (a === 'next') revStep(1); else if (a === 'prev') revStep(-1); else revAct(a);
    });
    revPanel.addEventListener('change', e => { if (e.target.matches('.rv-all input')) { revAll = e.target.checked; revRender(); } });
    revBox = document.createElement('div'); revBox.id = 'revbox'; revBox.hidden = true; desk.append(revBox);
  }
  if (on) {
    revWasFocus = focusOn; if (!focusOn) $('#x-focus').click();
    const q = revQueue(), roots = cmtRoots(), here = curPage ? Book.pages().indexOf(curPage) : 0;
    revAt = null; revGo(q.find(c => Book.pages().indexOf(c.closest('section.page')) >= here) || q[0] || null);
  } else {
    if (!revWasFocus && focusOn) $('#x-focus').click();
    revAt = null; placeRev(); renderInspector();
  }
  revCount();
}
(function () {
  const b = document.createElement('button'); b.id = 'x-review'; b.title = 'Go through the comments one at a time and answer each (Esc to leave)'; b.textContent = 'Review';
  $('#x-cmts').after(b); b.onclick = () => setReview(!revOn);
  document.addEventListener('keydown', e => {
    if (!revOn || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = document.activeElement, typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if (typing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return setReview(false); }
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); revStep(1); }
    else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); revStep(-1); }
    else if (/^[123]$/.test(e.key)) { e.preventDefault(); revAnswer(Object.keys(VERDICT)[+e.key - 1]); }
    else if (k === 'r') { e.preventDefault(); const t = revPanel && revPanel.querySelector('.rv-reply'); if (t) t.focus(); }
  }, true);
  book.addEventListener('book-refresh', () => { revCount(); if (revOn) placeRev(); });
  revCount();
})();

// ---------------------------------------------------------------- figure flip: the code that draws a figure
// Each figure has its own script (chapters/<slug>/figsrc/figs/<name>.py). Flipping a figure shows that script in a panel
// laid over it: edit, Run (Cmd+Enter) to save the script and redraw the figure, Esc to flip back. Edits you haven't run
// are kept (in this tab) if you flip away and back. Nothing here goes into the chapter file.
var figPanel = null, figAt = null, figDrafts = {};
function placeFigCode() {
  if (!figPanel || figPanel.hidden) return;
  if (!figAt || !figAt.isConnected) return flipBack();
  const r = figAt.getBoundingClientRect(), d = desk.getBoundingClientRect(), [x, y] = deskXY(r);
  const w = Math.min(Math.max(r.width, 720), d.width - 24), h = Math.max(r.height, 360);
  const left = Math.min(Math.max(x, desk.scrollLeft + 12), desk.scrollLeft + d.width - w - 12);
  Object.assign(figPanel.style, { left: left + 'px', top: y + 'px', width: w + 'px', minHeight: h + 'px' });
}
async function flipFig(el) {
  if (!el || el.tagName !== 'B-FIG') return;
  if (figAt === el && figPanel && !figPanel.hidden) return flipBack();
  const fig = el.getAttribute('src') || '';
  let d;
  try { const r = await fetch('../api/figsrc/' + ch + '?fig=' + encodeURIComponent(fig)); d = await r.json(); if (!r.ok) throw new Error(d.error); }
  catch (e) { if (e.message === 'not found') return toast('Restart the editor server (Ctrl-C, then python3 server.py) to see figure code'); return toast(/\.png$|\.jpe?g$/i.test(fig) ? 'This figure is a screenshot, so there is no code behind it' : 'No script draws ' + fig + ' yet'); }
  if (!figPanel) {
    figPanel = document.createElement('div'); figPanel.id = 'figcode'; figPanel.hidden = true;
    figPanel.innerHTML = '<div class="fc-bar"><span class="fc-name"></span><span class="fc-state"></span><span class="sp"></span>' +
      '<button data-a="run" class="fc-run" title="Save the script and redraw the figure (Cmd+Enter)">▶ Run</button><button data-a="revert" title="Back to the saved script">Revert</button>' +
      '<button data-a="close" title="Flip back to the figure (Esc)">Flip back</button></div>' +
      '<textarea class="fc-code" spellcheck="false" wrap="off"></textarea><pre class="fc-out" hidden></pre>';
    figPanel.addEventListener('mousedown', e => e.stopPropagation());
    figPanel.addEventListener('click', e => { const a = e.target.closest('button') && e.target.closest('button').dataset.a; if (a === 'run') runFig(); else if (a === 'revert') revertFig(); else if (a === 'close') flipBack(); });
    const ta = figPanel.querySelector('.fc-code');
    ta.addEventListener('input', () => { figDrafts[figPanel.dataset.key] = ta.value; figState(); });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runFig(); }
      else if (e.key === 'Escape') { e.preventDefault(); flipBack(); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
    });
    desk.append(figPanel);
  }
  figAt = el; figPanel.dataset.key = ch + '|' + fig; figPanel._saved = d.code; figPanel._fig = fig;
  figPanel.querySelector('.fc-name').textContent = d.path.replace(/^chapters\//, '') + (d.borrowed ? '  (borrowed from ' + d.home + ')' : '');
  const ta = figPanel.querySelector('.fc-code'); ta.value = figDrafts[figPanel.dataset.key] != null ? figDrafts[figPanel.dataset.key] : d.code;
  ta.rows = Math.min(40, Math.max(14, ta.value.split('\n').length + 1));
  const out = figPanel.querySelector('.fc-out'); out.hidden = true; out.textContent = ''; out.classList.remove('err');
  figPanel.hidden = false; el.classList.add('ed-flipped'); placeFigCode(); figState(); ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
}
function figState(msg) {
  if (!figPanel) return;
  const ta = figPanel.querySelector('.fc-code'), dirty = ta.value !== figPanel._saved;
  figPanel.querySelector('.fc-state').textContent = msg || (dirty ? 'edited, not run yet' : '');
  figPanel.classList.toggle('dirty', dirty);
}
function flipBack() {
  if (!figPanel) return;
  figPanel.hidden = true; if (figAt) figAt.classList.remove('ed-flipped'); figAt = null;
}
function revertFig() {
  if (!figPanel) return;
  const ta = figPanel.querySelector('.fc-code'); ta.value = figPanel._saved; delete figDrafts[figPanel.dataset.key]; figState();
}
async function runFig() {
  if (!figPanel || figPanel.hidden || figPanel.classList.contains('busy')) return;
  const ta = figPanel.querySelector('.fc-code'), out = figPanel.querySelector('.fc-out'), el = figAt, fig = figPanel._fig, key = figPanel.dataset.key;
  figPanel.classList.add('busy'); figState('running…');
  let d;
  try { const r = await fetch('../api/figsrc/' + ch + '?fig=' + encodeURIComponent(fig), { method: 'POST', body: JSON.stringify({ code: ta.value }) }); d = await r.json(); }
  catch (e) { d = { ok: false, err: 'Could not reach the editor server (is it still running?)' }; }
  figPanel.classList.remove('busy');
  figPanel._saved = ta.value; delete figDrafts[key];
  const text = ((d.out || '') + (d.err ? (d.out ? '\n' : '') + d.err : '')).trim();
  out.hidden = !text; out.textContent = text; out.classList.toggle('err', !d.ok);
  if (d.ok) {
    figState('redrawn in ' + d.seconds + ' s');
    document.querySelectorAll('#book b-fig').forEach(f => { if (f.getAttribute('src') === fig) Book.reloadFig(f); });
    if (typeof gcols !== 'undefined' && gcols) Book.views.forEach(v => { const fr = gcols[v] && gcols[v].querySelector('iframe'); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ gridReload: true }, '*'); });
    setTimeout(placeFigCode, 300);
  } else figState('saved, but the script stopped with an error (the figure is unchanged)');
  if (el && el.isConnected && figAt === el) ta.focus();
}
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f' && sel && sel.tagName === 'B-FIG') { e.preventDefault(); flipFig(sel); }
}, true);

// ---------------------------------------------------------------- centring a block (text, heading, equation): data-align="center"
function toggleCenter() {
  const h = editHost(), list = allSel().length ? allSel() : (h ? [blockOf(h)].filter(Boolean) : []);
  if (!list.length) return toast('Click a block (or into some text) first');
  const on = !list.every(b => b.getAttribute('data-align') === 'center');
  commit(true);
  list.forEach(b => { if (on) b.setAttribute('data-align', 'center'); else b.removeAttribute('data-align'); });
  commit(true); Book.refresh(); place();
}

// ---------------------------------------------------------------- numbers in running text: <span class="num"> (Consolas, dark grey)
// One pass over the chapter's text. Skips math, code, equations, figures, tables, headings, comments, fill-in blanks, links and
// anything already bold or coloured (labels like "1. Units" and highlighted figures keep their look). A number is a
// run of digits (with thousands commas, a decimal part, a leading minus or a trailing %), not touching a letter: so
// "2012", "−6.7", "9,553", "82%" and the 8 in "degree-8" count, but "3D" and "x2" don't.
const NUM_RE = /(?<![\p{L}\p{N}_.,])[−-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_.,])[−-]?\d+(?:\.\d+)?%?(?![\p{L}\p{N}_]|[.,]\d)/gu;
const NUM_SKIP = 'b-m, b-eq, b-code, b-out, b-fig, b-matmul, b-answers, b-ref, b-toc, b-embed, svg, code, pre, h1, h2, h3, h4, b, strong, a, u, sup, sub, td, th, .cmt, .foot, [data-rt], span.num, span.mono, .cover-text';   // tables keep their own look
function formatNumbers(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest(NUM_SKIP) ? 2 : 1 });
  const nodes = []; let n; while ((n = w.nextNode())) if (/\d/.test(n.nodeValue)) nodes.push(n);
  let count = 0;
  root.querySelectorAll('span.mono').forEach(s => {   // a number you had already set in Consolas becomes a number
    if (s.closest(NUM_SKIP.replace(', span.mono', '').replace(', span.num', ''))) return;
    const t = s.textContent.trim(); NUM_RE.lastIndex = 0; const m = NUM_RE.exec(t);
    if (m && m[0] === t) { s.className = 'num'; count++; }
  });
  nodes.forEach(t => {
    const v = t.nodeValue; NUM_RE.lastIndex = 0; let m, at = 0; const parts = [];
    while ((m = NUM_RE.exec(v))) { parts.push(document.createTextNode(v.slice(at, m.index))); const s = document.createElement('span'); s.className = 'num'; s.textContent = m[0]; parts.push(s); at = m.index + m[0].length; count++; }
    if (!parts.length) return;
    parts.push(document.createTextNode(v.slice(at)));
    t.replaceWith(...parts.filter(p => p.nodeType === 1 || p.nodeValue));
  });
  return count;
}
// ---------------------------------------------------------------- chapter switcher: the title in the bar (or Cmd+O)
let chapterList = null;
async function loadChapters() {   // every chapter folder, with its title and place in the book (from its cover)
  const slugs = (await (await fetch('../api/info')).json()).chapters || [];
  const rows = await Promise.all(slugs.map(async slug => {
    try {
      const c = (await (await fetch('../api/chapter/' + slug)).json()).content || '', meta = Book.parse(c).meta || {};
      const k = /Unit\s*0*(\d+)\s*·\s*Chapter\s*0*(\d+)/i.exec(c) || [], u = +k[1] || 99, n = +k[2] || +meta.chapter || 99;
      return { slug, title: meta.title || slug, u, n, split: !!meta.split };
    } catch (x) { return { slug, title: slug, u: 99, n: 99 }; }
  }));
  return rows.sort((a, b) => a.u - b.u || a.n - b.n || a.title.localeCompare(b.title));
}
async function switchChapter() {
  const r = $('#title-btn').getBoundingClientRect();
  if (!chapterList) { menu.className = 'chapters'; openMenu(r.left, r.bottom + 4, [['', 'Loading chapters…', '']], () => {}); chapterList = await loadChapters(); }
  const items = chapterList.map(c => [c.slug, (c.u < 99 ? c.u + '.' + c.n + '  ' : '') + c.title, c.slug === ch ? 'open now' : c.split ? 'Lecture + Reading' : '']);
  openMenu(r.left, r.bottom + 4, items, async slug => {
    if (!slug || slug === ch) return;
    commit(true); await save();   // nothing is lost by switching: the current chapter is saved first
    if (cur !== saved && !confirm('This chapter has changes that could not be saved. Switch anyway?')) return;
    location.href = '../edit/' + slug;
  });
  menu.className = 'chapters';
  const here = chapterList.findIndex(c => c.slug === ch);
  [...menu.children].forEach((d, k) => { d.classList.toggle('here', k === here); d.classList.toggle('cur', k === Math.max(0, here)); }); menuAt = Math.max(0, here);
}
$('#title-btn').onclick = switchChapter;
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); switchChapter(); } });
$('#x-insync').hidden = !Book.split;
{ const k = document.querySelector('[data-style="key"]'); if (k) k.hidden = Book.split; }   // key sentences belong to the old shared-page model
$('#x-insync').onclick = () => {   // the Reading has been brought in step with the Lecture: clear the "slides changed" marks
  commit(true); Book.meta.synced = { at: new Date().toISOString().slice(0, 16).replace('T', ' '), topics: Book.topicHashes() };
  commit(true); Book.markStale(); renderPages(); renderInspector(); toast('Marked the Reading as in step with the Lecture');
};
$('#x-nums').onclick = () => {
  $('#dd-more').open = false;
  commit(true); const k = formatNumbers(book); commit(true); Book.refresh(); place();
  toast(k ? `Formatted ${k} number${k === 1 ? '' : 's'} (Cmd+Z undoes it)` : 'Every number is already formatted', k ? 'Undo' : null, k ? doUndo : null);
};
})();

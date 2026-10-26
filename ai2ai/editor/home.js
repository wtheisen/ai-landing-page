// The editor's home page: sign in, get the latest chapters, choose what's kept for offline use, open a chapter.
(async function () {
'use strict';
const { Store, Files, Sync, mimeOf } = window.AI2AI;
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);

// the service worker makes the editor work offline; until it controls this page, nothing can be opened
let swReady = Promise.resolve();
if ('serviceWorker' in navigator) {
  swReady = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    if (!navigator.serviceWorker.controller) return new Promise(res => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }));
  });
}
// ask the browser to keep this site's storage (iOS Safari only honours it for a home-screen app)
let persisted = false;
try { persisted = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { /* not offered */ }

if (params.get('dev')) await Store.kv('remote', { kind: 'dev', base: params.get('dev') });   // testing: a plain folder stands in for GitHub
let cfg = await Store.kv('remote');

async function chips() {
  const dirty = (await Files.dirty()).length, est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  const c = [navigator.onLine ? ['ok', 'Online'] : ['warn', 'Offline']];
  if (dirty) c.push(['warn', dirty + (dirty === 1 ? ' file' : ' files') + ' changed on this device']);
  c.push(persisted ? ['ok', 'Storage kept'] : ['', 'Storage may be cleared']);
  if (est) c.push(['', (est.usage / 1048576).toFixed(0) + ' MB used']);
  $('#chips').innerHTML = c.map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join('');
}
addEventListener('online', chips); addEventListener('offline', chips);

function show() {
  $('#signin').hidden = !!cfg; $('#sync').hidden = !cfg;
  if (cfg) $('#where').textContent = cfg.kind === 'dev' ? 'Test copy: ' + cfg.base : cfg.repo;
}
$('#go').onclick = async () => {
  const repo = $('#repo').value.trim(), token = $('#token').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return msg('Fill in the repository and the token.');
  $('#go').disabled = true; msg('Checking the token…');
  try {
    const api = params.get('api') || 'https://api.github.com';
    const r = await fetch(api + '/repos/' + repo, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'GitHub doesn\'t accept that token for ' + repo + '.' : 'GitHub said ' + r.status + '.');
    const d = await r.json();
    if (d.permissions && !d.permissions.push) msg('Signed in, but this token can only read. Saving back to GitHub will need Contents: Read and write.');
    cfg = { kind: 'github', repo, token, branch: d.default_branch || 'main' }; if (params.get('api')) cfg.api = api; await Store.kv('remote', cfg);
    show(); shareToken(token).then(inkNote); await pull();
  } catch (e) { msg(e.message); }
  $('#go').disabled = false;
};
// One sign-in for everything: the editor's token also signs this device in for lecture notes (ink.js, the pen on
// the Lecture pages, reads eai-ink-token), as long as the token can also write to the site's repository.
const SITE_REPO = 'wtheisen/ai-landing-page';
async function shareToken(token) {
  if (params.get('api')) return null;   // tests against the stand-in GitHub
  try {
    const r = await fetch('https://api.github.com/repos/' + SITE_REPO, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    if (d && d.permissions && d.permissions.push) { localStorage.setItem('eai-ink-token', JSON.stringify(token)); return true; }
  } catch (x) { return null; }   // offline: try again next time
  return false;
}
function inkNote(ok) { const n = $('#inknote'); if (n) n.hidden = ok !== false; }
function msg(t) { $('#msg').textContent = $('#smsg').textContent = t || ''; }

async function when() {
  const t = await Store.kv('tree');
  $('#when').textContent = t ? 'Last synced with GitHub: ' + new Date(t.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not downloaded yet';
}
const prog = (d, n) => { const p = $('#prog'); p.hidden = !n; p.max = n || 1; p.value = d; };
// syncing runs in the service worker (one at a time for the whole app); this page asks it and shows the answer
function swSync() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw || cfg.kind === 'dev') return Sync.sync(prog, 'this device').then(result => ({ state: 'synced', result }));
  return new Promise(res => {
    const on = e => { const d = e.data || {}; if (d.type === 'sync' && d.reply) { navigator.serviceWorker.removeEventListener('message', on); res(d); } };
    navigator.serviceWorker.addEventListener('message', on); sw.postMessage({ type: 'sync' });
  });
}
async function pull() {
  if (!navigator.onLine) return msg('Offline: edits stay on this device until it syncs.');
  $('#pull').disabled = true; msg('Syncing with GitHub…');
  const d = await swSync(), r = d.result || {};
  if (d.state === 'error') msg('Could not sync: ' + d.error);
  else msg([
    r.pushed ? 'Sent ' + r.pushed + (r.pushed === 1 ? ' file' : ' files') + ' to GitHub.' : '',
    r.fetched ? 'Got ' + r.fetched + (r.fetched === 1 ? ' file' : ' files') + ' from GitHub.' : '',
    r.merged && r.merged.length ? 'Merged GitHub\'s changes into ' + r.merged.map(p => p.replace(/^chapters\/|\/chapter\.html$/g, '')).join(', ') + '.' : '',
    r.clashes && r.clashes.length ? 'Changed in both places (both versions kept, the GitHub copy marked): ' + r.clashes.map(c => c.path.replace(/^chapters\/|\/chapter\.html$/g, '') + ' (' + c.where.join(', ') + ')').join('; ') + '.' : '',
    r.failed ? r.failed + ' files failed to download.' : '',
  ].filter(Boolean).join('\n') || 'Everything is up to date.');
  prog(0, 0); $('#pull').disabled = false; await when(); await list(); await chips();
}
$('#pull').onclick = pull;
$('#all').onclick = async () => {
  $('#all').disabled = true;
  for (const ch of (await rows()).filter(r => r.slug)) {
    msg('Downloading ' + ch.title + '…');
    try { await Sync.chapter(ch.slug, prog); } catch (e) { msg(ch.title + ': ' + e.message); break; }
    await list();
  }
  prog(0, 0); msg('Done.'); $('#all').disabled = false; await chips();
};

// ---------------------------------------------------------------- the shelf: every chapter as a small cover, in book order
// toc.json gives the order (units, then chapters, planned ones without a slug included). Dragging a cover rewrites
// toc.json and, for every chapter whose number changed, its book-meta "chapter" and cover kicker, then syncs.
let showPlanned = true; try { showPlanned = localStorage.getItem('ai2ai-planned') !== '0'; } catch (e) { /* no storage */ }
let shelf = null;   // { toc, units: [{n, title, items: [{key, slug?, title}]}], chapters: {slug: info} }

async function load() {
  const tocF = await Files.get('chapters/toc.json'), files = await Files.under('chapters/');
  const chapters = {};
  for (const f of files) {
    const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(f.path); if (!m || typeof f.data !== 'string') continue;
    let meta = {}; try { meta = JSON.parse((/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>/.exec(f.data) || [])[1] || '{}'); } catch (e) { /* bad meta */ }
    const cover = (/<section class="page[^"]*\bcover\b[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(f.data) || [])[1] || '';
    const art = (/<b-fig\b[^>]*\bsrc="([^"]+)"/.exec(cover) || [])[1] || '';
    chapters[m[1]] = { slug: m[1], title: meta.title || m[1], dirty: f.dirty, art: /^[\w./-]+$/.test(art) && !art.includes('..') ? art : '' };
  }
  let toc = null; try { toc = tocF ? JSON.parse(tocF.data) : null; } catch (e) { /* bad toc */ }
  const units = [], seen = new Set();
  for (const u of (toc && toc.units) || []) {
    units.push({ n: u.n, title: u.title, items: (u.chapters || []).map((c, i) => {
      if (c.slug) seen.add(c.slug);
      return { key: c.slug ? 's:' + c.slug : 'p:' + u.n + ':' + i, slug: c.slug && chapters[c.slug] ? c.slug : null, title: c.title, raw: c };
    }) });
  }
  const other = Object.keys(chapters).filter(s => !seen.has(s)).sort().map(s => ({ key: 's:' + s, slug: s, title: chapters[s].title, raw: { title: chapters[s].title, slug: s } }));
  shelf = { toc, units, other, chapters };
}
const pad = (v, like) => String(v).padStart(String(like).length, '0');

async function list() {
  await load();
  const { units, other, chapters } = shelf;
  if (!units.length && !other.length) { $('#list').innerHTML = cfg ? '<p class="note">No chapters on this device yet. Get the latest while online.</p>' : ''; return; }
  const planned = units.reduce((k, u) => k + u.items.filter(i => !i.slug).length, 0);
  let html = `<div class="shelf-bar"><span class="note">Drag a cover to reorder${matchMedia('(pointer: coarse)').matches ? ' (press and hold first)' : ''}.</span>`
    + (planned ? `<button class="mini" id="tg-planned">${showPlanned ? 'Hide' : 'Show'} planned (${planned})</button>` : '') + '</div>';
  const card = async (it, u, num) => {
    if (!it.slug) return showPlanned ? `<div class="book planned" data-key="${esc(it.key)}"><div class="cv"><div class="cv-text"><div class="kicker">${esc(num)}</div><div class="cv-title">${esc(it.title)}</div><div class="rule"></div></div><div class="cv-plan">Planned</div></div></div>` : '';
    const c = chapters[it.slug], [have, need] = await Sync.coverage(it.slug), full = need && have >= need;
    const href = encodeURIComponent(it.slug);
    return `<div class="book" data-key="${esc(it.key)}" data-slug="${esc(it.slug)}">
      <a class="cv" href="edit/${href}" draggable="false">${c.art ? `<span class="cv-art" data-art="chapters/${esc(it.slug)}/${esc(c.art)}"><img alt="" draggable="false"${arts[`chapters/${it.slug}/${c.art}`] ? ` src="${arts[`chapters/${it.slug}/${c.art}`]}"` : ''}></span>` : '<span class="cv-art none"></span>'}
        <span class="cv-text"><span class="kicker">${esc(num)}</span><span class="cv-title">${esc(c.title)}</span><span class="rule"></span></span></a>
      <div class="meta">${c.dirty ? '<span class="edited">Edited here</span>' : ''}<span class="off ${full ? 'full' : ''}">${full ? 'Offline ✓' : need ? `<a href="#" data-dl="${esc(it.slug)}">Download</a> ${have}/${need}` : ''}</span></div>
      <div class="acts"><a class="btn" href="view/${href}">Read</a><a class="btn" href="edit/${href}">Edit</a><a class="btn lect" href="view/${href}?view=slides&lecture=1" title="Teach from this device: the Lecture with the pen in hand and the faint answers hidden (safe to mirror to the projector)">Lecture</a><a class="ans" href="view/${href}?view=slides&lecture=answers" title="For a second screen: the Lecture with the faint answers showing">answers</a></div></div>`;
  };
  for (const u of units) {
    html += `<div class="unit"><span class="un">${esc(u.n)}</span>${esc(u.title)}</div><div class="grid" data-unit="${esc(u.n)}">`;
    for (const it of u.items) html += await card(it, u, u.n + '.' + it.raw.n);
    html += '</div>';
  }
  if (other.length) {
    html += '<div class="unit">Not in the contents yet</div><div class="grid" data-unit="">';
    for (const it of other) html += await card(it, null, '');
    html += '</div>';
  }
  $('#list').innerHTML = html;
  covers();
  if ($('#tg-planned')) $('#tg-planned').onclick = () => { showPlanned = !showPlanned; try { localStorage.setItem('ai2ai-planned', showPlanned ? '1' : '0'); } catch (e) { /* no storage */ } list(); };
  $('#list').querySelectorAll('[data-dl]').forEach(a => a.onclick = async e => {
    e.preventDefault(); e.stopPropagation(); const s = a.dataset.dl; a.textContent = 'Downloading…';
    try { await Sync.chapter(s, prog); } catch (x) { msg(x.message); }
    prog(0, 0); await list(); await chips();
  });
}

// cover art: read from this device's store, or fetched from GitHub once and kept (Sync.file), shown as a blob URL.
// (Not through the service worker's c/ route, so it works whichever version of the worker is in charge.)
const arts = {};   // repo path -> object URL, kept across redraws
async function covers() {
  const todo = [...$('#list').querySelectorAll('.cv-art[data-art]')].filter(el => !arts[el.dataset.art]);
  await pool(todo, 4, async el => {
    const path = el.dataset.art;
    try {
      const f = await Sync.file(path);
      if (!f) throw new Error('not on this device and not on GitHub');
      const blob = typeof f.data === 'string' ? new Blob([f.data], { type: mimeOf(path) }) : (f.data.type ? f.data : new Blob([f.data], { type: mimeOf(path) }));
      arts[path] = arts[path] || URL.createObjectURL(blob);
    } catch (e) { console.warn('cover art', path, e); arts[path] = null; }
    document.querySelectorAll(`.cv-art[data-art="${CSS.escape(path)}"]`).forEach(x => {
      if (arts[path]) x.querySelector('img').src = arts[path]; else x.classList.add('none');
    });
  });
}
async function pool(items, n, fn) { let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) await fn(items[k++]); })); }

// ---------------------------------------------------------------- drag to reorder
// Mouse: drag after a few pixels. Touch and pen: press and hold, then drag (a plain swipe still scrolls).
let drag = null, justDragged = 0;
$('#list').addEventListener('pointerdown', e => {
  const book = e.target.closest('.book'); if (!book || e.button > 0 || e.target.closest('.acts, .meta')) return;
  const st = { book, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', live: false };
  if (st.touch) st.timer = setTimeout(() => begin(st), 320);
  drag = st;
});
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  if (!drag.live) {
    if (drag.touch) { if (d > 8) { clearTimeout(drag.timer); drag = null; } return; }
    if (d > 6) begin(drag); else return;
  }
  e.preventDefault(); drag.lx = e.clientX; drag.ly = e.clientY; follow();
}, { passive: false });
addEventListener('touchmove', e => { if (drag && drag.live) e.preventDefault(); }, { passive: false });   // no scrolling while a cover is held
addEventListener('pointerup', e => end(e, false)); addEventListener('pointercancel', e => end(e, true));
addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
$('#list').addEventListener('click', e => { if (Date.now() - justDragged < 400) { e.preventDefault(); e.stopPropagation(); } }, true);

function begin(st) {
  if (drag !== st) return;
  const cv = st.book.querySelector('.cv'), r = cv.getBoundingClientRect();
  st.live = true; st.dx = st.x - r.left; st.dy = st.y - r.top; st.lx = st.x; st.ly = st.y;
  // the floating copy is just the cover; it sits in a .book of the same width so its sizes (cqw) come out the same
  st.ghost = document.createElement('div'); st.ghost.className = 'book ghost'; st.ghost.style.width = r.width + 'px';
  const c = cv.cloneNode(true); c.querySelectorAll('img').forEach(i => i.loading = 'eager'); st.ghost.appendChild(c); document.body.appendChild(st.ghost);
  st.book.classList.add('hole'); document.body.classList.add('dragging');
  if (navigator.vibrate) try { navigator.vibrate(10); } catch (x) { /* not offered */ }
  st.scroll = setInterval(() => {   // scroll the page when the cover is held near the top or bottom
    const h = innerHeight, v = drag && drag.ly < 70 ? -12 : drag && drag.ly > h - 70 ? 12 : 0;
    if (v) { scrollBy(0, v); follow(); }
  }, 16);
  follow();
}
function follow() {
  const st = drag; if (!st || !st.live) return;
  st.ghost.style.transform = `translate(${st.lx - st.dx}px, ${st.ly - st.dy}px) rotate(-2deg)`;
  const under = document.elementFromPoint(st.lx, st.ly); if (!under) return;
  const grid = under.closest('.grid[data-unit]:not([data-unit=""])') || (under.closest('.unit') && under.closest('.unit').nextElementSibling);
  if (!grid || !grid.classList.contains('grid') || grid.dataset.unit === '') return;
  const target = under.closest('.book');
  if (target && target !== st.book && target.parentNode === grid) {
    const r = target.getBoundingClientRect(), after = st.lx > r.left + r.width / 2;
    grid.insertBefore(st.book, after ? target.nextSibling : target);
  } else if (!target) {
    // past the last cover in this unit, or on its title: put it at the end / the start
    const books = [...grid.querySelectorAll(':scope > .book')].filter(b => b !== st.book);
    const last = books[books.length - 1];
    if (under.closest('.unit')) grid.insertBefore(st.book, grid.firstChild);
    else if (!last || st.ly > last.getBoundingClientRect().top) grid.appendChild(st.book);
  }
}
async function end(e, cancel) {
  const st = drag; if (!st || e.pointerId !== st.id) return;
  clearTimeout(st.timer); drag = null; if (!st.live) return;
  clearInterval(st.scroll); st.ghost.remove(); st.book.classList.remove('hole'); document.body.classList.remove('dragging'); justDragged = Date.now();
  if (cancel) return list();
  const order = [...$('#list').querySelectorAll('.grid[data-unit]:not([data-unit=""])')].map(g => [g.dataset.unit, [...g.querySelectorAll(':scope > .book')].map(b => b.dataset.key)]);
  await reorder(order);
}

// a new order of the covers on screen -> a new toc.json (planned chapters that are hidden keep their place)
async function reorder(order) {
  const { toc, units, other } = shelf; if (!toc) return msg('There is no contents file (chapters/toc.json) to reorder.');
  const byKey = {}; for (const u of units) for (const it of u.items) byKey[it.key] = it; for (const it of other) byKey[it.key] = it;
  const shown = new Set(order.flatMap(o => o[1]));
  const next = JSON.parse(JSON.stringify(toc));
  for (const u of next.units) {
    const was = units.find(x => x.n === u.n), want = (order.find(o => o[0] === String(u.n)) || [0, []])[1].slice();
    // hidden items (planned, while hidden) stay after the shown item they followed
    const out = [];
    const hidden = was.items.filter(it => !shown.has(it.key));
    const lead = []; let prev = null; const after = new Map();
    for (const it of was.items) { if (shown.has(it.key)) prev = it.key; else if (!prev) lead.push(it); else after.set(prev, (after.get(prev) || []).concat(it)); }
    out.push(...lead);
    for (const k of want) { out.push(byKey[k]); out.push(...(after.get(k) || [])); }
    for (const it of hidden) if (!out.includes(it)) out.push(it);   // its anchor moved to another unit
    const start = was.items.length ? Math.min(...was.items.map(it => it.raw.n)) : 0;
    u.chapters = out.map((it, k) => Object.assign({}, it.raw, { n: start + k }));
  }
  if (JSON.stringify(next) === JSON.stringify(toc)) return list();
  await apply(next, toc);
}
async function apply(next, prevToc) {
  const num = t => { const m = {}; for (const u of t.units) for (const c of u.chapters) if (c.slug) m[c.slug] = [u.n, c.n]; return m; };
  const was = num(prevToc), now = num(next), changed = [];
  await Files.put('chapters/toc.json', JSON.stringify(next, null, 1) + '\n');
  for (const s of Object.keys(now)) {
    if (was[s] && was[s][0] === now[s][0] && was[s][1] === now[s][1]) continue;
    const f = await Files.get('chapters/' + s + '/chapter.html'); if (!f || typeof f.data !== 'string') continue;
    const [un, cn] = now[s];
    const data = f.data
      .replace(/(<script type="application\/json" id="book-meta">[\s\S]*?"chapter":\s*)(\d+)/, (m, a) => a + cn)
      .replace(/(<div class="kicker">Unit )(\d+)( · Chapter )(\d+)/, (m, a, u, b, c) => a + pad(un, u) + b + pad(cn, c));
    if (data !== f.data) { await Files.put(f.path, data); changed.push(s); }
  }
  undoToc = prevToc;
  msg('');
  $('#msg').innerHTML = `Saved the new order${changed.length ? ' and renumbered ' + changed.length + (changed.length === 1 ? ' chapter' : ' chapters') : ''}. <a href="#" id="undo">Undo</a>`;
  $('#undo').onclick = async e => { e.preventDefault(); const t = undoToc; undoToc = null; if (t) { const cur = JSON.parse((await Files.get('chapters/toc.json')).data); await apply(t, cur); msg('Put the old order back.'); } };
  await list(); await chips();
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (sw && cfg && cfg.kind !== 'dev' && navigator.onLine) sw.postMessage({ type: 'sync' });
}
let undoToc = null;
async function rows() { await load(); return Object.values(shelf.chapters); }   // every chapter on this device

// links only work once the service worker is in charge
$('#list').addEventListener('click', async e => { const a = e.target.closest('a[href]'); if (!a || a.dataset.dl || a.id === 'undo') return; if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { e.preventDefault(); msg('Still setting up offline use, one moment…'); await swReady; location.href = a.href; } });

function installHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install').hidden = false;
  $('#install-text').innerHTML = ios
    ? 'On iPhone and iPad, tap <b>Share</b>, then <b>Add to Home Screen</b>, and open the editor from there. Safari keeps a home-screen app\'s chapters; a plain browser tab can lose them after a few weeks unused.'
    : 'Install it from the browser menu (<b>Install app</b> or <b>Add to Home screen</b>) so its chapters are kept.';
}

// A reload that skipped the service worker (hard refresh) asks the web server for edit/<slug>, which only the
// service worker knows: the site's 404 page sends it here as ?open=edit/<slug>, and we go back once it's running.
const reopen = params.get('open');
if (reopen && /^(edit|view)\/[\w.-]+([?#].*)?$/.test(reopen)) { msg('Opening the chapter…'); await swReady; location.replace(reopen); await new Promise(() => {}); }
show(); installHint(); await chips(); await when(); await list();
if ('serviceWorker' in navigator) {   // a new version: reload this page to use it; and say which version is running
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); had = true; });
  navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
  fetch('api/info').then(r => r.json()).then(d => { if (d.version) $('#ver').textContent = 'Editor version ' + d.version; }).catch(() => {});
}
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', async e => { const d = e.data || {}; if (d.type === 'sync' && !d.reply && d.state !== 'syncing') { await when(); await list(); await chips(); } });
// installed app only: the extra space under the status bar (iOS 26's blur, see app/editor.css), switchable for testing.
// The status-bar inset tells whether this install still draws under the status bar (above 0) or not (0, after reinstalling).
if (matchMedia('(display-mode: standalone)').matches) {
  const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)'; document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0; probe.remove();
  const on = !document.documentElement.classList.contains('no-topclear');
  const p = document.createElement('p'); p.className = 'note';
  p.innerHTML = inset > 0
    ? `Space under the status bar: <b>${on ? 'on' : 'off'}</b> · <a href="#" id="tc">${on ? 'Turn off' : 'Turn on'}</a> · this install draws under the status bar (inset ${Math.round(inset)} pt): remove it and add it to the Home Screen again to drop the extra space`
    : 'Status bar above the page, no extra space needed';
  $('#ver').before(p);
  if ($('#tc')) $('#tc').onclick = e => { e.preventDefault(); try { localStorage.setItem('ai2ai-topclear', on ? '0' : '1'); } catch (x) {} location.reload(); };
}
$('#foot').insertAdjacentHTML('beforebegin', '<p id="inknote" class="note" hidden>Lecture notes: this token can\'t publish to the site, so the Lecture pages will ask for a sign-in of their own. To make one sign-in do both, edit the token on GitHub (Settings ▸ Developer settings ▸ Fine-grained tokens) and add the repository <b>' + SITE_REPO + '</b> with Contents: Read and write.</p>');
if (cfg && cfg.token) { let have = null; try { have = JSON.parse(localStorage.getItem('eai-ink-token') || 'null'); } catch (x) {} if (have !== cfg.token) shareToken(cfg.token).then(inkNote); }
$('#foot').innerHTML = cfg ? `<a href="#" id="out">Sign out</a> · removes the token, keeps chapters and edits on this device` : '';
if ($('#out')) $('#out').onclick = async e => { e.preventDefault(); if (!confirm('Sign out of GitHub on this device?')) return; try { if (JSON.parse(localStorage.getItem('eai-ink-token') || 'null') === (cfg && cfg.token)) localStorage.removeItem('eai-ink-token'); } catch (x) {} await Store.del('kv', 'remote'); cfg = null; show(); $('#foot').textContent = ''; };
await swReady;
if (cfg && navigator.onLine && !params.has('nopull')) pull();
})();

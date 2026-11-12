// AI2AI Present's home (present.html): the iPad presenting app (ios/) opens here. Every chapter of the chosen book as a
// cover, in contents order; a tap presents its Lecture (view/<slug>?view=slides&lecture=1). Nothing else: no editing,
// reordering or publishing (Eric, 2026-11-12: "a home screen with all of the decks but all I can do is open them in
// present mode"). It shares the editor home's storage (sign-in, synced chapters), and after each sync it downloads
// whatever any chapter is missing, so every deck can be presented offline.
(async function () {
'use strict';
const { Store, Files, Sync, mimeOf } = window.AI2AI;
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);

// the service worker serves the chapters (from this device's store); nothing opens until it controls the page
let swReady = Promise.resolve();
if ('serviceWorker' in navigator) {
  swReady = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    if (!navigator.serviceWorker.controller) return new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage({ type: 'claim' })); });
  });
}
try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* not offered */ }

// a reload that skipped the service worker lands on the site's 404, which sends ?open=view/<slug>… back here
const reopen = params.get('open');
if (reopen && /^view\/[\w.-]+([?#].*)?$/.test(reopen)) { msg('Opening the chapter…'); await swReady; location.replace(reopen); await new Promise(() => {}); }

if (params.get('dev')) await Store.kv('remote', { kind: 'dev', base: params.get('dev') });   // testing: a plain folder stands in for GitHub
let cfg = await Store.kv('remote');
function msg(t) { $('#msg').textContent = t || ''; }
const prog = (d, n) => { const p = $('#prog'); p.hidden = !n; p.max = n || 1; p.value = d; };

// ---------------------------------------------------------------- sign-in (the editor home's, trimmed)
const SITE_REPO = 'wtheisen/ai-landing-page';
async function shareToken(token) {   // the same token signs the Lecture pages in for publishing notes (ink.js)
  try {
    const r = await fetch('https://api.github.com/repos/' + SITE_REPO, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    if (d && d.permissions && d.permissions.push) localStorage.setItem('eai-ink-token', JSON.stringify(token));
  } catch (x) { /* offline: next time */ }
}
function show() { $('#signin').hidden = !!cfg; $('#pull').hidden = !cfg; }
$('#go').onclick = async () => {
  const repo = $('#repo').value.trim(), token = $('#token').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return msg('Fill in the repository and the token.');
  $('#go').disabled = true; msg('Checking the token…');
  try {
    const r = await fetch('https://api.github.com/repos/' + repo, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'GitHub doesn\'t accept that token for ' + repo + '.' : 'GitHub said ' + r.status + '.');
    const d = await r.json();
    cfg = { kind: 'github', repo, token, branch: d.default_branch || 'main' }; await Store.kv('remote', cfg);
    show(); await shareToken(token); await pull();
  } catch (e) { msg(e.message); }
  $('#go').disabled = false;
};

// ---------------------------------------------------------------- sync: get the latest, then every deck in full
async function when() {
  const t = await Store.kv('tree');
  $('#when').textContent = t ? 'Synced ' + new Date(t.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not synced yet';
}
function swSync() {   // syncing runs in the service worker (one at a time for the whole app, editor included)
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw || cfg.kind === 'dev') return Sync.sync(prog, 'this device').then(result => ({ state: 'synced', result }));
  return new Promise(res => {
    const on = e => { const d = e.data || {}; if (d.type === 'sync' && d.reply) { navigator.serviceWorker.removeEventListener('message', on); res(d); } };
    navigator.serviceWorker.addEventListener('message', on); sw.postMessage({ type: 'sync' });
  });
}
async function pull() {
  if (!cfg) return;
  if (!navigator.onLine) return msg('Offline: presenting what is on this device.');
  $('#pull').disabled = true; msg('Syncing…');
  const d = await swSync();
  if (d.state === 'error') msg('Could not sync: ' + d.error);
  else {
    await when(); await list();
    const all = []; for (const b of BOOKS) all.push(...(await load(b.id)).decks);
    let failed = '';
    for (const c of all) {
      const [have, need] = await Sync.coverage(c.slug); if (need && have >= need) continue;
      msg('Downloading ' + c.title + '…');
      try { await Sync.chapter(c.slug, prog); } catch (e) { failed = c.title + ': ' + e.message; }
    }
    msg(failed ? 'Some files didn\'t download (' + failed + ').' : '');
  }
  prog(0, 0); $('#pull').disabled = false; await list();
}
$('#pull').onclick = pull;

// ---------------------------------------------------------------- the decks
let BOOKS = [{ id: 'ai2ai', title: 'Exploring Artificial Intelligence', short: 'AI2AI', course: 'CSE 30124', toc: 'toc.json', prefix: '' }];
let bookId = params.get('book'); try { bookId = bookId || localStorage.getItem('ai2ai-book'); } catch (e) { /* no storage */ }
async function load(id) {   // [{n, title, items}] units in contents order, plus chapters not in the contents yet
  const f = await Files.get('chapters/books.json');
  try { const bs = f && JSON.parse(f.data).books; if (bs && bs.length) BOOKS = bs; } catch (e) { /* bad file: one book */ }
  const tocs = {};
  for (const b of BOOKS) { const t = await Files.get('chapters/' + b.toc); try { tocs[b.id] = t ? JSON.parse(t.data) : null; } catch (e) { tocs[b.id] = null; } }
  const bookOf = slug => {
    for (const b of BOOKS) for (const u of ((tocs[b.id] || {}).units || [])) for (const c of u.chapters || []) if (c.slug === slug) return b.id;
    return BOOKS.filter(b => slug.startsWith(b.prefix || '')).sort((a, b) => (b.prefix || '').length - (a.prefix || '').length).map(b => b.id)[0] || BOOKS[0].id;
  };
  const chapters = {};
  for (const file of await Files.under('chapters/')) {
    const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(file.path); if (!m || typeof file.data !== 'string' || bookOf(m[1]) !== id) continue;
    let meta = {}; try { meta = JSON.parse((/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>/.exec(file.data) || [])[1] || '{}'); } catch (e) { /* bad meta */ }
    if (!/data-view="[^"]*slides/.test(file.data)) continue;   // no Lecture, nothing to present
    const cover = (/<section class="page[^"]*\bcover\b[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(file.data) || [])[1] || '';
    const art = (/<b-fig\b[^>]*\bsrc="([^"]+)"/.exec(cover) || [])[1] || '';
    chapters[m[1]] = { slug: m[1], title: meta.title || m[1], art: /^[\w./-]+$/.test(art) && !art.includes('..') ? art : '' };
  }
  const units = [], seen = new Set();
  for (const u of (tocs[id] && tocs[id].units) || []) {
    const items = (u.chapters || []).filter(c => c.slug && chapters[c.slug]).map(c => { seen.add(c.slug); return Object.assign({ num: u.n + '.' + c.n }, chapters[c.slug]); });
    if (items.length) units.push({ n: u.n, title: u.title, items });
  }
  const other = Object.keys(chapters).filter(s => !seen.has(s)).sort().map(s => Object.assign({ num: '' }, chapters[s]));
  if (other.length) units.push({ n: '', title: 'Not in the contents yet', items: other });
  return { units, decks: Object.values(chapters) };
}
const arts = {};
async function list() {
  if (!BOOKS.some(b => b.id === bookId)) bookId = BOOKS[0].id;
  let { units } = await load(bookId);
  if (!BOOKS.some(b => b.id === bookId)) { bookId = BOOKS[0].id; units = (await load(bookId)).units; }
  let html = BOOKS.length > 1 ? `<div class="books" role="tablist">${BOOKS.map(b => `<button class="booktab${b.id === bookId ? ' on' : ''}" role="tab" data-book="${esc(b.id)}"><b>${esc(b.short || b.id)}</b><span>${esc((b.course || '').split(' · ')[0])}</span></button>`).join('')}</div>` : '';
  if (!units.length) html += `<p class="note">${cfg ? 'No decks on this device yet: Sync while online.' : ''}</p>`;
  for (const u of units) {
    html += `<div class="unit">${u.n !== '' ? `<span class="un">${esc(u.n)}</span>` : ''}${esc(u.title)}</div><div class="grid">`;
    for (const c of u.items) {
      const [have, need] = await Sync.coverage(c.slug), full = need && have >= need, ap = c.art ? `chapters/${c.slug}/${c.art}` : '';
      html += `<a class="deck" href="view/${encodeURIComponent(c.slug)}?view=slides&lecture=1">
        <span class="cv">${ap ? `<span class="cv-art" data-art="${esc(ap)}"><img alt=""${arts[ap] ? ` src="${arts[ap]}"` : ''}></span>` : '<span class="cv-art none"></span>'}
        <span class="cv-text"><span class="kicker">${esc(c.num)}</span><span class="cv-title">${esc(c.title)}</span><span class="rule"></span></span></span>
        <span class="off${full ? ' full' : ''}">${full ? 'Offline ✓' : need ? 'Online only (' + have + '/' + need + ')' : ''}</span></a>`;
    }
    html += '</div>';
  }
  $('#list').innerHTML = html;
  $('#list').querySelectorAll('[data-book]').forEach(t => t.onclick = () => { bookId = t.dataset.book; try { localStorage.setItem('ai2ai-book', bookId); } catch (e) { /* no storage */ } list(); });
  for (const el of $('#list').querySelectorAll('.cv-art[data-art]')) {
    const path = el.dataset.art; if (arts[path] !== undefined) { if (!arts[path]) el.classList.add('none'); continue; }
    Sync.file(path).then(f => {
      if (!f) throw new Error('missing');
      const blob = typeof f.data === 'string' ? new Blob([f.data], { type: mimeOf(path) }) : (f.data.type ? f.data : new Blob([f.data], { type: mimeOf(path) }));
      arts[path] = arts[path] || URL.createObjectURL(blob);
    }).catch(() => { arts[path] = null; }).then(() => {
      document.querySelectorAll(`.cv-art[data-art="${CSS.escape(path)}"]`).forEach(x => { if (arts[path]) x.querySelector('img').src = arts[path]; else x.classList.add('none'); });
    });
  }
}
// decks open only once the service worker is in charge
$('#list').addEventListener('click', async e => {
  const a = e.target.closest('a.deck'); if (!a) return;
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { e.preventDefault(); msg('Still setting up, one moment…'); await swReady; location.href = a.href; }
});

show(); await when(); await list();
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', async e => { const d = e.data || {}; if (d.type === 'sync' && !d.reply && d.state !== 'syncing') { await when(); await list(); } });
await swReady;
if (cfg && navigator.onLine && !params.has('nopull')) pull();
})();

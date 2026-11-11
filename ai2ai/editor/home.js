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
    if (!navigator.serviceWorker.controller) return new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage({ type: 'claim' })); });   // after a hard reload the worker is running but doesn't control the page: ask it to
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

// Books (Eric, 2026-11-02: BaLLM for CSE 10124 joins AI2AI): chapters/books.json lists them, each with its own contents
// file and slug prefix; every chapter folder sits in chapters/. The shelf shows one book at a time, tabs switch.
let BOOKS = [{ id: 'ai2ai', title: 'Exploring Artificial Intelligence', short: 'AI2AI', course: 'CSE 30124 · Introduction to Artificial Intelligence', toc: 'toc.json', prefix: '' }];
let bookId = params.get('book'); try { bookId = bookId || localStorage.getItem('ai2ai-book'); } catch (e) { /* no storage */ }
const book = () => BOOKS.find(b => b.id === bookId) || BOOKS[0], tocPath = b => 'chapters/' + (b || book()).toc;
async function loadBooks() {
  const f = await Files.get('chapters/books.json');
  try { const bs = f && JSON.parse(f.data).books; if (bs && bs.length) BOOKS = bs; } catch (e) { /* bad file: one book */ }
  const tocs = {};
  for (const b of BOOKS) { const t = await Files.get(tocPath(b)); try { tocs[b.id] = t ? JSON.parse(t.data) : null; } catch (e) { tocs[b.id] = null; } }
  return tocs;
}
function bookOf(slug, tocs) {   // the book whose contents lists it, else the longest prefix that fits
  for (const b of BOOKS) for (const u of ((tocs[b.id] || {}).units || [])) for (const c of u.chapters || []) if (c.slug === slug) return b.id;
  return BOOKS.filter(b => slug.startsWith(b.prefix || '')).sort((a, b) => (b.prefix || '').length - (a.prefix || '').length).map(b => b.id)[0] || BOOKS[0].id;
}
function heading() {
  const b = book(); $('#booksub').textContent = b.title + (b.course ? ' · ' + b.course : '') + ' · works offline on this device';
  document.title = (BOOKS.length > 1 ? b.short + ' · ' : '') + 'Book Editor';
}

async function load() {
  const tocs = await loadBooks(), files = await Files.under('chapters/');
  if (!BOOKS.some(b => b.id === bookId)) bookId = BOOKS[0].id;
  const toc = tocs[bookId];
  const chapters = {};
  for (const f of files) {
    const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(f.path); if (!m || typeof f.data !== 'string') continue;
    if (bookOf(m[1], tocs) !== bookId) continue;
    let meta = {}; try { meta = JSON.parse((/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>/.exec(f.data) || [])[1] || '{}'); } catch (e) { /* bad meta */ }
    const cover = (/<section class="page[^"]*\bcover\b[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(f.data) || [])[1] || '';
    const art = (/<b-fig\b[^>]*\bsrc="([^"]+)"/.exec(cover) || [])[1] || '';
    chapters[m[1]] = { slug: m[1], title: meta.title || m[1], dirty: f.dirty, art: /^[\w./-]+$/.test(art) && !art.includes('..') ? art : '' };
  }
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
  await load(); heading();
  const { units, other, chapters } = shelf;
  const tabs = BOOKS.length > 1 ? `<div class="books" role="tablist">${BOOKS.map(b => `<button class="booktab${b.id === book().id ? ' on' : ''}" role="tab" aria-selected="${b.id === book().id}" data-book="${esc(b.id)}" title="${esc(b.title)}"><b>${esc(b.short || b.id)}</b><span>${esc((b.course || '').split(' · ')[0])}</span></button>`).join('')}</div>` : '';
  const wire = () => $('#list').querySelectorAll('[data-book]').forEach(t => t.onclick = () => { bookId = t.dataset.book; try { localStorage.setItem('ai2ai-book', bookId); } catch (e) { /* no storage */ } list(); });
  if (!units.length && !other.length) { $('#list').innerHTML = tabs + (cfg ? `<p class="note">${BOOKS.length > 1 ? 'No chapters of this book on this device yet.' : 'No chapters on this device yet.'} Get the latest while online.</p>` : ''); wire(); return; }
  const planned = units.reduce((k, u) => k + u.items.filter(i => !i.slug).length, 0);
  let html = tabs + `<div class="shelf-bar"><span class="note">Drag a cover to reorder${matchMedia('(pointer: coarse)').matches ? ' (press and hold first)' : ''}.</span>`
    + (planned ? `<button class="mini" id="tg-planned">${showPlanned ? 'Hide' : 'Show'} planned (${planned})</button>` : '') + '</div>';
  const side = await sideState();
  const card = async (it, u, num) => {
    if (!it.slug) return showPlanned ? `<div class="book planned" data-key="${esc(it.key)}"><div class="cv"><div class="cv-text"><div class="kicker">${esc(num)}</div><div class="cv-title">${esc(it.title)}</div><div class="rule"></div></div><div class="cv-plan">Planned</div></div></div>` : '';
    const c = chapters[it.slug], [have, need] = await Sync.coverage(it.slug), full = need && have >= need;
    const href = encodeURIComponent(it.slug);
    return `<div class="book" data-key="${esc(it.key)}" data-slug="${esc(it.slug)}">
      <a class="cv" href="edit/${href}" draggable="false">${c.art ? `<span class="cv-art" data-art="chapters/${esc(it.slug)}/${esc(c.art)}"><img alt="" draggable="false"${arts[`chapters/${it.slug}/${c.art}`] ? ` src="${arts[`chapters/${it.slug}/${c.art}`]}"` : ''}></span>` : '<span class="cv-art none"></span>'}
        <span class="cv-text"><span class="kicker">${esc(num)}</span><span class="cv-title">${esc(c.title)}</span><span class="rule"></span></span></a>
      <div class="meta">${side.claims[it.slug] ? `<span class="claim" title="A Claude session is working on this chapter: ${esc(side.claims[it.slug].what || '')} (until ${esc((side.claims[it.slug].expires || '').slice(11, 16))})">Claude working</span>` : ''}${side.changed[it.slug] ? `<span class="chg" title="Pages Claude changed since you last looked (blue dots in the editor's page list)">● ${side.changed[it.slug]} changed</span>` : ''}${c.dirty ? '<span class="edited">Edited here</span>' : ''}<span class="off ${full ? 'full' : ''}">${full ? 'Offline ✓' : need ? `<a href="#" data-dl="${esc(it.slug)}">Download</a> ${have}/${need}` : ''}</span></div>
      <div class="acts"><a class="btn" href="view/${href}">Read</a><a class="btn" href="edit/${href}">Edit</a><a class="btn lect" href="view/${href}?view=slides&lecture=1" title="Teach from this device: the Lecture with the pen in hand and the faint answers hidden (safe to mirror to the projector)">Lecture</a><a class="ans" href="view/${href}?view=slides&lecture=answers" title="For a second screen: the Lecture with the faint answers showing">answers</a>${cfg && cfg.kind === 'github' ? `<a class="pub" href="#" data-pub="${esc(it.slug)}" title="Put this chapter's current version on the website (pages and PDFs). Every chapter edited since its last publish also goes up each night.">Publish to the site</a>` : ''}</div></div>`;
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
  $('#list').innerHTML = html; wire();
  covers();
  if ($('#tg-planned')) $('#tg-planned').onclick = () => { showPlanned = !showPlanned; try { localStorage.setItem('ai2ai-planned', showPlanned ? '1' : '0'); } catch (e) { /* no storage */ } list(); };
  $('#list').querySelectorAll('[data-pub]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); publish(a.dataset.pub, a); });
  $('#list').querySelectorAll('[data-dl]').forEach(a => a.onclick = async e => {
    e.preventDefault(); e.stopPropagation(); const s = a.dataset.dl; a.textContent = 'Downloading…';
    try { await Sync.chapter(s, prog); } catch (x) { msg(x.message); }
    prog(0, 0); await list(); await chips();
  });
}

// Publish to the site: sync, then ask the "Publish chapters" workflow in the book repo (.github/workflows/publish.yml)
// by writing publish/request.json; it exports the chapter and commits it to the site. Then watch the site's
// .book-published.json (written by tools/publish.py) to say when it's done.
async function gh(path, opt = {}) {
  const r = await fetch((cfg.api || 'https://api.github.com') + '/repos/' + path, { cache: 'no-store', ...opt,
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error('GitHub ' + r.status + ' on ' + path.split('/contents/')[1]);
  return r.json();
}
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
// "Last publish" line under the sync status: the site's .book-published.json `_last` (written by tools/publish.py,
// or by the workflow's failure step), so a failed nightly run or pages running over show here, not only in Actions.
async function siteStatus() {
  const el = $('#pubst'); if (!el || !cfg || cfg.kind !== 'github' || !navigator.onLine) return;
  let rec; try { const f = await gh(SITE_REPO + '/contents/.book-published.json'); rec = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\s/g, '')), c => c.charCodeAt(0)))); } catch (x) { return; }
  const l = rec._last; if (!l) return;
  const when = new Date(l.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const runs = 'https://github.com/' + cfg.repo + '/actions' + (l.run ? '/runs/' + l.run : '');
  const over = Object.entries(l.over || {}).map(([c, p]) => c + ' (' + p.length + ')');
  const bad = l.error || (l.failed || []).length;
  el.classList.toggle('bad', !!bad);
  el.innerHTML = 'Last publish to the site: ' + esc(when) + (l.event === 'schedule' ? ' (nightly)' : '') + ' · '
    + (l.error ? 'the run failed' : (l.failed || []).length ? 'failed: ' + esc(l.failed.join(', ')) : (l.ok || []).length ? (l.ok.length === 1 ? esc(l.ok[0]) : l.ok.length + ' chapters') + ' ✓' : 'nothing had changed ✓')
    + (over.length ? ' · pages running over: ' + esc(over.join(', ')) : '')
    + (bad || over.length ? ' · <a href="' + runs + '" target="_blank" rel="noopener">details</a>' : '');
}

// Working with Claude (2026-11-11, tools/agent/harness.py): claims.json says which chapters a Claude session is working
// on, <slug>/changes.json which pages Claude changed since Eric last looked, decisions.json the questions Claude has
// for him. All three sync like any chapter file; answering a question here writes decisions.json and syncs.
async function readJSON(path) { const f = await Files.get(path); try { return f && typeof f.data === 'string' ? JSON.parse(f.data) : { items: [] }; } catch (e) { return { items: [] }; } }
async function sideState() {
  const claims = {}, changed = {}, now = new Date();
  for (const it of (await readJSON('chapters/claims.json')).items || []) if ((it.status || 'open') === 'open' && new Date(it.expires) > now) claims[it.slug] = it;
  for (const f of await Files.under('chapters/')) {
    const m = /^chapters\/([^/]+)\/changes\.json$/.exec(f.path); if (!m) continue;
    let d; try { d = JSON.parse(f.data); } catch (e) { continue; }
    const pages = new Set(); for (const it of d.items || []) if ((it.status || 'open') === 'open') Object.keys(it.pages || {}).forEach(p => pages.add(p));
    if (pages.size) changed[m[1]] = pages.size;
  }
  asks();
  return { claims, changed };
}
async function asks() {
  const box = $('#asks'); if (!box) return;
  const d = await readJSON('chapters/decisions.json'), open = (d.items || []).filter(i => (i.status || 'open') === 'open');
  box.hidden = !open.length; if (!open.length) return;
  box.innerHTML = `<h2>Claude has ${open.length === 1 ? 'a question' : open.length + ' questions'} for you</h2>` + open.map(i => `<div class="q" data-id="${esc(i.id)}">
    <div class="where">${esc(i.slug)}${i.page ? ' · page ' + esc(i.page) : ''} · ${esc((i.when || '').slice(0, 16).replace('T', ' '))}</div>
    <div>${esc(i.q)}</div>${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}
    <div class="opts">${(i.options || []).map(o => `<button data-ans="${esc(o)}">${esc(o)}</button>`).join('')}<input placeholder="Or write your own answer" data-own><button data-own-go>Send</button></div></div>`).join('');
  box.querySelectorAll('.q').forEach(q => {
    const answer = async a => {
      if (!a) return;
      const cur = await readJSON('chapters/decisions.json'), it = (cur.items || []).find(x => x.id === q.dataset.id); if (!it) return;
      Object.assign(it, { status: 'answered', answer: a, resolved: { when: new Date().toISOString(), by: 'Eric' } });
      await Files.put('chapters/decisions.json', JSON.stringify(cur, null, 1) + '\n');
      q.remove(); msg('Answer saved; Claude files it in the decisions log.'); swSync(); asks();
    };
    q.querySelectorAll('[data-ans]').forEach(b => b.onclick = () => answer(b.dataset.ans));
    q.querySelector('[data-own-go]').onclick = () => answer(q.querySelector('[data-own]').value.trim());
  });
}

async function publish(slug, a) {
  if (!navigator.onLine) return msg('Offline: publishing needs the internet.');
  const t = a.closest('.book') && a.closest('.book').querySelector('.cv-title'), title = (t && t.textContent) || slug;
  if (!confirm('Put "' + title + '" on the website now? It takes about 10 minutes.')) return;
  const say = w => { a.textContent = w; msg(title + ': ' + w); };
  a.classList.add('busy'); say('Syncing…');
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  try {
    const d = await swSync(); if (d.state === 'error') throw new Error('could not sync: ' + d.error);
    say('Asking GitHub…');
    const path = cfg.repo + '/contents/publish/request.json';
    let sha; try { sha = (await gh(path + '?ref=' + cfg.branch)).sha; } catch (x) { /* first request */ }
    await gh(path, { method: 'PUT', body: JSON.stringify({ message: 'Publish ' + slug, branch: cfg.branch, sha,
      content: b64(JSON.stringify({ chapters: [slug], at }, null, 1) + '\n') }) });
  } catch (x) { a.classList.remove('busy'); a.textContent = 'Publish to the site'; return msg(title + ': not published (' + x.message + ').'); }
  say('Publishing… (about 10 minutes)');
  const t0 = Date.now(), seen = r => r && r[slug] && ((r[slug].at && r[slug].at >= at) ? 'ok' : (r[slug].failed && r[slug].failed >= at) ? 'failed' : '');
  const tick = async () => {
    let rec = null;
    try { const f = await gh(SITE_REPO + '/contents/.book-published.json'); rec = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\s/g, '')), c => c.charCodeAt(0)))); }
    catch (x) { /* this token may not read the site repo: say it was asked for and stop watching */
      a.classList.remove('busy'); return say('Asked for: on the site in about 10 minutes'); }
    const s = seen(rec);
    if (s === 'ok') { a.classList.remove('busy'); siteStatus(); return say('On the site ✓ (live in a minute or two)'); }
    if (s === 'failed') { a.classList.remove('busy'); return say('Publishing failed: see Actions in ' + cfg.repo); }
    if (Date.now() - t0 > 45 * 60e3) { a.classList.remove('busy'); return say('Still not done after 45 minutes: see Actions in ' + cfg.repo); }
    setTimeout(tick, 30e3);
  };
  setTimeout(tick, 60e3);
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
  const { toc, units, other } = shelf; if (!toc) return msg('There is no contents file (' + tocPath() + ') to reorder.');
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
  const tp = tocPath(); await Files.put(tp, JSON.stringify(next, null, 1) + '\n');
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
  $('#undo').onclick = async e => { e.preventDefault(); const t = undoToc; undoToc = null; if (t) { const cur = JSON.parse((await Files.get(tp)).data); await apply(t, cur); msg('Put the old order back.'); } };
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
show(); installHint(); await chips(); await when(); await list(); siteStatus();
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

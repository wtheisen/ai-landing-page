// AI2AI Review's home (review.html): the iPhone review app (ios/AI2AIReview) opens here. Every chapter of both books in
// contents order, each with its cover, number and title, and a badge with its open comments that wait on someone:
// Eric's comments waiting for Claude (the editor's askWaiting rule, tools/agent/tasks.py waiting()) and threads Claude
// answered last. A tap opens the chapter in the editor (edit/<slug>), which the app shows locked on its slides.
// Modelled on present.js and sharing its storage (sign-in, synced chapters, offline copies). In Safari it works the same,
// with a small settings card instead of the app's native settings.
(async function () {
'use strict';
const { Store, Files, Sync, mimeOf } = window.AI2AI;
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
const APP = !!(window.eaiNativeApp && window.eaiNativeApp.review);
const toApp = m => { if (APP) try { webkit.messageHandlers.eai.postMessage(m); } catch (x) { /* no handler */ } };

// ---------------------------------------------------------------- open comments (kept pure: the self-test calls it)
// A thread is a root comment and its replies (data-re = the root's data-id). waiting: the newest word isn't Claude's
// (or a Sync clash note) and asks for something (text, or a bare Fix it on a Claude reply without suggestions), nothing
// in the thread resolved. claude: the thread is open and Claude had the last word (a reply, or Claude's own question).
function openCounts(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html'), all = [...doc.querySelectorAll('.cmt')];
  const replies = {}; for (const c of all) if (c.dataset.re) (replies[c.dataset.re] = replies[c.dataset.re] || []).push(c);
  let waiting = 0, claude = 0;
  for (const root of all.filter(c => !c.dataset.re)) {
    const th = [root, ...(root.dataset.id ? replies[root.dataset.id] || [] : [])];
    if (th.some(c => c.hasAttribute('data-done'))) continue;
    const last = th[th.length - 1], by = last.dataset.by || '', prev = th[th.length - 2];
    if (by === 'Claude') claude++;
    else if (by === 'Sync') continue;
    else if (last.textContent.trim() || (last.dataset.verdict === 'fix' && prev && prev.dataset.by === 'Claude' && !prev.dataset.sugs)) waiting++;
  }
  return { waiting, claude };
}
window.eaiReviewCounts = openCounts;

// the service worker serves the chapters (from this device's store); nothing opens until it controls the page
let swReady = Promise.resolve();
if ('serviceWorker' in navigator) {
  swReady = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    if (!navigator.serviceWorker.controller) return new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage({ type: 'claim' })); });
  });
}
try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* not offered */ }

// a load that skipped the service worker lands on the site's 404, which sends ?open=edit/<slug> back to the editor home
// (the app sends that here)
const reopen = params.get('open');
if (reopen && /^(edit|view)\/[\w.-]+([?#].*)?$/.test(reopen)) { msg('Opening the chapter…'); await swReady; location.replace(reopen); await new Promise(() => {}); }

if (params.get('dev')) await Store.kv('remote', { kind: 'dev', base: params.get('dev') });   // testing: a plain folder stands in for GitHub
let cfg = await Store.kv('remote');
function msg(t) { $('#msg').textContent = t || ''; }
const prog = (d, n) => { const p = $('#prog'); p.hidden = !n; p.max = n || 1; p.value = d; };
const myName = () => { try { return localStorage.getItem('book-name') || 'Eric'; } catch (e) { return 'Eric'; } };

// ---------------------------------------------------------------- sign-in (present.js's)
function show() { $('#signin').hidden = !!cfg; $('#pull').hidden = !cfg || APP; tell(); }   // the app syncs with pull-to-refresh
$('#go').onclick = async () => {
  const repo = $('#repo').value.trim(), token = $('#token').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return msg('Fill in the repository and the token.');
  $('#go').disabled = true; msg('Checking the token…');
  try {
    const api = params.get('api') || 'https://api.github.com';   // ?api=: tests against the stand-in GitHub (web/test/mockgh.py), as on the editor home
    const r = await fetch(api + '/repos/' + repo, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'GitHub doesn\'t accept that token for ' + repo + '.' : 'GitHub said ' + r.status + '.');
    const d = await r.json();
    cfg = { kind: 'github', repo, token, branch: d.default_branch || 'main' }; if (params.get('api')) cfg.api = api; await Store.kv('remote', cfg);
    $('#token').value = ''; show(); await pull();
  } catch (e) { msg(e.message); }
  $('#go').disabled = false;
};

// settings: the app shows its own sheet; Safari gets a small card (the editor's name setting, localStorage book-name)
$('#gear').onclick = () => {
  if (APP) return toApp({ settings: true });
  const p = $('#prefs'); p.hidden = !p.hidden; if (!p.hidden) $('#name').value = myName();
};
$('#name').onchange = e => { try { localStorage.setItem('book-name', e.target.value.trim() || 'Eric'); } catch (x) { /* no storage */ } tell(); };

// ---------------------------------------------------------------- sync: the latest, then whatever any chapter is missing
let syncedAt = null;
async function when() {
  const t = await Store.kv('tree'); syncedAt = t ? t.at : null;
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
let pulling = null;
function pull() { return pulling || (pulling = doPull().finally(() => { pulling = null; toApp({ synced: true }); tell(); })); }
async function doPull() {
  if (!cfg) { msg('Sign in to GitHub first.'); return; }
  if (!navigator.onLine) { msg('Offline: showing what is on this device.'); return; }
  $('#pull').disabled = true; msg('Syncing…');
  const d = await swSync();
  if (d.state === 'error') msg('Could not sync: ' + d.error);
  else {
    await when(); await list();
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

// ---------------------------------------------------------------- the chapters, both books
let BOOKS = [{ id: 'ai2ai', title: 'Exploring Artificial Intelligence', short: 'AI2AI', course: 'CSE 30124', toc: 'toc.json', prefix: '' }];
let all = [];
async function load() {   // [{book, units: [{n, title, items}]}] in contents order, chapters not in the contents last
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
    const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(file.path); if (!m || typeof file.data !== 'string') continue;
    let meta = {}; try { meta = JSON.parse((/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>/.exec(file.data) || [])[1] || '{}'); } catch (e) { /* bad meta */ }
    const cover = (/<section class="page[^"]*\bcover\b[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(file.data) || [])[1] || '';
    const art = (/<b-fig\b[^>]*\bsrc="([^"]+)"/.exec(cover) || [])[1] || '';
    // a cover drawn in the editor (svg.draw) instead of a picture: the drawing itself, as an image (no scripts run in one)
    let draw = ''; if (!art) { let sv = (/<svg\b[^>]*\bclass="[^"]*\bdraw\b[\s\S]*?<\/svg>/.exec(cover) || [])[0] || ''; if (sv) { if (!/\sxmlns=/.test(sv.slice(0, 300))) sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'); draw = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sv); } }
    chapters[m[1]] = Object.assign({ slug: m[1], book: bookOf(m[1]), title: meta.title || m[1], art: /^[\w./-]+$/.test(art) && !art.includes('..') ? art : '', draw }, openCounts(file.data));
  }
  const out = [];
  for (const b of BOOKS) {
    const units = [], seen = new Set();
    for (const u of (tocs[b.id] && tocs[b.id].units) || []) {
      const items = (u.chapters || []).filter(c => c.slug && chapters[c.slug] && !seen.has(c.slug)).map(c => { seen.add(c.slug); return Object.assign({ num: u.n + '.' + c.n }, chapters[c.slug]); });
      if (items.length) units.push({ n: u.n, title: u.title, items });
    }
    const other = Object.keys(chapters).filter(s => chapters[s].book === b.id && !seen.has(s)).sort().map(s => Object.assign({ num: '' }, chapters[s]));
    if (other.length) units.push({ n: '', title: 'Not in the contents yet', items: other });
    if (units.length) out.push({ book: b, units });
  }
  all = out.flatMap(x => x.units.flatMap(u => u.items));
  return out;
}
const arts = {}, asking = {};
async function list() {
  const books = await load();
  let html = '';
  if (!books.length) html += `<p class="note">${cfg ? 'No chapters on this device yet: pull down (or Sync) while online.' : ''}</p>`;
  for (const { book, units } of books) {
    html += `<div class="book" id="book-${esc(book.id)}"><b>${esc(book.short || book.id)}</b><span>${esc((book.course || '').split(' · ')[0])}</span></div>`;
    for (const u of units) {
      html += `<div class="unit">${u.n !== '' ? `<span class="un">${esc(u.n)}</span>` : ''}${esc(u.title)}</div><div class="list">`;
      for (const c of u.items) {
        const ap = c.art ? `chapters/${c.slug}/${c.art}` : '', n = c.waiting + c.claude;
        const why = [c.waiting ? c.waiting + ' waiting for Claude' : '', c.claude ? c.claude + ' from Claude' : ''].filter(Boolean).join(' · ');
        html += `<a class="ch" href="edit/${encodeURIComponent(c.slug)}" data-slug="${esc(c.slug)}" data-open="${n}">
          <span class="cv${ap || c.draw ? '' : ' none'}"${ap ? ` data-art="${esc(ap)}"` : ''}><img alt=""${arts[ap] ? ` src="${arts[ap]}"` : c.draw ? ` src="${esc(c.draw)}"` : ''}><span class="rule"></span></span>
          <span class="txt">${c.num ? `<span class="num">${esc(c.num)}</span>` : ''}<div class="ttl">${esc(c.title)}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}</span>
          ${n ? `<span class="badge${c.waiting ? '' : ' claude'}" title="${esc(why)}">${n}</span>` : ''}<span class="chev" aria-hidden="true">›</span></a>`;
      }
      html += '</div>';
    }
  }
  $('#list').innerHTML = html;
  for (const el of $('#list').querySelectorAll('.cv[data-art]')) {
    const path = el.dataset.art; if (arts[path]) continue;   // a cover not here yet is tried again on the next list (after a sync)
    if (asking[path]) continue; asking[path] = true;
    Sync.file(path).then(f => {
      if (!f) throw new Error('missing');
      const blob = typeof f.data === 'string' ? new Blob([f.data], { type: mimeOf(path) }) : (f.data.type ? f.data : new Blob([f.data], { type: mimeOf(path) }));
      arts[path] = URL.createObjectURL(blob);
    }).catch(() => { arts[path] = null; }).then(() => { asking[path] = false;
      document.querySelectorAll(`.cv[data-art="${CSS.escape(path)}"]`).forEach(x => { if (arts[path]) x.querySelector('img').src = arts[path]; else x.classList.add('none'); });
    });
  }
  tell();
}
// chapters open only once the service worker is in charge
$('#list').addEventListener('click', async e => {
  const a = e.target.closest('a.ch'); if (!a) return;
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { e.preventDefault(); msg('Still setting up, one moment…'); await swReady; location.href = a.href; }
});

// ---------------------------------------------------------------- the app's side (settings sheet, pull-to-refresh)
function state() { return { signedIn: !!cfg, repo: cfg ? cfg.repo || cfg.base || '' : '', name: myName(), syncedAt, online: navigator.onLine, chapters: all.length, open: all.reduce((s, c) => s + c.waiting + c.claude, 0) }; }
function tell() { toApp({ home: state() }); }
window.eaiReviewHome = {
  state, pull,
  setName(n) { try { localStorage.setItem('book-name', String(n || '').trim() || 'Eric'); } catch (x) { /* no storage */ } tell(); },
  showSignIn() { $('#signin').hidden = false; $('#signin').scrollIntoView({ block: 'start' }); setTimeout(() => $('#token').focus(), 50); },
};

show(); await when(); await list();
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', async e => { const d = e.data || {}; if (d.type === 'sync' && !d.reply && d.state !== 'syncing') { await when(); await list(); } });
await swReady;
if (cfg && navigator.onLine && !params.has('nopull')) pull();
})();

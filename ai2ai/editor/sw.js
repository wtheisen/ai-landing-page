// AI2AI Book Editor, offline edition: the service worker stands in for server.py.
// The editor and viewer pages are the same files the Mac editor serves, and they talk to the same /api/… routes;
// here those routes are answered from the on-device store (store.js), so editing works with no server and no network.
// tools/build_web.py fills in the three constants below.
const VERSION = '4288a2de9f', KIT = '4b770b3e', SHELL = ["index.html", "home.js", "store.js", "manifest.webmanifest", "app/book.css", "app/book.js", "app/draw.js", "app/editor.css", "app/editor.html", "app/editor.js", "app/eqml.js", "app/ink.js", "app/live.js", "app/temml.LICENSE", "app/temml.min.js", "app/view.html", "kit/fonts/Inconsolata-LGC.ttf", "kit/fonts/Inconsolata-LGC-Bold.ttf", "kit/fonts/AI2AI-Math.ttf", "kit/fonts/AI2AI-Omega.ttf", "icon-180.png", "icon-192.png", "icon-512.png"];
importScripts('store.js');
const { Store, Files, Sync, mimeOf } = self.AI2AI;
const ROOT = new URL(self.registration.scope).pathname;      // e.g. /ai2ai/editor/
const SHELL_CACHE = 'ai2ai-shell-' + VERSION, RUNTIME = 'ai2ai-runtime';
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(SHELL_CACHE);
  await c.addAll(SHELL.map(p => new Request(ROOT + p, { cache: 'reload' })));
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ai2ai-shell-') && k !== SHELL_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// ---------------------------------------------------------------- routing
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) {
    // Pyodide, the torch build, data files and the site's visualizers: keep a copy once seen, so code and live
    // figures still run offline. GitHub's API is never cached (it's how this device finds out what changed).
    if (e.request.method === 'GET' && /^(cdn\.jsdelivr\.net|ai\.williamtheisen\.com|fonts\.(googleapis|gstatic)\.com)$/.test(u.hostname)) e.respondWith(runtime(e.request));
    return;
  }
  if (!u.pathname.startsWith(ROOT)) return;
  const rel = u.pathname.slice(ROOT.length), parts = rel.split('/').filter(Boolean).map(decodeURIComponent);
  e.respondWith(route(e.request, u, rel, parts).catch(err => json(500, { error: String(err && err.message || err) })));
});

async function route(req, u, rel, parts) {
  if (parts[0] === 'api') return api(req, u, parts);
  if (parts[0] === 'c' && parts.length > 2 && NAME.test(parts[1])) {
    const r = await chapterFile(parts[1], parts.slice(2).join('/'));
    return req.method === 'HEAD' ? new Response(null, { status: r.status, headers: r.headers }) : r;
  }
  if ((parts[0] === 'edit' || parts[0] === 'view') && parts.length === 2) return shell(parts[0] === 'edit' ? 'app/editor.html' : 'app/view.html');
  if (!rel || rel === 'index.html') return shell('index.html');
  return shell(rel);
}
async function shell(rel) {
  const c = await caches.open(SHELL_CACHE), hit = await c.match(ROOT + rel);
  if (hit) return hit;
  try { const r = await fetch(ROOT + rel); if (r.ok && SHELL.includes(rel)) c.put(ROOT + rel, r.clone()); return r; }
  catch (x) { return new Response('Not available offline: ' + rel, { status: 404 }); }
}
async function runtime(req) {
  const c = await caches.open(RUNTIME), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok && r.type !== 'opaque') c.put(req, r.clone()); return r; });
  if (hit) { net.catch(() => {}); return hit; }   // versioned files: the copy we have is the right one
  return net;
}
const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fileResponse = (path, data) => new Response(data, { headers: { 'Content-Type': mimeOf(path), 'Cache-Control': 'no-store' } });

async function chapterFile(ch, rest) {
  if (rest.includes('..') || /(^|\/)\.history\//.test(rest)) return json(404, { error: 'not found' });
  const f = await Sync.file('chapters/' + ch + '/' + rest);
  return f ? fileResponse(rest, f.data) : json(404, { error: 'not on this device' });
}

// ---------------------------------------------------------------- the server.py API
async function chapters() {
  const t = await Store.kv('tree'), set = new Set();
  if (t) for (const p in t.files) { const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(p); if (m) set.add(m[1]); }
  for (const p of await Store.keys('files', Store.prefix('chapters/'))) { const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(p); if (m) set.add(m[1]); }
  return [...set].sort();
}
const chapterPath = ch => 'chapters/' + ch + '/chapter.html';
const stamp = f => String(f.rev);   // the editor's "mtime": changes on every save here and on every pull that brings a new copy

async function api(req, u, parts) {
  const kind = parts[1], ch = parts[2], q = u.searchParams, post = req.method === 'POST' || req.method === 'PUT';
  if (kind === 'info') return json(200, { kit: KIT, tex: null, chapters: await chapters(), browser: false, offline: true, version: VERSION });
  if (!ch || !NAME.test(ch)) return json(404, { error: 'no such chapter' });
  const cf = await Sync.file(chapterPath(ch));
  if (!cf) return json(404, { error: 'no such chapter on this device' });

  if (!post) {
    if (kind === 'chapter') return json(200, { content: cf.data, mtime: stamp(cf), local: !!cf.dirty });
    if (kind === 'stat') return json(200, { mtime: stamp(cf), local: !!cf.dirty, sync: syncState });
    if (kind === 'history') {
      const name = q.get('name');
      if (name) { const v = await Store.get('hist', name); return v ? json(200, { content: v.content, mtime: stamp(cf) }) : json(404, { error: 'no such version' }); }
      const vs = (await Store.byIndex('hist', 'ch', ch)).sort((a, b) => b.time - a.time);
      return json(200, { versions: vs.map(v => ({ name: v.name, time: v.time / 1000, size: v.content.length })) });
    }
    if (kind === 'figs') {
      const t = await Store.kv('tree'), pre = 'chapters/' + ch + '/fig/', set = new Set();
      if (t) for (const p in t.files) if (p.startsWith(pre) && !p.slice(pre.length).includes('/')) set.add('fig/' + p.slice(pre.length));
      for (const p of await Store.keys('files', Store.prefix(pre))) if (!p.slice(pre.length).includes('/')) set.add('fig/' + p.slice(pre.length));
      return json(200, { files: [...set].filter(f => !/\/\./.test(f)).sort() });
    }
    if (kind === 'figsrc') {
      const hit = await figScript(ch, q.get('fig') || '');
      if (!hit) return json(404, { error: 'no script draws ' + q.get('fig') });
      return json(200, { code: hit.file.data, path: hit.file.path, home: hit.home, borrowed: hit.home !== ch });
    }
    return json(404, { error: 'not found' });
  }

  if (kind === 'chapter') {
    const d = await req.json();
    if (!d.force && d.base !== stamp(cf) && cf.data !== d.content) return json(409, { error: 'changed on this device', mtime: stamp(cf) });
    await snapshot(ch, cf, false);
    const rec = await Files.put(chapterPath(ch), d.content);
    soon();
    return json(200, { mtime: stamp(rec), local: true });
  }
  if (kind === 'history') {
    const label = ((await req.json().catch(() => ({}))).label || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return json(200, { name: await snapshot(ch, cf, true, label) });
  }
  if (kind === 'upload') {
    let name = (q.get('name') || 'figure').split('/').pop().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'figure';
    if (!/\.(svg|png|jpe?g|gif)$/i.test(name)) return json(400, { error: 'figures can be svg, png, jpg or gif' });
    const body = await req.blob(), data = /\.svg$/i.test(name) ? await body.text() : body;
    const [stem, ext] = [name.replace(/\.[^.]+$/, ''), name.slice(name.lastIndexOf('.'))];
    for (let k = 2; ; k++) {
      const old = await Sync.file('chapters/' + ch + '/fig/' + name);
      if (!old || q.get('replace') || await same(old.data, data)) break;
      name = stem + '-' + k + ext;
    }
    await Files.put('chapters/' + ch + '/fig/' + name, data); soon();
    return json(200, { src: 'fig/' + name });
  }
  if (kind === 'figsrc') {
    const d = await req.json().catch(() => ({})), hit = await figScript(ch, q.get('fig') || '');
    if (!hit) return json(404, { error: 'no script draws ' + q.get('fig') });
    if (typeof d.code === 'string' && d.code !== hit.file.data) { await Files.put(hit.file.path, d.code); soon(); }
    return json(200, { ok: false, out: '', err: 'Saved. Running figure scripts on this device is not built yet: the figure redraws the next time the script runs on the Mac.', home: hit.home });
  }
  if (kind === 'eq') return json(422, { error: 'New equations can\'t be drawn on this device yet (coming soon). It will draw when the chapter is next opened on the Mac.' });
  if (kind === 'export') return json(500, { error: 'Export isn\'t available on this device yet. It will run on GitHub in a later update.' });
  if (kind === 'snapshot') return json(200, { ok: true });
  return json(404, { error: 'not found' });
}

async function same(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  const bytes = async x => new Uint8Array(typeof x === 'string' ? new TextEncoder().encode(x) : await x.arrayBuffer());
  const [x, y] = await Promise.all([bytes(a), bytes(b)]);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// A history copy of the chapter as it stands before a save: at most one every 10 minutes (or whenever asked
// for by name), 100 kept per chapter. Names match server.py's, so the editor's History window reads them the same way.
async function snapshot(ch, cf, force, label) {
  const vs = (await Store.byIndex('hist', 'ch', ch)).sort((a, b) => b.time - a.time);
  if (!force && vs.length && Date.now() - vs[0].time < 600000) return null;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `chapter-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${label ? '-' + label : ''}.html`;
  await Store.put('hist', { name, ch, time: Date.now(), content: cf.data });
  for (const v of vs.slice(99)) await Store.del('hist', v.name);
  return name;
}

// the script that draws a figure: this chapter's figsrc/figs/<name>.py, or the one in the chapter it was borrowed from
async function figScript(ch, fig) {
  const name = (fig || '').split('/').pop(), stem = name.replace(/\.[^.]+$/, '');
  if (!NAME.test(stem)) return null;
  const own = await Sync.file('chapters/' + ch + '/figsrc/figs/' + stem + '.py');
  if (own) return { file: own, home: ch };
  const t = await Store.kv('tree'); if (!t) return null;
  for (const other of await chapters()) {
    if (other === ch || !t.files['chapters/' + other + '/figsrc/figs/' + stem + '.py']) continue;
    const f = await Sync.file('chapters/' + other + '/figsrc/figs/' + stem + '.py');
    if (f) return { file: f, home: other };
  }
  return null;
}

// ---------------------------------------------------------------- syncing with GitHub
// A few seconds after the last save (and whenever a page asks), send this device's edits up and bring GitHub's down.
// Offline, or if it fails, the edits simply wait here; the next save, page load or "Sync now" tries again.
let syncT = 0, syncState = { state: 'idle' };
function device() {
  const ua = self.navigator.userAgent;
  return /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : 'the AI2AI editor';
}
function soon(ms) { clearTimeout(syncT); syncT = setTimeout(runSync, ms || 4000); }
async function tell(msg) { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(Object.assign({ type: 'sync' }, msg)); }
async function runSync() {
  const cfg = await Store.kv('remote');
  if (!cfg || cfg.kind === 'dev') return syncState;
  syncState = { state: 'syncing', at: Date.now() }; tell(syncState);
  try {
    const r = await Sync.sync(null, device());
    const dirty = (await Files.dirty()).length;
    syncState = { state: dirty ? 'pending' : 'synced', at: Date.now(), result: r, dirty };
  } catch (e) {
    syncState = { state: 'error', at: Date.now(), error: String(e.message || e), offline: e instanceof TypeError };
  }
  tell(syncState);
  return syncState;
}
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'sync') e.waitUntil(runSync().then(s => e.source && e.source.postMessage(Object.assign({ type: 'sync', reply: true }, s))));
  if (d.type === 'sync-state' && e.source) e.source.postMessage(Object.assign({ type: 'sync', reply: true }, syncState));
});

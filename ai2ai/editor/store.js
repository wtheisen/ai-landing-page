// AI2AI Book Editor, offline edition: the on-device store and the remote it pulls from.
// Loaded by the service worker (importScripts) and by the home page, so it is plain script, no modules.
// Every file of the chapters repo that this device has seen lives in IndexedDB under its repo path
// (e.g. "chapters/ffn/chapter.html"). A file edited here is marked dirty until it reaches GitHub.
(function (G) {
'use strict';
const DB_NAME = 'ai2ai-book', DB_VER = 1;
const TEXT = /\.(html|js|json|py|svg|txt|csv|tex|md|css)$/i;
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ttf: 'font/ttf', pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', tex: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
const mimeOf = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const isText = p => TEXT.test(p);

// ---------------------------------------------------------------- IndexedDB
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('files', { keyPath: 'path' });                 // {path, data, sha, dirty, rev, t}
      d.createObjectStore('hist', { keyPath: 'name' }).createIndex('ch', 'ch');   // {name, ch, time, content}
      d.createObjectStore('kv');                                           // settings, the remote listing
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(store, mode, fn) {
  const d = await db(), t = d.transaction(store, mode), s = t.objectStore(store);
  const out = await fn(s);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out;
}
const Store = {
  get: (store, key) => tx(store, 'readonly', s => req(s.get(key))),
  put: (store, val, key) => tx(store, 'readwrite', s => req(key === undefined ? s.put(val) : s.put(val, key))),
  del: (store, key) => tx(store, 'readwrite', s => req(s.delete(key))),
  all: (store, range) => tx(store, 'readonly', s => req(s.getAll(range))),
  keys: (store, range) => tx(store, 'readonly', s => req(s.getAllKeys(range))),
  byIndex: (store, index, key) => tx(store, 'readonly', s => req(s.index(index).getAll(key))),
  prefix: p => IDBKeyRange.bound(p, p + '￿'),
  kv: async (k, v) => v === undefined ? Store.get('kv', k) : Store.put('kv', v, k),
};

// ---------------------------------------------------------------- files
const Files = {
  get: path => Store.get('files', path),
  async put(path, data, extra) {   // a local edit (dirty) unless extra says otherwise
    const old = await Store.get('files', path);
    const rec = Object.assign({ path, sha: old ? old.sha : null, dirty: true, rev: (old ? old.rev : 0) + 1 }, extra || {}, { data, t: Date.now() });
    await Store.put('files', rec); return rec;
  },
  under: prefix => Store.all('files', Store.prefix(prefix)),
  async dirty() { return (await Store.all('files')).filter(f => f.dirty); },
};

// git's id for a file's contents, so this device can tell whether its copy matches GitHub's without downloading it again
async function blobSha(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  const head = new TextEncoder().encode('blob ' + bytes.length + '\0'), all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- remotes
// A remote lists the repo (path -> {sha, size}) and hands back one file's bytes.
// GitHub: the REST API with Eric's fine-grained token. Dev: a plain folder (a checkout plus tree.json), for testing.
function remote(cfg) {
  if (!cfg) return null;
  if (cfg.kind === 'dev') return {
    async tree() { const r = await fetch(cfg.base + 'tree.json', { cache: 'no-store' }); if (!r.ok) throw new Error('tree.json: ' + r.status); return r.json(); },
    async file(path) { const r = await fetch(cfg.base + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' }); if (!r.ok) throw new Error(path + ': ' + r.status); return r; },
  };
  const api = 'https://api.github.com/repos/' + cfg.repo, H = { Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28' };
  const gh = async (url, accept) => {
    const r = await fetch(url, { headers: Object.assign({ Accept: accept || 'application/vnd.github+json' }, H), cache: 'no-store' });
    if (!r.ok) { const e = new Error('GitHub ' + r.status + ': ' + ((await r.json().catch(() => ({}))).message || url)); e.status = r.status; throw e; }
    return r;
  };
  return {
    async tree() {
      const br = await (await gh(api + '/branches/' + encodeURIComponent(cfg.branch || 'main'))).json();
      const t = await (await gh(api + '/git/trees/' + br.commit.commit.tree.sha + '?recursive=1')).json();
      const files = {}; for (const e of t.tree) if (e.type === 'blob') files[e.path] = { sha: e.sha, size: e.size };
      return { head: br.commit.sha, files, truncated: !!t.truncated };
    },
    file: (path, sha) => gh(api + '/git/blobs/' + sha, 'application/vnd.github.raw+json'),
  };
}
async function config() { return Store.kv('remote'); }

// fetch one file from the remote into the store (unless this device has an edit of its own)
async function fetchFile(R, path, sha) {
  const r = await R.file(path, sha);
  const data = isText(path) ? await r.text() : await r.blob();
  const old = await Store.get('files', path);
  if (old && old.dirty) return old;
  const rec = { path, data, sha, dirty: false, rev: (old ? old.rev : 0) + 1, t: Date.now() };
  await Store.put('files', rec); return rec;
}

async function pool(items, n, fn) {   // run fn over items, n at a time
  let k = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const it = items[k++]; try { await fn(it); } catch (e) { errs.push(e); } } }));
  return errs;
}

const OFFLINE_SKIP = /(^|\/)(markup|dist|\.history)\/|\.pdf$/;   // never needed to edit a chapter
const Sync = {
  remote: async () => remote(await config()),
  // Get the remote's listing, then the newest copy of every chapter.html and of every other file this device
  // already holds. Files edited here are never overwritten; one whose GitHub copy also moved is flagged for merging.
  async pull(progress) {
    const R = await Sync.remote(); if (!R) throw new Error('not signed in');
    const t = await R.tree();
    await Store.kv('tree', { head: t.head, files: t.files, at: Date.now() });
    const local = Object.fromEntries((await Store.all('files')).map(f => [f.path, f]));
    const want = [], flagged = [];
    for (const [path, e] of Object.entries(t.files)) {
      const l = local[path];
      const core = /^chapters\/[^/]+\/chapter\.html$/.test(path) || path === 'chapters/toc.json';
      if (l && l.dirty) { if (l.sha !== e.sha) { flagged.push(path); if (l.remoteSha !== e.sha) await Store.put('files', Object.assign(l, { remoteSha: e.sha })); } continue; }
      if ((l && l.sha !== e.sha) || (!l && core)) want.push([path, e.sha]);
    }
    for (const path in local) if (!t.files[path] && !local[path].dirty && local[path].sha) await Store.del('files', path);   // removed on GitHub
    let done = 0;
    const errs = await pool(want, 6, async ([p, sha]) => { await fetchFile(R, p, sha); done++; progress && progress(done, want.length); });
    return { fetched: done, failed: errs.length, flagged, head: t.head };
  },
  // Make one chapter fully usable offline: every figure, cached equation and figure script.
  async chapter(ch, progress) {
    const R = await Sync.remote(); const t = await Store.kv('tree'); if (!R || !t) throw new Error('get the latest first');
    const pre = 'chapters/' + ch + '/';
    const have = Object.fromEntries((await Files.under(pre)).map(f => [f.path, f]));
    const want = Object.entries(t.files).filter(([p, e]) => p.startsWith(pre) && !OFFLINE_SKIP.test(p.slice(pre.length)) && !(have[p] && (have[p].sha === e.sha || have[p].dirty))).map(([p, e]) => [p, e.sha]);
    let done = 0;
    const errs = await pool(want, 6, async ([p, sha]) => { await fetchFile(R, p, sha); done++; progress && progress(done, want.length); });
    if (errs.length) throw new Error(errs.length + ' files failed: ' + errs[0].message);
    return done;
  },
  // how much of a chapter is on this device: [files here, files needed]
  async coverage(ch) {
    const t = await Store.kv('tree'); if (!t) return [0, 0];
    const pre = 'chapters/' + ch + '/', have = new Set(await Store.keys('files', Store.prefix(pre)));
    const need = Object.keys(t.files).filter(p => p.startsWith(pre) && !OFFLINE_SKIP.test(p.slice(pre.length)));
    return [need.filter(p => have.has(p)).length, need.length];
  },
  // one file, from the store or (online) from the remote; null if neither has it
  async file(path) {
    const f = await Store.get('files', path); if (f) return f;
    const t = await Store.kv('tree'), e = t && t.files[path], R = e && await Sync.remote();
    if (!R) return null;
    try { return await fetchFile(R, path, e.sha); } catch (x) { return null; }
  },
};

G.AI2AI = { Store, Files, Sync, remote, config, blobSha, mimeOf, isText, OFFLINE_SKIP };
})(typeof self !== 'undefined' ? self : window);

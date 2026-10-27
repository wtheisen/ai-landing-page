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
// A remote lists the repo (path -> {sha, size}), hands back one file's bytes by its blob id and, for GitHub,
// writes a commit. GitHub: the REST API with Eric's fine-grained token (cfg.api overrides the host, for tests).
// Dev: a plain folder (a checkout plus tree.json), read-only, for testing.
function remote(cfg) {
  if (!cfg) return null;
  if (cfg.kind === 'dev') return {
    async tree() { const r = await fetch(cfg.base + 'tree.json', { cache: 'no-store' }); if (!r.ok) throw new Error('tree.json: ' + r.status); return r.json(); },
    async file(path) { const r = await fetch(cfg.base + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' }); if (!r.ok) throw new Error(path + ': ' + r.status); return r; },
  };
  const api = (cfg.api || 'https://api.github.com') + '/repos/' + cfg.repo, H = { Authorization: 'Bearer ' + cfg.token, 'X-GitHub-Api-Version': '2022-11-28' };
  const gh = async (url, opt) => {
    opt = opt || {};
    const r = await fetch(url, { method: opt.method || 'GET', body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store',
      headers: Object.assign({ Accept: opt.accept || 'application/vnd.github+json' }, opt.body ? { 'Content-Type': 'application/json' } : {}, H) });
    if (!r.ok) {
      const m = (await r.json().catch(() => ({}))).message || url;
      const e = new Error(r.status === 401 ? 'GitHub no longer accepts the token (it may have expired): sign in again.' : r.status === 403 && /Resource not accessible/i.test(m) ? 'The token can read but not write: give it Contents: Read and write.' : 'GitHub ' + r.status + ': ' + m);
      e.status = r.status; throw e;
    }
    return r;
  };
  const branch = encodeURIComponent(cfg.branch || 'main');
  return {
    write: true,
    async tree() {
      const br = await (await gh(api + '/branches/' + branch)).json();
      const treeSha = br.commit.commit.tree.sha, t = await (await gh(api + '/git/trees/' + treeSha + '?recursive=1')).json();
      const files = {}; for (const e of t.tree) if (e.type === 'blob') files[e.path] = { sha: e.sha, size: e.size };
      return { head: br.commit.sha, treeSha, files, truncated: !!t.truncated };
    },
    file: (path, sha) => gh(api + '/git/blobs/' + sha, { accept: 'application/vnd.github.raw+json' }),
    async blob(data) {
      const body = typeof data === 'string' ? { content: data, encoding: 'utf-8' } : { content: await b64(data), encoding: 'base64' };
      return (await (await gh(api + '/git/blobs', { method: 'POST', body })).json()).sha;
    },
    // one commit on top of head holding these files (sha null = delete); false if someone else moved the branch first
    async commit(head, baseTree, entries, message) {
      const tree = (await (await gh(api + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries.map(e => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })) } })).json()).sha;
      const commit = (await (await gh(api + '/git/commits', { method: 'POST', body: { message, tree, parents: [head] } })).json()).sha;
      try { await gh(api + '/git/refs/heads/' + branch, { method: 'PATCH', body: { sha: commit, force: false } }); }
      catch (e) { if (e.status === 422 || e.status === 409) return null; throw e; }
      return { commit, tree };
    },
  };
}
async function b64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
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
async function fetchData(R, path, sha) { const r = await R.file(path, sha); return isText(path) ? r.text() : r.blob(); }

async function pool(items, n, fn) {   // run fn over items, n at a time
  let k = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const it = items[k++]; try { await fn(it); } catch (e) { errs.push(e); } } }));
  return errs;
}

// ---------------------------------------------------------------- merging
// chapter.html merges page by page. base = the GitHub version this device's edit started from, mine = this device's,
// theirs = GitHub's now. A page changed on one side takes that side; changed on both (differently), this device's page
// stays and GitHub's goes right after it as a separate page marked as a clash, so nothing is lost. book-meta merges key
// by key. Returns { text, clashes: [page ids] }.
const SPLIT = /\n\n(?=<section[ >])/;
function chunks(s) {
  const parts = s.replace(/\n+$/, '').split(SPLIT), head = parts.shift(), map = new Map(), order = [];
  parts.forEach((c, k) => { const id = (/^<section[^>]*\bid="([^"]*)"/.exec(c) || [])[1] || '#' + k; let key = id; while (map.has(key)) key += '+'; map.set(key, c); order.push(key); });
  return { head, map, order };
}
function mergeMeta(b, m, t, clashes) {
  if (m === b || m === t) return t; if (t === b) return m;
  const re = /(<script type="application\/json" id="book-meta">\n?)([\s\S]*?)(\n?<\/script>)/;
  const J = s => { try { return JSON.parse((re.exec(s) || [])[2]); } catch (e) { return null; } };
  const jb = J(b), jm = J(m), jt = J(t);
  if (!jb || !jm || !jt) { clashes.push('book-meta'); return m; }
  const out = {}, keys = [...new Set([...Object.keys(jm), ...Object.keys(jt), ...Object.keys(jb)])], S = JSON.stringify;
  for (const k of keys) {
    const vb = S(jb[k]), vm = S(jm[k]), vt = S(jt[k]);
    const v = vm === vb ? jt[k] : vt === vb || vt === vm ? jm[k] : (clashes.push('book-meta.' + k), jm[k]);
    if (v !== undefined) out[k] = v;
  }
  return m.replace(re, (all, a, body, c) => a + JSON.stringify(out, null, 1) + c);
}
function clashCopy(page, when) {
  return page.replace(/^<section([^>]*?)\bid="([^"]*)"([^>]*)>/, (all, a, id, c) =>
    `<section${a}id="${id}-github"${c} data-clash="github">\n  <div class="cmt" data-by="Sync" data-when="${when}" data-kind="structure">This page was changed on two devices. This copy is the version on GitHub; the page before it is this device's. Keep one and delete the other.</div>`);
}
// A page changed on both sides is often one edit plus comments (an @Claude reply landing while Eric edits the page):
// the comments are merged on their own, by identity, and put back after the block they follow, so the page doesn't
// clash. Only when the page's content (everything but comments) changed on both sides does it clash.
// (Same as tools/drive_sync.py merge_page.)
const CMT_LINE = /^  <div class="cmt"[^>]*>.*<\/div>$/, BLOCK_START = /^  <(?!\/)/;
function cmtKey(line) {
  const a = {}; for (const m of line.slice(0, line.indexOf('>')).matchAll(/\s([\w-]+)="([^"]*)"/g)) a[m[1]] = m[2];
  if (a['data-id']) return 'id:' + a['data-id'];
  return `${a['data-re'] ? 're' : 'x'}:${a['data-re'] || ''}|${a['data-by'] || ''}|${a['data-when'] || ''}`;
}
const anchorOf = ln => { const m = /\sdata-b="([^"]*)"/.exec(ln.split('>')[0]); return m ? m[1] : '?' + ln.trim().slice(0, 40); };
function splitPage(p) {
  const content = [], cms = [], seen = {}; let anchor = '';
  for (const ln of p.split('\n')) {
    if (CMT_LINE.test(ln)) { let k = cmtKey(ln); const n = seen[k] || 0; seen[k] = n + 1; if (n) k += '#' + n; cms.push([k, ln, anchor]); continue; }
    if (BLOCK_START.test(ln)) anchor = anchorOf(ln);
    content.push(ln);
  }
  return [content, cms];
}
function mergePage(b, m, t) {
  const [cb, kb] = splitPage(b), [cm, km] = splitPage(m), [ct, kt] = splitPage(t), eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  let content;
  if (eq(cm, ct) || eq(ct, cb)) content = cm; else if (eq(cm, cb)) content = ct; else return null;
  const map = list => new Map(list.map(([k, l, a]) => [k, l + '\u0000' + a]));
  const B = map(kb), M = map(km), T = map(kt);
  const keys = [...km.map(x => x[0]), ...kt.map(x => x[0]).filter(k => !M.has(k))], final = [];
  for (const k of keys) {
    const vb = B.get(k), vm = M.get(k), vt = T.get(k);
    const v = vm === vt ? vm : vm === vb ? vt : vt === vb ? vm : vm === undefined ? vt : vt === undefined ? vm : vm;
    if (v !== undefined) final.push(v.split('\u0000'));
  }
  const anchors = new Set(content.filter(ln => BLOCK_START.test(ln)).map(anchorOf)), groups = new Map();
  for (const [line, a] of final) { const g = anchors.has(a) ? a : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(line); }
  const out = []; let cur = '';
  content.forEach((ln, i) => {
    if (i > 0 && (BLOCK_START.test(ln) || ln === '</section>')) { out.push(...(groups.get(cur) || [])); groups.delete(cur); }
    if (BLOCK_START.test(ln)) cur = anchorOf(ln);
    out.push(ln);
  });
  return out.join('\n');
}
function mergeChapter(base, mine, theirs, when) {
  const B = chunks(base), M = chunks(mine), T = chunks(theirs), clashes = [];
  const head = mergeMeta(B.head, M.head, T.head, clashes);
  const pick = id => {
    const b = B.map.get(id), m = M.map.get(id), t = T.map.get(id);
    if (m === t) return m === undefined ? [] : [m];
    if (m === b) return t === undefined ? [] : [t];          // only GitHub changed it (or deleted it)
    if (t === b) return m === undefined ? [] : [m];          // only this device changed it (or deleted it)
    if (m === undefined) return [t];                          // deleted here, edited there: keep the edit
    if (t === undefined) return [m];                          // edited here, deleted there: keep the edit
    const merged = b !== undefined ? mergePage(b, m, t) : null;  // the content changed on one side only, comments on both
    if (merged !== null) return [merged];
    clashes.push(id); return [m, clashCopy(t, when)];
  };
  // this device's order, with pages that are new on GitHub slotted in after the page they follow there
  const order = M.order.filter(id => !(B.map.has(id) && !T.map.has(id) && M.map.get(id) === B.map.get(id)));
  T.order.forEach((id, k) => {
    if (order.includes(id)) return;
    const fresh = !M.map.has(id) && !B.map.has(id), revived = B.map.has(id) && !M.map.has(id) && T.map.get(id) !== B.map.get(id);
    if (!fresh && !revived) return;
    let at = -1; for (let j = k - 1; j >= 0 && at < 0; j--) at = order.indexOf(T.order[j]);
    order.splice(at + 1, 0, id);
  });
  const pages = order.flatMap(id => M.map.has(id) || B.map.has(id) ? pick(id) : [T.map.get(id)]);
  return { text: [head, ...pages].join('\n\n') + ((/\n+$/.exec(mine) || ['\n'])[0]), clashes };
}
// any other file: one side's change wins; both changed: this device's copy wins (reported)
function mergeOther(base, mine, theirs) {
  const eq = (a, b) => typeof a === 'string' && typeof b === 'string' ? a === b : false;
  if (eq(mine, base)) return { data: theirs, clash: false };
  if (eq(theirs, base) || eq(mine, theirs)) return { data: mine, clash: false };
  return { data: mine, clash: true };
}

// suggestions.json / tasks.json (tools/agent): lists of items that are never deleted, so both sides' items are kept;
// an item on both sides: a resolved/finished copy beats an open one, else the later one wins. Same rule as
// tools/agent/suggestions.py merge().
function mergeItems(mine, theirs) {
  let M, T; try { M = JSON.parse(mine); T = JSON.parse(theirs); } catch (e) { return null; }
  const done = i => (i.status || 'open') !== 'open', at = i => (i.resolved && i.resolved.when) || i.when || '';
  const order = [], out = new Map();
  for (const src of [T, M]) for (const it of (src.items || [])) {
    if (!out.has(it.id)) { order.push(it.id); out.set(it.id, it); continue; }
    const a = out.get(it.id); out.set(it.id, done(a) !== done(it) ? (done(a) ? a : it) : (at(a) >= at(it) ? a : it));
  }
  return JSON.stringify(Object.assign({}, T, M, { items: order.map(k => out.get(k)) }), null, 1) + '\n';
}

// ---------------------------------------------------------------- sync
const OFFLINE_SKIP = /(^|\/)(markup|dist|\.history)\/|\.pdf$/;   // never needed to edit a chapter
const CORE = p => /^chapters\/[^/]+\/(chapter\.html|suggestions\.json|tasks\.json)$/.test(p) || p === 'chapters/toc.json';   // always kept on the device
let running = null;
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const Sync = {
  remote: async () => remote(await config()),
  // Bring this device and GitHub level: get GitHub's newest files, merge them into anything edited here, then send
  // every edit up as one commit. If someone else pushes in between, start over (GitHub refuses the stale commit).
  sync(progress, device) {
    if (running) return running;
    running = (async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          const r = await Sync.once(progress, device);
          if (r.pushed !== null || attempt >= 3) return r;
        }
      } finally { running = null; }
    })();
    return running;
  },
  async once(progress, device) {
    const R = await Sync.remote(); if (!R) throw new Error('not signed in');
    const t = await R.tree();
    const local = Object.fromEntries((await Store.all('files')).map(f => [f.path, f]));
    const fetchList = [], mergeList = [], out = { fetched: 0, merged: [], clashes: [], pushed: 0, failed: 0, head: t.head };
    for (const [path, e] of Object.entries(t.files)) {
      const l = local[path];
      if (!l) { if (CORE(path)) fetchList.push([path, e.sha]); continue; }
      if (l.sha === e.sha) continue;
      if (l.dirty) mergeList.push([l, e.sha]); else fetchList.push([path, e.sha]);
    }
    for (const path in local) {
      const l = local[path];
      if (t.files[path] || !l.sha) continue;
      if (!l.dirty) await Store.del('files', path);                       // removed on GitHub
      else await Store.put('files', Object.assign(l, { sha: null }));     // removed there, edited here: it goes back up
    }
    let n = 0; const total = fetchList.length + mergeList.length, tick = () => progress && progress(++n, total);
    out.failed += (await pool(fetchList, 6, async ([p, sha]) => { await fetchFile(R, p, sha); out.fetched++; tick(); })).length;
    for (const [l, sha] of mergeList) {
      const [base, theirs] = await Promise.all([l.sha ? fetchData(R, l.path, l.sha) : '', fetchData(R, l.path, sha)]);
      const cur = await Store.get('files', l.path);
      let data, clash;
      if (/chapter\.html$/.test(l.path) && typeof cur.data === 'string') { const m = mergeChapter(base, cur.data, theirs, stamp()); data = m.text; clash = m.clashes.length ? m.clashes : null; }
      else if (/\/(suggestions|tasks)\.json$/.test(l.path) && typeof cur.data === 'string' && typeof theirs === 'string' && mergeItems(cur.data, theirs)) { data = mergeItems(cur.data, theirs); clash = null; }
      else { const m = mergeOther(base, cur.data, theirs); data = m.data; clash = m.clash ? ['whole file'] : null; }
      const still = typeof data === 'string' && typeof theirs === 'string' ? data !== theirs : true;
      await Store.put('files', Object.assign(cur, { data, sha, dirty: still, rev: cur.rev + 1, t: Date.now() }));
      out.merged.push(l.path); if (clash) out.clashes.push({ path: l.path, where: clash });
      tick();
    }
    await Store.kv('tree', { head: t.head, treeSha: t.treeSha, files: t.files, at: Date.now() });
    // send the edits up
    const dirty = (await Store.all('files')).filter(f => f.dirty);
    if (!dirty.length || !R.write) { out.pushed = 0; return out; }
    const entries = [];
    for (const f of dirty) entries.push({ path: f.path, sha: await R.blob(f.data), rev: f.rev, data: f.data });
    const names = [...new Set(entries.map(e => (/^chapters\/([^/]+)\//.exec(e.path) || [])[1] || e.path))];
    const msg = `Edits from ${device || 'the AI2AI editor'}: ${names.join(', ')}\n\n` + entries.map(e => '- ' + e.path).join('\n');
    const done = await R.commit(t.head, t.treeSha, entries, msg);
    if (!done) { out.pushed = null; return out; }
    const files = Object.assign({}, t.files);
    for (const e of entries) {
      const cur = await Store.get('files', e.path);
      files[e.path] = { sha: e.sha, size: typeof e.data === 'string' ? new TextEncoder().encode(e.data).length : e.data.size };
      // an edit made while this was uploading stays marked, now based on what was just sent
      await Store.put('files', Object.assign(cur, { sha: e.sha, dirty: cur.rev !== e.rev }));
    }
    await Store.kv('tree', { head: done.commit, treeSha: done.tree, files, at: Date.now() });
    await Store.kv('lastPush', { at: Date.now(), commit: done.commit, files: entries.map(e => e.path) });
    out.pushed = entries.length; out.head = done.commit;
    return out;
  },
  pull(progress, device) { return Sync.sync(progress, device); },
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

G.AI2AI = { Store, Files, Sync, remote, config, blobSha, mimeOf, isText, OFFLINE_SKIP, mergeChapter, mergeItems };
})(typeof self !== 'undefined' ? self : window);

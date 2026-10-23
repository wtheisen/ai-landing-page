// The editor's home page: sign in, get the latest chapters, choose what's kept for offline use, open a chapter.
(async function () {
'use strict';
const { Store, Files, Sync } = window.AI2AI;
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
    const r = await fetch('https://api.github.com/repos/' + repo, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'GitHub doesn\'t accept that token for ' + repo + '.' : 'GitHub said ' + r.status + '.');
    const d = await r.json();
    if (d.permissions && !d.permissions.push) msg('Signed in, but this token can only read. Saving back to GitHub will need Contents: Read and write.');
    cfg = { kind: 'github', repo, token, branch: d.default_branch || 'main' }; await Store.kv('remote', cfg);
    show(); await pull();
  } catch (e) { msg(e.message); }
  $('#go').disabled = false;
};
function msg(t) { $('#msg').textContent = $('#smsg').textContent = t || ''; }

async function when() {
  const t = await Store.kv('tree');
  $('#when').textContent = t ? 'Latest from GitHub: ' + new Date(t.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not downloaded yet';
}
const prog = (d, n) => { const p = $('#prog'); p.hidden = !n; p.max = n || 1; p.value = d; };
async function pull() {
  if (!navigator.onLine) return msg('Offline: showing what this device already has.');
  $('#pull').disabled = true; msg('Getting the latest…');
  try {
    const r = await Sync.pull(prog);
    msg((r.fetched ? r.fetched + ' files updated.' : 'Everything is up to date.') + (r.failed ? ' ' + r.failed + ' failed.' : '') +
      (r.flagged.length ? '\n' + r.flagged.length + ' file(s) changed both here and on GitHub: ' + r.flagged.map(p => p.replace(/^chapters\//, '')).join(', ') + '. They are kept as edited here; merging arrives with syncing.' : ''));
  } catch (e) { msg('Could not get the latest: ' + e.message); }
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

// chapters in the book's order (toc.json), then any others
async function rows() {
  const toc = await Files.get('chapters/toc.json'), files = await Files.under('chapters/');
  const here = {};
  for (const f of files) {
    const m = /^chapters\/([^/]+)\/chapter\.html$/.exec(f.path); if (!m) continue;
    let meta = {}; try { meta = JSON.parse((/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>/.exec(f.data) || [])[1] || '{}'); } catch (e) { /* bad meta */ }
    here[m[1]] = { slug: m[1], title: meta.title || m[1], dirty: f.dirty };
  }
  const out = [], seen = new Set();
  if (toc) try {
    for (const u of JSON.parse(toc.data).units || []) for (const c of u.chapters || []) if (c.slug && here[c.slug]) {
      out.push(Object.assign({ unit: u.n + ' · ' + u.title, num: u.n + '.' + c.n }, here[c.slug])); seen.add(c.slug);
    }
  } catch (e) { /* bad toc */ }
  for (const s of Object.keys(here).sort()) if (!seen.has(s)) out.push(Object.assign({ unit: 'Other', num: '' }, here[s]));
  return out;
}
async function list() {
  const rs = await rows(); let html = '', unit = null;
  for (const r of rs) {
    if (r.unit !== unit) { html += (unit === null ? '' : '</ul>') + `<div class="unit">${esc(r.unit)}</div><ul class="ch">`; unit = r.unit; }
    const [have, need] = await Sync.coverage(r.slug), full = need && have >= need;
    html += `<li data-slug="${esc(r.slug)}"><span class="n">${esc(r.num)}</span>
      <div><a class="t" href="edit/${encodeURIComponent(r.slug)}">${esc(r.title)}</a><small>${r.dirty ? '<span class="edited">Edited here</span> · ' : ''}<span class="off ${full ? 'full' : ''}">${full ? 'Available offline' : need ? `<a href="#" data-dl="${esc(r.slug)}">Download for offline</a> (${have}/${need})` : ''}</span></small></div>
      <span class="acts"><a class="btn" href="view/${encodeURIComponent(r.slug)}">Read</a><a class="btn" href="edit/${encodeURIComponent(r.slug)}">Edit</a></span></li>`;
  }
  $('#list').innerHTML = rs.length ? html + '</ul>' : (cfg ? '<p class="note">No chapters on this device yet. Get the latest while online.</p>' : '');
  $('#list').querySelectorAll('[data-dl]').forEach(a => a.onclick = async e => {
    e.preventDefault(); e.stopPropagation(); const s = a.dataset.dl; a.textContent = 'Downloading…';
    try { await Sync.chapter(s, prog); } catch (x) { msg(x.message); }
    prog(0, 0); await list(); await chips();
  });
}
// links only work once the service worker is in charge
$('#list').addEventListener('click', async e => { const a = e.target.closest('a[href]'); if (!a || a.dataset.dl) return; if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { e.preventDefault(); msg('Still setting up offline use, one moment…'); await swReady; location.href = a.href; } });

function installHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install').hidden = false;
  $('#install-text').innerHTML = ios
    ? 'On iPhone and iPad, tap <b>Share</b>, then <b>Add to Home Screen</b>, and open the editor from there. Safari keeps a home-screen app\'s chapters; a plain browser tab can lose them after a few weeks unused.'
    : 'Install it from the browser menu (<b>Install app</b> or <b>Add to Home screen</b>) so its chapters are kept.';
}

show(); installHint(); await chips(); await when(); await list();
$('#foot').innerHTML = cfg ? `<a href="#" id="out">Sign out</a> · removes the token, keeps chapters and edits on this device` : '';
if ($('#out')) $('#out').onclick = async e => { e.preventDefault(); if (!confirm('Sign out of GitHub on this device?')) return; await Store.del('kv', 'remote'); cfg = null; show(); $('#foot').textContent = ''; };
await swReady;
if (cfg && navigator.onLine && !params.has('nopull')) pull();
})();

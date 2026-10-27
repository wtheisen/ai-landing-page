// Suggestions: edits an agent proposes, kept beside the chapter in chapters/<slug>/suggestions.json (written by
// tools/ai2ai, see tools/agent/README.md), never inside chapter.html until accepted here. The chapter only changes when
// you press Accept, as an ordinary edit (Cmd+Z undoes it), so an agent working while you edit can't clash with you.
//
// The Suggestions button opens the panel: each suggestion with what it changes (words struck and added), Show (go to
// the block on its page), Accept and Reject; suggestions with the same group label can be taken together. Blocks
// with an open suggestion get a dashed teal outline on the page (data-ed-sug, never saved).
//
// Requests to Claude are ordinary comments that mention @Claude (tools/agent/tasks.py). Claude answers in the thread;
// a reply with suggestions carries data-sugs, and its "Suggestions" button opens this panel.
function suggestInit() {
  if (window.Suggest || !window.Editor || typeof Book === 'undefined' || Book.mode !== 'edit') return;
  const E = Editor, ch = Book.chapter, $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const OPS = { replace: 'Change', insert: 'Add', delete: 'Remove', page: 'New page' };
  let data = { items: [] }, on = false, panel = null, lastText = '', showAll = false;

  // ---------------------------------------------------------------- the file
  async function load() {
    try {
      const r = await fetch(Book.base + 'suggestions.json', { cache: 'no-store' });
      const t = r.ok ? await r.text() : '{"items": []}';
      if (t === lastText) return false;
      lastText = t; data = JSON.parse(t); if (!Array.isArray(data.items)) data.items = [];
    } catch (e) { return false; }
    mark(); button(); if (on) render();
    return true;
  }
  async function save() {
    const text = JSON.stringify(data, null, 1) + '\n'; lastText = text;
    try {
      const r = await fetch('../api/file/' + ch + '?name=suggestions.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      if (!r.ok) E.toast('Could not save the suggestions: ' + ((await r.json().catch(() => ({}))).error || r.status));
    } catch (e) { E.toast('Could not save the suggestions (is the server still running?)'); }
  }
  const openItems = () => data.items.filter(i => (i.status || 'open') === 'open');
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  // ---------------------------------------------------------------- finding things on the pages
  const blocks = () => Book.pages().flatMap(p => Book.blocks(p));
  const blockById = id => id ? blocks().find(b => b.getAttribute('data-b') === id) || null : null;
  const pageById = id => Book.pages().find(p => p.id === id) || null;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  function anchorOf(it) {   // the element the suggestion is about, for marks and Show
    if (it.op === 'replace' || it.op === 'delete') return blockById(it.target);
    if (it.op === 'insert') return (it.after && it.after !== 'end' && blockById(it.after)) || pageById(it.page);
    if (it.op === 'page') return pageById(it.after);
  }
  function problem(it) {   // why it can't be applied as it stands, or ''
    if (it.op === 'replace' || it.op === 'delete') {
      const b = blockById(it.target); if (!b) return 'The block it changes is no longer in the chapter.';
      if (it.base && norm(Book.serializeBlock(b)) !== norm(it.base)) return 'changed';
    }
    if (it.op === 'insert' && !pageById(it.page)) return 'Its page is no longer in the chapter.';
    if (it.op === 'insert' && it.after && it.after !== 'end' && !blockById(it.after)) return 'The block it goes after is no longer in the chapter.';
    if (it.op === 'page' && !pageById(it.after)) return 'The page it goes after is no longer in the chapter.';
    return '';
  }

  // ---------------------------------------------------------------- marks on the page (data-ed-*: never saved)
  function mark() {
    const want = new Map();
    for (const it of openItems()) {
      const a = anchorOf(it); if (!a) continue;
      const k = it.op === 'replace' || it.op === 'delete' ? 'data-ed-sug' : a.matches('section.page') ? 'data-ed-sug-page' : 'data-ed-sug-after';
      const v = k === 'data-ed-sug' ? it.op : (it.op === 'page' ? 'page' : (it.after === 'end' ? 'end' : it.after ? 'after' : 'top'));
      want.set(a, Object.assign(want.get(a) || {}, { [k]: v }));
    }
    for (const el of document.querySelectorAll('[data-ed-sug], [data-ed-sug-after], [data-ed-sug-page]'))
      for (const k of ['data-ed-sug', 'data-ed-sug-after', 'data-ed-sug-page']) if (el.hasAttribute(k) && !(want.get(el) || {})[k]) el.removeAttribute(k);
    for (const [el, kv] of want) for (const k in kv) if (el.getAttribute(k) !== kv[k]) el.setAttribute(k, kv[k]);
  }

  // ---------------------------------------------------------------- what changes, in words
  function textOf(html) {
    if (!html) return '';
    const t = document.createElement('template'); t.innerHTML = html;
    const out = [];
    for (const el of t.content.children) {
      if (/^b-(code|out)$/.test(el.localName)) out.push(el.textContent.replace(/^\n|\n$/g, ''));
      else if (el.localName === 'b-fig') out.push('[figure ' + (el.getAttribute('src') || '') + '] ' + (el.getAttribute('alt') || ''));
      else if (el.localName === 'b-eq') out.push([...el.querySelectorAll('eq-row, eq-step')].map(r => r.textContent).join('\n'));
      else if (el.localName === 'section') out.push([...el.children].map(c => textOf(c.outerHTML)).join('\n'));
      else { el.querySelectorAll('b-m').forEach(m => m.replaceWith('$' + m.textContent + '$')); el.querySelectorAll('br').forEach(b => b.replaceWith(' / ')); el.querySelectorAll('li, p').forEach(x => x.prepend(' ')); out.push(el.textContent.replace(/[ \t]+/g, ' ').trim()); }
    }
    return out.join('\n');
  }
  function diff(a, b) {   // words struck (in a only) and added (in b only), by longest common subsequence
    const tok = x => x.match(/\s*\S+\s*|\s+/g) || [];   // a word with the spaces after it, so spaces never match on their own
    const A = tok(a), B = tok(b);
    if (A.length * B.length > 4e6) return `<del>${esc(a)}</del><ins>${esc(b)}</ins>`;
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0, out = '', del = '', ins = '';
    const flush = () => { if (del) out += `<del>${esc(del)}</del>`; if (ins) out += `<ins>${esc(ins)}</ins>`; del = ins = ''; };
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { flush(); out += esc(A[i]); i++; j++; }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) ins += B[j++];
      else del += A[i++];
    }
    flush(); return out;
  }
  function preview(it) {
    if (it.op === 'replace') return diff(textOf(it.base || (blockById(it.target) && Book.serializeBlock(blockById(it.target)))), textOf(it.html));
    if (it.op === 'delete') return `<del>${esc(textOf(it.base || (blockById(it.target) && Book.serializeBlock(blockById(it.target)))))}</del>`;
    return `<ins>${esc(textOf(it.html))}</ins>`;
  }
  function where(it) {
    const pg = pageById(it.op === 'page' ? it.after : it.page) || (anchorOf(it) && anchorOf(it).closest && anchorOf(it).closest('section.page'));
    const title = pg && (pg.querySelector(':scope > h1, :scope > h2, :scope > h3') || {}).textContent;
    return (it.op === 'page' ? 'after ' : 'on ') + (title ? `“${title.trim()}”` : (it.page || it.after || 'a page'));
  }

  // ---------------------------------------------------------------- accepting
  function nodes(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return [...t.content.children]; }
  function trailing(b) { const out = []; let n = b.nextElementSibling; while (n && n.classList.contains('cmt')) { out.push(n); n = n.nextElementSibling; } return out; }
  function applyOne(it) {
    if (it.op === 'replace') { const b = blockById(it.target); b.replaceWith(...nodes(it.html)); return; }
    if (it.op === 'delete') { const b = blockById(it.target); trailing(b).forEach(c => c.remove()); b.remove(); return; }
    if (it.op === 'insert') {
      const ns = nodes(it.html), pg = pageById(it.page);
      if (it.after && it.after !== 'end') { const b = blockById(it.after), t = trailing(b); (t.length ? t[t.length - 1] : b).after(...ns); }
      else if (it.after === 'end') pg.append(...ns);
      else pg.prepend(...ns);
      return;
    }
    if (it.op === 'page') { pageById(it.after).after(...nodes(it.html)); return; }
    throw new Error('unknown kind of suggestion: ' + it.op);
  }
  function resolve(list, status) {
    const when = stamp();
    list.forEach(it => { it.status = status; it.resolved = { by: 'Eric', when }; });
  }
  function accept(list) {
    const ok = [], skipped = [];
    E.commit(true);
    for (const it of list) {
      const p = problem(it);
      if (p && p !== 'changed') { skipped.push(it); continue; }
      try { applyOne(it); ok.push(it); } catch (e) { skipped.push(it); }
    }
    if (ok.length) {
      E.prep(); E.commit(true); Book.refresh();
      if (E.renderPages) E.renderPages();
      resolve(ok, 'accepted'); save();
    }
    mark(); button(); if (on) render();
    if (skipped.length) E.toast(`Accepted ${ok.length}; ${skipped.length} could not be applied (see the panel)`);
    else if (ok.length) E.toast(ok.length === 1 ? 'Accepted' : `Accepted ${ok.length} suggestions`, 'Undo', () => {
      E.doUndo(); ok.forEach(it => { it.status = 'open'; delete it.resolved; }); save(); mark(); button(); if (on) render();
    });
  }
  function reject(list) {
    resolve(list, 'rejected'); save(); mark(); button(); if (on) render();
    E.toast(list.length === 1 ? 'Rejected' : `Rejected ${list.length} suggestions`, 'Undo', () => { list.forEach(it => { it.status = 'open'; delete it.resolved; }); save(); mark(); button(); if (on) render(); });
  }
  function show(it) {
    const a = anchorOf(it); if (!a) return E.toast('Not on any page now');
    const pg = a.matches('section.page') ? a : a.closest('section.page');
    if (pg) E.setPage(pg);
    if (!a.matches('section.page')) E.select(a);
    a.scrollIntoView({ block: 'center', behavior: 'smooth' });
    a.classList.add('ed-sug-flash'); setTimeout(() => a.classList.remove('ed-sug-flash'), 1400);
  }

  // ---------------------------------------------------------------- the panel
  function card(it) {
    const p = problem(it), done = (it.status || 'open') !== 'open';
    return `<div class="sg-card${done ? ' done' : ''}" data-id="${esc(it.id)}">
      <div class="sg-h"><b>${OPS[it.op] || esc(it.op)}</b> <span>${esc(where(it))}</span><span class="sp"></span><span class="sg-by">${esc(it.by || '')} · ${esc((it.when || '').slice(5))}</span></div>
      ${it.note ? `<div class="sg-note">${esc(it.note)}</div>` : ''}
      <div class="sg-diff">${preview(it)}</div>
      ${p === 'changed' ? '<div class="sg-warn">The block has changed since this was suggested. Accept replaces it with the suggested version anyway.</div>' : p ? `<div class="sg-warn">${esc(p)}</div>` : ''}
      ${done ? `<div class="sg-st">${esc(it.status)}${it.resolved ? ' · ' + esc(it.resolved.by) + ' ' + esc(it.resolved.when.slice(5)) : ''}</div>`
             : `<div class="sg-b"><button data-a="go">Show</button><span class="sp"></span><button data-a="reject">Reject</button><button data-a="accept" class="pri"${p && p !== 'changed' ? ' disabled' : ''}>Accept</button></div>`}
    </div>`;
  }
  function render() {
    if (!panel) return;
    const items = showAll ? data.items.slice().reverse() : openItems(), groups = new Map();
    items.forEach(it => { const g = it.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });
    const scroll = panel.querySelector('.sg-list') ? panel.querySelector('.sg-list').scrollTop : 0;
    panel.innerHTML = `<div class="sg-top"><b>Suggestions</b><span class="sg-n">${openItems().length} open</span><span class="sp"></span><button data-a="close" title="Close">×</button></div>
      <div class="sg-tools">${openItems().length > 1 ? '<button data-a="accept-all">Accept all</button><button data-a="reject-all">Reject all</button>' : ''}<span class="sp"></span><label><input type="checkbox" class="sg-all"${showAll ? ' checked' : ''}> Show resolved</label></div>
      <div class="sg-list">${items.length ? [...groups].map(([g, list]) => (g ? `<div class="sg-g" data-g="${esc(g)}"><span>${esc(g)}</span><span class="sp"></span>${list.some(i => (i.status || 'open') === 'open') && list.length > 1 ? '<button data-a="g-reject">Reject</button><button data-a="g-accept">Accept all ' + list.length + '</button>' : ''}</div>` : '') + list.map(card).join('')).join('')
        : '<div class="help">No suggestions waiting. When Claude works on this chapter with <code>tools/ai2ai</code>, its edits show up here for you to accept or reject.</div>'}</div>`;
    panel.querySelector('.sg-list').scrollTop = scroll;
  }
  function button() {
    const b = $('#x-sugs'); if (!b) return;
    const n = openItems().length;
    b.innerHTML = 'Suggestions' + (n ? ` <span class="badge">${n}</span>` : '');
    b.classList.toggle('on', on); b.classList.toggle('has', n > 0);
  }
  function setOn(v) {
    if (v === on) return;
    on = v; document.body.classList.toggle('sugs', on);
    if (on && window.QPool) QPool.close();
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'sugs';
      panel.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'close') return setOn(false);
        if (a === 'accept-all') return accept(openItems().filter(i => !problem(i) || problem(i) === 'changed'));
        if (a === 'reject-all') return reject(openItems());
        const g = b.closest('.sg-g');
        if (g) { const list = openItems().filter(i => (i.group || '') === g.dataset.g); return a === 'g-accept' ? accept(list) : reject(list); }
        const c = b.closest('.sg-card'), it = c && data.items.find(i => i.id === c.dataset.id); if (!it) return;
        if (a === 'go') show(it); else if (a === 'accept') accept([it]); else if (a === 'reject') reject([it]);
      });
      panel.addEventListener('mouseover', e => { const c = e.target.closest('.sg-card'); document.querySelectorAll('.ed-sug-hot').forEach(x => x.classList.remove('ed-sug-hot')); const it = c && data.items.find(i => i.id === c.dataset.id), a = it && anchorOf(it); if (a) a.classList.add('ed-sug-hot'); });
      panel.addEventListener('change', e => { if (e.target.matches('.sg-all')) { showAll = e.target.checked; render(); } });
    }
    if (on) { $('#main').append(panel); load().then(changed => { if (!changed) render(); }); }
    else document.querySelectorAll('.ed-sug-hot').forEach(x => x.classList.remove('ed-sug-hot'));
    button();
  }

  const btn = document.createElement('button'); btn.id = 'x-sugs'; btn.textContent = 'Suggestions';
  btn.title = 'Edits Claude has suggested for this chapter: accept or reject each one';
  btn.onclick = () => setOn(!on);
  ($('#x-qpool') || $('#x-cmts')).after(btn);
  // pick up new suggestions (an agent pushing while you work), and keep the marks on blocks the editor redraws
  load();
  setInterval(() => { if (!document.hidden) load(); }, 20000);
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'sync' && e.data.state !== 'syncing') setTimeout(load, 300); });
  Book.root.addEventListener('book-refresh', () => { if (openItems().length) mark(); });
  setInterval(() => { if (openItems().length) mark(); }, 1500);
  window.Suggest = { load, open: () => setOn(true), close: () => setOn(false), get data() { return data; } };
}
if (window.Editor) suggestInit(); else document.addEventListener('editor-ready', suggestInit);   // editor.js sets itself up after loading the chapter

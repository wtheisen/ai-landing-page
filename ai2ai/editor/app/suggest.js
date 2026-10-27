// Suggestions: edits an agent proposes, kept beside the chapter in chapters/<slug>/suggestions.json (written by
// tools/ai2ai, see tools/agent/README.md), never inside chapter.html until accepted here. The chapter only changes when
// you press Accept, as an ordinary edit (Cmd+Z undoes it), so an agent working while you edit can't clash with you.
//
// The Suggestions button opens the panel: each suggestion with what it changes (words struck and added), Show (go to
// the block on its page), Accept and Reject; suggestions with the same group label can be taken together. Blocks
// with an open suggestion get a dashed teal outline on the page (data-ed-sug, never saved).
//
// Ask Claude (the same panel, the Claude button, or Cmd+Shift+L): select words or blocks, type a request, Send. It goes
// into chapters/<slug>/tasks.json with the page, the selected blocks' ids and the selected words; a scheduled Claude
// session picks it up (tools/ai2ai tasks), answers with suggestions linked to it, and leaves a reply that shows here.
// Blocks with a waiting request get a gold mark (data-ed-ask).
function suggestInit() {
  if (window.Suggest || !window.Editor || typeof Book === 'undefined' || Book.mode !== 'edit') return;
  const E = Editor, ch = Book.chapter, $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const OPS = { replace: 'Change', insert: 'Add', delete: 'Remove', page: 'New page' };
  let data = { items: [] }, on = false, panel = null, lastText = '', showAll = false;
  let tasks = { items: [] }, lastTasks = '', ctx = null, lastCtx = null, draft = '';

  // ---------------------------------------------------------------- the file
  async function fetchJSON(name) {
    try { const r = await fetch(Book.base + name, { cache: 'no-store' }); return r.ok ? await r.text() : '{"items": []}'; }
    catch (e) { return null; }
  }
  async function load() {
    const [t, k] = await Promise.all([fetchJSON('suggestions.json'), fetchJSON('tasks.json')]);
    let changed = false;
    try {
      if (t !== null && t !== lastText) { lastText = t; data = JSON.parse(t); if (!Array.isArray(data.items)) data.items = []; changed = true; }
      if (k !== null && k !== lastTasks) { lastTasks = k; tasks = JSON.parse(k); if (!Array.isArray(tasks.items)) tasks.items = []; changed = true; }
    } catch (e) { return false; }
    if (!changed) return false;
    mark(); button(); if (on) render();
    return true;
  }
  async function put(name, obj) {
    const text = JSON.stringify(obj, null, 1) + '\n';
    if (name === 'suggestions.json') lastText = text; else lastTasks = text;
    try {
      const r = await fetch('../api/file/' + ch + '?name=' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      if (!r.ok) { E.toast('Could not save ' + name + ': ' + ((await r.json().catch(() => ({}))).error || r.status)); return false; }
      return true;
    } catch (e) { E.toast('Could not save ' + name + ' (is the server still running?)'); return false; }
  }
  const save = () => put('suggestions.json', data);
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
    for (const t of liveTasks()) for (const id of t.blocks || []) { const b = blockById(id); if (b) want.set(b, Object.assign(want.get(b) || {}, { 'data-ed-ask': t.status || 'open' })); }
    for (const el of document.querySelectorAll('[data-ed-sug], [data-ed-sug-after], [data-ed-sug-page], [data-ed-ask]'))
      for (const k of ['data-ed-sug', 'data-ed-sug-after', 'data-ed-sug-page', 'data-ed-ask']) if (el.hasAttribute(k) && !(want.get(el) || {})[k]) el.removeAttribute(k);
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

  // ---------------------------------------------------------------- Ask Claude: requests (tasks.json)
  const liveTasks = () => tasks.items.filter(t => ['open', 'working'].includes(t.status || 'open'));
  const pageTitle = pg => { const h = pg && pg.querySelector(':scope > h1, :scope > h2, :scope > h3'); return h ? h.textContent.trim() : (pg && pg.classList.contains('cover') ? 'the cover' : ''); };
  const device = () => /iPad|Macintosh.*Mobile/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)) ? 'iPad' : /iPhone|Android/.test(navigator.userAgent) ? 'phone' : 'Mac';
  function captureCtx() {   // what the request is about: the selected words and their blocks, else the selected block, else the page
    const s = getSelection(); let quote = '', ids = [];
    if (s.rangeCount && !s.isCollapsed) {
      const r = s.getRangeAt(0);
      if (Book.pages().some(p => p.contains(r.commonAncestorContainer) || r.intersectsNode(p))) {
        quote = s.toString().replace(/\s+/g, ' ').trim().slice(0, 800);
        ids = blocks().filter(b => r.intersectsNode(b)).map(b => b.getAttribute('data-b')).filter(Boolean);
      }
    }
    if (!ids.length && E.sel && E.sel.getAttribute && E.sel.getAttribute('data-b')) ids = [E.sel.getAttribute('data-b')];
    const first = ids.length && blockById(ids[0]), pg = (first && first.closest('section.page')) || E.curPage;
    if (!pg) return null;
    return { page: pg.id, doc: pg.classList.contains('cover') ? 'cover' : Book.isLecture(pg) ? 'lecture' : 'reading', blocks: ids, quote, title: pageTitle(pg) };
  }
  document.addEventListener('selectionchange', () => { const c = captureCtx(); if (c && (c.quote || c.blocks.length)) lastCtx = c; });
  function ctxLine(c) {
    if (!c) return 'No page selected: the request is about the whole chapter.';
    const what = c.quote ? `“${c.quote.length > 90 ? c.quote.slice(0, 87) + '…' : c.quote}”` : c.blocks.length ? (c.blocks.length === 1 ? 'the selected block' : c.blocks.length + ' blocks') : 'this page';
    return `${esc(what)} <span class="ask-pg">on ${esc(c.title ? '“' + c.title + '”' : c.page)}${c.doc === 'lecture' ? ' (Lecture)' : ''}</span>`;
  }
  async function ask(text) {
    text = text.trim(); if (!text) return;
    const taken = new Set(tasks.items.map(t => t.id));
    let id; do { id = 't-' + Math.random().toString(36).slice(2, 7); } while (taken.has(id) || id.length < 7);
    const t = { id, by: 'Eric', when: stamp(), device: device(), request: text, status: 'open' };
    if (ctx) { t.page = ctx.page; t.doc = ctx.doc; if (ctx.blocks.length) t.blocks = ctx.blocks; if (ctx.quote) t.quote = ctx.quote; }
    await load();   // the newest copy first, so nothing is lost
    tasks.items.push(t);
    if (await put('tasks.json', tasks)) { draft = ''; ctx = null; const ta = panel && panel.querySelector('.ask textarea'); if (ta) ta.value = ''; E.toast('Sent to Claude. The reply and any suggestions show up in this panel.'); }
    mark(); button(); render();
  }
  function cancelTask(t) { t.status = 'cancelled'; t.resolved = { by: 'Eric', when: stamp() }; put('tasks.json', tasks); mark(); button(); render(); }
  function showTask(t) {
    const b = (t.blocks || []).map(blockById).find(Boolean), pg = b ? b.closest('section.page') : pageById(t.page);
    if (!pg) return E.toast('That page is no longer in the chapter');
    E.setPage(pg); if (b) E.select(b);
    (b || pg).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const STATUS = { open: 'Waiting', working: 'Working on it', done: 'Done', declined: 'Not done', cancelled: 'Cancelled' };
  function taskCard(t) {
    const st = t.status || 'open', n = data.items.filter(i => i.task === t.id && (i.status || 'open') === 'open').length;
    const pg = pageById(t.page);
    return `<div class="tk-card st-${esc(st)}" data-id="${esc(t.id)}">
      <div class="sg-h"><span class="tk-st">${STATUS[st] || esc(st)}</span><span class="sp"></span><span class="sg-by">${esc(t.by || '')} · ${esc((t.when || '').slice(5))}</span></div>
      <div class="tk-req">${esc(t.request)}</div>
      ${t.quote ? `<div class="tk-q">on “${esc(t.quote.length > 160 ? t.quote.slice(0, 157) + '…' : t.quote)}”</div>` : t.page ? `<div class="tk-q">on ${esc(pageTitle(pg) ? '“' + pageTitle(pg) + '”' : t.page)}</div>` : ''}
      ${t.reply ? `<div class="tk-reply"><b>Claude:</b> ${esc(t.reply)}</div>` : ''}
      <div class="sg-b">${t.page ? '<button data-a="t-go">Show</button>' : ''}${n ? `<span class="tk-n">${n} suggestion${n > 1 ? 's' : ''} below</span>` : ''}<span class="sp"></span>${st === 'open' ? '<button data-a="t-cancel">Cancel</button>' : ''}</div>
    </div>`;
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
    const ta = panel.querySelector('.ask textarea'); if (ta) draft = ta.value;
    const focused = ta && document.activeElement === ta;
    const recent = tasks.items.filter(t => (t.status || 'open') !== 'cancelled').filter(t => showAll || ['open', 'working'].includes(t.status || 'open') || (t.resolved && Date.now() - new Date(t.resolved.when.replace(' ', 'T')) < 3 * 864e5)).slice().reverse();
    panel.innerHTML = `<div class="sg-top"><b>Claude</b><span class="sg-n">${openItems().length} suggestion${openItems().length === 1 ? '' : 's'} open</span><span class="sp"></span><button data-a="close" title="Close">×</button></div>
      <div class="ask"><div class="ask-ctx">${ctxLine(ctx)}${ctx ? ' <button data-a="ctx-clear" title="Ask about the whole chapter instead">×</button>' : ''}</div>
        <textarea rows="3" placeholder="Ask Claude… (select words or a block first to point at them)">${esc(draft)}</textarea>
        <div class="ask-b"><button data-a="ctx-sel" title="Point the request at what is selected now">Use selection</button><span class="sp"></span><button data-a="ask" class="pri">Send</button></div></div>
      ${recent.length ? `<div class="tk-list">${recent.map(taskCard).join('')}</div>` : ''}
      <div class="sg-tools">${openItems().length > 1 ? '<button data-a="accept-all">Accept all</button><button data-a="reject-all">Reject all</button>' : ''}<span class="sp"></span><label><input type="checkbox" class="sg-all"${showAll ? ' checked' : ''}> Show resolved</label></div>
      <div class="sg-list">${items.length ? [...groups].map(([g, list]) => (g ? `<div class="sg-g" data-g="${esc(g)}"><span>${esc(g)}</span><span class="sp"></span>${list.some(i => (i.status || 'open') === 'open') && list.length > 1 ? '<button data-a="g-reject">Reject</button><button data-a="g-accept">Accept all ' + list.length + '</button>' : ''}</div>` : '') + list.map(card).join('')).join('')
        : '<div class="help">No suggestions waiting. When Claude works on this chapter with <code>tools/ai2ai</code>, its edits show up here for you to accept or reject.</div>'}</div>`;
    panel.querySelector('.sg-list').scrollTop = scroll;
    if (focused) { const t = panel.querySelector('.ask textarea'); t.focus(); t.selectionStart = t.selectionEnd = t.value.length; }
  }
  function button() {
    const b = $('#x-sugs'); if (!b) return;
    const n = openItems().length, busy = liveTasks().length;
    b.innerHTML = 'Claude' + (n ? ` <span class="badge">${n}</span>` : '') + (busy ? ` <span class="busy" title="${busy} request${busy > 1 ? 's' : ''} waiting for Claude"></span>` : '');
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
        if (a === 'ask') return ask(panel.querySelector('.ask textarea').value);
        if (a === 'ctx-clear') { ctx = null; return render(); }
        if (a === 'ctx-sel') { ctx = captureCtx() || lastCtx; return render(); }
        const tc = b.closest('.tk-card'), t = tc && tasks.items.find(x => x.id === tc.dataset.id);
        if (t) { if (a === 't-go') showTask(t); else if (a === 't-cancel') cancelTask(t); return; }
        if (a === 'accept-all') return accept(openItems().filter(i => !problem(i) || problem(i) === 'changed'));
        if (a === 'reject-all') return reject(openItems());
        const g = b.closest('.sg-g');
        if (g) { const list = openItems().filter(i => (i.group || '') === g.dataset.g); return a === 'g-accept' ? accept(list) : reject(list); }
        const c = b.closest('.sg-card'), it = c && data.items.find(i => i.id === c.dataset.id); if (!it) return;
        if (a === 'go') show(it); else if (a === 'accept') accept([it]); else if (a === 'reject') reject([it]);
      });
      panel.addEventListener('mouseover', e => { const c = e.target.closest('.sg-card'); document.querySelectorAll('.ed-sug-hot').forEach(x => x.classList.remove('ed-sug-hot')); const it = c && data.items.find(i => i.id === c.dataset.id), a = it && anchorOf(it); if (a) a.classList.add('ed-sug-hot'); });
      panel.addEventListener('keydown', e => { if (e.target.matches('.ask textarea') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(e.target.value); } });
      panel.addEventListener('input', e => { if (e.target.matches('.ask textarea')) draft = e.target.value; });
      panel.addEventListener('change', e => { if (e.target.matches('.sg-all')) { showAll = e.target.checked; render(); } });
    }
    if (on) { $('#main').append(panel); load().then(changed => { if (!changed) render(); }); }
    else document.querySelectorAll('.ed-sug-hot').forEach(x => x.classList.remove('ed-sug-hot'));
    button();
  }

  const btn = document.createElement('button'); btn.id = 'x-sugs'; btn.textContent = 'Claude';
  btn.title = 'Ask Claude about what you have selected (Cmd+Shift+L), and accept or reject the edits it suggests';
  btn.addEventListener('pointerdown', () => { if (!on) ctx = captureCtx() || lastCtx; });   // before the click moves focus off the selection
  btn.onclick = () => { setOn(!on); if (on) focusAsk(); };
  function focusAsk() { setTimeout(() => { const t = panel && panel.querySelector('.ask textarea'); if (t) t.focus(); }, 50); }
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); ctx = captureCtx() || lastCtx; if (!on) setOn(true); else render(); focusAsk(); }
  });
  ($('#x-qpool') || $('#x-cmts')).after(btn);
  // pick up new suggestions (an agent pushing while you work), and keep the marks on blocks the editor redraws
  load();
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'sync' && e.data.state !== 'syncing') setTimeout(load, 300); });
  Book.root.addEventListener('book-refresh', () => { if (openItems().length || liveTasks().length) mark(); });
  setInterval(() => { if (openItems().length || liveTasks().length) mark(); }, 1500);
  window.Suggest = { load, open: () => setOn(true), close: () => setOn(false), ask: (text, c) => { ctx = c === undefined ? captureCtx() : c; return ask(text); }, get data() { return data; }, get tasks() { return tasks; } };
}
if (window.Editor) suggestInit(); else document.addEventListener('editor-ready', suggestInit);   // editor.js sets itself up after loading the chapter

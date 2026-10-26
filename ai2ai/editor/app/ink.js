// Ink for the AI2AI web edition. Everyone can write on the pages; only the instructor can publish.
//
//   Reading      the page looks for ink/index.json next to itself: {"layers":[{"id":"2026-10-20","title":"Oct 20"}]}.
//                A pen bar sits under the navbar: arrow (use the page), pens, highlighter, eraser, laser, widths,
//                undo, + page, and a "Lecture notes" picker for the instructor's published notes (newest by default).
//   Students     the pen writes into "My notes": kept in this browser only (never uploaded), one set per view, shown on
//                top of the instructor's notes, printable.
//   Views        ink is in page coordinates and each view lays pages out differently, so a set of notes belongs to the
//                view it was drawn in (index entries carry "view"); picking one from another view switches to that view.
//   Instructor   register a device once with Instructor sign-in (GitHub icon in the navbar): the GitHub token is checked and kept
//                for the whole site. On that device the pen then writes into today's lecture notes and the toolbar has
//                Publish, on every chapter and view. Publish commits ink/<id>.json and ink/index.json to
//                the site's repository (fine-grained token: contents read and write, that repository only; kept on this
//                device only). Picking a pen starts writing; the arrow (or L) stops.
//   Tools        pens in the book's colours (even width, smoothed), highlighter, eraser, undo, laser pointer (not saved),
//                ✋ to use the page (figures, Run buttons) instead of writing, + page for blank working space.
//   Input        Pencil and mouse write; fingers scroll.
//
// A layer: {"id","title","pages":[{"after":"page-id","id":"wb-…"}],"strokes":[{"p":"page-id","c":"#hex","w":2.2,
// "o":0.35?,"pts":[[x,y,pressure],…]}]}, coordinates in points from the page's top-left (a page is 432 pt wide).
// Self-contained on purpose: the published page gets this file's source verbatim.
function eaiInk(opts) {
  'use strict';
  opts = opts || {};
  var NS = 'http://www.w3.org/2000/svg';
  var REPO = opts.repo || 'wtheisen/ai-landing-page', BRANCH = opts.branch || 'main', SITE_DIR = opts.dir || '';
  var book = document.querySelector('main.book, #book'); if (!book) return;
  var PEN = [['#002B5B', 'navy'], ['#CC0000', 'red'], ['#38761D', 'green'], ['#674EA7', 'purple']];
  var HL = '#F1C232';
  // Ink sits in page coordinates and the three views lay pages out differently (the Lecture view has bigger type), so a
  // set of notes belongs to the view it was drawn in. Other views list it in the picker and switch to that view.
  var VIEW = book.getAttribute('data-view') || 'reading', FILES = { reading: 'index.html', slides: 'index-slides.html', workbook: 'index-workbook.html' };
  var VIEWNAME = { reading: 'Reading', slides: 'Lecture', workbook: 'Workbook' };
  var DIR = location.pathname.replace(/[^/]*$/, '');
  var KEY_TOKEN = 'eai-ink-token', KEY_MINE = 'eai-ink-mine:' + DIR + VIEW, KEY_DRAFT = 'eai-ink-draft:' + DIR + VIEW + ':';
  var viewOf = function (l) { return l.view || 'slides'; };
  var pub = null, layers = [], mine = null, target = null, editing = false, tool = 'hand', color = PEN[0][0], width = 2.2, undo = [];
  var store = function (k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var teacher = function () { return !!store(KEY_TOKEN); };
  // iPadOS tells Pencil touches apart (touchType 'stylus'), so fingers keep Safari's own scrolling (with momentum) and
  // only the Pencil is stopped from scrolling. Elsewhere the pages lock touch while writing and fingers scroll by hand.
  var IOS = navigator.maxTouchPoints > 1 && /iPad|iPhone|Macintosh/.test(navigator.userAgent);
  mine = store(KEY_MINE) || { id: 'mine', title: 'My notes', pages: [], strokes: [] };

  // Even-width ink (pressure is ignored), so a stroke is a plain round-capped SVG line: crisp at any zoom and cheap to
  // redraw while writing. Points are smoothed as they come in (see smooth() in down()) and joined with quadratic
  // curves through their midpoints.
  function pathD(p) {
    if (!p.length) return '';
    var d = 'M' + p[0][0] + ' ' + p[0][1];
    if (p.length === 1) return d + ' l0.01 0';
    if (p.length === 2) return d + ' L' + p[1][0] + ' ' + p[1][1];
    for (var i = 1; i < p.length - 1; i++) d += ' Q' + p[i][0] + ' ' + p[i][1] + ' ' + r1((p[i][0] + p[i + 1][0]) / 2) + ' ' + r1((p[i][1] + p[i + 1][1]) / 2);
    return d + ' L' + p[p.length - 1][0] + ' ' + p[p.length - 1][1];
  }
  function paint(el, s, tail) {
    el.setAttribute('d', pathD(tail ? s.pts.concat([tail]) : s.pts));
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', s.c); el.setAttribute('stroke-width', s.o ? s.w : r1(s.w * 1.6));
  }

  // ---------------------------------------------------------------- pages and overlays
  function pages() { return [].slice.call(book.querySelectorAll('section.page')); }
  function overlay(pg) {
    var svg = pg.querySelector(':scope > svg.ink');
    if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ink'); svg.setAttribute('aria-hidden', 'true'); pg.appendChild(svg); }
    var r = pg.getBoundingClientRect(), k = 432 / (r.width || 432);
    svg.setAttribute('viewBox', '0 0 432 ' + r1(r.height * k));
    return svg;
  }
  function toPt(pg, e) { var r = pg.getBoundingClientRect(), k = 432 / r.width; return [r1((e.clientX - r.left) * k), r1((e.clientY - r.top) * k), Math.round((e.pressure > 0 ? e.pressure : 0.5) * 100) / 100]; }
  function drawStroke(s) {
    var pg = document.getElementById(s.p); if (!pg) return null;
    var el = document.createElementNS(NS, 'path'); paint(el, s);
    if (s.o && s.o < 1) el.setAttribute('opacity', s.o);
    el._s = s; overlay(pg).appendChild(el); return el;
  }
  function blankPage(b) {
    if (document.getElementById(b.id)) return;
    var after = document.getElementById(b.after); if (!after) return;
    var pg = document.createElement('section'); pg.className = 'page ink-blank'; pg.id = b.id;
    pg.innerHTML = '<p class="ink-blank-label">Working space</p>'; after.after(pg);
  }
  function render() {   // the instructor's notes (if any are picked), then this reader's own notes on top
    [].forEach.call(book.querySelectorAll('svg.ink'), function (s) { s.remove(); });
    [].forEach.call(book.querySelectorAll('section.ink-blank'), function (s) { s.remove(); });
    [pub, mine].forEach(function (l) { if (l) (l.pages || []).forEach(blankPage); });
    [pub, mine].forEach(function (l) { if (l) (l.strokes || []).forEach(drawStroke); });
    pages().forEach(overlay);
  }
  addEventListener('resize', function () { pages().forEach(function (p) { if (p.querySelector(':scope > svg.ink')) overlay(p); }); });

  // ---------------------------------------------------------------- navbar: Notes picker and Pen button
  var nav = document.querySelector('.navbar');
  var GHSVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  function navbar() {
    if (!nav) return;
    var box = nav.querySelector('.tools') || nav;
    var gh = document.getElementById('ink-gh'); if (gh) gh.remove();
    gh = document.createElement('details'); gh.id = 'ink-gh'; gh.className = 'navmenu' + (teacher() ? ' on' : '');
    gh.innerHTML = '<summary class="nb icon" title="' + (teacher() ? 'Instructor (signed in on this device)' : 'Instructor sign-in') + '">' + GHSVG + '</summary><div class="menu">'
      + (teacher() ? '<span class="who">Instructor: this device can publish lecture notes</span><label><input type="checkbox" data-g="ghost"' + (store('eai-ink-ghost') === false ? '' : ' checked') + '> Faint answers to trace (Lecture view)</label><button type="button" data-g="out">Sign out on this device</button>'
                   : '<button type="button" data-g="in">Instructor sign-in…</button>') + '</div>';
    gh.addEventListener('click', function (e) {
      var g = e.target.getAttribute && e.target.getAttribute('data-g'); if (!g) return;
      if (g === 'in') { gh.open = false; signIn(); }
      if (g === 'out' && confirm('Sign out? This device will no longer be able to publish lecture notes.')) { store(KEY_TOKEN, ''); stop(); target = null; ghost(); navbar(); }
    });
    gh.addEventListener('change', function (e) { if (e.target.getAttribute('data-g') === 'ghost') { store('eai-ink-ghost', e.target.checked); ghost(); } });
    box.appendChild(gh);
    barState();
  }
  function load(id) { return fetch('ink/' + id + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  fetch('ink/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : { layers: [] }; }).catch(function () { return { layers: [] }; })
    .then(function (ix) {
      layers = (ix.layers || []).slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; });
      var drafting = editing && target !== mine;
      var here = layers.filter(function (l) { return viewOf(l) === VIEW; });
      var want = (location.hash.match(/notes=([\w-]+)/) || [])[1] || (here[0] && here[0].id);
      return (want && !drafting ? load(want) : Promise.resolve(pub)).then(function (l) { if (!(editing && target !== mine)) pub = l; render(); navbar(); });
    });
  // the instructor's crib: in the Lecture view every blank, worked equation and quick-check answer shows in faint ink
  // to trace over (screen only; never for students, never printed)
  function ghost() { document.documentElement.classList.toggle('ink-ghost', teacher() && VIEW === 'slides' && store('eai-ink-ghost') !== false); }

  // ---------------------------------------------------------------- writing
  var bar = null, laser = null, last = { t: 'pen', c: PEN[0][0] };
  var SVG = function (d, extra) { return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>'; };
  var I = {
    eye: SVG('<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.2 8s2.5-4.6 6.8-4.6S14.8 8 14.8 8s-2.5 4.6-6.8 4.6S1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'),
    hand: SVG('<path fill="currentColor" d="M3.5 1.8l9 5.2-4 1 2.3 4.3-1.7.9L6.8 8.9 3.9 11.6z"/>'),
    hl: SVG('<path fill="#F1C232" d="M5 10.5l5.6-7.6 2.6 1.9-5.6 7.6H5z"/><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M5 10.5l5.6-7.6 2.6 1.9-5.6 7.6H5zM3 14.5h6"/>'),
    erase: SVG('<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.5 10.2l6.7-6.7 4.3 4.3-5.2 5.2H5.8zM6 6.7l4.3 4.3M8.3 13h5.2"/>'),
    laser: SVG('<circle cx="8" cy="8" r="3" fill="#ff2a2a"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="#ff2a2a" stroke-opacity=".35" stroke-width="1.5"/>'),
    undo: SVG('<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M5.5 3.5l-3 3 3 3M2.5 6.5H10a3.5 3.5 0 010 7H7"/>'),
    page: SVG('<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M3.5 1.5h6l3 3v10h-9z"/><path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 7v5M5.5 9.5h5"/>') };
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function save() { if (target === mine) store(KEY_MINE, mine); else if (target) store(KEY_DRAFT + target.id, target); }
  // where the pen writes: the instructor into today's lecture notes (a draft on this device until published), anyone else into My notes
  function ensureTarget() {
    if (target && (target === mine) === !teacher()) return;
    if (teacher()) {
      var id = today() + (VIEW === 'slides' ? '' : '-' + VIEW), title = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      target = store(KEY_DRAFT + id) || { id: id, title: title, view: VIEW, pages: [], strokes: [] };
      pub = target; render();
    } else target = mine;
  }
  // the pen bar: a second row under the navbar, always there. The arrow uses the page normally; any pen starts writing.
  function buildBar() {
    if (!nav || bar) return;
    var head = document.createElement('header'); head.className = 'chap-head web-only';
    nav.parentNode.insertBefore(head, nav); head.appendChild(nav);
    bar = document.createElement('div'); bar.className = 'ink-sub'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Pen');
    bar.innerHTML = '<span class="grp"><button data-t="hand" title="use the page: scroll, click figures and Run buttons (L toggles)">' + I.hand + '</button></span>'
      + '<span class="grp">' + PEN.map(function (p) { return '<button data-t="pen" data-c="' + p[0] + '" title="' + p[1] + ' pen" class="sw" style="--c:' + p[0] + '"><i></i></button>'; }).join('')
      + '<button data-t="hl" title="highlighter">' + I.hl + '</button><button data-t="erase" title="eraser (your own ink)">' + I.erase + '</button><button data-t="laser" title="laser pointer (not saved)">' + I.laser + '</button></span>'
      + '<span class="grp">' + [1.4, 2.2, 3.6].map(function (v, i) { return '<button data-w="' + v + '" title="' + ['thin', 'medium', 'thick'][i] + '" class="wd' + (v === width ? ' on' : '') + '"><i style="--d:' + (3 + i * 2.5) + 'px"></i></button>'; }).join('') + '</span>'
      + '<span class="grp"><button data-a="undo" title="undo (⌘Z)">' + I.undo + '</button><button data-a="blank" title="add a blank page after this one">' + I.page + '</button></span>'
      + '<span class="spacer"></span><span class="ink-msg"></span><span class="right"></span>';
    head.appendChild(bar);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t === 'hand') stop();
      else if (b.dataset.t) { tool = b.dataset.t; if (b.dataset.c) color = b.dataset.c; if (tool !== 'laser') last = { t: tool, c: color }; start(); }
      if (b.dataset.w) width = +b.dataset.w;
      if (b.dataset.a === 'undo') { ensureTarget(); doUndo(); }
      if (b.dataset.a === 'blank') { ensureTarget(); addBlank(); }
      if (b.dataset.a === 'clear' && confirm('Erase all of your notes in this chapter (this view)?')) { mine.strokes = []; mine.pages = []; undo = []; store(KEY_MINE, mine); render(); }
      if (b.dataset.a === 'publish') { ensureTarget(); publish(); }
      if (b.dataset.a === 'present') { store('eai-ink-ghost', store('eai-ink-ghost') === false); ghost(); navbar(); }   // Present = the faint answers off (same setting as the instructor menu's checkbox)
      barState();
    });
    bar.addEventListener('change', function (e) {
      var sel = e.target; if (sel.id !== 'ink-pick') return;
      if (!sel.value) { pub = null; return render(); }
      var l = layers.filter(function (x) { return x.id === sel.value; })[0];
      if (l && viewOf(l) !== VIEW) { location.href = FILES[viewOf(l)] + '#notes=' + l.id; return; }
      load(sel.value).then(function (l) { pub = l; render(); });
    });
  }
  function barState() {
    if (!bar) return;
    var cur = editing ? tool : 'hand';
    [].forEach.call(bar.querySelectorAll('[data-t]'), function (x) { x.classList.toggle('on', x.dataset.t === cur && (!x.dataset.c || x.dataset.c === color)); });
    [].forEach.call(bar.querySelectorAll('[data-w]'), function (x) { x.classList.toggle('on', +x.dataset.w === width); });
    var right = bar.querySelector('.right'), h = '';
    if (layers.length) h += '<select id="ink-pick" title="Lecture notes"' + (editing && target !== mine ? ' disabled' : '') + '><option value="">No lecture notes</option>' + layers.map(function (l) { return '<option value="' + l.id + '"' + (pub && pub.id === l.id ? ' selected' : '') + '>Notes: ' + (l.title || l.id) + (viewOf(l) === VIEW ? '' : ' (' + VIEWNAME[viewOf(l)] + ')') + '</option>'; }).join('') + '</select>';
    if (teacher() && VIEW === 'slides') { var pres = store('eai-ink-ghost') === false; h += '<button data-a="present" class="' + (pres ? 'on' : '') + '" title="' + (pres ? 'Presenting: the faint answers are hidden (safe to mirror to the projector). Click to show them again.' : 'Present: hide the faint answers before mirroring this screen to the projector') + '">' + I.eye + (pres ? ' Presenting' : ' Present') + '</button>'; }
    h += teacher() ? '<button data-a="publish" class="act" title="publish today\'s notes for students">Publish</button>'
                   : '<button data-a="clear" class="quiet" title="erase all of my notes on this view">Clear mine</button>';
    right.innerHTML = h;
    msg(editing ? (target === mine ? 'My notes · this device only' : 'Lecture notes · ' + target.title + ' (draft)') : '');
  }
  function start() {
    if (editing) return barState(); editing = true; undo = [];
    if (tool === 'hand') { tool = last.t; color = last.c; }
    ensureTarget(); render();
    document.documentElement.classList.add('ink-lecture'); if (!IOS) document.documentElement.classList.add('ink-lock');
    book.addEventListener('pointerdown', down, { passive: false });
    barState();
  }
  function stop() { if (!editing) return barState(); editing = false; save(); document.documentElement.classList.remove('ink-lecture', 'ink-lock', 'ink-hand'); book.removeEventListener('pointerdown', down); tool = 'hand'; barState(); }
  function msg(t) { var m = bar && bar.querySelector('.ink-msg'); if (m) m.textContent = t; else if (t && !/…$/.test(t)) alert(t); }
  function currentPage() { var best = null, bd = 1e9; pages().forEach(function (p) { var r = p.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < bd) { bd = d; best = p; } }); return best; }
  function addBlank() {
    var pg = currentPage(); if (!pg) return;
    var b = { after: pg.id, id: (target === mine ? 'my-' : 'wb-') + Date.now().toString(36) }; target.pages.push(b); blankPage(b); undo.push({ blank: b }); save();
    document.getElementById(b.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function doUndo() {
    var u = undo.pop(); if (!u) return;
    if (u.stroke) { target.strokes.splice(target.strokes.indexOf(u.stroke), 1); if (u.el) u.el.remove(); }
    if (u.erased) u.erased.forEach(function (s) { target.strokes.push(s); drawStroke(s); });
    if (u.blank) { target.pages.splice(target.pages.indexOf(u.blank), 1); var p = document.getElementById(u.blank.id); if (p) p.remove(); }
    save();
  }
  function near(s, x, y, r) { for (var i = 0; i < s.pts.length; i++) { var dx = s.pts[i][0] - x, dy = s.pts[i][1] - y; if (dx * dx + dy * dy < r * r) return true; } return false; }
  function down(e) {
    if (!editing || tool === 'hand' || e.button > 0 || e.target.closest('button, a, select, textarea, input, iframe, .ink-bar')) return;
    var pg = e.target.closest('section.page'); if (!pg) return;
    if (e.pointerType === 'touch') return IOS ? undefined : fingerScroll(e);
    e.preventDefault(); try { pg.setPointerCapture(e.pointerId); } catch (x) {}
    var svg = overlay(pg), cur = null, el = null, erased = [], sm = null, raw = null, tail = null, queued = false;
    // speed-aware smoothing: slow, wobbly movement is averaged out, fast movement passes straight through (no trailing)
    function smooth(pt) {
      raw = pt; if (!sm) { sm = pt.slice(); return pt; }
      var dx = pt[0] - sm[0], dy = pt[1] - sm[1], a = Math.min(1, 0.2 + Math.sqrt(dx * dx + dy * dy) / 6);
      sm[0] += a * dx; sm[1] += a * dy; return [r1(sm[0]), r1(sm[1]), pt[2]];
    }
    function frame() { queued = false; if (el) paint(el, cur, tail); }
    if (tool === 'laser') { laser = laser || document.createElement('div'); laser.className = 'ink-laser'; document.body.appendChild(laser); laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; }
    else if (tool !== 'erase') {
      cur = { p: pg.id, c: tool === 'hl' ? HL : color, w: tool === 'hl' ? 11 : width, pts: [smooth(toPt(pg, e))] }; if (tool === 'hl') cur.o = 0.35;
      el = drawStroke(cur);
    }
    function move(ev) {
      var es = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; if (!es.length) es = [ev];
      if (tool === 'laser') { laser.style.left = ev.clientX + 'px'; laser.style.top = ev.clientY + 'px'; return; }
      es.forEach(function (q) {
        var pt = toPt(pg, q);
        if (tool === 'erase') {   // only your own strokes can be erased
          target.strokes.filter(function (s) { return s.p === pg.id && near(s, pt[0], pt[1], 6); }).forEach(function (s) {
            target.strokes.splice(target.strokes.indexOf(s), 1); erased.push(s);
            [].forEach.call(svg.querySelectorAll('path'), function (pp) { if (pp._s === s) pp.remove(); });
          });
        } else { var f = smooth(pt), l = cur.pts[cur.pts.length - 1]; if (Math.abs(l[0] - f[0]) + Math.abs(l[1] - f[1]) >= 0.8) cur.pts.push(f); }
      });
      if (!cur) return;
      // draw ahead to where the pen is (or is about to be) so the line keeps up with the tip
      var pr = ev.getPredictedEvents ? ev.getPredictedEvents() : []; tail = toPt(pg, pr.length ? pr[pr.length - 1] : ev);
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }
    function up() {
      pg.removeEventListener('pointermove', move); pg.removeEventListener('pointerup', up); pg.removeEventListener('pointercancel', up);
      if (tool === 'laser') { if (laser) laser.remove(); laser = null; return; }
      if (cur && cur.pts.length) { var l = cur.pts[cur.pts.length - 1]; if (raw && cur.pts.length > 1 && (raw[0] !== l[0] || raw[1] !== l[1])) cur.pts.push(raw); tail = null; paint(el, cur); target.strokes.push(cur); undo.push({ stroke: cur, el: el }); }
      if (erased.length) undo.push({ erased: erased });
      save();
    }
    pg.addEventListener('pointermove', move); pg.addEventListener('pointerup', up); pg.addEventListener('pointercancel', up);
  }
  function stylusGuard(e) {
    if (!editing || tool === 'hand') return;
    var t = e.target, ts = e.changedTouches || [];
    if (!t.closest || !t.closest('section.page') || t.closest('button, a, select, textarea, input, iframe')) return;
    for (var i = 0; i < ts.length; i++) if (ts[i].touchType === 'stylus') { e.preventDefault(); return; }
  }
  document.addEventListener('touchstart', stylusGuard, { passive: false });
  document.addEventListener('touchmove', stylusGuard, { passive: false });
  function fingerScroll(e) {   // pages have touch-action: none while writing, so a finger drag scrolls the window by hand
    var y = e.clientY, x = e.clientX;
    function move(ev) { if (ev.pointerId !== e.pointerId) return; scrollBy(x - ev.clientX, y - ev.clientY); x = ev.clientX; y = ev.clientY; }
    function up(ev) { if (ev.pointerId !== e.pointerId) return; removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); }
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- instructor: set up this device, publish
  // Instructor sign-in, once per device: the token is checked with GitHub (it must be able to push to the site's
  // repository) and kept in this browser for the whole site, so every chapter's pen can publish from then on.
  function signIn() {
    var t = prompt('Instructor sign-in: GitHub token for ' + REPO + ' (fine-grained, contents read and write). It stays on this device. (Signing in to the Book Editor on this device does this for you when its token also covers ' + REPO + '.)');
    if (!t) return Promise.resolve(false); t = t.trim(); msg('Checking…');
    return fetch('https://api.github.com/repos/' + REPO, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.permissions || !j.permissions.push) { msg('That token can\'t publish to this site.'); return false; }
        store(KEY_TOKEN, t); var was = editing; stop(); target = null; ghost(); navbar(); if (was) start(); msg('Signed in. On this device the pen now writes lecture notes you can publish, on every chapter.'); return true;
      }, function () { msg('Could not reach GitHub.'); return false; });
  }
  function setupTeacher() { return teacher() ? Promise.resolve(true) : signIn(); }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function gh(path, token, body) {
    var url = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
    return fetch(url + '?ref=' + BRANCH, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cur) {
        var data = { message: 'Lecture notes: ' + path, content: b64(body), branch: BRANCH }; if (cur && cur.sha) data.sha = cur.sha;
        return fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { var e = new Error(j.message || ('GitHub said ' + r.status)); e.status = r.status; throw e; }); return r.json(); });
  }
  function publish() {
    if (!target || target === mine) return;
    var dir = SITE_DIR; if (!dir) return msg('This page does not know where it is published.');
    var token = store(KEY_TOKEN); if (!token) return msg('Sign in with the GitHub icon to publish.');
    var t = prompt('Title for these notes', target.title || target.id); if (t === null) return; target.title = t || target.id; save();
    msg('Publishing…');
    var ix = layers.filter(function (l) { return l.id !== target.id; }).concat([{ id: target.id, title: target.title, view: VIEW }]).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    gh(dir + '/ink/' + target.id + '.json', token, JSON.stringify(target))
      .then(function () { return gh(dir + '/ink/index.json', token, JSON.stringify({ layers: ix }, null, 1)); })
      .then(function () { layers = ix.slice().reverse(); msg('Published. Students see it in a minute or two.'); },
            function (err) { if (err.status === 401) store(KEY_TOKEN, ''); msg('Not published: ' + err.message); });
  }

  // ?lecture=1 (the editor home's Lecture button): teaching from this device, so the faint answers are off (Present)
  // and the pen is in hand. ?lecture=answers (its Answers link): the crib for a second screen, faint answers on.
  var LECT = (location.search.match(/[?&]lecture=(\w+)/) || [])[1];
  if (LECT === '1') store('eai-ink-ghost', false); else if (LECT === 'answers') store('eai-ink-ghost', true);
  ghost(); render(); buildBar(); navbar();
  if (LECT === '1') start();
  // one sign-in: a device signed in to the Book Editor (same site) uses that token here too, if it can publish to this repo
  if (!teacher() && window.indexedDB) try {
    var rq = indexedDB.open('ai2ai-book');
    rq.onupgradeneeded = function () { rq.transaction.abort(); };   // no editor on this device: don't create its database
    rq.onsuccess = function () {
      var db = rq.result; if (!db.objectStoreNames.contains('kv')) return db.close();
      var g = db.transaction('kv').objectStore('kv').get('remote');
      g.onsuccess = function () {
        db.close(); var c = g.result; if (!c || !c.token || c.api) return;
        fetch('https://api.github.com/repos/' + REPO, { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (!j || !j.permissions || !j.permissions.push || teacher()) return; store(KEY_TOKEN, c.token); var was = editing; stop(); target = null; ghost(); navbar(); if (was) start(); }, function () {});
      };
    };
  } catch (e) {}
  if (/(^|[#&])teach\b/.test(location.hash)) { start(); setupTeacher(); }
  else if (/(^|[#&])(lecture|pen)\b/.test(location.hash)) start();
  addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('textarea, input, select')) return;
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) { editing ? stop() : start(); }
    if (editing && (e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  });
  addEventListener('hashchange', function () { if (/(^|[#&])teach\b/.test(location.hash)) { start(); setupTeacher(); } });
}

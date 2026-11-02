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
  var PEN = [['#1155CC', 'blue'], ['#CC0000', 'red'], ['#38761D', 'green'], ['#674EA7', 'purple'], ['#DCB439', 'gold']];
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
  // penDown: a pen stroke is under way (Lecture mode ignores pinches meanwhile: on the iPad a palm resting beside the
  // Pencil reads as a second finger, and the "pinch" scaled the slide about a point between palm and pen, so the ink
  // landed off the tip, more so the further from that point; Eric, 2026-11-02). zoomGen goes up whenever the pages are
  // scaled or laid out at a new zoom, so a stroke reads the page's box again instead of trusting the one it started with.
  var penDown = false, zoomGen = 0, lectZoom = null;
  var teacher = function () { return !!store(KEY_TOKEN); };
  // iPadOS tells Pencil touches apart (touchType 'stylus'), so fingers keep Safari's own scrolling (with momentum) and
  // only the Pencil is stopped from scrolling. Elsewhere the pages lock touch while writing and fingers scroll by hand.
  var IOS = navigator.maxTouchPoints > 1 && /iPad|iPhone|Macintosh/.test(navigator.userAgent);
  // ?inkdebug (or #inkdebug): a red crosshair where the browser says the pen is, and the numbers the pen works from,
  // to find out on the iPad why ink can land off the tip (Eric, 2026-11-02; nothing like it reproduces in WebKit or
  // Chrome on a desktop). Screen only, never saved.
  var DEBUG = /[?&#]inkdebug\b/.test(location.search + location.hash), dbg = null;
  // Calibration (inkdebug): nine targets fixed on the screen; touch the centre of each with the Pencil and the box
  // lists where Safari said the touch was, plus the straight-line fit reported = a * target + b on each axis. That
  // measures the input error directly (a screenshot can't show where the Pencil tip was).
  if (DEBUG) (function () {
    var T = [], hits = [], box = null;
    function place() {
      T.forEach(function (t) { t.el.remove(); }); T = [];
      [0.12, 0.5, 0.88].forEach(function (fy) { [0.1, 0.5, 0.9].forEach(function (fx) {
        var x = Math.round(innerWidth * fx), y = Math.round(innerHeight * (0.18 + fy * 0.62)), el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:' + (x - 14) + 'px;top:' + (y - 14) + 'px;width:28px;height:28px;border:2px solid #0a0;border-radius:50%;pointer-events:none;z-index:9998;background:radial-gradient(circle,#0a0 0 2px,transparent 3px)';
        document.body.appendChild(el); T.push({ x: x, y: y, el: el });
      }); });
    }
    function fit(k) {
      var n = hits.length; if (n < 2) return '-';
      var mx = 0, my = 0; hits.forEach(function (h) { mx += h.t[k]; my += h.r[k]; }); mx /= n; my /= n;
      var sxy = 0, sxx = 0; hits.forEach(function (h) { sxy += (h.t[k] - mx) * (h.r[k] - my); sxx += (h.t[k] - mx) * (h.t[k] - mx); });
      var A = sxx ? sxy / sxx : 1, B = my - A * mx; return 'a ' + A.toFixed(4) + ' b ' + B.toFixed(1) + (Math.abs(A - 1) > 1e-3 ? ' (fixed point ' + (B / (1 - A)).toFixed(0) + ')' : '');
    }
    function show() {
      if (!box) { box = document.createElement('pre'); box.style.cssText = 'position:fixed;right:6px;bottom:6px;margin:0;padding:6px 8px;z-index:9999;pointer-events:none;font:11px/1.35 Menlo,monospace;background:rgba(255,255,255,.92);border:1px solid #0a0;color:#000'; document.body.appendChild(box); }
      box.textContent = 'touch the centre of each green target\n--zoom ' + getComputedStyle(document.documentElement).getPropertyValue('--zoom') + '  window ' + innerWidth + ' x ' + innerHeight + '\n'
        + hits.slice(-9).map(function (h) { return 'target ' + h.t[0] + ', ' + h.t[1] + '  said ' + h.r[0].toFixed(1) + ', ' + h.r[1].toFixed(1) + '  off ' + (h.r[0] - h.t[0]).toFixed(1) + ', ' + (h.r[1] - h.t[1]).toFixed(1) + '  ' + h.z; }).join('\n')
        + '\nx: ' + fit(0) + '\ny: ' + fit(1);
    }
    addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      var best = null, bd = 1e9; T.forEach(function (t) { var d = Math.hypot(t.x - e.clientX, t.y - e.clientY); if (d < bd) { bd = d; best = t; } });
      if (!best || bd > 150) return;
      var z = getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim();
      if (hits.length && hits[0].z !== z) hits = [];   // a new zoom starts a new fit
      hits.push({ t: [best.x, best.y], r: [e.clientX, e.clientY], z: z }); show();
    }, true);
    addEventListener('resize', place);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { place(); show(); }); else { place(); show(); }
  })();
  function debugShow(pg, ev, p, box, svgp) {
    if (!dbg) {
      dbg = document.createElement('div');
      dbg.innerHTML = '<div style="position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;pointer-events:none;z-index:9999;background:linear-gradient(red,red) center/1.5px 100% no-repeat,linear-gradient(red,red) center/100% 1.5px no-repeat"></div>'
        + '<pre style="position:fixed;left:6px;bottom:6px;margin:0;padding:6px 8px;z-index:9999;pointer-events:none;font:11px/1.35 Menlo,monospace;background:rgba(255,255,255,.92);border:1px solid #c00;color:#000;white-space:pre"></pre>';
      document.body.appendChild(dbg);
    }
    var x = dbg.firstChild, t = dbg.lastChild, r = pg.getBoundingClientRect(), v = window.visualViewport || {};
    x.style.left = ev.clientX + 'px'; x.style.top = ev.clientY + 'px';
    var f = function (n) { return n == null ? '-' : Math.round(n * 10) / 10; };
    t.textContent = 'pointer ' + ev.pointerType + '  client ' + f(ev.clientX) + ', ' + f(ev.clientY) + '  page ' + f(ev.pageX) + ', ' + f(ev.pageY)
      + '\nink at ' + f(p[0]) + ', ' + f(p[1]) + ' pt' + (svgp ? '   svg says ' + f(svgp[0]) + ', ' + f(svgp[1]) : '')
      + '\nbox ' + f(box.l) + ', ' + f(box.t) + '  k ' + (Math.round(box.k * 1e4) / 1e4) + '  rect ' + f(r.left) + ', ' + f(r.top) + ' w ' + f(r.width) + '  offsetW ' + pg.offsetWidth
      + '\noverlay ' + (function () { var o = pg.querySelector(':scope > svg.ink'), q = o && o.getBoundingClientRect(); return q ? f(q.left) + ', ' + f(q.top) + ' w ' + f(q.width) + ' h ' + f(q.height) + '  page h ' + f(r.height) + '  viewBox ' + o.getAttribute('viewBox') : '-'; })()
      + '\n--zoom ' + getComputedStyle(document.documentElement).getPropertyValue('--zoom') + '  page zoom ' + getComputedStyle(pg).zoom + '  book transform ' + (book.style.transform || 'none')
      + '\nviewport scale ' + f(v.scale) + '  offset ' + f(v.offsetLeft) + ', ' + f(v.offsetTop) + '  size ' + f(v.width) + ' x ' + f(v.height) + '  window ' + innerWidth + ' x ' + innerHeight
      + '\nscroll book ' + f(book.scrollLeft) + ', ' + f(book.scrollTop) + '  window ' + f(scrollX) + ', ' + f(scrollY) + '  dpr ' + devicePixelRatio;
  }
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
    // The view box is worked out from where the browser really put the overlay, so ink lands where the page says
    // whatever box the overlay got: on the iPad, zoomed slides drew it smaller than the page and centred (ink 7% off
    // towards the middle of the slide at 230%, Eric's calibration screenshots, 2026-11-02), while the page's own box and
    // the Pencil's position were right. Elsewhere this is the page box less its 1px border.
    var W = pgW(pg), r = rectOf(pg), k = W / (r.width || W), o = rectOf(svg);
    if (!o.width || !o.height) svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(r.height * k));
    else svg.setAttribute('viewBox', [(o.left - r.left) * k, (o.top - r.top) * k, o.width * k, o.height * k].map(function (v) { return Math.round(v * 100) / 100; }).join(' '));
    svg.setAttribute('preserveAspectRatio', 'none');
    return svg;
  }
  // Where an element really is on screen, in viewport px. Lecture pages are scaled with CSS zoom, and Safari reports a
  // zoomed element's getBoundingClientRect divided by its zoom (old WebKit zoom: the box comes back at the page's
  // unzoomed size, while pen events are in screen px), so ink landed off the tip once a slide was zoomed in, further off
  // the further from the corner of the window (Eric, 2026-11-02). Chrome reports screen px and is left alone.
  function rectOf(el) {
    var r = el.getBoundingClientRect(), z = 1;
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var v = parseFloat(getComputedStyle(e).zoom); if (v > 0) z *= v; }
    var pg = el.closest && el.closest('section.page');
    if (Math.abs(z - 1) < 0.001 || !pg || !el.offsetWidth || Math.abs(r.width - el.offsetWidth) > 0.75) return r;
    return { left: r.left * z, top: r.top * z, width: r.width * z, height: r.height * z, right: r.right * z, bottom: r.bottom * z };
  }
  function pgW(pg) { return window.Book && Book.pageW ? Book.pageW(pg) : (parseFloat(getComputedStyle(pg).width) > 700 ? 720 : 432); }   // the page's width in pt (Lecture pages are 720)
  function toPt(pg, e) { var r = rectOf(pg), k = pgW(pg) / r.width; return [r1((e.clientX - r.left) * k), r1((e.clientY - r.top) * k), Math.round((e.pressure > 0 ? e.pressure : 0.5) * 100) / 100]; }
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
      + (teacher() ? '<span class="who">Instructor: this device can publish lecture notes</span><button type="button" data-g="out">Sign out on this device</button>'
                   : '<button type="button" data-g="in">Instructor sign-in…</button>') + '</div>';
    gh.addEventListener('click', function (e) {
      var g = e.target.getAttribute && e.target.getAttribute('data-g'); if (!g) return;
      if (g === 'in') { gh.open = false; signIn(); }
      if (g === 'out' && confirm('Sign out? This device will no longer be able to publish lecture notes.')) { store(KEY_TOKEN, ''); stop(); target = null; ghost(); navbar(); }
    });
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
  // the editor's preview columns (grid=1) always show them: Present is for the room, not for editing
  function ghost() { document.documentElement.classList.toggle('ink-ghost', /[?&]grid=1/.test(location.search) || (teacher() && VIEW === 'slides' && !/[?&]lecture=1/.test(location.search))); }   // ?lecture=1 (the editor home's Lecture button): presenting, so hidden

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
  function save() { clearTimeout(saveSoon.t); if (target === mine) store(KEY_MINE, mine); else if (target) store(KEY_DRAFT + target.id, target); }
  // after a stroke: written to this browser's storage a moment later (the notes are one JSON blob, and writing it as
  // the pen lifts made the start of the next stroke stutter); leaving the page writes it at once
  function saveSoon() { clearTimeout(saveSoon.t); saveSoon.t = setTimeout(save, 600); }
  addEventListener('pagehide', function () { if (saveSoon.t) save(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && saveSoon.t) save(); });
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
    if (teacher() && VIEW === 'slides' && /[?&]lecture=1/.test(location.search)) h += '<span class="pres" title="Opened from the Lecture button: the faint answers are hidden, safe to mirror to the projector">Presenting</span>';
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
  function currentPage() { var best = null, bd = 1e9; pages().forEach(function (p) { var r = rectOf(p), d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < bd) { bd = d; best = p; } }); return best; }
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
    // The page's box is read once per stroke (and again only if something scrolls), not on every pen event: reading it
    // after the stroke was redrawn made the browser lay the page out again for each event (2026-11-01, Eric: "still
    // isn't as smooth as Notability's").
    var box = null, onScroll = function () { box = null; };
    if (tool !== 'laser') { penDown = true; if (lectZoom) lectZoom.cancel(); }
    addEventListener('scroll', onScroll, true);
    function pt(q) {
      if (!box || box.g !== zoomGen) { var r = rectOf(pg); box = { l: r.left, t: r.top, k: pgW(pg) / r.width, g: zoomGen }; }
      return [r1((q.clientX - box.l) * box.k), r1((q.clientY - box.t) * box.k), 0.5];
    }
    // speed-aware smoothing: slow, wobbly movement is averaged out a little, fast movement passes straight through
    function smooth(p) {
      raw = p; if (!sm) { sm = p.slice(); return p; }
      var dx = p[0] - sm[0], dy = p[1] - sm[1], a = Math.min(1, 0.35 + Math.sqrt(dx * dx + dy * dy) / 4);
      sm[0] += a * dx; sm[1] += a * dy; return [r1(sm[0]), r1(sm[1]), p[2]];
    }
    // One path for the whole stroke, rewritten each frame. (2026-11-01 to 11-02 a long stroke was drawn as a chain of
    // short paths joined on lift: on the iPad only the end of each stroke was left on screen, Eric 2026-11-02.)
    function frame() { queued = false; if (el) paint(el, cur, tail); }
    // where the pen will be a frame from now: the browser's guess if it has one (Chrome), else ours from the last speed
    var last = null, prev = null;
    function ahead(ev) {
      var pr = ev.getPredictedEvents ? ev.getPredictedEvents() : [];
      if (pr.length) return pt(pr[pr.length - 1]);
      if (!last || !prev || last.t - prev.t <= 0) return last ? last.p : null;
      var dt = Math.min(16, (last.t - prev.t) * 2), vx = (last.p[0] - prev.p[0]) / (last.t - prev.t), vy = (last.p[1] - prev.p[1]) / (last.t - prev.t);
      var dx = vx * dt, dy = vy * dt, d = Math.sqrt(dx * dx + dy * dy); if (d > 6) { dx *= 6 / d; dy *= 6 / d; }
      return [r1(last.p[0] + dx), r1(last.p[1] + dy), 0.5];
    }
    if (tool === 'laser') { laser = laser || document.createElement('div'); laser.className = 'ink-laser'; document.body.appendChild(laser); laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; }
    else if (tool !== 'erase') {
      cur = { p: pg.id, c: tool === 'hl' ? HL : color, w: tool === 'hl' ? 11 : width, pts: [smooth(pt(e))] }; if (tool === 'hl') cur.o = 0.35;
      el = drawStroke(cur);
    }
    function move(ev) {
      if (ev.pointerId !== e.pointerId) return;
      var es = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; if (!es.length) es = [ev];
      if (tool === 'laser') { laser.style.left = ev.clientX + 'px'; laser.style.top = ev.clientY + 'px'; return; }
      es.forEach(function (q) {
        var p = pt(q);
        prev = last; last = { p: p, t: q.timeStamp || ev.timeStamp };
        if (tool === 'erase') {   // only your own strokes can be erased
          target.strokes.filter(function (s) { return s.p === pg.id && near(s, p[0], p[1], 6); }).forEach(function (s) {
            target.strokes.splice(target.strokes.indexOf(s), 1); erased.push(s);
            [].forEach.call(svg.querySelectorAll('path'), function (pp) { if (pp._s === s) pp.remove(); });
          });
        } else { var f = smooth(p), l = cur.pts[cur.pts.length - 1]; if (Math.abs(l[0] - f[0]) + Math.abs(l[1] - f[1]) >= 0.35) cur.pts.push(f); }
      });
      if (!cur) return;
      if (DEBUG) { var dp = pt(ev), sp = null; try { var m = svg.getScreenCTM().inverse(), q0 = svg.createSVGPoint(); q0.x = ev.clientX; q0.y = ev.clientY; q0 = q0.matrixTransform(m); sp = [q0.x, q0.y]; } catch (x) {} debugShow(pg, ev, dp, box, sp); }
      tail = ahead(ev);   // draw ahead to where the pen is about to be, so the line keeps up with the tip
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }
    function up(ev) {
      if (ev && ev.pointerId !== e.pointerId) return;
      pg.removeEventListener('pointermove', move); pg.removeEventListener('pointerup', up); pg.removeEventListener('pointercancel', up);
      removeEventListener('scroll', onScroll, true); penDown = false;
      if (tool === 'laser') { if (laser) laser.remove(); laser = null; return; }
      if (cur && cur.pts.length) {
        var l = cur.pts[cur.pts.length - 1]; if (raw && cur.pts.length > 1 && (raw[0] !== l[0] || raw[1] !== l[1])) cur.pts.push(raw);
        tail = null; paint(el, cur);
        target.strokes.push(cur); undo.push({ stroke: cur, el: el });
      }
      if (erased.length) undo.push({ erased: erased });
      saveSoon();
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
    function move(ev) { if (ev.pointerId !== e.pointerId) return; (document.documentElement.classList.contains('lect') ? book : window).scrollBy(x - ev.clientX, y - ev.clientY); x = ev.clientX; y = ev.clientY; }
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

  // Lecture mode (?lecture=…, the editor home's Lecture and answers links): no navbar, just the pen bar at the top, and
  // the pages scroll in their own box under it, so a pinch (two fingers, trackpad pinch, ctrl+wheel, Cmd +/-/0) zooms
  // the pages only and the pen bar stays put at its size. The zoom is remembered on this device.
  function lectureZoom() {
    var H = document.documentElement, KEY = 'ai2ai-lect-zoom', k = 1;
    try { k = +localStorage.getItem(KEY) || 1; } catch (x) {}
    H.classList.add('lect');
    // Safari's own page zoom must never happen here: it zooms the pen bar too and throws the pen off its mark. Block it in
    // the viewport (Chrome, home-screen apps) and in CSS (book.css: double tap), and if it happens anyway (Safari may
    // ignore both), put the page back at scale 1 by rewriting the viewport tag, which makes Safari re-apply it.
    var vp = document.querySelector('meta[name=viewport]');
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
    var VP = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    vp.setAttribute('content', VP);
    function unzoom() {
      var v = window.visualViewport; if (!v || v.scale < 1.01) return;
      vp.setAttribute('content', VP.replace('initial-scale=1', 'initial-scale=0.99'));
      setTimeout(function () { vp.setAttribute('content', VP); window.scrollTo(0, 0); }, 30);
    }
    if (window.visualViewport) { var ut = 0; visualViewport.addEventListener('resize', function () { clearTimeout(ut); ut = setTimeout(unzoom, 250); }); }
    addEventListener('gestureend', function () { setTimeout(unzoom, 300); });
    function fit() { var pg = book.querySelector('section.page'), W = window.Book && Book.pageW ? Book.pageW(Book.view) : pg ? pgW(pg) : 432; return Math.min(1, (innerWidth - 32) / (W * 4 / 3)); }   // the view's own fit-the-width zoom (view.html)
    window.eaiZoomK = k;
    function apply() { H.style.setProperty('--zoom', +(fit() * k).toFixed(4)); zoomGen++; pages().forEach(function (p) { if (p.querySelector(':scope > svg.ink')) overlay(p); }); }
    function pageAt(x, y) {   // the page nearest a point, and where in it the point is (fractions), to keep it under the fingers
      var best = null, bd = Infinity;
      [].forEach.call(book.querySelectorAll('section.page'), function (p) {
        var r = rectOf(p); if (!r.height) return;
        var d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = { p: p, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }; }
      });
      return best;
    }
    function zoomTo(nk, x, y) {
      nk = Math.max(0.4, Math.min(4, nk)); if (Math.abs(nk - k) < 0.002) return;
      var a = pageAt(x, y); k = nk; window.eaiZoomK = k; apply();
      if (a) { var r = rectOf(a.p); book.scrollLeft += r.left + a.fx * r.width - x; book.scrollTop += r.top + a.fy * r.height - y; }
      clearTimeout(zoomTo.t); zoomTo.t = setTimeout(function () { try { localStorage.setItem(KEY, String(+k.toFixed(3))); } catch (x) {} }, 300);
    }
    // While the fingers move, the pages are only scaled as a picture (a transform the GPU does, nothing is laid out
    // again); the real zoom, which lays every page out at the new size, happens once when the pinch ends, with the point
    // under the fingers kept under them (2026-11-01, Eric: zooming and panning in the presenting view were laggy).
    var raf = 0, live = null;
    function soon(nk, x, y, slide) {
      nk = Math.max(0.4, Math.min(4, nk));
      if (!live) {
        var r = book.getBoundingClientRect();
        live = { x0: x, y0: y, a: pageAt(x, y) }; H.classList.add('lect-zooming');
        book.style.transformOrigin = (x - r.left) + 'px ' + (y - r.top) + 'px';
      }
      live.nk = nk; live.x = x; live.y = y; live.slide = !!slide;
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0; if (!live) return;
        var tx = live.slide ? live.x - live.x0 : 0, ty = live.slide ? live.y - live.y0 : 0;
        book.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + (live.nk / k) + ')'; zoomGen++;
      });
      clearTimeout(soon.t); soon.t = setTimeout(commit, 200);   // a trackpad or ctrl+wheel pinch has no end event
    }
    function commit() {
      clearTimeout(soon.t); if (!live) return;
      var L = live; live = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      book.style.transform = ''; book.style.transformOrigin = ''; H.classList.remove('lect-zooming'); zoomGen++;
      if (Math.abs(L.nk - k) >= 0.002) { k = L.nk; window.eaiZoomK = k; apply(); try { localStorage.setItem(KEY, String(+k.toFixed(3))); } catch (x) {} }
      if (L.a) { var r = rectOf(L.a.p); book.scrollLeft += r.left + L.a.fx * r.width - L.x; book.scrollTop += r.top + L.a.fy * r.height - L.y; }
    }
    // the pen came down: a pinch under way was a palm, not a zoom, so put the pages back as they were, and ignore the
    // rest of that gesture (and any gesture while the pen is down)
    var blocked = false;
    function cancel() {
      clearTimeout(soon.t); if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (live) { live = null; book.style.transform = ''; book.style.transformOrigin = ''; H.classList.remove('lect-zooming'); zoomGen++; }
      blocked = true; t0 = null;
    }
    lectZoom = { cancel: cancel };
    var t0 = null;
    var g0 = 1;   // Safari (iPad, Mac trackpad): gesture events carry the pinch scale
    var page = false;   // the page itself is zoomed (Safari): let this pinch go to Safari so it can zoom back out
    function pageZoomed() { return !!(window.visualViewport && visualViewport.scale > 1.01); }
    addEventListener('gesturestart', function (e) { page = pageZoomed(); if (page) return; e.preventDefault(); g0 = k; blocked = penDown; }, { passive: false });
    addEventListener('gesturechange', function (e) { if (page) return; e.preventDefault(); if (blocked || penDown) return; soon(g0 * e.scale, e.clientX || innerWidth / 2, e.clientY || innerHeight / 2); }, { passive: false });
    addEventListener('gestureend', function (e) { if (!page) { e.preventDefault(); if (!blocked) commit(); } page = false; blocked = false; }, { passive: false });
    if (!('ongesturestart' in window)) {   // other touch screens: two fingers
      var dist = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); };
      addEventListener('touchstart', function (e) { if (e.touches.length === 2 && !penDown) { t0 = { d: dist(e.touches), k: k }; blocked = false; } }, { passive: true });
      addEventListener('touchmove', function (e) { if (!t0 || e.touches.length !== 2 || penDown) return; e.preventDefault(); soon(t0.k * dist(e.touches) / t0.d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2, true); }, { passive: false });
      addEventListener('touchend', function (e) { if (e.touches.length < 2 && t0) { t0 = null; commit(); } });
    }
    addEventListener('wheel', function (e) { if (!e.ctrlKey) return; e.preventDefault(); soon((live ? live.nk : k) * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); }, { passive: false });   // trackpad pinch in Chrome, ctrl+wheel
    addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || !/^(=|\+|-|0)$/.test(e.key)) return; e.preventDefault();
      var r = book.getBoundingClientRect();
      zoomTo(e.key === '0' ? 1 : k * (e.key === '-' ? 1 / 1.15 : 1.15), r.left + r.width / 2, r.top + r.height / 2);
    });
    addEventListener('resize', function () { zoomGen++; setTimeout(apply, 0); });   // after the view's own resize handler
    apply(); setTimeout(apply, 0);
  }
  // ?lecture=1 (the editor home's Lecture button): teaching from this device: the pen in hand, the faint answers hidden
  // (see ghost). The plain Lecture view (its answers link) shows them to the signed-in instructor.
  var LECT = (location.search.match(/[?&]lecture=(\w+)/) || [])[1];
  ghost(); render(); buildBar(); navbar();
  if (LECT) lectureZoom();
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

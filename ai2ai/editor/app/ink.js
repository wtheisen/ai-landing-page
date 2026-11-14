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
// "o":0.35?,"f":"<blank>"?,"pts":[[x,y,pressure],…]}],"code":{"<b-code data-b>":{"p":"page-id","src"?,"out"?,"err"?,"figs"?}}},
// coordinates in points from the page's top-left (a page is 432 pt wide). "f" tags a fill-in blank's handwriting (the iPad
// app's blank pads: the blank's data-b block and its index there, "bx12#0"). "code" holds what the instructor ran in
// lecture (an edited cell's source, its output, its plots: base64 PNGs in the draft, site paths once published), put
// back on the page with the notes and drawn into the notes PDF (Eric, 2026-11-10).
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
  // The draft is kept per chapter: the editor's Lecture view (/ai2ai/editor/view/<slug>) has the same DIR for every
  // chapter, so two chapters lectured on one day shared a draft. SITE_DIR names the chapter; on the published page it
  // gives the same key as before.
  var HOME = SITE_DIR ? '/' + SITE_DIR.replace(/^\/|\/$/g, '') + '/' : DIR;
  var KEY_TOKEN = 'eai-ink-token', KEY_MINE = 'eai-ink-mine:' + DIR + VIEW, KEY_DRAFT = 'eai-ink-draft:' + HOME + VIEW + ':', KEY_OLD = 'eai-ink-draft:' + DIR + VIEW + ':';
  var viewOf = function (l) { return l.view || 'slides'; };
  var pub = null, layers = [], mine = null, target = null, prep = null, editing = false, tool = 'hand', color = PEN[0][0], width = 1.4, undo = [];
  var store = function (k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  // penDown: a pen stroke is under way (Lecture mode ignores pinches meanwhile: on the iPad a palm resting beside the
  // Pencil reads as a second finger, and the "pinch" scaled the slide about a point between palm and pen, so the ink
  // landed off the tip, more so the further from that point; Eric, 2026-11-02). zoomGen goes up whenever the pages are
  // scaled or laid out at a new zoom, so a stroke reads the page's box again instead of trusting the one it started with.
  var penDown = false, zoomGen = 0, lectZoom = null, lectK = 1, scrollBox = null;   // lectK: the lecture's zoom scale on #book (lectureZoom), scrollBox: the box that scrolls
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
      + '\nscroll book ' + f((scrollBox || book).scrollLeft) + ', ' + f((scrollBox || book).scrollTop) + '  window ' + f(scrollX) + ', ' + f(scrollY) + '  dpr ' + devicePixelRatio;
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
  // Safari on the iPad hands some pen samples over twice (a pointermove's coalesced events repeat ones already seen),
  // so a stroke stepped forward, jumped a point or two back and replayed the same stretch: drawn as tiny reversals,
  // which Preview shows as a jagged line with white slivers (Eric, 2026-11-10, a notes PDF of Nov 2 strokes). move()
  // now skips samples it has had; tidy() drops such short back-steps from strokes already saved, wherever one is drawn.
  // A real sharp turn is kept: only a short step that turns back (over 120°) onto ink already laid, or under 1.2 pt, goes.
  function tidy(p) {
    if (p.length < 3) return p;
    var out = [p[0]];
    function nearPath(c) {   // within 0.8 pt of the stroke drawn so far (its last 24 points, not the newest segment)
      for (var j = Math.max(1, out.length - 24); j < out.length - 1; j++) {
        var a = out[j - 1], b = out[j], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        var t = L ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L)) : 0, ex = a[0] + t * dx - c[0], ey = a[1] + t * dy - c[1];
        if (ex * ex + ey * ey <= 0.64) return true;
      }
      return false;
    }
    for (var i = 1; i < p.length; i++) {
      var c = p[i], b = out[out.length - 1], vx = c[0] - b[0], vy = c[1] - b[1], lv = Math.sqrt(vx * vx + vy * vy);
      if (lv < 0.3) continue;
      if (out.length > 1 && lv < 3) {   // turning back over a short step onto ink already laid: a replayed sample
        var a = out[out.length - 2], ux = b[0] - a[0], uy = b[1] - a[1], lu = Math.sqrt(ux * ux + uy * uy);
        if (lu > 0 && (ux * vx + uy * vy) / (lu * lv) < -0.5 && nearPath(c)) continue;
        if (lu > 0 && (ux * vx + uy * vy) / (lu * lv) < -0.5 && lv < 1.2) continue;
      }
      out.push(c);
    }
    return out;
  }
  function paint(el, s, tail) {
    var pts = tidy(s.pts);
    el.setAttribute('d', pathD(tail ? pts.concat([tail]) : pts));
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', s.c); el.setAttribute('stroke-width', s.o ? s.w : r1(s.w * 1.6));
  }

  // ---------------------------------------------------------------- pages and overlays
  // the pages this view shows: the editor's viewer (view.html) holds every page of the chapter and hides the other
  // editions', so counting them all never matched the view's PDF there (notes PDFs from the Lecture button failed)
  function pages() { return [].slice.call(book.querySelectorAll('section.page')).filter(function (p) { return p.classList.contains('ink-blank') || getComputedStyle(p).display !== 'none'; }); }
  function overlay(pg) {
    var svg = pg.querySelector(':scope > svg.ink');
    if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ink'); svg.setAttribute('aria-hidden', 'true'); pg.appendChild(svg); }
    // The view box is worked out from where the browser really put the overlay, so ink lands where the page says
    // whatever box the overlay got: on the iPad, zoomed slides drew it smaller than the page and centred (ink 7% off
    // towards the middle of the slide at 230%, Eric's calibration screenshots, 2026-11-02), while the page's own box and
    // the Pencil's position were right. Elsewhere this is the page box less its 1px border.
    var W = pgW(pg), r = rectOf(pg), k = W / (r.width || W), o = rectOf(svg);
    if (!o.width || !o.height) svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(r.height * k));
    else svg.setAttribute('viewBox', [(o.left - r.left) * k, (o.top - r.top) * k, o.width * k, o.height * k].map(function (v) { return Math.round(v * 1e4) / 1e4; }).join(' '));
    // keep the default preserveAspectRatio (the view box has the box's own shape, so it fits exactly): "none" made the
    // scale a hair non-uniform, and Safari then drew thick strokes with white slivers where they turn back (Eric, 2026-11-02)
    svg.removeAttribute('preserveAspectRatio');
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
    if (Math.abs(z - 1) < 0.001 || !pg || !el.offsetWidth || Math.abs(r.width - el.offsetWidth * lectK) > 0.75) return r;   // lectK: Lecture mode's scale, which old WebKit keeps
    return { left: r.left * z, top: r.top * z, width: r.width * z, height: r.height * z, right: r.right * z, bottom: r.bottom * z };
  }
  function pgW(pg) { return window.Book && Book.pageW ? Book.pageW(pg) : (parseFloat(getComputedStyle(pg).width) > 700 ? 720 : 432); }   // the page's width in pt (Lecture pages are 720)
  function toPt(pg, e) { var r = rectOf(pg), k = pgW(pg) / r.width; return [r1((e.clientX - r.left) * k), r1((e.clientY - r.top) * k), Math.round((e.pressure > 0 ? e.pressure : 0.5) * 100) / 100]; }
  function drawStroke(s) {
    var pg = document.getElementById(s.p); if (!pg) return null;
    var el = document.createElementNS(NS, 'path'); paint(el, s);
    if (s.o && s.o < 1) el.setAttribute('opacity', s.o);
    if (s.n) el.setAttribute('class', 'ink-note');
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
    if (prep) prep.strokes.forEach(drawStroke);   // private notes under the lecture's ink
    [pub, mine].forEach(function (l) { if (l) (l.strokes || []).forEach(drawStroke); });
    pages().forEach(overlay);
    applyCode();
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
  // Only the answers link (?lecture=answers, signed in) and the editor's previews show them: on the plain Lecture page
  // they sat under the instructor's own published ink and the two overlapped (Eric, 2026-11-03).
  function ghost() { document.documentElement.classList.toggle('ink-ghost', /[?&]grid=1/.test(location.search) || (teacher() && VIEW === 'slides' && /[?&]lecture=answers\b/.test(location.search))); }

  // ---------------------------------------------------------------- writing
  var bar = null, laser = null, last = { t: 'pen', c: PEN[0][0] };
  var SVG = function (d, extra) { return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>'; };
  var I = {
    pdf: SVG('<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M3 13.5h10"/>'),
    eye: SVG('<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.2 8s2.5-4.6 6.8-4.6S14.8 8 14.8 8s-2.5 4.6-6.8 4.6S1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'),
    hand: SVG('<path fill="currentColor" d="M3.5 1.8l9 5.2-4 1 2.3 4.3-1.7.9L6.8 8.9 3.9 11.6z"/>'),
    hl: SVG('<path fill="#F1C232" d="M5 10.5l5.6-7.6 2.6 1.9-5.6 7.6H5z"/><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M5 10.5l5.6-7.6 2.6 1.9-5.6 7.6H5zM3 14.5h6"/>'),
    erase: SVG('<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.5 10.2l6.7-6.7 4.3 4.3-5.2 5.2H5.8zM6 6.7l4.3 4.3M8.3 13h5.2"/>'),
    laser: SVG('<circle cx="8" cy="8" r="3" fill="#ff2a2a"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="#ff2a2a" stroke-opacity=".35" stroke-width="1.5"/>'),
    undo: SVG('<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M5.5 3.5l-3 3 3 3M2.5 6.5H10a3.5 3.5 0 010 7H7"/>'),
    page: SVG('<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M3.5 1.5h6l3 3v10h-9z"/><path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 7v5M5.5 9.5h5"/>') };
  // ---------------------------------------------------------------- colour wheel (Lecture mode)
  // A ring of the pen bar's tools around the pen, so a colour is one tap away without reaching for the bar (Eric,
  // 2026-11-12). Opened in Lecture mode (?lecture=…) by holding the pen still on a slide for half a second, or in the
  // iPad presenting app (ios/) by a double tap (or squeeze) of the Pencil, which the app passes in as an 'eai-pencil'
  // event on window ({detail: {x, y}} in window px when the Pencil knows where it is). A second double tap, a tap
  // outside, the middle or Escape closes it.
  var wheel = null, penAt = null;   // penAt: where the pen last was, in window px (the wheel opens there when the event has no place)
  var NATIVE = !!window.eaiNativeApp, NATIVE_INK = false;   // NATIVE_INK: the app draws the Pencil and scrolls (nativeInk), set at startup
  function native(m) { if (NATIVE) try { window.webkit.messageHandlers.eai.postMessage(m); } catch (x) {} }
  function wheelItems() {
    return PEN.map(function (p) { return { t: 'pen', c: p[0], name: p[1] + ' pen' }; })
      .concat([{ t: 'hl', name: 'highlighter', i: I.hl }, { t: 'erase', name: 'eraser', i: I.erase }, { t: 'laser', name: 'laser pointer', i: I.laser }]);
  }
  function closeWheel() { if (wheel) { wheel.remove(); wheel = null; } }
  function openWheel(x, y) {
    closeWheel();
    if (x == null || y == null) { x = penAt ? penAt.x : innerWidth / 2; y = penAt ? penAt.y : innerHeight / 2; }
    var R = 92, R0 = 34, items = wheelItems(), n = items.length, step = 2 * Math.PI / n, pad = R + 10;
    x = Math.max(pad, Math.min(innerWidth - pad, x)); y = Math.max(pad, Math.min(innerHeight - pad, y));
    var P = function (a, r) { return (R + r * Math.cos(a)).toFixed(2) + ' ' + (R + r * Math.sin(a)).toFixed(2); };
    var svg = '', marks = '';
    items.forEach(function (it, i) {
      var a0 = -Math.PI / 2 - step / 2 + i * step, a1 = a0 + step, am = a0 + step / 2;
      var on = editing && it.t === tool && (!it.c || it.c === color);
      svg += '<path d="M' + P(a0, R0) + 'L' + P(a0, R - 2) + 'A' + (R - 2) + ' ' + (R - 2) + ' 0 0 1 ' + P(a1, R - 2) + 'L' + P(a1, R0) + 'A' + R0 + ' ' + R0 + ' 0 0 0 ' + P(a0, R0) + 'Z"'
        + ' fill="' + (it.c || '#f4f4f4') + '" stroke="#fff" stroke-width="3"/>';
      if (on) svg += '<path d="M' + P(a0 + 0.06, R + 4) + 'A' + (R + 4) + ' ' + (R + 4) + ' 0 0 1 ' + P(a1 - 0.06, R + 4) + '" fill="none" stroke="#002B5B" stroke-width="5" stroke-linecap="round"/>';
      if (it.i) { var c = P(am, (R + R0) / 2).split(' '); marks += '<span style="position:absolute;left:' + (+c[0] - 8) + 'px;top:' + (+c[1] - 8) + 'px;width:16px;height:16px;transform:scale(1.4)">' + it.i + '</span>'; }
    });
    svg += '<circle cx="' + R + '" cy="' + R + '" r="' + (R0 - 4) + '" fill="#fff" stroke="#ccc"/><path d="M' + (R - 7) + ' ' + (R - 7) + 'l14 14m0-14l-14 14" stroke="#777" stroke-width="2" stroke-linecap="round"/>';
    wheel = document.createElement('div'); wheel.className = 'ink-wheel';
    wheel.style.cssText = 'position:fixed;inset:0;z-index:95;touch-action:none';
    wheel.innerHTML = '<div style="position:absolute;left:' + (x - R) + 'px;top:' + (y - R) + 'px;width:' + 2 * R + 'px;height:' + 2 * R + 'px;border-radius:50%;box-shadow:0 4px 18px rgba(0,0,0,.25);color:#333">'
      + '<svg width="' + 2 * R + '" height="' + 2 * R + '" style="display:block;overflow:visible">' + svg + '</svg>' + marks + '</div>';
    document.body.appendChild(wheel);
    // a tap on a wedge picks it; anywhere else (outside, the middle) just closes. Decided on pointerdown so the tap
    // never reaches the slide underneath (no stray dot, no Run button pressed).
    wheel.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var dx = e.clientX - x, dy = e.clientY - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < R0 || d > R + 6) return closeWheel();
      var i = Math.floor((((Math.atan2(dy, dx) + Math.PI / 2 + step / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / step) % n;
      pickTool(items[i]);
    });
    native({ haptic: 'open' });
  }
  function pickTool(it) {
    tool = it.t; if (it.c) color = it.c; if (tool !== 'laser') last = { t: tool, c: color };
    closeWheel(); start(); barState(); native({ haptic: 'pick' });
  }
  addEventListener('eai-pencil', function (e) { if (!LECT || NATIVE_INK) return; var d = e.detail || {}; if (wheel) closeWheel(); else openWheel(d.x, d.y); });
  addEventListener('keydown', function (e) { if (wheel && e.key === 'Escape') closeWheel(); });
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function save() {
    clearTimeout(saveSoon.t);
    var k = target === mine ? KEY_MINE : target ? KEY_DRAFT + target.id : null, v = target === mine ? mine : target; if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { msg('This device is out of room for these notes (plots take space): publish soon, or the newest strokes and runs may be lost.'); }
  }
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
      target = store(KEY_DRAFT + id) || oldDraft(id) || { id: id, title: title, view: VIEW, pages: [], strokes: [] };
      pub = target; render();
    } else target = mine;
  }
  // a draft kept under the old key (before drafts were per chapter): only what belongs to this chapter's pages
  function oldDraft(id) {
    if (KEY_OLD === KEY_DRAFT) return null;
    var d = store(KEY_OLD + id); if (!d) return null;
    var here = function (pid) { return !!document.getElementById(pid); };
    d.strokes = (d.strokes || []).filter(function (s) { return here(s.p); }); d.pages = (d.pages || []).filter(function (b) { return here(b.after); });
    return d.strokes.length || d.pages.length ? d : null;
  }

  // ---------------------------------------------------------------- code run in lecture
  // In Lecture mode (?lecture=…) the signed-in instructor's runs go into today's notes: what the cell held when it ran
  // (if edited), what it printed and drew, what its code blanks were filled in with and the colours written on it (the
  // iPad app). A run that gives back exactly the stored cell drops out again, and so does Reset. They are published with the ink and put back on the page wherever these notes are shown.
  function codeKey(block) {
    var b = block.getAttribute('data-b'); if (b) return b;
    var pg = block.closest('section.page'), all = pg ? [].slice.call(pg.querySelectorAll('b-code')) : [];
    return (pg ? pg.id : '') + ':' + all.indexOf(block);
  }
  function blockFor(key) {
    var hit = null; [].some.call(book.querySelectorAll('b-code'), function (b) { if (codeKey(b) === key) { hit = b; return true; } }); return hit;
  }
  book.addEventListener('eai-run', function (e) {
    if (!LECT || !teacher()) return;
    var block = e.target.closest && e.target.closest('b-code'), d = e.detail || {}; if (!block) return;
    var pg = block.closest('section.page'); if (!pg) return;
    ensureTarget(); if (!target || target === mine) return;
    var code = target.code || (target.code = {}), key = codeKey(block), c = code[key] || { p: pg.id };
    if (d.reset) delete code[key];
    else {
      if (d.src != null) { if (d.src !== d.original) c.src = d.src; else delete c.src; }
      if (!d.edit) { c.out = d.out || ''; if (d.err) c.err = true; else delete c.err; if (d.figs && d.figs.length) c.figs = d.figs.slice(); else delete c.figs; }
      // what its code blanks were filled in with, and the colours written in (book.js: every report has them as they are now)
      if (d.fills) c.fills = d.fills; else delete c.fills;
      if (d.marks) c.marks = d.marks; else delete c.marks;
      // nothing to keep: the cell's own source and either no run yet or a run that printed just what the page has
      var outSame = c.out == null || (!c.err && !c.figs && !d.stored && c.out === (d.printed || ''));
      if (c.src == null && outSame && !c.fills && !c.marks) delete code[key]; else code[key] = c;
    }
    applied[key] = !!code[key];
    save(); barState();
  });
  // put a layer's runs on the page (pub: the notes being shown; the instructor's draft while drafting)
  var applied = {};
  function applyCode() {
    var code = (pub && pub.code) || {};
    Object.keys(applied).forEach(function (k) { if (!code[k]) { var b = blockFor(k); if (b && b._eaiLive) b._eaiLive(null); delete applied[k]; } });
    Object.keys(code).forEach(function (k) { var b = blockFor(k); if (b && b._eaiLive) { b._eaiLive(code[k]); applied[k] = true; } });
  }
  document.addEventListener('eai-run-ready', function () { applyCode(); });

  // the pen bar: a second row under the navbar, always there. The arrow uses the page normally; any pen starts writing.
  function buildBar() {
    if (!nav || bar) return;
    var head = document.createElement('header'); head.className = 'chap-head web-only';
    nav.parentNode.insertBefore(head, nav); head.appendChild(nav);
    bar = document.createElement('div'); bar.className = 'ink-sub'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Pen');
    bar.innerHTML = '<span class="grp"><button data-t="hand" title="use the page: scroll, click figures and Run buttons (L toggles)">' + I.hand + '</button></span>'
      + '<span class="grp">' + PEN.map(function (p) { return '<button data-t="pen" data-c="' + p[0] + '" title="' + p[1] + ' pen" class="sw" style="--c:' + p[0] + '"><i></i></button>'; }).join('')
      + '<button data-t="hl" title="highlighter">' + I.hl + '</button><button data-t="erase" title="eraser (your own ink)">' + I.erase + '</button><button data-t="laser" title="laser pointer (not saved)">' + I.laser + '</button></span>'
      + '<span class="grp">' + [1.15, 1.4, 2.2].map(function (v, i) { return '<button data-w="' + v + '" title="' + ['thin', 'medium', 'thick'][i] + '" class="wd' + (v === width ? ' on' : '') + '"><i style="--d:' + (3 + i * 2.5) + 'px"></i></button>'; }).join('') + '</span>'
      + '<span class="grp"><button data-a="undo" title="undo (⌘Z)">' + I.undo + '</button><button data-a="blank" title="add a blank page after this one">' + I.page + '</button><button data-a="pdf" title="download this view as a PDF with the notes showing">' + I.pdf + '</button></span>'
      + '<span class="spacer"></span><span class="ink-msg"></span><span class="right"></span>';
    head.appendChild(bar);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t === 'hand') stop();
      else if (b.dataset.t) { tool = b.dataset.t; if (b.dataset.c) color = b.dataset.c; if (tool !== 'laser') last = { t: tool, c: color }; start(); }
      if (b.dataset.w) width = +b.dataset.w;
      if (b.dataset.a === 'undo') { ensureTarget(); doUndo(); }
      if (b.dataset.a === 'blank') { ensureTarget(); addBlank(); }
      if (b.dataset.a === 'pdf') notesPDF();
      if (b.dataset.a === 'clear' && confirm('Erase all of your notes in this chapter (this view)?')) { mine.strokes = []; mine.pages = []; undo = []; store(KEY_MINE, mine); render(); }
      if (b.dataset.a === 'publish') { ensureTarget(); publish(); }
      if (b.dataset.a === 'report') report();
      if (b.dataset.a === 'home') { save(); native({ home: true }); }
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
    nativeState();
    if (!bar) return;
    var cur = editing ? tool : 'hand';
    [].forEach.call(bar.querySelectorAll('[data-t]'), function (x) { x.classList.toggle('on', x.dataset.t === cur && (!x.dataset.c || x.dataset.c === color)); });
    [].forEach.call(bar.querySelectorAll('[data-w]'), function (x) { x.classList.toggle('on', +x.dataset.w === width); });
    var right = bar.querySelector('.right'), h = '';
    if (layers.length) h += '<select id="ink-pick" title="Lecture notes"' + (editing && target !== mine ? ' disabled' : '') + '><option value="">No lecture notes</option>' + layers.map(function (l) { return '<option value="' + l.id + '"' + (pub && pub.id === l.id ? ' selected' : '') + '>Notes: ' + (l.title || l.id) + (viewOf(l) === VIEW ? '' : ' (' + VIEWNAME[viewOf(l)] + ')') + '</option>'; }).join('') + '</select>';
    if (teacher() && VIEW === 'slides' && /[?&]lecture=1/.test(location.search)) h += '<span class="pres" title="Opened from the Lecture button: the faint answers are hidden, safe to mirror to the projector">Presenting</span>';
    if (NATIVE) h += '<button data-a="home" class="quiet" title="back to the list of chapters">Chapters</button>';
    if (EDITOR_VIEW) h += '<button data-a="report" class="quiet" title="Tell Claude something is wrong on this page: your note plus this device\'s details go in as a comment on the page">Report</button>';
    h += teacher() ? '<button data-a="publish" class="act" title="publish today\'s notes for students">Publish</button>'
                   : '<button data-a="clear" class="quiet" title="erase all of my notes on this view">Clear mine</button>';
    right.innerHTML = h;
    msg(editing ? (target === mine ? 'My notes · this device only' : 'Lecture notes · ' + target.title + ' (draft)') : '');
  }
  // Report (2026-11-11): only in the editor's viewer (/view/<slug>, which has the editor's api): a note to Claude
  // with what Claude can't see from here (device, zoom, the page, the last errors), saved as a comment on the page.
  var EDITOR_VIEW = /\/view\/[\w-]+\/?$/.test(location.pathname), ERRS = [];
  addEventListener('error', function (e) { ERRS.push(String(e.message || e)); if (ERRS.length > 10) ERRS.shift(); });
  addEventListener('unhandledrejection', function (e) { ERRS.push('promise: ' + String(e.reason && e.reason.message || e.reason)); if (ERRS.length > 10) ERRS.shift(); });
  function diag() {
    var vv = window.visualViewport, pg = currentPage();
    return { at: new Date().toISOString(), ua: navigator.userAgent, url: location.pathname + location.search, page: pg && pg.id,
      view: VIEW, lecture: LECT || '', screen: innerWidth + 'x' + innerHeight + '@' + devicePixelRatio, vv: vv ? { scale: +vv.scale.toFixed(3), x: Math.round(vv.offsetLeft), y: Math.round(vv.offsetTop) } : null,
      zoom: getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim(), lectK: window.eaiLectK || null, tool: tool, errors: ERRS.slice() };
  }
  function report() {
    var old = document.getElementById('ink-report'); if (old) return old.remove();
    var pg = currentPage(), box = document.createElement('div'); box.id = 'ink-report'; box.className = 'ink-report';
    box.style.cssText = 'position:fixed;z-index:80;right:12px;top:52px;width:min(360px,90vw);background:#fff;border:1px solid #bbb;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.2);padding:10px;font:14px Arial,sans-serif';
    box.innerHTML = '<div style="margin-bottom:6px"><b>Report to Claude</b> <span style="color:#777">page ' + (pg ? pg.id : '?') + '</span></div>'
      + '<textarea rows="4" style="width:100%;box-sizing:border-box;font:14px Arial,sans-serif" placeholder="What went wrong? (what you did, what you expected)"></textarea>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px"><button data-r="x">Cancel</button><button data-r="go" style="font-weight:bold">Send</button></div>';
    document.body.appendChild(box); box.querySelector('textarea').focus();
    box.onclick = function (e) {
      var r = e.target.dataset && e.target.dataset.r; if (!r) return;
      if (r === 'x') return box.remove();
      var text = box.querySelector('textarea').value.trim(); if (!text) return;
      var slug = location.pathname.replace(/\/$/, '').split('/').pop();
      e.target.disabled = true; e.target.textContent = 'Sending…';
      fetch('../api/report/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: pg && pg.id, text: text, diag: diag() }) })
        .then(function (x) { return x.json().then(function (j) { if (!x.ok) throw new Error(j.error || x.status); }); })
        .then(function () { box.remove(); msg('Sent: Claude sees it as a comment on this page.'); }, function (err) { e.target.disabled = false; e.target.textContent = 'Send'; msg('Not sent: ' + err.message); });
    };
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
  function msg(t) { if (NATIVE_INK) native({ msg: t || '' }); var m = bar && bar.querySelector('.ink-msg'); if (m) m.textContent = t; else if (t && !NATIVE_INK && !/…$/.test(t)) alert(t); }
  function currentPage() { var best = null, bd = 1e9; pages().forEach(function (p) { var r = rectOf(p), d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < bd) { bd = d; best = p; } }); return best; }
  function addBlank(at) {
    var pg = (at && document.getElementById(at)) || currentPage(); if (!pg) return;
    var b = { after: pg.id, id: (target === mine ? 'my-' : 'wb-') + Date.now().toString(36) }; target.pages.push(b); blankPage(b); undo.push({ blank: b }); save();
    document.getElementById(b.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function doUndo() {
    var u = undo.pop(); if (!u) return;
    // every path drawing it, not just the one first drawn: an erase undone draws the stroke again as a new path
    if (u.stroke) drop(u.stroke);
    if (u.erased) u.erased.forEach(put);
    if (u.blank) { target.pages.splice(target.pages.indexOf(u.blank), 1); var p = document.getElementById(u.blank.id); if (p) p.remove(); }
    // a blank's pad (the iPad app's eaiNativeInk.fill): its handwriting as it was before the pad opened
    if (u.fill) { u.after.forEach(unStroke); u.before.forEach(function (s) { target.strokes.push(s); drawStroke(s); }); }
    save(); nativeState();
  }
  // a stroke out of its layer (today's notes, or the private notes: Note pen) and off the page, and back again
  function drop(s) {
    var l = s.n && prep ? prep.strokes : target.strokes, i = l.indexOf(s); if (i >= 0) l.splice(i, 1);
    if (s.n && prep) { prep.gone.push(s.id); prepSave(); }
    [].forEach.call(book.querySelectorAll('svg.ink path'), function (pp) { if (pp._s === s) pp.remove(); });
  }
  // a private stroke put back gets a new id: its old one is gone on every device (the sync's tombstones)
  function put(s) {
    if (s.n && prep) { s.id = prepId(); prep.strokes.push(s); prepSave(); } else target.strokes.push(s);
    drawStroke(s);
  }
  function unStroke(s) {
    var i = target.strokes.indexOf(s); if (i >= 0) target.strokes.splice(i, 1);
    [].forEach.call(book.querySelectorAll('svg.ink path'), function (pp) { if (pp._s === s) pp.remove(); });
  }
  function near(s, x, y, r) { for (var i = 0; i < s.pts.length; i++) { var dx = s.pts[i][0] - x, dy = s.pts[i][1] - y; if (dx * dx + dy * dy < r * r) return true; } return false; }
  function down(e) {
    if (NATIVE_INK && e.pointerType === 'pen') return;   // the iPad app draws the Pencil itself (nativeInk)
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
    // Lecture mode: the pen held still for half a second opens the colour wheel there (the dot it made is taken back)
    penAt = { x: e.clientX, y: e.clientY };
    var hold = LECT && tool !== 'laser' ? setTimeout(held, 500) : null;
    function held() {
      hold = null; detach();
      if (el) el.remove();
      erased.forEach(function (s) { target.strokes.push(s); drawStroke(s); });
      openWheel(penAt.x, penAt.y);
    }
    function move(ev) {
      if (ev.pointerId !== e.pointerId) return;
      if (hold && Math.abs(ev.clientX - penAt.x) + Math.abs(ev.clientY - penAt.y) > 6) { clearTimeout(hold); hold = null; }
      var es = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; if (!es.length) es = [ev];
      if (tool === 'laser') { laser.style.left = ev.clientX + 'px'; laser.style.top = ev.clientY + 'px'; return; }
      es.forEach(function (q) {
        var qt = q.timeStamp || ev.timeStamp; if (last && qt <= last.t && es.length > 1) return;   // a sample we already have
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
    function detach() {
      clearTimeout(hold); hold = null;
      pg.removeEventListener('pointermove', move); pg.removeEventListener('pointerup', up); pg.removeEventListener('pointercancel', up);
      removeEventListener('scroll', onScroll, true); penDown = false;
    }
    function up(ev) {
      if (ev && ev.pointerId !== e.pointerId) return;
      detach(); if (ev) penAt = { x: ev.clientX, y: ev.clientY };
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
    // not in the iPad app: it draws the Pencil itself, and a cancelled Pencil touch made WebKit fail PencilKit's
    // drawing gesture (2026-11-13: the pen drew nothing)
    if (NATIVE_INK || !editing || tool === 'hand') return;
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

  // ---------------------------------------------------------------- PDF with the notes that are showing
  // The chapter's own PDF for this view (so every page keeps its size: 10 × 7.5 in slides, 6 × 9 pages) with every
  // stroke showing drawn in as a vector line, and the blank working pages put in where they are. Printing the page
  // instead gave letter-size pages on the iPad, where Safari ignores @page sizes (Eric, 2026-11-03). If the PDF can't
  // be had, or no longer matches the page (published before the chapter changed), it falls back to printing.
  var PDFLIB = '/static/js/pdf-lib-1.17.1.min.js';   // pdf-lib (MIT), kept on the site
  function pdfURL() {
    if (opts.pdf) return '/' + SITE_DIR.replace(/^\/|\/$/g, '') + '/' + opts.pdf;
    var a = [].filter.call(document.querySelectorAll('.pdfmenu a[download]'), function (x) { return x.textContent.trim() === VIEWNAME[VIEW]; })[0];
    return a ? a.href : null;
  }
  function hexRGB(h) { h = (h || '#000').replace('#', ''); return PDFLib.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255); }
  // buildPDF(list): the view's PDF with the strokes of the given layers drawn in; resolves to { bytes, name }, or
  // rejects (Error 'nopdf', 'count …' when the PDF is older than the page, anything else when it can't be built).
  function buildPDF(list) {
    var url = pdfURL(); if (!url) return Promise.reject(new Error('nopdf'));
    var lib = window.PDFLib ? Promise.resolve() : new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = PDFLIB; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
    return Promise.all([lib, fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('pdf'); return r.arrayBuffer(); })])
      .then(function (a) { return PDFLib.PDFDocument.load(a[1]); })
      .then(function (doc) {
        var pgs = pages(), real = pgs.filter(function (p) { return !p.classList.contains('ink-blank'); });
        if (real.length !== doc.getPageCount()) throw new Error('count ' + real.length + ' ' + doc.getPageCount());
        var at = {}, i = 0;
        pgs.forEach(function (p) {
          if (p.classList.contains('ink-blank')) { var sz = doc.getPage(Math.max(0, i - 1)).getSize(); at[p.id] = doc.insertPage(i, [sz.width, sz.height]); }
          else at[p.id] = doc.getPage(i);
          i++;
        });
        doc._eaiAt = at;
        return drawCode(doc, at, list.filter(function (l) { return l && l.code && Object.keys(l.code).length; })[0]).then(function () { return doc; });
      })
      .then(function (doc) {
        var at = doc._eaiAt, joined = [];
        list.forEach(function (l) {
          if (l) (l.strokes || []).forEach(function (st) {
            var page = at[st.p], el = document.getElementById(st.p); if (!page || !el || !st.pts || !st.pts.length) return;
            if (joined.indexOf(page) < 0) { page.pushOperators(PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round)); joined.push(page); }
            var size = page.getSize(), k = size.width / pgW(el);
            page.drawSvgPath(pathD(tidy(st.pts)), { x: 0, y: size.height, scale: k, borderColor: hexRGB(st.c), borderWidth: (st.o ? st.w : r1(st.w * 1.6)) * k,
              borderOpacity: st.o || 1, borderLineCap: PDFLib.LineCapStyle.Round });
          });
        });
        return doc.save();
      })
      .then(function (bytes) { return { bytes: bytes, name: decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.pdf$/i, '') + '-notes.pdf' }; });
  }

  // Code run in lecture, drawn into the notes PDF (Eric, 2026-11-10). The PDF has the cell as stored; where a cell was
  // edited, filled in (its code blanks, 2026-11-13: with their colours, as are colours written on edited code) or run, its code box and/or output box are painted over and the lecture's code, output (in its colours)
  // and plots drawn in, shrunk to fit if need be. What won't fit there at a readable size (a long output, plots under
  // a cell that had no output box) goes on a page of its own right after the slide, "Run in lecture: <title>". Ink
  // is drawn after, so notes written over an output stay on top of it.
  var FONTKIT = '/static/js/fontkit-1.1.1.min.js', FONTS = '/ai2ai/editor/kit/fonts/', pngCache = {};
  function script(src) { return new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); }); }
  function pdfFonts(doc) {
    return (window.fontkit ? Promise.resolve() : script(FONTKIT)).then(function () {
      doc.registerFontkit(window.fontkit);
      return Promise.all(['Inconsolata-LGC.ttf', 'Inconsolata-LGC-Bold.ttf', 'AI2AI-Math.ttf'].map(function (f, i) {
        return fetch(FONTS + f).then(function (r) { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }).then(function (b) { return doc.embedFont(b, { subset: true }); })
          .catch(function (e) { if (i < 2) throw e; return null; });   // the symbol font is a nice-to-have
      }));
    }).then(function (a) { return { r: a[0], b: a[1], sym: a[2], has: a[0].getCharacterSet ? new Set(a[0].getCharacterSet()) : null, adv: 0.6, uni: true }; }, function () {
      return Promise.all([doc.embedFont(PDFLib.StandardFonts.Courier), doc.embedFont(PDFLib.StandardFonts.CourierBold)]).then(function (a) { return { r: a[0], b: a[1], adv: 0.6, uni: false }; });
    });
  }
  function pngBytes(f) {
    f = pngCache[f] || f;
    if (/^(\/|https?:)/.test(f)) return fetch(f).then(function (r) { if (!r.ok) throw new Error('plot'); return r.arrayBuffer(); });
    var b = atob(f.replace(/^data:[^,]*,/, '')), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return Promise.resolve(u);
  }
  function cssRGB(v, dflt) {
    var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(v || '');
    if (!m || m[4] === '0') return dflt; return PDFLib.rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255);
  }
  // lines of coloured runs from a rendered output (<pre>), or plain lines of code; bg: also the boxes behind text
  // (highlights, a highlighted blank), as rn.bg
  function runsOf(pre, bg) {
    var lines = [[]];
    (function walk(n) {
      if (n.nodeType === 3) {
        var st = getComputedStyle(n.parentNode), c = cssRGB(st.color, PDFLib.rgb(0.2, 0.2, 0.2)), b = (parseInt(st.fontWeight, 10) || 400) >= 600;
        var back = bg && n.parentNode !== pre ? cssRGB(st.backgroundColor, null) : null;
        // (code) a blank not filled in or shown: a gap, not its answer (which the page keeps hidden, or faint on the iPad)
        if (bg && n.parentNode.closest && n.parentNode.closest('u.fill:not(.filled):not(.shown)')) { lines[lines.length - 1].push({ t: n.nodeValue.replace(/[^\n]/g, ' '), c: c, b: false, ul: true }); return; }
        n.nodeValue.replace(/\t/g, '    ').split('\n').forEach(function (t, i) { if (i) lines.push([]); if (t) lines[lines.length - 1].push(back ? { t: t, c: c, b: b, bg: back } : { t: t, c: c, b: b }); });
      } else if (n.nodeType === 1 && !/^(BUTTON|SCRIPT|STYLE)$/.test(n.tagName)) [].forEach.call(n.childNodes, walk);
    })(pre);
    while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
    return lines;
  }
  // a cell's code as the page shows it (its code blanks filled in, in their colours), line by line
  function liveRuns(block) { return [].map.call(block.querySelectorAll('.ln'), function (l) { return runsOf(l, true)[0] || []; }); }
  // edited code with the colours written on it (book.js eaiCodeColors: [from, to, "t:red" | "h:gold"])
  var PEN_RGB = { blue: '#1155CC', red: '#CC0000', green: '#38761D', purple: '#674EA7', gold: '#DCB439' }, HL_RGB = { gold: '#FFF2CC' };
  function markedRuns(src, marks) {
    var ink = PDFLib.rgb(0.13, 0.13, 0.13), tc = [], hc = [];
    marks.forEach(function (m) { var p = m[2].split(':'), arr = p[0] === 't' ? tc : hc; for (var i = m[0]; i < m[1]; i++) arr[i] = p[1]; });
    var lines = [[]], i = 0;
    while (i < src.length) {
      if (src[i] === '\n') { lines.push([]); i++; continue; }
      var j = i; while (j < src.length && src[j] !== '\n' && tc[j] === tc[i] && hc[j] === hc[i]) j++;
      var rn = { t: src.slice(i, j).replace(/\t/g, '    '), c: tc[i] && PEN_RGB[tc[i]] ? hexRGB(PEN_RGB[tc[i]]) : ink, b: !!(tc[i] && PEN_RGB[tc[i]]) };
      if (hc[i] && HL_RGB[hc[i]]) rn.bg = hexRGB(HL_RGB[hc[i]]);
      lines[lines.length - 1].push(rn); i = j;
    }
    while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
    return lines;
  }
  function plainRuns(src) { var ink = PDFLib.rgb(0.13, 0.13, 0.13); return src.replace(/\t/g, '    ').replace(/\s+$/, '').split('\n').map(function (t) { return t ? [{ t: t, c: ink, b: false }] : []; }); }
  function widest(lines) { return lines.reduce(function (m, l) { return Math.max(m, l.reduce(function (n, r) { return n + r.t.length; }, 0)); }, 1); }
  function drawCode(doc, at, layer) {
    var code = layer && layer.code, keys = code ? Object.keys(code) : [];
    var jobs = keys.map(function (k) { var b = blockFor(k); return b && at[code[k].p] && b.closest('section.page') && b.closest('section.page').id === code[k].p ? { k: k, b: b, c: code[k] } : null; }).filter(Boolean);
    if (!jobs.length) return Promise.resolve();
    // what each cell shows now (the lecture's version), then the boxes it has in the PDF (the stored version)
    jobs.forEach(function (j) {
      var out = j.b.nextElementSibling; while (out && out.tagName === 'TEXTAREA') out = out.nextElementSibling;   // (an edited cell's editor sits between)
      if (out && out.tagName !== 'B-OUT') out = null; var pre = out && out.querySelector('pre');
      if (j.b._eaiLive) j.b._eaiLive(j.c);
      // edited code (in its colours), or the stored code with its blanks as filled in during the lecture
      j.code = j.c.src != null ? (j.c.marks ? markedRuns(j.c.src, j.c.marks) : plainRuns(j.c.src)) : j.c.fills ? liveRuns(j.b) : null;
      j.out = j.c.out != null && pre ? runsOf(pre) : j.c.out != null ? plainRuns(j.c.out) : null;
      if (j.out && j.out.length === 1 && !j.out[0].length) j.out = null;
      j.figs = j.c.figs || [];
      var lnEl = j.b.querySelector('.ln') || j.b; j.fsCode = parseFloat(getComputedStyle(lnEl).fontSize) * 0.75 || 10;
      j.fsOut = pre ? parseFloat(getComputedStyle(pre).fontSize) * 0.75 || 9 : 9;
      j.bgCode = cssRGB(getComputedStyle(j.b).backgroundColor, PDFLib.rgb(1, 1, 1));
      j.bgOut = out ? cssRGB(getComputedStyle(out).backgroundColor, PDFLib.rgb(1, 1, 1)) : PDFLib.rgb(1, 1, 1);
      j.outEl = out;
    });
    jobs.forEach(function (j) { if (j.b._eaiLive) j.b._eaiLive(null); });
    jobs.forEach(function (j) {
      var pg = document.getElementById(j.c.p), r = rectOf(pg), k = pgW(pg) / r.width;
      var box = function (el) { if (!el) return null; var q = rectOf(el); return q.height < 2 ? null : { x: (q.left - r.left) * k, y: (q.top - r.top) * k, w: q.width * k, h: q.height * k }; };
      var g = j.b.querySelector('.gutter'), src = j.b.querySelector('.src');
      j.codeBox = box(j.b); j.codeX = box(g || src); j.codeTop = box(j.b.querySelector('.ln'));
      var out = j.outEl, pre = out && !out.classList.contains('run-new') ? out.querySelector('pre') : null;
      j.outBox = out && !out.classList.contains('run-new') ? box(out) : null;
      j.outTop = pre && box(pre) ? box(pre) : null;
      if (j.outBox && !j.outTop) { var lab = box(out.querySelector('.label')); j.outTop = lab ? { x: j.outBox.x, y: lab.y + lab.h, w: j.outBox.w, h: 0 } : null; }
    });
    applyCode();
    return Promise.all([pdfFonts(doc), Promise.all(jobs.map(function (j) {
      return Promise.all(j.figs.map(function (f) { return pngBytes(f).then(function (u) { return doc.embedPng(u); }, function () { return null; }); }))
        .then(function (ims) { j.ims = ims.filter(Boolean); });
    }))]).then(function (a) {
      var F = a[0], clean = function (t) { return F.uni ? t : t.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'); };
      function line(page, kp, runs, x, y, fs) {   // y: top of the line in page pt; one column per character, like the screen
        var H = page.getSize().height, cx = x;
        runs.forEach(function (rn) {
          var t = clean(rn.t), font = rn.b ? F.b : F.r, piece = '', pieceFont = font;
          if (rn.bg) {   // a highlight: its box behind the run
            var rw; try { rw = font.widthOfTextAtSize(t, fs); } catch (e) { rw = t.length * F.adv * fs; }
            page.drawRectangle({ x: cx * kp, y: H - (y + fs * 1.18) * kp, width: rw * kp, height: fs * 1.25 * kp, color: rn.bg });
          }
          if (rn.ul) {   // an empty code blank: its line to write on
            var uw = t.length * F.adv * fs;
            page.drawLine({ start: { x: cx * kp, y: H - (y + fs * 1.1) * kp }, end: { x: (cx + uw) * kp, y: H - (y + fs * 1.1) * kp }, thickness: 0.8 * kp, color: PDFLib.rgb(0.13, 0.13, 0.13) });
          }
          var flush = function () { if (piece) page.drawText(piece, { x: cx * kp, y: H - (y + fs * 0.95) * kp, size: fs * kp, font: pieceFont, color: rn.c }); cx += (pieceFont.widthOfTextAtSize ? pieceFont.widthOfTextAtSize(piece, fs) : piece.length * F.adv * fs); piece = ''; };
          Array.from(t).forEach(function (ch) {
            var f = F.has && F.sym && !F.has.has(ch.codePointAt(0)) ? F.sym : font;
            if (f !== pieceFont) { flush(); pieceFont = f; } piece += ch;
          });
          flush();
        });
      }
      function lines(page, kp, ls, x, y, fs, lh) { ls.forEach(function (l, i) { line(page, kp, l, x, y + i * lh, fs); }); return ls.length * lh; }
      function cover(page, kp, b, col) { var H = page.getSize().height; page.drawRectangle({ x: b.x * kp, y: H - (b.y + b.h) * kp, width: b.w * kp, height: b.h * kp, color: col }); }
      var spill = {};   // page id → the cells that go on a page of their own
      jobs.forEach(function (j) {
        var page = at[j.c.p], el = document.getElementById(j.c.p), kp = page.getSize().width / pgW(el), PAD = 3, lead = 1.32;
        var place = { code: !j.code, out: !j.out && !j.ims.length };
        if (j.code && j.codeBox) {   // the edited code in the code box, if it fits at 60% or more of its size
          var cb = j.codeBox, x0 = (j.codeX ? j.codeX.x : cb.x) + PAD, y0 = (j.codeTop ? j.codeTop.y : cb.y + PAD), w = cb.x + cb.w - x0 - PAD, h = cb.y + cb.h - y0 - PAD;
          var s = Math.min(1, w / (widest(j.code) * F.adv * j.fsCode), h / (j.code.length * j.fsCode * lead));
          if (s >= 0.6) { cover(page, kp, { x: cb.x + 1, y: cb.y + 1, w: cb.w - 2, h: cb.h - 2 }, j.bgCode); lines(page, kp, j.code, x0, y0, j.fsCode * s, j.fsCode * s * lead); place.code = true; }
        }
        var grey = PDFLib.rgb(0.45, 0.45, 0.45), place2 = { text: !j.out, ims: !j.ims.length };
        if (!place.code && j.codeBox) {   // the code didn't fit: say where it went, over the stored code
          var cb2 = j.codeBox; cover(page, kp, { x: cb2.x + 1, y: cb2.y + 1, w: cb2.w - 2, h: cb2.h - 2 }, j.bgCode);
          line(page, kp, [{ t: (j.c.src != null ? 'Edited' : 'Filled in') + ' in lecture: the code is on the next page.', c: grey, b: false }], cb2.x + 6, cb2.y + 5, Math.min(j.fsCode, 11));
        }
        if ((j.out || j.ims.length) && j.outBox && j.outTop) {   // the lecture's output (and plots) in the output box
          var ob = j.outBox, ox = ob.x + PAD + 2, oy = j.outTop.y + 1, ow = ob.w - 2 * PAD - 4, oh = ob.y + ob.h - oy - PAD;
          var ol = j.out || [], ts = ol.length ? Math.min(1, ow / (widest(ol) * F.adv * j.fsOut)) : 1, th = ol.length * j.fsOut * ts * lead;
          if (th > oh || ts < 0.6) { ts = Math.min(ts, oh / (ol.length * j.fsOut * lead)); th = ol.length * j.fsOut * ts * lead; }
          var natural = j.ims.map(function (im) { var w2 = Math.min(ow, im.width * 0.75); return { im: im, w: w2, h: w2 * im.height / im.width }; });
          var ih = natural.reduce(function (n, q) { return n + q.h + 3; }, 0), room = oh - th, is = ih ? Math.min(1, room / ih) : 1;
          place2.text = !ol.length || ts >= 0.6; place2.ims = !ih || (place2.text && is >= 0.45);
          cover(page, kp, { x: ob.x + 1, y: oy - 1, w: ob.w - 2, h: ob.y + ob.h - oy }, j.bgOut);
          var yy = oy, H = page.getSize().height;
          if (place2.text) yy += lines(page, kp, ol, ox, oy, j.fsOut * ts, j.fsOut * ts * lead) + 2;
          if (place2.ims) natural.forEach(function (q) { var w2 = q.w * is, h2 = q.h * is; page.drawImage(q.im, { x: (ox + (ow - w2) / 2) * kp, y: H - (yy + h2) * kp, width: w2 * kp, height: h2 * kp }); yy += h2 + 3; });
          var note = !place2.text ? 'Run in lecture: the output is on the next page.' : !place2.ims ? '(the plot is on the next page)' : '';
          if (note && yy + j.fsOut * lead <= ob.y + ob.h) line(page, kp, [{ t: note, c: grey, b: false }], ox, yy, Math.min(j.fsOut, 10));
        }
        place.out = place2.text && place2.ims;
        if (!place.code || !place.out) (spill[j.c.p] = spill[j.c.p] || []).push({ j: j, code: !place.code, text: !place2.text, ims: !place2.ims });
      });
      Object.keys(spill).forEach(function (pid) {   // a page of its own after the slide, for what didn't fit
        var after = at[pid], idx = doc.getPages().indexOf(after), sz = after.getSize(), el = document.getElementById(pid), W = pgW(el), kp = sz.width / W, Hpt = sz.height / kp;
        var page = doc.insertPage(idx + 1, [sz.width, sz.height]), M = 36, y = M, avail = Hpt - 2 * M - 26, cw = W - 2 * M;
        var head = el.querySelector('h1, h2, h3'), title = 'Run in lecture' + (head ? ': ' + head.textContent.replace(/\s+/g, ' ').trim() : '');
        line(page, kp, [{ t: title, c: PDFLib.rgb(0, 0.169, 0.357), b: true }], M, y, 15); y += 26;
        var items = [];   // [kind, lines | image, size]
        spill[pid].forEach(function (e) {
          if (e.code && e.j.code) items.push(['code', e.j.code, Math.min(11, cw / (widest(e.j.code) * F.adv))]);
          if (e.text && e.j.out) items.push(['out', e.j.out, Math.min(11, cw / (widest(e.j.out) * F.adv))]);
          if (e.ims) e.j.ims.forEach(function (im) { var w2 = Math.min(cw, im.width * 0.75); items.push(['img', im, w2, w2 * im.height / im.width]); });
        });
        var need = items.reduce(function (n, it) { return n + (it[0] === 'img' ? it[3] : it[1].length * it[2] * 1.32) + 8; }, 0), s = Math.max(0.3, Math.min(1, avail / need));
        items.forEach(function (it) {
          if (it[0] === 'img') { var w2 = it[2] * s, h2 = it[3] * s; page.drawImage(it[1], { x: (M + (cw - w2) / 2) * kp, y: sz.height - (y + h2) * kp, width: w2 * kp, height: h2 * kp }); y += h2 + 8; return; }
          var fs = it[2] * s, hh = it[1].length * fs * 1.32;
          if (it[0] === 'code') cover(page, kp, { x: M - 4, y: y - 3, w: cw + 8, h: hh + 6 }, PDFLib.rgb(0.96, 0.96, 0.96));
          y += lines(page, kp, it[1], M, y, fs, fs * 1.32) + 8;
        });
      });
    });
  }
  function notesPDF() {
    var fallback = function (why) { msg(why + ' Printing the page instead.'); setTimeout(function () { window.print(); }, 50); };
    msg('Making the PDF…');
    buildPDF([pub, mine]).then(function (r) {
        var link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' })); link.download = r.name;
        document.body.appendChild(link); link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 60000);
        msg('Saved ' + r.name);
      })
      .catch(function (e) { var m = e && e.message || ''; fallback(m === 'nopdf' ? 'No PDF for this view.' : /count/.test(m) ? 'The PDF on the site is older than this page.' : 'Couldn\'t build the PDF.'); });
  }
  window.eaiNotesPDF = notesPDF;

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
  function bytes64(u8) { var s = '', i; for (i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function setupTeacher() { return teacher() ? Promise.resolve(true) : signIn(); }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function gh(path, token, body, raw) {   // raw: body is already base64 (a PDF)
    var url = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
    return fetch(url + '?ref=' + BRANCH, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cur) {
        var data = { message: 'Lecture notes: ' + path, content: raw ? body : b64(body), branch: BRANCH }; if (cur && cur.sha) data.sha = cur.sha;
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
    // plots from lecture runs go up as PNG files beside the notes (ink/<notes id>-<cell>-<n>.png), and the notes keep
    // their site paths, so the notes file stays small and the plots show wherever the notes are shown
    var ups = [];
    Object.keys(target.code || {}).forEach(function (k) {
      var c = target.code[k]; (c.figs || []).forEach(function (f, i) {
        if (/^(\/|https?:)/.test(f)) return;
        var name = target.id + '-' + k.replace(/[^\w-]+/g, '_') + '-' + (i + 1) + '.png';
        ups.push(function () { return gh(dir + '/ink/' + name, token, f.replace(/^data:[^,]*,/, ''), true).then(function () { var path = '/' + dir.replace(/^\/|\/$/g, '') + '/ink/' + name; pngCache[path] = f; c.figs[i] = path; }); });
      });
    });
    ups.reduce(function (p, f) { return p.then(f); }, Promise.resolve())
      .then(function () { save(); return gh(dir + '/ink/' + target.id + '.json', token, JSON.stringify(target)); })
      .then(function () { return gh(dir + '/ink/index.json', token, JSON.stringify({ layers: ix }, null, 1)); })
      .then(function () {
        layers = ix.slice().reverse();
        // and the view's PDF with these notes drawn in, at a fixed name next to the chapter's PDFs (<pdf>-notes.pdf), so a
        // course page can link the notes as a plain PDF and the link stays right after every Publish (Eric, 2026-11-03)
        msg('Notes published. Making the PDF…');
        return buildPDF([target]).then(function (r) {
          return gh(dir + '/' + r.name, token, bytes64(r.bytes), true).then(function () {
            msg('Published, with ' + r.name + '. Students see both in a minute or two.');
          }, function (e) { msg('Notes published, but the PDF didn\'t upload: ' + e.message); });
        }, function (e) {
          msg('Notes published, but no PDF: ' + (/count/.test(e && e.message) ? 'the PDF on the site is older than this page.' : 'it couldn\'t be built.'));
        });
      })
      .catch(function (err) { if (err.status === 401) store(KEY_TOKEN, ''); msg('Not published: ' + err.message); });
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
    // The zoom is a scale, not a new layout (Eric, 2026-11-03: smooth as Notability). The pages are laid out once at the
    // fit-the-width size (CSS --zoom, which re-wraps text, changes only when the window does) and the presenter's zoom k
    // is a transform on #book, so zooming only redraws. #book sits in #lect-size (the scaled size, which gives the
    // scroll box its range) inside #lect-scroll (the box that scrolls).
    window.eaiZoomK = 1;   // view.html's resize keeps --zoom at the fit size
    var scroller = document.createElement('div'), sizer = document.createElement('div');
    scroller.id = 'lect-scroll'; sizer.id = 'lect-size';
    book.parentNode.insertBefore(scroller, book); scroller.appendChild(sizer); sizer.appendChild(book); scrollBox = scroller;
    function firstPage() { return book.querySelector('section.page:not(.cover)') || book.querySelector('section.page'); }
    function pagePx() { var pg = firstPage(); return pg ? pgW(pg) * 4 / 3 * fit() : 0; }   // a page's width in #book's own px
    var bw = 0;   // #book's own (unscaled) width
    function size() {   // the sizer = #book's box after the scale
      sizer.style.width = (bw * k) + 'px'; sizer.style.height = (book.offsetHeight * k) + 'px';
    }
    function apply() {
      H.style.setProperty('--zoom', +fit().toFixed(4));
      bw = Math.max(scroller.clientWidth / k, pagePx() + 32);   // wide enough to centre the pages when they fit, never narrower than one
      book.style.width = bw + 'px'; book.style.transform = 'scale(' + k + ')'; lectK = k;
      size(); zoomGen++;
      pages().forEach(function (p) { if (p.querySelector(':scope > svg.ink')) overlay(p); });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (!live) apply(); }).observe(book);   // pictures loading, pages patched in
    function pageAt(x, y) {   // the page nearest a point, and where in it the point is (fractions), to keep it under the fingers
      var best = null, bd = Infinity;
      [].forEach.call(book.querySelectorAll('section.page'), function (p) {
        var r = rectOf(p); if (!r.height) return;
        var d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = { p: p, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }; }
      });
      return best;
    }
    function anchor(a, x, y) { if (a) { var r = rectOf(a.p); scroller.scrollLeft += r.left + a.fx * r.width - x; scroller.scrollTop += r.top + a.fy * r.height - y; } }
    function save() { clearTimeout(save.t); save.t = setTimeout(function () { try { localStorage.setItem(KEY, String(+k.toFixed(3))); } catch (x) {} }, 300); }
    function zoomTo(nk, x, y) {
      nk = Math.max(0.4, Math.min(4, nk)); if (Math.abs(nk - k) < 0.002) return;
      var a = pageAt(x, y); k = nk; apply(); anchor(a, x, y); save();
    }
    // While the fingers move, #book's scale follows them about the point under them, held to where the release can put
    // it (centred when the slides fit the width, never past the scroll box's edges). #lect-size stops clipping meanwhile, so zooming out
    // shows the slides all round. The scale runs on the GPU as a picture (will-change), which keeps it smooth but lets
    // text go soft as the scale drifts from the one it was drawn at, so it is drawn again at the current scale whenever
    // the scale has moved 25% from the last drawing or the fingers rest for a moment (2A, Eric, 2026-11-03).
    var raf = 0, live = null;
    function frame() {
      raf = 0; if (!live) return;
      var L = live, s = L.nk / k, ks = L.nk;
      var tx = L.fx * (1 - s), ty = L.fy * (1 - s);   // keeps the content point under the fingers where it was
      if (L.slide) { tx += L.x - L.x0; ty += L.y - L.y0; }
      // keep the preview where the real zoom can put it: once released, the scroll box can't scroll past its edges, and
      // slides that fit the width are centred (an iPad scroll view rubber-bands the same way)
      var cw = scroller.clientWidth, bw2 = Math.max(cw / ks, L.pp + 32), maxL = Math.max(0, bw2 * ks - cw), left = ks * (bw2 - L.pp) / 2;
      var X = -L.sl + tx + ks * (L.cx - L.pp / 2); X = Math.min(left, Math.max(left - maxL, X)); tx = X + L.sl - ks * (L.cx - L.pp / 2);
      var maxT = Math.max(0, book.offsetHeight * ks - scroller.clientHeight), Y = -L.st + ty; Y = Math.min(0, Math.max(-maxT, Y)); ty = Y + L.st;
      book.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + ks + ')'; lectK = ks; zoomGen++;
      if (Math.abs(Math.log(ks / L.drawn)) > 0.223) sharpen();
      clearTimeout(L.rest); L.rest = setTimeout(sharpen, 120);
    }
    function sharpen() {   // let the browser paint the pages again at the scale they are shown at, then go back to a picture
      if (!live || live.sharp) return;
      var L = live; L.sharp = true; L.drawn = L.nk; book.style.willChange = 'auto';
      requestAnimationFrame(function () { requestAnimationFrame(function () { L.sharp = false; if (live === L) book.style.willChange = ''; }); });
    }
    function soon(nk, x, y, slide) {
      nk = Math.max(0.4, Math.min(4, nk));
      if (!live) {
        var r = scroller.getBoundingClientRect(), pg = firstPage(), pr = pg ? rectOf(pg) : null;
        var fx = x - r.left + scroller.scrollLeft, fy = y - r.top + scroller.scrollTop;   // the point under the fingers, in the scrolled content
        live = { x0: x, y0: y, a: pageAt(x, y), sl: scroller.scrollLeft, st: scroller.scrollTop, fx: fx, fy: fy, drawn: k,
          cx: pr ? (pr.left - r.left + scroller.scrollLeft + pr.width / 2) / k : bw / 2,   // the pages' centre line, in #book's px
          pp: pagePx() };
        H.classList.add('lect-zooming');
      }
      live.nk = nk; live.x = x; live.y = y; live.slide = !!slide;
      if (!raf) { if (!live.started) { live.started = true; frame(); } else raf = requestAnimationFrame(frame); }
      clearTimeout(soon.t); soon.t = setTimeout(commit, 200);   // a trackpad or ctrl+wheel pinch has no end event
    }
    function unpreview(L) {   // back to the plain scale, scrolled where it was
      clearTimeout(L.rest); book.style.willChange = '';
      H.classList.remove('lect-zooming'); book.style.transform = 'scale(' + k + ')'; lectK = k; zoomGen++;
      scroller.scrollLeft = L.sl; scroller.scrollTop = L.st;
    }
    function commit() {
      clearTimeout(soon.t); if (!live) return;
      var L = live; live = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      unpreview(L);
      if (Math.abs(L.nk - k) >= 0.002) { k = L.nk; apply(); save(); }
      anchor(L.a, L.x, L.y);
    }
    // the pen came down: a pinch under way was a palm, not a zoom, so put the pages back as they were, and ignore the
    // rest of that gesture (and any gesture while the pen is down)
    var blocked = false;
    function cancel() {
      clearTimeout(soon.t); if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (live) { var L = live; live = null; unpreview(L); }
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
      var r = scroller.getBoundingClientRect();
      zoomTo(e.key === '0' ? 1 : k * (e.key === '-' ? 1 / 1.15 : 1.15), r.left + r.width / 2, r.top + r.height / 2);
    });
    addEventListener('resize', function () { zoomGen++; setTimeout(apply, 0); });   // after the view's own resize handler
    apply(); setTimeout(apply, 0);
  }
  // ---------------------------------------------------------------- private notes (the iPad app's Note pen)
  // Eric, 2026-11-13: ink only he sees, on his iPad. He writes it before class (reminders, drawings to trace over in
  // lecture) and it stays on the chapter's slides for every lecture until he erases it. It is never part of a day's
  // notes: Publish and the notes PDF read the layers (target, pub, mine), never this; the projector's page never loads
  // it and the app keeps it off the projector's copy of the drawing; Safari and published pages don't have it. It is
  // shown faint, like the faint answers, and hides with them while the iPad's screen is mirrored (the app; book.css
  // for a page drawing it itself). Kept on the device (localStorage) and in the book repo, branch prep-ink,
  // <chapter>.json, through the editor's GitHub token, so his other devices get it: strokes with an id each, and the
  // ids erased (gone), merged by id so two devices writing between syncs both keep their strokes.
  var PREP_BRANCH = 'prep-ink', KEY_PREP = 'eai-ink-prep:' + (opts.chapter || ''), prepBusy = false, prepAgain = 0;
  function prepId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function prepSave() { store(KEY_PREP, prep); clearTimeout(prepSave.t); prepSave.t = setTimeout(prepSync, 2500); }
  // the editor's sign-in on this device (web/store.js kv 'remote': {token, repo, branch, api?, kind?}), or null
  function editorRemote() {
    return new Promise(function (done) {
      if (!window.indexedDB) return done(null);
      try {
        var rq = indexedDB.open('ai2ai-book');
        rq.onupgradeneeded = function () { rq.transaction.abort(); };   // no editor on this device: don't create its database
        rq.onerror = function () { done(null); };
        rq.onsuccess = function () {
          var db = rq.result; if (!db.objectStoreNames.contains('kv')) { db.close(); return done(null); }
          var g = db.transaction('kv').objectStore('kv').get('remote');
          g.onsuccess = function () { db.close(); done(g.result || null); };
          g.onerror = function () { db.close(); done(null); };
        };
      } catch (e) { done(null); }
    });
  }
  function prepMerge(r) {   // theirs into ours: every stroke either side has, less every id either side erased
    var gone = {}, have = {}, out = [], changed = false;
    prep.gone.concat(r.gone || []).forEach(function (id) { gone[id] = 1; });
    prep.strokes.forEach(function (s) { if (gone[s.id]) changed = true; else { have[s.id] = 1; out.push(s); } });
    (r.strokes || []).forEach(function (s) { if (s && s.id && !gone[s.id] && !have[s.id]) { s.n = 1; have[s.id] = 1; out.push(s); changed = true; } });
    prep.strokes = out; prep.gone = Object.keys(gone); store(KEY_PREP, prep);
    return changed;
  }
  function prepSame(r) {
    var ids = function (l) { return (l || []).map(function (x) { return x && x.id || x; }).sort().join(','); };
    return ids(r.strokes) === ids(prep.strokes) && ids(r.gone) === ids(prep.gone);
  }
  function prepSync() {
    if (!prep || !opts.chapter) return;
    if (prepBusy) { prepAgain = 1; return; }
    prepBusy = true; clearTimeout(prepSave.t); prepSave.t = 0;
    editorRemote().then(function (c) {
      if (!c || !c.token || !c.repo || c.kind === 'dev') return;
      var base = (c.api || 'https://api.github.com') + '/repos/' + c.repo, url = base + '/contents/' + encodeURIComponent(opts.chapter) + '.json';
      var H = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' };
      return fetch(url + '?ref=' + PREP_BRANCH, { headers: H, cache: 'no-store' }).then(function (r) {
        if (r.status === 404) return { sha: null, data: {} };
        if (!r.ok) throw new Error('prep ' + r.status);
        return r.json().then(function (j) {
          if (j.content) return { sha: j.sha, data: JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\s/g, ''))))) };
          // over 1 MB the contents API leaves the content out: the blob, raw
          return fetch(base + '/git/blobs/' + j.sha, { headers: { Authorization: H.Authorization, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' })
            .then(function (b) { if (!b.ok) throw new Error('prep blob ' + b.status); return b.json(); }).then(function (d) { return { sha: j.sha, data: d }; });
        });
      }).then(function (rem) {
        if (prepMerge(rem.data)) render();
        if (prepSame(rem.data)) return;
        var body = JSON.stringify({ strokes: prep.strokes.map(function (s) { return { id: s.id, p: s.p, c: s.c, w: s.w, pts: s.pts }; }), gone: prep.gone });
        var put = { message: 'Private notes: ' + opts.chapter, branch: PREP_BRANCH, content: btoa(unescape(encodeURIComponent(body))) };
        if (rem.sha) put.sha = rem.sha;
        return fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(put) }).then(function (r) {
          if (r.status === 409 || r.status === 422) prepAgain = prepAgain || 2;   // another device wrote first: merge theirs and go again
        });
      });
    }).catch(function () {}).then(function () {   // offline or refused: the device keeps them, the next sync sends them
      prepBusy = false;
      var n = prepAgain; prepAgain = 0;   // 1: written to meanwhile, 2: a conflict (tried again once)
      if (n === 1 || (n === 2 && !prepSync.retry)) { prepSync.retry = n === 2; prepSync(); } else prepSync.retry = false;
    });
  }

  // ---------------------------------------------------------------- the iPad app's own pen and scrolling
  // AI2AI Present (ios/) from build 2 draws the Pencil itself, at the Pencil's own rate with Apple's predicted touches, and
  // lets the web view scroll and pinch-zoom natively; its toolbar replaces the pen bar (Eric, 2026-11-12: native ink
  // first, keeping the notes as they are). The strokes it draws come back here on lift in the usual form ({p, c, w, o,
  // pts} in page pt), so saving, Undo, Publish and the notes PDF don't change. The app asks for this with
  // eaiNativeApp.ink; an older app, or this page anywhere else, gets the web pen as before.
  // To the app: {inkReady}, {ink: state}, {pages: [page boxes in document px]}, {msg}. From the app: window.eaiNativeInk.
  function nativeState() {
    if (!NATIVE_INK) return;
    native({ ink: { editing: editing, tool: editing ? tool : 'hand', color: color, width: width, teacher: teacher(),
      drafting: !!(target && target !== mine), undo: undo.length } });
  }
  function nativeInk() {
    var H = document.documentElement; H.classList.add('native-ink');
    var vp = document.querySelector('meta[name=viewport]');
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
    vp.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, viewport-fit=cover');
    // every page's box in document px (the web view's content at zoom 1), so the app can put a Pencil point on its page
    // without asking: a box measured against the root element's is the same whatever the scroll and the pinch
    function boxes() {
      var o = H.getBoundingClientRect();
      return pages().map(function (p) { var r = p.getBoundingClientRect(); return { id: p.id, x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, W: pgW(p) }; })
        .filter(function (b) { return b.w > 0 && b.h > 0; });
    }
    var bt = 0;
    function sendBoxes() { clearTimeout(bt); bt = setTimeout(function () { native({ pages: boxes() }); }, 60); }
    if (window.ResizeObserver) new ResizeObserver(sendBoxes).observe(book);   // pictures loading, blank pages, the fit zoom
    addEventListener('resize', sendBoxes); addEventListener('load', sendBoxes);
    var erasing = [];
    // PencilKit (app build 3, eaiNativeApp.pk): the app shows all the ink itself, so what's written looks the same from
    // the first touch on (Eric, 2026-11-12: the live line and the page's line never quite matched, so a stroke changed
    // a little on lift). The page still keeps the strokes (drafts, Undo, Publish, PDFs) but hides its own drawing of
    // them, and tells the app which strokes it would draw, with an id each, whenever that changes (inkList).
    var PK = !!window.eaiNativeApp.pk, ids = new WeakMap(), nid = 1;
    function idOf(st) { if (!ids.has(st)) ids.set(st, nid++); return ids.get(st); }
    function list() { return [].map.call(book.querySelectorAll('svg.ink path'), function (el) { return el._s && { id: idOf(el._s), s: el._s }; }).filter(Boolean); }
    var lt = 0;
    function sendList() { clearTimeout(lt); lt = setTimeout(function () { native({ inkList: list() }); }, 0); }
    if (PK) {
      H.classList.add('native-pk');
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var n = [].concat([].slice.call(ms[i].addedNodes), [].slice.call(ms[i].removedNodes));
          if (n.some(function (x) { return x.nodeName === 'path' || x.nodeName === 'svg' || (x.querySelector && x.querySelector('svg.ink')); })) return sendList();
        }
      }).observe(book, { childList: true, subtree: true });
    }
    window.eaiNativeInk = {
      boxes: boxes,
      list: list,
      // a finished stroke from the app
      stroke: function (s) {
        if (!s || !s.p || !document.getElementById(s.p) || !(s.pts && s.pts.length)) return false;
        if (s.n) {   // the Note pen: into the private notes, not today's
          if (!prep) return false;
          var nt = { id: prepId(), n: 1, p: s.p, c: s.c, w: s.w, pts: s.pts };
          drawStroke(nt); prep.strokes.push(nt); undo.push({ stroke: nt }); prepSave(); nativeState();
          return PK ? idOf(nt) : true;
        }
        ensureTarget(); if (!target) return false;
        var st = { p: s.p, c: s.c, w: s.w, pts: s.pts }; if (s.o) st.o = s.o;
        var el = drawStroke(st); target.strokes.push(st); undo.push({ stroke: st, el: el }); saveSoon(); nativeState();
        return PK ? idOf(st) : true;
      },
      // a fill-in blank's handwriting from the app's pad (ios/ TextPad.swift, docs/blank-pads.md): the strokes tagged
      // with the blank (f: key) are replaced by these, fitted into the blank. Every change in one opening of the pad
      // (sess) is one Undo step on the bar, which puts back the blank's handwriting from before the pad opened.
      fill: function (key, list, sess) {
        ensureTarget(); if (!target || !key) return false;
        var old = target.strokes.filter(function (s) { return s.f === key; }); old.forEach(unStroke);
        var add = (list || []).filter(function (s) { return s && s.p && document.getElementById(s.p) && s.pts && s.pts.length; }).map(function (s) {
          var st = { p: s.p, c: s.c, w: s.w, pts: s.pts, f: key }; if (s.o) st.o = s.o;
          drawStroke(st); target.strokes.push(st); return st;
        });
        var u = undo[undo.length - 1];
        if (u && u.fill === key && u.sess === sess) u.after = add;
        else if (old.length || add.length) undo.push({ fill: key, sess: sess, before: old, after: add });
        saveSoon(); nativeState(); return true;
      },
      // PencilKit's eraser takes whole strokes: these ids (only this draft's or reader's own go; the app is sent the rest
      // back in the next inkList), then eraseEnd as for erase()
      eraseIds: function (list) {
        ensureTarget(); if (!target) return;
        (list || []).forEach(function (id) {
          target.strokes.concat(prep ? prep.strokes : []).filter(function (s) { return ids.get(s) === id; }).forEach(function (s) { drop(s); erasing.push(s); });
        });
        sendList();
      },
      // the eraser: points (page pt) on one page as the Pencil moves, then eraseEnd (cancel: the wheel opened, put them back)
      erase: function (pid, pts) {
        var pg = document.getElementById(pid); if (!pg) return; ensureTarget(); if (!target) return;
        var svg = overlay(pg);
        (pts || []).forEach(function (q) {
          target.strokes.concat(prep ? prep.strokes : []).filter(function (s) { return s.p === pid && near(s, q[0], q[1], 6); }).forEach(function (s) { drop(s); erasing.push(s); });
        });
      },
      eraseEnd: function (cancel) {
        var e = erasing; erasing = []; if (!e.length) return;
        if (cancel) e.forEach(put);
        else undo.push({ erased: e });
        saveSoon(); nativeState();
      },
      // the app's toolbar and wheel
      cmd: function (c, a, b) {
        if (c === 'tool') { tool = a; if (b) color = b; if (tool !== 'laser') last = { t: tool, c: color }; start(); }
        else if (c === 'hand') stop();
        else if (c === 'width') width = +a;
        else if (c === 'undo') { ensureTarget(); doUndo(); }
        else if (c === 'blank') { ensureTarget(); addBlank(a); }
        else if (c === 'pdf') notesPDF();
        else if (c === 'publish') { ensureTarget(); publish(); }
        else if (c === 'save') save();
        barState();
      }
    };
    if (opts.chapter && !window.eaiNativeApp.projector) {   // the iPad's own page, never the projector's
      prep = store(KEY_PREP) || { strokes: [], gone: [] }; render(); prepSync();
      addEventListener('online', function () { prepSync(); });
    }
    native({ inkReady: true, pk: PK, prep: !!prep, pages: boxes() }); nativeState(); sendBoxes(); if (PK) sendList();
  }
  // ?lecture=1 (the editor home's Lecture button): teaching from this device: the pen in hand, the faint answers hidden
  // (see ghost). The plain Lecture view (its answers link) shows them to the signed-in instructor.
  var LECT = (location.search.match(/[?&]lecture=(\w+)/) || [])[1];
  NATIVE_INK = NATIVE && !!window.eaiNativeApp.ink && !!LECT && VIEW === 'slides';
  ghost(); render(); buildBar(); navbar();
  if (NATIVE_INK) nativeInk(); else if (LECT) lectureZoom();
  if (LECT === '1') start();
  // one sign-in: a device signed in to the Book Editor (same site) uses that token here too, if it can publish to this repo
  if (!teacher()) editorRemote().then(function (c) {
    if (!c || !c.token || c.api) return;
    fetch('https://api.github.com/repos/' + REPO, { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (!j || !j.permissions || !j.permissions.push || teacher()) return; store(KEY_TOKEN, c.token); var was = editing; stop(); target = null; ghost(); navbar(); if (was) start(); }, function () {});
  });
  if (/(^|[#&])teach\b/.test(location.hash)) { start(); setupTeacher(); }
  else if (/(^|[#&])(lecture|pen)\b/.test(location.hash)) start();
  addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('textarea, input, select')) return;
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) { editing ? stop() : start(); }
    if (editing && (e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  });
  addEventListener('hashchange', function () { if (/(^|[#&])teach\b/.test(location.hash)) { start(); setupTeacher(); } });
}

// Book runtime: turns a chapter file (plain HTML with a few custom elements) into rendered 6x9 pages.
// Used by the viewer, the editor and the exporter. The chapter file is the single source of truth;
// everything this script adds to the DOM is either marked data-rt or lives inside a custom element,
// and Book.serialize() writes the source back out in a fixed, diff-friendly layout.
//
//   <b-m>x_i w\T + b</b-m>                       inline math (mini language, coloured by meta.colors)
//   <b-eq><eq-row label="hard" note="...">LaTeX</eq-row><eq-step>LaTeX</eq-step></b-eq>   display equation (rendered by the server)
//       label="name": numbered automatically in order ([chapter.n]) and referable; same="name": shows that equation's number again
//   <b-fig src="fig/x.svg" style="width:80%" live="street"></b-fig>                    figure (SVG is inlined)
//   <b-ref page="id"></b-ref>  <b-ref pages="a:b"></b-ref>  <b-ref eq="4.2"></b-ref>   cross references
//   <b-code lang="python">…</b-code>  <b-out>…</b-out>                                 code and its output
//   <div class="cmt" data-by="Eric" data-when="…">text</div>   a review comment on the block just before it (never shown in the web page or PDF)
//   <aside class="qc">question<div class="ans">answer</div></aside>  <b-answers></b-answers>
//   <b-toc></b-toc>   contents: the pages that start a section (data-part), with their page numbers
(function () {
'use strict';
const Book = window.Book = { mode: 'view', base: '', chapter: '', meta: {}, kit: '', api: true, root: null, freezeGaps: false, pending: new Set() };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
Book.esc = esc;
Book.url = p => /^(https?:|data:|\/)/.test(p) ? p : Book.base + p;
const track = p => { Book.pending.add(p); p.finally(() => Book.pending.delete(p)); return p; };

// ---------------------------------------------------------------- inline math
const WORDS = ['exp', 'max', 'min', 'log'];
const isAlpha = c => /\p{L}/u.test(c);
function inlineMath(s) {
  const out = []; let i = 0;
  const colors = Book.meta.colors || {};
  const script = i => {
    if (s[i] === '{') { let j = s.indexOf('}', i); if (j < 0) j = s.length; return [s.slice(i + 1, j), j + 1]; }
    const m = /^(\d+|[\s\S])/.exec(s.slice(i)); return m ? [m[0], i + m[0].length] : ['', i + 1];
  };
  const scripts = tok => {
    while (i < s.length && (s[i] === '_' || s[i] === '^' || s.startsWith('\\T', i))) {
      if (s.startsWith('\\T', i)) { tok += '<sup>T</sup>'; i += 2; continue; }
      const tag = s[i] === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
      tok += `<${tag}>${inlineMath(sub)}</${tag}>`; i = i2;
    }
    return tok;
  };
  while (i < s.length) {
    const c = s[i];
    if (s.startsWith('\\T', i)) { out.push('<sup>T</sup>'); i += 2; continue; }
    const word = WORDS.find(w => s.startsWith(w, i));
    if (word) { out.push(word); i += word.length; continue; }
    if (isAlpha(c)) {
      i++;
      let tok = c === 'Ω' ? '<span class="Om">ω</span>' : esc(c);   // Ω = the weight-matrix ω, drawn as a tall ω (like the equation font)
      while (i < s.length && (s[i] === '_' || s[i] === '^')) {
        const tag = s[i] === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
        tok += `<${tag}>${inlineMath(sub)}</${tag}>`; i = i2;
      }
      if (s[i] === '′') { i++; tok = scripts(tok + '<span class="pr">′</span>'); }
      const f = colors[c];
      out.push(f ? `<span class="c ${f}">${tok}</span>` : tok);
      continue;
    }
    if (c === '^' || c === '_') {
      const tag = c === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
      out.push(`<${tag}>${inlineMath(sub)}</${tag}>`); i = i2; continue;
    }
    out.push(c === '-' ? '−' : esc(c)); i++;
  }
  return out.join('');
}
Book.inlineMath = inlineMath;

// ---------------------------------------------------------------- code highlighting
const set = s => new Set(s.split(' '));
const KW = set('def class import from as lambda global nonlocal del assert and or not is in');
const CTL = set('if elif else for while break continue return yield try except finally raise with pass');
const TY = set('int float str list dict set tuple bool object type deque defaultdict Counter SVC');
const BI = set('print len range enumerate zip sorted reversed min max sum abs isinstance map filter open super iter next any all round');
const NUMC = set('None True False');
function highlight(line) {
  const TOK = /(#.*$)|("[^"]*"|'[^']*')|(\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;
  const types = new Set([...TY, ...(Book.meta.types || [])]);
  // meta.codeColors {name: family}: variables coloured by what they are (inputs red, weights blue, ...), like the
  // figures and equations. Chapters that use it show plain numbers in grey, so red only means an input.
  const concept = Book.meta.codeColors || {}, nuCls = Book.meta.codeColors ? 'nu nn' : 'nu';
  let out = '', prev = null, m;
  while ((m = TOK.exec(line))) {
    const t = m[0], e = esc(t);
    if (m[4] !== undefined) {
      const cls = (prev === 'def' || prev === 'class') ? 'def' : KW.has(t) ? 'kw' : CTL.has(t) ? 'ctl' : types.has(t) ? 'ty'
        : (BI.has(t) && !line.slice(0, m.index).trimEnd().endsWith('.')) ? 'bi' : NUMC.has(t) ? 'nu'
        : concept[t] ? 'cc ' + concept[t] : null;
      out += cls ? `<span class="${cls}">${e}</span>` : e; prev = t;
    } else if (m[1] !== undefined) out += `<span class="cm">${e}</span>`;
    else if (m[2] !== undefined) out += `<span class="st">${e}</span>`;
    else if (m[3] !== undefined) out += `<span class="${nuCls}">${e}</span>`;
    else { out += e; if (!/\s/.test(t)) prev = null; }
  }
  return out;
}

Book.highlight = highlight;   // the editor's in-place code editing redraws the colours as you type

// ---------------------------------------------------------------- custom elements
const inThumb = el => !!el.closest('[data-thumb]');   // copies shown in the page list: already rendered, must not load or renumber anything
const lock = el => { if (Book.mode === 'edit') el.setAttribute('contenteditable', 'false'); };
const rawText = el => el.textContent.replace(/^\s*\n/, '').replace(/\s+$/, '');

class BM extends HTMLElement {
  static get observedAttributes() { return ['tex']; }
  connectedCallback() { lock(this); if (!this.hasAttribute('tex')) this.setAttribute('tex', this.textContent.trim()); }
  attributeChangedCallback() { if (this.firstChild && inThumb(this)) return; this.innerHTML = inlineMath(this.getAttribute('tex') || ''); }
}
class BRef extends HTMLElement {
  connectedCallback() { if (inThumb(this)) return; lock(this); if (!this.firstChild) this.textContent = '…'; Book.refreshSoon(); }
}
const figCache = new Map();
Book.reloadFig = el => { figCache.delete(Book.url(el.getAttribute('src') || '')); el._loaded = null; el.load(); };   // after its file was redrawn
class BFig extends HTMLElement {
  static get observedAttributes() { return ['src', 'crop']; }
  connectedCallback() { if (inThumb(this)) return; if (this._loaded !== this.getAttribute('src')) this.load(); }
  attributeChangedCallback(name) { if (!this.isConnected || inThumb(this)) return; if (name === 'crop') { this.applyCrop(); Book.refreshSoon(); } else this.load(); }
  // crop="left top right bottom": the share of the picture trimmed from each side, in percent
  cropBox() { const c = (this.getAttribute('crop') || '').trim().split(/[\s,]+/).map(Number); return c.length === 4 && c.every(v => v >= 0 && v < 100) && c[0] + c[2] < 99 && c[1] + c[3] < 99 ? c.map(v => v / 100) : [0, 0, 0, 0]; }
  // style="aspect-ratio: w / h" on the figure (set by the editor's corner handles) stretches the picture to that shape
  stretched() { return !!this.style.aspectRatio && this.style.aspectRatio !== 'auto'; }
  // the picture's own width / height after cropping
  naturalRatio() {
    const [l, t, r, b] = this.cropBox(), svg = this.querySelector(':scope > svg:not(.live)'), img = this.querySelector('img');
    if (svg && this._vb) return this._vb[2] * (1 - l - r) / (this._vb[3] * (1 - t - b));
    if (img && img.naturalWidth) return img.naturalWidth * (1 - l - r) / (img.naturalHeight * (1 - t - b));
    return 0;
  }
  applyCrop() {
    const [l, t, r, b] = this.cropBox(), svg = this.querySelector(':scope > svg:not(.live)'), img = this.querySelector('img'), st = this.stretched();
    if (svg) {
      if (!this._vb) { const v = svg.viewBox.baseVal; this._vb = v && v.width ? [v.x, v.y, v.width, v.height] : [0, 0, parseFloat(svg.getAttribute('width')) || 384, parseFloat(svg.getAttribute('height')) || 252]; }
      const [x, y, w, h] = this._vb; svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('viewBox', [x + l * w, y + t * h, w * (1 - l - r), h * (1 - t - b)].map(v => +v.toFixed(2)).join(' '));
      if (st) { svg.setAttribute('preserveAspectRatio', 'none'); svg.style.height = '100%'; } else if (svg.getAttribute('preserveAspectRatio') === 'none') { svg.removeAttribute('preserveAspectRatio'); svg.style.removeProperty('height'); }
    } else if (img) {
      const any = l || t || r || b, wrap = img.parentElement !== this ? img.parentElement : null;
      if (!any) { if (wrap) { wrap.replaceWith(img); } img.removeAttribute('style'); if (st) img.style.cssText = 'height:100%'; return; }
      const box = wrap || document.createElement('div'); if (!wrap) { box.className = 'crop'; img.replaceWith(box); box.append(img); }
      const fw = 1 - l - r, fh = 1 - t - b, ar = (img.naturalWidth || 4) / (img.naturalHeight || 3);
      if (st) {
        box.style.cssText = 'overflow:hidden;height:100%';
        img.style.cssText = `width:${(100 / fw).toFixed(3)}%;height:${(100 / fh).toFixed(3)}%;max-width:none;margin-left:${(-l / fw * 100).toFixed(3)}%;position:relative;top:${(-t / fh * 100).toFixed(3)}%`;
        return;
      }
      box.style.cssText = `overflow:hidden;aspect-ratio:${(ar * fw / fh).toFixed(4)}`;
      img.style.cssText = `width:${(100 / fw).toFixed(3)}%;max-width:none;margin-left:${(-l / fw * 100).toFixed(3)}%;margin-top:${(-t / fw * 100 / ar).toFixed(3)}%`;
    }
  }
  load() {
    const src = this._loaded = this.getAttribute('src') || '';
    if (!src) { this.innerHTML = '<div class="fig-err" data-rt>no figure file</div>'; return; }
    const url = Book.url(src);
    if (!/\.svg$/i.test(src)) {
      const img = document.createElement('img'); img.alt = this.getAttribute('alt') || '';
      track(new Promise(res => { img.onload = () => { this.applyCrop(); Book.refreshSoon(); Book.goLive(this); res(); }; img.onerror = res; }));
      img.src = url; this.replaceChildren(img); return;
    }
    if (!figCache.has(url)) figCache.set(url, fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(src + ': not found'); return r.text(); }));
    track(figCache.get(url).then(svg => {
      if (this._loaded !== src) return;
      this.innerHTML = svg.replace(/<\?xml[^>]*\?>\s*|<!DOCTYPE[^>]*>\s*|<!--[\s\S]*?-->/g, '');
      this.classList.remove('live-on'); this._vb = null; this.applyCrop();
      if (Book.liveOn) Book.initLive(this);
      Book.goLive(this);
      Book.refreshSoon();
    }).catch(e => { figCache.delete(url); this.innerHTML = `<div class="fig-err" data-rt>${esc(e.message)}</div>`; }));
  }
}
// ---------------------------------------------------------------- split chapters: Lecture and Reading linked by topic
// A split chapter (meta "split": true) keeps the Lecture (pages tagged data-view="slides workbook") and the Reading
// (data-view="reading") as separate documents in one file. data-topic="a b" on a page says which topics it covers.
// meta "synced" holds a hash of the Lecture's pages per topic as of the last time the Reading was brought in step;
// a Reading page whose topics' Lecture pages have changed since then is marked "Slides changed" in the editor.
Book.topicsOf = pg => ((pg && pg.getAttribute('data-topic')) || '').split(/\s+/).filter(Boolean);
Book.isLecture = pg => !pg.classList.contains('cover') && !Book.inView(pg, 'reading');
Book.topicHashes = () => {
  const acc = {};
  Book.pages().forEach(pg => {
    if (!Book.isLecture(pg)) return;
    const c = pg.cloneNode(true); c.querySelectorAll(':scope > [data-pool], :scope > .cmt').forEach(n => n.remove());   // shared pieces stay in step by themselves; comments aren't content
    const src = Book.serializePage(c).replace(/^<section([^>]*?) id="[^"]*"/, '<section$1');
    Book.topicsOf(pg).forEach(t => { acc[t] = (acc[t] || '') + src; });
  });
  const out = {}; Object.keys(acc).sort().forEach(t => { out[t] = hash(acc[t]); }); return out;
};
Book.markStale = () => {   // returns the topics whose Lecture pages changed since the last sync
  if (!Book.split) return [];
  const now = Book.topicHashes(), was = (Book.meta.synced || {}).topics || {}, changed = Object.keys({ ...now, ...was }).filter(t => now[t] !== was[t]);
  Book.pages().forEach(pg => {
    const hit = Book.inView(pg, 'reading') && !pg.classList.contains('cover') ? Book.topicsOf(pg).filter(t => changed.includes(t)) : [];
    if (hit.length) pg.setAttribute('data-ed-stale', hit.join(', ')); else pg.removeAttribute('data-ed-stale');
  });
  return changed;
};
Book.reloadFigure = src => { figCache.delete(Book.url(src)); Book.root.querySelectorAll('b-fig').forEach(f => { if (f.getAttribute('src') === src) f.load(); }); };
Book.initLive = fig => { const k = fig.getAttribute('live'); if (k && window.BookLive && window.BookLive[k] && fig.querySelector('svg')) window.BookLive[k](fig); };

function hash(str) {   // cyrb53, as 11 base-36 chars
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
let eqActive = 0; const eqWaiting = [];   // at most 3 render requests at once, so saves and page loads are never stuck behind TeX
const eqSlot = () => new Promise(res => { const go = () => { eqActive++; res(() => { eqActive--; const n = eqWaiting.shift(); if (n) n(); }); }; if (eqActive < 3) go(); else eqWaiting.push(go); });
const texOf = el => el.textContent.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
Book.texOf = texOf;
class BEq extends HTMLElement {
  connectedCallback() { if (inThumb(this)) return; lock(this); this.render(); }
  rows() {
    return [...this.children].filter(c => /^EQ-(ROW|STEP)$/.test(c.tagName)).map(c => c.tagName === 'EQ-ROW'
      ? ['eq', Book.eqNum(c), c.getAttribute('note') || null, texOf(c)] : ['step', texOf(c)]);
  }
  render() {
    Book.numberEquations();
    const rows = this.rows();
    const key = hash(JSON.stringify([rows, Book.meta.colors || {}, Book.kit]));
    if (key === this._key) return this._done;
    this._key = key;
    const url = Book.url('eq/' + key + '.svg');
    this.classList.add('busy');
    const done = async () => {
      let err = '';
      try {
        let ok = (await fetch(url, { method: 'HEAD' })).ok;
        if (!ok && Book.api) {
          const release = await eqSlot();
          try {
            if (this._key !== key) return;
            const r = await fetch('../api/eq/' + Book.chapter, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, rows, colors: Book.meta.colors || {} }) });
            ok = r.ok; if (!ok) err = (await r.json().catch(() => ({}))).error || 'could not render';
          } finally { release(); }
        } else if (!ok) err = 'equation image missing';
      } catch (e) { err = String(e.message || e); }
      if (this._key !== key) return;
      this.querySelectorAll(':scope > [data-rt]').forEach(n => { if (err || n.tagName !== 'IMG') n.remove(); });
      this.classList.remove('busy');
      this.classList.toggle('bad', !!err);
      this.error = err;
      if (err) {
        const d = document.createElement('div'); d.className = 'eq-err'; d.setAttribute('data-rt', ''); d.textContent = err; this.append(d);
      } else {
        const old = this.querySelector(':scope > img[data-rt]');
        const img = document.createElement('img'); img.setAttribute('data-rt', ''); img.alt = rows.map(r => r[r.length - 1]).join('; ');
        await new Promise(res => { img.onload = img.onerror = res; img.src = url; });
        if (this._key !== key) return;
        if (old) old.replaceWith(img); else this.append(img);
        this.querySelectorAll(':scope > eq-row[label]').forEach(r => { const a = document.createElement('a'); a.id = 'eq-' + r.getAttribute('label'); a.setAttribute('data-rt', ''); this.prepend(a); });
      }
      this.dispatchEvent(new CustomEvent('eq-rendered', { bubbles: true }));
      Book.refreshSoon();
    };
    return this._done = track(done());
  }
}
class BCode extends HTMLElement {
  connectedCallback() { if (inThumb(this)) return; lock(this); if (!this.hasAttribute('data-src')) this.setAttribute('data-src', rawText(this)); this.render(); }
  get src() { return this.getAttribute('data-src') || ''; }
  set src(v) { this.setAttribute('data-src', v); this.render(); Book.refreshSoon(); }
  render() {
    const lines = this.src.split('\n'), marks = {};
    // marks="3:4-18:gold 7:0-9:blue": a tinted box behind part of a line (1-based line, 0-based columns)
    (this.getAttribute('marks') || '').split(/[\s;]+/).forEach(m => { const q = /^(\d+):(\d+)-(\d+)(?::(\w+))?$/.exec(m); if (q) (marks[q[1] - 1] = marks[q[1] - 1] || []).push([+q[2], +q[3], q[4] || 'gold']); });
    const line = (l, k) => {
      if (!marks[k]) return highlight(l);
      let out = '', at = 0;
      for (const [a, b, c] of marks[k].sort((x, y) => x[0] - y[0])) { if (a < at || b <= a) continue; out += highlight(l.slice(at, a)) + `<mark class="${c}">${highlight(l.slice(a, b))}</mark>`; at = b; }
      return out + highlight(l.slice(at));
    };
    // "#~ name" at the end of a line links it to the piece of the paired equation marked \lk{name}{…} (hidden here)
    const lk = lines.map(l => /\s*#~\s*([\w-]+(?:[\s,]+[\w-]+)*)\s*$/.exec(l));
    const shown = lines.map((l, k) => lk[k] ? l.slice(0, lk[k].index) : l);
    this.innerHTML = `<div class="gutter" aria-hidden="true">${lines.map((_, k) => `<div>${k + 1}</div>`).join('')}</div><div class="src">${shown.map((l, k) => `<div class="ln"${lk[k] ? ` data-lk="${lk[k][1].split(/[\s,]+/).join(' ')}"` : ''}>${line(l, k)}</div>`).join('')}</div>`;
  }
}
class BMatmul extends HTMLElement {
  static get observedAttributes() { return ['spec']; }
  connectedCallback() { if (inThumb(this)) return; lock(this); if (!window.eaiMatmulOne) eaiMatmul(); this._mm = 1; window.eaiMatmulOne(this); }
  attributeChangedCallback() { if (this.isConnected && window.eaiMatmulOne && !inThumb(this)) { this._mm = 1; window.eaiMatmulOne(this); Book.refreshSoon(); } }
}
class BOut extends BCode {
  render() { this.innerHTML = `<div class="label">Output</div><pre>${esc(this.src)}</pre>`; }
}
// <b-embed src="https://…/pca.html" title="PCA visualizer" height="640" poster="fig/x.svg"></b-embed>
// An interactive page from elsewhere. The web page shows it in a frame, wider than the text column when there is room;
// the PDF (and the editor) show the poster picture, if any, and a line saying where to find it.
const plain = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
class BEmbed extends HTMLElement {
  static get observedAttributes() { return ['src', 'title', 'height', 'poster', 'show']; }
  connectedCallback() { if (inThumb(this)) return; lock(this); this.render(); }
  attributeChangedCallback() { if (this.isConnected && !inThumb(this)) { this.render(); Book.refreshSoon(); } }
  render() {
    const src = this.getAttribute('src') || '', title = this.getAttribute('title') || 'Interactive', hgt = Math.max(200, parseInt(this.getAttribute('height')) || 640), poster = this.getAttribute('poster');
    const ok = /^https?:\/\//.test(src), short = src.replace(/^https?:\/\//, '');
    // the course site's pages have an embed mode (no site header or footer; "viz" also drops the info column) and report their height
    const own = /^https?:\/\/([\w-]+\.)*williamtheisen\.com\//.test(src) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(src);
    const framed = own ? src.replace(/#.*$/, '') + (src.includes('?') ? '&' : '?') + 'embed=' + (this.getAttribute('show') === 'viz' ? 'viz' : '1') : src;
    let html = `<div class="card" data-rt>${poster ? `<img src="${plain(Book.url(poster))}" alt="">` : ''}<div class="cap"><span class="play">▶</span><span><b>${plain(title)}</b><br><span class="u">Interactive, in the web edition: ${ok ? `<a href="${plain(src)}">${plain(short)}</a>` : 'set its address in the side panel'}</span></span></div></div>`;
    if (Book.web && ok) html += `<div class="frame web-only" data-rt><iframe ${Book.exporting ? 'data-frame' : 'src'}="${plain(framed)}" title="${plain(title)}" loading="lazy" style="height:${hgt}px" allow="fullscreen"></iframe>`
      + `<div class="bar"><span>${plain(title)}</span><a href="${plain(src)}" target="_blank" rel="noopener">Open in a new tab ↗</a></div></div>`;
    this.innerHTML = html;
  }
}
// a framed page from the course site says how tall it is; make its frame that tall
const FIT = "addEventListener('message',function(e){var d=e.data;if(!d||d.type!=='eai-embed-height'||!(d.height>100))return;[].forEach.call(document.querySelectorAll('b-embed iframe'),function(f){if(f.contentWindow===e.source)f.style.height=Math.min(d.height,2400)+'px'})});";
if (typeof window !== 'undefined' && !window._eaiFit) { window._eaiFit = true; new Function(FIT)(); }
// A figure with viz="address of a visualizer state" is a snapshot of that visualizer: the PDF and the editor show the picture;
// the web page lays the live visualizer (its figure mode: the canvas alone) over the picture once it has loaded and restored the state.
const LIVEFIG = "function eaiLiveFig(fig){var u=fig.getAttribute('viz');if(fig._viz||!u||!/^https?:\\/\\//.test(u))return;fig._viz=1;fig.classList.add('viz');"
  + "var io=new IntersectionObserver(function(es){if(!es.some(function(e){return e.isIntersecting}))return;io.disconnect();"
  + "var f=document.createElement('iframe');f.className='vizf';f.title=fig.getAttribute('alt')||'Interactive figure';f.setAttribute('scrolling','no');f.src=u+(u.indexOf('?')<0?'?':'&')+'embed=fig&theme=light';"
  + "var a=document.createElement('a');a.className='vizl';a.href=u;a.target='_blank';a.rel='noopener';a.textContent='Live \u00b7 open the full tool \u2197';"
  + "addEventListener('message',function on(e){if(e.source!==f.contentWindow||!e.data||e.data.type!=='eai-ready')return;removeEventListener('message',on);fig.classList.add('viz-on')});"
  + "fig.appendChild(f);fig.appendChild(a)},{rootMargin:'300px'});io.observe(fig)}";
if (typeof window !== 'undefined' && !window.eaiLiveFig) window.eaiLiveFig = new Function(LIVEFIG + ';return eaiLiveFig')();
Book.goLive = fig => { if (Book.web && !Book.exporting && fig.hasAttribute('viz')) window.eaiLiveFig(fig); };
class BToc extends HTMLElement { connectedCallback() { if (inThumb(this)) return; lock(this); Book.refreshSoon(); } }
class BAnswers extends HTMLElement { connectedCallback() { if (inThumb(this)) return; lock(this); Book.refreshSoon(); } }
Book.define = () => {
  for (const [n, c] of [['b-m', BM], ['b-ref', BRef], ['b-fig', BFig], ['b-eq', BEq], ['b-code', BCode], ['b-out', BOut], ['b-matmul', BMatmul], ['b-answers', BAnswers], ['b-toc', BToc], ['b-embed', BEmbed]])
    if (!customElements.get(n)) customElements.define(n, c);
};

// ---------------------------------------------------------------- equation numbers
// An <eq-row label="name"> is numbered in document order: [chapter.n] (meta.chapter), or [n] without a chapter number.
// <eq-row same="name"> repeats another equation's number (a recap) without taking one. A literal num="4.2" is kept as is.
Book.eqNums = {};
Book.numberEquations = () => {
  if (!Book.root) return;
  const pre = Book.meta.chapter != null && Book.meta.chapter !== '' ? Book.meta.chapter + '.' : '', nums = {};
  let n = 0;
  Book.root.querySelectorAll('eq-row[label]').forEach(r => { const pg = r.closest('section.page'); if (pg && !Book.inView(pg)) return; const l = r.getAttribute('label'); if (l && !r.hasAttribute('same') && !(l in nums)) nums[l] = pre + (++n); });   // numbered per edition
  Book.eqNums = nums;
};
Book.eqNum = row => row.hasAttribute('same') ? (Book.eqNums[row.getAttribute('same')] || '?') : row.hasAttribute('label') ? (Book.eqNums[row.getAttribute('label')] || null) : (row.getAttribute('num') || null);

// ---------------------------------------------------------------- load
Book.parse = html => {
  let meta = {};
  html = html.replace(/<script type="application\/json" id="book-meta">([\s\S]*?)<\/script>\s*/, (_, j) => { try { meta = JSON.parse(j); } catch (e) { console.error('book-meta', e); } return ''; });
  return { meta, body: html };
};
Book.load = (root, html) => {
  const { meta, body } = Book.parse(html);
  Book.root = root; Book.meta = meta;
  Book.define();
  root.innerHTML = body;
  Book.refresh();
};
Book.pages = () => [...Book.root.querySelectorAll(':scope > section.page')];
Book.blocks = pg => [...pg.children].filter(el => !el.hasAttribute('data-rt') && !el.classList.contains('overlay') && !el.classList.contains('cmt'));
Book.isPinned = el => el.style.position === 'absolute';
Book.ready = async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (let k = 0; k < 50 && Book.pending.size; k++) await Promise.allSettled([...Book.pending]);
  await new Promise(r => { const t = setTimeout(r, 150); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); });   // rAF never fires in a background tab
};

// ---------------------------------------------------------------- page furniture: numbers, footers, references, spacing
let soon = 0;
Book.views = ['reading', 'slides', 'workbook'];
Book.view = 'reading';
Book.setView = v => { Book.view = Book.views.includes(v) ? v : 'reading'; if (Book.root) { Book.root.dataset.view = Book.view; Book.refresh(); } };
Book.inView = (el, v) => {
  v = v || Book.view;
  if (el.hasAttribute('data-view')) return el.getAttribute('data-view').split(/\s+/).includes(v);
  if (v === 'reading') return !(el.localName === 'aside' && el.classList.contains('qc'));   // questions belong to the lecture and the workbook; Reading is just reading
  if (el.classList.contains('aside') || el.localName === 'b-answers') return false;          // notes and the answer list are for reading
  const top = el.parentElement && el.parentElement.classList.contains('page');
  if (Book.hasKeys && top && el.tagName === 'P' && !el.querySelector('.key')) return false;   // in a chapter with key sentences, a paragraph without one is reading only
  return true;
};
Book.refreshSoon = () => { if (!soon) soon = setTimeout(() => { soon = 0; if (Book.root) Book.refresh(); }, 60); };
Book.refresh = () => {
  const root = Book.root, pages = Book.pages(), num = {}, title = Book.meta.title || '';
  if (root.dataset.view !== Book.view) root.dataset.view = Book.view;
  Book.hasKeys = !Book.meta.split && !!root.querySelector('.page > p .key'); root.classList.toggle('keys', Book.hasKeys);   // key sentences: the old shared-page model only
  Book.split = !!Book.meta.split; root.classList.toggle('split', Book.split);   // split: Lecture and Reading are separate documents in one file
  const shown = pages.filter(pg => Book.inView(pg));   // page numbers and running heads count only this edition's pages
  shown.forEach((pg, k) => { if (pg.id) num[pg.id] = k + 1; });
  let part = '';
  shown.forEach((pg, k) => {
    if (pg.dataset.part) part = pg.dataset.part;
    let foot = pg.querySelector(':scope > .foot');
    const label = title + (part ? ' · ' + part : ''), n = String(k + 1).padStart(2, '0');
    if (!foot) { foot = document.createElement('div'); foot.className = 'foot'; foot.setAttribute('data-rt', ''); foot.setAttribute('contenteditable', 'false'); foot.innerHTML = '<span></span><span></span>'; }
    if (foot !== pg.lastElementChild) pg.append(foot);
    if (foot.children[0].textContent !== label) foot.children[0].textContent = label;
    if (foot.children[1].textContent !== n) foot.children[1].textContent = n;
  });
  Book.numberEquations();
  root.querySelectorAll('b-eq').forEach(e => e.render && e.render());   // numbers may have shifted
  root.querySelectorAll('b-ref').forEach(r => {
    let h = '';
    if (r.hasAttribute('page')) { const p = r.getAttribute('page'); h = `<a href="#${escAttr(p)}">page ${num[p] || '?'}</a>`; }
    else if (r.hasAttribute('pages')) { const [a, b] = r.getAttribute('pages').split(':'); h = `pp. ${num[a] || '?'}–${num[b] || '?'}`; }
    else if (r.hasAttribute('eq')) { const e = r.getAttribute('eq'), known = e in Book.eqNums, lit = /^[\d.]+$/.test(e); h = `<a href="#eq-${escAttr(e)}"${known || lit ? '' : ' class="bad"'}>[${esc(known ? Book.eqNums[e] : lit ? e : '?')}]</a>`; }
    if (r.innerHTML !== h) r.innerHTML = h;
  });
  root.querySelectorAll('b-toc').forEach(box => {   // contents: one line per page that starts a section
    const rows = pages.filter(p => p.dataset.part && p.id && num[p.id]), key = rows.map(p => p.id + '\u0001' + p.dataset.part + '\u0001' + num[p.id]).join('\u0002');
    if (box._key === key && box.childElementCount === rows.length) return; box._key = key;
    box.replaceChildren(...rows.map(p => { const a = document.createElement('a'); a.setAttribute('data-rt', ''); a.href = '#' + p.id; a.innerHTML = `<span>${esc(p.dataset.part)}</span><i></i><span>${num[p.id]}</span>`; return a; }));
  });
  const answers = root.querySelectorAll('b-answers');
  if (answers.length) {   // <b-answers pages="id id"> lists only those pages' answers, a plain <b-answers> lists the rest
    const all = [...root.querySelectorAll('.qc > .ans')], ids = b => (b.getAttribute('pages') || '').split(/\s+/).filter(Boolean);
    const claimed = new Set([...answers].flatMap(ids));
    answers.forEach(box => {
      const mine = new Set(ids(box)), list = all.filter(a => { const id = a.closest('.page')?.id; return mine.size ? mine.has(id) : !claimed.has(id); });
      const key = list.map(a => (num[a.closest('.page').id] || 0) + '\u0001' + Book.inlineSource(a)).join('\u0002');
      if (box._key === key) return; box._key = key;
      box.replaceChildren(...list.map(a => {
        const d = document.createElement('div'); d.setAttribute('data-rt', '');
        d.innerHTML = `<b>p. ${num[a.closest('.page').id] || '?'}:</b> ` + Book.inlineSource(a);
        return d;
      }));
    });
  }
  // spacing: spread each page's spare room evenly between its blocks (up to +12pt per gap); flag overflow
  const report = [];
  root.classList.add('measure-print');   // code versions of equations (b-code[dual]) aren't printed: lay out without them
  pages.forEach((pg, k) => {
    if (pg.classList.contains('cover')) return;
    const r = pg.getBoundingClientRect(); if (!r.width) return;
    const s = r.width / 432, cur = parseFloat(pg.style.getPropertyValue('--gap')) || 10;
    let bottom = 0, right = 0, n = 0, joined = 0, pinBottom = 0;
    for (const el of pg.children) {
      if (el.hasAttribute('data-rt') || el.classList.contains('web-only') || el.classList.contains('overlay') || el.classList.contains('ink') || !Book.inView(el)) continue;   // svg.ink: the pen layer covers the whole page
      const q = el.getBoundingClientRect(); if (!q.height) continue;
      right = Math.max(right, (q.right - r.left) / s);
      if (Book.isPinned(el)) { pinBottom = Math.max(pinBottom, (q.bottom - r.top) / s); continue; }
      bottom = Math.max(bottom, (q.bottom - r.top) / s); n++;
      if (el.tagName === 'B-CODE' && el.nextElementSibling && el.nextElementSibling.tagName === 'B-OUT') joined++;
    }
    const gaps = Math.max(0, n - 1 - joined), base = bottom - gaps * (cur - 10), free = 604 - base;
    let gap = cur;
    if (!Book.freezeGaps) {
      gap = free > 6 && gaps > 0 ? +(10 + Math.min(free / gaps, 12)).toFixed(1) : 10;
      if (Math.abs(gap - cur) > 0.05) { if (gap === 10) pg.style.removeProperty('--gap'); else pg.style.setProperty('--gap', gap + 'pt'); }
    }
    const end = Math.round(Math.max(base + gaps * (gap - 10), pinBottom)), over = end > 622 || Math.round(right) > 409;
    pg.classList.toggle('over', over);
    if (over) report.push({ page: k + 1, id: pg.id, bottom: end, right: Math.round(right) });
  });
  root.classList.remove('measure-print');
  Book.report = report;
  root.dispatchEvent(new CustomEvent('book-refresh'));
};

// ---------------------------------------------------------------- serialize: DOM -> chapter file
const SVGNS = 'http://www.w3.org/2000/svg';
const VOID = new Set(['br', 'img', 'hr', 'input', 'col', 'wbr']);
const BLOCKY = new Set(['section', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'dl', 'b-eq', 'svg', 'g', 'defs', 'marker']);
const STRUCT = new Set([...BLOCKY, 'tr']);
const BLOCK_CHILD = /^(div|p|h[1-6]|ul|ol|dl|table|b-eq|b-fig|b-code|b-out|aside|figure)$/;
const SKIP_ATTR = new Set(['contenteditable', 'spellcheck', 'draggable', 'data-src', 'tex']);
const INLINE_STYLE_DROP = /^(b|i|u|span|font|code|a|sub|sup|li|td|th|p|h[1-6])$/;
function attrs(el) {
  let s = '';
  for (const a of el.attributes) {
    const n = a.name; let v = a.value;
    if (SKIP_ATTR.has(n) || n.startsWith('data-ed')) continue;
    if (n === 'class') { v = v.split(/\s+/).filter(c => c && !c.startsWith('ed-') && c !== 'live-on' && c !== 'over' && c !== 'busy' && c !== 'bad').join(' '); if (!v) continue; }
    if (n === 'style') {
      if (INLINE_STYLE_DROP.test(el.localName) && !Book.isPinned(el)) continue;
      v = v.split(';').map(d => d.trim()).filter(d => d && !d.startsWith('--gap')).join('; '); if (!v) continue;
    }
    s += ` ${n}="${escAttr(v)}"`;
  }
  return s;
}
const skip = n => n.nodeType === 1 && (n.hasAttribute('data-rt') || n.hasAttribute('data-ed'));
function inline(node, parentStruct) {
  if (node.nodeType === 3) { const t = node.nodeValue.replace(/[ \t\r\n]+/g, ' '); return parentStruct && !t.trim() ? '' : esc(t); }
  if (node.nodeType === 8) return `<!--${node.nodeValue}-->`;
  if (node.nodeType !== 1 || skip(node)) return '';
  let tag = node.localName;
  if (tag === 'b-m') return `<b-m>${esc(node.getAttribute('tex') || '')}</b-m>`;
  if (tag === 'b-ref' || tag === 'b-fig' || tag === 'b-answers' || tag === 'b-toc' || tag === 'b-embed') return `<${tag}${attrs(node)}></${tag}>`;
  if (tag === 'b-code' || tag === 'b-out') return `<${tag}${attrs(node)}>\n${esc(node.getAttribute('data-src') || '')}\n</${tag}>`;
  if (tag === 'eq-row' || tag === 'eq-step') return `<${tag}${attrs(node)}>${esc(texOf(node))}</${tag}>`;
  if ((tag === 'span' && !node.className && !node.id) || tag === 'font') return kids(node, false);
  if (tag === 'strong') tag = 'b'; else if (tag === 'em') tag = 'i';
  if (VOID.has(tag)) return `<${tag}${attrs(node)}>`;
  return `<${tag}${attrs(node)}>${kids(node, STRUCT.has(tag))}</${tag}>`;
}
const kids = (el, struct) => [...el.childNodes].map(n => inline(n, struct)).join('');
Book.inlineSource = el => kids(el, false).trim();
function isContainer(el) {
  if (el.localName !== 'div') return false;
  let block = false;
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.nodeValue.trim()) return false;
    if (n.nodeType === 1 && !skip(n) && BLOCK_CHILD.test(n.localName)) block = true;
  }
  return block;
}
function block(node, ind) {
  const pad = ' '.repeat(ind);
  if (node.nodeType === 3) { const t = node.nodeValue.replace(/\s+/g, ' ').trim(); return t ? pad + esc(t) : ''; }
  if (node.nodeType === 8) return pad + `<!--${node.nodeValue}-->`;
  if (node.nodeType !== 1 || skip(node)) return '';
  const tag = node.localName;
  if (BLOCKY.has(tag) || isContainer(node)) {
    if (node.namespaceURI === SVGNS && !node.firstElementChild) return `${pad}<${tag}${attrs(node)}></${tag}>`;
    const inner = [...node.childNodes].map(n => n.nodeType === 8 && node.namespaceURI === SVGNS ? '' : block(n, ind + 2)).filter(Boolean);
    return `${pad}<${tag}${attrs(node)}>\n${inner.join('\n')}${inner.length ? '\n' : ''}${pad}</${tag}>`;
  }
  if (/^(b-|eq-)/.test(tag) || VOID.has(tag)) return pad + inline(node, false);
  if (node.namespaceURI === SVGNS && !node.firstChild) return `${pad}<${tag}${attrs(node)}/>`;
  return `${pad}<${tag}${attrs(node)}>${kids(node, STRUCT.has(tag)).replace(/^(\s|&nbsp;)+|(\s|&nbsp;|<br>)+$/g, '')}</${tag}>`;
}
Book.serializePage = pg => block(pg, 0);
Book.serializeBlock = el => block(el, 0);
Book.metaSource = () => `<script type="application/json" id="book-meta">\n${JSON.stringify(Book.meta, null, 1)}\n</script>`;
Book.serialize = () => [Book.metaSource(), ...[...Book.root.childNodes].map(n => block(n, 0)).filter(Boolean)].join('\n\n') + '\n';


// ---------------------------------------------------------------- runnable code (web edition only)
// Every <b-code lang="python"> gets Run / Edit / Reset in the web page. The first Run loads Pyodide (CPython in WebAssembly)
// from the CDN, then whatever packages the code imports; files="url url" are fetched and written next to the code, so
// pd.read_csv("nd_football.csv") just works. Output replaces the printed output (the <b-out> right after the block).
// The PDF and the editor never see any of this: the bar is web-only and only the published page and the viewer start it.
// Self-contained on purpose: Book.snapshot() copies this function's source into the published page.
// Matrices: <b-matmul spec='{"vars":{"X":[[1,2],…]},"steps":[{"op":"mul","a":"X","b":"w","out":"ŷ"}],"colors":{"X":"blue"}}'>
// walks through the matrix arithmetic behind an equation, one step at a time. Steps: T (transpose), mul, add, inv (2×2).
// Tapping (or hovering) a cell of a product lights the row and column it comes from and writes the sum out in full.
// In a Math | Code pair it becomes a third face, "Matrices" (see eaiDual). Not printed.
function eaiMatmul() {
  var HEX = { blue: '#002B5B', gold: '#B8920F', purple: '#674EA7', green: '#38761D', red: '#CC0000', navy: '#002B5B' };
  function fmt(v) { if (Math.abs(v - Math.round(v)) < 1e-9) v = Math.round(v); else v = +v.toFixed(3); return (v < 0 ? '−' : '') + Math.abs(v); }
  function paren(v) { return v < 0 ? '(' + fmt(v) + ')' : fmt(v); }
  function T(m) { return m[0].map(function (_, j) { return m.map(function (r) { return r[j]; }); }); }
  function mul(a, b) { return a.map(function (r) { return b[0].map(function (_, j) { return r.reduce(function (s, x, k) { return s + x * b[k][j]; }, 0); }); }); }
  function add(a, b) { return a.map(function (r, i) { return r.map(function (x, j) { return x + b[i][j]; }); }); }
  function inv(m) { var d = m[0][0] * m[1][1] - m[0][1] * m[1][0]; return [[m[1][1] / d, -m[0][1] / d], [-m[1][0] / d, m[0][0] / d]]; }
  function one(el) {
    var spec; try { spec = JSON.parse(el.getAttribute('spec') || '{}'); } catch (e) { el.innerHTML = '<div class="mm-err">Matrices: the spec isn\'t valid JSON (' + e.message + ')</div>'; return; }
    var V = {}, steps = spec.steps || [], colors = spec.colors || {}, err = '';
    Object.keys(spec.vars || {}).forEach(function (k) { V[k] = spec.vars[k]; });
    steps.forEach(function (st) {
      try {
        if (st.op === 'T') V[st.out] = T(V[st.a]);
        else if (st.op === 'mul') { if (V[st.a][0].length !== V[st.b].length) throw new Error(st.a + ' is ' + V[st.a].length + '×' + V[st.a][0].length + ' and ' + st.b + ' is ' + V[st.b].length + '×' + V[st.b][0].length); V[st.out] = mul(V[st.a], V[st.b]); }
        else if (st.op === 'add') V[st.out] = add(V[st.a], V[st.b]);
        else if (st.op === 'inv') V[st.out] = inv(V[st.a]);
      } catch (e) { err = err || ('step "' + (st.out || '?') + '": ' + (e.message || 'unknown matrix')); }
    });
    if (err) { el.innerHTML = '<div class="mm-err">Matrices: ' + err + '</div>'; return; }
    var col = function (name) { var c = colors[name] || colors[String(name).replace(/[ᵀ⁻¹()\s]/g, '')] || colors[String(name)[0]]; return HEX[c] || HEX.navy; };
    function mat(name, role) {
      var m = V[name], h = '<div class="mm-m" data-role="' + role + '"><div class="mm-grid" style="--c:' + col(name) + ';grid-template-columns:repeat(' + m[0].length + ',auto)">';
      m.forEach(function (r, i) { r.forEach(function (x, j) { h += '<span class="mm-c" data-i="' + i + '" data-j="' + j + '">' + fmt(x) + '</span>'; }); });
      return h + '</div><div class="mm-lab" style="color:' + col(name) + '">' + name + ' <small>' + m.length + '×' + m[0].length + '</small></div></div>';
    }
    var at = 0;
    function draw() {
      var st = steps[at], h = '<div class="mm-bar"><button type="button" data-g="-1"' + (at ? '' : ' disabled') + '>◀</button><span>Step ' + (at + 1) + ' of ' + steps.length + (st.title ? ': ' + st.title : '') + '</span><button type="button" data-g="1"' + (at < steps.length - 1 ? '' : ' disabled') + '>▶</button></div><div class="mm-row">';
      if (st.op === 'T') h += mat(st.a, 'a') + '<span class="mm-op">→</span>' + mat(st.out, 'c');
      else if (st.op === 'mul') h += mat(st.a, 'a') + '<span class="mm-op">·</span>' + mat(st.b, 'b') + '<span class="mm-op">=</span>' + mat(st.out, 'c');
      else if (st.op === 'add') h += mat(st.a, 'a') + '<span class="mm-op">+</span>' + mat(st.b, 'b') + '<span class="mm-op">=</span>' + mat(st.out, 'c');
      else if (st.op === 'inv') h += mat(st.a, 'a') + '<span class="mm-op">→</span>' + mat(st.out, 'c');
      h += '</div><div class="mm-say"></div>' + (st.note ? '<div class="mm-note">' + st.note + '</div>' : '');
      el.innerHTML = h; pick(0, 0);
    }
    function pick(i, j) {
      var st = steps[at], A = V[st.a], B = V[st.b], C = V[st.out], say = el.querySelector('.mm-say');
      [].forEach.call(el.querySelectorAll('.mm-c'), function (c) { c.classList.remove('on', 'src'); });
      var cell = function (role, r, c) { return el.querySelector('[data-role="' + role + '"] .mm-c[data-i="' + r + '"][data-j="' + c + '"]'); };
      var mark = function (role, r, c) { var x = cell(role, r, c); if (x) x.classList.add('src'); };
      var on = cell('c', i, j); if (on) on.classList.add('on');
      var row = ' row ' + (i + 1) + ', column ' + (j + 1);
      if (st.op === 'mul') {
        var terms = [], k;
        for (k = 0; k < A[0].length; k++) { mark('a', i, k); mark('b', k, j); terms.push(paren(A[i][k]) + '·' + paren(B[k][j])); }
        say.innerHTML = '<b>' + st.out + '</b>' + row + ' = row ' + (i + 1) + ' of <b>' + st.a + '</b> · column ' + (j + 1) + ' of <b>' + st.b + '</b> = ' + terms.join(' + ') + ' = <b>' + fmt(C[i][j]) + '</b>';
      } else if (st.op === 'add') { mark('a', i, j); mark('b', i, j); say.innerHTML = '<b>' + st.out + '</b>' + row + ' = ' + paren(A[i][j]) + ' + ' + paren(B[i][j]) + ' = <b>' + fmt(C[i][j]) + '</b>'; }
      else if (st.op === 'T') { mark('a', j, i); say.innerHTML = '<b>' + st.out + '</b>' + row + ' is <b>' + st.a + '</b> row ' + (j + 1) + ', column ' + (i + 1) + ': rows become columns'; }
      else if (st.op === 'inv') {
        var a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1], det = a * d - b * c;
        [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(function (p) { mark('a', p[0], p[1]); });
        say.innerHTML = 'For a 2×2, swap the diagonal, negate the other two and divide by the determinant: ' + paren(a) + '·' + paren(d) + ' − ' + paren(b) + '·' + paren(c) + ' = <b>' + fmt(det) + '</b>. So <b>' + st.out + '</b> = 1/' + fmt(det) + ' · [' + fmt(d) + ', ' + fmt(-b) + '; ' + fmt(-c) + ', ' + fmt(a) + ']' + row.replace(' row', ', and its row') + ' is <b>' + fmt(C[i][j]) + '</b>';
      }
    }
    el.onclick = function (e) {
      var g = e.target.getAttribute && e.target.getAttribute('data-g'); if (g) { at = Math.max(0, Math.min(steps.length - 1, at + +g)); draw(); return; }
      var c = e.target.closest && e.target.closest('[data-role="c"] .mm-c'); if (c) pick(+c.getAttribute('data-i'), +c.getAttribute('data-j'));
    };
    el.onpointerover = function (e) { var c = e.target.closest && e.target.closest('[data-role="c"] .mm-c'); if (c && e.pointerType === 'mouse') pick(+c.getAttribute('data-i'), +c.getAttribute('data-j')); };
    el._tallest = function () { var keep = at, h = 0; el.style.minHeight = ''; for (at = 0; at < steps.length; at++) { draw(); h = Math.max(h, el.offsetHeight); } at = keep; draw(); return h; };
    if (steps.length) draw(); else el.innerHTML = '<div class="mm-err">Matrices: no steps yet</div>';
  }
  window.eaiMatmulOne = one;
  [].forEach.call(document.querySelectorAll('b-matmul'), function (el) { if (!el._mm) { el._mm = 1; one(el); } });
}
// Math / Code: an equation followed by <b-code dual> (its code version) becomes one block with a Math | Code switch.
// The pair keeps the taller of its two heights so switching never moves anything else on the page (ink stays put).
// A navbar button flips every pair at once and is remembered in this browser. Print shows the equation only.
function eaiDual() {
  var KEY = 'eai-dual', pairs = [];
  if (typeof eaiMatmul === 'function') eaiMatmul();
  var get = function () { try { return localStorage.getItem(KEY) || 'math'; } catch (e) { return 'math'; } };
  var put = function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} };
  // an equation and the faces after it: a code version (b-code[dual], plus its output) and/or a matrix walk-through
  [].forEach.call(document.querySelectorAll('b-eq'), function (eq) {
    var faces = [['math', [eq]]], n = eq.nextElementSibling, code = null, mat = null;
    while (n) {
      if (n.tagName === 'B-CODE' && n.hasAttribute('dual') && !code) { code = [n]; if (n.nextElementSibling && n.nextElementSibling.tagName === 'B-OUT') { n = n.nextElementSibling; code.push(n); } }
      else if (n.tagName === 'B-MATMUL' && n.hasAttribute('dual') && !mat) mat = [n];
      else break;
      n = n.nextElementSibling;
    }
    if (mat) faces.push(['mat', mat]); if (code) faces.push(['code', code]);
    if (faces.length < 2) return;
    var box = document.createElement('div'); box.className = 'dual'; box._faces = faces.map(function (f) { return f[0]; });
    var tabs = document.createElement('div'); tabs.className = 'dual-tabs'; tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = faces.map(function (f) { return '<button type="button" data-m="' + f[0] + '" role="tab">' + { math: 'Math', mat: 'Matrices', code: 'Code' }[f[0]] + '</button>'; }).join('');
    eq.before(box); box.appendChild(tabs);
    faces.forEach(function (f) { f[1].forEach(function (el) { el.setAttribute('data-f', f[0]); box.appendChild(el); }); });
    tabs.addEventListener('click', function (e) { var m = e.target.getAttribute && e.target.getAttribute('data-m'); if (m) show(box, m); });
    pairs.push(box);
  });
  if (!pairs.length) return;
  function show(box, m) {
    if (box._faces.indexOf(m) < 0) m = 'math';
    box.setAttribute('data-face', m); box.classList.toggle('show-code', m === 'code');
    [].forEach.call(box.querySelectorAll('.dual-tabs button'), function (b) { var on = b.getAttribute('data-m') === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  }
  function fit() {   // reserve the tallest face (and the tallest step of a matrix walk-through)
    pairs.forEach(function (box) {
      var cur = box.getAttribute('data-face') || 'math', h = 0; box.style.minHeight = '';
      box.classList.add('measure');
      box._faces.forEach(function (f) { show(box, f); var mm = f === 'mat' && box.querySelector('b-matmul'); if (mm && mm._tallest) mm.style.minHeight = mm._tallest() + 'px'; h = Math.max(h, box.offsetHeight); });
      box.classList.remove('measure'); show(box, cur); box.style.minHeight = h + 'px';
    });
  }
  function all(m) { pairs.forEach(function (b) { show(b, m); }); put(m); btn.classList.toggle('on', m === 'code'); btn.querySelector('span').textContent = m === 'code' ? 'Code' : 'Math'; }
  var tools = document.querySelector('.navbar .tools'), btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'nb'; btn.id = 'dual-all'; btn.title = 'Show every equation as math or as code';
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4"/></svg><span>Math</span>';
  btn.onclick = function () { all(btn.classList.contains('on') ? 'math' : 'code'); };
  if (tools) tools.insertBefore(btn, tools.firstChild);
  all(get()); fit();
  // links: hovering (or tapping) a linked code line shows the equation with its piece lit; hovering a lit piece of
  // the equation shows the code that computes it. Both are floating cards, so nothing on the page moves.
  pairs.forEach(function (box) {
    var eq = box.querySelector('b-eq'), img = eq && eq.querySelector('img'), lines = box.querySelectorAll('b-code .ln[data-lk]');
    if (!img || !lines.length) return;
    fetch(img.src).then(function (r) { return r.text(); }).then(function (sv) {
      var m = /<metadata id="eai-links">([\s\S]*?)<\/metadata>/.exec(sv), vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(sv);
      if (!m || !vb) return;
      var L = JSON.parse(m[1]), W = +vb[1], card = null;
      box.classList.add('linked');
      function names(el) { return (el.getAttribute('data-lk') || '').split(' ').filter(function (n) { return L[n]; }); }
      function lit(host, pic, ns) {   // gold boxes over the named pieces of an equation picture
        [].forEach.call(host.querySelectorAll('.lk-hl'), function (d) { d.remove(); });
        var k = pic.clientWidth / W, ox = pic.offsetLeft, oy = pic.offsetTop;
        ns.forEach(function (n) { (L[n] || []).forEach(function (r) {
          var d = document.createElement('div'); d.className = 'lk-hl';
          d.style.cssText = 'left:' + (ox + r[0] * k) + 'px;top:' + (oy + r[1] * k) + 'px;width:' + r[2] * k + 'px;height:' + r[3] * k + 'px';
          host.appendChild(d); }); });
      }
      function hide() { if (card) card.remove(); card = null; [].forEach.call(box.querySelectorAll('.lk-on'), function (l) { l.classList.remove('lk-on'); }); [].forEach.call(eq.querySelectorAll('.lk-hl'), function (d) { d.remove(); }); }
      function place(el) {   // a card just above el (or below it if there's no room above)
        var b = box.getBoundingClientRect(), r = el.getBoundingClientRect(), h = card.offsetHeight;
        var top = r.top - b.top - h - 6; if (r.top - h - 6 < 70) top = r.bottom - b.top + 6;
        card.style.top = top + 'px';
      }
      function fromLine(ln) {
        var ns = names(ln); if (!ns.length) return;
        hide(); ln.classList.add('lk-on');
        [].forEach.call(lines, function (o) { if (o !== ln && names(o).some(function (n) { return ns.indexOf(n) >= 0; })) o.classList.add('lk-on'); });
        card = document.createElement('div'); card.className = 'lk-card';
        var pic = document.createElement('img'); pic.src = img.src; pic.alt = img.alt; card.appendChild(pic); box.appendChild(card);
        var go = function () { lit(card, pic, ns); place(ln); }; if (pic.complete) go(); else pic.onload = go;
      }
      function fromEq(e) {
        var r = img.getBoundingClientRect(), k = W / r.width, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, best = null, area = 1e9;
        Object.keys(L).forEach(function (n) { L[n].forEach(function (q) { if (x >= q[0] && x <= q[0] + q[2] && y >= q[1] && y <= q[1] + q[3] && q[2] * q[3] < area) { area = q[2] * q[3]; best = n; } }); });
        if (best === eq._lk) return; eq._lk = best; hide();
        if (!best) return;
        lit(eq, img, [best]);
        var ls = [].filter.call(lines, function (o) { return names(o).indexOf(best) >= 0; }); if (!ls.length) return;
        card = document.createElement('div'); card.className = 'lk-card code';
        ls.forEach(function (o) { var c = o.cloneNode(true); c.classList.remove('lk-on'); card.appendChild(c); });
        box.appendChild(card); var q = eq.getBoundingClientRect(), b = box.getBoundingClientRect(); card.style.top = (q.bottom - b.top + 6) + 'px';
      }
      [].forEach.call(lines, function (ln) {
        ln.addEventListener('pointerenter', function () { fromLine(ln); });
        ln.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
      });
      eq.addEventListener('pointermove', fromEq); eq.addEventListener('pointerdown', fromEq);
      eq.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { eq._lk = null; hide(); } });
      document.addEventListener('pointerdown', function (e) { if (!box.contains(e.target)) { eq._lk = null; hide(); } });
      box.querySelector('.dual-tabs').addEventListener('click', hide);
    }).catch(function () {});
  });
  addEventListener('load', fit); addEventListener('resize', function () { clearTimeout(fit.t); fit.t = setTimeout(fit, 150); });
  // a Run or Edit inside a pair changes its height: re-measure that pair
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.dual'); if (b && !e.target.closest('.dual-tabs')) setTimeout(fit, 50); });
}
function eaiRunCode() {
  var PY = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  // PyTorch in the browser: our fork of torch-pyodide (github.com/wtheisen/torch-pyodide, branch ai2ai), numpy backend,
  // published to the site as one tarball. Loaded only when a block imports torch. window.EAI_TORCH_URL overrides it.
  var TORCH = window.EAI_TORCH_URL || 'https://ai.williamtheisen.com/static/py/torch-ai2ai-5fa3763.tar.gz';
  var boot = null, torchBoot = null;
  function torch(py) {
    if (torchBoot) return torchBoot;
    torchBoot = py.loadPackage('numpy').then(function () { return fetch(TORCH); })
      .then(function (r) { if (!r.ok) throw new Error('could not fetch PyTorch for the browser'); return r.arrayBuffer(); })
      .then(function (b) { py.unpackArchive(b, 'gztar'); });
    return torchBoot;
  }
  function pyodide() {
    if (boot) return boot;
    boot = new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = PY + 'pyodide.js';
      s.onload = function () { window.loadPyodide({ indexURL: PY }).then(function (py) { py.runPython("import os, warnings\nos.environ['MPLBACKEND'] = 'Agg'\nwarnings.filterwarnings('ignore', message='.*(non-interactive|non-GUI backend).*')"); ok(py); }, bad); }; s.onerror = function () { bad(new Error('could not load Python (offline?)')); };
      document.head.appendChild(s);
    });
    return boot;
  }
  function source(block) { return [].map.call(block.querySelectorAll('.ln'), function (l) { return l.textContent.replace(/ /g, ' '); }).join('\n'); }
  [].forEach.call(document.querySelectorAll('b-code[lang="python"]:not([norun])'), function (block) {
    if (block._run) return; block._run = true;
    var original = source(block), out = block.nextElementSibling && block.nextElementSibling.tagName === 'B-OUT' ? block.nextElementSibling : null;
    var printed = out ? out.querySelector('pre').textContent : '';
    if (!out) { out = document.createElement('b-out'); out.innerHTML = '<div class="label">Output</div><pre></pre>'; block.after(out); }
    var label = out.querySelector('.label'), bar = document.createElement('span'); bar.className = 'run-bar web-only';
    bar.innerHTML = '<span class="run-status"></span><button type="button" data-a="reset" hidden>Reset</button><button type="button" data-a="edit">Edit</button><button type="button" data-a="run">\u25b6 Run</button>';
    label.appendChild(bar);
    var status = bar.querySelector('.run-status'), editor = null;
    function show(text, err, figs) {
      var pre = out.querySelector('pre'); pre.textContent = text; pre.classList.toggle('run-err', !!err);
      var old = out.querySelector('.run-figs'); if (old) old.remove();
      if (figs && figs.length) { var d = document.createElement('div'); d.className = 'run-figs'; figs.forEach(function (b) { var im = document.createElement('img'); im.src = 'data:image/png;base64,' + b; im.alt = 'Plot from the code above'; d.appendChild(im); }); out.appendChild(d); }
    }
    // matplotlib draws off screen (Agg); after a run every open figure is turned into a PNG and closed
    var FIGS = "import sys\n_figs = []\nif 'matplotlib.pyplot' in sys.modules:\n    import io, base64\n    import matplotlib.pyplot as _plt\n    for _n in _plt.get_fignums():\n        _b = io.BytesIO()\n        _plt.figure(_n).savefig(_b, format='png', dpi=120, bbox_inches='tight')\n        _figs.append(base64.b64encode(_b.getvalue()).decode())\n    _plt.close('all')\n_figs";
    function figures(py) { try { var r = py.runPython(FIGS), a = r.toJs(); r.destroy(); return a; } catch (e) { return []; } }
    function edit() {
      if (editor) return;
      editor = document.createElement('textarea'); editor.className = 'run-editor'; editor.spellcheck = false; editor.value = source(block);
      editor.rows = editor.value.split('\n').length + 1; block.hidden = true; block.after(editor); bar.querySelector('[data-a="reset"]').hidden = false; editor.focus();
      editor.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); } });
    }
    function reset() { if (editor) { editor.remove(); editor = null; } block.hidden = false; bar.querySelector('[data-a="reset"]').hidden = true; if (printed || out) show(printed); status.textContent = ''; }
    function run() {
      var code = editor ? editor.value : original, lines = [];
      status.textContent = boot ? 'Running…' : 'Loading Python (the first run takes a little while)…';
      bar.classList.add('busy');
      pyodide().then(function (py) {
        window._eaiPy = py;
        status.textContent = 'Loading packages…';
        var files = (block.getAttribute('files') || '').split(/\s+/).filter(Boolean);
        return Promise.all(files.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('could not fetch ' + u); return r.arrayBuffer(); }).then(function (b) { py.FS.writeFile(u.split('/').pop().split('?')[0], new Uint8Array(b)); }); }))
          .then(function () { return /^\s*(import|from)\s+torch\b/m.test(code) ? torch(py) : null; })
          .then(function () { return py.loadPackagesFromImports(code); })
          .then(function () {
            status.textContent = 'Running…';
            py.setStdout({ batched: function (t) { lines.push(t); } }); py.setStderr({ batched: function (t) { lines.push(t); } });
            return py.runPythonAsync(code, { globals: py.globals.get('dict')() });
          })
          .then(function () { var f = figures(py); show(lines.join('\n') || (f.length ? '' : '(no output)'), false, f); status.textContent = 'Ran in your browser'; },
                function (e) { var m = String(e && e.message || e).trim().split('\n'), k = -1; m.forEach(function (l, i) { if (l.indexOf('File "<exec>"') >= 0 && k < 0) k = i; }); m = k >= 0 ? ['Traceback (most recent call last):'].concat(m.slice(k)) : m.slice(-4); show((lines.length ? lines.join('\n') + '\n' : '') + m.join('\n'), true, figures(window._eaiPy)); status.textContent = 'Error'; });
      }, function (e) { status.textContent = String(e.message || e); })
        .then(function () { bar.classList.remove('busy'); });
    }
    bar.addEventListener('click', function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a === 'run') run(); else if (a === 'edit') edit(); else if (a === 'reset') reset(); });
  });
}
Book.runCode = () => { if (Book.web && !Book.exporting) eaiRunCode(); };

// ---------------------------------------------------------------- web extras (after spacing is settled) and the static snapshot
Book.webExtras = () => {
  Book.freezeGaps = true; Book.liveOn = true;
  Book.root.querySelectorAll('b-fig[live]').forEach(Book.initLive);
  Book.runCode();
  if (Book.view === 'slides') Book.root.addEventListener('click', e => { const f = e.target.closest && e.target.closest('u.fill, [data-fill]'); if (f) f.classList.toggle('shown'); });
  Book.root.querySelectorAll('.qc > .ans').forEach(a => {
    if (a.nextElementSibling && a.nextElementSibling.tagName === 'DETAILS') return;
    const d = document.createElement('details'); d.className = 'web-only'; d.setAttribute('data-rt', '');
    d.innerHTML = '<summary>Show answer</summary><p>' + a.innerHTML + '</p>'; a.after(d);
  });
};
const b64 = async url => { const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
Book.snapshot = async () => {
  const view = Book.view, live = [...Book.root.querySelectorAll('u.fill, [data-fill]')];
  if (view === 'workbook') live.forEach(el => { const pg = el.closest('.page'), k = pg ? pg.getBoundingClientRect().width / 432 : 1, r = el.getBoundingClientRect(); el.setAttribute('data-box', (r.width / k).toFixed(1) + ' ' + (r.height / k).toFixed(1)); });
  const clone = Book.root.cloneNode(true);
  live.forEach(el => el.removeAttribute('data-box'));
  if (view !== 'reading') {   // content that is not in this edition is left out of the file, not just hidden
    clone.querySelectorAll('[data-view]').forEach(n => { if (!Book.inView(n, view)) n.remove(); });
    if (view === 'slides') clone.querySelectorAll('.qc .ans').forEach(n => n.classList.add('ghost-only'));   // kept for the instructor's faint crib (ink.js)
    clone.querySelectorAll(view === 'slides' ? '.aside:not([data-view]), .qc details, b-answers:not([data-view])' : '.aside:not([data-view]), .qc .ans, .qc details, b-answers:not([data-view])').forEach(n => n.remove());
    if (Book.hasKeys) clone.querySelectorAll('.page > p:not([data-view])').forEach(pp => {   // a paragraph becomes its key sentences
      const keys = [...pp.querySelectorAll('.key')]; if (!keys.length) return pp.remove();
      pp.replaceChildren(...keys.flatMap((k, i) => i ? [document.createTextNode(' '), k] : [k]));
    });
  } else clone.querySelectorAll('[data-view], aside.qc').forEach(n => { if (!Book.inView(n, view)) n.remove(); });   // (quick checks: not in Reading unless tagged)
  if (view === 'workbook') clone.querySelectorAll('[data-box]').forEach(el => {   // the workbook carries blanks, not hidden answers
    const [w, h] = el.getAttribute('data-box').split(' ').map(Number);
    if (el.matches('u.fill')) { const u = document.createElement('u'); u.className = 'fill blank'; u.style.width = w + 'pt'; u.innerHTML = '&nbsp;'; el.replaceWith(u); }
    else { const d = document.createElement('div'); d.className = 'fillbox'; d.style.height = h + 'pt'; if (el.getAttribute('style') && Book.isPinned(el)) d.setAttribute('style', el.getAttribute('style') + ';height:' + h + 'pt'); el.replaceWith(d); }
  });
  clone.querySelectorAll('[data-ed], .cmt, .ed-guide').forEach(n => n.remove());
  clone.querySelectorAll('[data-ed-stale]').forEach(n => n.removeAttribute('data-ed-stale'));   // editor furniture and review comments stay out of the published page
  clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('[data-src]').forEach(n => n.removeAttribute('data-src'));
  for (const img of clone.querySelectorAll('img')) {
    const src = img.getAttribute('src'); if (!src || src.startsWith('data:')) continue;
    const type = /\.svg(\?|$)/.test(src) ? 'image/svg+xml' : /\.png(\?|$)/.test(src) ? 'image/png' : /\.jpe?g(\?|$)/.test(src) ? 'image/jpeg' : 'application/octet-stream';
    img.setAttribute('src', `data:${type};base64,${await b64(src)}`);
  }
  const m = Book.meta, css = await (await fetch('../app/book.css')).text(), liveJs = await (await fetch('../app/live.js')).text(), inkJs = await (await fetch('../app/ink.js')).text();
  const frames = FIT + "(function(){var fs=[].slice.call(document.querySelectorAll('iframe[data-frame]'));if(!fs.length)return;var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.src=e.target.getAttribute('data-frame');io.unobserve(e.target)}})},{rootMargin:'600px'});fs.forEach(function(f){io.observe(f)})})();" + LIVEFIG + ";[].forEach.call(document.querySelectorAll('b-fig[viz]'),eaiLiveFig);";
  const reveal = view === 'slides' ? "document.addEventListener('click',function(e){var f=e.target.closest&&e.target.closest('u.fill,[data-fill]');if(f)f.classList.toggle('shown')});" : '';
  const faces = (await Promise.all([['Inconsolata-LGC.ttf', 400], ['Inconsolata-LGC-Bold.ttf', 700]].map(async ([f, w]) =>
    `@font-face{font-family:'Inconsolata LGC';src:url(data:font/ttf;base64,${await b64('../kit/fonts/' + f)}) format('truetype');font-weight:${w}}`))).join('');
  const nav = Book.pages().filter(p => p.dataset.part && Book.inView(p, view)).map(p => `<a href="#${p.id}">${esc(p.dataset.part)}</a>`).join('');
  // the published chapter is three pages (one per view) that link to each other; Export PDF offers each view's PDF
  // or prints this page as it stands (so lecture notes that are showing go into the PDF too)
  const VIEWS = [['reading', 'Reading', ''], ['slides', 'Lecture', '-slides'], ['workbook', 'Workbook', '-workbook']];
  const pdfName = sfx => (m.pdf || (Book.chapter + '-chapter.pdf')).replace(/\.pdf$/, sfx + '.pdf');
  const ICON = {
    pdf: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M3 13.5h10"/></svg>',
    toc: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>' };
  const toc = nav ? `<details class="navmenu toc"><summary class="nb">${ICON.toc}<span>Sections</span></summary><div class="menu">${nav}</div></details>` : '';
  const viewbar = `<span class="viewbar" role="group" aria-label="View">${VIEWS.map(([v, label, sfx]) => `<a href="index${sfx}.html" class="${v === view ? 'on' : ''}">${label}</a>`).join('')}</span>`;
  const pdfmenu = `<details class="navmenu pdfmenu"><summary class="nb" title="Export PDF">${ICON.pdf}<span>PDF</span></summary><div class="menu"><span class="hd">Download PDF</span>${VIEWS.map(([, label, sfx]) => `<a href="${escAttr(pdfName(sfx))}" download>${label}</a>`).join('')}<button type="button" onclick="this.closest('details').open=false;window.print()">This page as shown, with notes</button></div></details>`;
  // close any open navbar menu on an outside tap or Escape
  const navjs = "document.addEventListener('click',function(e){[].forEach.call(document.querySelectorAll('.navbar details[open]'),function(d){if(!d.contains(e.target))d.open=false})});document.addEventListener('keydown',function(e){if(e.key==='Escape')[].forEach.call(document.querySelectorAll('.navbar details[open]'),function(d){d.open=false})});[].forEach.call(document.querySelectorAll('.navbar .toc a'),function(a){a.addEventListener('click',function(){a.closest('details').open=false})});";
  const zoom = "(function(){function z(){var W=Math.min(window.innerWidth,document.documentElement.clientWidth||1e9,screen.width||1e9);var w=Math.min(1,(W-32)/576);document.documentElement.style.setProperty('--zoom',w)}z();window.addEventListener('resize',z)})();";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title || '')}</title>
<style>${faces}
${css}</style>
</head>
<body>
<nav class="navbar chap web-only" aria-label="Chapter"><a class="brand" href="${escAttr(m.toc || '/ai2ai/')}" title="All chapters">${esc(m.book || '')}</a><span class="crumb">${esc(m.title || '')}</span>${toc}<span class="spacer"></span>${viewbar}<span class="tools">${pdfmenu}</span></nav>
<main class="book view" data-view="${view}">
${clone.innerHTML}
</main>
<script>${zoom}${navjs}${reveal}${frames}
${liveJs}
${eaiRunCode.toString()}
eaiRunCode();
${eaiMatmul.toString()}
${eaiDual.toString()}
eaiDual();
${inkJs}
eaiInk(${JSON.stringify({ dir: m.web || ('ai2ai/' + Book.chapter) })});</script>
</body>
</html>
`;
};
})();

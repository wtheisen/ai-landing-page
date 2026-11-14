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
// \name shortcuts for symbols (editor.js's maths box turns them into the symbol as you type; a <b-m> stored with one,
// e.g. typed before the editor knew the name, still renders the symbol: Eric 2026-11-01, \sig showed as text)
Book.MATH_ALIAS = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', sig: 'σ', phi: 'φ', varphi: 'φ', eta: 'η', rho: 'ρ', tau: 'τ', omega: 'ω', xi: 'ξ',
  Sigma: 'Σ', sum: 'Σ', Omega: 'Ω', Delta: 'Δ', Gamma: 'Γ', Theta: 'Θ', Lambda: 'Λ', Phi: 'Φ', Pi: 'Π', Psi: 'Ψ', pi: 'π', psi: 'ψ', kappa: 'κ', nu: 'ν', zeta: 'ζ', chi: 'χ', nabla: '∇', ge: '≥', geq: '≥', le: '≤', leq: '≤', ne: '≠', neq: '≠', cdot: '·', times: '×', pm: '±', in: '∈', approx: '≈', infty: '∞', sqrt: '√', norm: '‖', half: '½', prime: '′', yhat: 'ŷ', to: '→', partial: '∂', L: 'ℒ', loss: 'ℒ' };   // \L = the loss ℒ (Eric, 2026-11-03)
function inlineMath(s, plain) {   // plain: no colours (the subscripts of a coloured symbol take its colour, as in equations)
  s = String(s).replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, w) => w !== 'T' && Book.MATH_ALIAS[w] ? Book.MATH_ALIAS[w] : m);
  const out = []; let i = 0;
  const colors = plain ? {} : Book.meta.colors || {};
  const script = i => {
    if (s[i] === '{') { let j = s.indexOf('}', i); if (j < 0) j = s.length; return [s.slice(i + 1, j), j + 1]; }
    const m = /^(\d+|[\s\S])/.exec(s.slice(i)); return m ? [m[0], i + m[0].length] : ['', i + 1];
  };
  const scripts = tok => {
    while (i < s.length && (s[i] === '_' || s[i] === '^' || s.startsWith('\\T', i))) {
      if (s.startsWith('\\T', i)) { tok += '<sup>T</sup>'; i += 2; continue; }
      const tag = s[i] === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
      tok += `<${tag}>${inlineMath(sub, plain)}</${tag}>`; i = i2;
    }
    return tok;
  };
  const group = j => {   // {…} with nested braces, from s[j] === '{'; returns [inside, index after]
    let d = 0;
    for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && !--d) return [s.slice(j + 1, k), k + 1]; }
    return [s.slice(j + 1), s.length];
  };
  while (i < s.length) {
    const c = s[i];
    // \frac{a}{b}: a small stacked fraction (Eric, 2026-11-03)
    const fr = /^\\[dt]?frac\s*(?=\{)/.exec(s.slice(i));
    if (fr) {
      const [a, j] = group(i + fr[0].length); let b = '', k = j;
      if (s[j] === '{') [b, k] = group(j);
      out.push(`<span class="fr"><span>${inlineMath(a, plain)}</span><span>${inlineMath(b, plain)}</span></span>`); i = k; continue;
    }
    if (s.startsWith('\\T', i)) { out.push('<sup>T</sup>'); i += 2; continue; }
    const word = WORDS.find(w => s.startsWith(w, i));
    if (word) { out.push(word); i += word.length; continue; }
    if (isAlpha(c)) {
      i++;
      let tok = c === 'Ω' ? '<span class="Om">ω</span>' : esc(c);   // Ω = the weight-matrix ω, drawn as a tall ω (like the equation font)
      while (i < s.length && /[\u0300-\u036f]/.test(s[i])) tok += s[i++];   // c̃: a combining mark stays on its letter, not on the subscript
      const f = colors[c];
      while (i < s.length && (s[i] === '_' || s[i] === '^')) {
        const tag = s[i] === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
        tok += `<${tag}>${inlineMath(sub, plain || (tag === 'sub' && !!f))}</${tag}>`; i = i2;   // Ω_{ax}: the ax is Ω's blue (Eric's equations), not a gold a and a red x
      }
      if (s[i] === '′') { i++; tok = scripts(tok + '<span class="pr">′</span>'); }
      out.push(f ? `<span class="c ${f}">${tok}</span>` : tok);
      continue;
    }
    if (c === '^' || c === '_') {
      const tag = c === '_' ? 'sub' : 'sup', [sub, i2] = script(i + 1);
      out.push(`<${tag}>${inlineMath(sub, plain)}</${tag}>`); i = i2; continue;
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
// st carries a triple-quoted string across lines (Eric, 2026-11-07: a """ docstring/text block only coloured its quotes):
// pass the same object for every line of a block, in order. st.tq is the open quote ('"""' or "'''") or null.
function highlight(line, st) {
  st = st || {};
  let out = '';
  if (st.tq) {   // still inside a triple-quoted string from an earlier line
    const end = line.indexOf(st.tq);
    if (end < 0) return line ? `<span class="st">${esc(line)}</span>` : '';
    out = `<span class="st">${esc(line.slice(0, end + 3))}</span>`; line = line.slice(end + 3); st.tq = null;
  }
  const TOK = /(#.*$)|((?:\b[rRbBfFuU]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"""[\s\S]*$|'''[\s\S]*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;
  const types = new Set([...TY, ...(Book.meta.types || [])]);
  // meta.codeColors {name: family}: variables coloured by what they are (inputs red, weights blue, ...), like the
  // figures and equations. Chapters that use it show plain numbers in grey, so red only means an input.
  const concept = Book.meta.codeColors || {}, nuCls = Book.meta.codeColors ? 'nu nn' : 'nu';
  let prev = null, m;
  while ((m = TOK.exec(line))) {
    const t = m[0], e = esc(t);
    if (m[4] !== undefined) {
      const cls = (prev === 'def' || prev === 'class') ? 'def' : KW.has(t) ? 'kw' : CTL.has(t) ? 'ctl' : types.has(t) ? 'ty'
        : (BI.has(t) && !line.slice(0, m.index).trimEnd().endsWith('.')) ? 'bi' : NUMC.has(t) ? 'nu'
        : concept[t] ? 'cc ' + concept[t] : null;
      out += cls ? `<span class="${cls}">${e}</span>` : e; prev = t;
    } else if (m[1] !== undefined) out += `<span class="cm">${e}</span>`;
    else if (m[2] !== undefined) {
      out += `<span class="st">${e}</span>`;
      const b = t.replace(/^[rRbBfFuU]+/, ''), q = b.slice(0, 3);   // a triple quote left open runs on into the next line
      if ((q === '"""' || q === "'''") && !(b.length >= 6 && b.endsWith(q))) st.tq = q;
    }
    else if (m[3] !== undefined) out += `<span class="${nuCls}">${e}</span>`;
    else { out += e; if (!/\s/.test(t)) prev = null; }
  }
  return out;
}

Book.highlight = highlight;   // the editor's in-place code editing redraws the colours as you type

// Code output colours (Eric, 2026-11-01: "the outputs are all just plain black which can make it hard to parse", then:
// "follow what I do in the diagrams and equations": weights blue, bias grey, Z purple, post-activations gold, final
// predictions green). A label at the start of a line ("loss:", "fc1.weight tensor(", "y_hat (predictions):") is bold and
// takes the family of the first word in it that names one (DEF below, overridden by book-meta codeColors), and so do
// the numbers after it, also on the lines a tensor wraps onto. Unnamed labels are navy, other numbers are dark grey
// (red means an input), tensor( / array( wrappers are grey, names from codeColors elsewhere keep their colour.
// Pre-registered: hl="gold y_hat (predictions):\nred loss" on the b-out, one rule per line (colour, a space, the exact
// text): every occurrence of that text gets a highlight box like the code's, so it survives reruns. Tracebacks stay plain.
// Self-contained on purpose: Book.snapshot() copies it into the published page, where Run uses it on live output.
function eaiOutHL(text, cc, hl, tok) {
  // tok (token tiles in outputs, Eric 2026-11-07): {map: {token: [id, family]}, n, ids}: a quoted string that is a token
  // of the vocabulary becomes a tile, and a bracketed list of whole numbers that are all its IDs takes the tokens' colours
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  text = String(text || '');
  if (/Traceback \(most recent call last\)|^\w*Error\b/m.test(text)) return esc(text);
  var DEF = {}, fams = {
    red: 'x X x_train X_train X_test x_test input inputs features pts loss losses cost',
    blue: 'weight weights W W1 W2 W3 Ω ω coef coef_ coefs_ kernel filters',
    gray: 'bias biases b b1 b2 b3 intercept intercept_ intercepts_',
    purple: 'z Z z1 z2 z_1 z_2 Z1 Z2 logit logits pre-activation pre-activations',
    gold: 'h H a A a1 A1 a_1 h1 h2 hidden activation activations post-activation post-activations y_hat yhat ŷ prob probs proba probability probabilities sigmoid softmax p',
    green: 'y Y y_true y_train y_test label labels target targets pred preds y_pred prediction predictions predicted class classes'
  };
  Object.keys(fams).forEach(function (f) { fams[f].split(' ').forEach(function (w) { DEF[w] = f; }); });
  cc = cc || {};
  var map = {}; Object.keys(DEF).forEach(function (k) { map[k] = DEF[k]; }); Object.keys(cc).forEach(function (k) { map[k] = cc[k]; });
  var nuCls = 'nu nn', WRAP = { tensor: 1, array: 1, Tensor: 1, Parameter: 1, dtype: 1, device: 1, grad_fn: 1, requires_grad: 1 };
  var CONST = { True: 1, False: 1, None: 1, nan: 1, inf: 1 };
  var rules = String(hl || '').split('\n').map(function (l) { var m = /^(\w+) (.+)$/.exec(l.replace(/\s+$/, '')); return m ? { c: m[1], t: m[2] } : null; })
    .filter(Boolean).sort(function (a, b) { return b.t.length - a.t.length; });
  function name(t) {   // outside labels: codeColors names, and the longer DEF names (not single letters in running output)
    if (WRAP[t]) return 'ow'; if (CONST[t]) return nuCls;
    var parts = t.split('.');
    for (var i = parts.length - 1; i >= 0; i--) { var w = parts[i]; if (cc[w]) return 'cc ' + cc[w]; if (w.length > 2 && DEF[w]) return 'cc ' + DEF[w]; }
    return null;
  }
  function famOf(label) {   // the family of a label: its first word that names one (single letters only in a one-word label)
    var words = label.replace(/:$/, '').match(/[A-Za-zΩωŷ_][\w\-]*(?:\.[\w\-]+)*/g) || [], one = words.length === 1;
    for (var i = 0; i < words.length; i++) {
      var parts = words[i].split('.');
      for (var j = parts.length - 1; j >= 0; j--) { var w = parts[j]; if (map[w] && (one || w.length > 1)) return map[w]; if (map[w.toLowerCase()] && w.length > 2) return map[w.toLowerCase()]; }
    }
    return null;
  }
  function unq(q) {   // a Python string repr's text
    var body = q.slice(1, -1);
    return body.replace(/\\(n|t|r|'|"|\\)/g, function (_, c) { return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c; });
  }
  function tile(t, f) { return '<span class="otk" data-f="' + f + '">' + esc(t.replace(/\n/g, '\u21b5').replace(/\t/g, '\u2192')) + '</span>'; }
  function auto(seg, fam, noTok) {
    if (tok && tok.map && !noTok) {   // tokens first: quoted strings and ID lists
      var TT = /((?:\bb)?(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"))|(\[\s*\d+(?:\s*,\s*\d+)*\s*,?\s*\])/g, o = '', last = 0, q;   // b'…': a bytes repr
      while ((q = TT.exec(seg))) {
        var piece = null;
        if (q[1] !== undefined) {
          var t = unq(q[1].replace(/^b/, '')), hit = Object.prototype.hasOwnProperty.call(tok.map, t) ? tok.map[t] : null;
          if (hit) piece = tile(t, hit[1]);
          else if (tok.ids !== false && /^0x[0-9a-fA-F]+$|^0b[01]+$/.test(t)) {   // hex(b) / bin(b) of an ID: coloured like the ID
            var v = parseInt(t.slice(2), t[1] === 'x' ? 16 : 2);
            if (v < tok.n && tok.byId[v]) piece = '<span class="otid" data-f="' + tok.byId[v] + '">' + esc(q[1]) + '</span>';
          }
        }
        else if (tok.ids !== false && !/(Size|shape)\($/.test(seg.slice(0, q.index))) {   // not torch.Size([64, 10])
          var nums = q[2].match(/\d+/g), ok = nums.length > 1 && nums.every(function (d) { return +d < tok.n && tok.byId[+d]; });
          if (ok) piece = q[2].replace(/\d+/g, function (d) { return '<span class="otid" data-f="' + tok.byId[+d] + '">' + d + '</span>'; }).replace(/[\[\],]/g, function (c) { return esc(c); });
        }
        if (piece === null) continue;
        o += auto(seg.slice(last, q.index), fam, true) + piece; last = q.index + q[0].length;
      }
      return o + auto(seg.slice(last), fam, true);
    }
    var TOK = /(-?\b\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|-?\.\d+)|([A-Za-z_][\w.]*\w|[A-Za-z_])|([\s\S])/g, out = '', m;
    while ((m = TOK.exec(seg))) {
      var e = esc(m[0]);
      if (m[1] !== undefined) out += '<span class="' + (fam ? 'nu f-' + fam : nuCls) + '">' + e + '</span>';
      else if (m[2] !== undefined) { var c = name(m[0]); out += c ? '<span class="' + c + '">' + e + '</span>' : e; }
      else out += e;
    }
    return out;
  }
  function marked(seg, fam, plain) {   // pre-registered texts first, the rest coloured automatically (plain: just escaped)
    if (!seg) return '';
    for (var i = 0; i < rules.length; i++) {
      var k = seg.indexOf(rules[i].t);
      if (k >= 0) return marked(seg.slice(0, k), fam, plain) + '<mark class="' + rules[i].c + '">' + (plain ? esc(rules[i].t) : auto(rules[i].t, fam)) + '</mark>' + marked(seg.slice(k + rules[i].t.length), fam, plain);
    }
    return plain ? esc(seg) : auto(seg, fam);
  }
  var fam = null;
  return text.split('\n').map(function (line) {
    var lab = /^([A-Za-z_][^:\n]{0,48}?:)(?=\s|$)/.exec(line) || /^([A-Za-z_][\w.\[\]']*)(?=\s+(?:tensor|array|Parameter|[\[(]|-?\d))/.exec(line);
    if (!lab) { if (!/^\s/.test(line)) fam = null; return marked(line, fam); }   // a wrapped tensor's next lines keep the family
    fam = famOf(lab[1]);
    // a later label on the same line that names a family ("… loss: tensor(0.70)") colours what follows it (Eric, 2026-11-03)
    var rest = line.slice(lab[1].length), out = '<span class="olab' + (fam ? ' f-' + fam : '') + '">' + marked(lab[1], fam, !!fam) + '</span>', MID = /(\s)([A-Za-z_][A-Za-z_ ]{0,30}:)(?=\s)/g, mm, from = 0, f2 = fam;
    while ((mm = MID.exec(rest))) {
      var mf = famOf(mm[2]); if (!mf) continue;
      var at = mm.index + mm[1].length;
      out += marked(rest.slice(from, at), f2) + '<span class="olab f-' + mf + '">' + marked(mm[2], mf, true) + '</span>';
      from = at + mm[2].length; f2 = mf;
    }
    fam = f2;
    return out + marked(rest.slice(from), f2);
  }).join('\n');
}
window.eaiOutHL = eaiOutHL;
// the token table an Output uses (tok="march" on the b-out, else book-meta outTok; "off" for none), for eaiOutHL.
// Self-contained like eaiOutHL: a published page has no Book and reads EAI_TOK / EAI_TOKDEF instead.
function eaiOutTok(out) {
  var v = out.getAttribute('tok');
  if (v === null) v = typeof EAI_TOKDEF !== 'undefined' ? EAI_TOKDEF : (window.Book && window.Book.meta ? window.Book.meta.outTok : null);
  if (!v || v === 'off') return null;
  var T = window.Book && window.Book.tokTable ? window.Book.tokTable(v) : (typeof EAI_TOK !== 'undefined' && EAI_TOK ? EAI_TOK[v] : null);
  if (!T) return null;
  return { map: T.map, byId: T.byId, n: T.n, ids: out.getAttribute('tokids') !== 'off' };
}
window.eaiOutTok = eaiOutTok;

// ---------------------------------------------------------------- custom elements
const inThumb = el => !!el.closest('[data-thumb]');   // copies shown in the page list: already rendered, must not load or renumber anything
const lock = el => { if (Book.mode === 'edit') el.setAttribute('contenteditable', 'false'); };
const rawText = el => el.textContent.replace(/^\s*\n/, '').replace(/\s+$/, '');

class BM extends HTMLElement {
  static get observedAttributes() { return ['tex']; }
  connectedCallback() { lock(this); if (!this.hasAttribute('tex')) this.setAttribute('tex', this.textContent.trim()); }
  attributeChangedCallback() { if (this.firstChild && inThumb(this)) return; this.innerHTML = inlineMath(this.getAttribute('tex') || ''); }
}
// ---------------------------------------------------------------- token tiles (Eric, 2026-11-07: "token mode")
// <b-tok v="irishqwen" t=" her"> her</b-tok> is one token of a named vocabulary, drawn as a rounded tile. The
// vocabularies live in one file shared by every chapter of both books, chapters/vocab/vocabs.json:
//   kind "list": tokens [{t, id, c?}] with the ids you give them (normalize "word": lowercase, letters only)
//   kind "bpe":  a byte-level BPE tokenizer (pattern, special, merges: irishQwen's format), ids from its merges
// A tile's ID and colour come from its vocabulary, never from the chapter, so a token looks the same everywhere:
// colour by ID (the five tile families in turn, like OpenAI's tokenizer page) unless the vocabulary names one
// (list token c, or colors {t: family}). The text inside is only a readable copy for the source file. IDs show under
// the word where the page asks for them (data-tokids) or the whole chapter does (book-meta tokIds).
const TOK_FAMS = ['purple', 'green', 'yellow', 'red', 'blue'];
Book.TOK_FAMS = TOK_FAMS;
// irishQwen's GPT-4 split pattern without its possessive quantifiers (JS has none); same tokens on 300,000 characters
// of Shakespeare as the Python tokenizer
const TOK_SPLIT = /'(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+/gu;
function makeBPE(spec) {
  const rank = new Map(), bytes = new Map(), dec = new TextDecoder(), enc = new TextEncoder();
  for (let i = 0; i < 256; i++) bytes.set(i, [i]);
  for (const [s, i] of Object.entries(spec.special || {})) bytes.set(i, [...enc.encode(s)]);
  const merges = Object.entries(spec.merges || {}).map(([k, v]) => [k.split(',').map(Number), v]).sort((a, b) => a[1] - b[1]);
  for (const [[a, b], v] of merges) { rank.set(a + ',' + b, v); bytes.set(v, bytes.get(a).concat(bytes.get(b))); }
  const chunk = bs => {
    let ids = [...bs];
    while (ids.length > 1) {
      let at = -1, best = Infinity;
      for (let i = 0; i + 1 < ids.length; i++) { const r = rank.get(ids[i] + ',' + ids[i + 1]); if (r !== undefined && r < best) { best = r; at = i; } }
      if (at < 0) break;
      const a = ids[at], b = ids[at + 1], out = [];
      for (let i = 0; i < ids.length; i++) { if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) { out.push(best); i++; } else out.push(ids[i]); }
      ids = out;
    }
    return ids;
  };
  const text = id => bytes.has(id) ? dec.decode(new Uint8Array(bytes.get(id))) : '';
  const byText = new Map();
  for (const id of [...bytes.keys()].sort((a, b) => a - b)) { const t = text(id); if (!byText.has(t)) byText.set(t, id); }
  return { encode: s => (s.match(TOK_SPLIT) || []).flatMap(c => chunk(enc.encode(c))), text, id: t => byText.get(t), ids: () => [...bytes.keys()].sort((a, b) => a - b) };
}
Book.makeBPE = makeBPE;
Book.vocabs = null;   // {name: vocabulary as stored, plus ._bpe / ._byT}
Book.vocabFile = null;   // the whole file as loaded (the Tokens panel edits and saves it)
let vocabLoad = null;
const tokTables = {};
// every token of vocabulary vn as {map: {text: [id, family]}, byId: [family], n}: what eaiOutHL needs to draw tiles in outputs
Book.tokTable = vn => {
  const v = Book.vocabs && Book.vocabs[vn]; if (!v) return null;
  if (tokTables[vn]) return tokTables[vn];
  const map = {}, byId = [], list = v.kind === 'bpe' ? v._bpe.ids().map(id => ({ t: v._bpe.text(id), id })) : (v.tokens || []);
  for (const k of list) { const f = Book.tokInfo(vn, k.t).fam; if (!(k.t in map)) map[k.t] = [k.id, f]; byId[k.id] = f; }
  return (tokTables[vn] = { map, byId, n: byId.length });
};
// redraw the Outputs that show tokens (after the vocabularies load or change)
Book.renderOuts = () => { if (Book.root) Book.root.querySelectorAll('b-out').forEach(o => { const pre = o.querySelector('pre'); if (pre && o.src != null && !o._ran && eaiOutTok(o)) pre.innerHTML = eaiOutHL(o.src, Book.meta.codeColors, o.getAttribute('hl'), eaiOutTok(o)); }); };
Book.prepVocab = v => {
  for (const k in tokTables) delete tokTables[k];   // colours or IDs may have changed
  Object.defineProperty(v, '_byT', { value: new Map(), writable: true, configurable: true });
  if (v.kind === 'bpe') Object.defineProperty(v, '_bpe', { value: makeBPE(v), writable: true, configurable: true });
  else for (const k of v.tokens || []) v._byT.set(k.t, k);
  return v;
};
Book.loadVocabs = force => {
  if (Book.vocabs && !force) return Promise.resolve(Book.vocabs);
  if (vocabLoad && !force) return vocabLoad;
  vocabLoad = fetch(Book.url('../vocab/vocabs.json'), { cache: 'no-store' }).then(r => r.ok ? r.json() : { vocabs: {} }).catch(() => ({ vocabs: {} })).then(f => {
    Book.vocabFile = f; Book.vocabs = f.vocabs || (f.vocabs = {});
    for (const v of Object.values(Book.vocabs)) Book.prepVocab(v);
    if (Book.root) Book.root.querySelectorAll('b-tok').forEach(t => t.render && t.render());
    Book.renderOuts();
    Book.refreshSoon();
    return Book.vocabs;
  });
  return vocabLoad;
};
Book.tokLabel = t => String(t).replace(/\r?\n/g, '↵').replace(/\t/g, '→');   // spaces stay spaces (Eric, 2026-11-07: no dots); the tile keeps them visible (white-space: pre)
Book.tokNorm = (v, w) => v && v.normalize === 'word' ? w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') : w;
// {id, fam, known}: where token t of vocabulary v sits (id null and fam "gray" when the vocabulary doesn't have it)
Book.tokInfo = (vn, t) => {
  const v = Book.vocabs && Book.vocabs[vn];
  if (!v) return { id: null, fam: 'gray', known: false };
  let id = null, c = null;
  if (v.kind === 'bpe') { id = v._bpe.id(t); if (id === undefined) id = null; }
  else { const k = v._byT.get(t); if (k) { id = k.id; c = k.c; } }
  c = c || (v.colors && v.colors[t]) || (id === null ? 'gray' : TOK_FAMS[((id % 5) + 5) % 5]);
  return { id, fam: c, known: id !== null };
};
// split text into tokens of vocabulary vn: [{t, gap}] (gap: the text to keep between this token and the one before,
// for word lists, whose tiles sit apart; BPE tokens carry their own spaces)
Book.tokenize = (vn, text) => {
  const v = Book.vocabs && Book.vocabs[vn]; if (!v) return [];
  if (v.kind === 'bpe') return v._bpe.encode(text).map(id => ({ t: v._bpe.text(id), gap: '' }));
  const out = []; let gap = '';
  for (const m of text.match(/\s+|\S+/g) || []) {
    if (/^\s+$/.test(m)) { gap += m; continue; }
    const t = Book.tokNorm(v, m); if (t) out.push({ t, gap: out.length ? gap : '' });
    gap = '';
  }
  return out;
};
// Token tiles in drawings (Eric, 2026-11-07: "shouldn't we update the drawing tool then?"): a tile in an <svg class="draw">
// is a group <g data-tok="vocabulary" data-t="token" id> holding a <rect> and a <text> (and, when the IDs show, a
// <text class="tk-idl">). Like <b-tok>, its colours, label, width and ID come from the vocabulary each time the page
// is laid out, so changing a token's colour or ID changes it in every drawing too. The group keeps its centre; its
// size follows the label's font size. IDs show where the drawing has class tokids, the page data-tokids="on" or the
// chapter tokIds (data-tokids="off" on the page hides them).
const TOK_COLS = { purple: ['#D9D2E9', '#8E7CC3', '#674EA7'], green: ['#D9EAD3', '#93C47D', '#38761D'], yellow: ['#FFF2CC', '#DCB439', '#B8920F'],
  red: ['#F4CCCC', '#E06666', '#CC0000'], blue: ['#C9DAF8', '#6D9EEB', '#1155CC'], gray: ['#EEEEEE', '#999999', '#666666'] };
Book.TOK_COLS = TOK_COLS;
const setA = (el, k, v) => { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const rn = v => +(+v).toFixed(1);
Book.drawTok = g => {
  if (!Book.vocabs) return false;
  const NS = 'http://www.w3.org/2000/svg';
  let rect = g.querySelector(':scope > rect'), lab = g.querySelector(':scope > text:not(.tk-idl):not(.tk-sub)'), idl = g.querySelector(':scope > text.tk-idl'), sub = g.querySelector(':scope > text.tk-sub');
  if (!rect) { rect = document.createElementNS(NS, 'rect'); rect.setAttribute('x', 0); rect.setAttribute('y', 0); rect.setAttribute('width', 20); rect.setAttribute('height', 15); g.prepend(rect); }
  if (!lab) { lab = document.createElementNS(NS, 'text'); lab.setAttribute('font-size', 9); rect.after(lab); }
  const t = g.getAttribute('data-t') || '', info = Book.tokInfo(g.getAttribute('data-tok'), t), col = TOK_COLS[info.fam] || TOK_COLS.gray;
  const pg = g.closest('section.page'), svg = g.closest('svg'), off = pg && pg.getAttribute('data-tokids') === 'off';
  const own = g.getAttribute('data-ids');   // this tile's own choice (on / off) wins over the drawing, page and chapter
  const ids = own === 'on' ? true : own === 'off' ? false : !off && !!((svg && svg.classList.contains('tokids')) || (pg && pg.hasAttribute('data-tokids')) || Book.meta.tokIds);
  const fs = parseFloat(lab.getAttribute('font-size')) || 9;
  const x = parseFloat(rect.getAttribute('x')) || 0, y = parseFloat(rect.getAttribute('y')) || 0, w0 = parseFloat(rect.getAttribute('width')) || 0, h0 = parseFloat(rect.getAttribute('height')) || 0;
  const cx = x + w0 / 2, cy = y + h0 / 2;
  setA(rect, 'fill', col[0]); setA(rect, 'stroke', col[1]);
  // outline in proportion to the label, like a <b-tok>'s .1em border, so tiles weigh the same in text, outputs and drawings; data-em doubles it
  setA(rect, 'stroke-width', rn(fs * (g.hasAttribute('data-em') ? 0.2 : 0.1)));
  setA(rect, 'rx', rn(fs * 0.4));
  if (info.known) rect.removeAttribute('stroke-dasharray'); else setA(rect, 'stroke-dasharray', '3 2');
  const label = Book.tokLabel(t);
  if (lab.textContent !== label) lab.textContent = label;
  for (const [k, v] of [['fill', '#000000'], ['font-family', 'Arial, Helvetica, sans-serif'], ['font-weight', 'bold'], ['text-anchor', 'middle']]) setA(lab, k, v);
  if (lab.style.whiteSpace !== 'pre') lab.style.whiteSpace = 'pre';
  // a second line (text.tk-sub: a count, an embedding) sits under the label, the ID under both
  const sfs = sub ? parseFloat(sub.getAttribute('font-size')) || fs * 0.8 : 0;
  let len = 0, slen = 0; try { len = lab.getComputedTextLength(); if (sub) slen = sub.getComputedTextLength(); } catch (e) {}
  const w = len ? Math.max(Math.max(len, slen) + fs * 0.9, fs * 1.3) : w0, h = fs * 1.65 + (sub ? sfs * 1.2 : 0) + (ids ? fs * 0.65 : 0), top = cy - h / 2;
  setA(rect, 'x', rn(cx - w / 2)); setA(rect, 'width', rn(w)); setA(rect, 'y', rn(top)); setA(rect, 'height', rn(h));
  let base = top + fs * 1.15;
  setA(lab, 'x', rn(cx)); setA(lab, 'y', rn(base));
  if (sub) { base += sfs * 1.2; setA(sub, 'x', rn(cx)); setA(sub, 'y', rn(base)); setA(sub, 'text-anchor', 'middle'); }
  if (ids) {
    if (!idl) { idl = document.createElementNS(NS, 'text'); idl.setAttribute('class', 'tk-idl'); g.append(idl); }
    for (const [k, v] of [['x', rn(cx)], ['y', rn(base + fs * 0.75)], ['font-size', rn(fs * 0.66)], ['fill', col[2]], ['font-family', "Consolas, 'Inconsolata LGC', monospace"], ['font-weight', 'bold'], ['text-anchor', 'middle']]) setA(idl, k, v);
    const s = info.known ? String(info.id) : '?'; if (idl.textContent !== s) idl.textContent = s;
  } else if (idl) idl.remove();
  return Math.abs(w - w0) > 0.05 || Math.abs(h - h0) > 0.05;
};
Book.drawToks = (root, then) => {
  const changed = new Set();
  (root || Book.root || document).querySelectorAll('svg.draw g[data-tok]').forEach(g => { if (Book.drawTok(g)) changed.add(g.closest('svg')); });
  if (changed.size && window.Draw && Draw.reconnect) changed.forEach(svg => Draw.reconnect(svg));   // arrows attached to a tile that changed width follow it
  return changed.size;
};
// ---------------------------------------------------------------- symbol tiles (Eric, 2026-11-12)
// A maths symbol in a drawing is <g data-sym="Ω_zx^T" [data-dims="1,h"] id> holding a <rect> and a <text>. Its colour
// comes from the chapter's notation table, book-meta notation {key: family}: every quantity gets its own colour, so two
// different things never look alike ("the output from both gates are different things"), and a key ending in * is a
// group sharing one colour (Ω* = every weight matrix). A quantity is the letter with its accent and its subscript, minus
// a time or step index: c_t, c_{t−1} and c_2 are one quantity c, c̃_t is another; Z_z and Z_c̃ are two (both in Z* if
// that group exists). Superscripts (ᵀ, layer marks) don't count. A symbol not in the table falls back to book-meta
// colors by letter (what the equations use), then a grey dashed tile. Book.drawSym lays it out like a token tile:
// colours, label with real sub/superscripts, the shape line (data-dims, letters from the drawing's data-vars or
// book-meta dims), width round the label, outline a tenth of the font (a fifth with data-em).
const SYM_COLS = {
  red: ['#F4CCCC', '#E06666', '#CC0000'], pink: ['#F4D3E3', '#D47EA8', '#A64D79'], orange: ['#FCE5CD', '#E69138', '#B45F06'],
  gold: ['#FFF2CC', '#DCB439', '#B8920F'], brown: ['#EFE2D2', '#B07D4F', '#783F04'], olive: ['#EDEFCF', '#A8A845', '#6B6B00'],
  green: ['#D9EAD3', '#93C47D', '#38761D'], teal: ['#D0E0E3', '#76A5AF', '#134F5C'], blue: ['#C9DAF8', '#6D9EEB', '#1155CC'],
  navy: ['#D3DCE8', '#5B7393', '#002B5B'], purple: ['#D9D2E9', '#8E7CC3', '#674EA7'], magenta: ['#F1D2EE', '#C267B5', '#8E2C80'],
  gray: ['#CCCCCC', '#666666', '#666666'] };
Book.SYM_COLS = SYM_COLS;
Book.SYM_FAMS = Object.keys(SYM_COLS);
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (Book.root) Book.drawSyms(Book.root); });   // tiles measured before the Ω font arrived fit again
const LEGACY_FAM = { wblue: 'blue', blue: 'blue', red: 'red', gray: 'gray', grey: 'gray', gold: 'gold', green: 'green', purple: 'purple', navy: 'navy', teal: 'teal', orange: 'orange' };
// 'Ω_zx^T' / 'c_{t−1}' / 'c̃_t' → { base, sub, sup }: '_' and '^' take a {…} group or the rest of the word
Book.symParse = s => {
  s = String(s || '').trim();
  const m = /^([^_^]*)(?:_(\{[^}]*\}|[^^]*))?(?:\^(\{[^}]*\}|.*))?$/.exec(s) || [s, s, '', ''];
  const un = x => (x || '').replace(/^\{|\}$/g, '').replace(/-/g, '−');
  return { base: m[1] || '', sub: un(m[2]), sup: un(m[3]) };
};
const SYM_INDEX = /^(?:t|T|\d+)(?:\s*[+−]\s*\d+)?$/;   // a time or step index: t, t−1, t+1, 2, T
Book.symKey = s => { const p = Book.symParse(s); return p.base + (p.sub && !SYM_INDEX.test(p.sub) ? '_' + p.sub : ''); };
Book.symInfo = s => {
  const n = (Book.meta && Book.meta.notation) || {}, p = Book.symParse(s), key = Book.symKey(s);
  if (!p.base) return { key, id: key, fam: 'gray', known: false, entry: null };
  // id: what counts as one thing for colours (a group key, or the quantity); weights, biases and pre-activations
  // coloured by their letter count as one group (Ω_zx and Ω_zc are both just "weights" until the table says otherwise)
  const hint = SYM_HINT.find(([re]) => re.test(p.base)), gid = hint && hint[2] ? p.base + '*' : key;
  if (n[key] && SYM_COLS[n[key]]) return { key, id: key, fam: n[key], known: true, entry: key };
  if (n[p.base + '*'] && SYM_COLS[n[p.base + '*']]) return { key, id: p.base + '*', fam: n[p.base + '*'], known: true, entry: p.base + '*', group: true };
  const c = (Book.meta && Book.meta.colors) || {}, lf = LEGACY_FAM[c[p.base]];   // the letter's colour (accents count: c̃ is not c)
  if (lf) return { key, id: gid, fam: lf, known: true, entry: null, legacy: true, group: gid !== key };
  return { key, id: key, fam: 'gray', known: false, entry: null };
};
// a colour for a new symbol: its role's usual family (Ω weights blue, b grey, Z purple: groups), else the first family
// no other entry in the table, and nothing else in this drawing, already has
const SYM_HINT = [[/^[ΩωW]/, ['blue'], true], [/^b/, ['gray'], true], [/^Z/, ['purple'], true], [/^[xX]/, ['red', 'pink']], [/^ŷ/, ['gold', 'orange']], [/^y/, ['green', 'olive']], [/^[Lℒ]/, ['red']]];
const SYM_ORDER = ['gold', 'orange', 'teal', 'magenta', 'brown', 'olive', 'pink', 'navy', 'green', 'purple', 'red', 'blue'];
Book.symSuggest = (s, taken) => {
  const p = Book.symParse(s), n = (Book.meta && Book.meta.notation) || {}, c = (Book.meta && Book.meta.colors) || {};
  const used = new Set([...Object.values(n), ...Object.values(c).map(f => LEGACY_FAM[f]).filter(Boolean), ...(taken || [])]);   // the letters' colours count as taken too
  const h = SYM_HINT.find(([re]) => re.test(p.base));
  if (h && h[2]) return { key: p.base + '*', fam: h[1][0] };
  const pref = h ? [...h[1], ...SYM_ORDER] : SYM_ORDER;
  return { key: Book.symKey(s), fam: pref.find(f => !used.has(f)) || pref[0] };
};
// the shape line: '1,h' with h from the drawing (data-vars "h=2 d=784") or the chapter (book-meta dims) → '<1, 2>'
Book.symDims = (g, d) => {
  const svg = g && g.closest && g.closest('svg'), vars = {};
  Object.assign(vars, (Book.meta && Book.meta.dims) || {});
  String((svg && svg.getAttribute('data-vars')) || '').split(/[\s,;]+/).forEach(kv => { const m = /^([^=]+)=(.+)$/.exec(kv); if (m) vars[m[1]] = m[2]; });
  return '<' + String(d).split(',').map(x => x.trim()).filter(Boolean).map(x => x in vars ? vars[x] : x).join(',') + '>';
};
// a tile's shape: its own (data-dims), else its quantity's (book-meta shapes {key: '1,h'}, or its group's), with the
// two flipped for a transpose (Ω_zx is h,d, so Ω_zx^T shows <d, h>). Shown like token IDs: a tile's own data-dims always,
// the table's where the tile (data-showdims on), the drawing (class symdims), the page (data-symdims) or the chapter
// (book-meta symDims) asks; data-showdims="off" hides it
Book.symShape = g => {
  const own = g.getAttribute('data-dims'), s = g.getAttribute('data-sym') || '', p = Book.symParse(s), sh = (Book.meta && Book.meta.shapes) || {};
  const pg = g.closest && g.closest('section.page'), svg = g.closest && g.closest('svg'), show = g.getAttribute('data-showdims');
  if (show === 'off') return null;
  if (own) return own;
  const on = show === 'on' || !!((svg && svg.classList.contains('symdims')) || (pg && pg.getAttribute('data-symdims') === 'on') || (Book.meta && Book.meta.symDims && !(pg && pg.getAttribute('data-symdims') === 'off')));
  if (!on) return null;
  const k = Book.symKey(s), d = sh[k] || sh[p.base + '*'];
  if (!d) return null;
  return p.sup === 'T' ? d.split(',').reverse().join(',') : d;
};
Book.symFontFamily = t => (/[Ωℒ]/.test(t) ? "'AI2AI Omega', " : '') + "Consolas, 'Inconsolata LGC', monospace";
// the label's content: base, then the subscript and the superscript as tspans (the superscript stacked over the
// subscript), the way the figure scripts' tiles draw Ω_1^T
Book.symLabel = (lab, s, fs) => {
  const NS = 'http://www.w3.org/2000/svg', p = Book.symParse(s), sig = s + '|' + fs;
  if (lab.getAttribute('data-sl') === sig && lab.childNodes.length) return;
  lab.textContent = p.base || ' ';
  const ts = (t, a) => { const e = document.createElementNS(NS, 'tspan'); for (const k in a) e.setAttribute(k, a[k]); e.textContent = t; lab.append(e); };
  const sup = p.sup === 'T' ? 'T' : p.sup;
  if (p.sub) ts(p.sub, { 'font-size': rn(fs * 0.62), dy: rn(fs * 0.28) });
  if (sup) ts(sup, p.sub ? { 'font-size': rn(fs * 0.62), dx: rn(-fs * 0.62 * 0.58 * [...p.sub].length), dy: rn(-fs * 0.73) } : { 'font-size': rn(fs * 0.62), dy: rn(-fs * 0.45) });
  lab.setAttribute('data-sl', sig);
};
Book.drawSym = g => {
  const NS = 'http://www.w3.org/2000/svg';
  let rect = g.querySelector(':scope > rect'), lab = g.querySelector(':scope > text:not(.tk-sub)'), sub = g.querySelector(':scope > text.tk-sub');
  if (!rect) { rect = document.createElementNS(NS, 'rect'); rect.setAttribute('x', 0); rect.setAttribute('y', 0); rect.setAttribute('width', 20); rect.setAttribute('height', 18); g.prepend(rect); }
  if (!lab) { lab = document.createElementNS(NS, 'text'); lab.setAttribute('font-size', 11); rect.after(lab); }
  const s = g.getAttribute('data-sym') || '', info = Book.symInfo(s), col = SYM_COLS[info.fam] || SYM_COLS.gray;
  const fs = parseFloat(lab.getAttribute('font-size')) || 11;
  const x = parseFloat(rect.getAttribute('x')) || 0, y = parseFloat(rect.getAttribute('y')) || 0, w0 = parseFloat(rect.getAttribute('width')) || 0, h0 = parseFloat(rect.getAttribute('height')) || 0;
  const cx = x + w0 / 2, cy = y + h0 / 2;
  setA(rect, 'fill', col[0]); setA(rect, 'stroke', col[1]);
  setA(rect, 'stroke-width', rn(fs * (g.hasAttribute('data-em') ? 0.2 : 0.1)));
  setA(rect, 'rx', rn(fs * 0.4));
  if (info.known) rect.removeAttribute('stroke-dasharray'); else setA(rect, 'stroke-dasharray', '3 2');
  Book.symLabel(lab, s, fs);
  for (const [k, v] of [['fill', col[2]], ['font-family', Book.symFontFamily(s)], ['font-weight', 'bold'], ['text-anchor', 'middle']]) setA(lab, k, v);
  // the shape (data-dims) is the second line; without it a typed second line (text.tk-sub) stays as it is
  const dims = Book.symShape(g);
  if (dims) {
    if (!sub) { sub = document.createElementNS(NS, 'text'); sub.setAttribute('class', 'tk-sub'); lab.after(sub); }
    const t = Book.symDims(g, dims); if (sub.textContent !== t) sub.textContent = t;
    for (const [k, v] of [['font-size', rn(fs * 0.48)], ['fill', col[2]], ['font-family', "Consolas, 'Inconsolata LGC', monospace"], ['font-weight', 'bold'], ['text-anchor', 'middle']]) setA(sub, k, v);
  } else if (sub && sub.hasAttribute('data-auto')) { sub.remove(); sub = null; }
  if (sub && dims) sub.setAttribute('data-auto', '');
  const sfs = sub ? parseFloat(sub.getAttribute('font-size')) || fs * 0.48 : 0;
  let len = 0, slen = 0; try { len = lab.getComputedTextLength(); if (sub) slen = sub.getComputedTextLength(); } catch (e) {}
  const sgap = sub ? fs * 0.2 : 0;   // a little air between the symbol and its shape line (Eric, 2026-11-12)
  const w = len ? Math.max(len + fs * 1.0, slen + fs * 0.6, fs * 1.6) : w0, h = fs * 1.75 + (sub ? sfs * 1.3 + sgap : 0), top = cy - h / 2;
  setA(rect, 'x', rn(cx - w / 2)); setA(rect, 'width', rn(w)); setA(rect, 'y', rn(top)); setA(rect, 'height', rn(h));
  const base = top + fs * 1.18;
  setA(lab, 'x', rn(cx)); setA(lab, 'y', rn(base));
  if (sub) { setA(sub, 'x', rn(cx)); setA(sub, 'y', rn(base + sfs * 1.45 + sgap)); }
  return Math.abs(w - w0) > 0.05 || Math.abs(h - h0) > 0.05;
};
// a row of symbol tiles and operator labels (g[data-row]: an equation box, or a row the Symbol tool made) is laid
// out again every time, so it stays evenly spaced when a tile changes width (retyped, a late font); a box (the row's
// own rect) is sized round the row and keeps its centre, a row without a box keeps its left edge
Book.layRow = g => {
  const r = g.querySelector(':scope > rect'), items = [...g.children].filter(c => c.matches('g[data-sym]') || c.localName === 'text');
  if (!items.length) return false;
  const lab = el => el.localName === 'g' ? el.querySelector(':scope > text:not(.tk-sub)') : el, fs = parseFloat(lab(items[0]).getAttribute('font-size')) || 9, gap = fs * 0.28;
  const num = (el, k) => parseFloat(el.getAttribute(k)) || 0;
  const ws = items.map(el => { if (el.localName === 'g') return num(el.querySelector(':scope > rect'), 'width'); try { return el.getComputedTextLength(); } catch (e) { return 0; } });
  if (ws.some(w => !w)) return false;   // not laid out yet (a hidden page)
  const tot = ws.reduce((a, b) => a + b, 0) + gap * (items.length - 1), t0 = items.find(el => el.localName === 'g');
  const tr = t0 && t0.querySelector(':scope > rect');
  let x0, cy;
  if (r) { cy = num(r, 'y') + num(r, 'height') / 2; x0 = num(r, 'x') + num(r, 'width') / 2 - tot / 2; }
  else { cy = tr ? num(tr, 'y') + num(tr, 'height') / 2 : num(items[0], 'y') - fs * 0.36; x0 = items[0].localName === 'g' ? num(items[0].querySelector(':scope > rect'), 'x') : num(items[0], 'x'); }
  let x = x0, changed = false;
  items.forEach((el, i) => {
    if (el.localName === 'g') {
      const rr = el.querySelector(':scope > rect'), y = cy - num(rr, 'height') / 2;
      if (Math.abs(num(rr, 'x') - x) > 0.05 || Math.abs(num(rr, 'y') - y) > 0.05) { setA(rr, 'x', rn(x)); setA(rr, 'y', rn(y)); Book.drawSym(el); changed = true; }
    } else { setA(el, 'x', rn(x)); setA(el, 'y', rn(cy + fs * 0.36)); }
    x += ws[i] + gap;
  });
  if (r) {
    const cx = num(r, 'x') + num(r, 'width') / 2, w = tot + fs * 1.2, th = Math.max(...items.filter(el => el.localName === 'g').map(el => num(el.querySelector(':scope > rect'), 'height')), fs) + fs * 0.7;
    if (Math.abs(num(r, 'width') - w) > 0.05) { setA(r, 'x', rn(cx - w / 2)); setA(r, 'width', rn(w)); changed = true; }
    if (num(r, 'height') < th - 0.05) { setA(r, 'y', rn(cy - th / 2)); setA(r, 'height', rn(th)); changed = true; }
  }
  return changed;
};
// an arrow attached to a symbol tile takes that quantity's colour (its start's tile, else its end's), arrowheads too
// (Eric, 2026-11-12: "the Zt arrow should be the same color as the two Zt boxes it's between"); one recoloured by hand
// (data-fixcol) keeps its colour
Book.arrowHead = (svg, color) => {
  const pg = svg.closest && svg.closest('section.page'), own = svg.getAttribute('data-b') || (pg && pg.id ? 'p-' + pg.id : '');
  const hex = color.replace('#', '').toUpperCase(), id = 'ah' + hex + (own ? '-' + own : ''), NS = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector(':scope > defs');
  if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.prepend(defs); }
  if (![...defs.children].some(m => m.id === id)) {
    const m = document.createElementNS(NS, 'marker');
    for (const [k, v] of Object.entries({ id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' })) m.setAttribute(k, v);
    const pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', 'M0 0 L10 5 L0 10 z'); pth.setAttribute('fill', '#' + hex); m.append(pth); defs.append(m);
  }
  return `url(#${id})`;
};
Book.symArrows = svg => {
  const tile = id => { if (!id) return null; try { return svg.querySelector('g[data-sym][id="' + CSS.escape(id) + '"]'); } catch (e) { return null; } };
  for (const l of svg.querySelectorAll('line[data-a], line[data-b], polyline[data-a], polyline[data-b], path[data-a], path[data-b]')) {
    if (l.hasAttribute('data-fixcol')) continue;
    const t = tile(l.getAttribute('data-a')) || tile(l.getAttribute('data-b')); if (!t) continue;
    const col = (SYM_COLS[Book.symInfo(t.getAttribute('data-sym')).fam] || SYM_COLS.gray)[1];
    if (l.getAttribute('stroke') !== col) l.setAttribute('stroke', col);
    for (const a of ['marker-start', 'marker-end']) if (l.getAttribute(a)) { const u = Book.arrowHead(svg, col); if (l.getAttribute(a) !== u) l.setAttribute(a, u); }
  }
  Book.symRowBoxes(svg);
  Book.symArrowsOnTop(svg);
};
// an equation row's box outline takes the colour of what it computes, the tile left of its '=' (Eric, 2026-11-13:
// "color the black boxes … respective to the color of their output", like the gold c_t box); a row without '=' or
// a box recoloured by hand (data-fixcol) keeps its colour
Book.symRowBoxes = svg => {
  for (const g of svg.querySelectorAll('g[data-row]')) {
    const r = g.querySelector(':scope > rect'); if (!r || r.hasAttribute('data-fixcol')) continue;
    const kids = [...g.children], eq = kids.findIndex(e => e.localName === 'text' && /^\s*=/.test(e.textContent)); if (eq < 1) continue;
    const out = kids.slice(0, eq).reverse().find(e => e.matches('g[data-sym]')); if (!out) continue;
    const col = (SYM_COLS[Book.symInfo(out.getAttribute('data-sym')).fam] || SYM_COLS.gray)[1];
    if (r.getAttribute('stroke') !== col) r.setAttribute('stroke', col);
  }
};
// arrows attached to a tile or a row sit above the rows, so a row's box doesn't hide the end that runs in to its tile
// (Eric, 2026-11-13: "go over the black boxes around the equations"); order among the arrows is kept, and nothing
// moves once they are already on top
Book.symArrowsOnTop = svg => {
  const inSym = id => { if (!id) return false; let e; try { e = svg.querySelector('[id="' + CSS.escape(id) + '"]'); } catch (x) { return false; } return !!(e && e.closest('g[data-row], g[data-sym]')); };
  const isBox = e => e.matches && (e.matches('g[data-row], g[data-sym]') || !!e.querySelector('g[data-row], g[data-sym]'));
  const pars = new Set();
  for (const l of svg.querySelectorAll('line[data-a], line[data-b], polyline[data-a], polyline[data-b], path[data-a], path[data-b]'))
    if (!l.closest('g[data-row], g[data-sym]') && (inSym(l.getAttribute('data-a')) || inSym(l.getAttribute('data-b')))) pars.add(l.parentNode);
  let moved = 0;
  pars.forEach(par => {
    const kids = [...par.children], last = kids.map(isBox).lastIndexOf(true); if (last < 0) return;
    const late = kids.slice(0, last).filter(l => l.matches('line, polyline, path') && (inSym(l.getAttribute('data-a')) || inSym(l.getAttribute('data-b'))));
    if (!late.length) return;
    let at = kids[last]; late.forEach(l => { at.after(l); at = l; moved++; });
  });
  return moved;
};
Book.drawSyms = root => {
  const changed = new Set();
  (root || Book.root || document).querySelectorAll('svg.draw g[data-sym]').forEach(g => { if (Book.drawSym(g)) changed.add(g.closest('svg')); });
  (root || Book.root || document).querySelectorAll('svg.draw g[data-row]').forEach(g => { if (Book.layRow(g)) changed.add(g.closest('svg')); });
  if (changed.size && window.Draw && Draw.reconnect) changed.forEach(svg => Draw.reconnect(svg));
  new Set([...(root || Book.root || document).querySelectorAll('svg.draw g[data-sym]')].map(g => g.closest('svg'))).forEach(svg => svg && Book.symArrows(svg));
  return changed.size;
};
// what was typed in the Symbol tool → [{sym: 'Z_z'}, {op: '='}, {sym: 'x_t'}, …]: symbols are a letter (with its
// accent) and an optional _sub / ^sup; function names (σ, tanh, softmax …), numbers and operators stay plain text
const SYM_FUNCS = new Set(['σ', 'tanh', 'softmax', 'relu', 'ReLU', 'exp', 'log', 'sigmoid', 'max', 'min', 'sum', 'mean', 'CE', 'MSE']);
Book.symSplit = text => {
  const out = [], put = (k, v) => { const l = out[out.length - 1]; if (k === 'op' && l && l.op !== undefined) l.op += v; else out.push(k === 'op' ? { op: v } : { sym: v }); };
  const L = /[A-Za-zΑ-Ωα-ωℒŷ]/u, re = /^([A-Za-zΑ-Ωα-ωℒ][̀-ͯ]*|ŷ|ỹ)(_(?:\{[^}]*\}|[A-Za-z0-9̀-ͯα-ω̃]+(?:[−-]\d+)?))?(\^(?:\{[^}]*\}|[A-Za-z0-9⊤ᵀ]+))?/u;
  let i = 0; const s = String(text || '');
  while (i < s.length) {
    const rest = s.slice(i), w = /^[A-Za-z]{2,}/.exec(rest);
    if (w && SYM_FUNCS.has(w[0])) { put('op', w[0]); i += w[0].length; continue; }
    if (rest[0] === 'σ') { put('op', 'σ'); i++; continue; }
    if (L.test(rest[0])) { const m = re.exec(rest); if (m) { put('sym', m[0].replace(/ᵀ|⊤/g, 'T')); i += m[0].length; continue; } }
    put('op', rest[0]); i++;
  }
  return out.map(x => x.op !== undefined ? { op: x.op.replace(/\s+/g, ' ').trim() } : x).filter(x => x.sym || x.op);
};
class BTok extends HTMLElement {
  static get observedAttributes() { return ['v', 't']; }
  connectedCallback() { if (inThumb(this)) return; lock(this); if (!this.hasAttribute('t')) this.setAttribute('t', this.textContent); else this.render(); if (!Book.vocabs) Book.loadVocabs(); }
  attributeChangedCallback() { if (this.isConnected && !inThumb(this)) this.render(); }
  render() {
    const t = this.getAttribute('t') || '', info = Book.tokInfo(this.getAttribute('v'), t);
    this.dataset.f = info.fam; this.classList.toggle('tk-unknown', !!Book.vocabs && !info.known);
    this.title = (Book.vocabs && Book.vocabs[this.getAttribute('v')] ? Book.vocabs[this.getAttribute('v')].title + ': ' : '') + JSON.stringify(t) + (info.known ? ' = ' + info.id : ' (not in the vocabulary)');
    this.innerHTML = `<span class="tk-t">${esc(Book.tokLabel(t))}</span><span class="tk-id">${info.known ? info.id : '?'}</span>`;
  }
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
  // --ar: the figure's shape (width / height) as a CSS variable, so a slide can cap a figure's height (book.css);
  // runtime only, never saved
  setRatio() {
    let ar = 0;
    if (this.stretched()) { const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(this.style.aspectRatio); ar = m ? m[1] / m[2] : parseFloat(this.style.aspectRatio) || 0; }
    else ar = this.naturalRatio();
    if (ar > 0 && isFinite(ar)) { const v = ar.toFixed(3); if (this.style.getPropertyValue('--ar') !== v) this.style.setProperty('--ar', v); }
  }
  applyCrop() {
    this._applyCrop(); this.setRatio();
  }
  _applyCrop() {
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
    const src = Book.serializePage(c).replace(/^<section([^>]*?) id="[^"]*"/, '<section$1').replace(/ data-b="[^"]*"/g, '');   // block ids aren't content
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
// equations typeset in the browser (Book.mathml: set where there is no TeX, i.e. the hosted editor): Temml + eqml.js,
// loaded on first use
let eqmlP = null;
function loadEqML() {
  if (window.EqML && window.temml) return Promise.resolve();
  return eqmlP || (eqmlP = Promise.all(['../app/temml.min.js', '../app/eqml.js'].map(src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s);
  }))).then(() => { EqML.addFonts(); }).catch(e => { eqmlP = null; throw e; }));
}
const EQ_UC = 'αβγδεθλμσφηρτωΩξŷ';   // the symbols server.py TEX spells as commands
class BEq extends HTMLElement {
  static get observedAttributes() { return ['flush', 'gap']; }
  attributeChangedCallback() { if (this.isConnected && !inThumb(this) && this._key) this.render(); }
  connectedCallback() { if (inThumb(this)) return; lock(this); this.render(); }
  rows() {
    return [...this.children].filter(c => /^EQ-(ROW|STEP)$/.test(c.tagName)).map(c => c.tagName === 'EQ-ROW'
      ? ['eq', Book.eqNum(c), c.getAttribute('note') || null, texOf(c)] : ['step', texOf(c)]);
  }
  render() {
    Book.numberEquations();
    const rows = this.rows();
    // a note with Ω is drawn with the tall ω since 2026-10-28: the extra 'om' gives those equations a new image
    // flush: no number column, the rows start at the box's left edge (Eric 2026-11-01, so a wide equation draws larger)
    // on Lecture pages an equation with no numbered row is flush too (Eric, 2026-11-09: the empty number column pushed
    // un-numbered slide equations in, so they never looked centred); Reading equations keep the column to line up
    const pgEl = this.closest('section.page'), pgv = (pgEl && pgEl.getAttribute('data-view')) || '';
    const lecture = /\bslides\b/.test(pgv) && !/\breading\b/.test(pgv);
    const flush = this.hasAttribute('flush') || (lecture && !rows.some(r => r[0] === 'eq' && r[1]));
    // gap: the space between rows in pt at the equation's 16pt size (default 5.6), Eric 2026-11-02
    const gap = Math.max(0, parseFloat(this.getAttribute('gap')) || 0);
    // a coloured symbol typed as itself (ω, σ, ŷ …, not \omega) takes its colour since 2026-11-03 (server.py
    // texcolors): the extra 'uc' gives those equations a new image
    const cols = Book.meta.colors || {}, uc = rows.some(r => [...(r[0] === 'eq' ? r[3] : r[1]) || ''].some(c => EQ_UC.includes(c) && cols[c]));
    const key = hash(JSON.stringify([rows, cols, Book.kit].concat(rows.some(r => r[0] === 'eq' && r[2] && r[2].includes('Ω')) ? ['om'] : [], flush ? ['flush'] : [], gap ? ['gap' + gap] : [], uc ? ['uc'] : [])));
    if (key === this._key) return this._done;
    this._key = key;
    const url = Book.url('eq/' + key + '.svg');
    this.classList.add('busy');
    const done = async () => {
      let err = '', html = '';
      try {
        let ok = (await fetch(url, { method: 'HEAD' })).ok;
        if (!ok && Book.mathml) {   // no TeX on this device: typeset it here (eqml.js), no image needed
          try { await loadEqML(); if (this._key !== key) return; html = EqML.render(rows, Book.meta.colors || {}, flush, gap); }
          catch (e) { err = 'TeX: ' + String(e.message || e).replace(/^ParseError:\s*/, ''); }
        } else if (!ok && Book.api) {
          const release = await eqSlot();
          try {
            if (this._key !== key) return;
            const r = await fetch('../api/eq/' + Book.chapter, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, rows, colors: Book.meta.colors || {}, flush, gap }) });
            ok = r.ok; if (!ok) err = (await r.json().catch(() => ({}))).error || 'could not render';
          } finally { release(); }
        } else if (!ok) err = 'equation image missing';
      } catch (e) { err = String(e.message || e); }
      if (this._key !== key) return;
      this.querySelectorAll(':scope > [data-rt]').forEach(n => { if (err || html || n.tagName !== 'IMG') n.remove(); });
      this.classList.remove('busy');
      this.classList.toggle('bad', !!err);
      this.error = err;
      if (err) {
        const d = document.createElement('div'); d.className = 'eq-err'; d.setAttribute('data-rt', ''); d.textContent = err; this.append(d);
      } else if (html) {
        const d = document.createElement('div'); d.className = 'eq-ml'; d.setAttribute('data-rt', ''); d.setAttribute('contenteditable', 'false'); d.innerHTML = html; this.append(d);
        this.querySelectorAll(':scope > eq-row[label]').forEach(r => { const a = document.createElement('a'); a.id = 'eq-' + r.getAttribute('label'); a.setAttribute('data-rt', ''); this.prepend(a); });
        if (document.fonts) await document.fonts.ready;   // the math font changes the size: measure pages after it has loaded
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
// marks="3:4-18:gold 7:0-9:blue": a tinted box behind part of a line (1-based line, 0-based columns).
// The kind "fill" (3:8-20:fill) is a fill-in blank: plain code when reading, an underline to write on in the Lecture
// and Workbook (u.fill, like blanks in text: faint for the signed-in instructor, a real gap in the exported Workbook).
function codeMarks(attr, lang) {
  // lang="text" (prompts, data, plain output in a code box: BaLLM's evals chapter) gets no Python colouring
  // one st per block: the returned function is called line by line in order, so a triple-quoted string carries over
  const st = {};
  const hl = lang && !/^(python|py)$/i.test(lang) ? l => l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : l => highlight(l, st);
  const marks = {};
  (attr || '').split(/[\s;]+/).forEach(m => { const q = /^(\d+):(\d+)-(\d+)(?::(\w+))?$/.exec(m); if (q) (marks[q[1] - 1] = marks[q[1] - 1] || []).push([+q[2], +q[3], q[4] || 'gold']); });
  return (l, k) => {
    if (!marks[k]) return hl(l);
    let out = '', at = 0;
    for (const [a, b, c] of marks[k].sort((x, y) => x[0] - y[0])) { if (a < at || b <= a) continue; const inner = hl(l.slice(a, b)); out += hl(l.slice(at, a)) + (c === 'fill' ? `<u class="fill">${inner}</u>` : `<mark class="${c}">${inner}</mark>`); at = b; }
    return out + hl(l.slice(at));
  };
}
Book.codeMarks = codeMarks;
class BCode extends HTMLElement {
  // Moving a rendered block (presenting mode wraps #book in its scroll boxes) calls this again: drawing it afresh then
  // threw away the Run bar eaiRunCode had added and any live output, so no cell could run while presenting (Eric,
  // 2026-11-09). Only draw when the source differs from what was last drawn.
  connectedCallback() { if (inThumb(this)) return; lock(this); if (!this.hasAttribute('data-src')) this.setAttribute('data-src', rawText(this)); if (this._drawn === this.drawKey() && this.firstElementChild) return; this.render(); }
  drawKey() { return [this.src, this.getAttribute('marks'), this.getAttribute('hl'), this.getAttribute('tok'), this.getAttribute('lang'), this.getAttribute('figs')].join('\u0000'); }
  get src() { return this.getAttribute('data-src') || ''; }
  set src(v) { this.setAttribute('data-src', v); this.render(); Book.refreshSoon(); }
  render() {
    this._drawn = this.drawKey();
    const lines = this.src.split('\n'), line = codeMarks(this.getAttribute('marks'), this.getAttribute('lang'));
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
  // figs="fig/out-….png …": plots saved with the Output by the editor's Run and fill in Output (Eric, 2026-11-10), drawn
  // under the text like a live run's (the published page inlines them, so they print and survive without Python)
  render() {
    this._drawn = this.drawKey();
    const figs = (this.getAttribute('figs') || '').split(/\s+/).filter(Boolean);
    this.innerHTML = `<div class="label">Output</div><pre>${eaiOutHL(this.src, Book.meta.codeColors, this.getAttribute('hl'), eaiOutTok(this))}</pre>`
      + (figs.length ? `<div class="run-figs">${figs.map(f => `<img src="${Book.url(f)}" alt="Plot from the code above">`).join('')}</div>` : '');
  }
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
  for (const [n, c] of [['b-m', BM], ['b-tok', BTok], ['b-ref', BRef], ['b-fig', BFig], ['b-eq', BEq], ['b-code', BCode], ['b-out', BOut], ['b-matmul', BMatmul], ['b-answers', BAnswers], ['b-toc', BToc], ['b-embed', BEmbed]])
    if (!customElements.get(n)) customElements.define(n, c);
};

// ---------------------------------------------------------------- equation numbers
// An <eq-row label="name"> is numbered in document order: [chapter.n] (meta.chapter), or [n] without a chapter number.
// <eq-row same="name"> repeats another equation's number (a recap) without taking one. A literal num="4.2" is kept as is.
Book.eqNums = {}; Book.eqNumsBy = {};
Book.numberEquations = () => {
  if (!Book.root) return;
  const pre = Book.meta.chapter != null && Book.meta.chapter !== '' ? Book.meta.chapter + '.' : '', panes = Book.panes();
  Book.eqNumsBy = {};
  for (const v of panes.length ? panes.map(p => p.dataset.view) : [Book.view]) {   // numbered per edition (with panes: per pane)
    const nums = {}; let n = 0;
    Book.root.querySelectorAll('eq-row[label]').forEach(r => { const pg = r.closest('section.page'); if (pg && !Book.inView(pg, v)) return; const l = r.getAttribute('label'); if (l && !r.hasAttribute('same') && !(l in nums)) nums[l] = pre + (++n); });
    Book.eqNumsBy[v] = nums;
  }
  Book.eqNums = Book.eqNumsBy[Book.view] || Object.values(Book.eqNumsBy)[0] || {};
};
Book.eqNum = row => { const nums = Book.eqNumsBy[Book.viewOf(row)] || Book.eqNums; return row.hasAttribute('same') ? (nums[row.getAttribute('same')] || '?') : row.hasAttribute('label') ? (nums[row.getAttribute('label')] || null) : (row.getAttribute('num') || null); };

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
// The editor can show a split chapter's two documents side by side, each in its own pane: div.dpane.book[data-view]
// inside the root (see "both documents" in editor.js). Pages then sit one level down, and every element takes its
// edition from its pane (Book.viewOf); without panes it is Book.view, as before.
Book.pages = () => [...Book.root.querySelectorAll(':scope > section.page, :scope > .dpane > section.page')];
Book.panes = () => Book.root ? [...Book.root.querySelectorAll(':scope > .dpane')] : [];
// Page sizes in pt: the Reading and the Workbook are 6 × 9 in book pages, the Lecture is a 4:3 slide (10 × 7.5 in;
// Eric, 2026-10-29, closer to his iPad; 16:9 at 10 × 5.625 in from 2026-10-26). book.css sets --page-w/--page-h per edition; these say the same in JS.
// Text column: 24pt margins either side; content must end 26pt above the bottom (the footer line).
// A hard reload (Cmd+Shift+R) loads the page past the hosted editor's service worker, and then ../api/… (the chapters,
// answered by that worker from this device's store) isn't there. Ask the worker to take the page over (clients.claim),
// or failing that reload once normally. On the Mac's server.py there is no worker and this does nothing.
Book.swReady = async () => {
  const sw = navigator.serviceWorker; if (!sw || sw.controller) return;
  const reg = await sw.getRegistration().catch(() => null); if (!reg || !reg.active) return;
  await new Promise(res => { const t = setTimeout(res, 1500); sw.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true }); reg.active.postMessage({ type: 'claim' }); });
  let tried = false; try { tried = sessionStorage.getItem('ai2ai-claim-reload') === '1'; } catch (x) {}
  if (sw.controller) { try { sessionStorage.removeItem('ai2ai-claim-reload'); } catch (x) {} return; }
  if (!tried) { try { sessionStorage.setItem('ai2ai-claim-reload', '1'); } catch (x) {} location.reload(); await new Promise(() => {}); }
};
Book.SIZES = { reading: { w: 432, h: 648 }, slides: { w: 720, h: 540 }, workbook: { w: 432, h: 648 } };   // the Workbook prints like the Reading (6 × 9 in), for paper and tablets
Book.size = el => Book.SIZES[el && el.nodeType ? Book.viewOf(el) : (el || Book.view)] || Book.SIZES.reading;
Book.pageW = el => Book.size(el).w;
Book.pageH = el => Book.size(el).h;
Book.viewOf = el => { const p = el && el.closest && el.closest('.dpane'); return p ? p.dataset.view : Book.view; };
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
Book.setView = v => { Book.view = Book.views.includes(v) ? v : 'reading'; if (Book.root) { if (!Book.panes().length) Book.root.dataset.view = Book.view; Book.refresh(); } };
Book.inView = (el, v) => {
  v = v || Book.viewOf(el);
  if (el.classList && el.classList.contains('wb-packed')) return false;   // a Workbook page whose blocks went onto the page before it
  if (el.hasAttribute('data-view')) return el.getAttribute('data-view').split(/\s+/).includes(v);
  if (v === 'reading') return !(el.classList && (el.classList.contains('wbox') || (el.localName === 'aside' && el.classList.contains('qc'))));   // write-in boxes too   // questions belong to the lecture and the workbook; Reading is just reading
  if (el.classList.contains('aside') || el.localName === 'b-answers') return false;          // notes and the answer list are for reading
  const top = el.parentElement && el.parentElement.classList.contains('page');
  if (Book.hasKeys && top && el.tagName === 'P' && !el.querySelector('.key')) return false;   // in a chapter with key sentences, a paragraph without one is reading only
  return true;
};
// Text wrap: a pinned block with class "wrap" pushes aside the text of the flow blocks beside it. Each text block it
// overlaps gets an invisible float at its start (span.wrapf, data-rt so it's never saved), one per side, sized in pt and
// shaped with shape-outside so it starts level with the picture: the browser itself reflows the lines, so editing,
// printing and the published page all keep working. Two pictures on the same side of a block merge into one float.
// A list beside a left picture gets data-ed-wl (book.css: its items avoid the float, so the bullets move with the text).
// Runs top to bottom, measuring as it goes, since a block that grows pushes the next one down.
const TEXTY = /^(p|ul|ol|h[1-6]|div|aside|blockquote)$/, WRAP_PAD = 8, WRAP_MIN = 72;   // pt: gap around a picture, narrowest text column worth wrapping into
function wrapFloat(el, side, w, t, h) {
  const f = document.createElement('span');
  f.className = 'wrapf'; f.setAttribute('data-rt', ''); f.setAttribute('contenteditable', 'false'); f.setAttribute('aria-hidden', 'true'); f.dataset.side = side;
  f.style.cssText = `float:${side};width:${w.toFixed(1)}pt;height:${Math.max(1, h).toFixed(1)}pt;margin-top:${t.toFixed(1)}pt;shape-outside:inset(${t.toFixed(1)}pt 0 0 0)`;
  el.prepend(f); return f;
}
Book.wrapText = pg => {
  pg.querySelectorAll(':scope > * > span.wrapf').forEach(f => f.remove());
  pg.querySelectorAll(':scope > [data-ed-wl]').forEach(el => el.removeAttribute('data-ed-wl'));
  const wraps = [...pg.children].filter(el => el.classList.contains('wrap') && Book.isPinned(el) && Book.inView(el));
  if (!wraps.length) return false;
  const r = pg.getBoundingClientRect(); if (!r.width) return false;
  const s = r.width / Book.pageW(pg), P = q => ({ l: (q.left - r.left) / s, r: (q.right - r.left) / s, t: (q.top - r.top) / s, b: (q.bottom - r.top) / s });
  const W = wraps.map(w => { const q = P(w.getBoundingClientRect()); return { l: q.l - WRAP_PAD, r: q.r + WRAP_PAD, t: q.t - WRAP_PAD, b: q.b + WRAP_PAD }; }).filter(o => o.b > o.t + WRAP_PAD);
  for (const el of pg.children) {
    if (!TEXTY.test(el.localName) || Book.isPinned(el) || el.hasAttribute('data-rt') || el.classList.contains('foot') || el.classList.contains('cmt') || el.classList.contains('cover-text') || !Book.inView(el) || !el.textContent.trim()) continue;
    const q = el.getBoundingClientRect(); if (!q.height) continue;
    const b = P(q), mid = (b.l + b.r) / 2, sides = {};
    for (const o of W) {
      if (!(o.t < b.b && o.b > b.t && o.r > b.l && o.l < b.r)) continue;
      const side = (o.l + o.r) / 2 < mid ? 'left' : 'right', width = side === 'left' ? o.r - b.l : b.r - o.l, u = sides[side];
      sides[side] = u ? { w: Math.max(u.w, width), t: Math.min(u.t, o.t), b: Math.max(u.b, o.b) } : { w: width, t: o.t, b: o.b };
    }
    const col = b.r - b.l, total = (sides.left ? sides.left.w : 0) + (sides.right ? sides.right.w : 0);
    if (!sides.left && !sides.right) continue;
    if (col - total < WRAP_MIN) {   // not enough room for both: keep the narrower picture's wrap, if that one alone leaves room
      const keep = ['left', 'right'].filter(k => sides[k] && col - sides[k].w >= WRAP_MIN).sort((x, y) => sides[x].w - sides[y].w)[0];
      for (const k of ['left', 'right']) if (k !== keep) delete sides[k];
      if (!keep) continue;
    }
    const fl = {};
    for (const k of ['left', 'right']) if (sides[k]) { const o = sides[k], t = Math.max(0, o.t - b.t); fl[k] = { f: wrapFloat(el, k, o.w, t, o.b - b.t - t), t, b: o.b }; }
    if (fl.left && /^(ul|ol)$/.test(el.localName)) el.setAttribute('data-ed-wl', '');
    // a block whose text ends beside a picture shouldn't be stretched to the picture's bottom: trim each float to its last line
    const rg = document.createRange(); rg.selectNodeContents(el);
    let tb = 0; for (const c of rg.getClientRects()) if (c.height && c.width) tb = Math.max(tb, (c.bottom - r.top) / s);
    const top = (el.getBoundingClientRect().top - r.top) / s;
    for (const k in fl) {
      const { f, t, b: bot } = fl[k];
      if (tb - top <= t + 0.5) f.remove();
      else if (tb < bot) f.style.height = Math.max(1, tb - top - t).toFixed(1) + 'pt';
    }
    if (!el.querySelector(':scope > span.wrapf[data-side="left"]')) el.removeAttribute('data-ed-wl');
  }
  return true;
};
// The Workbook prints at 6 × 9 (like the Reading) while the Lecture is a 4:3 slide, so in a split chapter's Workbook the
// slides that continue one another (the same title on consecutive pages) go back onto one page as long as it fits:
// the later page's blocks move onto the first and the later page is hidden (class wb-packed). Viewer and export only
// (view.html), never in the editor, whose pages must stay the file's pages; unpackWorkbook() puts everything back.
Book.unpackWorkbook = () => {
  if (!Book.root) return;
  Book.root.querySelectorAll('[data-wb-from]').forEach(el => {
    const pg = document.getElementById(el.getAttribute('data-wb-from')); el.removeAttribute('data-wb-from');
    if (pg) pg.insertBefore(el, pg.querySelector(':scope > .foot'));
  });
  Book.root.querySelectorAll('section.page.wb-packed').forEach(p => p.classList.remove('wb-packed'));
};
Book.packWorkbook = () => {
  Book.unpackWorkbook();
  if (!Book.root || Book.view !== 'workbook' || !Book.meta.split || Book.panes().length) return false;
  const title = pg => { const h = pg.querySelector(':scope > h2'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const skip = el => el.localName === 'h2' || el.hasAttribute('data-rt') || el.classList.contains('foot') || el.classList.contains('ink') || el.classList.contains('overlay') || el.hasAttribute('data-ink');
  const fits = host => {   // the host's blocks end above the footer (gaps at their smallest, as Book.refresh measures)
    const r = host.getBoundingClientRect(); if (!r.width) return true;
    const s = r.width / Book.pageW(host); let bottom = 0;
    for (const el of host.children) { if (skip(el) && el.localName !== 'h2') continue; if (!Book.inView(el) || Book.isPinned(el)) continue; const q = el.getBoundingClientRect(); if (q.height) bottom = Math.max(bottom, (q.bottom - r.top) / s); }
    return bottom <= Book.pageH(host) - 30;
  };
  let host = null, packed = 0;
  for (const pg of Book.pages()) {
    if (!Book.inView(pg) || pg.classList.contains('cover')) continue;
    const t = title(pg);
    if (host && t && pg.id && t === title(host)) {
      const moved = [...pg.children].filter(el => !skip(el)), foot = host.querySelector(':scope > .foot'), gap = host.style.getPropertyValue('--gap');
      host.style.removeProperty('--gap');
      moved.forEach(el => { el.setAttribute('data-wb-from', pg.id); host.insertBefore(el, foot); });
      if (fits(host)) { pg.classList.add('wb-packed'); packed++; continue; }
      moved.forEach(el => { el.removeAttribute('data-wb-from'); pg.insertBefore(el, pg.querySelector(':scope > .foot')); });
      if (gap) host.style.setProperty('--gap', gap);
    }
    host = pg;
  }
  return packed > 0;
};
Book.refreshSoon = () => { if (!soon) soon = setTimeout(() => { soon = 0; if (Book.root) Book.refresh(); }, 60); };
// a write-in box's starter (Eric, 2026-11-10: one kind of answer box, not two): div.wbox data-start="TeX" shows that
// TeX in its top-left corner (∂ℒ/∂b₁ =) as a flush equation, runtime only (data-rt, never saved); the box keeps its height
Book.wboxStarts = root => {
  for (const b of root.querySelectorAll('div.wbox')) {
    const t = b.getAttribute('data-start') || '', cur = b.querySelector(':scope > b-eq.wstart');
    if (cur && t && cur._t === t) continue;
    if (cur) cur.remove();
    if (!t) continue;
    const e = document.createElement('b-eq'); e.className = 'wstart'; e.setAttribute('data-rt', ''); e.setAttribute('flush', ''); e.setAttribute('contenteditable', 'false');
    const r = document.createElement('eq-row'); r.textContent = t; e.append(r); e._t = t; b.prepend(e);
  }
};
// A drawing's answer parts (docs/blank-pads.md phase 3, book.css): what CSS alone can't say. The arrows attached to a
// tile marked "all" go with it (data-rt-fill = the tile's id; they're revealed with it, Book.reveal), and every part
// gets a dashed outline round it (a data-rt rect right after it, as an equation's answer box has; Eric, 2026-11-14:
// "it's a little hard to tell that a diagram has a fill box"), shown until the part is. Slides and Workbook only. Not in
// the editor, which saves the drawing: there the parts just show faintly (editor.css).
Book.fillParts = root => {
  if (typeof document === 'undefined' || document.body.classList.contains('ed')) return;
  for (const svg of root.querySelectorAll('svg.draw')) {
    svg.querySelectorAll('[data-rt-fill]').forEach(a => a.removeAttribute('data-rt-fill'));
    svg.querySelectorAll('.fill-ph[data-rt]').forEach(l => l.remove());
    if (!svg.querySelector('[data-fill]')) continue;
    for (const g of svg.querySelectorAll('g[data-fill="all"][id]'))
      svg.querySelectorAll(':is(line, polyline, path)[data-a], :is(line, polyline, path)[data-b]').forEach(a => {
        if (a.getAttribute('data-a') === g.id || a.getAttribute('data-b') === g.id) { a.setAttribute('data-rt-fill', g.id); a.classList.toggle('shown', g.classList.contains('shown')); }
      });
    if (Book.view !== 'slides' && Book.view !== 'workbook') continue;
    for (const p of svg.querySelectorAll('[data-fill]')) {
      if (p.parentElement.closest('[data-fill]')) continue;
      let b; try { b = p.getBBox(); } catch (e) { continue; }
      if (!b.width && !b.height) continue;
      const pad = 4, h = Math.max(b.height + 2 * pad, 12), w = Math.max(b.width + 2 * pad, 12);
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [k, v] of Object.entries({ x: (b.x + b.width / 2 - w / 2).toFixed(1), y: (b.y + b.height / 2 - h / 2).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 4,
        fill: 'none', stroke: '#999999', 'stroke-width': 1, 'stroke-dasharray': '4 3', class: 'fill-ph', 'data-rt': '', 'pointer-events': 'none' })) r.setAttribute(k, v);
      p.after(r);
    }
  }
};
// a tap shows (or hides again) a blank's answer; a whole tile brings its arrows
Book.reveal = f => {
  const on = f.classList.toggle('shown'), svg = f.id && f.closest('svg');
  if (svg) svg.querySelectorAll('[data-rt-fill]').forEach(a => { if (a.getAttribute('data-rt-fill') === f.id) a.classList.toggle('shown', on); });
  return on;
};
Book.refresh = () => {
  if (Book.root) Book.wboxStarts(Book.root);
  if (Book.root) Book.root.classList.toggle('tokids', !!Book.meta.tokIds);   // token tiles show their IDs everywhere (book-meta tokIds)
  if (Book.root) Book.drawSyms(Book.root);   // symbol tiles in drawings (notation table)
  if (Book.root) Book.fillParts(Book.root);   // drawings' answer parts: a whole tile's arrows, every part's dashed outline
  if (Book.root) { if (Book.vocabs) Book.drawToks(Book.root); else if (Book.root.querySelector('svg.draw g[data-tok], b-out[tok]') || Book.meta.outTok) Book.loadVocabs(); }   // token tiles in drawings
  const root = Book.root, pages = Book.pages(), title = Book.meta.title || '', panes = Book.panes();
  if (panes.length) root.removeAttribute('data-view'); else if (root.dataset.view !== Book.view) root.dataset.view = Book.view;
  Book.hasKeys = !Book.meta.split && !!root.querySelector('.page > p .key'); root.classList.toggle('keys', Book.hasKeys);   // key sentences: the old shared-page model only
  Book.split = !!Book.meta.split; root.classList.toggle('split', Book.split);   // split: Lecture and Reading are separate documents in one file
  // page numbers and running heads count only this edition's pages (with panes: each pane's edition, the cover included)
  const numBy = {};
  for (const v of panes.length ? panes.map(p => p.dataset.view) : [Book.view]) {
    const shown = pages.filter(pg => Book.inView(pg, v)), num = numBy[v] = {};
    shown.forEach((pg, k) => { if (pg.id) num[pg.id] = k + 1; });
    let part = '';
    shown.forEach((pg, k) => {
    if (pg.dataset.part) part = pg.dataset.part;
    if (panes.length && Book.viewOf(pg) !== v) return;   // drawn in its own pane's numbering
    let foot = pg.querySelector(':scope > .foot');
    const label = title + (part ? ' · ' + part : ''), n = String(k + 1).padStart(2, '0');
    if (!foot) { foot = document.createElement('div'); foot.className = 'foot'; foot.setAttribute('data-rt', ''); foot.setAttribute('contenteditable', 'false'); foot.innerHTML = '<span></span><span></span>'; }
    if (foot !== pg.lastElementChild) pg.append(foot);
    if (foot.children[0].textContent !== label) foot.children[0].textContent = label;
    if (foot.children[1].textContent !== n) foot.children[1].textContent = n;
    });
  }
  const numOf = el => numBy[Book.viewOf(el)] || numBy[Book.view] || Object.values(numBy)[0] || {};
  Book.numberEquations();
  root.querySelectorAll('b-eq').forEach(e => e.render && e.render());   // numbers may have shifted
  root.querySelectorAll('b-ref').forEach(r => {
    let h = ''; const num = numOf(r), eqNums = Book.eqNumsBy[Book.viewOf(r)] || Book.eqNums;
    if (r.hasAttribute('page')) { const p = r.getAttribute('page'); h = `<a href="#${escAttr(p)}">page ${num[p] || '?'}</a>`; }
    else if (r.hasAttribute('pages')) { const [a, b] = r.getAttribute('pages').split(':'); h = `pp. ${num[a] || '?'}–${num[b] || '?'}`; }
    else if (r.hasAttribute('eq')) { const e = r.getAttribute('eq'), known = e in eqNums, lit = /^[\d.]+$/.test(e); h = `<a href="#eq-${escAttr(e)}"${known || lit ? '' : ' class="bad"'}>[${esc(known ? eqNums[e] : lit ? e : '?')}]</a>`; }
    if (r.innerHTML !== h) r.innerHTML = h;
  });
  root.querySelectorAll('b-toc').forEach(box => {   // contents: one line per page that starts a section
    const num = numOf(box), rows = pages.filter(p => p.dataset.part && p.id && num[p.id]), key = rows.map(p => p.id + '\u0001' + p.dataset.part + '\u0001' + num[p.id]).join('\u0002');
    if (box._key === key && box.childElementCount === rows.length) return; box._key = key;
    box.replaceChildren(...rows.map(p => { const a = document.createElement('a'); a.setAttribute('data-rt', ''); a.href = '#' + p.id; a.innerHTML = `<span>${esc(p.dataset.part)}</span><i></i><span>${num[p.id]}</span>`; return a; }));
  });
  const answers = root.querySelectorAll('b-answers');
  if (answers.length) {   // <b-answers pages="id id"> lists only those pages' answers, a plain <b-answers> lists the rest
    const all = [...root.querySelectorAll('.qc > .ans')], ids = b => (b.getAttribute('pages') || '').split(/\s+/).filter(Boolean);
    const claimed = new Set([...answers].flatMap(ids));
    answers.forEach(box => {
      const num = numOf(box), mine = new Set(ids(box)), list = all.filter(a => { const id = a.closest('.page')?.id; return mine.size ? mine.has(id) : !claimed.has(id); });
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
    // Push to bottom (Eric, 2026-11-03: room in the middle of a slide to draw on): a block with data-push and everything after it
    // sit against the bottom of the page. The room goes into span.pushgap before it (data-rt, never saved), not into the gaps.
    const push = [...pg.children].find(el => el.hasAttribute('data-push') && !el.hasAttribute('data-rt') && !Book.isPinned(el) && Book.inView(el) && el.getBoundingClientRect().height);
    let pgap = pg.querySelector(':scope > .pushgap');
    if (!push && pgap) { pgap.remove(); pgap = null; }
    if (push) {
      if (!pgap) { pgap = document.createElement('div'); pgap.className = 'pushgap'; pgap.setAttribute('data-rt', ''); pgap.setAttribute('contenteditable', 'false'); pgap.setAttribute('aria-hidden', 'true'); pgap.style.height = '0pt'; }
      if (pgap.nextElementSibling !== push) push.before(pgap);
      if (pg.style.getPropertyValue('--gap')) pg.style.removeProperty('--gap');   // the spare room goes into the gap, not between the blocks
    }
    const s = r.width / Book.pageW(pg), cur = parseFloat(pg.style.getPropertyValue('--gap')) || 10, PW = Book.pageW(pg), PH = Book.pageH(pg);
    const wraps = Book.wrapText(pg);
    let bottom = 0, right = 0, n = 0, joined = 0, pinBottom = 0;
    for (const el of pg.children) {
      if (el.hasAttribute('data-rt') || el.classList.contains('web-only') || el.classList.contains('overlay') || el.classList.contains('ink') || !Book.inView(el)) continue;   // svg.ink: the pen layer covers the whole page
      const q = el.getBoundingClientRect(); if (!q.height) continue;
      right = Math.max(right, (q.right - r.left) / s);
      if (Book.isPinned(el)) { pinBottom = Math.max(pinBottom, (q.bottom - r.top) / s); continue; }
      bottom = Math.max(bottom, (q.bottom - r.top) / s); n++;
      if (el.tagName === 'B-CODE' && el.nextElementSibling && el.nextElementSibling.tagName === 'B-OUT') joined++;
    }
    const pushH = pgap ? parseFloat(pgap.style.height) || 0 : 0;
    if (pgap) {   // the gap fills what's left of the page (PH - 44, as the spacing below), or goes if there's nothing left
      const room = +(PH - 44 - (bottom - pushH)).toFixed(1);
      if (room <= 0) { pgap.remove(); pgap = null; bottom -= pushH + cur; }   // the gap also took a row gap of its own (2026-11-08: lec-chain read 10pt over once it was gone)
      else if (Math.abs(room - pushH) > 0.05) { pgap.style.height = room + 'pt'; bottom += room - pushH; if (wraps) Book.wrapText(pg); }
    }
    const gaps = Math.max(0, n - 1 - joined), base = bottom - gaps * (cur - 10), free = PH - 44 - base;
    let gap = cur;
    if (!Book.freezeGaps && !push) {
      gap = free > 6 && gaps > 0 ? +(10 + Math.min(free / gaps, 12)).toFixed(1) : 10;
      if (Math.abs(gap - cur) > 0.05) { if (gap === 10) pg.style.removeProperty('--gap'); else pg.style.setProperty('--gap', gap + 'pt'); if (wraps) Book.wrapText(pg); }   // blocks moved: re-place the wrap floats
    }
    const end = Math.round(Math.max(base + gaps * (gap - 10), pinBottom)), over = end > PH - 26 || Math.round(right) > PW - 23;
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
      v = v.split(';').map(d => d.trim()).filter(d => d && !d.startsWith('--gap') && !d.startsWith('--ar') && !d.startsWith('--mm-h')).join('; '); if (!v) continue;
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
  if (tag === 'b-tok') return `<b-tok v="${escAttr(node.getAttribute('v') || '')}" t="${escAttr(node.getAttribute('t') || '').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')}"${node.hasAttribute('o') ? ` o="${escAttr(node.getAttribute('o'))}"` : ''}${/^(on|off)$/.test(node.getAttribute('ids') || '') ? ` ids="${node.getAttribute('ids')}"` : ''}>${esc(Book.tokLabel(node.getAttribute('t') || ''))}</b-tok>`;
  if (tag === 'b-ref' || tag === 'b-fig' || tag === 'b-answers' || tag === 'b-toc' || tag === 'b-embed' || tag === 'b-matmul') return `<${tag}${attrs(node)}></${tag}>`;   // b-matmul: only its spec is source, the drawn step isn't (2026-10-29: stepping through one changed the file)
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
Book.docNodes = () => {   // the root's content in file order: panes are transparent, and the cover comes first
  const out = [];
  for (const n of Book.root.childNodes) { if (n.nodeType === 1 && n.classList.contains('dpane')) out.push(...n.childNodes); else out.push(n); }
  const c = out.findIndex(n => n.nodeType === 1 && n.localName === 'section' && n.classList.contains('cover'));
  if (c > 0 && Book.panes().length) out.unshift(...out.splice(c, 1));
  return out;
};
Book.serialize = () => [Book.metaSource(), ...Book.docNodes().map(n => block(n, 0)).filter(Boolean)].join('\n\n') + '\n';


// ---------------------------------------------------------------- runnable code (web edition only)
// Every <b-code lang="python"> gets Run / Edit / Reset in the web page. The first Run loads Pyodide (CPython in WebAssembly)
// from the CDN, then whatever packages the code imports; files="url url" are fetched and written next to the code, so
// pd.read_csv("nd_football.csv") just works. Output replaces the printed output (the <b-out> right after the block).
// The PDF and the editor never see any of this: the bar is web-only and only the published page and the viewer start it.
// Self-contained on purpose: Book.snapshot() copies this function's source into the published page.
// Matrices: <b-matmul spec='{"vars":{"X":[[1,2],…]},"steps":[{"op":"mul","a":"X","b":"w","out":"ŷ"}],"colors":{"X":"blue"}}'>
// walks through the matrix arithmetic behind an equation, one step at a time. Steps: T (transpose), mul, add, inv (2×2),
// calc ({"op":"calc","lines":[["h₁","σ(10·50 − …)","σ(−15)","0"], …]}: one worked line per row, the cells joined by =,
// HTML allowed, the first cell is the name) and table (shows the table right after the block, which carries class
// mm-final: on screen that table only appears as this last step, printed it stands in for the walk-through; Eric 2026-10-28)
// and fig ({"op":"fig","src":"fig/forward-step-1.svg","alt":"…"}: a picture as the step, e.g. one forward pass drawn on
// the network diagram; Eric 2026-10-29). Book.snapshot inlines the pictures into the spec so published pages carry them.
// Tapping (or hovering) a cell of a product lights the row and column it comes from and writes the sum out in full.
// In a Math | Code pair it becomes a third face, "Matrices" (see eaiDual). Not printed.
function eaiMatmul() {
  var HEX = { blue: '#002B5B', gold: '#B8920F', purple: '#674EA7', green: '#38761D', red: '#CC0000', navy: '#002B5B' };
  function fmt(v) { if (Math.abs(v - Math.round(v)) < 1e-9) v = Math.round(v); else v = +v.toFixed(3); return (v < 0 ? '−' : '') + Math.abs(v); }
  function paren(v) { return v < 0 ? '(' + fmt(v) + ')' : fmt(v); }
  function T(m) { return m[0].map(function (_, j) { return m.map(function (r) { return r[j]; }); }); }
  function mul(a, b) { return a.map(function (r) { return b[0].map(function (_, j) { return r.reduce(function (s, x, k) { return s + x * b[k][j]; }, 0); }); }); }
  function add(a, b) { return a.map(function (r, i) { return r.map(function (x, j) { return x + b[i][j]; }); }); }
  function figSrc(s) { s = String(s || ''); return /^(data:|https?:|\/)/.test(s) ? s : ((window.Book && window.Book.base) || '') + s; }
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
      // ◀ ▶ together on the left, the title after them, the step counter on the right (Eric, 2026-10-28)
      var st = steps[at], h = '<div class="mm-bar"><span class="mm-n">Step ' + (at + 1) + ' of ' + steps.length + '</span><span class="mm-t">' + (st.title || '') + '</span><button type="button" data-g="-1"' + (at ? '' : ' disabled') + '>◀</button><button type="button" data-g="1"' + (at < steps.length - 1 ? '' : ' disabled') + '>▶</button></div><div class="mm-row">';
      if (st.op === 'T') h += mat(st.a, 'a') + '<span class="mm-op">→</span>' + mat(st.out, 'c');
      else if (st.op === 'mul') h += mat(st.a, 'a') + '<span class="mm-op">·</span>' + mat(st.b, 'b') + '<span class="mm-op">=</span>' + mat(st.out, 'c');
      else if (st.op === 'add') h += mat(st.a, 'a') + '<span class="mm-op">+</span>' + mat(st.b, 'b') + '<span class="mm-op">=</span>' + mat(st.out, 'c');
      else if (st.op === 'inv') h += mat(st.a, 'a') + '<span class="mm-op">→</span>' + mat(st.out, 'c');
      else if (st.op === 'calc') h += '<div class="mm-calc">' + (st.lines || []).map(function (l) { return '<div class="mm-line"><span class="mm-out">' + l[0] + '</span> = ' + l.slice(1).join(' = ') + '</div>'; }).join('') + '</div>';
      else if (st.op === 'fig') h += '<div class="mm-fig"><img src="' + figSrc(st.src) + '" alt="' + String(st.alt || '').replace(/"/g, '&quot;') + '"></div>';
      else if (st.op === 'table') { var t = el.nextElementSibling; h += t && t.tagName === 'TABLE' ? '<div class="mm-tbl"></div>' : '<div class="mm-err">Matrices: a table step needs the table right after this block</div>'; }
      h += '</div><div class="mm-say"></div>' + (st.note ? '<div class="mm-note">' + st.note + '</div>' : '');
      el.innerHTML = h;
      var box = el.querySelector('.mm-tbl');
      if (box) { var c = el.nextElementSibling.cloneNode(true); c.removeAttribute('data-b'); c.classList.remove('mm-final'); box.appendChild(c); }
      pick(0, 0);
    }
    function pick(i, j) {
      if (steps[at].op === 'calc' || steps[at].op === 'table' || steps[at].op === 'fig') return;
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
    // the tallest it gets: every step, and in each step every cell of the result picked (the sum written out under the
    // matrices wraps to more lines for some cells than others)
    el._tallest = function () {
      var keep = at, h = 0; el.style.minHeight = ''; el.style.removeProperty('--mm-h');
      for (at = 0; at < steps.length; at++) {
        draw(); var C = V[steps[at].out] || [[0]];
        for (var i = 0; i < C.length; i++) for (var j = 0; j < C[0].length; j++) { pick(i, j); h = Math.max(h, el.offsetHeight); }
      }
      at = keep; draw(); return h;
    };
    // a block on its own keeps that height, so stepping through it (or hovering its cells) never moves the page under it
    // (Eric, 2026-10-28); inside a Math | Code pair eaiDual does the same for the whole pair. --mm-h is never saved.
    el._lockH = function (tries) {
      var p = el.parentElement; if (p && p.classList.contains('dual') && p.querySelector(':scope > b-eq')) return;   // a Math | Code pair: eaiDual locks it
      if (!el.offsetParent) { if ((tries || 0) < 20) setTimeout(function () { el._lockH((tries || 0) + 1); }, 500); return; }   // not laid out yet
      var h = el._tallest(); if (h) el.style.setProperty('--mm-h', h + 'px');
    };
    // pictures: lock the height again once they have all loaded (their size isn't known before)
    var figs = steps.filter(function (s) { return s.op === 'fig'; }), left = figs.length;
    figs.forEach(function (s) { var im = new Image(); im.onload = im.onerror = function () { if (--left === 0) el._lockH(); }; im.src = figSrc(s.src); });
    if (steps.length) { draw(); requestAnimationFrame(function () { el._lockH(); }); if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { el._lockH(); }); }
    else el.innerHTML = '<div class="mm-err">Matrices: no steps yet</div>';
  }
  window.eaiMatmulOne = one;
  var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { [].forEach.call(document.querySelectorAll('b-matmul'), function (el) { if (el._lockH) el._lockH(); }); }, 250); });
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
  var TORCH = window.EAI_TORCH_URL || 'https://ai.williamtheisen.com/static/py/torch-ai2ai-c0b2344.tar.gz';
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
  // Presenting (the Lecture opened with ?lecture=1, the editor home's Lecture button): outputs are hidden, their space
  // kept, until the code is run live or the output is clicked (click again to hide it), like the fill-in blanks.
  if (/[?&]lecture=1\b/.test(location.search) && !document.documentElement.classList.contains('present-out')) {
    document.documentElement.classList.add('present-out');
    document.addEventListener('click', function (e) {
      var o = e.target.closest && e.target.closest('b-out'); if (!o || e.target.closest('.run-bar, .run-editor')) return;
      var bk = o.closest('.book'); if (!bk || bk.getAttribute('data-view') !== 'slides') return;
      o.classList.toggle('shown');
    });
  }
  function source(block) { return [].map.call(block.querySelectorAll('.ln'), function (l) { return l.textContent.replace(/ /g, ' '); }).join('\n'); }
  // What runs before a block's own code: its hidden setup (setup="…", imports and data a slide leaves out), and, for a
  // block marked chain, the blocks it continues (the python blocks before it in this document, back to the first one
  // not marked chain, each with its own setup), so a function split across pages or a fit used on the next slide runs.
  function pyBlocks(bk) { return [].filter.call(bk.querySelectorAll('b-code[lang="python"]'), function (b) { var s = b.closest('section'); return !s || s.getClientRects().length > 0; }); }
  // A continuation (2026-11-11): a chained cell whose first line is indented is the rest of a class, function or
  // call shown on the slide before (Pyodide dedents code, so run alone it silently became something else: cnn's
  // ConvLayer lost its forward). It always runs with the cells it continues; the cell it continues says so on Run.
  function frag(b) { if (!b || !b.hasAttribute('chain')) return false; var l = source(b).split('\n').filter(function (x) { return x.trim(); })[0] || ''; return /^[ \t]/.test(l); }
  function continued(block) { var list = pyBlocks(block.closest('.book') || document), k = list.indexOf(block); return k >= 0 && frag(list[k + 1]); }
  function prelude(block) {
    var parts = [], b = block, list = null;
    for (;;) {
      if (b !== block) parts.unshift(source(b));
      if (b.getAttribute('setup')) parts.unshift(b.getAttribute('setup'));
      if (!b.hasAttribute('chain')) break;
      list = list || pyBlocks(block.closest('.book') || document);
      var k = list.indexOf(b); if (k < 1) break; b = list[k - 1];
    }
    return parts.join('\n');
  }
  // like a notebook: a last line that is an expression shows its value (not for plots: those come out as pictures)
  function shown(py, r) {
    if (r === undefined || r === null) return '';
    if (typeof r === 'string') return "'" + r.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    if (typeof r === 'boolean') return r ? 'True' : 'False';
    if (typeof r !== 'object') return String(r);
    try { var B = py.pyimport('builtins'), mod = String(B.getattr(B.type(r), '__module__', '')); if (/^matplotlib/.test(mod)) return ''; return B.repr(r); } catch (e) { return ''; } finally { if (r.destroy) r.destroy(); }
  }
  [].forEach.call(document.querySelectorAll('b-code[lang="python"]:not([norun])'), function (block) {
    // blanks: no Run in the Workbook; in the Lecture, Run once every blank is filled in (Book.fillBlank: the iPad app's
    // handwriting) or tapped open, and it runs the code as filled in, wrong answers too (Eric, 2026-11-13)
    var bk = block.closest('.book'), bv = bk && bk.getAttribute('data-view'); if (block.querySelector('u.fill') && bv && bv !== 'reading' && bv !== 'slides') return;
    if (block._run) return; block._run = true;
    var fills = bv === 'slides' ? [].slice.call(block.querySelectorAll('u.fill')) : [];
    var original = source(block), out = block.nextElementSibling && block.nextElementSibling.tagName === 'B-OUT' ? block.nextElementSibling : null;
    var printed = out ? out.querySelector('pre').textContent : '';
    // a plot saved with the Output (b-out figs=…, drawn by BOut.render, inlined in the published page) comes back on Reset
    var storedFigs = out && out.querySelector(':scope > .run-figs') ? out.querySelector(':scope > .run-figs').cloneNode(true) : null;
    // a block with no printed output gets a collapsed one (just the Run bar, over the code's bottom right corner), so
    // making code runnable never adds height to a page; it opens once the code has run
    if (!out) { out = document.createElement('b-out'); out.className = 'run-new'; out.innerHTML = '<div class="label">Output</div><pre></pre>'; block.after(out); }
    var label = out.querySelector('.label'), bar = document.createElement('span'); bar.className = 'run-bar web-only';
    bar.innerHTML = '<span class="run-status"></span><button type="button" data-a="reset" hidden>Reset</button><button type="button" data-a="edit">Edit</button><button type="button" data-a="prior" title="Start Python over, run every code cell above this one in order, then this one" hidden>\u25b6\u25b6 Run prior</button><button type="button" data-a="run">\u25b6 Run</button>';
    label.appendChild(bar);
    var status = bar.querySelector('.run-status'), editor = null;
    if (fills.length) {
      // Run waits for the blanks (filled in, or tapped open), or for Edit (which shows them as written so far: ___ for
      // one not filled in, never its answer; Eric, 2026-11-13: to add code a student asks about)
      var ready = function () { bar.classList.toggle('run-wait', !editor && !fills.every(function (u) { return u.classList.contains('shown') || u.classList.contains('filled'); })); };
      block.addEventListener('eai-fill', ready); ready();
      block.addEventListener('eai-fill', function () { tell({ src: editor ? editor.value : original, edit: true }); });
    }
    function show(text, err, figs) {
      out._ran = true;   // this run's output, not the stored one (Book.renderOuts leaves it alone)
      out.classList.toggle('run-new', !printed && !storedFigs && !text && !(figs && figs.length));
      var pre = out.querySelector('pre'); if (!err && typeof eaiOutHL === 'function') pre.innerHTML = eaiOutHL(text, window.EAI_CC || (window.Book && window.Book.meta && window.Book.meta.codeColors), out.getAttribute('hl'), typeof eaiOutTok === 'function' ? eaiOutTok(out) : null); else pre.textContent = text; pre.classList.toggle('run-err', !!err);
      var old = out.querySelector('.run-figs'); if (old) old.remove();
      if (figs && figs.length) { var d = document.createElement('div'); d.className = 'run-figs'; figs.forEach(function (b) { var im = document.createElement('img'); im.src = /^(data:|https?:|\/)/.test(b) ? b : 'data:image/png;base64,' + b; im.alt = 'Plot from the code above'; d.appendChild(im); }); out.appendChild(d); }
    }
    // matplotlib draws off screen (Agg); after a run every open figure is turned into a PNG and closed
    var FIGS = "import sys\n_figs = []\nif 'matplotlib.pyplot' in sys.modules:\n    import io, base64\n    import matplotlib.pyplot as _plt\n    for _n in _plt.get_fignums():\n        _b = io.BytesIO()\n        _plt.figure(_n).savefig(_b, format='png', dpi=120, bbox_inches='tight')\n        _figs.append(base64.b64encode(_b.getvalue()).decode())\n    _plt.close('all')\n_figs";
    function figures(py) { try { var r = py.runPython(FIGS), a = r.toJs(); r.destroy(); return a; } catch (e) { return []; } }
    // what happens to a cell (a run, its result, an edit, a reset) is announced as an 'eai-run' event, so the
    // instructor's lecture notes (ink.js) can keep it and publish it with the ink (Eric, 2026-11-10)
    // what the cell's blanks hold ({index: [text, colour]}) and its editor's colours: kept in the lecture notes with it
    function filled() { var f = {}, any = false; fills.forEach(function (u, i) { if (u.classList.contains('filled')) { f[i] = [u.textContent, window.eaiCodeColors ? eaiCodeColors.blankColor(u) : null]; any = true; } }); return any ? f : null; }
    function tell(d) {
      if (block._eaiApplying) return;   // notes being put back, not something done in class
      if (fills.length && !editor && d.src === source(block)) d.src = original;   // filled blanks are kept as fills, not as code
      if (!d.reset) { var f = filled(), mk = editor && window.eaiCodeColors && eaiCodeColors.get(editor); if (f) d.fills = f; if (mk) d.marks = mk; }
      d.original = original; d.printed = printed; d.stored = !!storedFigs; block.dispatchEvent(new CustomEvent('eai-run', { bubbles: true, detail: d })); }
    function edit(quiet) {
      if (editor) return;
      editor = document.createElement('textarea'); editor.className = 'run-editor'; editor.spellcheck = false; editor.value = fills.length ? blanked() : source(block);
      // in the iPad app the Pencil writes code (its zoomed line), so the editor never brings up the on-screen keyboard
      var app = window.eaiNativeApp && window.eaiNativeApp.ink; if (app) editor.setAttribute('inputmode', 'none');
      editor.rows = editor.value.split('\n').length + 1; block.hidden = true; block.after(editor); bar.querySelector('[data-a="reset"]').hidden = false; if (!quiet && !app) editor.focus(); if (fills.length) ready();
      editor.addEventListener('eai-colors', function () { if (editor) tell({ src: editor.value, edit: true }); });
      var typed = null; editor.addEventListener('input', function () { clearTimeout(typed); typed = setTimeout(function () { if (editor) tell({ src: editor.value, edit: true }); }, 700); });
      editor.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); } });
    }
    // the cell's code with its blanks as they stand: what's written in them, ___ for one that isn't (or isn't shown)
    function blanked() {
      return [].map.call(block.querySelectorAll('.ln'), function (l) {
        var c = l.cloneNode(true); [].forEach.call(c.querySelectorAll('u.fill:not(.filled):not(.shown)'), function (u) { u.textContent = '___'; });
        return c.textContent.replace(/\u00a0/g, ' ');
      }).join('\n');
    }
    function reset(quiet) {
      if (editor) { editor.remove(); editor = null; } block.hidden = false; bar.querySelector('[data-a="reset"]').hidden = true; if (printed || out) show(printed);
      if (storedFigs) out.appendChild(storedFigs.cloneNode(true));
      out.classList.toggle('run-new', !printed && !storedFigs); out.classList.remove('shown'); status.textContent = ''; out._ran = false;
      if (fills.length) { var was = block._eaiApplying; block._eaiApplying = true; fills.forEach(function (u) { Book.fillBlank(u, null); }); block._eaiApplying = was; ready(); }
      if (!quiet) tell({ reset: true });
    }
    // lecture notes put back what was run in class: d = {src?, out?, err?, figs?, fills?, marks?} or null for the stored cell
    block._eaiLive = function (d) {
      block._eaiApplying = true;
      try {
        if (!d) { if (block._eaiShowing) { block._eaiShowing = false; reset(true); } return; }
        block._eaiShowing = true;
        if (d.src != null && d.src !== original) { edit(true); if (editor.value !== d.src) { editor.value = d.src; editor.rows = d.src.split('\n').length + 1; } }
        else if (editor) { editor.remove(); editor = null; block.hidden = false; bar.querySelector('[data-a="reset"]').hidden = true; }
        if (editor && window.eaiCodeColors) eaiCodeColors.set(editor, d.marks || null);
        fills.forEach(function (u, i) { var f = d.fills && d.fills[i]; Book.fillBlank(u, f ? f[0] : null, f ? f[1] : null); });
        if (d.out != null || (d.figs && d.figs.length)) { show(d.out || '', !!d.err, d.figs || []); out.classList.add('shown'); }
        status.textContent = d.out != null || d.src != null ? 'As run in lecture' : 'As written in lecture';
      } finally { block._eaiApplying = false; }
    };
    // g: a globals dict shared with the cells run before this one (Run prior); then the cell runs alone, without the
    // blocks it chains to (they have just run in g). Resolves true when the cell ran without an error.
    function run(g) {
      // like one notebook: every cell in a document shares one Python namespace (bk._eaiG). A chained cell whose
      // earlier cells haven't run yet in this namespace runs them first (its prelude); once they have, it runs alone.
      if (!editor && continued(block)) {   // half of a class or call: the next cell runs it whole
        status.textContent = 'Continues on the next slide: run it there'; tell({ src: original, out: printed, skipped: true });
        return Promise.resolve(true);
      }
      var chainNeeded = block.hasAttribute('chain') && (frag(block) || (!g && !(block._eaiPrevRan && block._eaiPrevRan())));
      var own = editor ? editor.value : fills.length ? source(block) : original, pre = chainNeeded ? prelude(block) : (block.getAttribute('setup') || ''), code = pre ? pre + '\n' + own : own, off = pre ? pre.split('\n').length : 0, lines = [], ok = false;
      status.textContent = boot ? 'Running…' : 'Loading Python (the first run takes a little while)…';
      bar.classList.add('busy');
      return pyodide().then(function (py) {
        window._eaiPy = py;
        status.textContent = 'Loading packages…';
        var files = (block.getAttribute('files') || '').split(/\s+/).filter(Boolean);
        return Promise.all(files.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('could not fetch ' + u); return r.arrayBuffer(); }).then(function (b) { py.FS.writeFile(u.split('/').pop().split('?')[0], new Uint8Array(b)); }); }))
          .then(function () { return /^[ \t]*(import[ \t][^\n#]*\btorch(vision)?\b|from[ \t]+torch(vision)?\b)/m.test(code) ? torch(py) : null; })   // also `import re, torch`
          .then(function () { return py.loadPackagesFromImports(code); })
          .then(function () {
            status.textContent = 'Running…';
            py.setStdout({ batched: function (t) { lines.push(t); } }); py.setStderr({ batched: function (t) { lines.push(t); } });
            var home = bk || document; if (g) home._eaiG = g; else if (!home._eaiG) home._eaiG = py.globals.get('dict')();
            return py.runPythonAsync(code, { globals: home._eaiG });
          })
          .then(function (r) { ok = true; block._eaiRan = (bk || document)._eaiG; var v = shown(py, r), f = figures(py); if (v) lines.push(v); if (!lines.length && !f.length && !printed && !storedFigs) { show(''); tell({ src: own, out: '', figs: [] }); status.innerHTML = '<span class="run-ok" title="Ran in your browser (no output)" style="color:#38761D;font-weight:700;font-size:10pt;line-height:1">\u2713</span>'; return; }   // nothing printed: keep the output closed, a green tick by Run
          var txt = lines.join('\n') || (f.length ? '' : '(no output)'); show(txt, false, f); out.classList.add('shown'); status.textContent = 'Ran in your browser'; tell({ src: own, out: txt, figs: f }); },
                function (e) { var m = String(e && e.message || e).trim().replace(/(File "<exec>", line )(\d+)/g, function (x, a, n) { return +n > off ? a + (n - off) : a + n + ' (setup)'; }).split('\n'), k = -1; m.forEach(function (l, i) { if (l.indexOf('File "<exec>"') >= 0 && k < 0) k = i; }); m = k >= 0 ? ['Traceback (most recent call last):'].concat(m.slice(k)) : m.slice(-4); var etxt = (lines.length ? lines.join('\n') + '\n' : '') + m.join('\n'), ef = figures(window._eaiPy); show(etxt, true, ef); out.classList.add('shown'); status.textContent = 'Error'; tell({ src: own, out: etxt, err: true, figs: ef }); });
      }, function (e) { status.textContent = String(e.message || e); })
        .then(function () { bar.classList.remove('busy'); return ok; });
    }
    // Run prior: every runnable python cell above this one in this document, in order, in one program (shared
    // variables, like running a notebook from the top), then this one. Stops at the first error.
    function runPrior() {
      var list = pyBlocks(bk || document), k = list.indexOf(block), before = list.slice(0, k < 0 ? 0 : k).filter(function (b) { return b._eaiRun; });
      if (bar.classList.contains('busy')) return;
      bar.classList.add('busy'); status.textContent = boot ? 'Running the cells above…' : 'Loading Python (the first run takes a little while)…';
      pyodide().then(function (py) {
        var home = bk || document, g = py.globals.get('dict')(), i = 0;   // restart: a fresh namespace for the whole document
        if (home._eaiG) { try { home._eaiG.destroy(); } catch (e) {} } home._eaiG = g;
        function next() {
          if (i < before.length) {
            var b = before[i++]; status.textContent = 'Running cell ' + i + ' of ' + (before.length + 1) + '…';
            return b._eaiRun(g).then(function (fine) { if (fine) return next(); status.textContent = 'Stopped: the cell above (' + i + ' of ' + (before.length + 1) + ') has an error'; b.scrollIntoView({ block: 'center' }); return false; });
          }
          bar.classList.remove('busy'); return run(g);
        }
        return next();
      }, function (e) { status.textContent = String(e.message || e); })
        .then(function () { bar.classList.remove('busy'); });
    }
    // has the cell this one chains to run in the current namespace? (then a chained Run needn't repeat it)
    block._eaiPrevRan = function () { var list = pyBlocks(bk || document), k = list.indexOf(block); if (k < 1) return false; var p = list[k - 1], G = (bk || document)._eaiG; return !!G && p._eaiRan === G; };
    block._eaiRun = run; block._eaiBar = bar;
    bar.addEventListener('click', function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a === 'run') run(); else if (a === 'prior') runPrior(); else if (a === 'edit') edit(); else if (a === 'reset') reset(); });
  });
  // Run prior only where some runnable cell comes before this one in its document
  var books = document.querySelectorAll('.book'); [].forEach.call(books.length ? books : [document], function (bk) {
    var seen = false;
    pyBlocks(bk).forEach(function (b) { if (!b._eaiBar) return; var p = b._eaiBar.querySelector('[data-a="prior"]'); if (p) p.hidden = !seen; seen = true; });
  });
  document.dispatchEvent(new Event('eai-run-ready'));   // lecture notes (ink.js) can now put their runs back
}
Book.runCode = () => { if (Book.web && !Book.exporting) eaiRunCode(); };
// Colours on code written in a Lecture (the iPad app's handwriting, Eric 2026-11-13): a pen colours the letters ("t:red",
// bold, as b-code .cc), the highlighter highlights ("h:gold", as marks). An opened editor is a plain textarea, which can't
// colour part of its text, so while it has colours its text is transparent and a box laid exactly over it draws the text
// (.eai-cc). Colours are character ranges of the editor's text that follow its edits; a filled code blank takes its
// colour as a class (pen-red, hl-gold). They go into the lecture notes with the cell (eaiRunCode's tell) and come back
// with them (_eaiLive), so the notes picker shows and hides them with the ink.
window.eaiCodeColors || (function () {
  var T = { blue: '#1155CC', red: '#CC0000', green: '#38761D', purple: '#674EA7', gold: '#DCB439' };   // the pens, as b-code .cc
  var H = { gold: ['#fff2cc', '#ffd966'] };                                                               // the highlighter, as marks
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function ok(kind) { var p = kind.split(':'); return p[0] === 't' ? !!T[p[1]] : p[0] === 'h' ? !!H[p[1]] : false; }

  // the editor's text changed: ranges before it stay, ranges after it move, a range it falls inside takes the new text
  function adjust(ed) {
    var o = ed._eaiPrev, n = ed.value; ed._eaiPrev = n;
    if (o == null || o === n || !ed._eaiMarks) return;
    var p = 0, L = Math.min(o.length, n.length); while (p < L && o[p] === n[p]) p++;
    var s = 0; while (s < L - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++;
    var oe = o.length - s, ne = n.length - s, d = n.length - o.length;
    ed._eaiMarks = ed._eaiMarks.map(function (m) {
      return [m[0] < p ? m[0] : m[0] >= oe ? m[0] + d : p, m[1] <= p ? m[1] : m[1] >= oe ? m[1] + d : ne, m[2]];
    }).filter(function (m) { return m[1] > m[0]; });
  }
  // a..b in kind ("t:red", "h:gold"; "t:" or "h:" alone takes that sort off): replaces ranges of the same sort only
  function paint(ed, a, b, kind) {
    var sort = kind.split(':')[0] + ':', out = [];
    (ed._eaiMarks || []).forEach(function (m) {
      if (m[2].indexOf(sort) !== 0 || m[1] <= a || m[0] >= b) out.push(m);
      else { if (m[0] < a) out.push([m[0], a, m[2]]); if (m[1] > b) out.push([b, m[1], m[2]]); }
    });
    if (ok(kind) && b > a) out.push([a, b, kind]);
    ed._eaiMarks = out.sort(function (x, y) { return x[0] - y[0]; });
  }
  function render(ed) {
    var o = ed._eaiCC;
    if (!ed.isConnected || !ed._eaiMarks || !ed._eaiMarks.length || !ed.offsetParent) {
      if (o) { o.remove(); ed._eaiCC = null; }
      if (ed._eaiInk != null) { ed.style.color = ed._eaiInk; ed.style.caretColor = ''; ed._eaiInk = null; }
      return;
    }
    if (ed._eaiInk == null) { ed._eaiInk = ed.style.color || ''; ed._eaiColor = getComputedStyle(ed).color; ed.style.caretColor = ed._eaiColor; ed.style.color = 'transparent'; }
    var host = ed.offsetParent;
    if (!o || o.parentNode !== host) { if (o) o.remove(); o = ed._eaiCC = document.createElement('div'); o.className = 'eai-cc'; host.appendChild(o); }
    var cs = getComputedStyle(ed);
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent',
     'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
      .forEach(function (k) { o.style[k] = cs[k]; });
    o.style.color = ed._eaiColor;
    o.style.width = ed.offsetWidth + 'px'; o.style.height = ed.offsetHeight + 'px';
    // exactly over the editor: placed, measured, moved by the difference (in the page's px, however it's scaled)
    o.style.left = ed.offsetLeft + 'px'; o.style.top = ed.offsetTop + 'px';
    var er = ed.getBoundingClientRect(), or = o.getBoundingClientRect(), k = or.width / (o.offsetWidth || 1) || 1;
    o.style.left = (ed.offsetLeft + (er.left - or.left) / k) + 'px'; o.style.top = (ed.offsetTop + (er.top - or.top) / k) + 'px';
    // each character's letter colour and highlight, then runs of the same
    var v = ed.value, tc = new Array(v.length), hc = new Array(v.length);
    ed._eaiMarks.forEach(function (m) { var p = m[2].split(':'), arr = p[0] === 't' ? tc : hc; for (var i = m[0]; i < m[1] && i < v.length; i++) arr[i] = p[1]; });
    var h = '', i = 0;
    while (i < v.length) {
      var j = i; while (j < v.length && tc[j] === tc[i] && hc[j] === hc[i]) j++;
      var cls = (tc[i] ? 't-' + tc[i] : '') + (hc[i] ? (tc[i] ? ' ' : '') + 'h-' + hc[i] : '');
      h += cls ? '<span class="' + cls + '">' + esc(v.slice(i, j)) + '</span>' : esc(v.slice(i, j));
      i = j;
    }
    o.innerHTML = h + '\n';
    o.scrollTop = ed.scrollTop; o.scrollLeft = ed.scrollLeft;
  }
  var eds = new Set();
  function all() { eds.forEach(function (ed) { if (!ed.isConnected) { if (ed._eaiCC) ed._eaiCC.remove(); eds.delete(ed); } else render(ed); }); }
  document.addEventListener('input', function (e) { var ed = e.target; if (ed && ed._eaiMarks) { adjust(ed); render(ed); } }, true);
  document.addEventListener('scroll', function (e) { var ed = e.target; if (ed && ed._eaiCC) render(ed); }, true);
  document.addEventListener('eai-run', function () { setTimeout(all, 0); });
  addEventListener('resize', all);
  new ResizeObserver(function () { all(); }).observe(document.documentElement);
  new MutationObserver(function (ms) {
    if (ms.some(function (m) { return [].some.call(m.removedNodes, function (n) { return n.nodeType === 1 && (n.tagName === 'TEXTAREA' || n.querySelector('textarea')); }); })) all();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.eaiCodeColors = {
    // characters a..b of an editor's text: kind "t:red" (letters), "h:gold" (highlight), "t:" / "h:" (that sort off)
    paint: function (ed, a, b, kind) { eds.add(ed); if (ed._eaiPrev == null) ed._eaiPrev = ed.value; adjust(ed); paint(ed, a, b, kind); render(ed); ed.dispatchEvent(new CustomEvent('eai-colors')); },
    get: function (ed) { return ed._eaiMarks && ed._eaiMarks.length ? ed._eaiMarks : null; },
    set: function (ed, m) { eds.add(ed); ed._eaiMarks = m ? m.map(function (x) { return x.slice(); }) : null; ed._eaiPrev = ed.value; render(ed); },
    // a filled code blank: kind as above (null: plain, no highlight)
    blank: function (u, kind) {
      var p = (kind || '').split(':');
      Object.keys(T).forEach(function (k) { u.classList.toggle('pen-' + k, p[0] === 't' && p[1] === k); });
      Object.keys(H).forEach(function (k) { u.classList.toggle('hl-' + k, p[0] === 'h' && p[1] === k); });
    },
    blankColor: function (u) {
      var t = Object.keys(T).filter(function (k) { return u.classList.contains('pen-' + k); })[0];
      var h = Object.keys(H).filter(function (k) { return u.classList.contains('hl-' + k); })[0];
      return t ? 't:' + t : h ? 'h:' + h : null;
    },
    render: all
  };
})();
// A blank filled in with what was written (the iPad app reads handwriting) in colour kind (above; null: plain), or v =
// null for the blank as it was. A filled blank shows its text (marked .wrong when it isn't the answer); a code cell's
// Run runs what its blanks say.
Book.fillBlank = (u, v, kind) => {
  if (u._ansHTML == null) { u._ansHTML = u.innerHTML; u._ans = u.textContent; }
  const cc = window.eaiCodeColors, was = cc ? cc.blankColor(u) : null;
  if (v == null) { if (!u.classList.contains('filled')) return; u.innerHTML = u._ansHTML; u.classList.remove('filled', 'wrong', 'shown'); if (cc) cc.blank(u, null); }
  else {
    if (u.classList.contains('filled') && u.textContent === v && was === (kind || null)) return;
    // in code, written text gets the code's own colours (syntax, the chapter's codeColors) unless a pen colour was
    // picked (Eric, 2026-11-13: "infer them if I don't do them myself")
    if (u.closest('b-code')) u.innerHTML = highlight(v); else u.textContent = v;
    u.classList.add('filled', 'shown'); u.classList.toggle('wrong', v.trim() !== u._ans.trim()); if (cc) cc.blank(u, kind || null);
  }
  u.dispatchEvent(new CustomEvent('eai-fill', { bubbles: true }));
};

// ---------------------------------------------------------------- web extras (after spacing is settled) and the static snapshot
Book.webExtras = () => {
  Book.freezeGaps = true; Book.liveOn = true;
  Book.root.querySelectorAll('b-fig[live]').forEach(Book.initLive);
  Book.runCode();
  if (Book.view === 'slides' || Book.view === 'workbook') Book.root.addEventListener('click', e => { const f = e.target.closest && e.target.closest('u.fill, [data-fill]'); if (f) { Book.reveal(f); f.dispatchEvent(new CustomEvent('eai-fill', { bubbles: true })); } });
  Book.root.querySelectorAll('.qc > .ans').forEach(a => {
    if (a.nextElementSibling && a.nextElementSibling.tagName === 'DETAILS') return;
    const d = document.createElement('details'); d.className = 'web-only'; d.setAttribute('data-rt', '');
    d.innerHTML = '<summary>Show answer</summary><p>' + a.innerHTML + '</p>'; a.after(d);
  });
};
const b64 = async url => { const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
// the token tables a published page needs for live runs (only the vocabularies its Outputs use)
function outTables(clone, m) {
  const names = new Set([m.outTok, ...[...clone.querySelectorAll('b-out[tok]')].map(o => o.getAttribute('tok'))].filter(v => v && v !== 'off'));
  const out = {}; for (const v of names) { const T = Book.tokTable(v); if (T) out[v] = T; }
  return out;
}
Book.snapshot = async () => {
  const view = Book.view, live = [...Book.root.querySelectorAll('u.fill, [data-fill]')];
  if (view === 'workbook') live.forEach(el => { const pg = el.closest('.page'), k = pg ? pg.getBoundingClientRect().width / Book.pageW(pg) : 1, r = el.getBoundingClientRect(); el.setAttribute('data-box', (r.width / k).toFixed(1) + ' ' + (r.height / k).toFixed(1)); });
  const clone = Book.root.cloneNode(true);
  live.forEach(el => el.removeAttribute('data-box'));
  if (view !== 'reading') {   // content that is not in this edition is left out of the file, not just hidden
    clone.querySelectorAll('[data-view]').forEach(n => { if (!Book.inView(n, view)) n.remove(); });
    if (view === 'slides') clone.querySelectorAll('.qc .ans').forEach(n => n.classList.add('ghost-only'));
    clone.querySelectorAll('b-code').forEach(c => { if (c.querySelector('u.fill')) c.setAttribute('norun', ''); });   // code with blanks: no Run (its output would give the answers away)   // kept for the instructor's faint crib (ink.js)
    clone.querySelectorAll(view === 'slides' ? '.aside:not([data-view]), .qc details, b-answers:not([data-view])' : '.aside:not([data-view]), .qc .ans, .qc details, b-answers:not([data-view])').forEach(n => n.remove());
    if (Book.hasKeys) clone.querySelectorAll('.page > p:not([data-view])').forEach(pp => {   // a paragraph becomes its key sentences
      const keys = [...pp.querySelectorAll('.key')]; if (!keys.length) return pp.remove();
      pp.replaceChildren(...keys.flatMap((k, i) => i ? [document.createTextNode(' '), k] : [k]));
    });
  } else clone.querySelectorAll('[data-view], aside.qc, div.wbox').forEach(n => { if (!Book.inView(n, view)) n.remove(); });   // (quick checks: not in Reading unless tagged)
  if (view === 'workbook') clone.querySelectorAll('[data-box]').forEach(el => {   // the workbook carries blanks, not hidden answers
    const [w, h] = el.getAttribute('data-box').split(' ').map(Number);
    if (el.matches('u.fill')) { const u = document.createElement('u'); u.className = 'fill blank'; u.style.width = w + 'pt'; u.innerHTML = '&nbsp;'; el.replaceWith(u); }
    else if (el instanceof SVGElement) {   // a drawing's answer part: as the Lecture shows it, with the answer left out of the file
      const k = el.getAttribute('data-fill'), ph = el.nextElementSibling;
      if (ph && ph.classList.contains('fill-ph')) ph.classList.add('on');   // its dashed outline stays, shown without the part
      if (k === 'label') el.querySelectorAll(':scope > text').forEach(t => t.remove());
      else if (k === 'all') {
        const svg = el.closest('svg'); if (svg && el.id) svg.querySelectorAll('[data-rt-fill]').forEach(a => { if (a.getAttribute('data-rt-fill') === el.id) a.remove(); });
        el.remove();
      } else el.remove();   // its place stays empty, in its outline
      el.removeAttribute('data-fill'); el.removeAttribute('data-box');
    }
    else { const d = document.createElement('div'); d.className = 'fillbox'; d.style.height = h + 'pt'; if (el.getAttribute('style') && Book.isPinned(el)) d.setAttribute('style', el.getAttribute('style') + ';height:' + h + 'pt'); el.replaceWith(d); }
  });
  clone.querySelectorAll('[data-ed], .cmt, .ed-guide').forEach(n => n.remove());
  clone.querySelectorAll('[data-ed-stale]').forEach(n => n.removeAttribute('data-ed-stale'));   // editor furniture and review comments stay out of the published page
  clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('[data-src]').forEach(n => n.removeAttribute('data-src'));
  for (const mm of clone.querySelectorAll('b-matmul[spec*="fig"]')) {   // a walk-through's pictures go into its spec (see eaiMatmul)
    let spec; try { spec = JSON.parse(mm.getAttribute('spec')); } catch (e) { continue; }
    for (const st of spec.steps || []) if (st.op === 'fig' && st.src && !st.src.startsWith('data:')) st.src = 'data:image/' + (/\.svg$/.test(st.src) ? 'svg+xml' : 'png') + ';base64,' + await b64(Book.base + st.src);
    mm.setAttribute('spec', JSON.stringify(spec));
  }
  for (const img of clone.querySelectorAll('img')) {
    const src = img.getAttribute('src'); if (!src || src.startsWith('data:')) continue;
    const type = /\.svg(\?|$)/.test(src) ? 'image/svg+xml' : /\.png(\?|$)/.test(src) ? 'image/png' : /\.jpe?g(\?|$)/.test(src) ? 'image/jpeg' : 'application/octet-stream';
    img.setAttribute('src', `data:${type};base64,${await b64(src)}`);
  }
  const m = Book.meta, css = await (await fetch('../app/book.css')).text(), liveJs = await (await fetch('../app/live.js')).text(), inkJs = await (await fetch('../app/ink.js')).text();
  const frames = FIT + "(function(){var fs=[].slice.call(document.querySelectorAll('iframe[data-frame]'));if(!fs.length)return;var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.src=e.target.getAttribute('data-frame');io.unobserve(e.target)}})},{rootMargin:'600px'});fs.forEach(function(f){io.observe(f)})})();" + LIVEFIG + ";[].forEach.call(document.querySelectorAll('b-fig[viz]'),eaiLiveFig);";
  // tap a blank to see its answer: in the Lecture while presenting, and in the Workbook to practise (Eric, 2026-11-03)
  const reveal = view === 'slides' || view === 'workbook' ? "document.addEventListener('click',function(e){var f=e.target.closest&&e.target.closest('u.fill,[data-fill]');if(!f)return;var on=f.classList.toggle('shown'),d=f.id&&f.closest('svg');if(d)[].forEach.call(d.querySelectorAll('[data-rt-fill]'),function(a){if(a.getAttribute('data-rt-fill')===f.id)a.classList.toggle('shown',on)})});" : '';
  const faces = (await Promise.all([['Inconsolata-LGC.ttf', 400], ['Inconsolata-LGC-Bold.ttf', 700]].map(async ([f, w]) =>
    `@font-face{font-family:'Inconsolata LGC';src:url(data:font/ttf;base64,${await b64('../kit/fonts/' + f)}) format('truetype');font-weight:${w}}`))).join('') + `@font-face{font-family:'AI2AI Omega';src:url(data:font/ttf;base64,${await b64('../kit/fonts/AI2AI-Omega.ttf')}) format('truetype');unicode-range:U+03A9}@font-face{font-family:'AI2AI Omega';src:url(data:font/ttf;base64,${await b64('../kit/fonts/AI2AI-Loss.ttf')}) format('truetype');unicode-range:U+2112}`;
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
  const pdfmenu = `<details class="navmenu pdfmenu"><summary class="nb" title="Export PDF">${ICON.pdf}<span>PDF</span></summary><div class="menu"><span class="hd">Download PDF</span>${VIEWS.map(([, label, sfx]) => `<a href="${escAttr(pdfName(sfx))}" download>${label}</a>`).join('')}<button type="button" onclick="this.closest('details').open=false;window.eaiNotesPDF?eaiNotesPDF():window.print()">This page as shown, with notes</button></div></details>`;
  // close any open navbar menu on an outside tap or Escape
  const navjs = "document.addEventListener('click',function(e){[].forEach.call(document.querySelectorAll('.navbar details[open]'),function(d){if(!d.contains(e.target))d.open=false})});document.addEventListener('keydown',function(e){if(e.key==='Escape')[].forEach.call(document.querySelectorAll('.navbar details[open]'),function(d){d.open=false})});[].forEach.call(document.querySelectorAll('.navbar .toc a'),function(a){a.addEventListener('click',function(){a.closest('details').open=false})});";
  const zoom = "(function(){function z(){var W=Math.min(window.innerWidth,document.documentElement.clientWidth||1e9,screen.width||1e9);var w=Math.min(1,(W-32)/" + (Book.SIZES[view] || Book.SIZES.reading).w * 4 / 3 + ");document.documentElement.style.setProperty('--zoom',w)}z();window.addEventListener('resize',z)})();";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title || '')}</title>
<style>${faces}
${css}${view === 'slides' ? '\n@page { size: 10in 7.5in; margin: 0; }' : ''}</style>
</head>
<body>
<nav class="navbar chap web-only" aria-label="Chapter"><a class="brand" href="${escAttr(m.toc || '/ai2ai/')}" title="All chapters">${esc(m.book || '')}</a><span class="crumb">${esc(m.title || '')}</span>${toc}<span class="spacer"></span>${viewbar}<span class="tools">${pdfmenu}</span></nav>
<main class="book view${m.tokIds ? ' tokids' : ''}" data-view="${view}">
${clone.innerHTML}
</main>
<script>${zoom}${navjs}${reveal}${frames}
${liveJs}
var EAI_CC = ${JSON.stringify(m.codeColors || null).replace(/</g, '\\u003c')};
var EAI_TOKDEF = ${JSON.stringify(m.outTok || null)};
var EAI_TOK = ${JSON.stringify(outTables(clone, m)).replace(/</g, '\\u003c')};
${eaiOutHL.toString()}
${eaiOutTok.toString()}
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

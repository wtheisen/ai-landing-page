// Equations drawn in the browser: Temml turns each row's TeX into MathML, set in the AI2AI Math font, so a device
// with no TeX (the hosted editor on iPad, phone or any computer) can draw new and changed equations itself.
// The layout follows kit/preamble_mathfont.tex + kit/render.py: [number] in grey at the left, an optional note above
// the equation (small grey Arial), step rows as a grey ↓ and the operation at 3/4 size. Symbols named in the chapter's
// colours are drawn bold in their family colour (render.py colorize), \lk{name}{…} pieces get class lk-<name>.
(function (G) {
'use strict';
const FAM = { blue: '#1155CC', wblue: '#1155CC', gold: '#DCB439', purple: '#674EA7', green: '#38761D', red: '#CC0000', gray: '#666666', navy: '#002B5B', muted: '#666666', ink: '#000000' };
// the TeX each Unicode symbol in a chapter's colour map stands for (server.py TEX)
const TEX = { 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
  'σ': '\\sigma', 'φ': '\\varphi', 'η': '\\eta', 'ρ': '\\rho', 'τ': '\\tau', 'ω': '\\omega', 'Ω': '\\Omega', 'ξ': '\\xi', 'ŷ': '\\yhat' };
const fam = f => '\\eqfam{##' + FAM[f].slice(1) + '}{#1}';   // ## is a literal # inside a macro
const VERBATIM = new Set(['text', 'mathrm', 'operatorname', 'textbf', 'begin', 'end']);
const MACROS = {
  '\\eqfam': '{\\color{#1}\\mathbf{#2}}',
  '\\wnum': fam('blue'), '\\bnum': fam('gray'), '\\blue': fam('blue'), '\\gold': fam('gold'), '\\purple': fam('purple'), '\\green': fam('green'), '\\red': fam('red'),
  '\\symbf': '\\mathbf{#1}',
  '\\T': '^{\\mathrm{T}}', '\\yhat': '\\text{ŷ}', '\\cd': '\\mathbin{\\text{·}}', '\\norm': '\\lVert #1\\rVert',
  '\\bp': '\\left(#1\\right)', '\\bb': '\\left[#1\\right]', '\\bn': '\\mathopen{\\bigl\\Vert}#1\\mathclose{\\bigr\\Vert}',
  '\\Bp': '\\left(\\,#1\\,\\right)', '\\Bb': '\\left[\\,#1\\,\\right]', '\\Bn': '\\mathopen{\\Bigl\\Vert}\\,#1\\,\\mathclose{\\Bigr\\Vert}',
  '\\Hp': '\\left(\\,#1\\,\\right)', '\\Hb': '\\left[\\,#1\\,\\right]',
  '\\p': '{\\prime}', '\\lk': '\\class{lk-#1}{#2}', '\\mleft': '\\left', '\\mright': '\\right',
};
function group(s, i) {   // the balanced {...} group starting at s[i], or the single character there (render.py group)
  if (s[i] !== '{') return s.slice(i, i + 1);
  let d = 0; for (let j = i; j < s.length; j++) { d += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0; if (!d) return s.slice(i, j + 1); }
  throw new Error('unbalanced braces');
}
function colorize(tex, colors) {   // render.py colorize: wrap each coloured symbol (and its subscript) in \eqfam
  const out = []; let i = 0;
  while (i < tex.length) {
    const c = tex[i]; let tok, key;
    if (c === '\\') {
      tok = /^\\([A-Za-z]+|.)/.exec(tex.slice(i))[0]; i += tok.length;
      if (VERBATIM.has(tok.slice(1)) || tok === '\\lk') { const a = group(tex, i); out.push(tok + a); i += a.length; continue; }
      key = tok;
    } else if (/\p{L}/u.test(c)) { tok = key = c; i++; }
    else { out.push(c); i++; continue; }
    if (!(key in colors)) { out.push(tok); continue; }
    if (tex[i] === '_') { const sub = group(tex, i + 1); tok += '_' + sub; i += 1 + sub.length; }
    out.push('{\\eqfam{' + colors[key] + '}{' + tok + '}}');   // braced, so \\hat\\omega still takes the whole symbol
  }
  return out.join('');
}
function texColors(colors) {   // chapter colour map {symbol: family} -> {TeX token: hex}
  const m = {}; for (const k in colors || {}) { const hex = FAM[colors[k]] || colors[k]; m[TEX[k] || k] = hex; if (TEX[k]) m[k] = hex; }
  return m;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function one(tex, colors, display) {
  return G.temml.renderToString(colorize(tex, colors), { displayMode: false, macros: Object.assign({}, MACROS), trust: true, throwOnError: true, annotate: false, xml: false, wrap: 'none' })
    .replace(/^<math/, display ? '<math display="block" displaystyle="true" style="display:inline-block"' : '<math')
    .replace(/<mi>/g, '<mi mathvariant="normal">');   // unicode-math math-style=upright: letters are upright, as in the TeX images
}
// rows as BEq.rows() gives them: ['eq', number, note, tex] or ['step', tex]. Returns HTML or throws with TeX's message.
function render(rows, colors) {
  const cm = texColors(colors);
  return '<div class="eqml" role="math">' + rows.map(r => r[0] === 'eq'
    ? `<div class="eqml-n">${r[1] ? '[' + esc(r[1]) + ']' : ''}</div><div class="eqml-e">${r[2] ? `<div class="eqml-note">${esc(r[2])}</div>` : ''}${one(r[3], cm, true)}</div>`
    : `<div class="eqml-n"></div><div class="eqml-s"><span class="eqml-arrow">↓</span>${one(r[1], cm, false)}</div>`).join('') + '</div>';
}
let fonts = false;
function addFonts() {   // the math font only loads where an equation is drawn this way
  if (fonts) return; fonts = true;
  const s = document.createElement('style');
  s.textContent = "@font-face{font-family:'AI2AI Math';src:url(../kit/fonts/AI2AI-Math.ttf) format('truetype')}@font-face{font-family:'Inconsolata LGC';src:url(../kit/fonts/Inconsolata-LGC-Bold.ttf) format('truetype');font-weight:700}";
  document.head.appendChild(s);
}
G.EqML = { render, colorize, texColors, MACROS, addFonts };
})(typeof globalThis !== 'undefined' ? globalThis : window);

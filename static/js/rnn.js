/**
 * RNN Architecture Diagram Visualizer
 *
 * DOM-based interactive block diagram with subword tokenization.
 * Shows full sequence tokenization + embedding table, then
 * per-timestep RNN cell / output / prediction pipeline.
 *
 * RESPONSIVE: No hardcoded px in inline styles. All sizing via CSS custom
 * properties or relative units (em, %). CSS handles responsive scaling.
 */
(function () {
    'use strict';

    var CU, DU;
    function resolveLibs() {
        CU = window.VizLib.CanvasUtils;
        DU = window.VizLib.DomUtils;
    }

    // ─── Seeded PRNG (mulberry32) ──────────────────────────────────────
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // ─── Constants ─────────────────────────────────────────────────────
    var VOCAB_SIZE_DISPLAY = 50257; // Display label (GPT-2 style)

    var EXAMPLES = [
        {
            label: 'I like cute kitties and',
            tokens: [
                { word: 'I', id: 40 },
                { word: ' like', id: 1299 },
                { word: ' cute', id: 23172 },
                { word: ' k', id: 372 },
                { word: 'itt', id: 1387 },
                { word: 'ies', id: 566 },
                { word: ' and', id: 326 }
            ]
        },
        {
            label: 'the cat sat on',
            tokens: [
                { word: 'the', id: 1169 },
                { word: ' cat', id: 3797 },
                { word: ' sat', id: 3290 },
                { word: ' on', id: 319 }
            ]
        },
        {
            label: 'hello world !',
            tokens: [
                { word: 'hello', id: 31373 },
                { word: ' world', id: 995 },
                { word: ' !', id: 256 }
            ]
        }
    ];

    // Collect all unique token IDs for the output prediction layer
    var ALL_TOKEN_IDS = [];
    var ALL_TOKEN_MAP = {}; // id -> word
    (function collectVocab() {
        var seen = {};
        for (var i = 0; i < EXAMPLES.length; i++) {
            for (var j = 0; j < EXAMPLES[i].tokens.length; j++) {
                var t = EXAMPLES[i].tokens[j];
                if (!seen[t.id]) {
                    seen[t.id] = true;
                    ALL_TOKEN_IDS.push(t.id);
                    ALL_TOKEN_MAP[t.id] = t.word;
                }
            }
        }
    })();
    var OUTPUT_VOCAB_SIZE = ALL_TOKEN_IDS.length;

    // ─── Weight generation ─────────────────────────────────────────────
    function makeWeights(rows, cols, rng, scale) {
        scale = scale || 1;
        var m = [];
        for (var i = 0; i < rows; i++) {
            var row = [];
            for (var j = 0; j < cols; j++) {
                row.push((rng() * 2 - 1) * scale);
            }
            m.push(row);
        }
        return m;
    }

    function makeVec(n, rng, scale) {
        scale = scale || 0.1;
        var v = [];
        for (var i = 0; i < n; i++) v.push((rng() * 2 - 1) * scale);
        return v;
    }

    function matVecMul(M, v) {
        var out = [];
        for (var i = 0; i < M.length; i++) {
            var sum = 0;
            for (var j = 0; j < v.length; j++) sum += M[i][j] * v[j];
            out.push(sum);
        }
        return out;
    }

    function vecAdd(a, b) {
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(a[i] + b[i]);
        return out;
    }

    function tanh(v) {
        return v.map(function (x) { return Math.tanh(x); });
    }

    function softmax(v) {
        var maxV = Math.max.apply(null, v);
        var exps = v.map(function (x) { return Math.exp(x - maxV); });
        var sum = exps.reduce(function (a, b) { return a + b; }, 0);
        return exps.map(function (e) { return e / sum; });
    }

    function topK(probs, k) {
        var indexed = probs.map(function (p, i) {
            return { prob: p, idx: ALL_TOKEN_IDS[i], word: ALL_TOKEN_MAP[ALL_TOKEN_IDS[i]] };
        });
        indexed.sort(function (a, b) { return b.prob - a.prob; });
        return indexed.slice(0, k);
    }

    // ─── Embedding lookup (hash-based, deterministic per token ID) ────
    function getEmbedding(tokenId, embedDim, baseSeed) {
        var rng = mulberry32(baseSeed + tokenId * 7919);
        var emb = [];
        for (var i = 0; i < embedDim; i++) {
            emb.push((rng() * 2 - 1) * 0.5);
        }
        return emb;
    }

    // ─── Model ─────────────────────────────────────────────────────────
    function buildModel(embedDim, hiddenDim) {
        var rng = mulberry32(42);
        var embSeed = 12345;
        var W_xh = makeWeights(hiddenDim, embedDim, rng, Math.sqrt(2.0 / (embedDim + hiddenDim)));
        var W_hh = makeWeights(hiddenDim, hiddenDim, rng, Math.sqrt(2.0 / (hiddenDim * 2)));
        var b_h = makeVec(hiddenDim, rng, 0.01);
        var W_hy = makeWeights(OUTPUT_VOCAB_SIZE, hiddenDim, rng, Math.sqrt(2.0 / (hiddenDim + OUTPUT_VOCAB_SIZE)));
        var b_y = makeVec(OUTPUT_VOCAB_SIZE, rng, 0.01);
        return {
            embSeed: embSeed, W_xh: W_xh, W_hh: W_hh, b_h: b_h,
            W_hy: W_hy, b_y: b_y, embedDim: embedDim, hiddenDim: hiddenDim
        };
    }

    function runForward(model, tokens) {
        var steps = [];
        var h = makeVec(model.hiddenDim, function () { return 0; }, 0);
        for (var t = 0; t < tokens.length; t++) {
            var tok = tokens[t];
            var emb = getEmbedding(tok.id, model.embedDim, model.embSeed);
            var h_prev = h.slice();
            var Wx_x = matVecMul(model.W_xh, emb);
            var Wh_h = matVecMul(model.W_hh, h_prev);
            var pre_tanh = vecAdd(vecAdd(Wx_x, Wh_h), model.b_h);
            var h_t = tanh(pre_tanh);
            var logits = vecAdd(matVecMul(model.W_hy, h_t), model.b_y);
            var probs = softmax(logits);
            var top5 = topK(probs, 5);
            steps.push({
                word: tok.word,
                id: tok.id,
                emb: emb,
                h_prev: h_prev,
                Wx_x: Wx_x,
                Wh_h: Wh_h,
                pre_tanh: pre_tanh,
                h_t: h_t,
                logits: logits,
                probs: probs,
                top5: top5,
                predicted: top5[0].word
            });
            h = h_t;
        }
        return steps;
    }

    // ─── Color helpers ─────────────────────────────────────────────────
    function getCSS(prop) {
        return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    }

    function heatmapColor(value, absMax) {
        var lo = CU.hexToRgb(getCSS('--rnn-heatmap-low') || '#e3f2fd');
        var hi = CU.hexToRgb(getCSS('--rnn-heatmap-high') || '#1565c0');
        var t = (value + absMax) / (2 * absMax);
        var rgb = CU.colorLerp(lo, hi, t);
        return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    }

    function absMaxOf(values) {
        var m = 0;
        for (var i = 0; i < values.length; i++) m = Math.max(m, Math.abs(values[i]));
        return m < 0.001 ? 1 : m;
    }

    function absMaxOfMatrix(matrix, rows, cols) {
        var m = 0;
        for (var r = 0; r < rows; r++)
            for (var c = 0; c < cols; c++)
                m = Math.max(m, Math.abs(matrix[r][c]));
        return m < 0.001 ? 1 : m;
    }

    function displayWord(w) {
        // Show leading spaces as visible markers
        return w.replace(/^ /, '\u00b7');
    }

    // ─── DOM element helper ────────────────────────────────────────────

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (k === 'className') node.className = attrs[k];
                else if (k === 'textContent') node.textContent = attrs[k];
                else if (k === 'innerHTML') node.innerHTML = attrs[k];
                else node.setAttribute(k, attrs[k]);
            }
        }
        if (children) {
            if (!Array.isArray(children)) children = [children];
            for (var i = 0; i < children.length; i++) {
                if (typeof children[i] === 'string') {
                    node.appendChild(document.createTextNode(children[i]));
                } else if (children[i]) {
                    node.appendChild(children[i]);
                }
            }
        }
        return node;
    }

    // ─── Heatmap row builder (collapsed view) ──────────────────────────

    function buildHeatmapRow(values, maxCells, ariaLabel) {
        var n = values.length;
        var show = Math.min(n, maxCells || 16);
        var am = absMaxOf(values);

        var wrap = el('div', {
            className: 'rnn-heatmap',
            'aria-label': ariaLabel || 'Heatmap'
        });
        wrap.style.gridTemplateColumns = 'repeat(' + show + ', var(--rnn-cell-size))';

        for (var i = 0; i < show; i++) {
            var cell = el('span', {
                className: 'rnn-heatmap-cell',
                'aria-label': 'Cell c' + i + ' = ' + values[i].toFixed(2),
                title: values[i].toFixed(4)
            });
            cell.style.backgroundColor = heatmapColor(values[i], am);
            wrap.appendChild(cell);
        }

        if (n > show) {
            var dots = el('span', { className: 'rnn-heatmap-ellipsis', textContent: '...' });
            var outer = el('div', {
                className: 'rnn-heatmap-wrap',
                'aria-label': ariaLabel || 'Heatmap'
            }, [wrap, dots]);
            return outer;
        }
        return wrap;
    }

    // ─── Small heatmap grid (expanded W_xh, W_hh, W_hy) ──────────────

    function buildSmallHeatmap(matrix, rows, cols, showRows, showCols, ariaLabel) {
        var am = absMaxOfMatrix(matrix, rows, cols);
        var sr = Math.min(showRows, rows);
        var sc = Math.min(showCols, cols);
        var wrap = el('div', {
            className: 'rnn-heatmap rnn-heatmap--small',
            'aria-label': ariaLabel
        });
        wrap.style.gridTemplateColumns = 'repeat(' + sc + ', var(--rnn-cell-size-sm))';

        for (var r = 0; r < sr; r++) {
            for (var c = 0; c < sc; c++) {
                var cell = el('span', {
                    className: 'rnn-heatmap-cell',
                    'aria-label': 'Cell r' + r + 'c' + c + ' = ' + matrix[r][c].toFixed(2),
                    title: matrix[r][c].toFixed(4)
                });
                cell.style.backgroundColor = heatmapColor(matrix[r][c], am);
                wrap.appendChild(cell);
            }
        }
        return wrap;
    }

    // ─── Bar chart builder ─────────────────────────────────────────────

    function buildBarChart(top5, maxProb, ariaLabel) {
        var chart = el('div', { className: 'rnn-bar-chart', 'aria-label': ariaLabel || 'Top-5 Predictions Bar Chart' });
        for (var i = 0; i < top5.length; i++) {
            var p = top5[i];
            var w = displayWord(p.word);
            var pct = (p.prob * 100).toFixed(1) + '%';
            var barHeight = Math.max(4, (p.prob / maxProb) * 100);

            var col = el('div', {
                className: 'rnn-bar-col',
                'aria-label': "Prediction: '" + w + "' " + pct
            });

            col.appendChild(el('span', { className: 'rnn-bar-pct', textContent: pct }));

            var track = el('span', { className: 'rnn-bar-track' });
            var fill = el('span', {
                className: 'rnn-bar-fill ' + (i === 0 ? 'primary' : 'secondary'),
                'aria-label': 'Bar: ' + pct
            });
            fill.style.height = barHeight + '%';
            track.appendChild(fill);
            col.appendChild(track);

            col.appendChild(el('span', {
                className: 'rnn-bar-label' + (i === 0 ? ' top' : ''),
                textContent: '"' + w + '"'
            }));

            chart.appendChild(col);
        }
        return chart;
    }

    // ─── Recurrence arrow (inline SVG) ─────────────────────────────────

    function buildRecurrenceArrow() {
        var wrap = el('div', { className: 'rnn-recurrence-wrap' });
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'rnn-recurrence-svg');
        svg.setAttribute('aria-label', 'Recurrence Arrow h(t-1)');
        svg.setAttribute('viewBox', '0 0 44 80');
        svg.setAttribute('preserveAspectRatio', 'none');

        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M4,55 C30,55 30,25 4,25');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--rnn-recurrence)');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(path);

        var arrow = document.createElementNS(ns, 'polygon');
        arrow.setAttribute('points', '4,22 0,28 8,28');
        arrow.setAttribute('fill', 'var(--rnn-recurrence)');
        svg.appendChild(arrow);

        var text = document.createElementNS(ns, 'text');
        text.setAttribute('x', '14');
        text.setAttribute('y', '43');
        text.setAttribute('font-size', '8');
        text.setAttribute('font-family', 'var(--viz-mono-font)');
        text.setAttribute('fill', 'var(--rnn-recurrence)');
        text.textContent = 'h(t-1)';
        svg.appendChild(text);

        wrap.appendChild(svg);
        return wrap;
    }

    // ─── Main Visualization ────────────────────────────────────────────

    function RNNViz() {
        this.container = document.getElementById('rnn-diagram');

        this.embedDim = 128;
        this.hiddenDim = 64;
        this.model = null;
        this.steps = null;

        this.exIdx = 0;
        this.timestep = 0;
        this.mode = 'inference'; // 'inference' or 'training'
        this.task = 'text-generation'; // RNN task type
        this.expandedBlocks = { tokens: true, embed: false };

        this.dom = {};

        this.rebuildModel();
        this.buildDiagram();
        this.applyBlockStates();
        this.updateDiagram();
        this.bindEvents();
    }

    // ─── Does this timestep produce output for current mode+task? ──────

    RNNViz.prototype.cellHasOutput = function (timestep) {
        var numTokens = EXAMPLES[this.exIdx].tokens.length;
        var last = numTokens - 1;

        if (this.mode === 'training') {
            // Training: all cells produce output (teacher forcing) for all tasks
            return true;
        }

        // Inference mode
        switch (this.task) {
            case 'text-generation':
            case 'sentiment':
                // Only the last cell produces output
                return timestep === last;
            case 'ner':
                // Every cell tags an entity
                return true;
            case 'translation':
            case 'summarization':
                // Simplified: all cells produce output (full encoder-decoder would need separate handling)
                return true;
            default:
                return true;
        }
    };

    RNNViz.prototype.rebuildModel = function () {
        this.model = buildModel(this.embedDim, this.hiddenDim);
        this.steps = runForward(this.model, EXAMPLES[this.exIdx].tokens);
        if (this.timestep >= this.steps.length) this.timestep = this.steps.length - 1;
        this.updateStepperDisplay();
        this.updateMathPanel();
    };

    // ─── Build the DOM skeleton (called once) ──────────────────────────

    RNNViz.prototype.buildDiagram = function () {
        var self = this;
        var c = this.container;
        c.innerHTML = '';

        var tokens = EXAMPLES[this.exIdx].tokens;
        var sentenceText = tokens.map(function (t) { return t.word; }).join('');

        // ── Tokens block (expandable) ──
        var tokensBlock = el('div', {
            id: 'rnn-tokens-block',
            className: 'rnn-block rnn-block--embed rnn-block--token-expand expanded',
            'aria-label': 'Tokenizer'
        });

        // Expanded: labels column + card divs (one bordered div per token)
        var tokensExpanded = el('div', { className: 'rnn-expanded-content', id: 'rnn-tokens-expanded' });

        var row = el('div', { className: 'rnn-token-row' });

        // Labels column — matches card internal layout
        var labels = el('div', { className: 'rnn-token-labels' });
        labels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Time' }));
        labels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Prompt' }));
        labels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Tokens' }));
        row.appendChild(labels);

        // One card per token — clicking a card sets the timestep
        this.dom.wordBoxes = [];
        this.dom.tokenCards = [];
        for (var i = 0; i < tokens.length; i++) {
            var card = el('div', { className: 'rnn-token-card rnn-token-color-' + (i % 10) });
            card.style.cursor = 'pointer';
            (function (idx, viz) {
                card.addEventListener('click', function (e) {
                    e.stopPropagation();
                    viz.timestep = idx;
                    viz.updateStepperDisplay();
                    viz.updateMathPanel();
                    viz.updateDiagram();
                });
            })(i, self);

            card.appendChild(el('span', {
                className: 'rnn-token-card-time',
                textContent: 't=' + (i + 1)
            }));

            var wordSpan = el('span', {
                className: 'rnn-token-card-word',
                textContent: tokens[i].word
            });
            this.dom.wordBoxes.push(wordSpan);
            card.appendChild(wordSpan);

            var idText = String(tokens[i].id);
            if (i === 0) idText = '[' + idText;
            if (i === tokens.length - 1) idText = idText + ']';
            card.appendChild(el('span', {
                className: 'rnn-token-card-id',
                textContent: idText
            }));

            this.dom.tokenCards.push(card);
            row.appendChild(card);
        }

        tokensExpanded.appendChild(row);

        tokensBlock.appendChild(tokensExpanded);
        tokensBlock.appendChild(el('span', {
            className: 'rnn-block-dim',
            id: 'rnn-tokens-dim',
            textContent: '<1, ' + tokens.length + '>'
        }));

        // Shared container so tokens + embed blocks match width
        var tokEmbWrap = el('div', { className: 'rnn-tok-embed-group' });
        tokEmbWrap.appendChild(tokensBlock);


        // ── Embeddings block (expandable) ──
        var embedBlock = el('div', {
            id: 'rnn-embed-block',
            className: 'rnn-block rnn-block--embed rnn-block--clickable',
            'aria-label': 'Embedding Layer'
        });
        embedBlock.appendChild(el('span', {
            className: 'rnn-block-title',
            id: 'rnn-embed-title',
            textContent: 'Embedding'
        }));
        embedBlock.appendChild(el('span', {
            className: 'rnn-block-dim',
            id: 'rnn-embed-dim',
            textContent: '<' + tokens.length + ', ' + this.embedDim + '>'
        }));

        // Collapsed: mini summary
        var embedCollapsed = el('div', { className: 'rnn-collapsed-content', id: 'rnn-embed-collapsed' });
        embedBlock.appendChild(embedCollapsed);

        // Expanded: yellow table
        var embedExpanded = el('div', { className: 'rnn-expanded-content', id: 'rnn-embed-expanded' });

        var embedTable = el('div', {
            className: 'rnn-embeddings',
            id: 'rnn-embeddings',
            'aria-label': 'Embedding Table'
        });

        this.dom.embedRows = [];
        for (var i = 0; i < tokens.length; i++) {
            var row = el('div', { className: 'rnn-embed-row' });

            var tokenIdBox = el('span', {
                className: 'rnn-token-id-box rnn-token-color-' + (i % 10),
                textContent: '[' + tokens[i].id + ']'
            });
            row.appendChild(tokenIdBox);

            var embedVec = el('span', {
                className: 'rnn-embed-vector rnn-token-color-' + (i % 10),
                textContent: '<1, ' + this.embedDim + '>'
            });
            row.appendChild(embedVec);

            this.dom.embedRows.push({
                row: row,
                idBox: tokenIdBox,
                vector: embedVec
            });
            embedTable.appendChild(row);
        }
        embedExpanded.appendChild(embedTable);
        embedBlock.appendChild(embedExpanded);
        tokEmbWrap.appendChild(embedBlock);
        c.appendChild(tokEmbWrap);

        // ── RNN Cell chain: h₀ → [cell₁] → [cell₂] → ... ──
        // Matches reference: each cell shows equations with colored variable boxes
        var cellChain = el('div', {
            id: 'rnn-cell-chain',
            className: 'rnn-cell-chain',
            'aria-label': 'RNN Cell Hidden State Chain'
        });

        // Scrollable track: h₀ block → arrow → cell → arrow → cell → ...
        var cellTrack = el('div', { className: 'rnn-cell-track', id: 'rnn-cell-track' });

        // Inner wrapper — provides positioning context for SVG arrows
        var cellTrackInner = el('div', { className: 'rnn-cell-track-inner' });

        // Start spacer — allows first cell to scroll to center
        cellTrackInner.appendChild(el('div', { className: 'rnn-cell-track-spacer' }));

        // h₀ standalone block (initial hidden state = zeros)
        var h0Block = el('div', { className: 'rnn-h0-block', 'aria-label': 'Initial Hidden State h\u2080' });
        h0Block.innerHTML = '<span class="rnn-var rnn-var-h rnn-h0-inner" data-var="h-out" data-step="-1">h<sub>0</sub></span>';
        cellTrackInner.appendChild(h0Block);

        this.dom.cellCards = [];
        for (var i = 0; i < tokens.length; i++) {
            // Green arrow connecting previous h to this cell
            var hConn = el('div', { className: 'rnn-h-connector' });
            cellTrackInner.appendChild(hConn);

            // Wrapper: cell
            var wrapper = el('div', { className: 'rnn-step-wrapper' });

            // Cell container (blue-gray) with two equation lines
            var cell = el('div', {
                className: 'rnn-step-cell',
                'aria-label': 'RNN Cell t=' + (i + 1)
            });
            cell.style.cursor = 'pointer';

            // Hidden state equation (top): tanh(h_i · w_h + ex_i · w_x + b_h) = h_{i+1}
            var hidEq = el('div', { className: 'rnn-step-eq rnn-step-eq-hidden' });
            var colorIdx = i % 10;
            hidEq.innerHTML = 'tanh(<span class="rnn-var rnn-var-h" data-var="h-in" data-step="' + i + '">h<sub>' + i + '</sub></span>w<sub>h</sub>' +
                ' + <span class="rnn-var rnn-var-e" data-var="e-in" data-step="' + i + '" style="border-color: var(--viz-class-' + colorIdx + '); background: color-mix(in srgb, var(--viz-class-' + colorIdx + ') 15%, transparent);">ex<sub>' + i + '</sub></span>w<sub>x</sub>' +
                ' + b<sub>h</sub>) = <span class="rnn-var rnn-var-h" data-var="h-out" data-step="' + i + '">h<sub>' + (i + 1) + '</sub></span>';
            cell.appendChild(hidEq);

            // Hidden state dimension annotation
            var hidDim = el('div', { className: 'rnn-step-eq-dim rnn-step-eq-dim-hidden' });
            hidDim.innerHTML = '<1, ' + self.hiddenDim + '> = tanh(<1, ' + self.hiddenDim + '>\u00b7<' + self.hiddenDim + ', ' + self.hiddenDim + '> + <1, ' + self.embedDim + '>\u00b7<' + self.embedDim + ', ' + self.hiddenDim + '> + <1, ' + self.hiddenDim + '>)';
            cell.appendChild(hidDim);

            // Output equation (bottom): y_{i+1} = softmax(b_y + h_{i+1} · w_y)
            var outEq = el('div', { className: 'rnn-step-eq rnn-step-eq-output' });
            outEq.innerHTML = '<span class="rnn-var rnn-var-y" data-var="y-out" data-step="' + i + '" style="border-color: var(--viz-class-' + colorIdx + '); background: color-mix(in srgb, var(--viz-class-' + colorIdx + ') 15%, transparent);">y<sub>' + (i + 1) + '</sub></span>' +
                ' = softmax(b<sub>y</sub> + <span class="rnn-var rnn-var-h" data-var="h-to-out" data-step="' + i + '">h<sub>' + (i + 1) + '</sub></span>w<sub>y</sub>)';
            cell.appendChild(outEq);

            // Output dimension annotation
            var outDim = el('div', { className: 'rnn-step-eq-dim rnn-step-eq-dim-output' });
            outDim.innerHTML = '<1, V> = softmax(<1, V> + <1, ' + self.hiddenDim + '>\u00b7<' + self.hiddenDim + ', V>)';
            cell.appendChild(outDim);

            wrapper.appendChild(cell);

            // Click to set timestep
            (function (idx, viz) {
                cell.addEventListener('click', function (e) {
                    e.stopPropagation();
                    viz.timestep = idx;
                    viz.updateStepperDisplay();
                    viz.updateMathPanel();
                    viz.updateDiagram();
                });
            })(i, self);

            this.dom.cellCards.push({ card: cell });
            cellTrackInner.appendChild(wrapper);
        }

        // Continuation dots
        cellTrackInner.appendChild(el('span', { className: 'rnn-continuation', textContent: '\u00b7\u00b7\u00b7' }));

        // End spacer — allows last cell to scroll to center
        cellTrackInner.appendChild(el('div', { className: 'rnn-cell-track-spacer' }));

        cellTrack.appendChild(cellTrackInner);
        cellChain.appendChild(cellTrack);

        // ── Navigation: left arrow, dots, right arrow ──
        var nav = el('div', { className: 'rnn-cell-nav' });

        var prevBtn = el('button', {
            className: 'rnn-cell-nav-arrow',
            'aria-label': 'Previous timestep'
        });
        prevBtn.innerHTML = '<i class="fa fa-chevron-left"></i>';
        prevBtn.addEventListener('click', function () {
            if (self.timestep > 0) {
                self.timestep--;
                self.updateStepperDisplay();
                self.updateMathPanel();
                self.updateDiagram();
            }
        });
        nav.appendChild(prevBtn);

        var dotsWrap = el('div', { className: 'rnn-cell-nav-dots' });
        this.dom.navDots = [];
        for (var i = 0; i < tokens.length; i++) {
            var dot = el('button', {
                className: 'rnn-cell-nav-dot rnn-token-color-' + (i % 10),
                'aria-label': 'Timestep ' + (i + 1)
            });
            (function (idx) {
                dot.addEventListener('click', function () {
                    self.timestep = idx;
                    self.updateStepperDisplay();
                    self.updateMathPanel();
                    self.updateDiagram();
                });
            })(i);
            this.dom.navDots.push(dot);
            dotsWrap.appendChild(dot);
        }
        nav.appendChild(dotsWrap);

        var nextBtn = el('button', {
            className: 'rnn-cell-nav-arrow',
            'aria-label': 'Next timestep'
        });
        nextBtn.innerHTML = '<i class="fa fa-chevron-right"></i>';
        nextBtn.addEventListener('click', function () {
            if (self.timestep < self.steps.length - 1) {
                self.timestep++;
                self.updateStepperDisplay();
                self.updateMathPanel();
                self.updateDiagram();
            }
        });
        nav.appendChild(nextBtn);

        this.dom.prevBtn = prevBtn;
        this.dom.nextBtn = nextBtn;

        cellChain.appendChild(nav);
        c.appendChild(cellChain);

        // ── Prediction block (cards + active histogram) ──
        var outputBlock = el('div', {
            id: 'rnn-output-block',
            className: 'rnn-block rnn-block--output rnn-block--token-expand expanded',
            'aria-label': 'Output Predictions'
        });

        outputBlock.appendChild(el('span', {
            className: 'rnn-block-title',
            textContent: 'Prediction'
        }));

        var outputExpanded = el('div', { className: 'rnn-expanded-content', id: 'rnn-output-expanded' });

        // Active timestep vertical histogram (above cards)
        var histPanel = el('div', { className: 'rnn-hist-panel', id: 'rnn-hist-panel' });
        outputExpanded.appendChild(histPanel);

        var outRow = el('div', { className: 'rnn-token-row' });

        // Labels column
        var outLabels = el('div', { className: 'rnn-token-labels' });
        outLabels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Time' }));
        outLabels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Token' }));
        outLabels.appendChild(el('span', { className: 'rnn-token-label', textContent: 'Prob' }));
        outRow.appendChild(outLabels);

        // One card per timestep output
        this.dom.outputCards = [];
        for (var i = 0; i < tokens.length; i++) {
            var oCard = el('div', { className: 'rnn-token-card rnn-output-card rnn-token-color-' + (i % 10) });
            oCard.style.cursor = 'pointer';
            (function (idx, viz) {
                oCard.addEventListener('click', function (e) {
                    e.stopPropagation();
                    viz.timestep = idx;
                    viz.updateStepperDisplay();
                    viz.updateMathPanel();
                    viz.updateDiagram();
                });
            })(i, self);

            oCard.appendChild(el('span', {
                className: 'rnn-token-card-time',
                textContent: 't=' + (i + 1)
            }));

            var predWord = el('span', { className: 'rnn-token-card-word rnn-output-word' });
            predWord.textContent = self.steps[i] ? self.steps[i].predicted : '?';
            oCard.appendChild(predWord);

            var predProb = el('span', { className: 'rnn-token-card-id rnn-output-prob' });
            predProb.textContent = self.steps[i] ? (self.steps[i].top5[0].prob * 100).toFixed(1) + '%' : '';
            oCard.appendChild(predProb);

            this.dom.outputCards.push(oCard);
            outRow.appendChild(oCard);
        }

        outputExpanded.appendChild(outRow);

        outputBlock.appendChild(outputExpanded);
        outputBlock.appendChild(el('span', {
            className: 'rnn-block-dim',
            id: 'rnn-output-dim',
            textContent: '<' + tokens.length + ', V>'
        }));
        c.appendChild(outputBlock);

        // Store references
        this.dom.tokensBlock = tokensBlock;
        this.dom.tokensDim = document.getElementById('rnn-tokens-dim');
        this.dom.tokensExpanded = tokensExpanded;
        this.dom.embedBlock = embedBlock;
        this.dom.embedTitle = document.getElementById('rnn-embed-title');
        this.dom.embedDim = document.getElementById('rnn-embed-dim');
        this.dom.embedCollapsed = embedCollapsed;
        this.dom.embedExpanded = embedExpanded;
        this.dom.cellChain = cellChain;
        this.dom.cellDim = document.getElementById('rnn-cell-dim');
        this.dom.cellTrack = cellTrack;
        this.dom.cellTrackInner = cellTrackInner;
        this.dom.outputDim = document.getElementById('rnn-output-dim');

        // Click handlers for expandable blocks (not tokens — always expanded)
        function blockClick(blockName) {
            return function (e) {
                e.stopPropagation();
                self.toggleBlock(blockName);
            };
        }
        embedBlock.addEventListener('click', blockClick('embed'));
    };

    // ─── Expand / Collapse ─────────────────────────────────────────────

    RNNViz.prototype.toggleBlock = function (blockName) {
        this.expandedBlocks[blockName] = !this.expandedBlocks[blockName];
        this.applyBlockStates();
        this.updateDiagram();
    };

    RNNViz.prototype.applyBlockStates = function () {
        // Tokens block is always expanded — not included here
        // Cell block is a carousel — always visible, not collapsible
        var blocks = [
            { name: 'embed', el: this.dom.embedBlock }
        ];
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            b.el.classList.toggle('expanded', !!this.expandedBlocks[b.name]);
        }
    };

    // ─── Update all dynamic content ────────────────────────────────────

    RNNViz.prototype.updateDiagram = function () {
        var step = this.steps[this.timestep];
        var tokens = EXAMPLES[this.exIdx].tokens;
        var sentenceText = tokens.map(function (t) { return t.word; }).join('');

        // Highlight active token card, embedding row, output card; toggle output per cell
        for (var i = 0; i < tokens.length; i++) {
            var isActive = (i === this.timestep);
            var hasOutput = this.cellHasOutput(i);

            if (this.dom.tokenCards && this.dom.tokenCards[i]) {
                this.dom.tokenCards[i].classList.toggle('active', isActive);
            }
            if (this.dom.embedRows[i]) {
                this.dom.embedRows[i].row.classList.toggle('active', isActive);
            }

            // Toggle y_t equation and dim annotation visibility in each cell
            if (this.dom.cellCards && this.dom.cellCards[i]) {
                var card = this.dom.cellCards[i].card;
                var outEq = card.querySelector('.rnn-step-eq-output');
                var outDim = card.querySelector('.rnn-step-eq-dim-output');
                if (outEq) outEq.style.display = hasOutput ? '' : 'none';
                if (outDim) outDim.style.display = hasOutput ? '' : 'none';
            }

            // Update output prediction cards
            if (this.dom.outputCards && this.dom.outputCards[i]) {
                this.dom.outputCards[i].classList.toggle('active', isActive);
                var wordEl = this.dom.outputCards[i].querySelector('.rnn-output-word');
                var probEl = this.dom.outputCards[i].querySelector('.rnn-output-prob');
                if (hasOutput) {
                    var s = this.steps[i];
                    if (s) {
                        if (wordEl) wordEl.textContent = s.predicted;
                        if (probEl) probEl.textContent = (s.top5[0].prob * 100).toFixed(1) + '%';
                    }
                    this.dom.outputCards[i].classList.remove('no-output');
                } else {
                    if (wordEl) wordEl.textContent = '\u2014';
                    if (probEl) probEl.textContent = '';
                    this.dom.outputCards[i].classList.add('no-output');
                }
            }
        }

        // Update embedding vector dimension labels
        for (var i = 0; i < this.dom.embedRows.length; i++) {
            this.dom.embedRows[i].vector.textContent = '<1, ' + this.embedDim + '>';
        }

        // Tokens block dim label
        this.dom.tokensDim.textContent = '<1, ' + tokens.length + '>';

        // Embeddings block dim label
        this.dom.embedDim.textContent = '<' + tokens.length + ', ' + this.embedDim + '>';

        // Update aria-labels
        this.dom.cellChain.setAttribute('aria-label', 'RNN Cell Chain ' + this.embedDim + '\u2192' + this.hiddenDim);

        // Output block dim label
        if (this.dom.outputDim) {
            this.dom.outputDim.textContent = '<' + tokens.length + ', V>';
        }

        // Block dim labels
        if (this.dom.cellDim) {
            this.dom.cellDim.textContent = '<' + this.embedDim + '> \u2192 <' + this.hiddenDim + '>';
        }

        // Collapsed content
        this.updateEmbedCollapsed(step);

        // Update active histogram
        this.updateHistPanel();

        this.updateCellCarousel();
        this.snapCellToCenter();
        // Defer arrow drawing so getBoundingClientRect() reflects the new scrollLeft
        var self2 = this;
        requestAnimationFrame(function () {
            self2.drawArrows();
            self2.drawTokenEmbedArrow();
            self2.drawEmbedArrows();
            self2.drawOutputArrow();
        });
    };

    // ─── Collapsed content ─────────────────────────────────────────────

    RNNViz.prototype.updateEmbedCollapsed = function (step) {
        var c = this.dom.embedCollapsed;
        c.innerHTML = '';
        var t = this.timestep;
        var colorIdx = t % 10;

        var row = el('div', { className: 'rnn-embed-row active' });

        var label = el('span', { className: 'rnn-embed-row-label' });
        label.innerHTML = 'x<sub>' + (t + 1) + '</sub>';
        row.appendChild(label);

        var tokenIdBox = el('span', {
            className: 'rnn-token-id-box rnn-token-color-' + colorIdx,
            textContent: '[' + step.id + ']'
        });
        row.appendChild(tokenIdBox);

        var embedVec = el('span', {
            className: 'rnn-embed-vector rnn-token-color-' + colorIdx,
            textContent: '<1, ' + this.embedDim + '>'
        });
        row.appendChild(embedVec);

        c.appendChild(row);
    };

    // ─── Active timestep histogram ──────────────────────────────────────

    RNNViz.prototype.updateHistPanel = function () {
        var panel = document.getElementById('rnn-hist-panel');
        if (!panel) return;
        panel.innerHTML = '';

        var t = this.timestep;
        var step = this.steps[t];
        if (!step) return;

        // No histogram if this cell doesn't produce output
        if (!this.cellHasOutput(t)) {
            var noOut = el('div', { className: 'rnn-hist-header' });
            noOut.textContent = 'No output at t=' + (t + 1);
            noOut.style.opacity = '0.5';
            panel.appendChild(noOut);
            return;
        }
        var colorIdx = t % 10;

        // Header
        var header = el('div', { className: 'rnn-hist-header' });
        header.innerHTML = 'softmax(y<sub>' + (t + 1) + '</sub>) \u2014 Top 5';
        panel.appendChild(header);

        // Vertical bar chart: columns side by side, bars grow upward
        var chart = el('div', { className: 'rnn-hist-vchart' });
        var maxProb = step.top5[0].prob;

        for (var j = 0; j < step.top5.length; j++) {
            var entry = step.top5[j];
            var col = el('div', { className: 'rnn-hist-vcol' });

            // Percentage label on top
            var pct = el('span', { className: 'rnn-hist-vpct' });
            pct.textContent = (entry.prob * 100).toFixed(1) + '%';
            col.appendChild(pct);

            // Bar track (grows upward)
            var track = el('div', { className: 'rnn-hist-vtrack' });
            var fill = el('div', { className: 'rnn-hist-vfill' });
            fill.style.height = (entry.prob / maxProb * 100) + '%';
            if (j === 0) {
                fill.style.background = 'var(--viz-class-' + colorIdx + ')';
            }
            track.appendChild(fill);
            col.appendChild(track);

            // Token label below
            var label = el('span', { className: 'rnn-hist-vlabel' });
            label.textContent = entry.word;
            col.appendChild(label);

            chart.appendChild(col);
        }
        panel.appendChild(chart);
    };

    // ─── Cell carousel update ─────────────────────────────────────────

    RNNViz.prototype.updateCellCarousel = function () {
        var cards = this.dom.cellCards;
        if (!cards) return;
        var t = this.timestep;

        for (var i = 0; i < cards.length; i++) {
            cards[i].card.classList.toggle('active', i === t);
        }

        // Update nav dots
        if (this.dom.navDots) {
            for (var i = 0; i < this.dom.navDots.length; i++) {
                this.dom.navDots[i].classList.toggle('active', i === t);
            }
        }

        // Update arrow disabled states
        if (this.dom.prevBtn) this.dom.prevBtn.disabled = (t === 0);
        if (this.dom.nextBtn) this.dom.nextBtn.disabled = (t === cards.length - 1);
    };

    // Snap active cell to horizontal center of the track viewport
    RNNViz.prototype.snapCellToCenter = function () {
        var cards = this.dom.cellCards;
        var cellTrack = this.dom.cellTrack;
        if (!cards || !cellTrack) return;
        var t = this.timestep;
        if (!cards[t]) return;

        var trackRect = cellTrack.getBoundingClientRect();
        var cellRect = cards[t].card.getBoundingClientRect();
        var cellCenterX = cellRect.left + cellRect.width / 2;
        var trackCenterX = trackRect.left + trackRect.width / 2;

        // How far off-center the cell currently is — adjust scrollLeft by that delta
        cellTrack.scrollLeft += (cellCenterX - trackCenterX);
    };

    // ─── SVG Arrow Overlay ────────────────────────────────────────────
    // Draws curved arrows connecting variable boxes across the cell chain:
    //   Green: h₀→cell₁ h-in, cell_i h-out→cell_{i+1} h-in (hidden state flow)
    //   Red:   h-out (tanh) → h-to-out (softmax) within each cell
    //   Yellow: token-in → e-in (embedding input into cell)

    RNNViz.prototype.drawArrows = function () {
        var inner = this.dom.cellTrackInner;
        if (!inner) return;

        // Remove old SVG
        var oldSvg = inner.querySelector('.rnn-arrows-svg');
        if (oldSvg) oldSvg.remove();

        var innerRect = inner.getBoundingClientRect();

        // Create SVG overlay matching the full content width of the inner wrapper
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'rnn-arrows-svg');
        svg.setAttribute('width', inner.scrollWidth);
        svg.setAttribute('height', inner.scrollHeight);
        svg.style.width = inner.scrollWidth + 'px';
        svg.style.height = inner.scrollHeight + 'px';

        // Marker definitions for arrowheads
        var defs = document.createElementNS(svgNS, 'defs');
        var colors = {
            green: { cls: 'rnn-arrow-green', varName: '--rnn-embed-color', fallback: EAIColor('green') },
            red: { cls: 'rnn-arrow-red', varName: '--rnn-output-color', fallback: EAIColor('red') },
            yellow: { cls: 'rnn-arrow-yellow', varName: '--rnn-embed-vector-border', fallback: EAIColor('gold') }
        };

        // Resolve CSS custom property colors
        var cs = getComputedStyle(document.documentElement);
        for (var key in colors) {
            var c = colors[key];
            c.resolved = cs.getPropertyValue(c.varName).trim() || c.fallback;

            var marker = document.createElementNS(svgNS, 'marker');
            marker.setAttribute('id', 'arrow-' + key);
            marker.setAttribute('viewBox', '0 0 10 7');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse');
            var poly = document.createElementNS(svgNS, 'polygon');
            poly.setAttribute('points', '0 0, 10 3.5, 0 7');
            poly.setAttribute('fill', c.resolved);
            poly.setAttribute('fill-opacity', '0.7');
            marker.appendChild(poly);
            defs.appendChild(marker);
        }
        svg.appendChild(defs);

        // Helper: get element position relative to the inner wrapper's content area.
        // innerRect.left already reflects scroll offset (goes negative as track scrolls),
        // so subtracting it from elemRect directly gives content-space coordinates.
        function getPos(elem, anchor) {
            var r = elem.getBoundingClientRect();
            var x, y;
            if (anchor === 'right') {
                x = r.right - innerRect.left;
                y = r.top + r.height / 2 - innerRect.top;
            } else if (anchor === 'left') {
                x = r.left - innerRect.left;
                y = r.top + r.height / 2 - innerRect.top;
            } else if (anchor === 'top') {
                x = r.left + r.width / 2 - innerRect.left;
                y = r.top - innerRect.top;
            } else if (anchor === 'bottom') {
                x = r.left + r.width / 2 - innerRect.left;
                y = r.bottom - innerRect.top;
            } else { // center
                x = r.left + r.width / 2 - innerRect.left;
                y = r.top + r.height / 2 - innerRect.top;
            }
            return { x: x, y: y };
        }

        // Helper: create a curved path element
        function makePath(from, to, color, curveDir, dashArray) {
            var dx = to.x - from.x;
            var dy = to.y - from.y;
            var cx1, cy1, cx2, cy2;

            if (curveDir === 'horizontal') {
                // Horizontal S-curve between cells
                cx1 = from.x + dx * 0.35;
                cy1 = from.y;
                cx2 = from.x + dx * 0.65;
                cy2 = to.y;
            } else if (curveDir === 'vertical-up') {
                // Vertical curve going upward (token→cell)
                // Gentle S from bottom token up to the e-in box
                var xOff = (to.x - from.x) * 0.3;
                cx1 = from.x + xOff;
                cy1 = from.y + dy * 0.6;
                cx2 = to.x - xOff;
                cy2 = to.y - dy * 0.4;
            } else if (curveDir === 'vertical-down') {
                // Vertical curve going downward (embedding above → e-in in cell)
                var xOff = (to.x - from.x) * 0.3;
                cx1 = from.x + xOff;
                cy1 = from.y + dy * 0.4;
                cx2 = to.x - xOff;
                cy2 = to.y - dy * 0.6;
            } else if (curveDir === 'internal') {
                // Short arc bowing to the right, connecting h-out → h-to-out
                var bow = Math.max(12, Math.abs(dy) * 0.35);
                cx1 = Math.max(from.x, to.x) + bow;
                cy1 = from.y + dy * 0.35;
                cx2 = Math.max(from.x, to.x) + bow;
                cy2 = to.y - dy * 0.35;
            } else {
                cx1 = from.x + dx * 0.5;
                cy1 = from.y;
                cx2 = from.x + dx * 0.5;
                cy2 = to.y;
            }

            var d = 'M ' + from.x + ' ' + from.y +
                ' C ' + cx1 + ' ' + cy1 + ', ' + cx2 + ' ' + cy2 + ', ' + to.x + ' ' + to.y;
            var path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-opacity', '0.7');
            path.setAttribute('marker-end', 'url(#arrow-' + getColorKey(color) + ')');
            if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
            return path;
        }

        function getColorKey(resolved) {
            for (var k in colors) {
                if (colors[k].resolved === resolved) return k;
            }
            return 'green';
        }

        // ── Draw green arrows: hidden state flow ──
        // h₀ → first cell's h-in
        var h0Out = inner.querySelector('[data-var="h-out"][data-step="-1"]');
        var allCells = this.dom.cellCards;

        if (h0Out && allCells.length > 0) {
            var firstHIn = allCells[0].card.querySelector('[data-var="h-in"]');
            if (firstHIn) {
                var from = getPos(h0Out, 'right');
                var to = getPos(firstHIn, 'left');
                svg.appendChild(makePath(from, to, colors.green.resolved, 'horizontal'));
            }
        }

        // cell_i h-out → cell_{i+1} h-in
        for (var i = 0; i < allCells.length - 1; i++) {
            var hOut = allCells[i].card.querySelector('[data-var="h-out"]');
            var hInNext = allCells[i + 1].card.querySelector('[data-var="h-in"]');
            if (hOut && hInNext) {
                var from = getPos(hOut, 'right');
                var to = getPos(hInNext, 'left');
                svg.appendChild(makePath(from, to, colors.green.resolved, 'horizontal'));
            }
        }

        // ── Draw red arrows: h-out → h-to-out (internal, within each cell) ──
        // Only draw if this cell produces output (y_t equation is visible)
        for (var i = 0; i < allCells.length; i++) {
            if (!this.cellHasOutput(i)) continue;
            var hOut = allCells[i].card.querySelector('[data-var="h-out"]');
            var hToOut = allCells[i].card.querySelector('[data-var="h-to-out"]');
            if (hOut && hToOut) {
                var from = getPos(hOut, 'bottom');
                var to = getPos(hToOut, 'top');
                svg.appendChild(makePath(from, to, colors.green.resolved, 'internal'));
            }
        }

        inner.appendChild(svg);
    };

    // ─── Diagram-level SVG: Active token → Embedding block arrow ──────
    // Arrow from the active token card bottom to the embedding block top,
    // colored with that token's --viz-class-N.

    RNNViz.prototype.drawTokenEmbedArrow = function () {
        var diagram = this.container;
        if (!diagram) return;

        var oldSvg = diagram.querySelector('.rnn-tok-embed-arrow-svg');
        if (oldSvg) oldSvg.remove();

        var tokenCards = this.dom.tokenCards;
        var embedBlock = this.dom.embedBlock;
        if (!tokenCards || tokenCards.length === 0 || !embedBlock) return;

        var t = this.timestep;
        var activeCard = tokenCards[t];
        if (!activeCard) return;

        // Find the visible id box — could be in expanded table or collapsed summary
        var visibleIdBox = embedBlock.querySelector('.rnn-embed-row.active .rnn-token-id-box');
        if (!visibleIdBox) return;

        var diagramRect = diagram.getBoundingClientRect();
        var cardRect = activeCard.getBoundingClientRect();
        var embedRect = visibleIdBox.getBoundingClientRect();
        // Skip if target is hidden (zero-size rect)
        if (embedRect.width === 0 && embedRect.height === 0) return;
        var svgNS = 'http://www.w3.org/2000/svg';

        var cs = getComputedStyle(document.documentElement);
        var colorVar = '--viz-class-' + (t % 10);
        var tokenColor = cs.getPropertyValue(colorVar).trim() || '#888';

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'rnn-tok-embed-arrow-svg');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.style.overflow = 'visible';
        svg.style.zIndex = '3';

        var defs = document.createElementNS(svgNS, 'defs');
        var marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'tok-embed-arrow');
        marker.setAttribute('viewBox', '0 0 10 7');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');
        var poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', '0 0, 10 3.5, 0 7');
        poly.setAttribute('fill', tokenColor);
        poly.setAttribute('fill-opacity', '0.8');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // From: bottom center of active token card
        var fromX = cardRect.left + cardRect.width / 2 - diagramRect.left;
        var fromY = cardRect.bottom - diagramRect.top;

        // To: top center of active embedding id box
        var toX = embedRect.left + embedRect.width / 2 - diagramRect.left;
        var toY = embedRect.top - diagramRect.top;

        var dy = toY - fromY;
        var cx1 = fromX;
        var cy1 = fromY + dy * 0.5;
        var cx2 = toX;
        var cy2 = toY - dy * 0.3;

        var d = 'M ' + fromX + ' ' + fromY +
            ' C ' + cx1 + ' ' + cy1 + ', ' + cx2 + ' ' + cy2 + ', ' + toX + ' ' + toY;

        var path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', tokenColor);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('marker-end', 'url(#tok-embed-arrow)');
        svg.appendChild(path);

        diagram.appendChild(svg);
    };

    // ─── Diagram-level SVG: Embedding block → active cell e-in arrow ──
    // Single arrow from embedding block bottom center to the active
    // timestep's ex variable, colored with that token's --viz-class-N.

    RNNViz.prototype.drawEmbedArrows = function () {
        var diagram = this.container;
        if (!diagram) return;

        // Remove old diagram-level SVG
        var oldSvg = diagram.querySelector('.rnn-embed-arrows-svg');
        if (oldSvg) oldSvg.remove();

        var cellCards = this.dom.cellCards;
        var embedBlock = this.dom.embedBlock;
        if (!cellCards || cellCards.length === 0 || !embedBlock) return;

        var t = this.timestep;
        var eIn = cellCards[t].card.querySelector('[data-var="e-in"]');
        if (!eIn) return;

        // Find the visible embedding vector for the active timestep
        var visibleVec = embedBlock.querySelector('.rnn-embed-row.active .rnn-embed-vector');
        if (!visibleVec) return;

        var diagramRect = diagram.getBoundingClientRect();
        var embedRect = visibleVec.getBoundingClientRect();
        if (embedRect.width === 0 && embedRect.height === 0) return;
        var targetRect = eIn.getBoundingClientRect();
        var svgNS = 'http://www.w3.org/2000/svg';

        // Resolve this token's color
        var cs = getComputedStyle(document.documentElement);
        var colorVar = '--viz-class-' + (t % 10);
        var tokenColor = cs.getPropertyValue(colorVar).trim() || '#888';

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'rnn-embed-arrows-svg');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.style.overflow = 'visible';
        svg.style.zIndex = '3';

        // Arrowhead marker
        var defs = document.createElementNS(svgNS, 'defs');
        var marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'embed-arrow-active');
        marker.setAttribute('viewBox', '0 0 10 7');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');
        var poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', '0 0, 10 3.5, 0 7');
        poly.setAttribute('fill', tokenColor);
        poly.setAttribute('fill-opacity', '0.8');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // From: bottom center of embedding block
        var fromX = embedRect.left + embedRect.width / 2 - diagramRect.left;
        var fromY = embedRect.bottom - diagramRect.top;

        // To: top center of the active cell's e-in variable
        var toX = targetRect.left + targetRect.width / 2 - diagramRect.left;
        var toY = targetRect.top - diagramRect.top;

        // Bezier: drop straight down, then curve to target
        var dy = toY - fromY;
        var cx1 = fromX;
        var cy1 = fromY + dy * 0.5;
        var cx2 = toX;
        var cy2 = toY - dy * 0.3;

        var d = 'M ' + fromX + ' ' + fromY +
            ' C ' + cx1 + ' ' + cy1 + ', ' + cx2 + ' ' + cy2 + ', ' + toX + ' ' + toY;

        var path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', tokenColor);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('marker-end', 'url(#embed-arrow-active)');
        svg.appendChild(path);

        diagram.appendChild(svg);
    };

    // ─── Diagram-level SVG: active cell y-out → histogram panel ────────

    RNNViz.prototype.drawOutputArrow = function () {
        var diagram = this.container;
        if (!diagram) return;

        var oldSvg = diagram.querySelector('.rnn-output-arrows-svg');
        if (oldSvg) oldSvg.remove();

        // No arrow if this cell doesn't produce output
        if (!this.cellHasOutput(this.timestep)) return;

        var cellCards = this.dom.cellCards;
        var histPanel = document.getElementById('rnn-hist-panel');
        if (!cellCards || cellCards.length === 0 || !histPanel) return;

        var t = this.timestep;
        var yOut = cellCards[t].card.querySelector('[data-var="y-out"]');
        if (!yOut) return;

        var diagramRect = diagram.getBoundingClientRect();
        var yOutRect = yOut.getBoundingClientRect();
        var histRect = histPanel.getBoundingClientRect();
        var svgNS = 'http://www.w3.org/2000/svg';

        var cs = getComputedStyle(document.documentElement);
        var colorVar = '--viz-class-' + (t % 10);
        var tokenColor = cs.getPropertyValue(colorVar).trim() || '#888';

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'rnn-output-arrows-svg');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.style.overflow = 'visible';
        svg.style.zIndex = '3';

        var defs = document.createElementNS(svgNS, 'defs');
        var marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'output-arrow-active');
        marker.setAttribute('viewBox', '0 0 10 7');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');
        var poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', '0 0, 10 3.5, 0 7');
        poly.setAttribute('fill', tokenColor);
        poly.setAttribute('fill-opacity', '0.8');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // From: bottom center of y-out variable in active cell
        var fromX = yOutRect.left + yOutRect.width / 2 - diagramRect.left;
        var fromY = yOutRect.bottom - diagramRect.top;

        // To: top center of histogram panel
        var toX = histRect.left + histRect.width / 2 - diagramRect.left;
        var toY = histRect.top - diagramRect.top;

        var dy = toY - fromY;
        var cx1 = fromX;
        var cy1 = fromY + dy * 0.5;
        var cx2 = toX;
        var cy2 = toY - dy * 0.3;

        var d = 'M ' + fromX + ' ' + fromY +
            ' C ' + cx1 + ' ' + cy1 + ', ' + cx2 + ' ' + cy2 + ', ' + toX + ' ' + toY;

        var path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', tokenColor);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('marker-end', 'url(#output-arrow-active)');
        svg.appendChild(path);

        diagram.appendChild(svg);
    };

    // ─── Event binding ─────────────────────────────────────────────────

    RNNViz.prototype.bindEvents = function () {
        var self = this;

        // Mode toggle: Inference / Training
        var inferBtn = document.getElementById('btn-mode-inference');
        var trainBtn = document.getElementById('btn-mode-training');
        function setMode(mode) {
            self.mode = mode;
            inferBtn.classList.toggle('active', mode === 'inference');
            trainBtn.classList.toggle('active', mode === 'training');
            self.updateDiagram();
        }
        inferBtn.addEventListener('click', function () { setMode('inference'); });
        trainBtn.addEventListener('click', function () { setMode('training'); });

        // Task selector
        document.getElementById('rnn-task-select').addEventListener('change', function () {
            self.task = this.value;
            self.updateDiagram();
        });

        document.getElementById('rnn-example-select').addEventListener('change', function () {
            self.exIdx = parseInt(this.value);
            self.timestep = 0;
            self.expandedBlocks = { tokens: true, embed: false };
            self.rebuildModel();
            self.buildDiagram(); // Rebuild DOM since token count changes
            self.applyBlockStates();
            self.updateDiagram();
        });

        DU.wireStepper('rnn-timestep-minus', 'rnn-timestep-plus', 'rnn-timestep-value', {
            min: 0,
            max: 999,
            step: 1,
            onChange: function (val) {
                var maxT = self.steps.length - 1;
                var newT = Math.max(0, Math.min(val, maxT));
                self.timestep = newT;
                var valEl = document.getElementById('rnn-timestep-value');
                if (valEl) valEl.value = newT;
                self.updateMathPanel();
                self.updateDiagram();
            }
        });

        document.getElementById('rnn-hidden-dim').addEventListener('change', function () {
            self.hiddenDim = parseInt(this.value);
            self.expandedBlocks = { tokens: true, embed: false };
            self.rebuildModel();
            self.buildDiagram();
            self.applyBlockStates();
            self.updateDiagram();
        });

        document.getElementById('rnn-embed-dim').addEventListener('change', function () {
            self.embedDim = parseInt(this.value);
            self.expandedBlocks = { tokens: true, embed: false };
            self.rebuildModel();
            self.buildDiagram();
            self.applyBlockStates();
            self.updateDiagram();
        });

        document.getElementById('rnn-btn-reset').addEventListener('click', function () {
            self.exIdx = 0;
            self.timestep = 0;
            self.hiddenDim = 64;
            self.embedDim = 128;
            self.expandedBlocks = { tokens: true, embed: false };
            self.task = 'text-generation';
            self.mode = 'inference';
            document.getElementById('rnn-example-select').value = '0';
            document.getElementById('rnn-hidden-dim').value = '64';
            document.getElementById('rnn-embed-dim').value = '128';
            document.getElementById('rnn-task-select').value = 'text-generation';
            inferBtn.classList.add('active');
            trainBtn.classList.remove('active');
            self.rebuildModel();
            self.buildDiagram();
            self.applyBlockStates();
            self.updateDiagram();
        });

        document.addEventListener('themechange', function () {
            self.updateDiagram();
        });

        // Redraw arrows on resize (debounced)
        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { self.drawArrows(); self.drawTokenEmbedArrow(); self.drawEmbedArrows(); self.drawOutputArrow(); }, 100);
        });

        // No manual scroll — navigation is via arrows/dots only

        var tabBtns = document.querySelectorAll('.info-panel-tabs [data-tab]');
        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                tabBtns.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var p = btn.closest('.panel');
                p.querySelectorAll('.info-tab-content').forEach(function (c) { c.classList.remove('active'); });
                var tgt = p.querySelector('#tab-' + btn.dataset.tab);
                if (tgt) tgt.classList.add('active');
            });
        });
    };

    RNNViz.prototype.updateStepperDisplay = function () {
        var valEl = document.getElementById('rnn-timestep-value');
        if (valEl) valEl.value = this.timestep;
    };

    // ─── Math Panel ────────────────────────────────────────────────────

    RNNViz.prototype.updateMathPanel = function () {
        var panel = document.getElementById('rnn-math-panel');
        if (!panel || !this.steps || this.steps.length === 0) return;
        var step = this.steps[this.timestep];
        var showN = Math.min(6, this.hiddenDim);
        var showE = Math.min(6, this.embedDim);
        var suffix = function (dim, n) { return dim > n ? ', \u2026' : ''; };

        var html = '';

        // Embedding
        html += '<div class="rnn-math-section">';
        html += '<div class="rnn-math-title">Embedding Lookup</div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">Input token:</span><span class="rnn-math-value">\u201c' + displayWord(step.word) + '\u201d (id ' + step.id + ')</span></div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">x_t = E[' + step.id + ']:</span></div>';
        html += '<div class="rnn-math-vector">';
        for (var i = 0; i < Math.min(showE, step.emb.length); i++) {
            html += '<span class="rnn-vec-cell">' + step.emb[i].toFixed(3) + '</span>';
        }
        if (this.embedDim > showE) html += '<span class="rnn-vec-cell">\u2026</span>';
        html += '</div></div>';

        // Hidden state
        html += '<div class="rnn-math-section">';
        html += '<div class="rnn-math-title">Hidden State</div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">h_{t-1}:</span><span class="rnn-math-value">[' + step.h_prev.slice(0, showN).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(this.hiddenDim, showN) + ']</span></div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">W_xh\u00b7x_t:</span><span class="rnn-math-value">[' + step.Wx_x.slice(0, showN).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(this.hiddenDim, showN) + ']</span></div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">W_hh\u00b7h:</span><span class="rnn-math-value">[' + step.Wh_h.slice(0, showN).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(this.hiddenDim, showN) + ']</span></div>';
        html += '<div class="rnn-math-row"><span class="rnn-math-label">pre_tanh:</span><span class="rnn-math-value">[' + step.pre_tanh.slice(0, showN).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(this.hiddenDim, showN) + ']</span></div>';
        html += '<div class="rnn-math-row" style="font-weight:600;color:var(--rnn-cell-color);"><span class="rnn-math-label">h_t = tanh(\u2026):</span><span class="rnn-math-value">[' + step.h_t.slice(0, showN).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(this.hiddenDim, showN) + ']</span></div>';
        html += '</div>';

        // Top-5
        html += '<div class="rnn-math-section">';
        html += '<div class="rnn-math-title">Predictions (Top 5)</div>';
        html += '<ul class="rnn-math-pred-list">';
        for (var i = 0; i < step.top5.length; i++) {
            var p = step.top5[i];
            var w = displayWord(p.word);
            html += '<li><span>\u201c' + w + '\u201d (id ' + p.idx + ')</span><span>' + (p.prob * 100).toFixed(2) + '%</span></li>';
        }
        html += '</ul></div>';

        panel.innerHTML = html;
    };

    // ─── Init ──────────────────────────────────────────────────────────

    function init() {
        resolveLibs();
        new RNNViz();
    }

    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();

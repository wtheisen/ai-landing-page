/**
 * Transformer & Attention Architecture Diagram Visualizer (D3/SVG)
 *
 * SVG-based interactive block diagram with self-attention.
 * Shows: tokens → embedding → Q/K/V projection → head box
 *        → concat + W_O → output embedding.
 *
 * Clickable chips expand to show matrices/heatmaps.
 * Head navigation via colored squares in concat row.
 */
(function () {
    'use strict';

    var CU, DU;
    function resolveLibs() {
        CU = window.VizLib.CanvasUtils;
        DU = window.VizLib.DomUtils;
    }

    // ─── Constants ────────────────────────────────────────────────────
    var CANVAS_W = 720;
    var MONO = "'SF Mono','Menlo','Monaco','Consolas','Courier New',monospace";
    var SERIF = "Georgia,'Times New Roman',serif";

    // ─── Seeded PRNG (mulberry32) ─────────────────────────────────────
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // ─── Math Utilities ───────────────────────────────────────────────
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

    function dot(a, b) {
        var sum = 0;
        for (var i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
    }

    function softmax(v) {
        var maxV = Math.max.apply(null, v);
        var exps = v.map(function (x) { return Math.exp(x - maxV); });
        var sum = exps.reduce(function (a, b) { return a + b; }, 0);
        return exps.map(function (e) { return e / sum; });
    }

    // ─── Constants: Pre-tokenized Examples ────────────────────────────
    var EXAMPLES = [
        {
            label: 'The cat sat on the mat',
            tokens: [
                { word: 'The', id: 464 },
                { word: ' cat', id: 3797 },
                { word: ' sat', id: 3290 },
                { word: ' on', id: 319 },
                { word: ' the', id: 262 },
                { word: ' mat', id: 2603 }
            ]
        },
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
            label: 'King is to queen as man',
            tokens: [
                { word: 'King', id: 15839 },
                { word: ' is', id: 318 },
                { word: ' to', id: 284 },
                { word: ' queen', id: 16599 },
                { word: ' as', id: 355 },
                { word: ' man', id: 582 }
            ]
        }
    ];

    // ─── Encoder-Decoder Examples (source → target pairs) ────────────
    var EXAMPLES_ENC_DEC = [
        {
            source: [
                { word: 'The', id: 464 },
                { word: ' cat', id: 3797 },
                { word: ' sat', id: 3290 },
                { word: ' on', id: 319 },
                { word: ' the', id: 262 },
                { word: ' mat', id: 2603 }
            ],
            target: [
                { word: 'Le', id: 1030 },
                { word: ' chat', id: 8537 },
                { word: ' assis', id: 23891 },
                { word: ' sur', id: 1762 },
                { word: ' le', id: 443 },
                { word: ' tapis', id: 37642 }
            ]
        },
        {
            source: [
                { word: 'I', id: 40 },
                { word: ' like', id: 1299 },
                { word: ' cute', id: 23172 },
                { word: ' k', id: 372 },
                { word: 'itt', id: 1387 },
                { word: 'ies', id: 566 },
                { word: ' and', id: 326 }
            ],
            target: [
                { word: 'J', id: 449 },
                { word: "'aime", id: 6, },
                { word: ' les', id: 622 },
                { word: ' chat', id: 8537 },
                { word: 'ons', id: 684 },
                { word: ' mign', id: 31254 },
                { word: 'ons', id: 684 },
                { word: ' et', id: 2123 }
            ]
        },
        {
            source: [
                { word: 'King', id: 15839 },
                { word: ' is', id: 318 },
                { word: ' to', id: 284 },
                { word: ' queen', id: 16599 },
                { word: ' as', id: 355 },
                { word: ' man', id: 582 }
            ],
            target: [
                { word: 'Roi', id: 7832 },
                { word: ' est', id: 1556 },
                { word: ' \u00e0', id: 2122 },
                { word: ' reine', id: 29512 },
                { word: ' comme', id: 3249 },
                { word: ' homme', id: 13404 }
            ]
        }
    ];

    // ─── Color Helpers ────────────────────────────────────────────────
    function getCSS(prop) {
        return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    }

    function parseColor(str) {
        if (!str) return [128, 128, 128];
        if (str.startsWith('#')) {
            var hex = str.slice(1);
            if (hex.length === 3) {
                return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16)];
            }
            return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
        }
        var m = str.match(/(\d+)/g);
        if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
        return [128, 128, 128];
    }

    function interpolateHeatColor(t, coolStr, midStr, warmStr) {
        var cool = parseColor(coolStr);
        var mid  = parseColor(midStr);
        var warm = parseColor(warmStr);
        var r, g, b;
        if (t <= 0.5) {
            var f = t * 2;
            r = cool[0] + (mid[0] - cool[0]) * f;
            g = cool[1] + (mid[1] - cool[1]) * f;
            b = cool[2] + (mid[2] - cool[2]) * f;
        } else {
            var f2 = (t - 0.5) * 2;
            r = mid[0] + (warm[0] - mid[0]) * f2;
            g = mid[1] + (warm[1] - mid[1]) * f2;
            b = mid[2] + (warm[2] - mid[2]) * f2;
        }
        return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    }

    function displayWord(w) {
        return w.replace(/^ /, '\u00b7');
    }

    function getTokenClassColor(index) {
        var color = getCSS('--viz-class-' + (index % 10));
        return color || '#999';
    }

    function tokenColorBgOpaque(hex, ratio, baseBg) {
        var c = parseColor(hex);
        var b = baseBg ? parseColor(baseBg) : [255, 255, 255];
        var r = ratio || 0.15;
        return 'rgb(' +
            Math.round(c[0] * r + b[0] * (1 - r)) + ',' +
            Math.round(c[1] * r + b[1] * (1 - r)) + ',' +
            Math.round(c[2] * r + b[2] * (1 - r)) + ')';
    }

    function tokenColorBorder(hex, alpha) {
        var c = parseColor(hex);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha || 0.5) + ')';
    }

    // Head color palettes
    var HEAD_COLORS_LIGHT = [EAIColor('class-1', 'light'),EAIColor('class-4', 'light'),EAIColor('class-2', 'light'),EAIColor('class-0', 'light'),EAIColor('class-3', 'light'),EAIColor('class-6', 'light'),EAIColor('class-7', 'light'),EAIColor('class-8', 'light')];
    var HEAD_COLORS_DARK  = [EAIColor('class-1', 'dark'),EAIColor('class-4', 'dark'),EAIColor('class-2', 'dark'),EAIColor('class-0', 'dark'),EAIColor('class-3', 'dark'),EAIColor('class-9', 'dark'),EAIColor('class-5', 'dark'),EAIColor('class-6', 'dark')];

    function getHeadColors() {
        var theme = document.documentElement.getAttribute('data-theme');
        return theme === 'gruvbox-dark' ? HEAD_COLORS_DARK : HEAD_COLORS_LIGHT;
    }

    // ─── Embedding lookup ─────────────────────────────────────────────
    function getEmbedding(tokenId, dim, seed) {
        var rng = mulberry32(seed + tokenId * 7919);
        var emb = [];
        for (var i = 0; i < dim; i++) {
            emb.push((rng() * 2 - 1) * 0.5);
        }
        return emb;
    }

    function positionalEncoding(pos, dim) {
        var pe = [];
        for (var i = 0; i < dim; i++) {
            var angle = pos / Math.pow(10000, (2 * Math.floor(i / 2)) / dim);
            pe.push((i % 2 === 0) ? Math.sin(angle) : Math.cos(angle));
        }
        return pe;
    }

    // ─── Token Embedding Helper ─────────────────────────────────────
    function computeTokenEmbeddings(tokens, embedDim, embSeed, usePE) {
        var n = tokens.length;
        var embeddings = [];
        for (var i = 0; i < n; i++) {
            embeddings.push(getEmbedding(tokens[i].id, embedDim, embSeed));
        }
        var pe = [];
        var embedded = [];
        for (var i = 0; i < n; i++) {
            var p = positionalEncoding(i, embedDim);
            pe.push(p);
            embedded.push(usePE ? vecAdd(embeddings[i], p) : embeddings[i].slice());
        }
        return { embeddings: embeddings, pe: pe, embedded: embedded };
    }

    // ─── Per-Layer Model Builder ────────────────────────────────────
    function buildLayerModel(embedDim, numHeads, layerIndex, layerType) {
        var baseSeed = { encoder: 42, decoder: 137, cross: 271 }[layerType] || 42;
        var seed = baseSeed + layerIndex * 10007;
        var rng = mulberry32(seed);
        var headDim = Math.floor(embedDim / numHeads);
        var heads = [];
        for (var h = 0; h < numHeads; h++) {
            heads.push({
                W_Q: makeWeights(headDim, embedDim, rng, Math.sqrt(2.0 / (embedDim + headDim))),
                W_K: makeWeights(headDim, embedDim, rng, Math.sqrt(2.0 / (embedDim + headDim))),
                W_V: makeWeights(headDim, embedDim, rng, Math.sqrt(2.0 / (embedDim + headDim)))
            });
        }
        return { heads: heads, headDim: headDim, numHeads: numHeads, embedDim: embedDim };
    }

    // Shared attention head computation — supports both self-attention and cross-attention
    // queryVecs: [nQ x dim], kvVecs: [nKV x dim]
    function runAttentionHeads(headWeights, numHeads, headDim, queryVecs, kvVecs, nQ, nKV, temperature, causalMask, biasMode) {
        var heads = [];
        for (var h = 0; h < numHeads; h++) {
            var Q = [], K = [], V = [];
            for (var i = 0; i < nQ; i++) {
                Q.push(matVecMul(headWeights[h].W_Q, queryVecs[i]));
            }
            for (var j = 0; j < nKV; j++) {
                K.push(matVecMul(headWeights[h].W_K, kvVecs[j]));
                V.push(matVecMul(headWeights[h].W_V, kvVecs[j]));
            }
            var scale = Math.sqrt(headDim);
            var scores = [];
            var weights = [];
            for (var i = 0; i < nQ; i++) {
                var row = [];
                for (var j = 0; j < nKV; j++) {
                    if (causalMask && j > i) {
                        row.push(-Infinity);
                    } else {
                        var rawScore = dot(Q[i], K[j]) / scale / temperature;
                        var bias = getHeadBias(h, i, j, biasMode);
                        row.push(rawScore + bias);
                    }
                }
                scores.push(row);
                weights.push(softmax(row));
            }
            var output = [];
            for (var i = 0; i < nQ; i++) {
                var out = [];
                for (var d = 0; d < headDim; d++) out.push(0);
                for (var j = 0; j < nKV; j++) {
                    for (var d = 0; d < headDim; d++) {
                        out[d] += weights[i][j] * V[j][d];
                    }
                }
                output.push(out);
            }
            heads.push({ Q: Q, K: K, V: V, scores: scores, weights: weights, output: output });
        }
        return heads;
    }

    // Mode-aware synthetic head biases
    function getHeadBias(h, i, j, biasMode) {
        var headType = h % 4;
        if (biasMode === 'gpt2') {
            // Autoregressive-friendly patterns
            if (headType === 0) return (j === Math.max(0, i - 1)) ? 1.8 : -0.2;  // bigram (attend to previous)
            if (headType === 1) return (i === j) ? 2.0 : -0.3;                     // self-focus
            if (headType === 2) return (j === 0) ? 1.5 : -0.3 * (i - j);          // first-token attention + recency
            return -0.3 * Math.abs(i - j);                                          // local window
        }
        // BERT / bidirectional biases (original)
        if (headType === 0) return -0.5 * Math.abs(i - j);
        if (headType === 1) return (i === j) ? 2.0 : -0.3;
        if (headType === 2) return -0.4 * j;
        return (j === Math.max(0, i - 1)) ? 1.8 : -0.2;
    }

    // ─── Theme Colors ─────────────────────────────────────────────────
    function getThemeColors() {
        var s = getComputedStyle(document.documentElement);
        var g = function(name) { return s.getPropertyValue(name).trim(); };
        return {
            qBg:         g('--tf-q-bg'),
            qBorder:     g('--tf-q-border'),
            qText:       g('--tf-q-text'),
            kBg:         g('--tf-k-bg'),
            kBorder:     g('--tf-k-border'),
            kText:       g('--tf-k-text'),
            vBg:         g('--tf-v-bg'),
            vBorder:     g('--tf-v-border'),
            vText:       g('--tf-v-text'),
            embedColor:  g('--tf-embed-color'),
            embedBg:     g('--tf-embed-bg'),
            embedBorder: g('--tf-embed-border'),
            headColor:   g('--tf-head-color'),
            headBg:      g('--tf-head-bg'),
            headBorder:  g('--tf-head-border'),
            outputColor: g('--tf-output-color'),
            outputBg:    g('--tf-output-bg'),
            outputBorder:g('--tf-output-border'),
            canvasBg:    g('--tf-canvas-bg') || g('--viz-canvas-bg'),
            text:        g('--tf-text'),
            textMuted:   g('--tf-text-muted'),
            arrowColor:  g('--tf-arrow-color'),
            heatCool:    g('--tf-heat-cool'),
            heatMid:     g('--tf-heat-mid'),
            heatWarm:    g('--tf-heat-warm'),
            scaleLabel:  g('--tf-scale-label'),
            concatBorder:g('--tf-concat-border'),
            woColor:     g('--tf-wo-color'),
            residualColor: g('--tf-residual-color'),
            maskColor:     g('--tf-mask-color'),
            maskBg:        g('--tf-mask-bg'),
            maskStripe:    g('--tf-mask-stripe'),
            crossColor:    g('--tf-cross-color'),
            crossBg:       g('--tf-cross-bg'),
            crossBorder:   g('--tf-cross-border'),
            sectionBorder: g('--tf-section-border'),
            layerBorder:        g('--tf-layer-border'),
            layerHoverBg:       g('--tf-layer-hover-bg'),
            layerExpandedBorder:g('--tf-layer-expanded-border'),
            layerLabel:         g('--tf-layer-label'),
            ffnColor:           g('--tf-ffn-color'),
            ffnBg:              g('--tf-ffn-bg'),
            ffnBorder:          g('--tf-ffn-border'),
            lnColor:            g('--tf-ln-color'),
            lnBg:               g('--tf-ln-bg'),
            lnBorder:           g('--tf-ln-border')
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN VISUALIZER CLASS
    // ═══════════════════════════════════════════════════════════════════

    function TransformerViz() {
        this.container = d3.select('#tf-svg-container');
        this.embedDim = 64;
        this.numHeads = 4;
        this.temperature = 1.0;
        this.usePE = true;
        this.exIdx = 0;
        this.activeToken = 0;
        this.activeHead = 0;
        this.expandedChips = {};  // chipId -> true

        // Architecture mode: 'bert' | 'gpt2' | 'original'
        this.archMode = 'bert';
        // For original transformer: which attention block is active
        // 'enc' = encoder self-attn, 'dec' = decoder masked self-attn, 'cross' = cross-attn
        this.activeBlock = 'enc';
        // Active head per block (so switching blocks remembers head selection)
        this.activeHeadEnc = 0;
        this.activeHeadDec = 0;
        this.activeHeadCross = 0;
        // Target token (for decoder in original mode)
        this.activeTargetToken = 0;
        this.targetExIdx = 0;
        // Multi-layer state
        this.numLayers = 12;
        this.expandedLayerIdx = 0;
        // For Original transformer
        this.numEncLayers = 6;
        this.numDecLayers = 6;
        this.expandedEncLayerIdx = 0;
        this.expandedDecLayerIdx = -1;  // -1 = none

        // Expanded layer model and result
        this.expandedModel = null;
        this.expandedResult = null;
        this.embResult = null;
        // For original mode
        this.encEmbResult = null;
        this.decEmbResult = null;
        this.expandedEncModel = null;
        this.expandedEncResult = null;
        this.expandedDecModel = null;
        this.expandedDecResult = null;
        this.expandedDecCrossModel = null;
        this.expandedDecCrossResult = null;

        // Real data mode
        this.dataMode = 'synthetic';  // 'synthetic' | 'real'
        this.realDataCache = {};
        this.realData = null;
        this.isLoading = false;

        this.svg = this.container.append('svg')
            .attr('viewBox', '0 0 ' + CANVAS_W + ' 700')
            .attr('preserveAspectRatio', 'xMidYMid meet');

        this.bgRect = this.svg.append('rect')
            .attr('class', 'svg-bg')
            .attr('width', CANVAS_W)
            .attr('height', 700)
            .attr('fill', 'var(--tf-canvas-bg)');

        // SVG filter for glow
        var defs = this.svg.append('defs');
        var filterGlow = defs.append('filter')
            .attr('id', 'tf-chip-glow')
            .attr('x', '-50%').attr('y', '-50%')
            .attr('width', '200%').attr('height', '200%');
        filterGlow.append('feGaussianBlur')
            .attr('stdDeviation', '3')
            .attr('result', 'blur');
        filterGlow.append('feMerge')
            .selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .join('feMergeNode')
            .attr('in', function(d) { return d; });

        // Diagonal stripe pattern for masked cells
        var maskPattern = defs.append('pattern')
            .attr('id', 'tf-mask-stripe')
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 6).attr('height', 6)
            .attr('patternTransform', 'rotate(45)');
        maskPattern.append('rect')
            .attr('width', 6).attr('height', 6)
            .attr('fill', 'var(--tf-mask-bg)');
        maskPattern.append('line')
            .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
            .attr('stroke', 'var(--tf-mask-stripe)').attr('stroke-width', 2);

        // Arrow marker
        defs.append('marker')
            .attr('id', 'tf-arrowhead')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8).attr('refY', 5)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto-start-reverse')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', 'var(--tf-arrow-color)');

        // Zone groups
        this.gB = this.svg.append('g').attr('class', 'zone-main');
        this.gC = this.svg.append('g').attr('class', 'zone-overlay');

        this.rebuildModel();
        this.bindEvents();
        this.draw();
    }

    TransformerViz.prototype.rebuildModel = function () {
        var self = this;

        if (this.dataMode === 'real') {
            this.loadRealData(function () {
                self._rebuildModelFromRealData();
                self.draw();
            });
            return;
        }

        // Synthetic mode
        if (this.archMode === 'original') {
            var ed = EXAMPLES_ENC_DEC[this.exIdx];
            this.encEmbResult = computeTokenEmbeddings(ed.source, this.embedDim, 12345, this.usePE);
            this.decEmbResult = computeTokenEmbeddings(ed.target, this.embedDim, 12345 + 7777, this.usePE);
            var maxSrc = ed.source.length - 1;
            var maxTgt = ed.target.length - 1;
            if (this.activeToken > maxSrc) this.activeToken = maxSrc;
            if (this.activeTargetToken > maxTgt) this.activeTargetToken = maxTgt;
        } else {
            var tokens = EXAMPLES[this.exIdx].tokens;
            this.embResult = computeTokenEmbeddings(tokens, this.embedDim, 12345, this.usePE);
            var maxT = tokens.length - 1;
            if (this.activeToken > maxT) this.activeToken = maxT;
        }

        if (this.activeHead >= this.numHeads) this.activeHead = this.numHeads - 1;
        if (this.activeHeadEnc >= this.numHeads) this.activeHeadEnc = this.numHeads - 1;
        if (this.activeHeadDec >= this.numHeads) this.activeHeadDec = this.numHeads - 1;
        if (this.activeHeadCross >= this.numHeads) this.activeHeadCross = this.numHeads - 1;

        this.computeExpandedLayer();
        this.updateStepperDisplay();
    };

    TransformerViz.prototype._rebuildModelFromRealData = function () {
        var rd = this.realData;
        if (!rd) return;

        if (this.archMode === 'original') {
            // MarianMT
            this.numHeads = rd.num_heads;
            this.numEncLayers = rd.num_enc_layers;
            this.numDecLayers = rd.num_dec_layers;
            this.embedDim = rd.hidden_size;

            // Build fake token objects for compatibility
            var srcTokens = [];
            for (var i = 0; i < rd.source_tokens.length; i++) {
                srcTokens.push({ word: rd.source_tokens[i], id: i });
            }
            var tgtTokens = [];
            for (var j = 0; j < rd.target_tokens.length; j++) {
                tgtTokens.push({ word: rd.target_tokens[j], id: j });
            }

            // Store as fake example data
            this._realSrcTokens = srcTokens;
            this._realTgtTokens = tgtTokens;

            // Minimal embeddings (not real, but needed for structure)
            this.encEmbResult = { embeddings: [], pe: [], embedded: [] };
            this.decEmbResult = { embeddings: [], pe: [], embedded: [] };

            var maxSrc = srcTokens.length - 1;
            var maxTgt = tgtTokens.length - 1;
            if (this.activeToken > maxSrc) this.activeToken = maxSrc;
            if (this.activeTargetToken > maxTgt) this.activeTargetToken = maxTgt;

            // Clamp expanded layer indices
            if (this.expandedEncLayerIdx >= this.numEncLayers) this.expandedEncLayerIdx = this.numEncLayers - 1;
            if (this.expandedDecLayerIdx >= this.numDecLayers) this.expandedDecLayerIdx = this.numDecLayers - 1;
        } else {
            // BERT / GPT-2
            this.numHeads = rd.num_heads;
            this.numLayers = rd.num_layers;
            this.embedDim = rd.hidden_size;

            var tokens = [];
            for (var k = 0; k < rd.tokens.length; k++) {
                tokens.push({ word: rd.tokens[k], id: k });
            }
            this._realTokens = tokens;

            this.embResult = { embeddings: [], pe: [], embedded: [] };
            var maxT = tokens.length - 1;
            if (this.activeToken > maxT) this.activeToken = maxT;

            // Clamp expanded layer index
            if (this.expandedLayerIdx >= this.numLayers) this.expandedLayerIdx = this.numLayers - 1;
        }

        if (this.activeHead >= this.numHeads) this.activeHead = this.numHeads - 1;
        if (this.activeHeadEnc >= this.numHeads) this.activeHeadEnc = this.numHeads - 1;
        if (this.activeHeadDec >= this.numHeads) this.activeHeadDec = this.numHeads - 1;
        if (this.activeHeadCross >= this.numHeads) this.activeHeadCross = this.numHeads - 1;

        this.computeExpandedLayer();
        this.updateStepperDisplay();
    };

    // ─── Compute Only the Expanded Layer's Forward Pass ─────────────
    TransformerViz.prototype.computeExpandedLayer = function () {
        // Real data path
        if (this.dataMode === 'real' && this.realData) {
            this._computeExpandedLayerReal();
            return;
        }

        // Synthetic path
        if (this.archMode === 'original') {
            // Expanded encoder layer
            if (this.expandedEncLayerIdx >= 0 && this.encEmbResult) {
                var encModel = buildLayerModel(this.embedDim, this.numHeads, this.expandedEncLayerIdx, 'encoder');
                var encEmbedded = this.encEmbResult.embedded;
                var nSrc = encEmbedded.length;
                var encHeads = runAttentionHeads(encModel.heads, this.numHeads, encModel.headDim, encEmbedded, encEmbedded, nSrc, nSrc, this.temperature, false, 'bert');
                this.expandedEncModel = encModel;
                this.expandedEncResult = { heads: encHeads };
            } else {
                this.expandedEncModel = null;
                this.expandedEncResult = null;
            }

            // Expanded decoder layer
            if (this.expandedDecLayerIdx >= 0 && this.decEmbResult && this.encEmbResult) {
                var decModel = buildLayerModel(this.embedDim, this.numHeads, this.expandedDecLayerIdx, 'decoder');
                var decEmbedded = this.decEmbResult.embedded;
                var encEmbedded2 = this.encEmbResult.embedded;
                var nTgt = decEmbedded.length;
                var nSrc2 = encEmbedded2.length;

                // Masked self-attention
                var decHeads = runAttentionHeads(decModel.heads, this.numHeads, decModel.headDim, decEmbedded, decEmbedded, nTgt, nTgt, this.temperature, true, 'gpt2');
                this.expandedDecModel = decModel;
                this.expandedDecResult = { heads: decHeads };

                // Cross-attention
                var crossModel = buildLayerModel(this.embedDim, this.numHeads, this.expandedDecLayerIdx, 'cross');
                var crossHeads = runAttentionHeads(crossModel.heads, this.numHeads, crossModel.headDim, decEmbedded, encEmbedded2, nTgt, nSrc2, this.temperature, false, 'bert');
                this.expandedDecCrossModel = crossModel;
                this.expandedDecCrossResult = { heads: crossHeads };
            } else {
                this.expandedDecModel = null;
                this.expandedDecResult = null;
                this.expandedDecCrossModel = null;
                this.expandedDecCrossResult = null;
            }
        } else {
            // BERT/GPT-2: single stack
            if (this.embResult && this.expandedLayerIdx >= 0) {
                var model = buildLayerModel(this.embedDim, this.numHeads, this.expandedLayerIdx, 'encoder');
                var embedded = this.embResult.embedded;
                var n = embedded.length;
                var isCausal = this.archMode === 'gpt2';
                var heads = runAttentionHeads(model.heads, this.numHeads, model.headDim, embedded, embedded, n, n, this.temperature, isCausal, this.archMode);
                var concat = [];
                for (var i = 0; i < n; i++) {
                    var c = [];
                    for (var h = 0; h < this.numHeads; h++) {
                        c = c.concat(heads[h].output[i]);
                    }
                    concat.push(c);
                }
                this.expandedModel = model;
                this.expandedResult = { heads: heads, concat: concat };
            } else {
                this.expandedModel = null;
                this.expandedResult = null;
            }
        }
    };

    // ─── Compute Expanded Layer from Real Data ──────────────────────
    TransformerViz.prototype._computeExpandedLayerReal = function () {
        var rd = this.realData;
        var headDim = rd.head_dim;
        var numHeads = rd.num_heads;
        var hiddenSize = rd.hidden_size;

        if (this.archMode === 'original') {
            // MarianMT — encoder
            if (this.expandedEncLayerIdx >= 0 && rd.encoder_layers && this.expandedEncLayerIdx < rd.encoder_layers.length) {
                var encLayer = rd.encoder_layers[this.expandedEncLayerIdx];
                var encHeads = this._extractRealHeads(encLayer.heads, headDim);
                this.expandedEncModel = { headDim: headDim, numHeads: numHeads, embedDim: hiddenSize };
                this.expandedEncResult = { heads: encHeads };
            } else {
                this.expandedEncModel = null;
                this.expandedEncResult = null;
            }

            // MarianMT — decoder
            if (this.expandedDecLayerIdx >= 0 && rd.decoder_layers && this.expandedDecLayerIdx < rd.decoder_layers.length) {
                var decLayer = rd.decoder_layers[this.expandedDecLayerIdx];

                // Masked self-attention
                var decHeads = this._extractRealHeads(decLayer.heads, headDim);
                this.expandedDecModel = { headDim: headDim, numHeads: numHeads, embedDim: hiddenSize };
                this.expandedDecResult = { heads: decHeads };

                // Cross-attention
                var crossHeads = this._extractRealCrossHeads(decLayer.cross_attention_heads, headDim);
                this.expandedDecCrossModel = { headDim: headDim, numHeads: numHeads, embedDim: hiddenSize };
                this.expandedDecCrossResult = { heads: crossHeads };
            } else {
                this.expandedDecModel = null;
                this.expandedDecResult = null;
                this.expandedDecCrossModel = null;
                this.expandedDecCrossResult = null;
            }
        } else {
            // BERT / GPT-2
            if (this.expandedLayerIdx >= 0 && rd.layers && this.expandedLayerIdx < rd.layers.length) {
                var layer = rd.layers[this.expandedLayerIdx];
                var heads = this._extractRealHeads(layer.heads, headDim);

                // Build concat
                var nTokens = heads[0].Q.length;
                var concat = [];
                for (var i = 0; i < nTokens; i++) {
                    var c = [];
                    for (var h = 0; h < numHeads; h++) {
                        c = c.concat(heads[h].output[i]);
                    }
                    concat.push(c);
                }

                this.expandedModel = { headDim: headDim, numHeads: numHeads, embedDim: hiddenSize };
                this.expandedResult = { heads: heads, concat: concat };
            } else {
                this.expandedModel = null;
                this.expandedResult = null;
            }
        }
    };

    // Extract head data from real JSON into the format used by the visualization
    TransformerViz.prototype._extractRealHeads = function (jsonHeads, headDim) {
        var heads = [];
        for (var h = 0; h < jsonHeads.length; h++) {
            var jh = jsonHeads[h];
            // Reconstruct raw scores from Q and K: score[i][j] = dot(Q[i], K[j]) / sqrt(d_k)
            var nQ = jh.Q.length;
            var nK = jh.K.length;
            var scale = Math.sqrt(headDim);
            var scores = [];
            for (var i = 0; i < nQ; i++) {
                var row = [];
                for (var j = 0; j < nK; j++) {
                    row.push(dot(jh.Q[i], jh.K[j]) / scale);
                }
                scores.push(row);
            }
            heads.push({
                Q: jh.Q,
                K: jh.K,
                V: jh.V,
                scores: scores,
                weights: jh.attention_weights,
                output: jh.output
            });
        }
        return heads;
    };

    // Extract cross-attention heads (only Q and weights available, no K/V/output)
    TransformerViz.prototype._extractRealCrossHeads = function (jsonHeads, headDim) {
        var heads = [];
        for (var h = 0; h < jsonHeads.length; h++) {
            var jh = jsonHeads[h];
            var nQ = jh.Q.length;
            var nK = jh.attention_weights[0].length;
            // No K/V/output available; provide empty placeholders
            var emptyK = [];
            var emptyV = [];
            var emptyOutput = [];
            for (var j = 0; j < nK; j++) {
                var emptyVec = [];
                for (var d = 0; d < headDim; d++) emptyVec.push(0);
                emptyK.push(emptyVec);
                emptyV.push(emptyVec.slice());
            }
            for (var i = 0; i < nQ; i++) {
                var emptyOut = [];
                for (var d2 = 0; d2 < headDim; d2++) emptyOut.push(0);
                emptyOutput.push(emptyOut);
            }
            // Scores: not available, use zeros
            var scores = [];
            for (var i2 = 0; i2 < nQ; i2++) {
                var row = [];
                for (var j2 = 0; j2 < nK; j2++) row.push(0);
                scores.push(row);
            }
            heads.push({
                Q: jh.Q,
                K: emptyK,
                V: emptyV,
                scores: scores,
                weights: jh.attention_weights,
                output: emptyOutput
            });
        }
        return heads;
    };

    // ─── Main Draw (branches by architecture mode) ────────────────────
    TransformerViz.prototype.draw = function () {
        this.gB.selectAll('*').remove();
        this.gC.selectAll('*').remove();

        // Fade-in transition
        this.gB.attr('opacity', 0);

        if (this.archMode === 'original') {
            this.drawEncoderDecoder();
        } else {
            this.drawSingleStack();
        }

        this.gB.transition().duration(200).attr('opacity', 1);

        this.updateBadges();
        this.updateLegendVisibility();
        this.updateMathPanel();
    };

    // ─── Drawing Helpers (shared across modes) ──────────────────────

    TransformerViz.prototype.drawArrowDown = function (g, C, x, y1, y2) {
        g.append('line')
            .attr('x1', x).attr('y1', y1)
            .attr('x2', x).attr('y2', y2)
            .attr('stroke', C.arrowColor).attr('stroke-width', 1.5)
            .attr('marker-end', 'url(#tf-arrowhead)');
    };

    TransformerViz.prototype.drawElbowArrow = function (g, C, x1, y1, x2, y2) {
        var midY = (y1 + y2) / 2;
        g.append('path')
            .attr('d', 'M' + x1 + ',' + y1 + ' L' + x1 + ',' + midY + ' L' + x2 + ',' + midY + ' L' + x2 + ',' + y2)
            .attr('fill', 'none')
            .attr('stroke', C.arrowColor).attr('stroke-width', 1.5)
            .attr('marker-end', 'url(#tf-arrowhead)');
    };

    TransformerViz.prototype.makeChip = function (g, C, baseBg, chipX, chipY, chipW, chipH, chipDef, onClick) {
        var chipG = g.append('g')
            .attr('class', 'eq-chip' + (chipDef.active ? ' active' : ''));

        chipG.append('rect').attr('class', 'eq-chip-undercoat')
            .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
            .attr('rx', 4).attr('ry', 4)
            .attr('fill', baseBg);

        if (chipDef.bg) {
            chipG.append('rect').attr('class', 'eq-chip-bg')
                .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', chipDef.bg).attr('opacity', chipDef.active ? 0.25 : 0.12);
        }

        chipG.append('rect').attr('class', 'eq-chip-border')
            .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
            .attr('rx', 4).attr('ry', 4)
            .attr('fill', 'none')
            .attr('stroke', chipDef.border || chipDef.color)
            .attr('stroke-width', chipDef.active ? 2.5 : 1.5);

        if (chipDef.label) {
            chipG.append('text')
                .attr('x', chipX + chipW / 2)
                .attr('y', chipY + chipH / 2 - (chipDef.dimText ? 4 : 0))
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-family', SERIF)
                .attr('font-style', 'italic')
                .attr('font-weight', 700)
                .attr('font-size', 13)
                .attr('fill', chipDef.color)
                .text(chipDef.label);
        }

        if (chipDef.dimText) {
            chipG.append('text')
                .attr('x', chipX + chipW / 2)
                .attr('y', chipY + chipH / 2 + 9)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-family', MONO)
                .attr('font-size', 8)
                .attr('fill', C.textMuted)
                .attr('opacity', 0.8)
                .text(chipDef.dimText);
        }

        if (onClick) {
            chipG.attr('cursor', 'pointer')
                .on('click', function () { onClick(); });
        }

        return chipG;
    };

    TransformerViz.prototype.drawHeatmapGrid = function (g, C, mx, my, data, rows, cols, cellW, cellH) {
        var minVal = Infinity, maxVal = -Infinity;
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < cols; j++) {
                var v = data[i][j];
                if (v < minVal) minVal = v;
                if (v > maxVal) maxVal = v;
            }
        }
        var absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
        for (var i = 0; i < rows; i++) {
            for (var j = 0; j < cols; j++) {
                var cx = mx + j * cellW;
                var cy = my + i * cellH;
                var v = data[i][j];
                var t = (v / absMax + 1) / 2;
                var fillColor = interpolateHeatColor(t, C.heatCool, C.heatMid, C.heatWarm);
                var cellRect = g.append('rect')
                    .attr('x', cx).attr('y', cy)
                    .attr('width', cellW - 0.5).attr('height', cellH - 0.5)
                    .attr('fill', fillColor);
                cellRect.append('title').text('[' + i + ',' + j + '] = ' + v.toFixed(4));
            }
        }
    };

    // Generalized attention heatmap: supports rectangular grids and causal masking
    // rowTokens/colTokens: token arrays for row/col headers
    // activeRow/activeCol: highlighted indices (-1 to skip)
    // causalMask: if true, cells where col > row get stripe pattern
    TransformerViz.prototype.drawAttentionHeatmap = function (g, C, mx, my, weights, cellSize, rowTokens, colTokens, activeRow, activeCol, causalMask) {
        var nRows = rowTokens.length;
        var nCols = colTokens.length;

        // Column headers
        for (var j = 0; j < nCols; j++) {
            g.append('text')
                .attr('x', mx + (j + 1.5) * cellSize)
                .attr('y', my + cellSize * 0.6)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', Math.min(9, cellSize * 0.45))
                .attr('fill', j === activeCol ? C.headColor : C.textMuted)
                .attr('font-weight', j === activeCol ? 700 : 400)
                .text(displayWord(colTokens[j].word).substring(0, 4));
        }

        // Row headers + cells
        for (var i = 0; i < nRows; i++) {
            g.append('text')
                .attr('x', mx + cellSize * 0.8)
                .attr('y', my + (i + 1.5) * cellSize)
                .attr('text-anchor', 'end')
                .attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', Math.min(9, cellSize * 0.45))
                .attr('fill', i === activeRow ? C.headColor : C.textMuted)
                .attr('font-weight', i === activeRow ? 700 : 400)
                .text(displayWord(rowTokens[i].word).substring(0, 4));

            for (var j = 0; j < nCols; j++) {
                var isMasked = causalMask && j > i;
                var w = weights[i][j];
                var cx = mx + (j + 1) * cellSize;
                var cy = my + (i + 1) * cellSize;

                var cellG = g.append('g');

                var rowWord = displayWord(rowTokens[i].word);
                var colWord = displayWord(colTokens[j].word);

                if (isMasked) {
                    // Masked cell: diagonal stripe pattern
                    cellG.append('rect')
                        .attr('x', cx + 0.5).attr('y', cy + 0.5)
                        .attr('width', cellSize - 1).attr('height', cellSize - 1)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', 'url(#tf-mask-stripe)')
                        .attr('stroke', C.maskColor)
                        .attr('stroke-width', 0.5)
                        .attr('stroke-opacity', 0.3);
                    cellG.append('title').text('"' + rowWord + '" \u2192 "' + colWord + '": masked');
                } else {
                    var fillColor = interpolateHeatColor(w, C.heatCool, C.heatMid, C.heatWarm);
                    cellG.append('rect')
                        .attr('x', cx + 0.5).attr('y', cy + 0.5)
                        .attr('width', cellSize - 1).attr('height', cellSize - 1)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', fillColor)
                        .attr('stroke', (i === activeRow || j === activeCol) ? C.headColor : 'none')
                        .attr('stroke-width', 1)
                        .attr('stroke-opacity', 0.4);

                    if (cellSize >= 22) {
                        cellG.append('text')
                            .attr('x', cx + cellSize / 2)
                            .attr('y', cy + cellSize / 2)
                            .attr('text-anchor', 'middle')
                            .attr('dominant-baseline', 'central')
                            .attr('font-family', MONO)
                            .attr('font-size', Math.min(8, cellSize * 0.33))
                            .attr('fill', w > 0.5 ? EAIColor('surface') : C.text)
                            .text(w.toFixed(2));
                    }
                    cellG.append('title').text('"' + rowWord + '" \u2192 "' + colWord + '": ' + w.toFixed(4));
                }
            }
        }
    };

    // ─── Legend Visibility ───────────────────────────────────────────
    TransformerViz.prototype.updateLegendVisibility = function () {
        var showMask = this.archMode === 'gpt2' || this.archMode === 'original';
        var showCross = this.archMode === 'original';
        // Hide/show the parent legend-item span
        document.querySelectorAll('.tf-legend-mask').forEach(function (el) {
            var parent = el.closest('.legend-item');
            if (parent) parent.style.display = showMask ? '' : 'none';
        });
        document.querySelectorAll('.tf-legend-cross').forEach(function (el) {
            var parent = el.closest('.legend-item');
            if (parent) parent.style.display = showCross ? '' : 'none';
        });
    };

    // ─── Collapsed Layer Block ──────────────────────────────────────
    TransformerViz.prototype.drawCollapsedLayer = function (g, C, baseBg, y, layerIdx, totalLayers, layerType, onClick) {
        var leftPad = 20, rightPad = 20;
        var blockX = leftPad + 10;
        var blockW = CANVAS_W - leftPad - rightPad - 20;
        var blockH = 36;
        var centerX = CANVAS_W / 2;

        var layerG = g.append('g').attr('class', 'tf-layer-collapsed').attr('cursor', 'pointer');
        layerG.append('title').text('Click to expand Layer ' + (layerIdx + 1) + ': ' + layerType);

        layerG.append('rect')
            .attr('x', blockX).attr('y', y)
            .attr('width', blockW).attr('height', blockH)
            .attr('rx', 4).attr('ry', 4)
            .attr('fill', baseBg)
            .attr('stroke', C.layerBorder)
            .attr('stroke-width', 1.5);

        // Layer label
        layerG.append('text')
            .attr('x', blockX + 12).attr('y', y + blockH / 2)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 10).attr('font-weight', 600)
            .attr('fill', C.layerLabel)
            .text('Layer ' + (layerIdx + 1) + '/' + totalLayers);

        // Type indicator
        layerG.append('text')
            .attr('x', centerX).attr('y', y + blockH / 2)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10)
            .attr('fill', C.textMuted)
            .text(layerType);

        // Expand icon
        layerG.append('text')
            .attr('x', blockX + blockW - 12).attr('y', y + blockH / 2)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 12)
            .attr('fill', C.textMuted)
            .text('\u25B6');

        if (onClick) {
            layerG.on('click', function () { onClick(layerIdx); });
        }

        return y + blockH;
    };

    // ─── Input Embedding Section ────────────────────────────────────
    TransformerViz.prototype.drawInputEmbedding = function (g, C, baseBg, startY, tokens, embResult) {
        var self = this;
        var N = tokens.length;
        var leftPad = 20, rightPad = 20;
        var availW = CANVAS_W - leftPad - rightPad;
        var centerX = CANVAS_W / 2;

        var cardGap = 6;
        var cardW = Math.min(80, (availW * 0.55 - (N - 1) * cardGap) / N);
        var cardH = 50;
        var totalCardsW = N * cardW + (N - 1) * cardGap;
        var embedRowH = 22;
        var embedRowGap = 4;
        var embedBlockW = totalCardsW;
        var embedBlockH = N * (embedRowH + embedRowGap) - embedRowGap + 16;

        var sideBySideGap = 16;
        var totalSideBySideW = totalCardsW + sideBySideGap + embedBlockW;
        if (totalSideBySideW > availW) {
            var scale = availW / totalSideBySideW;
            cardW *= scale;
            totalCardsW = N * cardW + (N - 1) * cardGap;
            embedBlockW = totalCardsW;
            totalSideBySideW = totalCardsW + sideBySideGap + embedBlockW;
        }
        var tokBlockX = centerX - totalSideBySideW / 2;
        var embedBlockX = tokBlockX + totalCardsW + sideBySideGap;

        var y = startY;

        // Tokenization label
        g.append('text')
            .attr('x', tokBlockX + totalCardsW / 2)
            .attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic')
            .attr('font-size', 12).attr('font-weight', 700)
            .attr('fill', C.embedColor)
            .text('Tokenization');

        var cardsY = y + 16;

        // Token cards
        for (var i = 0; i < N; i++) {
            var cx = tokBlockX + i * (cardW + cardGap);
            var cy = cardsY;
            var isActive = (i === this.activeToken);
            var tokColor = getTokenClassColor(i);
            var isSpecial = isSpecialToken(tokens[i].word);
            var cardOpacity = isSpecial ? 0.5 : 1.0;

            var cardG = g.append('g').attr('class', 'token-card-group');
            if (isSpecial) cardG.attr('opacity', cardOpacity);
            cardG.append('title').text('Token ' + i + ': "' + tokens[i].word.trim() + '" (id ' + tokens[i].id + ')');
            cardG.append('rect')
                .attr('x', cx).attr('y', cy)
                .attr('width', cardW).attr('height', cardH)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', tokenColorBgOpaque(tokColor, isActive ? 0.25 : 0.12, baseBg))
                .attr('stroke', isActive ? tokColor : tokenColorBorder(tokColor, 0.4))
                .attr('stroke-width', isActive ? 2.5 : 1.5);

            cardG.append('text')
                .attr('x', cx + cardW / 2).attr('y', cy + 10)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 8)
                .attr('fill', C.textMuted)
                .text('t=' + i);

            cardG.append('text')
                .attr('x', cx + cardW / 2).attr('y', cy + 24)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SERIF).attr('font-size', 11).attr('font-weight', 600)
                .attr('fill', isSpecial ? C.textMuted : C.text)
                .text(displayWord(tokens[i].word));

            cardG.append('text')
                .attr('x', cx + cardW / 2).attr('y', cy + 39)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 8)
                .attr('fill', C.textMuted)
                .text('[' + tokens[i].id + ']');

            (function (idx) {
                cardG.on('click', function () {
                    self.activeToken = idx;
                    self.updateStepperDisplay();
                    self.draw();
                    self.updateMathPanel();
                });
            })(i);
        }

        // Dim label under tokens
        g.append('text')
            .attr('x', tokBlockX + totalCardsW / 2)
            .attr('y', cardsY + cardH + 8)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 8)
            .attr('fill', C.textMuted).attr('opacity', 0.7)
            .text('<1, ' + N + '>');

        // Embedding block label
        g.append('text')
            .attr('x', embedBlockX + embedBlockW / 2)
            .attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic')
            .attr('font-size', 12).attr('font-weight', 700)
            .attr('fill', C.embedColor)
            .text(this.usePE ? 'Embedding + PE' : 'Embedding');

        var embedStartY = y + 16;

        // Embedding block border
        g.append('rect')
            .attr('x', embedBlockX - 4).attr('y', embedStartY - 4)
            .attr('width', embedBlockW + 8).attr('height', embedBlockH + 4)
            .attr('rx', 4).attr('ry', 4)
            .attr('fill', 'none')
            .attr('stroke', C.embedBorder).attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,3');

        // Embedding rows
        for (var i = 0; i < N; i++) {
            var ey = embedStartY + i * (embedRowH + embedRowGap);
            var isActive2 = (i === this.activeToken);
            var tokColor2 = getTokenClassColor(i);

            var idBoxW = 40;
            g.append('rect')
                .attr('x', embedBlockX).attr('y', ey)
                .attr('width', idBoxW).attr('height', embedRowH)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', tokenColorBgOpaque(tokColor2, isActive2 ? 0.3 : 0.12, baseBg))
                .attr('stroke', isActive2 ? tokColor2 : tokenColorBorder(tokColor2, 0.35))
                .attr('stroke-width', isActive2 ? 2 : 1);

            g.append('text')
                .attr('x', embedBlockX + idBoxW / 2).attr('y', ey + embedRowH / 2)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 7.5)
                .attr('fill', C.text)
                .text('[' + tokens[i].id + ']');

            var barX = embedBlockX + idBoxW + 4;
            var barW = embedBlockW - idBoxW - 4;
            g.append('rect')
                .attr('x', barX).attr('y', ey)
                .attr('width', barW).attr('height', embedRowH)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', tokenColorBgOpaque(tokColor2, isActive2 ? 0.2 : 0.07, baseBg))
                .attr('stroke', isActive2 ? tokColor2 : tokenColorBorder(tokColor2, 0.2))
                .attr('stroke-width', isActive2 ? 1.5 : 0.5);

            g.append('text')
                .attr('x', barX + barW / 2).attr('y', ey + embedRowH / 2)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 7)
                .attr('fill', C.textMuted)
                .text('<1, ' + this.embedDim + '>');
        }

        // Dim label under embedding
        g.append('text')
            .attr('x', embedBlockX + embedBlockW / 2)
            .attr('y', embedStartY + embedBlockH + 4)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 8)
            .attr('fill', C.textMuted).attr('opacity', 0.7)
            .text('<' + N + ', ' + this.embedDim + '>');

        // PE heatmap (compact sinusoidal pattern visualization)
        var peHeatmapH = 0;
        if (this.usePE && embResult && embResult.pe) {
            var peShowDims = Math.min(8, this.embedDim);
            var peCellW = Math.min(12, embedBlockW / peShowDims);
            var peCellH = Math.min(10, 80 / N);
            var peGridW = peShowDims * peCellW;
            var peGridH = N * peCellH;
            var peGridX = embedBlockX + embedBlockW / 2 - peGridW / 2;
            var peGridY = embedStartY + embedBlockH + 16;

            g.append('text')
                .attr('x', embedBlockX + embedBlockW / 2)
                .attr('y', peGridY - 4)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'auto')
                .attr('font-family', MONO).attr('font-size', 7)
                .attr('fill', C.embedColor).attr('opacity', 0.8)
                .text('PE Matrix');

            // Draw PE heatmap cells
            for (var pi = 0; pi < N; pi++) {
                for (var pj = 0; pj < peShowDims; pj++) {
                    var peVal = embResult.pe[pi][pj];
                    var t = (peVal + 1) / 2; // normalize -1..1 to 0..1
                    var fillColor = interpolateHeatColor(t, C.heatCool, C.heatMid, C.heatWarm);
                    g.append('rect')
                        .attr('x', peGridX + pj * peCellW)
                        .attr('y', peGridY + pi * peCellH)
                        .attr('width', peCellW - 0.5).attr('height', peCellH - 0.5)
                        .attr('fill', fillColor)
                        .attr('rx', 1);
                }
            }

            // Dim labels along top
            for (var dk = 0; dk < peShowDims; dk++) {
                g.append('text')
                    .attr('x', peGridX + dk * peCellW + peCellW / 2)
                    .attr('y', peGridY + peGridH + 6)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                    .attr('font-family', MONO).attr('font-size', 5.5)
                    .attr('fill', C.textMuted)
                    .text(dk);
            }
            peHeatmapH = peGridH + 18;
        }

        // Elbow arrow from tokens to embedding
        var tokCenterX = tokBlockX + totalCardsW / 2;
        var embedCenterX = embedBlockX + embedBlockW / 2;
        self.drawElbowArrow(g, C, tokCenterX, cardsY + cardH + 18, embedCenterX, embedStartY - 4);

        var stage1H = Math.max(cardH + 20, embedBlockH + peHeatmapH) + 18;
        return y + stage1H + 14; // +14 for bottom padding
    };

    // ─── Expanded Layer Internals (Q/K/V → Head → Concat) ──────────
    TransformerViz.prototype.drawExpandedLayer = function (g, C, baseBg, startY, tokens, isCausal, layerIdx, totalLayers) {
        var self = this;
        var N = tokens.length;
        var headColors = getHeadColors();
        var et = this.expandedChips;
        var leftPad = 20, rightPad = 20;
        var availW = CANVAS_W - leftPad - rightPad;
        var centerX = CANVAS_W / 2;
        var result = this.expandedResult;
        var model = this.expandedModel;
        if (!result || !model) return startY + 40;

        var containerX = leftPad + 6;
        var containerW = CANVAS_W - leftPad - rightPad - 12;
        var arrowH = 20;

        // Container border (placeholder — height updated at end)
        var borderRect = g.append('rect')
            .attr('x', containerX).attr('y', startY)
            .attr('width', containerW).attr('height', 100)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', baseBg)
            .attr('stroke', C.layerExpandedBorder)
            .attr('stroke-width', 2);

        // Header
        var headerY = startY + 4;
        g.append('text')
            .attr('x', containerX + 12).attr('y', headerY + 10)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 10).attr('font-weight', 700)
            .attr('fill', C.layerExpandedBorder)
            .text('Layer ' + (layerIdx + 1) + '/' + totalLayers);

        g.append('text')
            .attr('x', centerX).attr('y', headerY + 10)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10)
            .attr('fill', C.text)
            .text(isCausal ? 'Causal Self-Attention' : 'Self-Attention');

        // Collapse icon (clickable)
        var collapseG = g.append('g').attr('cursor', 'pointer');
        collapseG.append('text')
            .attr('x', containerX + containerW - 12).attr('y', headerY + 10)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 12)
            .attr('fill', C.textMuted)
            .text('\u25BC');
        collapseG.on('click', function () {
            self.expandedLayerIdx = -1;
            self.expandedChips = {};
            self.computeExpandedLayer();
            self.draw();
        });

        var y = headerY + 24;

        // ─── Pre-LayerNorm (GPT-2 style) ───
        if (isCausal) {
            y = this.drawLayerNorm(g, C, y, 'LayerNorm');
            y += 6;
        }

        // ─── Q/K/V Projection chips ───
        var chipH = 36;
        var chipGap = 14;
        var projChipW = 70;
        var projRowW = 3 * projChipW + 2 * chipGap;
        var projRowX = centerX - projRowW / 2;

        g.append('text')
            .attr('x', centerX).attr('y', y - 2)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'auto')
            .attr('font-family', SERIF).attr('font-style', 'italic')
            .attr('font-size', 11).attr('font-weight', 700)
            .attr('fill', C.scaleLabel)
            .text('Q / K / V Projection');

        var projChips = [
            { id: 'projQ', label: 'E\u00b7W_Q', color: C.qText, bg: C.qBg, border: C.qBorder,
              dimText: '<' + N + ', ' + model.headDim + '>' },
            { id: 'projK', label: 'E\u00b7W_K', color: C.kText, bg: C.kBg, border: C.kBorder,
              dimText: '<' + N + ', ' + model.headDim + '>' },
            { id: 'projV', label: 'E\u00b7W_V', color: C.vText, bg: C.vBg, border: C.vBorder,
              dimText: '<' + N + ', ' + model.headDim + '>' }
        ];

        var matCellW = 8, matCellH = 8;
        var projMatExpanded = et.projQ || et.projK || et.projV;

        for (var ci = 0; ci < 3; ci++) {
            var chipDef = projChips[ci];
            chipDef.active = !!et[chipDef.id];
            var cx = projRowX + ci * (projChipW + chipGap);

            var chipClickFn = (function (chipId) {
                return function () {
                    self.expandedChips[chipId] = !self.expandedChips[chipId];
                    self.draw();
                    self.updateMathPanel();
                };
            })(chipDef.id);

            self.makeChip(g, C, baseBg, cx, y, projChipW, chipH, chipDef, chipClickFn);

            if (et[chipDef.id]) {
                var matY = y + chipH + 6;
                var headData = result.heads[this.activeHead];
                var matData;
                if (chipDef.id === 'projQ') matData = headData.Q;
                else if (chipDef.id === 'projK') matData = headData.K;
                else matData = headData.V;

                var showRows = Math.min(N, 8);
                var showCols = Math.min(model.headDim, 16);
                var truncData = [];
                for (var ri = 0; ri < showRows; ri++) {
                    truncData.push(matData[ri].slice(0, showCols));
                }

                var mW = showCols * matCellW;
                var mH = showRows * matCellH;
                var matX = cx + projChipW / 2 - mW / 2;

                g.append('rect')
                    .attr('x', matX - 2).attr('y', matY - 2)
                    .attr('width', mW + 4).attr('height', mH + 4)
                    .attr('rx', 2).attr('ry', 2)
                    .attr('fill', 'none')
                    .attr('stroke', chipDef.border).attr('stroke-width', 1)
                    .attr('stroke-opacity', 0.4);

                self.drawHeatmapGrid(g, C, matX, matY, truncData, showRows, showCols, matCellW, matCellH);

                if (this.activeToken < showRows) {
                    g.append('rect')
                        .attr('x', matX - 1)
                        .attr('y', matY + this.activeToken * matCellH - 0.5)
                        .attr('width', mW + 2)
                        .attr('height', matCellH + 1)
                        .attr('fill', 'none')
                        .attr('stroke', chipDef.color)
                        .attr('stroke-width', 1.5)
                        .attr('rx', 1);
                }
            }
        }

        var projStageH = chipH + 12;
        if (projMatExpanded) {
            var expandedMatH = Math.min(N, 8) * matCellH + 4;
            projStageH = chipH + 8 + expandedMatH + 16;
        }
        y += projStageH;

        // Branching arrows from Q/K/V to head box
        for (var ci2 = 0; ci2 < 3; ci2++) {
            var chipCX = projRowX + ci2 * (projChipW + chipGap) + projChipW / 2;
            self.drawArrowDown(g, C, chipCX, y, y + arrowH - 2);
        }
        y += arrowH;

        // ─── Head Box ───
        var headBoxW = Math.min(availW * 0.85, 420);
        var headBoxX = centerX - headBoxW / 2;
        var heatCellSize = Math.min(28, (headBoxW - 120) / (N + 1));
        var headColor = headColors[this.activeHead % headColors.length];

        var eqLabelH = 18;
        var headBoxInnerH = eqLabelH + 8;
        if (et.heatmap) {
            headBoxInnerH += (N + 1) * heatCellSize + 12;
        }
        var headBoxH = headBoxInnerH + 24;

        g.append('rect')
            .attr('x', headBoxX).attr('y', y)
            .attr('width', headBoxW).attr('height', headBoxH)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', baseBg)
            .attr('stroke', headColor)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '6,3');

        g.append('text')
            .attr('x', headBoxX + 10).attr('y', y + 14)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 10).attr('font-weight', 700)
            .attr('fill', headColor)
            .text('Head ' + this.activeHead + ' / ' + this.numHeads);

        g.append('text')
            .attr('x', centerX).attr('y', y + 14)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', SERIF).attr('font-style', 'italic')
            .attr('font-size', 11).attr('font-weight', 600)
            .attr('fill', C.text)
            .text('softmax(Q\u00b7K\u1d40 / \u221Ad\u2096) \u00b7 V');

        var heatmapChipY = y + 26;
        var heatmapToggle = {
            label: et.heatmap ? 'Attention Weights \u25BC' : 'Attention Weights \u25B6',
            color: headColor, border: headColor, bg: C.headBg,
            active: !!et.heatmap
        };
        self.makeChip(g, C, baseBg, centerX - 80, heatmapChipY, 160, 20, heatmapToggle, function () {
            self.expandedChips.heatmap = !self.expandedChips.heatmap;
            self.draw();
            self.updateMathPanel();
        });

        if (et.heatmap) {
            var headData2 = result.heads[this.activeHead];
            var hmY = heatmapChipY + 26;
            var hmX = centerX - (N + 1) * heatCellSize / 2;
            self.drawAttentionHeatmap(g, C, hmX, hmY, headData2.weights, heatCellSize, tokens, tokens, this.activeToken, this.activeToken, isCausal);
        }

        y += headBoxH;

        // Arrow to concat
        self.drawArrowDown(g, C, centerX, y, y + arrowH - 2);
        y += arrowH;

        // ─── Concat + W_O + Residual ───
        var concatDotSize = 16;
        var concatGap = 4;
        var concatRowW = this.numHeads * (concatDotSize + concatGap) - concatGap;
        var woChipW = 50;
        var resChipW = 40;

        g.append('text')
            .attr('x', centerX - concatRowW / 2 - 40)
            .attr('y', y + concatDotSize / 2)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('font-family', SERIF).attr('font-style', 'italic')
            .attr('font-size', 10).attr('font-weight', 600)
            .attr('fill', C.textMuted)
            .text('Concat');

        var concatStartX = centerX - concatRowW / 2;
        for (var h = 0; h < this.numHeads; h++) {
            var sqX = concatStartX + h * (concatDotSize + concatGap);
            var sqY = y;
            var hColor = headColors[h % headColors.length];
            var isActiveHead = (h === this.activeHead);

            var sqG = g.append('g').attr('class', 'head-square');
            sqG.append('title').text('Head ' + h + (isActiveHead ? ' (active)' : '') + ' — click to switch');
            sqG.append('rect')
                .attr('x', sqX).attr('y', sqY)
                .attr('width', concatDotSize).attr('height', concatDotSize)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', isActiveHead ? hColor : tokenColorBgOpaque(hColor, 0.2, baseBg))
                .attr('stroke', hColor)
                .attr('stroke-width', isActiveHead ? 2.5 : 1);

            if (isActiveHead) {
                sqG.append('text')
                    .attr('x', sqX + concatDotSize / 2)
                    .attr('y', sqY + concatDotSize / 2)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', 7).attr('font-weight', 700)
                    .attr('fill', EAIColor('surface'))
                    .text(h);
            }

            (function (headIdx) {
                sqG.on('click', function () {
                    self.activeHead = headIdx;
                    self.draw();
                    self.updateMathPanel();
                });
            })(h);
        }

        var woX = concatStartX + concatRowW + 16;
        self.makeChip(g, C, baseBg, woX, y - 2, woChipW, concatDotSize + 4, {
            label: 'W_O', color: C.woColor, border: C.woColor, dimText: null, bg: null
        });

        var resX = woX + woChipW + 8;
        self.makeChip(g, C, baseBg, resX, y - 2, resChipW, concatDotSize + 4, {
            label: '+ E', color: C.residualColor, border: C.residualColor, dimText: null, bg: null
        });

        g.append('text')
            .attr('x', centerX)
            .attr('y', y + concatDotSize + 8)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 8)
            .attr('fill', C.textMuted).attr('opacity', 0.7)
            .text('<' + N + ', ' + this.embedDim + '>');

        y += concatDotSize + 22;

        // ─── LayerNorm (post-attention) ───
        var isPreNorm = this.archMode === 'gpt2';
        if (!isPreNorm) {
            y = this.drawLayerNorm(g, C, y, 'Add & Norm');
            y += 6;
        }

        // ─── FFN Block ───
        var arrowH2 = 16;
        self.drawArrowDown(g, C, centerX, y, y + arrowH2 - 2);
        y += arrowH2;
        y = this.drawFFNBlock(g, C, baseBg, y, N);
        y += 6;

        // ─── LayerNorm (post-FFN) ───
        y = this.drawLayerNorm(g, C, y, isPreNorm ? 'Add' : 'Add & Norm');
        y += 6;

        // Update container border height
        borderRect.attr('height', y - startY + 4);
        y += 4;

        return y;
    };

    // ─── Output Projection ──────────────────────────────────────────
    TransformerViz.prototype.drawOutputProjection = function (g, C, baseBg, y, tokens) {
        var self = this;
        var N = tokens.length;
        var centerX = CANVAS_W / 2;
        var et = this.expandedChips;
        var outputChipH = 30;

        var cardGap = 6;
        var leftPad = 20, rightPad = 20;
        var availW = CANVAS_W - leftPad - rightPad;
        var cardW = Math.min(80, (availW * 0.55 - (N - 1) * cardGap) / N);
        var totalCardsW = N * cardW + (N - 1) * cardGap;
        var embedRowH = 22;
        var embedRowGap = 4;

        var outputChipDef = {
            label: et.output ? 'Output Embedding \u25BC' : 'Output Embedding \u25B6',
            color: C.outputColor,
            border: C.outputBorder,
            bg: C.outputBg,
            active: !!et.output,
            dimText: '<' + N + ', ' + this.embedDim + '>'
        };

        if (!et.output) {
            var outChipW = 180;
            self.makeChip(g, C, baseBg, centerX - outChipW / 2, y, outChipW, outputChipH, outputChipDef, function () {
                self.expandedChips.output = !self.expandedChips.output;
                self.draw();
                self.updateMathPanel();
            });
            return y + outputChipH + 16;
        } else {
            var outBlockW = totalCardsW + 40;
            var outBlockX = centerX - outBlockW / 2;
            var outBlockY = y;

            var collapseGrp = g.append('g').attr('cursor', 'pointer');
            collapseGrp.append('text')
                .attr('x', centerX).attr('y', outBlockY)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                .attr('font-family', SERIF).attr('font-style', 'italic')
                .attr('font-size', 11).attr('font-weight', 700)
                .attr('fill', C.outputColor)
                .text('Output Embedding \u25BC');
            collapseGrp.on('click', function () {
                self.expandedChips.output = false;
                self.draw();
                self.updateMathPanel();
            });

            var outRowStartY = outBlockY + 16;

            g.append('rect')
                .attr('x', outBlockX - 4).attr('y', outRowStartY - 4)
                .attr('width', outBlockW + 8)
                .attr('height', N * (embedRowH + embedRowGap) - embedRowGap + 8)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', 'none')
                .attr('stroke', C.outputBorder).attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '4,3');

            for (var i = 0; i < N; i++) {
                var oy = outRowStartY + i * (embedRowH + embedRowGap);
                var isActive = (i === this.activeToken);
                var tokColor = getTokenClassColor(i);

                g.append('text')
                    .attr('x', outBlockX + 4).attr('y', oy + embedRowH / 2)
                    .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', 8)
                    .attr('fill', isActive ? tokColor : C.textMuted)
                    .attr('font-weight', isActive ? 700 : 400)
                    .text(displayWord(tokens[i].word));

                var oBarX = outBlockX + 50;
                var oBarW = outBlockW - 50;
                g.append('rect')
                    .attr('x', oBarX).attr('y', oy)
                    .attr('width', oBarW).attr('height', embedRowH)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', tokenColorBgOpaque(tokColor, isActive ? 0.2 : 0.07, baseBg))
                    .attr('stroke', isActive ? tokColor : tokenColorBorder(tokColor, 0.2))
                    .attr('stroke-width', isActive ? 1.5 : 0.5);

                g.append('text')
                    .attr('x', oBarX + oBarW / 2).attr('y', oy + embedRowH / 2)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', 7)
                    .attr('fill', C.textMuted)
                    .text('<1, ' + this.embedDim + '>');
            }

            g.append('text')
                .attr('x', centerX)
                .attr('y', outRowStartY + N * (embedRowH + embedRowGap) + 4)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                .attr('font-family', MONO).attr('font-size', 8)
                .attr('fill', C.textMuted).attr('opacity', 0.7)
                .text('<' + N + ', ' + this.embedDim + '>');

            return outRowStartY + N * (embedRowH + embedRowGap) + 20;
        }
    };

    // ─── LayerNorm Bar ─────────────────────────────────────────────────
    TransformerViz.prototype.drawLayerNorm = function (g, C, y, label) {
        var leftPad = 20, rightPad = 20;
        var blockX = leftPad + 16;
        var blockW = CANVAS_W - leftPad - rightPad - 32;
        var blockH = 16;

        g.append('rect')
            .attr('x', blockX).attr('y', y)
            .attr('width', blockW).attr('height', blockH)
            .attr('rx', 3).attr('ry', 3)
            .attr('fill', C.lnBg)
            .attr('stroke', C.lnBorder)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,2');

        g.append('text')
            .attr('x', CANVAS_W / 2).attr('y', y + blockH / 2)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 8).attr('font-weight', 600)
            .attr('fill', C.lnColor)
            .text(label || 'LayerNorm');

        return y + blockH;
    };

    // ─── FFN Block ─────────────────────────────────────────────────────
    TransformerViz.prototype.drawFFNBlock = function (g, C, baseBg, y, N) {
        var self = this;
        var leftPad = 20, rightPad = 20;
        var blockX = leftPad + 16;
        var blockW = CANVAS_W - leftPad - rightPad - 32;
        var centerX = CANVAS_W / 2;
        var et = this.expandedChips;
        var expanded = !!et.ffn;
        var d = this.embedDim;
        var d4 = d * 4;

        if (!expanded) {
            // Collapsed FFN: slim bar
            var barH = 28;
            var ffnG = g.append('g').attr('cursor', 'pointer');
            ffnG.append('rect')
                .attr('x', blockX).attr('y', y)
                .attr('width', blockW).attr('height', barH)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', C.ffnBg)
                .attr('stroke', C.ffnBorder)
                .attr('stroke-width', 1.5);
            ffnG.append('text')
                .attr('x', centerX).attr('y', y + barH / 2 - 4)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SERIF).attr('font-style', 'italic')
                .attr('font-size', 10).attr('font-weight', 600)
                .attr('fill', C.ffnColor)
                .text('FFN (Linear \u2192 ReLU \u2192 Linear) \u25B6');
            ffnG.append('text')
                .attr('x', centerX).attr('y', y + barH / 2 + 7)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 7)
                .attr('fill', C.textMuted)
                .text('<' + N + ', ' + d + '> \u2192 <' + N + ', ' + d4 + '> \u2192 <' + N + ', ' + d + '>');
            ffnG.on('click', function () {
                self.expandedChips.ffn = true;
                self.draw();
            });
            return y + barH;
        } else {
            // Expanded FFN: three sub-blocks with arrows
            var subH = 28;
            var arrowH = 14;
            var subGap = 4;
            var subW = Math.min(120, blockW * 0.3);
            var totalH = subH * 3 + arrowH * 2 + subGap * 2 + 24;

            var borderRect = g.append('rect')
                .attr('x', blockX).attr('y', y)
                .attr('width', blockW).attr('height', totalH)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', baseBg)
                .attr('stroke', C.ffnBorder)
                .attr('stroke-width', 2);

            // Header
            var collapseG = g.append('g').attr('cursor', 'pointer');
            collapseG.append('text')
                .attr('x', centerX).attr('y', y + 10)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SERIF).attr('font-style', 'italic')
                .attr('font-size', 10).attr('font-weight', 600)
                .attr('fill', C.ffnColor)
                .text('Feed-Forward Network \u25BC');
            collapseG.on('click', function () {
                self.expandedChips.ffn = false;
                self.draw();
            });

            var cy = y + 22;

            // W1: Linear(d, 4d)
            self.makeChip(g, C, baseBg, centerX - subW / 2, cy, subW, subH, {
                label: 'W\u2081', color: C.ffnColor, border: C.ffnBorder, bg: C.ffnBg,
                dimText: '<' + d + ', ' + d4 + '>'
            });
            cy += subH + subGap;
            self.drawArrowDown(g, C, centerX, cy, cy + arrowH - 2);
            cy += arrowH;

            // ReLU
            g.append('rect')
                .attr('x', centerX - 30).attr('y', cy)
                .attr('width', 60).attr('height', 18)
                .attr('rx', 3).attr('ry', 3)
                .attr('fill', C.ffnBg)
                .attr('stroke', C.ffnBorder)
                .attr('stroke-width', 1);
            g.append('text')
                .attr('x', centerX).attr('y', cy + 9)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 9).attr('font-weight', 600)
                .attr('fill', C.ffnColor)
                .text('ReLU');
            cy += 18 + subGap;
            self.drawArrowDown(g, C, centerX, cy, cy + arrowH - 2);
            cy += arrowH;

            // W2: Linear(4d, d)
            self.makeChip(g, C, baseBg, centerX - subW / 2, cy, subW, subH, {
                label: 'W\u2082', color: C.ffnColor, border: C.ffnBorder, bg: C.ffnBg,
                dimText: '<' + d4 + ', ' + d + '>'
            });
            cy += subH + 6;

            borderRect.attr('height', cy - y);
            return cy;
        }
    };

    // ─── Single Stack Draw (BERT / GPT-2) ───────────────────────────
    TransformerViz.prototype.drawSingleStack = function () {
        var self = this;
        var tokens = (this.dataMode === 'real' && this._realTokens) ? this._realTokens : EXAMPLES[this.exIdx].tokens;
        var N = tokens.length;
        var C = getThemeColors();
        var et = this.expandedChips;
        var isCausal = this.archMode === 'gpt2';
        var g = this.gB;
        var baseBg = C.canvasBg || '#ffffff';
        var centerX = CANVAS_W / 2;
        var arrowH = 20;

        // ═══ INPUT EMBEDDING ═══
        var y = this.drawInputEmbedding(g, C, baseBg, 15, tokens, this.embResult);

        // ═══ LAYER LOOP ═══
        for (var li = 0; li < this.numLayers; li++) {
            // Arrow down
            this.drawArrowDown(g, C, centerX, y, y + arrowH - 4);
            y += arrowH;

            if (li === this.expandedLayerIdx) {
                y = this.drawExpandedLayer(g, C, baseBg, y, tokens, isCausal, li, this.numLayers);
            } else {
                var layerClickFn = (function (idx) {
                    return function () {
                        self.expandedLayerIdx = idx;
                        self.expandedChips = {};
                        self.computeExpandedLayer();
                        self.draw();
                    };
                })(li);
                y = this.drawCollapsedLayer(g, C, baseBg, y, li, this.numLayers, isCausal ? 'Causal Self-Attn + FFN' : 'Self-Attn + FFN', layerClickFn);
            }
        }

        // Arrow to output
        this.drawArrowDown(g, C, centerX, y, y + arrowH - 4);
        y += arrowH;

        // ═══ OUTPUT PROJECTION ═══
        y = this.drawOutputProjection(g, C, baseBg, y, tokens);

        // Update viewBox
        y += 15;
        this.svg.attr('viewBox', '0 0 ' + CANVAS_W + ' ' + y);
        this.bgRect.attr('width', CANVAS_W).attr('height', y).attr('fill', C.canvasBg);
    };


    // ─── Update Header Badges ─────────────────────────────────────────
    TransformerViz.prototype.updateBadges = function () {
        var isReal = this.dataMode === 'real' && this.realData;
        var archBadge = document.getElementById('tf-arch-badge');
        if (archBadge) {
            var labels = { bert: 'Encoder Only', gpt2: 'Decoder Only', original: 'Encoder-Decoder' };
            archBadge.textContent = labels[this.archMode] || '';
        }
        var headBadge = document.getElementById('tf-head-badge');
        if (headBadge) {
            var headText = this.numHeads + ' Head' + (this.numHeads > 1 ? 's' : '');
            if (isReal) headText += ' (real)';
            headBadge.textContent = headText;
        }
        var dimBadge = document.getElementById('tf-dim-badge');
        if (dimBadge) {
            if (isReal) {
                dimBadge.textContent = 'd=' + this.realData.hidden_size + ' (d\u2096=' + this.realData.head_dim + ')';
            } else {
                dimBadge.textContent = 'd=' + this.embedDim;
            }
        }
        var layerBadge = document.getElementById('tf-layer-badge');
        if (layerBadge) {
            if (this.archMode === 'original') {
                layerBadge.textContent = this.numEncLayers + '+' + this.numDecLayers + ' Layers';
            } else {
                layerBadge.textContent = this.numLayers + ' Layers';
            }
        }
        // Data mode badge
        var dataBadge = document.getElementById('tf-data-badge');
        if (dataBadge) {
            if (isReal) {
                var modelNames = { bert: 'Real BERT', gpt2: 'Real GPT-2', original: 'Real MarianMT' };
                dataBadge.textContent = modelNames[this.archMode] || 'Real';
                dataBadge.style.display = '';
            } else {
                dataBadge.style.display = 'none';
            }
        }
    };

    // ─── Stepper Display ──────────────────────────────────────────────
    TransformerViz.prototype.updateStepperDisplay = function () {
        var valEl = document.getElementById('tf-token-step-value');
        if (valEl) valEl.value = this.activeToken;
    };

    // ─── Math Panel (DOM-based, right column) ─────────────────────────
    TransformerViz.prototype.updateMathPanel = function () {
        var panel = document.getElementById('tf-math-panel');
        if (!panel) return;

        if (this.archMode === 'original') {
            this.updateMathPanelEncDec(panel);
            return;
        }

        if (!this.expandedResult) return;

        var t = this.activeToken;
        var h = this.activeHead;
        var tokens = (this.dataMode === 'real' && this._realTokens) ? this._realTokens : EXAMPLES[this.exIdx].tokens;
        var n = tokens.length;
        var headData = this.expandedResult.heads[h];
        var headDim = this.expandedModel ? this.expandedModel.headDim : Math.floor(this.embedDim / this.numHeads);
        var showN = Math.min(6, this.embedDim);
        var showH = Math.min(6, headDim);
        var suffix = function (dim, show) { return dim > show ? ', \u2026' : ''; };
        var isCausal = this.archMode === 'gpt2';
        var layerLabel = 'Layer ' + (this.expandedLayerIdx + 1) + '/' + this.numLayers;

        var html = '';

        // Mode indicator
        var isRealData = this.dataMode === 'real' && this.realData;
        var modeStr = isCausal ? 'GPT-2 (Causal)' : 'BERT (Bidirectional)';
        if (isRealData) modeStr += ' \u2014 Real Data';
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">' + layerLabel + ' \u2014 ' + modeStr + '</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">Token:</span><span class="tf-math-value">\u201c' + displayWord(tokens[t].word) + '\u201d (pos ' + t + ')</span></div>';
        html += '</div>';

        // Embedding (skip in real data mode where embeddings are not available)
        if (!isRealData) {
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Embedding</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">E[' + tokens[t].id + ']:</span></div>';
        html += '<div class="tf-math-vector">';
        var emb = (this.embResult && this.embResult.embeddings && this.embResult.embeddings[t]) ? this.embResult.embeddings[t] : [];
        for (var i = 0; i < Math.min(showN, emb.length); i++) {
            html += '<span class="tf-vec-cell">' + emb[i].toFixed(3) + '</span>';
        }
        if (this.embedDim > showN) html += '<span class="tf-vec-cell">\u2026</span>';
        html += '</div>';

        if (this.usePE) {
            html += '<div class="tf-math-row"><span class="tf-math-label">PE[' + t + ']:</span></div>';
            html += '<div class="tf-math-vector">';
            var peVec = (this.embResult && this.embResult.pe && this.embResult.pe[t]) ? this.embResult.pe[t] : [];
            for (var i = 0; i < Math.min(showN, peVec.length); i++) {
                html += '<span class="tf-vec-cell">' + peVec[i].toFixed(3) + '</span>';
            }
            if (this.embedDim > showN) html += '<span class="tf-vec-cell">\u2026</span>';
            html += '</div>';
        }
        html += '</div>';
        } // end if (!isRealData)

        // Q, K, V for active head
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Head ' + h + ' Projections (d<sub>k</sub>=' + headDim + ')</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">Q<sub>' + t + '</sub>:</span><span class="tf-math-value">[' + headData.Q[t].slice(0, showH).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(headDim, showH) + ']</span></div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">K<sub>' + t + '</sub>:</span><span class="tf-math-value">[' + headData.K[t].slice(0, showH).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(headDim, showH) + ']</span></div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">V<sub>' + t + '</sub>:</span><span class="tf-math-value">[' + headData.V[t].slice(0, showH).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(headDim, showH) + ']</span></div>';
        html += '</div>';

        // Scores and weights
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Attention Scores (query ' + t + ')</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">\u221Ad<sub>k</sub> = ' + Math.sqrt(headDim).toFixed(2) + ', T = ' + this.temperature.toFixed(1) + '</span></div>';
        for (var j = 0; j < n; j++) {
            var rawScore = headData.scores[t][j];
            var weight = headData.weights[t][j];
            html += '<div class="tf-math-row">';
            if (isCausal && j > t) {
                html += '<span class="tf-math-label">q<sub>' + t + '</sub>\u00b7k<sub>' + j + '</sub>:</span>';
                html += '<span class="tf-math-value" style="color:var(--tf-mask-color);">MASKED (\u2212\u221e)</span>';
            } else {
                html += '<span class="tf-math-label">q<sub>' + t + '</sub>\u00b7k<sub>' + j + '</sub>/\u221Ad<sub>k</sub>/T:</span>';
                html += '<span class="tf-math-value">' + rawScore.toFixed(3) + ' \u2192 softmax: <strong>' + (weight * 100).toFixed(1) + '%</strong></span>';
            }
            html += '</div>';
        }
        html += '</div>';

        // Output
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Attended Output</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">out<sub>' + t + '</sub> = \u03A3 w<sub>j</sub>\u00b7V<sub>j</sub>:</span></div>';
        html += '<div class="tf-math-vector">';
        var outVec = headData.output[t];
        for (var i = 0; i < Math.min(showH, outVec.length); i++) {
            html += '<span class="tf-vec-cell">' + outVec[i].toFixed(3) + '</span>';
        }
        if (headDim > showH) html += '<span class="tf-vec-cell">\u2026</span>';
        html += '</div>';
        html += '</div>';

        panel.innerHTML = html;
    };

    // ─── Math Panel for Encoder-Decoder Mode ─────────────────────────
    TransformerViz.prototype.updateMathPanelEncDec = function (panel) {
        var ed;
        if (this.dataMode === 'real' && this._realSrcTokens) {
            ed = { source: this._realSrcTokens, target: this._realTgtTokens };
        } else {
            ed = EXAMPLES_ENC_DEC[this.exIdx];
        }
        var block = this.activeBlock;
        var headDim = Math.floor(this.embedDim / this.numHeads);
        var showH = Math.min(6, headDim);
        var suffix = function (dim, show) { return dim > show ? ', \u2026' : ''; };

        var headIdx, headData, queryToken, queryTokens, kvTokens, blockLabel, layerLabel;

        if (block === 'enc') {
            if (!this.expandedEncResult) { panel.innerHTML = ''; return; }
            headIdx = this.activeHeadEnc;
            headData = this.expandedEncResult.heads[headIdx];
            queryToken = this.activeToken;
            queryTokens = ed.source;
            kvTokens = ed.source;
            layerLabel = 'Enc Layer ' + (this.expandedEncLayerIdx + 1) + '/' + this.numEncLayers;
            blockLabel = layerLabel + ' \u2014 Self-Attention';
        } else if (block === 'dec') {
            if (!this.expandedDecResult) { panel.innerHTML = ''; return; }
            headIdx = this.activeHeadDec;
            headData = this.expandedDecResult.heads[headIdx];
            queryToken = this.activeTargetToken;
            queryTokens = ed.target;
            kvTokens = ed.target;
            layerLabel = 'Dec Layer ' + (this.expandedDecLayerIdx + 1) + '/' + this.numDecLayers;
            blockLabel = layerLabel + ' \u2014 Masked Self-Attention';
        } else {
            if (!this.expandedDecCrossResult) { panel.innerHTML = ''; return; }
            headIdx = this.activeHeadCross;
            headData = this.expandedDecCrossResult.heads[headIdx];
            queryToken = this.activeTargetToken;
            queryTokens = ed.target;
            kvTokens = ed.source;
            layerLabel = 'Dec Layer ' + (this.expandedDecLayerIdx + 1) + '/' + this.numDecLayers;
            blockLabel = layerLabel + ' \u2014 Cross-Attention (Dec Q \u00d7 Enc K/V)';
        }

        var t = queryToken;
        var nKV = kvTokens.length;

        var html = '';
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">' + blockLabel + '</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">Query:</span><span class="tf-math-value">\u201c' + displayWord(queryTokens[t].word) + '\u201d (pos ' + t + ')</span></div>';
        if (block === 'cross') {
            html += '<div class="tf-math-row"><span class="tf-math-label">Keys from:</span><span class="tf-math-value">Encoder output (' + nKV + ' tokens)</span></div>';
        }
        html += '</div>';

        // Head projections
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Head ' + headIdx + ' (d<sub>k</sub>=' + headDim + ')</div>';
        html += '<div class="tf-math-row"><span class="tf-math-label">Q<sub>' + t + '</sub>:</span><span class="tf-math-value">[' + headData.Q[t].slice(0, showH).map(function (v) { return v.toFixed(3); }).join(', ') + suffix(headDim, showH) + ']</span></div>';
        html += '</div>';

        // Scores
        html += '<div class="tf-math-section">';
        html += '<div class="tf-math-title">Attention Scores</div>';
        for (var j = 0; j < nKV; j++) {
            var rawScore = headData.scores[t][j];
            var weight = headData.weights[t][j];
            html += '<div class="tf-math-row">';
            if (block === 'dec' && j > t) {
                html += '<span class="tf-math-label">\u2192 k<sub>' + j + '</sub> (' + displayWord(kvTokens[j].word) + '):</span>';
                html += '<span class="tf-math-value" style="color:var(--tf-mask-color);">MASKED</span>';
            } else {
                html += '<span class="tf-math-label">\u2192 k<sub>' + j + '</sub> (' + displayWord(kvTokens[j].word) + '):</span>';
                html += '<span class="tf-math-value">' + rawScore.toFixed(3) + ' \u2192 <strong>' + (weight * 100).toFixed(1) + '%</strong></span>';
            }
            html += '</div>';
        }
        html += '</div>';

        panel.innerHTML = html;
    };

    // ─── Real Data Loading ──────────────────────────────────────────
    TransformerViz.prototype.getRealDataFilename = function () {
        var prefix;
        if (this.archMode === 'original') {
            prefix = 'marian';
        } else if (this.archMode === 'gpt2') {
            prefix = 'gpt2';
        } else {
            prefix = 'bert';
        }
        return prefix + '-' + this.exIdx + '.json';
    };

    TransformerViz.prototype.loadRealData = function (callback) {
        var self = this;
        var filename = this.getRealDataFilename();

        // Check cache
        if (this.realDataCache[filename]) {
            this.realData = this.realDataCache[filename];
            callback();
            return;
        }

        // Show loading overlay
        this.isLoading = true;
        var loadG = this.svg.append('g').attr('class', 'tf-loading-overlay');
        var vb = this.svg.attr('viewBox').split(' ');
        var vbW = parseFloat(vb[2]) || CANVAS_W;
        var vbH = parseFloat(vb[3]) || 700;
        loadG.append('rect')
            .attr('x', 0).attr('y', 0)
            .attr('width', vbW).attr('height', vbH)
            .attr('fill', 'rgba(0,0,0,0.3)');
        loadG.append('text')
            .attr('x', vbW / 2).attr('y', vbH / 2)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 14).attr('font-weight', 700)
            .attr('fill', EAIColor('surface'))
            .text('Loading real data\u2026');

        var url = 'static/data/attention/' + filename;
        fetch(url)
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            })
            .then(function (data) {
                self.realDataCache[filename] = data;
                self.realData = data;
                self.isLoading = false;
                loadG.remove();
                callback();
            })
            .catch(function (err) {
                self.isLoading = false;
                loadG.remove();
                console.error('Failed to load real data:', err);
                // Fall back to synthetic
                self.dataMode = 'synthetic';
                self.realData = null;
                self.updateDataModeButtons();
                self.rebuildModel();
                self.draw();
            });
    };

    // Helper: check if a token is a special token (for muted rendering)
    function isSpecialToken(word) {
        if (!word) return false;
        if (word.charAt(0) === '[' || word.charAt(0) === '<') return true;
        if (word.indexOf('##') === 0) return true;
        return false;
    }

    TransformerViz.prototype.updateDataModeButtons = function () {
        var synthBtn = document.getElementById('btn-data-synthetic');
        var realBtn = document.getElementById('btn-data-real');
        if (synthBtn && realBtn) {
            synthBtn.classList.toggle('active', this.dataMode === 'synthetic');
            realBtn.classList.toggle('active', this.dataMode === 'real');
        }
    };

    TransformerViz.prototype.lockControlsForRealData = function (locked) {
        var headsSelect = document.getElementById('tf-num-heads');
        var dimSelect = document.getElementById('tf-model-dim');
        var tempSlider = document.getElementById('tf-temperature');
        var peToggle = document.getElementById('tf-use-pe');
        if (headsSelect) headsSelect.disabled = locked;
        if (dimSelect) dimSelect.disabled = locked;
        if (tempSlider) tempSlider.disabled = locked;
        if (peToggle) peToggle.disabled = locked;
    };

    // ─── Architecture Mode Switch ────────────────────────────────────
    TransformerViz.prototype.setArchMode = function (mode) {
        this.archMode = mode;
        this.activeToken = 0;
        this.activeHead = 0;
        this.activeHeadEnc = 0;
        this.activeHeadDec = 0;
        this.activeHeadCross = 0;
        this.activeTargetToken = 0;
        this.activeBlock = 'enc';
        this.expandedChips = {};

        // Set layer counts per architecture (defaults, overridden if real data loaded)
        if (mode === 'original') {
            this.numEncLayers = 6;
            this.numDecLayers = 6;
            this.expandedEncLayerIdx = 0;
            this.expandedDecLayerIdx = -1;
        } else {
            this.numLayers = 12;
            this.expandedLayerIdx = 0;
        }

        // Clear real data since architecture changed (need to load new file)
        if (this.dataMode === 'real') {
            this.realData = null;
        }

        // Update toggle button states
        var btns = document.querySelectorAll('.tf-arch-toggle .btn');
        btns.forEach(function (b) { b.classList.remove('active'); });
        var activeBtn = document.getElementById('btn-arch-' + mode);
        if (activeBtn) activeBtn.classList.add('active');

        // Show/hide target selector
        var targetRow = document.getElementById('tf-target-row');
        if (targetRow) targetRow.style.display = mode === 'original' ? '' : 'none';

        // Update example label
        var exLabel = document.getElementById('tf-example-label');
        if (exLabel) exLabel.textContent = mode === 'original' ? 'Source:' : 'Example:';

        this.rebuildModel();
        // For real data, draw() is called in the loadRealData callback
        if (this.dataMode !== 'real') {
            this.draw();
        }
    };

    // ─── Expanded Encoder Layer (Original Transformer) ──────────────
    TransformerViz.prototype.drawExpandedEncLayer = function (g, C, baseBg, startY, tokens, layerIdx, totalLayers) {
        var self = this;
        var N = tokens.length;
        var headColors = getHeadColors();
        var et = this.expandedChips;
        var leftPad = 20, rightPad = 20;
        var availW = CANVAS_W - leftPad - rightPad;
        var centerX = CANVAS_W / 2;
        var result = this.expandedEncResult;
        if (!result) return startY + 40;

        var containerX = leftPad + 6;
        var containerW = CANVAS_W - leftPad - rightPad - 12;
        var heatCellSize = Math.min(24, (availW * 0.55 - 80) / (N + 1));
        var concatDotSize = 14;
        var concatGap = 4;
        var concatRowW = this.numHeads * (concatDotSize + concatGap) - concatGap;

        // Container border (height updated at end)
        var borderRect = g.append('rect')
            .attr('x', containerX).attr('y', startY)
            .attr('width', containerW).attr('height', 100)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', baseBg)
            .attr('stroke', C.layerExpandedBorder)
            .attr('stroke-width', 2);

        var encHeadIdx = this.activeHeadEnc;
        var encHeadColor = headColors[encHeadIdx % headColors.length];
        var headerY = startY + 4;

        g.append('text')
            .attr('x', containerX + 12).attr('y', headerY + 10)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 9).attr('font-weight', 700)
            .attr('fill', encHeadColor)
            .text('Enc Layer ' + (layerIdx + 1) + '/' + totalLayers);

        g.append('text')
            .attr('x', centerX).attr('y', headerY + 10)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10)
            .attr('fill', C.text).text('Bidirectional Self-Attn');

        // Collapse icon
        var collapseG = g.append('g').attr('cursor', 'pointer');
        collapseG.append('text')
            .attr('x', containerX + containerW - 12).attr('y', headerY + 10)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 12)
            .attr('fill', C.textMuted).text('\u25BC');
        collapseG.on('click', function () {
            self.expandedEncLayerIdx = -1;
            self.expandedChips = {};
            self.computeExpandedLayer();
            self.draw();
        });

        // Head squares
        var headBoxW = Math.min(availW * 0.85, 420);
        var headBoxX = centerX - headBoxW / 2;
        var headConcatX = headBoxX + headBoxW - 10 - concatRowW;
        for (var h = 0; h < this.numHeads; h++) {
            var sqX = headConcatX + h * (concatDotSize + concatGap);
            var hColor = headColors[h % headColors.length];
            var isAct = (h === encHeadIdx);
            var sqG = g.append('g').attr('class', 'head-square');
            sqG.append('rect').attr('x', sqX).attr('y', startY + 4)
                .attr('width', concatDotSize).attr('height', concatDotSize)
                .attr('rx', 2).attr('ry', 2)
                .attr('fill', isAct ? hColor : tokenColorBgOpaque(hColor, 0.2, baseBg))
                .attr('stroke', hColor).attr('stroke-width', isAct ? 2 : 1);
            sqG.append('title').text('Encoder Head ' + h + (isAct ? ' (active)' : '') + ' — click to switch');
            (function (hi) {
                sqG.on('click', function () {
                    self.activeHeadEnc = hi;
                    self.activeBlock = 'enc';
                    self.draw();
                });
            })(h);
        }

        var y = headerY + 24;

        // Heatmap toggle
        var encHeatToggle = {
            label: et.encHeatmap ? 'Weights \u25BC' : 'Weights \u25B6',
            color: encHeadColor, border: encHeadColor, bg: C.headBg,
            active: !!et.encHeatmap
        };
        self.makeChip(g, C, baseBg, centerX - 50, y, 100, 18, encHeatToggle, function () {
            self.expandedChips.encHeatmap = !self.expandedChips.encHeatmap;
            self.draw();
        });
        y += 22;

        if (et.encHeatmap && result) {
            var encWeights = result.heads[encHeadIdx].weights;
            var hmX = centerX - (N + 1) * heatCellSize / 2;
            self.drawAttentionHeatmap(g, C, hmX, y, encWeights, heatCellSize, tokens, tokens, this.activeToken, this.activeToken, false);
            y += (N + 1) * heatCellSize + 8;
        }

        y += 6;

        // ─── LayerNorm + FFN (encoder) ───
        y = this.drawLayerNorm(g, C, y, 'Add & Norm');
        y += 4;
        var arrowH2 = 14;
        self.drawArrowDown(g, C, centerX, y, y + arrowH2 - 2);
        y += arrowH2;
        y = this.drawFFNBlock(g, C, baseBg, y, N);
        y += 4;
        y = this.drawLayerNorm(g, C, y, 'Add & Norm');
        y += 6;

        borderRect.attr('height', y - startY);
        return y;
    };

    // ─── Expanded Decoder Layer (Original Transformer) ──────────────
    TransformerViz.prototype.drawExpandedDecLayer = function (g, C, baseBg, startY, tgtTokens, srcTokens, layerIdx, totalLayers) {
        var self = this;
        var nTgt = tgtTokens.length;
        var nSrc = srcTokens.length;
        var headColors = getHeadColors();
        var et = this.expandedChips;
        var leftPad = 20, rightPad = 20;
        var availW = CANVAS_W - leftPad - rightPad;
        var centerX = CANVAS_W / 2;
        var decResult = this.expandedDecResult;
        var crossResult = this.expandedDecCrossResult;
        if (!decResult || !crossResult) return startY + 40;

        var containerX = leftPad + 6;
        var containerW = CANVAS_W - leftPad - rightPad - 12;
        var heatCellSize = Math.min(24, (availW * 0.55 - 80) / (Math.max(nSrc, nTgt) + 1));
        var concatDotSize = 14;
        var concatGap = 4;
        var concatRowW = this.numHeads * (concatDotSize + concatGap) - concatGap;

        // Container border
        var borderRect = g.append('rect')
            .attr('x', containerX).attr('y', startY)
            .attr('width', containerW).attr('height', 100)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', baseBg)
            .attr('stroke', C.layerExpandedBorder)
            .attr('stroke-width', 2);

        var headerY = startY + 4;
        g.append('text')
            .attr('x', containerX + 12).attr('y', headerY + 10)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 9).attr('font-weight', 700)
            .attr('fill', C.layerExpandedBorder)
            .text('Dec Layer ' + (layerIdx + 1) + '/' + totalLayers);

        // Collapse icon
        var collapseG = g.append('g').attr('cursor', 'pointer');
        collapseG.append('text')
            .attr('x', containerX + containerW - 12).attr('y', headerY + 10)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 12)
            .attr('fill', C.textMuted).text('\u25BC');
        collapseG.on('click', function () {
            self.expandedDecLayerIdx = -1;
            self.expandedChips = {};
            self.computeExpandedLayer();
            self.draw();
        });

        var y = headerY + 24;

        // ─── Masked Self-Attention ───
        var decHeadIdx = this.activeHeadDec;
        var decHeadColor = headColors[decHeadIdx % headColors.length];

        g.append('text')
            .attr('x', containerX + 16).attr('y', y)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 9).attr('font-weight', 700)
            .attr('fill', decHeadColor).text('Masked Self-Attn ' + decHeadIdx + '/' + this.numHeads);

        g.append('text')
            .attr('x', centerX).attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10)
            .attr('fill', C.maskColor).text('Causal Mask');

        // Head squares for decoder
        var headBoxW = Math.min(availW * 0.85, 420);
        var headBoxX = centerX - headBoxW / 2;
        var decConcatX = headBoxX + headBoxW - 10 - concatRowW;
        for (var h = 0; h < this.numHeads; h++) {
            var sqX = decConcatX + h * (concatDotSize + concatGap);
            var hColor = headColors[h % headColors.length];
            var isAct = (h === decHeadIdx);
            var sqG = g.append('g').attr('class', 'head-square');
            sqG.append('rect').attr('x', sqX).attr('y', y - 2)
                .attr('width', concatDotSize).attr('height', concatDotSize)
                .attr('rx', 2).attr('ry', 2)
                .attr('fill', isAct ? hColor : tokenColorBgOpaque(hColor, 0.2, baseBg))
                .attr('stroke', hColor).attr('stroke-width', isAct ? 2 : 1);
            sqG.append('title').text('Decoder Head ' + h + (isAct ? ' (active)' : '') + ' — click to switch');
            (function (hi) {
                sqG.on('click', function () {
                    self.activeHeadDec = hi;
                    self.activeBlock = 'dec';
                    self.draw();
                });
            })(h);
        }
        y += 16;

        var decHeatToggle = {
            label: et.decHeatmap ? 'Weights \u25BC' : 'Weights \u25B6',
            color: decHeadColor, border: decHeadColor, bg: C.headBg,
            active: !!et.decHeatmap
        };
        self.makeChip(g, C, baseBg, centerX - 50, y, 100, 18, decHeatToggle, function () {
            self.expandedChips.decHeatmap = !self.expandedChips.decHeatmap;
            self.draw();
        });
        y += 22;

        if (et.decHeatmap) {
            var decWeights = decResult.heads[decHeadIdx].weights;
            var hmX = centerX - (nTgt + 1) * heatCellSize / 2;
            self.drawAttentionHeatmap(g, C, hmX, y, decWeights, heatCellSize, tgtTokens, tgtTokens, this.activeTargetToken, this.activeTargetToken, true);
            y += (nTgt + 1) * heatCellSize + 8;
        }

        y += 8;

        // ─── Cross-Attention ───
        var crossHeadIdx = this.activeHeadCross;
        var crossHeadColor = headColors[crossHeadIdx % headColors.length];

        g.append('text')
            .attr('x', containerX + 16).attr('y', y)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 9).attr('font-weight', 700)
            .attr('fill', C.crossColor).text('Cross-Attn ' + crossHeadIdx + '/' + this.numHeads);

        g.append('text')
            .attr('x', centerX).attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10)
            .attr('fill', C.crossColor).text('Dec Q \u00d7 Enc K/V');

        // Head squares for cross-attention
        var crossConcatX = headBoxX + headBoxW - 10 - concatRowW;
        for (var h2 = 0; h2 < this.numHeads; h2++) {
            var sqX2 = crossConcatX + h2 * (concatDotSize + concatGap);
            var hColor2 = headColors[h2 % headColors.length];
            var isAct2 = (h2 === crossHeadIdx);
            var sqG2 = g.append('g').attr('class', 'head-square');
            sqG2.append('rect').attr('x', sqX2).attr('y', y - 2)
                .attr('width', concatDotSize).attr('height', concatDotSize)
                .attr('rx', 2).attr('ry', 2)
                .attr('fill', isAct2 ? hColor2 : tokenColorBgOpaque(hColor2, 0.2, baseBg))
                .attr('stroke', hColor2).attr('stroke-width', isAct2 ? 2 : 1);
            sqG2.append('title').text('Cross-Attn Head ' + h2 + (isAct2 ? ' (active)' : '') + ' — click to switch');
            (function (hi) {
                sqG2.on('click', function () {
                    self.activeHeadCross = hi;
                    self.activeBlock = 'cross';
                    self.draw();
                });
            })(h2);
        }
        y += 16;

        var crossHeatToggle = {
            label: et.crossHeatmap ? 'Weights \u25BC' : 'Weights \u25B6',
            color: C.crossColor, border: C.crossBorder, bg: C.crossBg,
            active: !!et.crossHeatmap
        };
        self.makeChip(g, C, baseBg, centerX - 50, y, 100, 18, crossHeatToggle, function () {
            self.expandedChips.crossHeatmap = !self.expandedChips.crossHeatmap;
            self.draw();
        });
        y += 22;

        if (et.crossHeatmap) {
            var crossWeights = crossResult.heads[crossHeadIdx].weights;
            var hmX2 = centerX - (nSrc + 1) * heatCellSize / 2;
            self.drawAttentionHeatmap(g, C, hmX2, y, crossWeights, heatCellSize, tgtTokens, srcTokens, this.activeTargetToken, this.activeToken, false);
            y += (Math.max(nTgt, nSrc) + 1) * heatCellSize + 8;
        }

        y += 6;

        // ─── LayerNorm + FFN (decoder) ───
        y = this.drawLayerNorm(g, C, y, 'Add & Norm');
        y += 4;
        var arrowH3 = 14;
        self.drawArrowDown(g, C, centerX, y, y + arrowH3 - 2);
        y += arrowH3;
        y = this.drawFFNBlock(g, C, baseBg, y, nTgt);
        y += 4;
        y = this.drawLayerNorm(g, C, y, 'Add & Norm');
        y += 6;

        borderRect.attr('height', y - startY);
        return y;
    };

    // ─── Encoder-Decoder Draw (Original Transformer) ────────────────
    TransformerViz.prototype.drawEncoderDecoder = function () {
        var self = this;
        var srcTokens, tgtTokens;
        if (this.dataMode === 'real' && this._realSrcTokens) {
            srcTokens = this._realSrcTokens;
            tgtTokens = this._realTgtTokens;
        } else {
            var ed = EXAMPLES_ENC_DEC[this.exIdx];
            srcTokens = ed.source;
            tgtTokens = ed.target;
        }
        var nSrc = srcTokens.length;
        var nTgt = tgtTokens.length;
        var C = getThemeColors();
        var g = this.gB;
        var baseBg = C.canvasBg || '#ffffff';

        var leftPad = 20, rightPad = 20;
        var centerX = CANVAS_W / 2;
        var cardGap = 6;
        var availW = CANVAS_W - leftPad - rightPad;
        var cardW = Math.min(70, (availW * 0.45 - (Math.max(nSrc, nTgt) - 1) * cardGap) / Math.max(nSrc, nTgt));
        var cardH = 42;
        var arrowH = 20;

        var y = 12;

        // ═══ ENCODER SECTION ═══
        g.append('text').attr('x', centerX).attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 11).attr('font-weight', 700)
            .attr('fill', C.embedColor).text('ENCODER');
        y += 16;

        // Source tokens
        var srcCardsW = nSrc * cardW + (nSrc - 1) * cardGap;
        var srcX = centerX - srcCardsW / 2;

        g.append('text').attr('x', srcX).attr('y', y)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10).attr('font-weight', 600)
            .attr('fill', C.embedColor).text('Source Tokens');
        y += 14;

        for (var i = 0; i < nSrc; i++) {
            var cx = srcX + i * (cardW + cardGap);
            var isActive = (i === this.activeToken);
            var tokColor = getTokenClassColor(i);
            var srcSpecial = isSpecialToken(srcTokens[i].word);
            var cardG = g.append('g').attr('class', 'token-card-group');
            if (srcSpecial) cardG.attr('opacity', 0.5);
            cardG.append('rect').attr('x', cx).attr('y', y)
                .attr('width', cardW).attr('height', cardH).attr('rx', 4).attr('ry', 4)
                .attr('fill', tokenColorBgOpaque(tokColor, isActive ? 0.25 : 0.12, baseBg))
                .attr('stroke', isActive ? tokColor : tokenColorBorder(tokColor, 0.4))
                .attr('stroke-width', isActive ? 2.5 : 1.5);
            cardG.append('text').attr('x', cx + cardW / 2).attr('y', y + 13)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SERIF).attr('font-size', 10).attr('font-weight', 600)
                .attr('fill', srcSpecial ? C.textMuted : C.text).text(displayWord(srcTokens[i].word));
            cardG.append('text').attr('x', cx + cardW / 2).attr('y', y + 30)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 7).attr('fill', C.textMuted)
                .text('t=' + i);
            (function(idx) {
                cardG.on('click', function() {
                    self.activeToken = idx;
                    self.activeBlock = 'enc';
                    self.draw();
                });
            })(i);
        }
        y += cardH + 4;

        // ═══ ENCODER LAYER LOOP ═══
        for (var eli = 0; eli < this.numEncLayers; eli++) {
            self.drawArrowDown(g, C, centerX, y, y + arrowH - 4);
            y += arrowH;

            if (eli === this.expandedEncLayerIdx) {
                y = this.drawExpandedEncLayer(g, C, baseBg, y, srcTokens, eli, this.numEncLayers);
            } else {
                var encClickFn = (function(idx) {
                    return function() {
                        self.expandedEncLayerIdx = idx;
                        self.expandedChips = {};
                        self.computeExpandedLayer();
                        self.draw();
                    };
                })(eli);
                y = this.drawCollapsedLayer(g, C, baseBg, y, eli, this.numEncLayers, 'Self-Attn + FFN', encClickFn);
            }
        }

        y += 4;

        // ═══ SECTION SEPARATOR ═══
        g.append('line')
            .attr('x1', leftPad + 20).attr('y1', y + 8)
            .attr('x2', CANVAS_W - rightPad - 20).attr('y2', y + 8)
            .attr('stroke', C.sectionBorder).attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '8,4');
        var sepBgRect = g.append('rect').attr('fill', baseBg);
        var sepText = g.append('text').attr('x', centerX).attr('y', y + 8)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', MONO).attr('font-size', 8).attr('fill', C.textMuted)
            .text('  Encoder Output \u2192 Decoder K/V  ');
        var sepBBox = sepText.node().getBBox();
        sepBgRect.attr('x', sepBBox.x - 4).attr('y', sepBBox.y - 1)
            .attr('width', sepBBox.width + 8).attr('height', sepBBox.height + 2);
        y += 20;

        // ═══ DECODER SECTION ═══
        g.append('text').attr('x', centerX).attr('y', y)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
            .attr('font-family', MONO).attr('font-size', 11).attr('font-weight', 700)
            .attr('fill', C.outputColor).text('DECODER');
        y += 16;

        // Target tokens
        var tgtCardsW = nTgt * cardW + (nTgt - 1) * cardGap;
        var tgtX = centerX - tgtCardsW / 2;

        g.append('text').attr('x', tgtX).attr('y', y)
            .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
            .attr('font-family', SERIF).attr('font-style', 'italic').attr('font-size', 10).attr('font-weight', 600)
            .attr('fill', C.outputColor).text('Target Tokens');
        y += 14;

        for (var i2 = 0; i2 < nTgt; i2++) {
            var cx2 = tgtX + i2 * (cardW + cardGap);
            var isActive2 = (i2 === this.activeTargetToken);
            var tokColor2 = getTokenClassColor(i2);
            var tgtSpecial = isSpecialToken(tgtTokens[i2].word);
            var cardG2 = g.append('g').attr('class', 'token-card-group');
            if (tgtSpecial) cardG2.attr('opacity', 0.5);
            cardG2.append('rect').attr('x', cx2).attr('y', y)
                .attr('width', cardW).attr('height', cardH).attr('rx', 4).attr('ry', 4)
                .attr('fill', tokenColorBgOpaque(tokColor2, isActive2 ? 0.25 : 0.12, baseBg))
                .attr('stroke', isActive2 ? tokColor2 : tokenColorBorder(tokColor2, 0.4))
                .attr('stroke-width', isActive2 ? 2.5 : 1.5);
            cardG2.append('text').attr('x', cx2 + cardW / 2).attr('y', y + 13)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SERIF).attr('font-size', 10).attr('font-weight', 600)
                .attr('fill', tgtSpecial ? C.textMuted : C.text).text(displayWord(tgtTokens[i2].word));
            cardG2.append('text').attr('x', cx2 + cardW / 2).attr('y', y + 30)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', MONO).attr('font-size', 7).attr('fill', C.textMuted)
                .text('t=' + i2);
            (function(idx) {
                cardG2.on('click', function() {
                    self.activeTargetToken = idx;
                    self.activeBlock = 'dec';
                    self.draw();
                });
            })(i2);
        }
        y += cardH + 4;

        // ═══ DECODER LAYER LOOP ═══
        for (var dli = 0; dli < this.numDecLayers; dli++) {
            self.drawArrowDown(g, C, centerX, y, y + arrowH - 4);
            y += arrowH;

            if (dli === this.expandedDecLayerIdx) {
                y = this.drawExpandedDecLayer(g, C, baseBg, y, tgtTokens, srcTokens, dli, this.numDecLayers);
            } else {
                var decClickFn = (function(idx) {
                    return function() {
                        self.expandedDecLayerIdx = idx;
                        self.expandedChips = {};
                        self.computeExpandedLayer();
                        self.draw();
                    };
                })(dli);
                y = this.drawCollapsedLayer(g, C, baseBg, y, dli, this.numDecLayers, 'Masked + Cross + FFN', decClickFn);
            }
        }

        // Arrow to output
        self.drawArrowDown(g, C, centerX, y, y + arrowH - 4);
        y += arrowH;

        // Output label
        var outChipDef = {
            label: 'Decoder Output',
            color: C.outputColor, border: C.outputBorder, bg: C.outputBg,
            active: false, dimText: '<' + nTgt + ', ' + this.embedDim + '>'
        };
        self.makeChip(g, C, baseBg, centerX - 90, y, 180, 28, outChipDef);
        y += 40;

        // Update viewBox
        this.svg.attr('viewBox', '0 0 ' + CANVAS_W + ' ' + y);
        this.bgRect.attr('width', CANVAS_W).attr('height', y).attr('fill', C.canvasBg);
    };


    // ─── Event Binding ────────────────────────────────────────────────
    TransformerViz.prototype.bindEvents = function () {
        var self = this;

        // Data mode toggle (Synthetic / Real)
        var synthBtn = document.getElementById('btn-data-synthetic');
        var realBtn = document.getElementById('btn-data-real');
        if (synthBtn) {
            synthBtn.addEventListener('click', function () {
                if (self.dataMode === 'synthetic') return;
                self.dataMode = 'synthetic';
                self.realData = null;
                self.updateDataModeButtons();
                self.lockControlsForRealData(false);
                self.expandedChips = {};
                self.rebuildModel();
                self.draw();
            });
        }
        if (realBtn) {
            realBtn.addEventListener('click', function () {
                if (self.dataMode === 'real') return;
                self.dataMode = 'real';
                self.updateDataModeButtons();
                self.lockControlsForRealData(true);
                self.expandedChips = {};
                self.rebuildModel();
                // draw() is called inside rebuildModel's callback for real data
            });
        }

        // Architecture toggle buttons
        ['bert', 'gpt2', 'original'].forEach(function (mode) {
            var btn = document.getElementById('btn-arch-' + mode);
            if (btn) {
                btn.addEventListener('click', function () {
                    self.setArchMode(mode);
                });
            }
        });

        // Example selector
        var exSelect = document.getElementById('tf-example-select');
        var tgtSelect = document.getElementById('tf-target-select');
        if (exSelect) {
            exSelect.addEventListener('change', function () {
                self.exIdx = parseInt(this.value);
                self.activeToken = 0;
                self.activeHead = 0;
                self.activeTargetToken = 0;
                self.expandedChips = {};
                // Sync target selector with example
                if (tgtSelect) tgtSelect.value = this.value;
                // Clear real data so new file is loaded
                if (self.dataMode === 'real') self.realData = null;
                self.rebuildModel();
                // For real data, draw() is called in the callback
                if (self.dataMode !== 'real') self.draw();
            });
        }

        // Target selector (encoder-decoder mode) — syncs to same example pair
        if (tgtSelect) {
            tgtSelect.addEventListener('change', function () {
                self.exIdx = parseInt(this.value);
                self.activeToken = 0;
                self.activeTargetToken = 0;
                self.expandedChips = {};
                if (exSelect) exSelect.value = this.value;
                if (self.dataMode === 'real') self.realData = null;
                self.rebuildModel();
                if (self.dataMode !== 'real') self.draw();
            });
        }

        // Token stepper
        DU.wireStepper('tf-token-step-minus', 'tf-token-step-plus', 'tf-token-step-value', {
            min: 0,
            max: 999,
            step: 1,
            onChange: function (val) {
                var maxT;
                if (self.dataMode === 'real' && self.realData) {
                    if (self.archMode === 'original') {
                        maxT = (self._realSrcTokens ? self._realSrcTokens.length : 1) - 1;
                    } else {
                        maxT = (self._realTokens ? self._realTokens.length : 1) - 1;
                    }
                } else if (self.archMode === 'original') {
                    maxT = EXAMPLES_ENC_DEC[self.exIdx].source.length - 1;
                } else {
                    maxT = EXAMPLES[self.exIdx].tokens.length - 1;
                }
                var newT = Math.max(0, Math.min(val, maxT));
                self.activeToken = newT;
                var valEl = document.getElementById('tf-token-step-value');
                if (valEl) valEl.value = newT;
                self.draw();
            }
        });

        // Heads selector
        var headsSelect = document.getElementById('tf-num-heads');
        if (headsSelect) {
            headsSelect.addEventListener('change', function () {
                self.numHeads = parseInt(this.value);
                self.activeHead = 0;
                self.activeHeadEnc = 0;
                self.activeHeadDec = 0;
                self.activeHeadCross = 0;
                self.expandedChips = {};
                self.rebuildModel();
                self.draw();
            });
        }

        // Model dim selector
        var dimSelect = document.getElementById('tf-model-dim');
        if (dimSelect) {
            dimSelect.addEventListener('change', function () {
                self.embedDim = parseInt(this.value);
                self.expandedChips = {};
                self.rebuildModel();
                self.draw();
            });
        }

        // Temperature slider
        var tempSlider = document.getElementById('tf-temperature');
        var tempValue = document.getElementById('tf-temp-value');
        if (tempSlider) {
            tempSlider.addEventListener('input', function () {
                self.temperature = parseFloat(this.value);
                if (tempValue) tempValue.textContent = self.temperature.toFixed(1);
                self.rebuildModel();
                self.draw();
            });
        }

        // PE toggle
        var peToggle = document.getElementById('tf-use-pe');
        if (peToggle) {
            peToggle.addEventListener('change', function () {
                self.usePE = this.checked;
                self.rebuildModel();
                self.draw();
            });
        }

        // Reset button
        var resetBtn = document.getElementById('tf-btn-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                self.exIdx = 0;
                self.activeToken = 0;
                self.activeHead = 0;
                self.activeHeadEnc = 0;
                self.activeHeadDec = 0;
                self.activeHeadCross = 0;
                self.activeTargetToken = 0;
                self.activeBlock = 'enc';
                self.embedDim = 64;
                self.numHeads = 4;
                self.temperature = 1.0;
                self.usePE = true;
                self.expandedChips = {};
                self.expandedLayerIdx = 0;
                self.numLayers = 12;
                self.expandedEncLayerIdx = 0;
                self.expandedDecLayerIdx = -1;

                // Reset data mode to synthetic
                self.dataMode = 'synthetic';
                self.realData = null;
                self.updateDataModeButtons();
                self.lockControlsForRealData(false);

                if (exSelect) exSelect.value = '0';
                if (tgtSelect) tgtSelect.value = '0';
                if (headsSelect) headsSelect.value = '4';
                if (dimSelect) dimSelect.value = '64';
                if (tempSlider) tempSlider.value = '1.0';
                if (tempValue) tempValue.textContent = '1.0';
                if (peToggle) peToggle.checked = true;

                self.setArchMode('bert');
            });
        }

        // Tab switching (btn-group variant)
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

        // Theme change: full redraw
        document.addEventListener('themechange', function () {
            self.draw();
        });
        if (window.VizLib && window.VizLib.ThemeManager) {
            window.VizLib.ThemeManager.onThemeChange(function () {
                self.draw();
            });
        }
    };

    // ─── Init ─────────────────────────────────────────────────────────
    function init() {
        resolveLibs();
        new TransformerViz();
    }

    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();

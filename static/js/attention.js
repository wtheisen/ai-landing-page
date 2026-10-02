/**
 * Attention Mechanism Visualizer (D3/SVG)
 *
 * Animated visualization of scaled dot-product attention:
 * embed tokens → project Q/K/V → compute scores → scale → softmax →
 * build heatmap → aggregate values → output. Pre-computes all data,
 * then reveals via a phase state machine with D3 transitions.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_W = 720;
    const MONO = "'SF Mono','Menlo','Monaco','Consolas','Courier New',monospace";

    const ZONE_GAP = 15;
    const SUB_GAP = 10;

    // BPE-style tokenized presets (matching RNN vis format)
    const PRESETS = {
        'default': {
            label: 'I like cute kitties and',
            tokens: [
                { word: 'I', id: 40 },
                { word: '\u00b7like', id: 588 },
                { word: '\u00b7cute', id: 13779 },
                { word: '\u00b7k', id: 479 },
                { word: 'itt', id: 715 },
                { word: 'ies', id: 444 },
                { word: '\u00b7and', id: 290 },
            ]
        },
        'short': {
            label: 'the cat sat on',
            tokens: [
                { word: 'the', id: 1169 },
                { word: '\u00b7cat', id: 3797 },
                { word: '\u00b7sat', id: 3290 },
                { word: '\u00b7on', id: 319 },
            ]
        },
        'long': {
            label: 'hello world !',
            tokens: [
                { word: 'hello', id: 31373 },
                { word: '\u00b7world', id: 995 },
                { word: '\u00b7!', id: 256 },
            ]
        },
    };

    // Map sentence select values to data file indices
    const SENTENCE_FILE_MAP = {
        'default': '0',
        'short': '1',
        'long': '2',
        'custom': '0',
    };

    const DIM_OPTIONS = [4, 6, 8];

    const PHASES = [
        'IDLE', 'SHOW_TOKENS', 'SHOW_EMBEDDINGS',
        'PROJECT_Q', 'PROJECT_K', 'PROJECT_V',
        'COMPUTE_SCORES', 'SCALE_SCORES', 'APPLY_SOFTMAX',
        'SHOW_OUTPUT', 'COMPLETE'
    ];

    const PHASE_DURATION_MULT = {
        'COMPUTE_SCORES': 1.5,
        'SCALE_SCORES': 0.5,
    };

    const TERM_PHASE_MAP = {
        'tokens': 'SHOW_TOKENS', 'E': 'SHOW_EMBEDDINGS',
        'Q': 'PROJECT_Q', 'K': 'PROJECT_K', 'V': 'PROJECT_V',
        'QKT': 'COMPUTE_SCORES', 'scaled': 'SCALE_SCORES', 'softmax': 'APPLY_SOFTMAX',
        'ctxVectors': 'SHOW_OUTPUT', 'resE': 'SHOW_OUTPUT',
    };
    const PHASE_TERM_MAP = Object.fromEntries(Object.entries(TERM_PHASE_MAP).map(([k,v]) => [v,k]));

    // ============================================
    // Seeded PRNG
    // ============================================
    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash >>> 0;
    }

    function mulberry32(seed) {
        let s = seed | 0;
        return function() {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ============================================
    // Linear Algebra Helpers
    // ============================================
    function dot(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
    }

    function matvec(M, v) {
        const result = [];
        for (let i = 0; i < M.length; i++) {
            result.push(dot(M[i], v));
        }
        return result;
    }

    function softmax(arr) {
        const max = Math.max(...arr);
        const exps = arr.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map(v => v / sum);
    }

    function seededVector(rng, dim) {
        const v = [];
        for (let i = 0; i < dim; i++) {
            const u1 = Math.max(1e-10, rng());
            const u2 = rng();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            v.push(z * 0.5);
        }
        return v;
    }

    function seededMatrix(rng, rows, cols) {
        const M = [];
        for (let r = 0; r < rows; r++) {
            M.push(seededVector(rng, cols));
        }
        return M;
    }

    // ============================================
    // Pre-computation (single head)
    // ============================================
    function precomputeHead(embeddings, d, rng) {
        const N = embeddings.length;
        const W_Q = seededMatrix(rng, d, d);
        const W_K = seededMatrix(rng, d, d);
        const W_V = seededMatrix(rng, d, d);

        const Q = embeddings.map(e => matvec(W_Q, e));
        const K = embeddings.map(e => matvec(W_K, e));
        const V = embeddings.map(e => matvec(W_V, e));

        const rawScores = [];
        for (let i = 0; i < N; i++) {
            const row = [];
            for (let j = 0; j < N; j++) {
                row.push(dot(Q[i], K[j]));
            }
            rawScores.push(row);
        }

        const scaleFactor = Math.sqrt(d);
        const scaledScores = rawScores.map(row => row.map(s => s / scaleFactor));
        const attentionWeights = scaledScores.map(row => softmax(row));

        const contextVectors = [];
        const outputs = [];
        for (let i = 0; i < N; i++) {
            const ctx = new Array(d).fill(0);
            for (let j = 0; j < N; j++) {
                const w = attentionWeights[i][j];
                for (let k = 0; k < d; k++) {
                    ctx[k] += w * V[j][k];
                }
            }
            contextVectors.push(ctx);
            // Residual connection: add input embedding
            const out = ctx.map((c, k) => c + embeddings[i][k]);
            outputs.push(out);
        }

        return { W_Q, W_K, W_V, Q, K, V, rawScores, scaleFactor, scaledScores, attentionWeights, contextVectors, outputs };
    }

    function precompute(sentence, embedDim, numHeads) {
        // Use BPE token objects from presets, or fall back to whitespace split for custom
        let tokenObjs;
        const presetEntry = Object.values(PRESETS).find(p => p.label === sentence);
        if (presetEntry) {
            tokenObjs = presetEntry.tokens;
        } else {
            // Custom sentence: simple whitespace tokenization
            tokenObjs = sentence.trim().split(/\s+/).filter(t => t.length > 0)
                .map((w, i) => ({ word: w, id: i + 1 }));
        }
        const tokens = tokenObjs.map(t => t.word);
        const tokenIds = tokenObjs.map(t => t.id);
        const N = tokens.length;
        const d = embedDim;

        const rng = mulberry32(hashCode(sentence + d));

        const embeddings = [];
        for (let i = 0; i < N; i++) {
            embeddings.push(seededVector(rng, d));
        }

        const heads = [];
        for (let h = 0; h < numHeads; h++) {
            const headRng = mulberry32(hashCode(sentence + d + '_head_' + h));
            heads.push(precomputeHead(embeddings, d, headRng));
        }

        const head0 = heads[0];
        return {
            tokens, tokenIds, embeddings,
            W_Q: head0.W_Q, W_K: head0.W_K, W_V: head0.W_V,
            Q: head0.Q, K: head0.K, V: head0.V,
            rawScores: head0.rawScores, scaleFactor: head0.scaleFactor,
            scaledScores: head0.scaledScores, attentionWeights: head0.attentionWeights,
            contextVectors: head0.contextVectors, outputs: head0.outputs,
            heads: heads,
        };
    }

    // ============================================
    // Theme-aware color helper
    // ============================================
    function getThemeColors() {
        const s = getComputedStyle(document.documentElement);
        const g = name => s.getPropertyValue(name).trim();
        return {
            qBg:          g('--attn-q-bg'),
            qBorder:      g('--attn-q-border'),
            qFill:        g('--attn-q-fill'),
            qText:        g('--attn-q-text'),
            kBg:          g('--attn-k-bg'),
            kBorder:      g('--attn-k-border'),
            kFill:        g('--attn-k-fill'),
            kText:        g('--attn-k-text'),
            vBg:          g('--attn-v-bg'),
            vBorder:      g('--attn-v-border'),
            vFill:        g('--attn-v-fill'),
            vText:        g('--attn-v-text'),
            tokenBg:      g('--attn-token-bg'),
            tokenBorder:  g('--attn-token-border'),
            tokenText:    g('--attn-token-text'),
            embedPos:     g('--attn-embed-pos'),
            embedNeg:     g('--attn-embed-neg'),
            cellBg:       g('--attn-cell-bg'),
            cellBorder:   g('--attn-cell-border'),
            cellText:     g('--attn-cell-text'),
            activeGlow:   g('--attn-active-glow'),
            activeBorder: g('--attn-active-border'),
            heatCool:     g('--attn-heat-cool'),
            heatMid:      g('--attn-heat-mid'),
            heatWarm:     g('--attn-heat-warm'),
            outputFill:   g('--attn-output-fill'),
            outputBorder: g('--attn-output-border'),
            outputText:   g('--attn-output-text'),
            sectionTitle: g('--attn-section-title'),
            labelColor:   g('--attn-label-color'),
            canvasText:   g('--attn-canvas-text'),
            arrowColor:   g('--attn-arrow-color'),
            arrowGlow:    g('--attn-arrow-glow'),
            dashedLine:   g('--attn-dashed-line'),
            divider:      g('--attn-divider'),
            scaleLabel:   g('--attn-scale-label'),
            canvasBg:     g('--viz-canvas-bg'),
            textMuted:    g('--viz-text-muted'),
        };
    }

    // ============================================
    // Color interpolation for heatmap
    // ============================================
    function parseColor(str) {
        if (str.startsWith('#')) {
            const hex = str.slice(1);
            if (hex.length === 3) {
                return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16)];
            }
            return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
        }
        const m = str.match(/(\d+)/g);
        if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
        return [128, 128, 128];
    }

    function interpolateHeatColor(t, coolStr, midStr, warmStr) {
        const cool = parseColor(coolStr);
        const mid  = parseColor(midStr);
        const warm = parseColor(warmStr);
        let r, g, b;
        if (t <= 0.5) {
            const f = t * 2;
            r = cool[0] + (mid[0] - cool[0]) * f;
            g = cool[1] + (mid[1] - cool[1]) * f;
            b = cool[2] + (mid[2] - cool[2]) * f;
        } else {
            const f = (t - 0.5) * 2;
            r = mid[0] + (warm[0] - mid[0]) * f;
            g = mid[1] + (warm[1] - mid[1]) * f;
            b = mid[2] + (warm[2] - mid[2]) * f;
        }
        return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    }

    // ============================================
    // Stagger alpha helper
    // ============================================
    function staggerAlpha(progress, index, total) {
        if (total <= 1) return progress;
        const stagger = 0.4;
        const itemStart = (index / total) * stagger;
        const itemEnd = itemStart + (1 - stagger);
        if (progress <= itemStart) return 0;
        if (progress >= itemEnd) return 1;
        return (progress - itemStart) / (itemEnd - itemStart);
    }

    // ============================================
    // Head color palettes
    // ============================================
    const HEAD_COLORS_LIGHT = [EAIColor('class-1', 'light'),EAIColor('class-4', 'light'),EAIColor('class-2', 'light'),EAIColor('class-0', 'light'),EAIColor('class-3', 'light'),EAIColor('class-6', 'light'),EAIColor('class-7', 'light'),EAIColor('class-8', 'light'),EAIColor('class-5', 'light'),EAIColor('class-9', 'light'),EAIColor('class-1', 'light'),EAIColor('class-4', 'light')];
    const HEAD_COLORS_DARK  = [EAIColor('class-1', 'dark'),EAIColor('class-4', 'dark'),EAIColor('class-2', 'dark'),EAIColor('class-0', 'dark'),EAIColor('class-3', 'dark'),EAIColor('class-9', 'dark'),EAIColor('class-5', 'dark'),EAIColor('class-6', 'dark'),EAIColor('class-7', 'dark'),EAIColor('class-8', 'dark'),EAIColor('class-9', 'dark'),EAIColor('class-0', 'dark')];

    function getHeadColors() {
        const theme = document.documentElement.getAttribute('data-theme');
        return theme === 'gruvbox-dark' ? HEAD_COLORS_DARK : HEAD_COLORS_LIGHT;
    }

    // Per-token class colors from CSS custom properties
    function getTokenClassColor(index) {
        const s = getComputedStyle(document.documentElement);
        const color = s.getPropertyValue('--viz-class-' + (index % 10)).trim();
        return color || '#999';
    }
    function tokenColorBg(hex, alpha) {
        const c = parseColor(hex);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha || 0.15) + ')';
    }
    // Opaque tint: blend token color with a base (white or dark bg) at given ratio
    function tokenColorBgOpaque(hex, ratio, baseBg) {
        const c = parseColor(hex);
        const b = baseBg ? parseColor(baseBg) : [255, 255, 255];
        const r = ratio || 0.15;
        return 'rgb(' +
            Math.round(c[0] * r + b[0] * (1 - r)) + ',' +
            Math.round(c[1] * r + b[1] * (1 - r)) + ',' +
            Math.round(c[2] * r + b[2] * (1 - r)) + ')';
    }
    function tokenColorBorder(hex, alpha) {
        const c = parseColor(hex);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha || 0.5) + ')';
    }

    // ============================================
    // Main Visualizer Class (D3/SVG)
    // ============================================
    let clamp;

    class AttentionVisualizer {
        constructor() {
            this.container = d3.select('#attention-svg-container');
            this.svg = this.container.append('svg')
                .attr('viewBox', `0 0 ${CANVAS_W} 700`)
                .attr('preserveAspectRatio', 'xMidYMid meet');

            // Background rect
            this.bgRect = this.svg.append('rect')
                .attr('class', 'svg-bg')
                .attr('width', CANVAS_W)
                .attr('height', 700)
                .attr('fill', 'var(--viz-canvas-bg)');

            // SVG filter definitions for glow effects
            const defs = this.svg.append('defs');

            // Q (query) glow filter
            const filterQ = defs.append('filter')
                .attr('id', 'token-glow-q')
                .attr('x', '-50%').attr('y', '-50%')
                .attr('width', '200%').attr('height', '200%');
            filterQ.append('feGaussianBlur')
                .attr('stdDeviation', '3')
                .attr('result', 'blur');
            filterQ.append('feMerge')
                .selectAll('feMergeNode')
                .data(['blur', 'SourceGraphic'])
                .join('feMergeNode')
                .attr('in', d => d);

            // K (key) glow filter
            const filterK = defs.append('filter')
                .attr('id', 'token-glow-k')
                .attr('x', '-50%').attr('y', '-50%')
                .attr('width', '200%').attr('height', '200%');
            filterK.append('feGaussianBlur')
                .attr('stdDeviation', '3')
                .attr('result', 'blur');
            filterK.append('feMerge')
                .selectAll('feMergeNode')
                .data(['blur', 'SourceGraphic'])
                .join('feMergeNode')
                .attr('in', d => d);

            // Zone groups for layering
            this.gB = this.svg.append('g').attr('class', 'zone-b');
            this.gC = this.svg.append('g').attr('class', 'zone-c');

            // State
            this.sentence = PRESETS['default'].label;
            this.embedDim = 64;
            this.headDim = 64;   // per-head dimension (embedDim / numHeads)
            this.speed = 5;
            this.data = null;

            // Data mode
            this.dataMode = 'gpt2';  // 'synthetic' | 'bert' | 'gpt2'
            this.modelData = null;        // loaded JSON (BERT or GPT-2)
            this.modelLayer = 0;          // selected layer (0-11)
            this.modelHead = 0;           // selected head for single-head view (0-11)

            // Animation state machine
            this.phase = 'IDLE';
            this.phaseProgress = 0;
            this.phaseStartTime = 0;
            this.isProcessing = false;
            this.d3Timer = null;

            // Equation bar state — Set allows multiple chips expanded at once
            this.expandedTerms = new Set();

            // Head-lines view state
            this.numHeads = 12;
            this.hoveredToken = null;
            this.hoveredSide = null;
            this.visibleHeads = new Array(4).fill(true);

            // View mode: 'lines' (BertViz-style) or 'heatmap' (grid)
            this.zoneViewMode = 'lines';
            this.selectedCell = null;  // {i, j} for highlighted cell in heatmap

            // DOM elements
            this.sentenceSelect = document.getElementById('sentence-select');
            this.customSentenceRow = document.getElementById('custom-sentence-row');
            this.customSentenceInput = document.getElementById('custom-sentence');
            this.customSentenceHint = document.getElementById('custom-sentence-hint');
            this.btnRun = document.getElementById('btn-run');
            this.btnStep = document.getElementById('btn-step');
            this.btnReset = document.getElementById('btn-reset');
            this.speedSlider = document.getElementById('speed-slider');
            this.speedValueEl = document.getElementById('speed-value');

            // Data mode controls
            this.btnDataSynthetic = document.getElementById('btn-data-synthetic');
            this.btnDataBert = document.getElementById('btn-data-bert');
            this.btnDataGpt2 = document.getElementById('btn-data-gpt2');
            this.dataBtns = [this.btnDataSynthetic, this.btnDataBert, this.btnDataGpt2];

            this.bindEvents();
            this.init();
        }

        async init() {
            // Default to GPT-2 mode — load data before first render
            try {
                await this.loadModelData('gpt2', SENTENCE_FILE_MAP['default']);
            } catch (e) {
                console.error('Failed to load GPT-2 data, falling back to synthetic:', e);
                this.dataMode = 'synthetic';
                this.embedDim = 4;
                this.headDim = 4;
                this.numHeads = 4;
            }
            this.reset();
        }

        bindEvents() {
            this.btnRun.addEventListener('click', () => this.runAll());
            this.btnStep.addEventListener('click', () => this.stepOnce());
            this.btnReset.addEventListener('click', () => this.reset());

            this.speedSlider.addEventListener('input', () => {
                this.speed = parseInt(this.speedSlider.value);
                this.speedValueEl.textContent = this.speed;
            });

            this.sentenceSelect.addEventListener('change', async () => {
                if (this.sentenceSelect.value === 'custom') {
                    this.customSentenceRow.classList.add('visible');
                    this.customSentenceHint.classList.add('visible');
                    // Custom sentences fall back to synthetic mode
                    if (this.dataMode !== 'synthetic') {
                        this.dataMode = 'synthetic';
                        this.btnDataSynthetic.classList.add('active');
                        this.btnDataBert.classList.remove('active');
                        this.btnDataGpt2.classList.remove('active');
                    }
                } else {
                    this.customSentenceRow.classList.remove('visible');
                    this.customSentenceHint.classList.remove('visible');
                    if (this.dataMode !== 'synthetic') {
                        try {
                            await this.loadModelData(this.dataMode, SENTENCE_FILE_MAP[this.sentenceSelect.value] || '0');
                        } catch (e) {
                            console.error('Failed to load model data:', e);
                        }
                    }
                }
                this.reset();
            });

            this.customSentenceInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.reset();
            });

            // Data mode toggle — shared handler
            const switchToMode = async (mode, btn) => {
                if (this.dataMode === mode) return;
                this.dataBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (mode === 'synthetic') {
                    this.dataMode = 'synthetic';
                    this.embedDim = 4;
                    this.headDim = 4;
                    this.numHeads = 4;
                    this.reset();
                } else {
                    this.dataMode = mode;
                    const sentenceKey = SENTENCE_FILE_MAP[this.sentenceSelect.value] || '0';
                    try {
                        await this.loadModelData(mode, sentenceKey);
                        this.reset();
                    } catch (e) {
                        console.error(`Failed to load ${mode} data:`, e);
                        this.dataMode = 'synthetic';
                        this.dataBtns.forEach(b => b.classList.remove('active'));
                        this.btnDataSynthetic.classList.add('active');
                        this.reset();
                    }
                }
            };

            this.btnDataSynthetic.addEventListener('click', () => switchToMode('synthetic', this.btnDataSynthetic));
            this.btnDataBert.addEventListener('click', () => switchToMode('bert', this.btnDataBert));
            this.btnDataGpt2.addEventListener('click', () => switchToMode('gpt2', this.btnDataGpt2));

            document.addEventListener('themechange', () => {
                this.draw();
            });

        }

        // ============================================
        // Sentence helpers
        // ============================================
        getSentence() {
            const sel = this.sentenceSelect.value;
            if (sel === 'custom') {
                const text = this.customSentenceInput.value.trim();
                if (!text) return PRESETS['default'].label;
                const words = text.split(/\s+/).slice(0, 7);
                return words.join(' ');
            }
            const preset = PRESETS[sel] || PRESETS['default'];
            return preset.label;
        }

        // ============================================
        // Model data loading & mode management
        // ============================================
        async loadModelData(modelPrefix, sentenceKey) {
            const url = `static/data/attention/${modelPrefix}-${sentenceKey}.json`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`Failed to load ${url}`);
            this.modelData = await resp.json();
        }

        getActiveData() {
            if (this.dataMode !== 'synthetic' && this.modelData) {
                const layerData = this.modelData.layers[this.modelLayer];
                const headData = layerData.heads[this.modelHead];
                const N = this.modelData.tokens.length;
                const d = headData.Q[0].length;  // 64

                // Compute raw scores: Q @ K.T
                const rawScores = [];
                for (let i = 0; i < N; i++) {
                    const row = [];
                    for (let j = 0; j < N; j++) {
                        let sum = 0;
                        for (let k = 0; k < d; k++) {
                            sum += headData.Q[i][k] * headData.K[j][k];
                        }
                        row.push(sum);
                    }
                    rawScores.push(row);
                }

                const scaleFactor = Math.sqrt(d);
                const scaledScores = rawScores.map(r => r.map(s => s / scaleFactor));

                // Helper: compute per-head scores
                function computeHeadScores(hData) {
                    const hd = hData.Q[0].length;
                    const rs = [];
                    for (let i = 0; i < N; i++) {
                        const row = [];
                        for (let j = 0; j < N; j++) {
                            let s = 0;
                            for (let k = 0; k < hd; k++) s += hData.Q[i][k] * hData.K[j][k];
                            row.push(s);
                        }
                        rs.push(row);
                    }
                    const sf = Math.sqrt(hd);
                    return { rawScores: rs, scaleFactor: sf, scaledScores: rs.map(r => r.map(v => v / sf)) };
                }

                const heads = layerData.heads.map(h => {
                    const scores = computeHeadScores(h);
                    return {
                        attentionWeights: h.attention_weights,
                        Q: h.Q, K: h.K, V: h.V, outputs: h.output,
                        rawScores: scores.rawScores, scaleFactor: scores.scaleFactor, scaledScores: scores.scaledScores,
                    };
                });

                return {
                    tokens: this.modelData.tokens,
                    embeddings: this.modelData.embeddings_pca,
                    Q: headData.Q, K: headData.K, V: headData.V,
                    rawScores, scaleFactor, scaledScores,
                    attentionWeights: headData.attention_weights,
                    outputs: headData.output,
                    heads: heads,
                };
            }
            return this.data;  // synthetic
        }

        // ============================================
        // Dynamic layout computation
        // ============================================
        computeLayout() {
            const activeData = this.getActiveData();
            const N = activeData ? activeData.tokens.length : 4;
            const isModel = this.dataMode !== 'synthetic' && this.modelData;
            const canvasW = isModel ? 1000 : CANVAS_W;

            const scoreCellSize = Math.min(32, Math.floor((canvasW - 120) / (N + 1)));
            const smallCellSize = Math.min(22, Math.floor((canvasW - 160) / (N + 1)));

            let y = 15;

            // Inline matrix cell sizes for expanded chips
            // In model mode use heatmap cells; in synthetic use text cells
            const eqScale = isModel ? 2.25 : 1;  // scale factor for equation
            const matCellW = isModel ? 8 : 30;
            const matCellH = isModel ? 8 : 16;
            const matPad = 6;
            const defaultChipH = Math.round(42 * eqScale);  // mathSize(18) + chipPadY(4)*2 + 16 for dim label, scaled
            const fracGap = Math.round(4 * eqScale);

            // Matrix dimensions for expanded chips
            const matH = N * matCellH + matPad * 2;  // height of an N-row matrix
            const et = this.expandedTerms || new Set();

            const arrowH = Math.round(20 * eqScale);
            const branchH = Math.round(30 * eqScale);
            const mhProjChipH = Math.round(32 * eqScale);  // shorter projection chips for multi-head
            const embedContentH = et.has('E') ? matH : defaultChipH;

            // --- Vertical dataflow stages ---
            // Stage 1: Token cards + Embedding block side-by-side in one row
            const tokenCardH = Math.round(44 * eqScale);  // card height: word + token ID
            const tokenContainerH = tokenCardH + Math.round(12 * eqScale);  // cards + padding
            const embedRowH = Math.round(18 * eqScale);
            const embedRowGap = Math.round(4 * eqScale);  // space between rows
            const embedRowStride = embedRowH + embedRowGap;  // total step per row
            const embedBlockH = et.has('E') ? matH : Math.round(N * embedRowStride - embedRowGap + 20 * eqScale);
            const multiHead = this.numHeads > 1;
            const projRowH = multiHead ? mhProjChipH : defaultChipH;
            let stage1H = Math.max(tokenContainerH, embedBlockH) + Math.round(16 * eqScale);  // side-by-side + dim label
            // Stage 2: Arrow from token+embed row → projections (skip in multi-head: elbow arrow handles this)
            const stage2H = multiHead ? 0 : arrowH;
            // Stage 3: removed (merged into stage 1)
            const stage3H = 0;
            // Stage 4: Branching from E to projections (skip in multi-head: projections move inside head box)
            const stage4H = multiHead ? 0 : branchH;
            // Stage 5: Projection row [E·Wq][E·Wk][E·Wv] (skip in multi-head: projections move inside head box)
            const stage5H = multiHead ? 0 : projRowH;

            // Pre-compute token container width for multi-head head box sizing
            const scale_layout = eqScale;
            const leftPad_layout = Math.round(10 * scale_layout);
            const rightPad_layout = Math.round(10 * scale_layout);
            const sideBySideGap_layout = Math.round(12 * scale_layout);
            const containerPadX_layout = Math.round(8 * scale_layout);
            const labelColW_layout = Math.round(50 * scale_layout);
            const cardGap_layout = Math.round(4 * scale_layout);
            const cardW_layout = Math.round(Math.min(55 * scale_layout, ((canvasW - leftPad_layout - rightPad_layout - sideBySideGap_layout) * 0.58 - containerPadX_layout * 2 - (N - 1) * cardGap_layout) / N));
            const totalCardsW_layout = N * cardW_layout + (N - 1) * cardGap_layout;
            const tokContainerW_layout = labelColW_layout + totalCardsW_layout + containerPadX_layout * 2;
            const tokContainerX_layout = leftPad_layout;

            // Compute softmax box size from the widest text-chip content (normal mode: softmax ( Q·K^T / √dk ) )
            // so the box never changes size when toggling expanded terms.
            const scale_ = eqScale;
            const mathSize_ = 18 * scale_;
            const smallSize_ = 14 * scale_;
            const charW_ = mathSize_ * 0.55;
            const smallCharW_ = smallSize_ * 0.55;
            const chipPadX_ = 8 * scale_;
            const gap_ = 3 * scale_;
            const smTextW_ = smallCharW_ * 7.5 + chipPadX_ * 2;
            const qTextW_ = charW_ * 1.8 + chipPadX_ * 2;
            const kTextW_ = charW_ * 2.8 + chipPadX_ * 2;
            const dotTextW_ = charW_ * 1.5;
            const scTextW_ = charW_ * 3.8 + chipPadX_ * 2;
            const lparenW_ = charW_ * 1.8;
            const rparenW_ = charW_ * 1.8;
            // Widest text state: softmax label + gap + ( + max(Q·K^T, √dk) + )
            const normalContentW = smTextW_ + gap_ + lparenW_ + Math.max(qTextW_ + dotTextW_ + kTextW_, scTextW_) + rparenW_;
            const softmaxBoxPadY = Math.round(8 * eqScale);
            const softmaxBoxPadX = Math.round(8 * eqScale);
            const softmaxBoxContentW = Math.round(normalContentW + softmaxBoxPadX * 2);
            // Height: fraction needs numerator chip + fracGap + denominator chip + dim labels
            const softmaxBoxContentH = Math.round(defaultChipH * 2 + fracGap + Math.round(20 * eqScale) + softmaxBoxPadY * 2);
            // Perfectly square: use the larger dimension
            const softmaxBoxSide = Math.max(softmaxBoxContentW, softmaxBoxContentH);
            const softmaxBoxW = softmaxBoxSide;
            const softmaxBoxH = softmaxBoxSide;
            // Head box and equation row sized from softmax box
            const equationRowH = softmaxBoxH + Math.round(20 * eqScale);  // softmax box + vertical margins
            const headBoxW = multiHead ? tokContainerW_layout : Math.max(Math.round(300 * eqScale), softmaxBoxW + Math.round(100 * eqScale));
            // Multi-head: headBoxH uses uniform inner padding (matching horizontal gap from box left to softmax left)
            const headBoxInnerPad_layout = multiHead ? Math.round(headBoxW * 0.4 - softmaxBoxW / 2) : 0;
            const headBoxH = multiHead ? (3 * headBoxInnerPad_layout + projRowH + softmaxBoxH) : (defaultChipH + arrowH + equationRowH);

            // Multi-head: head box sits alongside embedding block, right under token box
            const dimLabelSpace = Math.round(16 * eqScale);
            const headBoxGap_layout = Math.round(42 * eqScale);
            const headBoxY_precomputed = y + tokenContainerH + dimLabelSpace + headBoxGap_layout;
            if (multiHead) {
                const leftStackH = (headBoxY_precomputed - y) + headBoxH;
                stage1H = Math.max(leftStackH, embedBlockH + dimLabelSpace);
            }

            // Head gallery: when multiHead, the carousel contains the full per-head equation
            // Active card = full equation height; inactive cards = compact thumbnails
            const galleryTitleH = Math.round(4 * eqScale);   // minimal gap — title drawn above box, not here
            // Nav row height: arrow gap (8+12)*scale + concat box height + dim label space
            const navArrowGapLayout = Math.round(20 * eqScale);  // 8 + 12 scaled
            const concatPadY_layout = Math.round(6 * eqScale);
            const concatTitleH_layout = Math.round(14 * eqScale);
            const concatDotSize_layout = Math.round(19 * eqScale);
            const concatBoxH_layout = concatPadY_layout + concatTitleH_layout + concatDotSize_layout + concatPadY_layout;
            const navDimLabelH = Math.round(16 * eqScale);
            const galleryNavH = navArrowGapLayout + Math.max(concatBoxH_layout, defaultChipH) + navDimLabelH;
            const galleryArrowFromProjH = Math.round(4 * eqScale);  // arrows draw themselves; just a tiny gap
            const headCardEquationH = galleryTitleH + projRowH + arrowH + equationRowH;
            // Thumbnail card for inactive heads
            const thumbCardH = Math.round(N * 8 + 30);
            // Multi-head: head box is absorbed into stage1; gallery is just the nav row
            const stageGalleryH = multiHead ? galleryNavH : 0;

            // Stage 6: Arrows from projections down to softmax box / V (only in single-head mode)
            const stage6H = multiHead ? 0 : arrowH;
            // Stage 7: Softmax equation row (only in single-head mode; in multiHead it's inside the gallery)
            const stage7H = multiHead ? 0 : equationRowH;
            // Multi-head post-gallery stages: W_O → + E (Concat is now the nav bar)
            const woChipH = defaultChipH;
            const stageConcatH = 0;  // Concat is absorbed into the gallery nav area
            const stageWoH = 0;  // W_O is drawn beside the Concat box, not below it
            const stageResidualH = 0;  // + E is drawn beside W_O in the nav row
            // Stage 8: Arrow from equation/gallery to output embedding (shorter in multi-head with combining bracket)
            const stage8H = multiHead ? Math.round(arrowH * 0.5) : arrowH;
            // Stage 9: Output embedding block (collapsed chip or expanded per-token rows)
            const outputExpanded = et.has('output');
            const outputEmbedInnerH = N * (embedRowH + embedRowGap) - embedRowGap;
            const outputEmbedTitleH = Math.round(14 * eqScale);
            const outputEmbedPadY = Math.round(6 * eqScale);
            const outputEmbedExpandedH = outputEmbedTitleH + outputEmbedInnerH + outputEmbedPadY * 2 + Math.round(16 * eqScale);
            const outputCollapsedChipH = Math.round(26 * eqScale);
            const stage9H = outputExpanded ? outputEmbedExpandedH : outputCollapsedChipH + Math.round(16 * eqScale);

            const preGallery = stage1H + stage2H + stage3H + stage4H + stage5H;
            const stage8Gap = multiHead ? 6 : 20;
            const postGallery = stage6H + stage7H + stageConcatH + stageWoH + stageResidualH + stage8H + stage8Gap + stage9H;
            const flowH = preGallery + stageGalleryH + postGallery;
            const B_eq = {
                y: y, h: flowH, matCellW, matCellH,
                multiHead,
                // Stage Y positions (computed cumulatively)
                stage1Y: y,
                stage2Y: y + stage1H,
                stage3Y: y + stage1H + stage2H,
                stage4Y: y + stage1H + stage2H + stage3H,
                stage5Y: y + stage1H + stage2H + stage3H + stage4H,
                stageGalleryY: y + preGallery,
                stageGalleryH: stageGalleryH,
                stage6Y: y + preGallery + stageGalleryH,
                stage7Y: y + preGallery + stageGalleryH + stage6H,
                stageConcatY: y + preGallery + stageGalleryH + stage6H + stage7H,
                stageWoY: y + preGallery + stageGalleryH + stage6H + stage7H + stageConcatH,
                stageResidualY: y + preGallery + stageGalleryH + stage6H + stage7H + stageConcatH + stageWoH,
                stage8Y: y + preGallery + stageGalleryH + stage6H + stage7H + stageConcatH + stageWoH + stageResidualH,
                stage9Y: y + preGallery + stageGalleryH + stage6H + stage7H + stageConcatH + stageWoH + stageResidualH + stage8H + stage8Gap,
                // Stage heights for drawing
                stage1H, stage2H, stage3H, stage4H, stage5H, stage6H, stage7H, stage8H, stage9H,
                stageConcatH, stageWoH, stageResidualH, woChipH,
                headBoxW, headBoxH,
                softmaxBoxPadY, softmaxBoxPadX, softmaxBoxH, softmaxBoxW, equationRowH,
                defaultChipH, mhProjChipH, arrowH, branchH,
                headCardEquationH, thumbCardH, galleryTitleH, galleryNavH, galleryArrowFromProjH,
                tokenCardH, tokenContainerH, embedRowH, embedRowGap, embedRowStride, embedBlockH,
                tokContainerW_precomputed: tokContainerW_layout,
                tokContainerX_precomputed: tokContainerX_layout,
                headBoxY_precomputed,
            };
            y += B_eq.h + ZONE_GAP;

            // Zone C height depends on view mode
            // In model mode: only show Zone C for layer comparison or sentence comparison
            // In synthetic mode: show for lines or heatmap view
            let zoneCHeight;
            if (isModel) {
                zoneCHeight = 0;  // no Zone C needed - BertViz is inline
            } else {
                zoneCHeight = Math.max(155, N * 22 + 35);  // synthetic mode
            }
            const C = { y: y, h: zoneCHeight };
            if (zoneCHeight > 0) y += C.h + ZONE_GAP;

            const canvasH = y + 15;

            this.layout = {
                B_eq, C,
                scoreCellSize, smallCellSize, canvasH, canvasW, isModel,
            };

            // Update SVG viewBox to fit computed layout
            this.svg.attr('viewBox', `0 0 ${canvasW} ${canvasH}`);
            this.bgRect.attr('width', canvasW).attr('height', canvasH);
        }

        // ============================================
        // Reset
        // ============================================
        reset() {
            this.stopAnimation();
            this.sentence = this.getSentence();

            if (this.dataMode !== 'synthetic' && this.modelData) {
                // In model mode, use real data dimensions
                const headData = this.modelData.layers[0].heads[0];
                this.numHeads = this.modelData.layers[0].heads.length;
                this.headDim = headData.Q[0].length;
                this.embedDim = this.headDim * this.numHeads;
                this.data = precompute(this.sentence, 4, 4);  // minimal synthetic fallback
            } else {
                this.headDim = this.embedDim;  // in synthetic mode, no head splitting
                this.data = precompute(this.sentence, this.embedDim, this.numHeads);
            }

            // In model mode, show complete view immediately; in synthetic, start at IDLE
            this.phase = (this.dataMode !== 'synthetic' && this.modelData) ? 'COMPLETE' : 'IDLE';
            this.phaseProgress = 1;
            this.isProcessing = false;
            this.expandedTerms = new Set();

            this.visibleHeads = new Array(this.numHeads).fill(true);
            this.hoveredToken = null;
            this.hoveredSide = null;

            this.computeLayout();
            this.updateMetrics();
            this.draw();
            this.updateRunButtonState();
        }

        // ============================================
        // Phase management
        // ============================================
        getPhaseDuration() {
            const base = Math.max(200, 1400 - this.speed * 120);
            const mult = PHASE_DURATION_MULT[this.phase] || 1;
            return base * mult;
        }

        getNextPhase() {
            const idx = PHASES.indexOf(this.phase);
            if (idx < 0 || idx >= PHASES.length - 1) return 'COMPLETE';
            return PHASES[idx + 1];
        }

        advancePhase() {
            const next = this.getNextPhase();
            if (next === this.phase && next === 'COMPLETE') return false;

            this.phase = next;
            this.phaseProgress = 0;
            this.phaseStartTime = performance.now();

            // Auto-expand the corresponding equation term during animation
            if (PHASE_TERM_MAP[this.phase]) {
                this.expandedTerms.clear();
                this.expandedTerms.add(PHASE_TERM_MAP[this.phase]);
                this.computeLayout();
            }
            if (['SHOW_OUTPUT','COMPLETE'].includes(this.phase)) {
                this.expandedTerms.clear();
                this.computeLayout();
            }

            this.updateMetrics();
            return true;
        }

        // ============================================
        // Step / Run
        // ============================================
        stepOnce() {
            if (this.phase === 'COMPLETE') return;
            this.stopAnimation();
            const advanced = this.advancePhase();
            if (advanced) {
                this.phaseProgress = 1;
                this.updateMetrics();
                this.draw();
            }
        }

        runAll() {
            if (this.isProcessing) return;
            if (this.phase === 'COMPLETE') {
                this.phase = 'IDLE';
                this.phaseProgress = 1;
            }

            this.isProcessing = true;
            this.btnRun.disabled = true;

            if (this.phase === 'IDLE') {
                this.advancePhase();
            }
            this.phaseStartTime = performance.now();

            this.d3Timer = d3.timer((elapsed) => {
                if (!this.isProcessing) return;

                const now = performance.now();
                const phaseElapsed = now - this.phaseStartTime;
                const duration = this.getPhaseDuration();
                this.phaseProgress = clamp(phaseElapsed / duration, 0, 1);

                this.draw();

                if (this.phaseProgress >= 1) {
                    if (this.phase === 'COMPLETE') {
                        this.stopAnimation();
                        return;
                    }
                    const advanced = this.advancePhase();
                    if (!advanced) {
                        this.stopAnimation();
                        return;
                    }
                }
            });
        }

        stopAnimation() {
            if (this.d3Timer) {
                this.d3Timer.stop();
                this.d3Timer = null;
            }
            this.isProcessing = false;
            this.btnRun.disabled = false;
            this.updateRunButtonState();
        }

        // ============================================
        // Metrics
        // ============================================
        updateMetrics() {
            const phaseNames = {
                'IDLE': 'Idle',
                'SHOW_TOKENS': 'Show Tokens',
                'SHOW_EMBEDDINGS': 'Show Embeddings',
                'PROJECT_Q': 'Project Q',
                'PROJECT_K': 'Project K',
                'PROJECT_V': 'Project V',
                'COMPUTE_SCORES': 'Compute Scores',
                'SCALE_SCORES': 'Scale Scores',
                'APPLY_SOFTMAX': 'Apply Softmax',
                'SHOW_OUTPUT': 'Show Output',
                'COMPLETE': 'Complete',
            };

            document.getElementById('metric-phase').textContent = phaseNames[this.phase] || this.phase;
            document.getElementById('metric-num-heads').textContent = this.numHeads;

            const activeData = this.getActiveData();
            if (activeData) {
                const N = activeData.tokens.length;
                document.getElementById('metric-tokens').textContent = N;
                const isModel = this.dataMode !== 'synthetic' && this.modelData;
                if (isModel) {
                    document.getElementById('metric-embed-dim').textContent =
                        this.embedDim + ' (' + this.headDim + '/head)';
                } else {
                    document.getElementById('metric-embed-dim').textContent = this.embedDim;
                }
                document.getElementById('metric-score-matrix').textContent = N + '\u00d7' + N;
                document.getElementById('metric-scale-factor').textContent =
                    '\u221ad\u2096 = \u221a' + this.headDim + ' = ' + activeData.scaleFactor.toFixed(2);

                const phaseIdx = PHASES.indexOf(this.phase);
                const softmaxIdx = PHASES.indexOf('APPLY_SOFTMAX');
                if (phaseIdx >= softmaxIdx && activeData.attentionWeights) {
                    let maxW = -Infinity, minW = Infinity;
                    for (const row of activeData.attentionWeights) {
                        for (const w of row) {
                            if (w > maxW) maxW = w;
                            if (w < minW) minW = w;
                        }
                    }
                    document.getElementById('metric-max-weight').textContent = maxW.toFixed(4);
                    document.getElementById('metric-min-weight').textContent = minW.toFixed(4);
                } else {
                    document.getElementById('metric-max-weight').textContent = '-';
                    document.getElementById('metric-min-weight').textContent = '-';
                }
            }
        }

        // ============================================
        // Drawing — clear and redraw all zones
        // ============================================
        draw() {
            const C = getThemeColors();

            this.bgRect.attr('fill', C.canvasBg);

            // Clear all zone groups
            this.gB.selectAll('*').remove();
            this.gC.selectAll('*').remove();

            this.drawZoneB(C);
            this.drawZoneC(C);
        }

        // ============================================
        // Zone B: Equation Bar + Expansion Panel
        // ============================================
        drawZoneB(C) {
            const phaseIdx = PHASES.indexOf(this.phase);
            const showTokensIdx = PHASES.indexOf('SHOW_TOKENS');

            if (phaseIdx < showTokensIdx) return;
            if (!this.getActiveData()) return;

            this.drawEquationBar(C);
        }

        // ---- Equation with inline matrix expansion (left) + BertViz (right) ----
        // Clicking a chip replaces it with the actual matrix values inline.
        // Hierarchy: QKT replaces numerator, scaled replaces fraction, softmax replaces softmax(…)
        drawEquationBar(C) {
            const g = this.gB;
            const phaseIdx = PHASES.indexOf(this.phase);
            const { B_eq } = this.layout;
            const canvasW = this.layout.canvasW;
            const isModel = this.layout.isModel;
            const zy = B_eq.y;
            const barH = B_eq.h;
            const self = this;
            const activeData = this.getActiveData();
            const N = activeData.tokens.length;
            const d = isModel ? activeData.Q[0].length : this.headDim;
            const dModel = isModel ? this.embedDim : this.headDim;  // full embedding dim (768 for GPT-2/BERT)
            const matCellW = B_eq.matCellW;
            const matCellH = B_eq.matCellH;
            const matPad = 6;
            const et = this.expandedTerms;

            // Determine effective mode for the softmax block (highest expanded level wins)
            const fracMode = et.has('softmax') ? 'softmax'
                           : et.has('scaled') ? 'scaled'
                           : et.has('QKT') ? 'QKT'
                           : 'normal';

            const SERIF = "'Georgia','Times New Roman','Times',serif";
            const SANS = "'Roboto','Helvetica','Arial',sans-serif";
            // Scale up equation in model mode to fill available space
            const scale = isModel ? 2.25 : 1;
            const mathSize = 18 * scale;
            const smallSize = 14 * scale;
            const charW = mathSize * 0.55;
            const smallCharW = smallSize * 0.55;
            const chipPadX = 8 * scale, chipPadY = 4 * scale;
            const defaultChipH = mathSize + chipPadY * 2 + 16 * scale;
            const fracGap = 4 * scale;
            const gap = 3 * scale;

            // --- Helpers ---
            function drawBrackets(parent, bx, by, bw, bh, color) {
                const cap = 4, inset = 1.5;
                parent.append('path')
                    .attr('d', `M${bx+cap+inset},${by+inset} L${bx+inset},${by+inset} L${bx+inset},${by+bh-inset} L${bx+cap+inset},${by+bh-inset}`)
                    .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2);
                parent.append('path')
                    .attr('d', `M${bx+bw-cap-inset},${by+inset} L${bx+bw-inset},${by+inset} L${bx+bw-inset},${by+bh-inset} L${bx+bw-cap-inset},${by+bh-inset}`)
                    .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2);
            }

            function drawMatrixGrid(parent, mx, my, data, rows, cols, color, decimals) {
                if (isModel) {
                    // Heatmap mode for model data: colored cells instead of text
                    let minVal = Infinity, maxVal = -Infinity;
                    for (let i = 0; i < rows; i++) {
                        for (let j = 0; j < cols; j++) {
                            const v = data[i][j];
                            if (v < minVal) minVal = v;
                            if (v > maxVal) maxVal = v;
                        }
                    }
                    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
                    for (let i = 0; i < rows; i++) {
                        for (let j = 0; j < cols; j++) {
                            const cx = mx + matPad + j * matCellW;
                            const cy = my + matPad + i * matCellH;
                            const v = data[i][j];
                            // Diverging scale: blue(negative) -> white(zero) -> red(positive)
                            const t = (v / absMax + 1) / 2;  // 0..1
                            const fillColor = interpolateHeatColor(t, EAIColor('blue'), EAIColor('sunken'), EAIColor('red'));
                            parent.append('rect')
                                .attr('x', cx).attr('y', cy)
                                .attr('width', matCellW).attr('height', matCellH)
                                .attr('fill', fillColor);
                        }
                    }
                } else {
                    // Text mode for synthetic
                    const dec = decimals || 1;
                    for (let i = 0; i < rows; i++) {
                        for (let j = 0; j < cols; j++) {
                            const cx = mx + matPad + j * matCellW;
                            const cy = my + matPad + i * matCellH;
                            parent.append('text')
                                .attr('x', cx + matCellW / 2).attr('y', cy + matCellH / 2)
                                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                .attr('font-family', MONO).attr('font-size', 8)
                                .attr('fill', color)
                                .text(data[i][j].toFixed(dec));
                        }
                    }
                }
            }

            function makeChip(chipX, chipY, chipW, chipH, chip, opts) {
                const requiredPhase = TERM_PHASE_MAP[chip.id];
                const requiredIdx = PHASES.indexOf(requiredPhase);
                const isLocked = phaseIdx < requiredIdx;
                const isActive = et.has(chip.id);
                const color = isLocked ? C.textMuted : (chip.border || chip.color);
                const noBrackets = opts && opts.noBrackets;
                const isMatrix = opts && opts.isMatrix;

                // Use dedicated bg color if available, otherwise fall back to color+opacity
                const hasBg = !isLocked && chip.bg;
                const bgColor = hasBg ? chip.bg : chip.color;
                const bgOpacity = hasBg ? 1 : (isActive ? 0.18 : 0);

                const chipG = g.append('g')
                    .attr('class', 'eq-chip' + (isLocked ? ' locked' : '') + (isActive ? ' active' : ''));

                // White undercoat so semi-transparent bg colors aren't affected by what's behind
                chipG.append('rect').attr('class', 'eq-chip-undercoat')
                    .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', C.canvasBg || '#ffffff');
                chipG.append('rect').attr('class', 'eq-chip-bg')
                    .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', bgColor).attr('opacity', bgOpacity);

                chipG.append('rect').attr('class', 'eq-chip-border')
                    .attr('x', chipX).attr('y', chipY).attr('width', chipW).attr('height', chipH)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', 'none').attr('stroke', color)
                    .attr('stroke-opacity', 1)
                    .attr('opacity', 1)
                    .attr('stroke-width', isActive ? 2.5 : 2);

                // Corner brackets removed — using plain borders only

                if (!isLocked && !(opts && opts.nonExpandable)) {
                    chipG.attr('cursor', 'pointer')
                        .on('click', function() {
                            if (et.has(chip.id)) {
                                et.delete(chip.id);
                            } else {
                                et.add(chip.id);
                            }
                            self.computeLayout();
                            self.draw();
                        });
                }
                return chipG;
            }

            function staticText(tx, ty, text, size, fill) {
                g.append('text')
                    .attr('x', tx).attr('y', ty)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SERIF).attr('font-size', size)
                    .attr('fill', fill || C.canvasText).text(text);
            }

            // Draw dimension label below an element
            function dimLabel(cx, bottomY, dimText) {
                g.append('text')
                    .attr('x', cx).attr('y', bottomY + 12 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                    .attr('fill', C.textMuted).attr('opacity', 0.7)
                    .text(dimText);
            }
            // Draw dimension label inside a chip, below the variable name
            function chipDimLabel(parent, cx, cy, dimText) {
                parent.append('text')
                    .attr('x', cx).attr('y', cy)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                    .attr('fill', C.textMuted).attr('opacity', 0.7)
                    .text(dimText);
            }

            // --- Chip definitions (color = text/border, bg = fill background, fill = accent) ---
            const chipTokens = { id: 'tokens', color: C.tokenText, border: C.tokenBorder };
            const chipE   = { id: 'E',       color: C.embedPos };
            const chipQ   = { id: 'Q',       color: C.qText,   bg: C.qBg,   border: C.qBorder,   fill: C.qFill };
            const chipK   = { id: 'K',       color: C.kText,   bg: C.kBg,   border: C.kBorder,   fill: C.kFill };
            const chipV   = { id: 'V',       color: C.vText,   bg: C.vBg,   border: C.vBorder,   fill: C.vFill };
            const chipQKT = { id: 'QKT',     color: C.scaleLabel };
            const chipSc  = { id: 'scaled',  color: C.scaleLabel };
            const chipSm  = { id: 'softmax', color: C.sectionTitle, bg: 'rgba(150,150,150,0.10)', border: C.sectionTitle };
            const chipCtx = { id: 'ctxVectors', color: C.sectionTitle, bg: 'rgba(150,150,150,0.18)', border: C.sectionTitle };
            const chipResE = { id: 'resE', color: C.embedPos };

            // --- Matrix dimensions ---
            function matDims(rows, cols) {
                return { w: cols * matCellW + matPad * 2, h: rows * matCellH + matPad * 2 };
            }
            const matNxN = matDims(N, N);
            const matNxD = matDims(N, d);

            // --- Chip text widths ---
            const smTextW = smallCharW * 7.5 + chipPadX * 2;
            const qTextW = charW * 1.8 + chipPadX * 2;
            const kTextW = charW * 2.8 + chipPadX * 2;
            const dotTextW = charW * 1.5;
            const scTextW = charW * 3.8 + chipPadX * 2;
            const vTextW = charW * 2 + chipPadX * 2;
            const lparenW = charW * 1.8;
            const rparenW = charW * 1.8;
            const eChipTextW = charW * 1.8 + chipPadX * 2;
            const attnScoresTextW = charW * 10 + chipPadX * 2;  // "Attn Scores" label

            // --- Vertical flow uses stage Y positions from computeLayout ---
            const arrowH = B_eq.arrowH;
            const branchH = B_eq.branchH;
            const showEMatrix = et.has('E');
            const eChipW = showEMatrix ? matNxD.w : eChipTextW;
            const eChipH = showEMatrix ? matNxD.h : defaultChipH;
            const availableW = canvasW;
            const flowCenterX = availableW / 2 + Math.round(20 * scale);

            // ============ STAGE 1: TOKEN CARDS + EMBEDDING BLOCK (side-by-side) ============
            const stage1Y = B_eq.stage1Y;
            const tokenCardH = B_eq.tokenCardH;
            const tokensActive = phaseIdx >= PHASES.indexOf('SHOW_TOKENS');
            const embedActive = phaseIdx >= PHASES.indexOf('SHOW_EMBEDDINGS');
            const embedRowH = B_eq.embedRowH;
            const embedRowGap = B_eq.embedRowGap;
            const embedRowStride = B_eq.embedRowStride;
            const embedBlockH = B_eq.embedBlockH;
            const baseBg = C.canvasBg || '#ffffff';

            // Shared sizing
            const sideBySideGap = Math.round(12 * scale);  // gap between the two blocks
            const containerPadX = Math.round(8 * scale);
            const containerPadY = Math.round(6 * scale);
            const wordFontSize = Math.round(7.5 * scale);
            const idFontSize = Math.round(7.5 * scale);
            const timeFontSize = Math.round(7 * scale);
            const labelFontSize = Math.round(7.5 * scale);
            const labelColW = Math.round(50 * scale);  // width for row labels (Time/Prompt/Tokens) inside container
            const leftPad = Math.round(10 * scale);  // keep off left edge
            const rightPad = Math.round(10 * scale);  // keep off right edge

            // Available width for both blocks side-by-side
            const rowAvailW = canvasW - leftPad - rightPad - sideBySideGap;

            // Token card sizing — tokens get ~55% of available, embed gets ~45%
            const tokFrac = 0.58;
            const tokBudgetW = Math.round(rowAvailW * tokFrac);
            const cardGap = Math.round(4 * scale);
            const cardW = Math.round(Math.min(55 * scale, (tokBudgetW - containerPadX * 2 - (N - 1) * cardGap) / N));
            const totalCardsW = N * cardW + (N - 1) * cardGap;
            const tokContainerW = labelColW + totalCardsW + containerPadX * 2;
            const tokTitleH = Math.round(14 * scale);  // space for "Tokenization" title
            const tokContainerH = tokTitleH + tokenCardH + containerPadY * 2;

            // Embedding block sizing — fills the remaining space
            const embedPadX = Math.round(8 * scale);
            const embedPadY = Math.round(6 * scale);
            const embedTitleH = Math.round(14 * scale);
            const embedInnerH = N * embedRowStride - embedRowGap;
            const embedContainerH = embedTitleH + embedInnerH + embedPadY * 2;
            // Horizontal positions: token block on left, embed block fills remaining space
            const tokContainerX = leftPad;
            const embedContainerX = tokContainerX + tokContainerW + sideBySideGap;
            const embedContainerW = showEMatrix ? matNxD.w : (canvasW - embedContainerX - rightPad);

            // Top-align both blocks
            const rowH = Math.max(tokContainerH, showEMatrix ? matNxD.h : embedContainerH);
            const tokOffsetY = stage1Y;
            const embedOffsetY = stage1Y;

            // --- Draw token cards container ---
            const cardsStartX = tokContainerX + labelColW + containerPadX;

            g.append('rect')
                .attr('x', tokContainerX).attr('y', tokOffsetY)
                .attr('width', tokContainerW).attr('height', tokContainerH)
                .attr('rx', 5).attr('ry', 5)
                .attr('fill', tokensActive ? C.tokenBg : 'none')
                .attr('stroke', tokensActive ? C.tokenBorder : C.textMuted)
                .attr('stroke-width', 3)
                .attr('opacity', tokensActive ? 1 : 0.4);

            // "Tokenization" title
            g.append('text')
                .attr('x', tokContainerX + tokContainerW / 2)
                .attr('y', tokOffsetY + containerPadY + tokTitleH * 0.5)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', SANS).attr('font-size', Math.round(11 * scale))
                .attr('font-weight', 'bold')
                .attr('fill', tokensActive ? C.tokenBorder : C.textMuted)
                .text('Tokenization');

            // Row labels (Time / Prompt / Tokens) inside container, left of cards
            const labelX = tokContainerX + labelColW - Math.round(5 * scale);
            const firstCardY = tokOffsetY + containerPadY + tokTitleH;
            const labelRows = [
                { text: 'Prompt', yFrac: 0.35 },
                { text: 'Tokens', yFrac: 0.72 },
            ];
            for (const lr of labelRows) {
                g.append('text')
                    .attr('x', labelX).attr('y', firstCardY + tokenCardH * lr.yFrac)
                    .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', labelFontSize)
                    .attr('font-weight', 'bold')
                    .attr('fill', C.textMuted)
                    .attr('opacity', tokensActive ? 0.7 : 0.3)
                    .text(lr.text);
            }

            // Individual token cards
            let tokenIds = activeData.tokenIds;
            if (!tokenIds) {
                const preset = Object.values(PRESETS).find(p => p.label === self.sentence);
                if (preset) tokenIds = preset.tokens.map(t => t.id);
            }
            for (let i = 0; i < N; i++) {
                const cx = cardsStartX + i * (cardW + cardGap);
                const cy = firstCardY;
                const tokenColor = getTokenClassColor(i);
                const bgColor = tokensActive ? tokenColorBgOpaque(tokenColor, 0.15, baseBg) : 'none';
                const borderColor = tokensActive ? tokenColorBorder(tokenColor, 0.5) : C.textMuted;

                g.append('rect')
                    .attr('x', cx).attr('y', cy)
                    .attr('width', cardW).attr('height', tokenCardH)
                    .attr('rx', 3).attr('ry', 3)
                    .attr('fill', bgColor)
                    .attr('stroke', borderColor)
                    .attr('stroke-width', 1.2);

                g.append('text')
                    .attr('x', cx + cardW / 2).attr('y', cy + tokenCardH * 0.35)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', wordFontSize)
                    .attr('font-weight', 'bold')
                    .attr('fill', tokensActive ? C.canvasText : C.textMuted)
                    .text(activeData.tokens[i]);

                const idStr = (i === 0 ? '[' : '') + (tokenIds ? tokenIds[i] : i) + (i === N - 1 ? ']' : '');
                g.append('text')
                    .attr('x', cx + cardW / 2).attr('y', cy + tokenCardH * 0.72)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', idFontSize)
                    .attr('fill', tokensActive ? C.canvasText : C.textMuted)
                    .attr('opacity', 0.7)
                    .text(idStr);
            }

            // Dimension label below token container
            dimLabel(tokContainerX + tokContainerW / 2, tokOffsetY + tokContainerH, `<1, ${N}>`);

            // --- Elbow arrow: down from token box, then right into embedding box ---
            const elbowColor = embedActive ? C.canvasText : C.textMuted;
            const elbowStrokeW = 1.2 * scale;
            const elbowTipW = 6 * scale;
            const elbowTipHalfH = 3.5 * scale;
            // Start: bottom of token container at ~2/3 across
            const elbowX1 = tokContainerX + tokContainerW * 2 / 3;
            const elbowY1 = tokOffsetY + tokContainerH;
            // Corner: go a bit lower than the token box bottom, meet horizontal at embed midpoint
            const embedMidY = embedOffsetY + (showEMatrix ? matNxD.h : embedContainerH) / 2;
            const elbowDropExtra = Math.round(12 * scale);  // extra drop below token box
            const elbowCornerY = Math.max(elbowY1 + elbowDropExtra, embedMidY);
            // End: left edge of embedding container
            const elbowX2 = embedContainerX;
            // Vertical segment (down)
            g.append('line')
                .attr('x1', elbowX1).attr('y1', elbowY1)
                .attr('x2', elbowX1).attr('y2', elbowCornerY)
                .attr('stroke', elbowColor).attr('stroke-width', elbowStrokeW);
            // Horizontal segment (right)
            g.append('line')
                .attr('x1', elbowX1).attr('y1', elbowCornerY)
                .attr('x2', elbowX2 - elbowTipW).attr('y2', elbowCornerY)
                .attr('stroke', elbowColor).attr('stroke-width', elbowStrokeW);
            // Arrowhead (pointing right)
            g.append('path')
                .attr('d', `M${elbowX2},${elbowCornerY} L${elbowX2 - elbowTipW},${elbowCornerY - elbowTipHalfH} L${elbowX2 - elbowTipW},${elbowCornerY + elbowTipHalfH} Z`)
                .attr('fill', elbowColor).attr('stroke', 'none');

            // --- Draw embedding block (right side) ---
            if (showEMatrix) {
                // Expanded: full matrix grid
                const eChipX = embedContainerX;
                const eChipG = makeChip(eChipX, embedOffsetY, matNxD.w, matNxD.h, chipE, { isMatrix: true });
                drawMatrixGrid(eChipG, eChipX, embedOffsetY, activeData.embeddings, N, d, C.embedPos);
                dimLabel(eChipX + matNxD.w / 2, embedOffsetY + matNxD.h, `<${N}, ${dModel}>`);
            } else {
                // Collapsed: RNN-style embedding block with per-token rows
                const embedG = g.append('g').attr('cursor', 'pointer')
                    .on('click', function() {
                        if (et.has('E')) et.delete('E'); else et.add('E');
                        self.computeLayout();
                        self.draw();
                    });

                embedG.append('rect')
                    .attr('x', embedContainerX).attr('y', embedOffsetY)
                    .attr('width', embedContainerW).attr('height', embedContainerH)
                    .attr('rx', 5).attr('ry', 5)
                    .attr('fill', embedActive ? C.embedPos : 'none')
                    .attr('fill-opacity', embedActive ? 0.1 : 0)
                    .attr('stroke', embedActive ? C.embedPos : C.textMuted)
                    .attr('stroke-width', 3)
                    .attr('opacity', embedActive ? 1 : 0.4);

                // "Embedding" title
                const embedCenterX = embedContainerX + embedContainerW / 2;
                embedG.append('text')
                    .attr('x', embedCenterX).attr('y', embedOffsetY + embedPadY + embedTitleH * 0.5)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SANS).attr('font-size', Math.round(11 * scale))
                    .attr('font-weight', 'bold')
                    .attr('fill', embedActive ? C.embedPos : C.textMuted)
                    .text('Embedding');

                // Per-token embedding rows
                const rowStartY = embedOffsetY + embedPadY + embedTitleH;
                const tokenIdBoxW = Math.round(28 * scale);
                const vecBarPad = Math.round(4 * scale);

                for (let i = 0; i < N; i++) {
                    const ry = rowStartY + i * embedRowStride;
                    const tokenColor = getTokenClassColor(i);
                    // Same opaque color as token cards in tokenization box
                    const tokenBgColor = tokenColorBgOpaque(tokenColor, 0.15, baseBg);

                    // Use same border style as token cards: tokenColorBorder(0.5), stroke-width 1.2
                    const borderColor = embedActive ? tokenColorBorder(tokenColor, 0.5) : C.textMuted;

                    const idBoxX = embedContainerX + embedPadX;
                    embedG.append('rect')
                        .attr('x', idBoxX).attr('y', ry + 1)
                        .attr('width', tokenIdBoxW).attr('height', embedRowH - 2)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', embedActive ? tokenBgColor : 'none')
                        .attr('stroke', borderColor)
                        .attr('stroke-width', 1.2);
                    embedG.append('text')
                        .attr('x', idBoxX + tokenIdBoxW / 2).attr('y', ry + embedRowH / 2)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(7 * scale))
                        .attr('font-weight', 'bold')
                        .attr('fill', embedActive ? C.canvasText : C.textMuted)
                        .text(activeData.tokens[i]);

                    const vecX = idBoxX + tokenIdBoxW + vecBarPad;
                    const vecW = embedContainerW - embedPadX * 2 - tokenIdBoxW - vecBarPad;
                    embedG.append('rect')
                        .attr('x', vecX).attr('y', ry + 1)
                        .attr('width', vecW).attr('height', embedRowH - 2)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', embedActive ? tokenBgColor : 'none')
                        .attr('stroke', borderColor)
                        .attr('stroke-width', 1.2);
                    embedG.append('text')
                        .attr('x', vecX + vecW / 2).attr('y', ry + embedRowH / 2)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(6.5 * scale))
                        .attr('fill', C.textMuted)
                        .attr('opacity', 0.7)
                        .text(`<1, ${dModel}>`);
                }

                // Dimension label below embed block
                dimLabel(embedCenterX, embedOffsetY + embedContainerH, `<${N}, ${dModel}>`);
            }

            // --- Arrow from combined row down to branching (Stage 2) ---
            // Helper: draw a filled triangular arrowhead at (ax, ay) pointing down
            const arrowTipH = 6 * scale;
            const arrowTipHalfW = 3.5 * scale;
            function arrowHead(ax, ay, color) {
                g.append('path')
                    .attr('d', `M${ax},${ay} L${ax - arrowTipHalfW},${ay - arrowTipH} L${ax + arrowTipHalfW},${ay - arrowTipH} Z`)
                    .attr('fill', color).attr('stroke', 'none');
            }
            // Helper: draw a vertical arrow line from y1 to y2, stopping short for arrowhead
            function arrowLine(ax, y1, y2, color, dashed) {
                g.append('line')
                    .attr('x1', ax).attr('y1', y1)
                    .attr('x2', ax).attr('y2', y2 - arrowTipH)
                    .attr('stroke', color).attr('stroke-width', 1.2 * scale)
                    .attr('stroke-dasharray', dashed ? `${3 * scale},${3 * scale}` : 'none');
                arrowHead(ax, y2, color);
            }
            // Helper: draw a curved arrow from (x1,y1) to (x2,y2) with bezier control points
            function curvedArrow(x1, y1, x2, y2, color, dashed) {
                const midY = y1 + (y2 - y1) * 0.5;
                g.append('path')
                    .attr('d', `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2 - arrowTipH}`)
                    .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2 * scale)
                    .attr('stroke-dasharray', dashed ? `${3 * scale},${3 * scale}` : 'none');
                arrowHead(x2, y2, color);
            }

            const arrow1Color = embedActive ? C.canvasText : C.textMuted;
            if (!B_eq.multiHead) {
                arrowLine(flowCenterX, B_eq.stage2Y, B_eq.stage2Y + arrowH, arrow1Color);
            }

            // ============ STAGE 4-5: BRANCHING & PROJECTION ROW ============
            // Chip definitions needed by both single-head and multi-head paths
            const wChipW = charW * 5 + chipPadX * 2;
            const wSmallGap = gap * 1.2;   // tight gap between E·Wq and E·Wk
            const wLargeGap = gap * 6;     // large gap separating E·Wv on the right

            const wChips = [
                { label: 'E\u00b7W\u0071', sub: 'q', result: 'Q', color: C.qText, bg: C.qBg, border: C.qBorder, fill: C.qFill, phase: 'PROJECT_Q' },
                { label: 'E\u00b7W\u2096', result: 'K', color: C.kText, bg: C.kBg, border: C.kBorder, fill: C.kFill, phase: 'PROJECT_K' },
                { label: 'E\u00b7W\u1d65', result: 'V', color: C.vText, bg: C.vBg, border: C.vBorder, fill: C.vFill, phase: 'PROJECT_V' },
            ];

            let projChipCenters;

            // Helper to draw projection chips at a given Y position and set of X positions
            function drawProjectionChips(projChipXs, projRowY_local, showBranch, branchFromX) {
                for (let wi = 0; wi < 3; wi++) {
                    const wc = wChips[wi];
                    const wx = projChipXs[wi];
                    const wCenterX = wx + wChipW / 2;
                    const wLocked = phaseIdx < PHASES.indexOf(wc.phase);
                    const wColor = wLocked ? C.textMuted : wc.color;
                    const wBorderColor = wLocked ? C.textMuted : wc.border;

                    if (showBranch) {
                        // Branching curve: source → chip top center
                        const branchColor = wLocked ? C.textMuted : C.embedPos;
                        const bStartY = B_eq.stage4Y;
                        const bEndY = projRowY_local;
                        const bLineEndY = bEndY - arrowTipH;
                        const bMidY = bStartY + (bLineEndY - bStartY) * 0.5;
                        g.append('path')
                            .attr('d', `M${branchFromX},${bStartY} C${branchFromX},${bMidY} ${wCenterX},${bMidY} ${wCenterX},${bLineEndY}`)
                            .attr('fill', 'none').attr('stroke', branchColor)
                            .attr('stroke-width', 1.2 * scale);
                        arrowHead(wCenterX, bEndY, branchColor);
                    }

                    // Projection chip — uses dedicated bg/border CSS colors
                    const wChipG = g.append('g');
                    wChipG.append('rect')
                        .attr('x', wx).attr('y', projRowY_local).attr('width', wChipW).attr('height', defaultChipH)
                        .attr('rx', 3).attr('ry', 3)
                        .attr('fill', wLocked ? C.textMuted : wc.bg).attr('opacity', wLocked ? 0.06 : 1);
                    wChipG.append('rect')
                        .attr('x', wx).attr('y', projRowY_local).attr('width', wChipW).attr('height', defaultChipH)
                        .attr('rx', 3).attr('ry', 3)
                        .attr('fill', 'none').attr('stroke', wBorderColor).attr('stroke-width', 2);
                    // Split label so "E·" is embedding blue and "W_" keeps chip color
                    const eLabelColor = wLocked ? C.textMuted : C.embedPos;
                    const wLabelText = wChipG.append('text')
                        .attr('x', wCenterX).attr('y', projRowY_local + defaultChipH / 2 - 6 * scale)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', mathSize * 0.65)
                        .attr('font-style', 'italic').attr('font-weight', 'bold');
                    wLabelText.append('tspan').attr('fill', eLabelColor).text('E\u00b7');
                    wLabelText.append('tspan').attr('fill', wColor).text(wc.label.replace('E\u00b7', ''));
                    chipDimLabel(wChipG, wCenterX, projRowY_local + defaultChipH / 2 + 7 * scale, `<${dModel}, ${d}>`);
                }
            }

            if (!B_eq.multiHead) {
                // Single-head: draw projections outside head box
                const branchTopY = B_eq.stage4Y;
                const projRowY = B_eq.stage5Y;

                // Layout: [E·Wq][small gap][E·Wk]  [large gap]  [E·Wv]
                const leftGroupW = wChipW * 2 + wSmallGap;
                const projTotalW = leftGroupW + wLargeGap + wChipW;
                const projStartX = flowCenterX - projTotalW / 2;

                const projChipXs = [
                    projStartX,                                    // E·Wq
                    projStartX + wChipW + wSmallGap,               // E·Wk
                    projStartX + leftGroupW + wLargeGap,           // E·Wv (isolated right)
                ];
                projChipCenters = projChipXs.map(x => x + wChipW / 2);

                drawProjectionChips(projChipXs, projRowY, true, flowCenterX);
            }

            // ============ SHARED EQUATION DRAWING HELPER ============
            // Draws softmax(Q·K^T/√dk)·V + E for a given head's data.
            // Returns { ctxUnderlayX, ctxUnderlayY, ctxUnderlayW, ctxUnderlayH, qTargetCenterX, qTargetTopY, kTargetCenterX, kTargetTopY, vChipCenterX, vChipTopY, resECenterX, resEChipY, smBoxCenterY }
            function drawEquationForHead(centerX, topY, headQ, headK, headV, headRawScores, headScaledScores, headAttnWeights, headLabel, skipResidualE) {
                const softmaxBoxH_h = B_eq.softmaxBoxH;
                const softmaxBoxW_h = B_eq.softmaxBoxW;
                const softmaxBoxY_h = topY + Math.round(12 * scale);
                const smBoxCenterY_h = softmaxBoxY_h + softmaxBoxH_h / 2;

                // Fixed box position — content must fit inside, not the other way around
                const softmaxBoxX_h = centerX - softmaxBoxW_h / 2;
                const padX = B_eq.softmaxBoxPadX;

                // Content starts at left edge of box + padding
                let sx_h = softmaxBoxX_h + padX;

                // Available inner width for content inside the softmax box
                const innerW = softmaxBoxW_h - padX * 2;

                // V chip position (right of softmax box, fixed)
                const showVMatrix = et.has('V');
                const vW_h = showVMatrix ? matNxD.w : vTextW;
                const dotVGap_h = gap * 2;
                const softmaxBoxRightEdge = softmaxBoxX_h + softmaxBoxW_h;
                const totalDotVSpace = dotVGap_h * 2 + charW;
                const dotCenterX_h = softmaxBoxRightEdge + totalDotVSpace / 2;
                const vChipX_h = softmaxBoxRightEdge + totalDotVSpace;
                const vChipCenterX_h = vChipX_h + vW_h / 2;

                // Context underlay spans from softmax box left to V chip right
                const ctxUnderlayPad_h = Math.round(8 * scale);
                const ctxUnderlayX_h = softmaxBoxX_h - ctxUnderlayPad_h;
                const ctxUnderlayY_h = softmaxBoxY_h - ctxUnderlayPad_h;
                const ctxUnderlayW_h = (vChipX_h + vW_h) - softmaxBoxX_h + ctxUnderlayPad_h * 2;
                const ctxUnderlayH_h = softmaxBoxH_h + ctxUnderlayPad_h * 2;

                // Draw the fixed softmax box as underlay (behind content)
                const smBoxChipG_h = makeChip(softmaxBoxX_h, softmaxBoxY_h, softmaxBoxW_h, softmaxBoxH_h, chipSm);

                // "Attention Scores" title in upper-left corner of softmax box
                const smTitlePad = Math.round(6 * scale);
                smBoxChipG_h.append('text')
                    .attr('x', softmaxBoxX_h + smTitlePad).attr('y', softmaxBoxY_h + smTitlePad)
                    .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
                    .attr('font-family', SANS).attr('font-size', Math.round(7 * scale))
                    .attr('font-weight', 'bold')
                    .attr('fill', chipSm.color).attr('opacity', 0.7)
                    .text('Attention Scores');

                // Track Q/K^T positions
                let qTCX = centerX - 20 * scale, kTCX = centerX + 20 * scale;
                let qTTY = softmaxBoxY_h, kTTY = softmaxBoxY_h;
                // Axis arrow targets (set when softmax heatmap is shown)
                let qAxisX = null, qAxisY = null, kAxisX = null, kAxisY = null;

                // Compute local matrix cell sizes that fit within the box
                // For NxN matrices: must fit within innerW and innerH (box minus padding)
                const innerH = softmaxBoxH_h - B_eq.softmaxBoxPadY * 2;
                const fitNxNCellW = Math.min(matCellW, Math.floor((innerW - matPad * 2) / N));
                const fitNxNCellH = Math.min(matCellH, Math.floor((innerH - matPad * 2) / N));
                const fitNxNCell = Math.max(2, Math.min(fitNxNCellW, fitNxNCellH));
                const localMatNxN = { w: N * fitNxNCell + matPad * 2, h: N * fitNxNCell + matPad * 2 };
                // For NxD matrices (expanded Q/K): scale down if needed
                const fitNxDCellW = Math.min(matCellW, Math.floor((innerW / 2 - matPad * 2 - dotTextW) / d));
                const fitNxDCellH = Math.min(matCellH, Math.floor((innerH - matPad * 2) / N));
                const fitNxDCell = Math.max(1, Math.min(fitNxDCellW, fitNxDCellH));
                const localMatNxD = { w: d * fitNxDCell + matPad * 2, h: N * fitNxDCell + matPad * 2 };

                // Local version of drawMatrixGrid that uses fitted cell sizes
                function drawFittedMatrixGrid(parent, mx, my, data, rows, cols, color, decimals, cellSz) {
                    if (isModel) {
                        let minVal = Infinity, maxVal = -Infinity;
                        for (let i = 0; i < rows; i++) {
                            for (let j = 0; j < cols; j++) {
                                const v = data[i][j];
                                if (v < minVal) minVal = v;
                                if (v > maxVal) maxVal = v;
                            }
                        }
                        const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
                        for (let i = 0; i < rows; i++) {
                            for (let j = 0; j < cols; j++) {
                                const cx = mx + matPad + j * cellSz;
                                const cy = my + matPad + i * cellSz;
                                const v = data[i][j];
                                const t = (v / absMax + 1) / 2;
                                const fillColor = interpolateHeatColor(t, EAIColor('blue'), EAIColor('sunken'), EAIColor('red'));
                                parent.append('rect')
                                    .attr('x', cx).attr('y', cy)
                                    .attr('width', cellSz).attr('height', cellSz)
                                    .attr('fill', fillColor);
                            }
                        }
                    } else {
                        const dec = decimals || 1;
                        for (let i = 0; i < rows; i++) {
                            for (let j = 0; j < cols; j++) {
                                const cx = mx + matPad + j * cellSz;
                                const cy = my + matPad + i * cellSz;
                                parent.append('text')
                                    .attr('x', cx + cellSz / 2).attr('y', cy + cellSz / 2)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                    .attr('font-family', MONO).attr('font-size', 8)
                                    .attr('fill', color)
                                    .text(data[i][j].toFixed(dec));
                            }
                        }
                    }
                }

                if (fracMode === 'softmax') {
                    // Fill the softmax box with a proper attention heatmap
                    const heatPad = Math.round(6 * scale);
                    const labelPad = Math.round(30 * scale);  // space for token labels
                    const availHeatW = softmaxBoxW_h - heatPad * 2 - labelPad;
                    const availHeatH = softmaxBoxH_h - heatPad * 2 - labelPad;
                    const heatCellSize = Math.floor(Math.min(availHeatW, availHeatH) / N);
                    const gridW = heatCellSize * N;
                    const gridH = heatCellSize * N;
                    const gridX = softmaxBoxX_h + labelPad + (availHeatW - gridW) / 2 + heatPad;
                    const gridY = softmaxBoxY_h + labelPad + (availHeatH - gridH) / 2 + heatPad;

                    // Draw heatmap cells (masked cells shown as grey with "-")
                    const isCausal = self.dataMode === 'gpt2';
                    for (let i = 0; i < N; i++) {
                        for (let j = 0; j < N; j++) {
                            const cx = gridX + j * heatCellSize;
                            const cy = gridY + i * heatCellSize;
                            const w = headAttnWeights[i][j];
                            const masked = isCausal && j > i;
                            // Smooth white → yellow → red
                            const cellColor = masked ? 'none' : interpolateHeatColor(w, C.heatCool, C.heatMid, C.heatWarm);
                            smBoxChipG_h.append('rect')
                                .attr('x', cx).attr('y', cy)
                                .attr('width', heatCellSize - 3).attr('height', heatCellSize - 3)
                                .attr('fill', masked ? C.canvasBg : cellColor)
                                .attr('stroke', masked ? C.textMuted : 'none')
                                .attr('stroke-width', masked ? 0.5 : 0)
                                .attr('stroke-opacity', masked ? 0.3 : 0)
                                .attr('rx', 3).attr('ry', 3);
                            if (masked) {
                                smBoxChipG_h.append('text')
                                    .attr('x', cx + (heatCellSize - 3) / 2).attr('y', cy + (heatCellSize - 3) / 2)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                    .attr('font-family', MONO).attr('font-size', Math.min(heatCellSize * 0.35, 10 * scale))
                                    .attr('fill', C.textMuted).attr('opacity', 0.4)
                                    .text('\u2013');
                            } else if (heatCellSize > 20) {
                                const textColor = w > 0.7 ? EAIColor('surface') : C.canvasText;
                                const displayVal = w < 0.01 ? '' : w.toFixed(2);
                                smBoxChipG_h.append('text')
                                    .attr('x', cx + (heatCellSize - 3) / 2).attr('y', cy + (heatCellSize - 3) / 2)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                    .attr('font-family', MONO).attr('font-size', Math.min(heatCellSize * 0.3, 10 * scale))
                                    .attr('fill', textColor).text(displayVal);
                            }
                        }
                    }

                    // Row labels (query tokens) on the left — boxed with token colors + index
                    const tokens = activeData.tokens;
                    const labelFontSize = Math.min(heatCellSize * 0.4, 8 * scale);
                    const idxFontSize = Math.round(labelFontSize * 0.7);
                    const tokenBoxPad = Math.round(1.5 * scale);
                    const tokenBoxH = heatCellSize - 6;
                    const tokenBoxGap = Math.round(5 * scale);
                    // Compute uniform row label width from longest token
                    let maxTokenTextW = 0;
                    for (let i = 0; i < N; i++) {
                        const tw = tokens[i].length * labelFontSize * 0.65;
                        if (tw > maxTokenTextW) maxTokenTextW = tw;
                    }
                    const rowBoxW = maxTokenTextW + tokenBoxPad * 2;

                    // Pre-compute column label box height (same for all columns)
                    const colBoxH = labelFontSize + idxFontSize + tokenBoxPad * 2;

                    // --- Q axis underlay strip (rows = queries) ---
                    const axisStripPad = Math.round(2 * scale);
                    const qStripX = gridX - tokenBoxGap - rowBoxW - axisStripPad;
                    const qStripY = gridY - axisStripPad;
                    const qStripW = rowBoxW + axisStripPad * 2;
                    const qStripH = gridH + axisStripPad * 2;
                    smBoxChipG_h.append('rect')
                        .attr('x', qStripX).attr('y', qStripY)
                        .attr('width', qStripW).attr('height', qStripH)
                        .attr('rx', 4).attr('ry', 4)
                        .attr('fill', C.qBg)
                        .attr('stroke', C.qBorder).attr('stroke-width', 1.5)
                        .attr('stroke-opacity', 0.5);

                    // --- K^T axis underlay strip (columns = keys) ---
                    const kStripX = gridX - axisStripPad;
                    const kStripY = gridY - tokenBoxGap - colBoxH - axisStripPad;
                    const kStripW = gridW + axisStripPad * 2;
                    const kStripH = colBoxH + axisStripPad * 2;
                    smBoxChipG_h.append('rect')
                        .attr('x', kStripX).attr('y', kStripY)
                        .attr('width', kStripW).attr('height', kStripH)
                        .attr('rx', 4).attr('ry', 4)
                        .attr('fill', C.kBg)
                        .attr('stroke', C.kBorder).attr('stroke-width', 1.5)
                        .attr('stroke-opacity', 0.5);

                    // Save axis arrow targets for projection arrows
                    qAxisX = qStripX + qStripW / 2;
                    qAxisY = qStripY;
                    kAxisX = kStripX + kStripW / 2;
                    kAxisY = kStripY;

                    for (let i = 0; i < N; i++) {
                        const tColor = getTokenClassColor(i);
                        const tBg = tokenColorBgOpaque(tColor, 0.15, baseBg);
                        const tBorder = tokenColorBorder(tColor, 0.5);
                        const cellCenterY = gridY + i * heatCellSize + (heatCellSize - 3) / 2;
                        const tBoxW = rowBoxW;
                        const tBoxX = gridX - tokenBoxGap - tBoxW;
                        const tBoxY = cellCenterY - tokenBoxH / 2;
                        smBoxChipG_h.append('rect')
                            .attr('x', tBoxX).attr('y', tBoxY)
                            .attr('width', tBoxW).attr('height', tokenBoxH)
                            .attr('rx', 2).attr('ry', 2)
                            .attr('fill', tBg).attr('stroke', tBorder).attr('stroke-width', 1);
                        smBoxChipG_h.append('text')
                            .attr('x', tBoxX + tBoxW / 2).attr('y', cellCenterY - idxFontSize * 0.4)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', MONO).attr('font-size', labelFontSize)
                            .attr('font-weight', '600')
                            .attr('fill', tColor).text(tokens[i]);
                        smBoxChipG_h.append('text')
                            .attr('x', tBoxX + tBoxW / 2).attr('y', cellCenterY + labelFontSize * 0.55)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', MONO).attr('font-size', idxFontSize)
                            .attr('fill', C.textMuted).attr('opacity', 0.7)
                            .text(tokenIds ? tokenIds[i] : i);
                    }
                    // Column labels (key tokens) on top — boxed with token colors + index
                    for (let j = 0; j < N; j++) {
                        const tColor = getTokenClassColor(j);
                        const tBg = tokenColorBgOpaque(tColor, 0.15, baseBg);
                        const tBorder = tokenColorBorder(tColor, 0.5);
                        const cellCenterX = gridX + j * heatCellSize + (heatCellSize - 3) / 2;
                        const tTextW = tokens[j].length * labelFontSize * 0.65;
                        const tBoxW = Math.max(heatCellSize - 6, tTextW + tokenBoxPad * 2);
                        const tBoxH = labelFontSize + idxFontSize + tokenBoxPad * 2;
                        const tBoxX = cellCenterX - tBoxW / 2;
                        const tBoxY = gridY - tokenBoxGap - tBoxH;
                        smBoxChipG_h.append('rect')
                            .attr('x', tBoxX).attr('y', tBoxY)
                            .attr('width', tBoxW).attr('height', tBoxH)
                            .attr('rx', 2).attr('ry', 2)
                            .attr('fill', tBg).attr('stroke', tBorder).attr('stroke-width', 1);
                        smBoxChipG_h.append('text')
                            .attr('x', cellCenterX).attr('y', tBoxY + tokenBoxPad + labelFontSize * 0.45)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', MONO).attr('font-size', labelFontSize)
                            .attr('font-weight', '600')
                            .attr('fill', tColor).text(tokens[j]);
                        smBoxChipG_h.append('text')
                            .attr('x', cellCenterX).attr('y', tBoxY + tokenBoxPad + labelFontSize + idxFontSize * 0.4)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', MONO).attr('font-size', idxFontSize)
                            .attr('fill', C.textMuted).attr('opacity', 0.7)
                            .text(tokenIds ? tokenIds[j] : j);
                    }

                    // (title handled by "Attention Scores" label in upper-left corner)

                    // Compute Q/K positions as if the normal equation were drawn,
                    // so projection boxes don't move when toggling to heatmap
                    const fakeNx = sx_h + Math.min(smTextW, innerW * 0.35) + gap + lparenW;
                    qTCX = fakeNx + qTextW / 2;
                    kTCX = fakeNx + qTextW + dotTextW + kTextW / 2;
                    qTTY = softmaxBoxY_h;
                    kTTY = softmaxBoxY_h;
                } else {
                    // Center "softmax" label within inner area
                    const smLabelCenterX = softmaxBoxX_h + padX + Math.min(smTextW, innerW * 0.35) / 2;
                    g.append('text')
                        .attr('x', smLabelCenterX).attr('y', smBoxCenterY_h - 6 * scale)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', smallSize).attr('font-weight', 'bold')
                        .attr('fill', phaseIdx < PHASES.indexOf('APPLY_SOFTMAX') ? C.textMuted : chipSm.color)
                        .text('softmax');
                    g.append('text')
                        .attr('x', smLabelCenterX).attr('y', smBoxCenterY_h + 7 * scale)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                        .attr('fill', C.textMuted).attr('opacity', 0.7)
                        .text(`<${N}, ${N}>`);
                    sx_h += Math.min(smTextW, innerW * 0.35) + gap;
                    staticText(sx_h + lparenW / 2, smBoxCenterY_h, '(', mathSize + 10);
                    sx_h += lparenW;

                    // Remaining width inside the box after softmax label + "("
                    const remainingW = (softmaxBoxX_h + softmaxBoxW_h - padX) - sx_h - rparenW;

                    if (fracMode === 'scaled') {
                        const fitW = Math.min(localMatNxN.w, remainingW);
                        const matY = smBoxCenterY_h - localMatNxN.h / 2;
                        const chipG2 = makeChip(sx_h, matY, fitW, localMatNxN.h, chipSc, { isMatrix: true });
                        drawFittedMatrixGrid(chipG2, sx_h, matY, headScaledScores, N, N, C.scaleLabel, 2, fitNxNCell);
                        dimLabel(sx_h + fitW / 2, matY + localMatNxN.h, `<${N}, ${N}>`);
                        sx_h += fitW;
                    } else {
                        const showQMatrix = fracMode === 'normal' && et.has('Q');
                        const showKMatrix = fracMode === 'normal' && et.has('K');
                        let numW, numH;
                        if (fracMode === 'QKT') {
                            numW = localMatNxN.w; numH = localMatNxN.h;
                        } else if (showQMatrix && showKMatrix) {
                            numW = localMatNxD.w + dotTextW + localMatNxD.w; numH = localMatNxD.h;
                        } else if (showQMatrix) {
                            numW = localMatNxD.w + dotTextW + kTextW; numH = Math.max(localMatNxD.h, defaultChipH);
                        } else if (showKMatrix) {
                            numW = qTextW + dotTextW + localMatNxD.w; numH = Math.max(localMatNxD.h, defaultChipH);
                        } else {
                            numW = qTextW + dotTextW + kTextW; numH = defaultChipH;
                        }
                        const fracW2 = Math.min(Math.max(numW, scTextW), remainingW);
                        const fracCenterX2 = sx_h + fracW2 / 2;
                        const numY = smBoxCenterY_h - fracGap / 2 - numH;

                        if (fracMode === 'QKT') {
                            const numStartX = fracCenterX2 - localMatNxN.w / 2;
                            const chipG2 = makeChip(numStartX, numY, localMatNxN.w, localMatNxN.h, chipQKT, { isMatrix: true });
                            drawFittedMatrixGrid(chipG2, numStartX, numY, headRawScores, N, N, C.scaleLabel, undefined, fitNxNCell);
                            g.append('text').attr('x', numStartX + localMatNxN.w / 2).attr('y', numY - 4)
                                .attr('text-anchor', 'middle').attr('dominant-baseline', 'alphabetic')
                                .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                                .attr('fill', C.textMuted).attr('opacity', 0.7).text(`<${N}, ${N}>`);
                        } else {
                            const numStartX = fracCenterX2 - Math.min(numW, fracW2) / 2;
                            let nx = numStartX;
                            if (showQMatrix) {
                                const qY = numY + (numH - localMatNxD.h) / 2;
                                const chipG2 = makeChip(nx, qY, localMatNxD.w, localMatNxD.h, chipQ, { isMatrix: true });
                                drawFittedMatrixGrid(chipG2, nx, qY, headQ, N, d, C.qText, undefined, fitNxDCell);
                                g.append('text').attr('x', nx + localMatNxD.w / 2).attr('y', qY - 4)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'alphabetic')
                                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                                    .attr('fill', C.textMuted).attr('opacity', 0.7).text(`<${N}, ${d}>`);
                                qTCX = nx + localMatNxD.w / 2; qTTY = qY;
                                nx += localMatNxD.w;
                            } else {
                                const qY = numY + (numH - defaultChipH) / 2;
                                const qChipG = makeChip(nx, qY, qTextW, defaultChipH, chipQ);
                                qChipG.append('text').attr('x', nx + qTextW / 2).attr('y', qY + defaultChipH / 2 - 6 * scale)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                    .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                                    .attr('font-style', 'italic').attr('font-weight', 'bold')
                                    .attr('fill', phaseIdx < PHASES.indexOf('PROJECT_Q') ? C.textMuted : chipQ.color).text('Q');
                                chipDimLabel(qChipG, nx + qTextW / 2, qY + defaultChipH / 2 + 7 * scale, `<${N}, ${d}>`);
                                qTCX = nx + qTextW / 2; qTTY = qY;
                                nx += qTextW;
                            }
                            const dotY = numY + (numH - defaultChipH) / 2;
                            const dotChipG2 = makeChip(nx, dotY, dotTextW, defaultChipH, chipQKT, { noBrackets: true });
                            dotChipG2.append('text').attr('x', nx + dotTextW / 2).attr('y', dotY + defaultChipH / 2)
                                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                                .attr('fill', phaseIdx < PHASES.indexOf('COMPUTE_SCORES') ? C.textMuted : chipQKT.color).text('\u00b7');
                            nx += dotTextW;
                            if (showKMatrix) {
                                const kY = numY + (numH - localMatNxD.h) / 2;
                                const chipG2 = makeChip(nx, kY, localMatNxD.w, localMatNxD.h, chipK, { isMatrix: true });
                                drawFittedMatrixGrid(chipG2, nx, kY, headK, N, d, C.kText, undefined, fitNxDCell);
                                g.append('text').attr('x', nx + localMatNxD.w / 2).attr('y', kY - 4)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'alphabetic')
                                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                                    .attr('fill', C.textMuted).attr('opacity', 0.7).text(`<${d}, ${N}>`);
                                kTCX = nx + localMatNxD.w / 2; kTTY = kY;
                                nx += localMatNxD.w;
                            } else {
                                const kY = numY + (numH - defaultChipH) / 2;
                                const kChipG = makeChip(nx, kY, kTextW, defaultChipH, chipK);
                                kChipG.append('text').attr('x', nx + kTextW / 2).attr('y', kY + defaultChipH / 2 - 6 * scale)
                                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                                    .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                                    .attr('font-style', 'italic').attr('font-weight', 'bold')
                                    .attr('fill', phaseIdx < PHASES.indexOf('PROJECT_K') ? C.textMuted : chipK.color).text('K\u1d40');
                                chipDimLabel(kChipG, nx + kTextW / 2, kY + defaultChipH / 2 + 7 * scale, `<${d}, ${N}>`);
                                kTCX = nx + kTextW / 2; kTTY = kY;
                                nx += kTextW;
                            }
                        }
                        // Fraction line
                        g.append('line').attr('x1', fracCenterX2 - fracW2 / 2 + 2).attr('y1', smBoxCenterY_h)
                            .attr('x2', fracCenterX2 + fracW2 / 2 - 2).attr('y2', smBoxCenterY_h)
                            .attr('stroke', C.canvasText).attr('stroke-width', 1.2);
                        // √dk
                        const denY = smBoxCenterY_h + fracGap / 2;
                        const denX = fracCenterX2 - scTextW / 2;
                        const scChipG2 = makeChip(denX, denY, scTextW, defaultChipH, chipSc);
                        scChipG2.append('text').attr('x', denX + scTextW / 2).attr('y', denY + defaultChipH / 2 - 6 * scale)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                            .attr('font-style', 'italic').attr('font-weight', 'bold')
                            .attr('fill', phaseIdx < PHASES.indexOf('SCALE_SCORES') ? C.textMuted : chipSc.color).text('\u221ad\u2096');
                        chipDimLabel(scChipG2, denX + scTextW / 2, denY + defaultChipH / 2 + 7 * scale, `= ${Math.round(Math.sqrt(d))}`);
                        sx_h += fracW2;
                    }
                    staticText(sx_h + rparenW / 2, smBoxCenterY_h, ')', mathSize + 10);
                }

                // "· V"
                const vLocked_h = phaseIdx < PHASES.indexOf('PROJECT_V');
                staticText(dotCenterX_h, smBoxCenterY_h, '\u00b7', mathSize);
                if (showVMatrix) {
                    const matY = smBoxCenterY_h - matNxD.h / 2;
                    const chipG2 = makeChip(vChipX_h, matY, matNxD.w, matNxD.h, chipV, { isMatrix: true });
                    drawMatrixGrid(chipG2, vChipX_h, matY, headV, N, d, C.vText);
                    dimLabel(vChipX_h + matNxD.w / 2, matY + matNxD.h, `<${N}, ${d}>`);
                } else {
                    const vChipY = smBoxCenterY_h - defaultChipH / 2;
                    const vChipG2 = makeChip(vChipX_h, vChipY, vTextW, defaultChipH, chipV);
                    vChipG2.append('text').attr('x', vChipX_h + vTextW / 2).attr('y', vChipY + defaultChipH / 2 - 6 * scale)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', mathSize)
                        .attr('font-style', 'italic').attr('font-weight', 'bold')
                        .attr('fill', vLocked_h ? C.textMuted : chipV.color).text('V');
                    chipDimLabel(vChipG2, vChipX_h + vTextW / 2, vChipY + defaultChipH / 2 + 7 * scale, `<${N}, ${d}>`);
                }

                // "+ E" (only drawn for single-head; multi-head has Concat → W_O → + E)
                const plusW_h = charW * 2.5;
                const resETextW_h = eChipTextW;
                let resEChipX_h = 0, resEChipY_h = 0;
                if (!skipResidualE) {
                    const plusX_h = ctxUnderlayX_h + ctxUnderlayW_h + gap;
                    const plusColor_h = phaseIdx >= PHASES.indexOf('SHOW_OUTPUT') ? C.canvasText : C.textMuted;
                    staticText(plusX_h + plusW_h / 2, smBoxCenterY_h, '+', mathSize, plusColor_h);
                    resEChipX_h = plusX_h + plusW_h;
                    resEChipY_h = smBoxCenterY_h - defaultChipH / 2;
                    const resEChipG_h = makeChip(resEChipX_h, resEChipY_h, resETextW_h, defaultChipH, chipResE);
                    resEChipG_h.append('text').attr('x', resEChipX_h + resETextW_h / 2).attr('y', resEChipY_h + defaultChipH / 2 - 6 * scale)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                        .attr('font-style', 'italic').attr('font-weight', 'bold')
                        .attr('fill', phaseIdx < PHASES.indexOf('SHOW_OUTPUT') ? C.textMuted : chipResE.color).text('E');
                    chipDimLabel(resEChipG_h, resEChipX_h + resETextW_h / 2, resEChipY_h + defaultChipH / 2 + 7 * scale, `<${N}, ${dModel}>`);
                }

                const vChipTopY_h = smBoxCenterY_h - (showVMatrix ? matNxD.h : defaultChipH) / 2;
                return {
                    ctxUnderlayX: ctxUnderlayX_h, ctxUnderlayY: ctxUnderlayY_h,
                    ctxUnderlayW: ctxUnderlayW_h, ctxUnderlayH: ctxUnderlayH_h,
                    qTargetCenterX: qTCX, qTargetTopY: qTTY,
                    kTargetCenterX: kTCX, kTargetTopY: kTTY,
                    vChipCenterX: vChipCenterX_h, vChipTopY: vChipTopY_h,
                    resECenterX: resEChipX_h + resETextW_h / 2, resEChipY: resEChipY_h,
                    smBoxCenterY: smBoxCenterY_h,
                    resETextW: resETextW_h, plusW: plusW_h,
                    qAxisX, qAxisY, kAxisX, kAxisY,
                };
            }

            // ============ Shared arrow start positions ============
            // In single-head mode, projChipCenters is already set from stage 4-5.
            // In multi-head mode, projChipCenters will be set later when projections are drawn inside the head box.
            let leftGroupCenterX = projChipCenters ? (projChipCenters[0] + projChipCenters[1]) / 2 : flowCenterX;
            let vProjCenterX = projChipCenters ? projChipCenters[2] : flowCenterX;
            const vLocked = phaseIdx < PHASES.indexOf('PROJECT_V');
            const vArrowColor = vLocked ? C.textMuted : C.vFill;

            // Variable to hold the equation result (for arrow routing and residual)
            let eqResult;
            let concatBoxBottomY = 0;  // set in multi-head nav, used in post-equation
            let woChipCenterX = 0;    // W_O chip center (drawn beside Concat box)
            let woChipBottomY = 0;    // W_O chip bottom edge
            let navRowLeftX = 0;      // leftmost edge of nav row (concat box)
            let navRowRightX = 0;     // rightmost edge of nav row (E chip)
            const residualColor = phaseIdx >= PHASES.indexOf('SHOW_OUTPUT') ? C.embedPos : C.textMuted;

            if (B_eq.multiHead && activeData.heads && activeData.heads.length > 1) {
                // ============ MULTI-HEAD CAROUSEL ============
                // Head box sits alongside the embedding block, right under the token box.
                // Projections (E·Wq, E·Wk, E·Wv) are drawn INSIDE the head box.
                // Elbow arrow from embedding box feeds into projections.
                // Residual comes straight down from the embedding box on the right.
                const nHeads = activeData.heads.length;
                const headColors = getHeadColors();
                const activeHeadColor = headColors[this.modelHead % headColors.length];
                const navH = B_eq.galleryNavH;

                // ---- Head container box: left-aligned under token box, same width ----
                const boxW = B_eq.headBoxW;  // = tokContainerW
                const boxH = B_eq.headBoxH;
                const boxX = tokContainerX;  // left-aligned under token box
                const boxY = B_eq.headBoxY_precomputed;  // shifted up alongside embedding block
                const boxBottomY = boxY + boxH;
                const headBoxCenterX = boxX + boxW / 2;

                // Draw the box behind everything — insert at the start of gB
                g.insert('rect', ':first-child')
                    .attr('x', boxX).attr('y', boxY)
                    .attr('width', boxW).attr('height', boxH)
                    .attr('rx', 6).attr('ry', 6)
                    .attr('fill', activeHeadColor).attr('fill-opacity', 0.04)
                    .attr('stroke', activeHeadColor).attr('stroke-width', 3)
                    .attr('stroke-dasharray', `${4 * scale},${3 * scale}`);

                // Title label above upper-left corner
                g.append('text')
                    .attr('x', boxX).attr('y', boxY - 5 * scale)
                    .attr('text-anchor', 'start').attr('dominant-baseline', 'auto')
                    .attr('font-family', MONO).attr('font-size', 9 * scale).attr('font-weight', '700')
                    .attr('fill', activeHeadColor)
                    .text(`Head ${this.modelHead} / ${nHeads}`);

                // ---- Equation inside the head box (draw first to get Q/K/V positions) ----
                const headBoxInnerPad = Math.round(boxW * 0.4 - B_eq.softmaxBoxW / 2);
                const projInsideY = boxY + headBoxInnerPad;
                const eqCenterX = boxX + boxW * 0.4;
                // eqTopY set so softmax box top (topY + 12*scale) is headBoxInnerPad below projections
                const mhProjH = B_eq.mhProjChipH;
                const eqTopY = projInsideY + mhProjH + headBoxInnerPad - Math.round(12 * scale);

                const activeHead = activeData.heads[this.modelHead];
                eqResult = drawEquationForHead(
                    eqCenterX, eqTopY,
                    activeHead.Q, activeHead.K, activeHead.V,
                    activeHead.rawScores || activeData.rawScores,
                    activeHead.scaledScores || activeData.scaledScores,
                    activeHead.attentionWeights || activeHead.attention_weights,
                    null,  // label drawn separately on the box
                    true   // skip + E (multi-head has Concat -> W_O + E)
                );

                // ---- Draw projections INSIDE the head box, centered above Q/K/V ----
                const mhProjW = Math.round(wChipW * 0.75);  // narrower than single-head
                // V projection: right edge = headBoxInnerPad from head box right border
                const vProjX_mh = boxX + boxW - headBoxInnerPad - mhProjW;
                const vProjCenterX_mh = vProjX_mh + mhProjW / 2;
                // Center Q and K projections above their corresponding variables
                const projChipXs_mh = [
                    eqResult.qTargetCenterX - mhProjW / 2,   // E·Wq above Q
                    eqResult.kTargetCenterX - mhProjW / 2,   // E·Wk above K^T
                    vProjX_mh,                                 // E·Wv with uniform padding from right border
                ];
                projChipCenters = [eqResult.qTargetCenterX, eqResult.kTargetCenterX, vProjCenterX_mh];
                leftGroupCenterX = (projChipCenters[0] + projChipCenters[1]) / 2;
                vProjCenterX = projChipCenters[2];

                // Draw projection chips using narrower width, with blue E boxes
                const eFontSize = mathSize * 0.65;
                const eBoxPad = Math.round(3 * scale);
                const eCharW = Math.round(eFontSize * 0.65);  // width of italic "E"
                const eBoxW = eCharW + eBoxPad * 2;
                const eBoxH = Math.round(eFontSize + eBoxPad * 2);
                const dotCharW = Math.round(eFontSize * 0.25);  // width of "·" character
                const eDotSpacing = Math.round(eBoxPad * 0.8);  // gap: E box edge to dot
                const dotWSpacing = Math.round(eBoxPad * 0.8);  // gap: dot to W label
                const eBoxCenters = [];  // store centers for elbow arrow targets
                for (let wi = 0; wi < 3; wi++) {
                    const wc = wChips[wi];
                    const wx = projChipXs_mh[wi];
                    const wCenterX = projChipCenters[wi];
                    const wLocked = phaseIdx < PHASES.indexOf(wc.phase);
                    const wColor = wLocked ? C.textMuted : wc.color;
                    const wBorderColor = wLocked ? C.textMuted : wc.border;

                    const wChipG = g.append('g');
                    wChipG.append('rect')
                        .attr('x', wx).attr('y', projInsideY).attr('width', mhProjW).attr('height', mhProjH)
                        .attr('rx', 3).attr('ry', 3)
                        .attr('fill', wLocked ? C.textMuted : wc.bg).attr('opacity', wLocked ? 0.06 : 1);
                    wChipG.append('rect')
                        .attr('x', wx).attr('y', projInsideY).attr('width', mhProjW).attr('height', mhProjH)
                        .attr('rx', 3).attr('ry', 3)
                        .attr('fill', 'none').attr('stroke', wBorderColor).attr('stroke-width', 2);

                    const textY = projInsideY + mhProjH / 2 - 4 * scale;
                    const wLabel = wc.label.replace('E\u00b7', '');
                    const eLabelColor = wLocked ? C.textMuted : C.embedPos;

                    // Position "E" with known x, then "·" then "Wq" — with explicit gaps
                    // Layout: [E box] --gap-- [·] --gap-- [Wq]
                    const wPartW = eFontSize * 0.55 * wLabel.length;
                    const totalW = eBoxW + eDotSpacing + dotCharW + dotWSpacing + wPartW;
                    const eBoxStartX = wCenterX - totalW / 2;  // left edge of E box
                    const eCenterX = eBoxStartX + eBoxW / 2;
                    const dotCenterX_proj = eBoxStartX + eBoxW + eDotSpacing + dotCharW / 2;
                    const wStartX = dotCenterX_proj + dotCharW / 2 + dotWSpacing;

                    // Blue E box — precisely centered on the E character
                    const eBoxX = eCenterX - eBoxW / 2;
                    const eBoxY = textY - eBoxH / 2;
                    wChipG.append('rect')
                        .attr('x', eBoxX).attr('y', eBoxY).attr('width', eBoxW).attr('height', eBoxH)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', wLocked ? 'none' : C.embedPos).attr('opacity', wLocked ? 0.1 : 0.15);
                    wChipG.append('rect')
                        .attr('x', eBoxX).attr('y', eBoxY).attr('width', eBoxW).attr('height', eBoxH)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', 'none').attr('stroke', eLabelColor).attr('stroke-width', 1.5);
                    eBoxCenters.push({ x: eCenterX, topY: eBoxY });

                    // Draw "E" centered in its box
                    wChipG.append('text')
                        .attr('x', eCenterX).attr('y', textY)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', eFontSize)
                        .attr('font-style', 'italic').attr('font-weight', 'bold')
                        .attr('fill', eLabelColor).text('E');
                    // Draw "·" — black, between E box and W
                    wChipG.append('text')
                        .attr('x', dotCenterX_proj).attr('y', textY)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', eFontSize)
                        .attr('font-weight', 'bold')
                        .attr('fill', C.canvasText).text('\u00b7');
                    // Draw "W" + subscript letter (q/k/v)
                    const wText = wChipG.append('text')
                        .attr('x', wStartX).attr('y', textY)
                        .attr('text-anchor', 'start').attr('dominant-baseline', 'central')
                        .attr('font-family', SERIF).attr('font-size', eFontSize)
                        .attr('font-style', 'italic').attr('font-weight', 'bold')
                        .attr('fill', wColor);
                    wText.append('tspan').text('W');
                    wText.append('tspan')
                        .attr('font-size', eFontSize * 0.65)
                        .attr('dy', eFontSize * 0.25)
                        .text(wc.result.toLowerCase());
                    // Dim labels under E and W, with grey dot between
                    const dimFontSize = 3.5 * scale;
                    const dimLabelY = projInsideY + mhProjH / 2 + 8 * scale;
                    const fullD = self.embedDim;
                    const wLabelCenterX = wStartX + wPartW / 2;
                    const dimDotCenterX = (eCenterX + wLabelCenterX) / 2;
                    wChipG.append('text')
                        .attr('x', eCenterX).attr('y', dimLabelY)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                        .attr('font-family', MONO).attr('font-size', dimFontSize)
                        .attr('fill', C.textMuted).attr('opacity', 0.7)
                        .text(`<${N}, ${fullD}>`);
                    wChipG.append('text')
                        .attr('x', dimDotCenterX).attr('y', dimLabelY)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                        .attr('font-family', MONO).attr('font-size', dimFontSize * 1.6)
                        .attr('fill', C.textMuted).attr('opacity', 0.5)
                        .text('\u00b7');
                    wChipG.append('text')
                        .attr('x', wLabelCenterX).attr('y', dimLabelY)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                        .attr('font-family', MONO).attr('font-size', dimFontSize)
                        .attr('fill', C.textMuted).attr('opacity', 0.7)
                        .text(`<${fullD}, ${d}>`);
                }

                // ---- Elbow arrow from embedding box to projections ----
                const embedBoxCenterX = embedContainerX + embedContainerW / 2;
                const embedBoxBottomY = embedOffsetY + (showEMatrix ? matNxD.h : embedContainerH);
                const elbowColor = embedActive ? C.embedPos : C.textMuted;
                const elbowMidY = boxY - Math.round(12 * scale);
                const embedLeftX = embedContainerX;
                const elbowLeftX = eBoxCenters[0].x;
                g.append('line')
                    .attr('x1', embedLeftX).attr('y1', elbowMidY)
                    .attr('x2', elbowLeftX).attr('y2', elbowMidY)
                    .attr('stroke', elbowColor).attr('stroke-width', 1.2 * scale);
                for (let wi = 0; wi < 3; wi++) {
                    const wc = wChips[wi];
                    const wLocked = phaseIdx < PHASES.indexOf(wc.phase);
                    const branchColor = wLocked ? C.textMuted : C.embedPos;
                    const targetX = eBoxCenters[wi].x;
                    const targetTopY = eBoxCenters[wi].topY;
                    g.append('line')
                        .attr('x1', targetX).attr('y1', elbowMidY)
                        .attr('x2', targetX).attr('y2', targetTopY - arrowTipH)
                        .attr('stroke', branchColor).attr('stroke-width', 1.2 * scale);
                    arrowHead(targetX, targetTopY, branchColor);
                }

                // Arrows from projection bottoms to Q/K/V
                const arrowStartY_mh = projInsideY + mhProjH;
                const qProjColor = phaseIdx < PHASES.indexOf('PROJECT_Q') ? C.textMuted : wChips[0].fill;
                const kProjColor = phaseIdx < PHASES.indexOf('PROJECT_K') ? C.textMuted : wChips[1].fill;
                if (eqResult.qAxisX != null) {
                    // Curved arrows to axis label strips on the heatmap
                    curvedArrow(projChipCenters[0], arrowStartY_mh, eqResult.qAxisX, eqResult.qAxisY, qProjColor);
                    curvedArrow(projChipCenters[1], arrowStartY_mh, eqResult.kAxisX, eqResult.kAxisY, kProjColor);
                } else {
                    // Straight arrows to Q/K chips in the equation
                    arrowLine(projChipCenters[0], arrowStartY_mh, eqResult.qTargetTopY, qProjColor);
                    arrowLine(projChipCenters[1], arrowStartY_mh, eqResult.kTargetTopY, kProjColor);
                }
                // V arrow exits from V chip's X on the projection, straight down
                arrowLine(eqResult.vChipCenterX, arrowStartY_mh, eqResult.vChipTopY, vArrowColor);

                // ============ NAV ROW: Concat (full width) + · W_O + E (under embed) ============
                const dHead = d;
                const dotSize = Math.round(19 * scale);
                const dotH = dotSize;  // square
                const dotGap = Math.round(4 * scale);
                const dotRadius = Math.round(3 * scale);
                const dotsW = nHeads * (dotSize + dotGap) - dotGap;

                const navArrowGap = Math.round(8 * scale);
                const concatRowTopY = boxBottomY + navArrowGap + Math.round(12 * scale);
                const plusColor = phaseIdx >= PHASES.indexOf('SHOW_OUTPUT') ? C.canvasText : C.textMuted;
                const resEW_nav = eChipTextW;
                const woW = charW * 2.5 + chipPadX * 2;
                const concatDim = nHeads * dHead;

                // Concat box sizing — full width of head box
                const concatTitleH = Math.round(14 * scale);
                const concatPadY = Math.round(6 * scale);
                const concatBoxH = concatPadY + concatTitleH + dotH + concatPadY;

                const concatBoxX = boxX;
                const concatBoxY = concatRowTopY;
                const concatBoxW = boxW;
                concatBoxBottomY = concatBoxY + concatBoxH;

                // W_O + E vertically centered with concat box, positioned under embedding box
                const woY_nav = concatRowTopY + (concatBoxH - defaultChipH) / 2;
                const woCenterY = woY_nav + defaultChipH / 2;

                // Layout: · W_O + E centered under the embedding box
                const embedCenterX_nav = embedContainerX + embedContainerW / 2;
                const concatWoDotW = charW * 1.5;
                const plusTextW = charW * 2.5;
                const woGroupW = concatWoDotW + woW + plusTextW + resEW_nav;
                const woGroupStartX = embedCenterX_nav - woGroupW / 2;

                // Head squares below title inside the concat box
                const actualDotsStartX = concatBoxX + (concatBoxW - dotsW) / 2;
                const dotsY = concatBoxY + concatPadY + concatTitleH + dotH / 2;

                // Arrow from head box bottom to the active head square
                const activeSquareCenterX = actualDotsStartX + this.modelHead * (dotSize + dotGap) + dotSize / 2;
                const activeDrawSize = Math.round(dotSize * 1.2);
                const activeDrawH = Math.round(dotH * 1.2);
                const activeSquareTopY = dotsY - activeDrawH / 2;
                arrowLine(activeSquareCenterX, boxBottomY, activeSquareTopY, activeHeadColor);

                // --- Concat container box ---
                g.append('rect')
                    .attr('x', concatBoxX).attr('y', concatBoxY)
                    .attr('width', concatBoxW).attr('height', concatBoxH)
                    .attr('rx', 5).attr('ry', 5)
                    .attr('fill', C.canvasBg).attr('fill-opacity', 0.6)
                    .attr('stroke', C.activeBorder).attr('stroke-width', 2.4);

                // "Concat" title at top of box
                const concatTitleY = concatBoxY + concatPadY + concatTitleH / 2;
                g.append('text')
                    .attr('x', concatBoxX + concatBoxW / 2).attr('y', concatTitleY)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SANS).attr('font-size', Math.round(11 * scale))
                    .attr('font-weight', 'bold')
                    .attr('fill', C.activeBorder)
                    .text('Concat');

                // Concat dim label under box center
                const dimLabelY_concat = concatBoxBottomY + Math.round(2 * scale);
                chipDimLabel(g, concatBoxX + concatBoxW / 2, dimLabelY_concat, `<${N}, ${concatDim}>`);

                // --- "·" before W_O (under embedding box) ---
                const concatDotX = woGroupStartX + concatWoDotW / 2;
                staticText(concatDotX, woCenterY, '\u00b7', mathSize, C.canvasText);

                // --- W_O box (under embedding box) ---
                const woX = woGroupStartX + concatWoDotW;
                const woChip = { color: C.sectionTitle, bg: C.canvasBg, border: C.activeBorder };
                const woG = makeChip(woX, woY_nav, woW, defaultChipH, woChip);
                woG.append('text')
                    .attr('x', woX + woW / 2).attr('y', woY_nav + defaultChipH / 2 - 6 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SERIF).attr('font-size', smallSize).attr('font-weight', 'bold')
                    .attr('fill', C.sectionTitle).text('W\u2092');
                chipDimLabel(woG, woX + woW / 2, woY_nav + defaultChipH / 2 + 7 * scale, `<${concatDim}, ${dModel}>`);

                // --- "+" after W_O ---
                const plusStartX_nav = woX + woW;
                staticText(plusStartX_nav + charW * 1.25, woCenterY, '+', mathSize, plusColor);

                // --- E chip (residual) to the right of "+" ---
                const resEX_nav = plusStartX_nav + charW * 2.5;
                const resEChipG_nav = makeChip(resEX_nav, woY_nav, resEW_nav, defaultChipH, chipResE);
                resEChipG_nav.append('text')
                    .attr('x', resEX_nav + resEW_nav / 2).attr('y', woY_nav + defaultChipH / 2 - 6 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SERIF).attr('font-size', mathSize - 1)
                    .attr('font-style', 'italic').attr('font-weight', 'bold')
                    .attr('fill', phaseIdx < PHASES.indexOf('SHOW_OUTPUT') ? C.textMuted : chipResE.color).text('E');
                chipDimLabel(resEChipG_nav, resEX_nav + resEW_nav / 2, woY_nav + defaultChipH / 2 + 7 * scale, `<${N}, ${dModel}>`);

                // ---- Residual skip connection: straight down from embed box to E chip ----
                const resECenterX_nav = resEX_nav + resEW_nav / 2;
                const residualDashed = phaseIdx < PHASES.indexOf('SHOW_OUTPUT') ? `${3 * scale},${3 * scale}` : 'none';
                g.append('line')
                    .attr('x1', resECenterX_nav).attr('y1', embedBoxBottomY)
                    .attr('x2', resECenterX_nav).attr('y2', woY_nav - arrowTipH)
                    .attr('stroke', residualColor).attr('stroke-width', 1.2 * scale)
                    .attr('stroke-dasharray', residualDashed);
                arrowHead(resECenterX_nav, woY_nav, residualColor);

                // Store positions for post-equation combining line + arrow to output block
                woChipCenterX = concatBoxX + concatBoxW / 2;
                woChipBottomY = Math.max(concatBoxBottomY, woY_nav + defaultChipH);
                navRowLeftX = concatBoxX;
                navRowRightX = resEX_nav + resEW_nav;

                // Draw head squares inside the concat box (RNN-style: always tinted, active more prominent)
                for (let h = 0; h < nHeads; h++) {
                    const isActiveH = h === this.modelHead;
                    const hColor = headColors[h % headColors.length];
                    const dotX = actualDotsStartX + h * (dotSize + dotGap);
                    const dotG = g.append('g').style('cursor', 'pointer');

                    const activeScale = isActiveH ? 1.2 : 1;
                    const drawW = Math.round(dotSize * activeScale);
                    const drawHt = Math.round(dotH * activeScale);
                    const drawX = dotX + dotSize / 2 - drawW / 2;
                    const drawY = dotsY - drawHt / 2;
                    dotG.append('rect')
                        .attr('x', drawX).attr('y', drawY)
                        .attr('width', drawW).attr('height', drawHt)
                        .attr('rx', dotRadius).attr('ry', dotRadius)
                        .attr('fill', hColor)
                        .attr('fill-opacity', isActiveH ? 0.3 : 0.1)
                        .attr('stroke', hColor)
                        .attr('stroke-width', isActiveH ? 2 : 1.2)
                        .attr('stroke-opacity', isActiveH ? 1 : 0.4);

                    // Head number
                    const dotCenterX = dotX + dotSize / 2;
                    dotG.append('text')
                        .attr('x', dotCenterX).attr('y', dotsY - Math.round(4 * scale))
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(7 * scale))
                        .attr('font-weight', isActiveH ? '700' : '500')
                        .attr('fill', hColor)
                        .attr('opacity', isActiveH ? 1 : 0.45)
                        .text(h);

                    // Dim label inside box
                    dotG.append('text')
                        .attr('x', dotCenterX).attr('y', dotsY + Math.round(5 * scale))
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(3.5 * scale))
                        .attr('fill', hColor)
                        .attr('opacity', isActiveH ? 0.7 : 0.3)
                        .text(`<${N},${dHead}>`);

                    (function(idx, viz) {
                        dotG.on('click', function() { viz.modelHead = idx; viz.computeLayout(); viz.draw(); });
                    })(h, self);
                }

            } else {
                // ============ SINGLE-HEAD: STAGES 6+7 (original layout) ============
                const stage6TopY = B_eq.stage6Y;
                const stage7TopY = B_eq.stage7Y;

                eqResult = drawEquationForHead(
                    leftGroupCenterX, stage7TopY,
                    activeData.Q, activeData.K, activeData.V,
                    activeData.rawScores, activeData.scaledScores, activeData.attentionWeights,
                    null,
                    false  // single-head: draw + E inline
                );

                // Arrows from projections
                curvedArrow(vProjCenterX, stage6TopY, eqResult.vChipCenterX, eqResult.vChipTopY, vArrowColor, vLocked);
                const qSHColor = phaseIdx < PHASES.indexOf('PROJECT_Q') ? C.textMuted : wChips[0].fill;
                const kSHColor = phaseIdx < PHASES.indexOf('PROJECT_K') ? C.textMuted : wChips[1].fill;
                const qSHDashed = phaseIdx < PHASES.indexOf('PROJECT_Q');
                const kSHDashed = phaseIdx < PHASES.indexOf('PROJECT_K');
                if (eqResult.qAxisX != null) {
                    curvedArrow(projChipCenters[0], stage6TopY, eqResult.qAxisX, eqResult.qAxisY, qSHColor, qSHDashed);
                    curvedArrow(projChipCenters[1], stage6TopY, eqResult.kAxisX, eqResult.kAxisY, kSHColor, kSHDashed);
                } else {
                    curvedArrow(projChipCenters[0], stage6TopY, eqResult.qTargetCenterX, eqResult.qTargetTopY, qSHColor, qSHDashed);
                    curvedArrow(projChipCenters[1], stage6TopY, eqResult.kTargetCenterX, eqResult.kTargetTopY, kSHColor, kSHDashed);
                }
            }

            // ============ POST-EQUATION: RESIDUAL (single-head) or arrow to output ============
            const smArrowColor = phaseIdx >= PHASES.indexOf('SHOW_OUTPUT') ? C.canvasText : C.textMuted;
            let outputArrowStartX, outputArrowStartY;

            let outputArrowColor = smArrowColor;
            if (B_eq.multiHead) {
                // Multi-head: horizontal combining bracket spanning Concat...W_O...E, then arrow down
                const combineGap = Math.round(6 * scale);
                const combineLineY = woChipBottomY + combineGap;
                const tickH = Math.round(5 * scale);
                const overshoot = Math.round(8 * scale);

                const combineColor = C.outputText || '#2e7d32';
                const combineStroke = 1.2 * scale;
                const bracketLeft = navRowLeftX - overshoot;
                const bracketRight = navRowRightX + overshoot;
                // Horizontal line spanning beyond the nav row edges
                g.append('line')
                    .attr('x1', bracketLeft).attr('y1', combineLineY)
                    .attr('x2', bracketRight).attr('y2', combineLineY)
                    .attr('stroke', combineColor).attr('stroke-width', combineStroke);
                // Vertical endcap ticks
                g.append('line')
                    .attr('x1', bracketLeft).attr('y1', combineLineY - tickH)
                    .attr('x2', bracketLeft).attr('y2', combineLineY)
                    .attr('stroke', combineColor).attr('stroke-width', combineStroke);
                g.append('line')
                    .attr('x1', bracketRight).attr('y1', combineLineY - tickH)
                    .attr('x2', bracketRight).attr('y2', combineLineY)
                    .attr('stroke', combineColor).attr('stroke-width', combineStroke);

                outputArrowStartX = (navRowLeftX + navRowRightX) / 2;
                outputArrowStartY = combineLineY;
                outputArrowColor = combineColor;
            } else {
                // Single-head: residual skip connection → + E (left side)
                const skipLineX = eqResult.ctxUnderlayX - 10 * scale;
                const eLeftEdgeSH = flowCenterX - (showEMatrix ? matNxD.w / 2 : eChipTextW / 2);
                const eMidYSH = B_eq.stage3Y + (showEMatrix ? matNxD.h : defaultChipH) / 2;
                const resELeftSH = eqResult.resECenterX - eqResult.resETextW / 2;
                g.append('path')
                    .attr('d', `M${eLeftEdgeSH},${eMidYSH} L${skipLineX},${eMidYSH} L${skipLineX},${eqResult.resEChipY + defaultChipH / 2} L${resELeftSH},${eqResult.resEChipY + defaultChipH / 2}`)
                    .attr('fill', 'none').attr('stroke', residualColor)
                    .attr('stroke-width', 1.2 * scale)
                    .attr('stroke-dasharray', phaseIdx < PHASES.indexOf('SHOW_OUTPUT') ? `${3 * scale},${3 * scale}` : 'none');

                outputArrowStartX = eqResult.ctxUnderlayX + eqResult.ctxUnderlayW / 2;
                outputArrowStartY = eqResult.ctxUnderlayY + eqResult.ctxUnderlayH;
            }

            // ============ ARROW TO OUTPUT EMBEDDING ============
            arrowLine(outputArrowStartX, outputArrowStartY, B_eq.stage9Y, outputArrowColor);

            // ============ STAGE 9: OUTPUT EMBEDDING BLOCK ============
            const bottomPanelY = B_eq.stage9Y;
            const bottomPanelH = B_eq.stage9H;
            this.drawOutputEmbeddingBlock(C, bottomPanelY, bottomPanelH);
        }

        // ---- Output embedding block drawn below the equation (mirrors input embedding block) ----
        drawOutputEmbeddingBlock(C, zy, barH) {
            const g = this.gB;
            const phaseIdx = PHASES.indexOf(this.phase);
            const outputIdx = PHASES.indexOf('SHOW_OUTPUT');
            const activeData = this.getActiveData();
            const canvasW = this.layout.canvasW;
            const isModel = this.layout.isModel;
            if (phaseIdx < outputIdx || !activeData) return;

            const self = this;
            const et = this.expandedTerms;
            const expanded = et.has('output');
            const N = activeData.tokens.length;
            const d = isModel ? activeData.Q[0].length : this.headDim;
            const dModel = isModel ? this.embedDim : this.headDim;
            const { B_eq } = this.layout;
            const scale = isModel ? 2.25 : 1;
            const defaultChipH = B_eq.defaultChipH;
            const MONO = "'SF Mono','Menlo','Monaco','Consolas','Courier New',monospace";
            const SANS = "'Roboto','Helvetica','Arial',sans-serif";
            const SERIF = "'Georgia','Times New Roman','Times',serif";

            const outputColor = C.outputText || '#2e7d32';
            const baseBg = C.canvasBg || '#ffffff';
            const embedRowH = B_eq.embedRowH;
            const embedRowGap = B_eq.embedRowGap;
            const embedRowStride = B_eq.embedRowStride;

            // Clickable wrapper group
            const outG = g.append('g').attr('cursor', 'pointer')
                .on('click', function() {
                    if (et.has('output')) et.delete('output'); else et.add('output');
                    self.computeLayout();
                    self.draw();
                });

            if (!expanded) {
                // --- Collapsed: compact chip with "Output Embedding" label + dimensions ---
                const chipH = Math.round(26 * scale);
                const chipW = Math.round(180 * scale);
                const chipX = (canvasW - chipW) / 2;

                outG.append('rect')
                    .attr('x', chipX).attr('y', zy)
                    .attr('width', chipW).attr('height', chipH)
                    .attr('rx', 5).attr('ry', 5)
                    .attr('fill', outputColor)
                    .attr('fill-opacity', 0.1)
                    .attr('stroke', outputColor)
                    .attr('stroke-width', 3);

                outG.append('text')
                    .attr('x', chipX + chipW / 2).attr('y', zy + chipH / 2 - 4 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SANS).attr('font-size', Math.round(11 * scale))
                    .attr('font-weight', 'bold')
                    .attr('fill', outputColor)
                    .text('Output Embedding');

                // Dimension label inside chip
                outG.append('text')
                    .attr('x', chipX + chipW / 2).attr('y', zy + chipH / 2 + 4 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                    .attr('fill', C.textMuted).attr('opacity', 0.7)
                    .text(`<${N}, ${dModel}>`);
            } else {
                // --- Expanded: per-token embedding rows ---
                const embedPadX = Math.round(8 * scale);
                const embedPadY = Math.round(6 * scale);
                const embedTitleH = Math.round(14 * scale);
                const embedInnerH = N * embedRowStride - embedRowGap;
                const containerH = embedTitleH + embedInnerH + embedPadY * 2;

                const leftPad = Math.round(10 * scale);
                const rightPad = Math.round(10 * scale);
                const containerW = Math.round((canvasW - leftPad - rightPad) * 0.38);
                const containerX = (canvasW - containerW) / 2;

                outG.append('rect')
                    .attr('x', containerX).attr('y', zy)
                    .attr('width', containerW).attr('height', containerH)
                    .attr('rx', 5).attr('ry', 5)
                    .attr('fill', outputColor)
                    .attr('fill-opacity', 0.1)
                    .attr('stroke', outputColor)
                    .attr('stroke-width', 3);

                // "Output Embedding" title
                const centerX = containerX + containerW / 2;
                outG.append('text')
                    .attr('x', centerX).attr('y', zy + embedPadY + embedTitleH * 0.5)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', SANS).attr('font-size', Math.round(11 * scale))
                    .attr('font-weight', 'bold')
                    .attr('fill', outputColor)
                    .text('Output Embedding');

                // Per-token embedding rows
                const rowStartY = zy + embedPadY + embedTitleH;
                const tokenIdBoxW = Math.round(28 * scale);
                const vecBarPad = Math.round(4 * scale);

                for (let i = 0; i < N; i++) {
                    const ry = rowStartY + i * embedRowStride;
                    const tokenColor = getTokenClassColor(i);
                    const tokenBgColor = tokenColorBgOpaque(tokenColor, 0.15, baseBg);
                    const borderColor = tokenColorBorder(tokenColor, 0.5);

                    const idBoxX = containerX + embedPadX;
                    outG.append('rect')
                        .attr('x', idBoxX).attr('y', ry + 1)
                        .attr('width', tokenIdBoxW).attr('height', embedRowH - 2)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', tokenBgColor)
                        .attr('stroke', borderColor)
                        .attr('stroke-width', 1.2);
                    outG.append('text')
                        .attr('x', idBoxX + tokenIdBoxW / 2).attr('y', ry + embedRowH / 2)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(7 * scale))
                        .attr('font-weight', 'bold')
                        .attr('fill', C.canvasText)
                        .text(activeData.tokens[i]);

                    const vecX = idBoxX + tokenIdBoxW + vecBarPad;
                    const vecW = containerW - embedPadX * 2 - tokenIdBoxW - vecBarPad;
                    outG.append('rect')
                        .attr('x', vecX).attr('y', ry + 1)
                        .attr('width', vecW).attr('height', embedRowH - 2)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', tokenBgColor)
                        .attr('stroke', borderColor)
                        .attr('stroke-width', 1.2);
                    outG.append('text')
                        .attr('x', vecX + vecW / 2).attr('y', ry + embedRowH / 2)
                        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                        .attr('font-family', MONO).attr('font-size', Math.round(6.5 * scale))
                        .attr('fill', C.textMuted)
                        .attr('opacity', 0.7)
                        .text(`<1, ${dModel}>`);
                }

                // Dimension label below container
                outG.append('text')
                    .attr('x', centerX).attr('y', zy + containerH + 12 * scale)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'hanging')
                    .attr('font-family', MONO).attr('font-size', 6.3 * scale)
                    .attr('fill', C.textMuted).attr('opacity', 0.7)
                    .text(`<${N}, ${dModel}>`);
            }
        }

        // ============================================
        // Zone C: Head-Lines View or Heatmap View
        // ============================================
        drawZoneC(C) {
            const phaseIdx = PHASES.indexOf(this.phase);
            const softmaxIdx = PHASES.indexOf('APPLY_SOFTMAX');
            const isModel = this.dataMode !== 'synthetic';

            if (phaseIdx < softmaxIdx) return;
            if (!this.getActiveData()) return;

            if (this.zoneViewMode === 'heatmap') {
                this.drawHeatmapView(C);
            } else if (!isModel) {
                this.drawHeadLinesView(C);
            }
        }

        // ============================================
        // Head-Lines View (BertViz-style)
        // ============================================
        drawHeadLinesView(C) {
            const g = this.gC;
            const activeData = this.getActiveData();
            const canvasW = this.layout.canvasW;
            const N = activeData.tokens.length;
            const zy = this.layout.C.y;
            const zh = this.layout.C.h;
            const heads = activeData.heads;
            const colors = getHeadColors();

            const progress = 1;

            // Title
            g.append('text')
                .attr('x', 15).attr('y', zy + 4)
                .attr('dominant-baseline', 'hanging')
                .attr('font-family', MONO).attr('font-size', 10).attr('font-weight', 'bold')
                .attr('fill', C.sectionTitle)
                .text('ATTENTION HEAD VIEW');

            // Layout
            const padding = 20;
            const leftX = 80;
            const rightX = canvasW / 2 - 20;
            const lineLeftX = leftX + 10;
            const lineRightX = rightX - 10;
            const topY = zy + padding + 6;
            const usableH = zh - padding * 2 - 6;
            const tokenSpacing = N > 1 ? usableH / (N - 1) : 0;

            const self = this;

            // Draw left token column (queries) — interactive
            for (let i = 0; i < N; i++) {
                const y = topY + i * tokenSpacing;
                const isHovered = (this.hoveredToken === i && this.hoveredSide === 'left');
                const tokenText = activeData.tokens[i];
                const textW = tokenText.length * 7 + 8;

                // Background highlight for hovered token
                if (isHovered) {
                    g.append('rect')
                        .attr('x', leftX - textW - 2).attr('y', y - 10)
                        .attr('width', textW + 4).attr('height', 20)
                        .attr('rx', 4).attr('ry', 4)
                        .attr('fill', C.qBg)
                        .attr('filter', 'url(#token-glow-q)');
                }

                const tokenG = g.append('g')
                    .attr('transform', isHovered ? `translate(${leftX}, ${y}) scale(1.1) translate(${-leftX}, ${-y})` : '');

                tokenG.append('text')
                    .attr('x', leftX).attr('y', y)
                    .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO)
                    .attr('font-size', isHovered ? 11 : 10)
                    .attr('font-weight', 'bold')
                    .attr('fill', isHovered ? C.activeBorder : C.qText)
                    .attr('cursor', 'pointer')
                    .datum({ idx: i, side: 'left' })
                    .on('mouseenter', function(event, d) {
                        self.hoveredToken = d.idx;
                        self.hoveredSide = d.side;
                        self.draw();
                    })
                    .on('mouseleave', function() {
                        self.hoveredToken = null;
                        self.hoveredSide = null;
                        self.draw();
                    })
                    .text(tokenText);

                // Dot at line anchor
                g.append('circle')
                    .attr('cx', lineLeftX).attr('cy', y).attr('r', isHovered ? 3 : 2)
                    .attr('fill', C.qText);
            }

            // Draw right token column (keys) — interactive
            for (let i = 0; i < N; i++) {
                const y = topY + i * tokenSpacing;
                const isHovered = (this.hoveredToken === i && this.hoveredSide === 'right');
                const tokenText = activeData.tokens[i];
                const textW = tokenText.length * 7 + 8;

                // Background highlight for hovered token
                if (isHovered) {
                    g.append('rect')
                        .attr('x', rightX - 2).attr('y', y - 10)
                        .attr('width', textW + 4).attr('height', 20)
                        .attr('rx', 4).attr('ry', 4)
                        .attr('fill', C.kBg)
                        .attr('filter', 'url(#token-glow-k)');
                }

                const tokenG = g.append('g')
                    .attr('transform', isHovered ? `translate(${rightX}, ${y}) scale(1.1) translate(${-rightX}, ${-y})` : '');

                tokenG.append('text')
                    .attr('x', rightX).attr('y', y)
                    .attr('dominant-baseline', 'central')
                    .attr('font-family', MONO)
                    .attr('font-size', isHovered ? 11 : 10)
                    .attr('font-weight', 'bold')
                    .attr('fill', isHovered ? C.activeBorder : C.kText)
                    .attr('cursor', 'pointer')
                    .datum({ idx: i, side: 'right' })
                    .on('mouseenter', function(event, d) {
                        self.hoveredToken = d.idx;
                        self.hoveredSide = d.side;
                        self.draw();
                    })
                    .on('mouseleave', function() {
                        self.hoveredToken = null;
                        self.hoveredSide = null;
                        self.draw();
                    })
                    .text(tokenText);

                g.append('circle')
                    .attr('cx', lineRightX).attr('cy', y).attr('r', isHovered ? 3 : 2)
                    .attr('fill', C.kText);
            }

            // Draw attention lines for each visible head
            for (let h = 0; h < this.numHeads && h < heads.length; h++) {
                if (!this.visibleHeads[h]) continue;

                const weights = heads[h].attentionWeights;
                const color = colors[h % colors.length];

                for (let i = 0; i < N; i++) {
                    for (let j = 0; j < N; j++) {
                        const w = weights[i][j];
                        if (w < 0.01) continue;

                        if (this.hoveredToken !== null) {
                            if (this.hoveredSide === 'left' && i !== this.hoveredToken) continue;
                            if (this.hoveredSide === 'right' && j !== this.hoveredToken) continue;
                        }

                        const y1 = topY + i * tokenSpacing;
                        const y2 = topY + j * tokenSpacing;

                        g.append('line')
                            .attr('x1', lineLeftX).attr('y1', y1)
                            .attr('x2', lineRightX).attr('y2', y2)
                            .attr('stroke', color)
                            .attr('stroke-width', 1 + w * 3)
                            .attr('opacity', progress * w);
                    }
                }
            }
        }

        // ============================================
        // Heatmap View (NxN grid)
        // ============================================
        drawHeatmapView(C) {
            const g = this.gC;
            const activeData = this.getActiveData();
            const canvasW = this.layout.canvasW;
            const N = activeData.tokens.length;
            const zy = this.layout.C.y;
            const zh = this.layout.C.h;
            const heads = activeData.heads;
            const colors = getHeadColors();
            const self = this;

            // Title
            g.append('text')
                .attr('x', 15).attr('y', zy + 4)
                .attr('dominant-baseline', 'hanging')
                .attr('font-family', MONO).attr('font-size', 10).attr('font-weight', 'bold')
                .attr('fill', C.sectionTitle)
                .text('ATTENTION HEATMAP');

            // Compute aggregated attention weights (average across visible heads)
            const aggWeights = [];
            let visibleCount = 0;
            for (let h = 0; h < this.numHeads && h < heads.length; h++) {
                if (!this.visibleHeads[h]) continue;
                visibleCount++;
            }

            for (let i = 0; i < N; i++) {
                const row = [];
                for (let j = 0; j < N; j++) {
                    let sum = 0;
                    for (let h = 0; h < this.numHeads && h < heads.length; h++) {
                        if (!this.visibleHeads[h]) continue;
                        sum += heads[h].attentionWeights[i][j];
                    }
                    row.push(visibleCount > 0 ? sum / visibleCount : 0);
                }
                aggWeights.push(row);
            }

            // Layout
            const padding = 24;
            const labelPad = 50;  // space for token labels
            const topY = zy + padding + 6;
            const usableH = zh - padding * 2 - 6;
            const cellSize = Math.min(
                (usableH - 10) / N,
                (canvasW / 2 - labelPad * 2) / N
            );
            const gridW = cellSize * N;
            const gridH = cellSize * N;
            const gridX = (canvasW / 2 - gridW) / 2 + labelPad;
            const gridY = topY + 10;

            // Draw row labels (queries - left side)
            for (let i = 0; i < N; i++) {
                const y = gridY + i * cellSize + cellSize / 2;
                const isSelected = this.selectedCell && this.selectedCell.i === i;
                g.append('text')
                    .attr('x', gridX - 6).attr('y', y)
                    .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
                    .attr('font-family', MONO).attr('font-size', 9)
                    .attr('font-weight', isSelected ? 'bold' : 'normal')
                    .attr('fill', isSelected ? C.activeBorder : C.qText)
                    .text(activeData.tokens[i]);
            }

            // Draw column labels (keys - top side)
            for (let j = 0; j < N; j++) {
                const x = gridX + j * cellSize + cellSize / 2;
                const isSelected = this.selectedCell && this.selectedCell.j === j;
                g.append('text')
                    .attr('x', x).attr('y', gridY - 6)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'alphabetic')
                    .attr('font-family', MONO).attr('font-size', 9)
                    .attr('font-weight', isSelected ? 'bold' : 'normal')
                    .attr('fill', isSelected ? C.activeBorder : C.kText)
                    .text(activeData.tokens[j]);
            }

            // Draw heatmap cells
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < N; j++) {
                    const x = gridX + j * cellSize;
                    const y = gridY + i * cellSize;
                    const w = aggWeights[i][j];
                    const isSelected = this.selectedCell && this.selectedCell.i === i && this.selectedCell.j === j;

                    // Cell background
                    const cellColor = interpolateHeatColor(w, C.heatCool, C.heatMid, C.heatWarm);
                    g.append('rect')
                        .attr('x', x).attr('y', y)
                        .attr('width', cellSize - 1).attr('height', cellSize - 1)
                        .attr('fill', cellColor)
                        .attr('stroke', isSelected ? C.activeBorder : 'none')
                        .attr('stroke-width', isSelected ? 2 : 0)
                        .attr('cursor', 'pointer')
                        .datum({ i, j, w })
                        .on('click', function(event, d) {
                            if (self.selectedCell && self.selectedCell.i === d.i && self.selectedCell.j === d.j) {
                                self.selectedCell = null;
                            } else {
                                self.selectedCell = { i: d.i, j: d.j };
                            }
                            self.draw();
                        });

                    // Show weight value for larger cells
                    if (cellSize >= 20) {
                        g.append('text')
                            .attr('x', x + (cellSize - 1) / 2).attr('y', y + (cellSize - 1) / 2)
                            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                            .attr('font-family', MONO).attr('font-size', 8)
                            .attr('fill', w > 0.5 ? EAIColor('surface') : C.cellText)
                            .attr('pointer-events', 'none')
                            .text(w.toFixed(2));
                    }
                }
            }

            // Draw color scale legend
            const scaleX = gridX + gridW + 20;
            const scaleY = gridY;
            const scaleW = 12;
            const scaleH = gridH;
            const gradSteps = 20;

            for (let s = 0; s < gradSteps; s++) {
                const t = 1 - s / (gradSteps - 1);  // reverse so high values at top
                const sy = scaleY + s * (scaleH / gradSteps);
                const sh = scaleH / gradSteps + 1;
                g.append('rect')
                    .attr('x', scaleX).attr('y', sy)
                    .attr('width', scaleW).attr('height', sh)
                    .attr('fill', interpolateHeatColor(t, C.heatCool, C.heatMid, C.heatWarm));
            }

            g.append('text')
                .attr('x', scaleX + scaleW + 4).attr('y', scaleY + 4)
                .attr('font-family', MONO).attr('font-size', 8)
                .attr('fill', C.labelColor)
                .text('1.0');

            g.append('text')
                .attr('x', scaleX + scaleW + 4).attr('y', scaleY + scaleH - 2)
                .attr('font-family', MONO).attr('font-size', 8)
                .attr('fill', C.labelColor)
                .text('0.0');

            // If a cell is selected, show details
            if (this.selectedCell) {
                const { i, j } = this.selectedCell;
                const detailX = canvasW / 2 + 30;
                const detailY = topY + 10;

                g.append('text')
                    .attr('x', detailX).attr('y', detailY)
                    .attr('font-family', MONO).attr('font-size', 11).attr('font-weight', 'bold')
                    .attr('fill', C.sectionTitle)
                    .text(`"${activeData.tokens[i]}" → "${activeData.tokens[j]}"`);

                g.append('text')
                    .attr('x', detailX).attr('y', detailY + 18)
                    .attr('font-family', MONO).attr('font-size', 10)
                    .attr('fill', C.labelColor)
                    .text(`Avg weight: ${aggWeights[i][j].toFixed(4)}`);

                // Show per-head weights
                let headY = detailY + 40;
                for (let h = 0; h < this.numHeads && h < heads.length; h++) {
                    if (!this.visibleHeads[h]) continue;
                    const hw = heads[h].attentionWeights[i][j];
                    const color = colors[h % colors.length];

                    g.append('circle')
                        .attr('cx', detailX + 6).attr('cy', headY - 3)
                        .attr('r', 5).attr('fill', color);

                    g.append('text')
                        .attr('x', detailX + 16).attr('y', headY)
                        .attr('font-family', MONO).attr('font-size', 9)
                        .attr('fill', C.cellText)
                        .text(`Head ${h}: ${hw.toFixed(4)}`);

                    headY += 16;
                }
            }
        }

        updateRunButtonState() {
            if (this.phase === 'IDLE') {
                this.btnRun.classList.add('pulse-ready');
            } else {
                this.btnRun.classList.remove('pulse-ready');
            }
        }
    }

    // ============================================
    // Bootstrap
    // ============================================
    function init() {
        clamp = VizLib.MathUtils.clamp;
        new AttentionVisualizer();

        const tabButtons = document.querySelectorAll('.info-panel-tabs [data-tab]');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const panel = btn.closest('.panel');
                panel.querySelectorAll('.info-tab-content').forEach(c => c.classList.remove('active'));
                const target = panel.querySelector('#tab-' + btn.dataset.tab);
                if (target) target.classList.add('active');
            });
        });
    }

    window.addEventListener('vizlib-ready', init);
})();

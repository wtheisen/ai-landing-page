/**
 * Markov Models & HMM Visualizer
 *
 * Interactive visualization of Markov chains and Hidden Markov Models.
 * Features state diagram rendering, transition matrix editing,
 * sequence generation with animation, and the Viterbi algorithm.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 350;

    const MIN_SEQ_LEN = 5;
    const MAX_SEQ_LEN = 20;

    // ============================================
    // Preset Models
    // ============================================
    const MODELS = {
        weather: {
            name: 'Weather',
            states: ['Sunny', 'Rainy', 'Cloudy'],
            stateColors: [0, 1, 2],
            initial: [0.5, 0.3, 0.2],
            transitions: [
                [0.6, 0.2, 0.2],
                [0.1, 0.5, 0.4],
                [0.3, 0.3, 0.4]
            ],
            // HMM emissions
            emissions: ['Hot', 'Cold', 'Mild'],
            emissionColors: [0, 1, 2],
            emissionMatrix: [
                [0.6, 0.1, 0.3],
                [0.1, 0.7, 0.2],
                [0.3, 0.2, 0.5]
            ]
        },
        text: {
            name: 'Text',
            states: ['Noun', 'Verb', 'Adj'],
            stateColors: [0, 1, 2],
            initial: [0.5, 0.2, 0.3],
            transitions: [
                [0.1, 0.6, 0.3],
                [0.5, 0.1, 0.4],
                [0.6, 0.3, 0.1]
            ],
            emissions: ['the', 'runs', 'big', 'cat', 'is'],
            emissionColors: [0, 1, 2, 3, 0],
            emissionMatrix: [
                [0.3, 0.0, 0.0, 0.5, 0.2],
                [0.0, 0.5, 0.0, 0.0, 0.5],
                [0.1, 0.0, 0.6, 0.0, 0.3]
            ]
        },
        custom: {
            name: 'Custom',
            states: ['A', 'B', 'C'],
            stateColors: [0, 1, 2],
            initial: [0.34, 0.33, 0.33],
            transitions: [
                [0.5, 0.3, 0.2],
                [0.2, 0.5, 0.3],
                [0.3, 0.2, 0.5]
            ],
            emissions: ['X', 'Y', 'Z'],
            emissionColors: [0, 1, 2],
            emissionMatrix: [
                [0.7, 0.2, 0.1],
                [0.1, 0.7, 0.2],
                [0.2, 0.1, 0.7]
            ]
        }
    };

    // ============================================
    // Theme Colors
    // ============================================
    function getThemeColors() {
        const isDark = window.VizLib && VizLib.ThemeManager
            ? VizLib.ThemeManager.isDarkTheme()
            : document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';

        if (isDark) {
            return {
                bg: EAIColor('canvas', 'dark'),
                text: EAIColor('ink-soft', 'dark'),
                textMuted: EAIColor('muted', 'dark'),
                stateColors: [EAIColor('class-1', 'dark'), EAIColor('class-4', 'dark'), EAIColor('class-3', 'dark'), EAIColor('class-2', 'dark')],
                emissionColors: [EAIColor('class-9', 'dark'), EAIColor('class-0', 'dark'), EAIColor('class-2', 'dark'), EAIColor('class-5', 'dark')],
                currentHighlight: EAIColor('gold', 0.35, 'dark'),
                currentBorder: EAIColor('gold', 'dark'),
                visitedBg: EAIColor('blue', 0.15, 'dark'),
                arrowColor: EAIColor('axis', 'dark'),
                arrowActive: EAIColor('gold', 'dark'),
                probText: EAIColor('ink-soft', 'dark'),
                nodeBg: EAIColor('sunken', 'dark'),
                nodeBorder: EAIColor('grid', 'dark'),
                selfLoopColor: EAIColor('axis', 'dark'),
                gridLine: EAIColor('grid', 'dark')
            };
        }
        return {
            bg: EAIColor('surface'),
            text: EAIColor('ink-soft'),
            textMuted: EAIColor('muted'),
            stateColors: [EAIColor('class-1', 'light'), EAIColor('class-4', 'light'), EAIColor('class-3', 'light'), EAIColor('class-2', 'light')],
            emissionColors: [EAIColor('class-9', 'light'), EAIColor('class-0', 'light'), EAIColor('class-2', 'light'), EAIColor('class-4', 'light')],
            currentHighlight: EAIColor('gold', 0.3),
            currentBorder: EAIColor('gold'),
            visitedBg: EAIColor('blue', 0.12),
            arrowColor: EAIColor('axis'),
            arrowActive: EAIColor('gold'),
            probText: EAIColor('ink-soft'),
            nodeBg: EAIColor('surface'),
            nodeBorder: EAIColor('grid'),
            selfLoopColor: EAIColor('axis'),
            gridLine: EAIColor('grid')
        };
    }

    // ============================================
    // Utility Functions
    // ============================================

    /** Sample from a discrete probability distribution. Returns index. */
    function sampleDistribution(probs) {
        const r = Math.random();
        let cumulative = 0;
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r < cumulative) return i;
        }
        return probs.length - 1;
    }

    /** Normalize an array so values sum to 1. */
    function normalize(arr) {
        const sum = arr.reduce((a, b) => a + b, 0);
        if (sum === 0) return arr.map(() => 1 / arr.length);
        return arr.map(v => v / sum);
    }

    /** Deep clone a 2D array. */
    function clone2D(arr) {
        return arr.map(row => [...row]);
    }

    /** Format a probability for display. */
    function fmtProb(p) {
        if (p === 0) return '0';
        if (p === 1) return '1';
        if (p < 0.001) return p.toExponential(1);
        return p.toFixed(3);
    }

    // ============================================
    // State Diagram Renderer
    // ============================================
    class StateDiagram {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.dpr = 1;
            this.nodeRadius = 35;
            this.positions = [];
            this.arrowLabelPositions = [];
            this.hoveredLabel = null;
        }

        setupCanvas() {
            if (window.VizLib && VizLib.setupHiDPICanvas) {
                const setup = VizLib.setupHiDPICanvas(this.canvas);
                this.dpr = setup.dpr || 1;
            } else {
                const dpr = window.devicePixelRatio || 1;
                this.canvas.width = CANVAS_WIDTH * dpr;
                this.canvas.height = CANVAS_HEIGHT * dpr;
                this.canvas.style.width = CANVAS_WIDTH + 'px';
                this.canvas.style.height = CANVAS_HEIGHT + 'px';
                this.ctx.scale(dpr, dpr);
                this.dpr = dpr;
            }
        }

        /** Compute state node positions in a circle layout. */
        computePositions(numStates) {
            const cx = CANVAS_WIDTH / 2;
            const cy = CANVAS_HEIGHT / 2;
            const radius = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.32;
            const positions = [];

            if (numStates === 2) {
                positions.push({ x: cx - radius * 0.7, y: cy });
                positions.push({ x: cx + radius * 0.7, y: cy });
            } else if (numStates === 3) {
                // Triangle arrangement
                const angleOffset = -Math.PI / 2;
                for (let i = 0; i < 3; i++) {
                    const angle = angleOffset + (2 * Math.PI * i) / 3;
                    positions.push({
                        x: cx + radius * Math.cos(angle),
                        y: cy + radius * Math.sin(angle)
                    });
                }
            } else {
                for (let i = 0; i < numStates; i++) {
                    const angle = -Math.PI / 2 + (2 * Math.PI * i) / numStates;
                    positions.push({
                        x: cx + radius * Math.cos(angle),
                        y: cy + radius * Math.sin(angle)
                    });
                }
            }
            this.positions = positions;
        }

        /** Draw the full state diagram. */
        render(model, currentState, visitedStates, activeTransition) {
            const ctx = this.ctx;
            const colors = getThemeColors();

            // Clear
            if (window.VizLib && VizLib.resetCanvasTransform) {
                VizLib.resetCanvasTransform(ctx, this.dpr);
                VizLib.clearCanvas(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, colors.bg);
            } else {
                ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
                ctx.fillStyle = colors.bg;
                ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            }

            // Reset label positions for hit detection
            this.arrowLabelPositions = [];

            const numStates = model.states.length;
            this.computePositions(numStates);

            // Draw transition arrows
            for (let i = 0; i < numStates; i++) {
                for (let j = 0; j < numStates; j++) {
                    const prob = model.transitions[i][j];
                    if (prob <= 0) continue;

                    const isActive = activeTransition &&
                        activeTransition.from === i && activeTransition.to === j;

                    if (i === j) {
                        this.drawSelfLoop(i, prob, isActive, colors);
                    } else {
                        this.drawArrow(i, j, prob, isActive, colors);
                    }
                }
            }

            // Draw state nodes
            for (let i = 0; i < numStates; i++) {
                const isCurrent = currentState === i;
                const isVisited = visitedStates && visitedStates.has(i);
                this.drawNode(i, model.states[i], isCurrent, isVisited,
                    colors.stateColors[model.stateColors[i] % colors.stateColors.length], colors);
            }
        }

        /** Draw a single state node. */
        drawNode(index, label, isCurrent, isVisited, stateColor, colors) {
            const ctx = this.ctx;
            const pos = this.positions[index];
            const r = this.nodeRadius;

            ctx.save();

            // Visited glow
            if (isVisited && !isCurrent) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
                ctx.fillStyle = colors.visitedBg;
                ctx.fill();
            }

            // Current highlight
            if (isCurrent) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, r + 8, 0, Math.PI * 2);
                ctx.fillStyle = colors.currentHighlight;
                ctx.fill();
                ctx.strokeStyle = colors.currentBorder;
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            // Node body
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            ctx.fillStyle = colors.nodeBg;
            ctx.fill();
            ctx.strokeStyle = stateColor;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Color band at top
            ctx.save();
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r - 1.5, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = stateColor;
            ctx.fillRect(pos.x - r, pos.y - r, r * 2, 14);
            ctx.restore();

            // Label
            ctx.fillStyle = colors.text;
            ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pos.x, pos.y + 4);

            ctx.restore();
        }

        /** Draw a directed arrow between two states. */
        drawArrow(from, to, prob, isActive, colors) {
            const ctx = this.ctx;
            const p1 = this.positions[from];
            const p2 = this.positions[to];
            const r = this.nodeRadius;

            // Direction vector
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / dist;
            const ny = dy / dist;

            // Offset the line to avoid overlapping with reverse arrow
            const offsetMag = 8;
            const ox = -ny * offsetMag;
            const oy = nx * offsetMag;

            // Start/end points (on node circumference)
            const startX = p1.x + nx * (r + 2) + ox;
            const startY = p1.y + ny * (r + 2) + oy;
            const endX = p2.x - nx * (r + 8) + ox;
            const endY = p2.y - ny * (r + 8) + oy;

            ctx.save();

            // Line
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = isActive ? colors.arrowActive : colors.arrowColor;
            ctx.lineWidth = isActive ? 3 : 1.5;
            ctx.stroke();

            // Arrowhead
            const headLen = 10;
            const angle = Math.atan2(endY - startY, endX - startX);
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - headLen * Math.cos(angle - 0.4),
                       endY - headLen * Math.sin(angle - 0.4));
            ctx.lineTo(endX - headLen * Math.cos(angle + 0.4),
                       endY - headLen * Math.sin(angle + 0.4));
            ctx.closePath();
            ctx.fillStyle = isActive ? colors.arrowActive : colors.arrowColor;
            ctx.fill();

            // Probability label
            const midX = (startX + endX) / 2 + ox * 0.5;
            const midY = (startY + endY) / 2 + oy * 0.5;
            ctx.font = 'bold 11px Menlo, Monaco, Consolas, monospace';
            ctx.fillStyle = isActive ? colors.arrowActive : colors.probText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Background for readability
            const text = prob.toFixed(2);
            const tm = ctx.measureText(text);
            const isHovered = this.hoveredLabel &&
                this.hoveredLabel.from === from && this.hoveredLabel.to === to;
            ctx.fillStyle = isHovered ? (colors.currentHighlight || 'rgba(251,192,45,0.3)') : colors.bg;
            ctx.globalAlpha = isHovered ? 1 : 0.85;
            ctx.fillRect(midX - tm.width / 2 - 3, midY - 7, tm.width + 6, 14);
            if (isHovered) {
                ctx.strokeStyle = colors.currentBorder || '#FBC02D';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(midX - tm.width / 2 - 3, midY - 7, tm.width + 6, 14);
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = isActive ? colors.arrowActive : colors.probText;
            ctx.fillText(text, midX, midY);

            // Store label position for hit detection
            this.arrowLabelPositions.push({ from, to, x: midX, y: midY });

            ctx.restore();
        }

        /** Draw a self-loop arc above a state. */
        drawSelfLoop(stateIdx, prob, isActive, colors) {
            const ctx = this.ctx;
            const pos = this.positions[stateIdx];
            const r = this.nodeRadius;

            ctx.save();

            // Determine loop direction (point away from center of diagram)
            const cx = CANVAS_WIDTH / 2;
            const cy = CANVAS_HEIGHT / 2;
            const awayAngle = Math.atan2(pos.y - cy, pos.x - cx);

            const loopRadius = 22;
            const loopCenterX = pos.x + Math.cos(awayAngle) * (r + loopRadius - 2);
            const loopCenterY = pos.y + Math.sin(awayAngle) * (r + loopRadius - 2);

            ctx.beginPath();
            ctx.arc(loopCenterX, loopCenterY, loopRadius, 0, Math.PI * 2);
            ctx.strokeStyle = isActive ? colors.arrowActive : colors.selfLoopColor;
            ctx.lineWidth = isActive ? 2.5 : 1.5;
            ctx.stroke();

            // Small arrowhead on the loop
            const arrowAngle = awayAngle + Math.PI * 0.7;
            const ax = loopCenterX + loopRadius * Math.cos(arrowAngle);
            const ay = loopCenterY + loopRadius * Math.sin(arrowAngle);
            const tangentAngle = arrowAngle + Math.PI / 2;
            const headLen = 8;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - headLen * Math.cos(tangentAngle - 0.4),
                       ay - headLen * Math.sin(tangentAngle - 0.4));
            ctx.lineTo(ax - headLen * Math.cos(tangentAngle + 0.4),
                       ay - headLen * Math.sin(tangentAngle + 0.4));
            ctx.closePath();
            ctx.fillStyle = isActive ? colors.arrowActive : colors.selfLoopColor;
            ctx.fill();

            // Probability label
            const labelX = loopCenterX + Math.cos(awayAngle) * (loopRadius + 10);
            const labelY = loopCenterY + Math.sin(awayAngle) * (loopRadius + 10);
            ctx.font = 'bold 11px Menlo, Monaco, Consolas, monospace';
            const text = prob.toFixed(2);
            const tm = ctx.measureText(text);
            const isHovered = this.hoveredLabel &&
                this.hoveredLabel.from === stateIdx && this.hoveredLabel.to === stateIdx;
            ctx.fillStyle = isHovered ? (colors.currentHighlight || 'rgba(251,192,45,0.3)') : colors.bg;
            ctx.globalAlpha = isHovered ? 1 : 0.85;
            ctx.fillRect(labelX - tm.width / 2 - 3, labelY - 7, tm.width + 6, 14);
            if (isHovered) {
                ctx.strokeStyle = colors.currentBorder || '#FBC02D';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(labelX - tm.width / 2 - 3, labelY - 7, tm.width + 6, 14);
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = isActive ? colors.arrowActive : colors.probText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);

            // Store label position for hit detection
            this.arrowLabelPositions.push({ from: stateIdx, to: stateIdx, x: labelX, y: labelY });

            ctx.restore();
        }

        /** Hit-test mouse coordinates against stored arrow label positions. */
        hitTest(mx, my) {
            const hitRadius = 20;
            for (const lbl of this.arrowLabelPositions) {
                const dx = mx - lbl.x;
                const dy = my - lbl.y;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    return { type: 'arrow', from: lbl.from, to: lbl.to, x: lbl.x, y: lbl.y };
                }
            }
            return null;
        }

        /** Convert mouse event to canvas logical coordinates. */
        getCanvasCoords(e) {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = CANVAS_WIDTH / rect.width;
            const scaleY = CANVAS_HEIGHT / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        }
    }

    // ============================================
    // Markov Chain Engine
    // ============================================
    class MarkovEngine {
        constructor() {
            this.model = null;
            this.sequence = [];
            this.hiddenSequence = [];
            this.observedSequence = [];
            this.viterbiPath = [];
            this.currentStep = -1;
        }

        loadModel(key) {
            const preset = MODELS[key];
            this.model = {
                name: preset.name,
                states: [...preset.states],
                stateColors: [...preset.stateColors],
                initial: [...preset.initial],
                transitions: clone2D(preset.transitions),
                emissions: preset.emissions ? [...preset.emissions] : null,
                emissionColors: preset.emissionColors ? [...preset.emissionColors] : null,
                emissionMatrix: preset.emissionMatrix ? clone2D(preset.emissionMatrix) : null
            };
            this.reset();
        }

        reset() {
            this.sequence = [];
            this.hiddenSequence = [];
            this.observedSequence = [];
            this.viterbiPath = [];
            this.currentStep = -1;
        }

        /** Generate a Markov chain sequence. */
        generateMC(length) {
            this.reset();
            const startState = sampleDistribution(this.model.initial);
            this.sequence = [startState];
            for (let t = 1; t < length; t++) {
                const prev = this.sequence[t - 1];
                const next = sampleDistribution(this.model.transitions[prev]);
                this.sequence.push(next);
            }
            return this.sequence;
        }

        /** Generate an HMM sequence (hidden states + observations). */
        generateHMM(length) {
            this.reset();
            const startState = sampleDistribution(this.model.initial);
            this.hiddenSequence = [startState];
            this.observedSequence = [sampleDistribution(this.model.emissionMatrix[startState])];

            for (let t = 1; t < length; t++) {
                const prev = this.hiddenSequence[t - 1];
                const next = sampleDistribution(this.model.transitions[prev]);
                this.hiddenSequence.push(next);
                this.observedSequence.push(sampleDistribution(this.model.emissionMatrix[next]));
            }
            return { hidden: this.hiddenSequence, observed: this.observedSequence };
        }

        /** Run Viterbi algorithm to find most likely hidden state path. */
        viterbi(observations) {
            const m = this.model;
            const N = m.states.length;
            const T = observations.length;

            // V[t][j] = max probability of path ending in state j at time t
            const V = [];
            const ptr = []; // backpointers

            // Initialize
            V[0] = [];
            ptr[0] = [];
            for (let j = 0; j < N; j++) {
                V[0][j] = m.initial[j] * m.emissionMatrix[j][observations[0]];
                ptr[0][j] = -1;
            }

            // Recurse
            for (let t = 1; t < T; t++) {
                V[t] = [];
                ptr[t] = [];
                for (let j = 0; j < N; j++) {
                    let maxVal = -1;
                    let maxIdx = 0;
                    for (let i = 0; i < N; i++) {
                        const val = V[t - 1][i] * m.transitions[i][j];
                        if (val > maxVal) {
                            maxVal = val;
                            maxIdx = i;
                        }
                    }
                    V[t][j] = maxVal * m.emissionMatrix[j][observations[t]];
                    ptr[t][j] = maxIdx;
                }
            }

            // Find best final state
            let bestState = 0;
            let bestVal = V[T - 1][0];
            for (let j = 1; j < N; j++) {
                if (V[T - 1][j] > bestVal) {
                    bestVal = V[T - 1][j];
                    bestState = j;
                }
            }

            // Backtrace
            const path = new Array(T);
            path[T - 1] = bestState;
            for (let t = T - 2; t >= 0; t--) {
                path[t] = ptr[t + 1][path[t + 1]];
            }

            this.viterbiPath = path;
            this.viterbiProb = bestVal;
            return { path: path, probability: bestVal, trellis: V };
        }

        /** Compute path probability for a state sequence. */
        pathProbability(seq) {
            if (!seq || seq.length === 0) return 0;
            let prob = this.model.initial[seq[0]];
            for (let t = 1; t < seq.length; t++) {
                prob *= this.model.transitions[seq[t - 1]][seq[t]];
            }
            return prob;
        }

        /** Update a transition probability and normalize the row. */
        updateTransition(from, to, value) {
            this.model.transitions[from][to] = value;
            // Normalize the row
            this.model.transitions[from] = normalize(this.model.transitions[from]);
        }
    }

    // ============================================
    // Main Visualizer
    // ============================================
    class MarkovVisualizer {
        constructor() {
            this.canvas = document.getElementById('markov-canvas');
            this.diagram = new StateDiagram(this.canvas);
            this.engine = new MarkovEngine();

            this.mode = 'mc'; // 'mc' or 'hmm'
            this.seqLen = 10;
            this.currentStep = -1;
            this.visitedStates = new Set();
            this.activeTransition = null;
            this.animTimer = null;
            this.animSpeed = 5;
            this.isAnimating = false;

            this.diagram.setupCanvas();
        }

        // ---- Initialization ----

        init() {
            this.bindControls();
            this.loadModel('weather');
            this.render();
        }

        bindControls() {
            // Model select
            document.getElementById('model-select').addEventListener('change', (e) => {
                this.loadModel(e.target.value);
            });

            // Mode select
            document.getElementById('mode-select').addEventListener('change', (e) => {
                this.setMode(e.target.value);
            });

            // Sequence length stepper
            document.getElementById('seqlen-dec').addEventListener('click', () => {
                if (this.seqLen > MIN_SEQ_LEN) {
                    this.seqLen--;
                    this.updateSeqLenDisplay();
                }
            });
            document.getElementById('seqlen-inc').addEventListener('click', () => {
                if (this.seqLen < MAX_SEQ_LEN) {
                    this.seqLen++;
                    this.updateSeqLenDisplay();
                }
            });

            // Buttons
            document.getElementById('btn-generate').addEventListener('click', () => this.generate());
            document.getElementById('btn-viterbi').addEventListener('click', () => this.runViterbi());
            document.getElementById('btn-step').addEventListener('click', () => this.stepForward());
            document.getElementById('btn-reset').addEventListener('click', () => this.resetAll());

            // Speed slider
            document.getElementById('speed-slider').addEventListener('input', (e) => {
                this.animSpeed = parseInt(e.target.value);
                document.getElementById('speed-value').textContent = this.animSpeed;
            });

            // Info panel tabs (btn-group variant)
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

            // Canvas mousemove — cursor feedback on probability labels
            this.canvas.addEventListener('mousemove', (e) => {
                const coords = this.diagram.getCanvasCoords(e);
                const hit = this.diagram.hitTest(coords.x, coords.y);
                if (hit) {
                    this.canvas.style.cursor = 'pointer';
                    if (!this.diagram.hoveredLabel ||
                        this.diagram.hoveredLabel.from !== hit.from ||
                        this.diagram.hoveredLabel.to !== hit.to) {
                        this.diagram.hoveredLabel = { from: hit.from, to: hit.to };
                        this.render();
                    }
                } else {
                    this.canvas.style.cursor = 'default';
                    if (this.diagram.hoveredLabel) {
                        this.diagram.hoveredLabel = null;
                        this.render();
                    }
                }
            });

            // Canvas click — open inline editor on probability labels
            this.canvas.addEventListener('click', (e) => {
                const coords = this.diagram.getCanvasCoords(e);
                const hit = this.diagram.hitTest(coords.x, coords.y);
                if (hit) {
                    this.openInlineEditor(hit.from, hit.to, hit.x, hit.y);
                } else {
                    this.cancelInlineEdit();
                }
            });

            // Theme change
            if (window.VizLib && VizLib.ThemeManager) {
                VizLib.ThemeManager.onThemeChange(() => this.render());
            }
        }

        // ---- Model Management ----

        loadModel(key) {
            this.stopAnimation();
            this.engine.loadModel(key);
            this.currentStep = -1;
            this.visitedStates.clear();
            this.activeTransition = null;
            this.buildEmissionTable();
            this.updateMetrics();
            this.clearSequenceDisplay();
            this.updateModeUI();
            this.render();
        }

        setMode(mode) {
            this.mode = mode;
            this.stopAnimation();
            this.currentStep = -1;
            this.visitedStates.clear();
            this.activeTransition = null;
            this.updateModeUI();
            this.clearSequenceDisplay();
            this.updateMetrics();
            this.render();
        }

        updateModeUI() {
            const badge = document.getElementById('mode-badge');
            const viterbiBtn = document.getElementById('btn-viterbi');
            const emissionContainer = document.getElementById('emission-container');
            const seqDisplay = document.getElementById('sequence-display');
            const hmmDisplay = document.getElementById('hmm-display');

            if (this.mode === 'hmm') {
                badge.textContent = 'Hidden Markov Model';
                badge.className = 'viz-badge markov-mode-badge';
                viterbiBtn.disabled = false;
                emissionContainer.style.display = '';
                seqDisplay.style.display = 'none';
                hmmDisplay.style.display = '';
            } else {
                badge.textContent = 'Markov Chain';
                badge.className = 'viz-badge markov-mode-badge';
                viterbiBtn.disabled = true;
                emissionContainer.style.display = 'none';
                seqDisplay.style.display = '';
                hmmDisplay.style.display = 'none';
            }

            document.getElementById('metric-seqlen').textContent = this.seqLen;
        }

        updateSeqLenDisplay() {
            document.getElementById('seqlen-value').textContent = this.seqLen;
            document.getElementById('metric-seqlen').textContent = this.seqLen;
        }

        buildEmissionTable() {
            const container = document.getElementById('emission-matrix');
            const m = this.engine.model;
            if (!m.emissions || !m.emissionMatrix) {
                container.innerHTML = '';
                return;
            }

            const N = m.states.length;
            const E = m.emissions.length;

            let html = '<table class="emission-table"><thead><tr><th>State \\ Emission</th>';
            for (let k = 0; k < E; k++) {
                html += '<th>' + m.emissions[k] + '</th>';
            }
            html += '</tr></thead><tbody>';

            for (let j = 0; j < N; j++) {
                html += '<tr><td class="row-header">' + m.states[j] + '</td>';
                for (let k = 0; k < E; k++) {
                    html += '<td>' + m.emissionMatrix[j][k].toFixed(2) + '</td>';
                }
                html += '</tr>';
            }

            html += '</tbody></table>';
            container.innerHTML = html;
        }

        // ---- Inline Probability Editor ----

        openInlineEditor(from, to, canvasX, canvasY) {
            const editor = document.getElementById('inline-editor');
            const input = document.getElementById('inline-editor-input');
            if (!editor || !input) return;

            // Convert canvas logical coords to CSS position relative to canvas-wrapper
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = rect.width / CANVAS_WIDTH;
            const scaleY = rect.height / CANVAS_HEIGHT;
            const cssX = canvasX * scaleX;
            const cssY = canvasY * scaleY;

            editor.style.left = cssX + 'px';
            editor.style.top = cssY + 'px';
            editor.style.display = '';

            // Pre-fill with current value
            const currentVal = this.engine.model.transitions[from][to];
            input.value = currentVal.toFixed(2);
            input.select();
            input.focus();

            // Store which transition is being edited
            this._editingFrom = from;
            this._editingTo = to;

            // Remove old listeners (to avoid stacking)
            const newInput = input.cloneNode(true);
            input.parentNode.replaceChild(newInput, input);

            newInput.select();
            newInput.focus();

            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.commitInlineEdit(this._editingFrom, this._editingTo, newInput.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.cancelInlineEdit();
                }
            });

            newInput.addEventListener('blur', () => {
                // Small delay to allow click-away detection
                setTimeout(() => {
                    if (document.getElementById('inline-editor').style.display !== 'none') {
                        this.cancelInlineEdit();
                    }
                }, 150);
            });
        }

        commitInlineEdit(from, to, value) {
            const editor = document.getElementById('inline-editor');
            let val = parseFloat(value);

            if (isNaN(val) || val < 0) {
                this.cancelInlineEdit();
                return;
            }

            // Clamp 0–1
            val = Math.max(0, Math.min(1, val));
            this.engine.updateTransition(from, to, val);

            // Hide editor
            editor.style.display = 'none';

            // Re-render and update
            this.render();
            this.updateMetrics();
        }

        cancelInlineEdit() {
            const editor = document.getElementById('inline-editor');
            if (editor) {
                editor.style.display = 'none';
            }
        }

        // ---- Sequence Generation ----

        generate() {
            this.stopAnimation();
            this.currentStep = -1;
            this.visitedStates.clear();
            this.activeTransition = null;

            if (this.mode === 'mc') {
                this.engine.generateMC(this.seqLen);
                this.displayMCSequence();
            } else {
                this.engine.generateHMM(this.seqLen);
                this.displayHMMSequence();
                document.getElementById('viterbi-row').style.display = 'none';
            }

            this.updateMetrics();
            this.animateSequence();
        }

        displayMCSequence() {
            const container = document.getElementById('sequence-display');
            const seq = this.engine.sequence;
            const m = this.engine.model;

            let html = '<div class="sequence-strip">';
            for (let t = 0; t < seq.length; t++) {
                if (t > 0) html += '<span class="seq-arrow"><i class="fa fa-caret-right"></i></span>';
                html += '<span class="seq-token state-' + m.stateColors[seq[t]]
                    + '" id="seq-mc-' + t + '">' + m.states[seq[t]] + '</span>';
            }
            html += '</div>';
            container.innerHTML = html;
        }

        displayHMMSequence() {
            const m = this.engine.model;
            const hidden = this.engine.hiddenSequence;
            const observed = this.engine.observedSequence;

            // Hidden row
            let hiddenHTML = '';
            for (let t = 0; t < hidden.length; t++) {
                if (t > 0) hiddenHTML += '<span class="seq-arrow"><i class="fa fa-caret-right"></i></span>';
                hiddenHTML += '<span class="seq-token state-' + m.stateColors[hidden[t]]
                    + '" id="seq-hidden-' + t + '">' + m.states[hidden[t]] + '</span>';
            }
            document.getElementById('hidden-sequence').innerHTML = hiddenHTML;

            // Observed row
            let obsHTML = '';
            for (let t = 0; t < observed.length; t++) {
                if (t > 0) obsHTML += '<span class="seq-arrow"><i class="fa fa-caret-right"></i></span>';
                obsHTML += '<span class="seq-token emission-' + (m.emissionColors[observed[t]] % 4)
                    + '" id="seq-obs-' + t + '">' + m.emissions[observed[t]] + '</span>';
            }
            document.getElementById('observed-sequence').innerHTML = obsHTML;
        }

        clearSequenceDisplay() {
            document.getElementById('sequence-display').innerHTML =
                '<p class="text-muted text-center" style="font-size: 12px;">Click "Generate" to create a sequence.</p>';
            document.getElementById('hidden-sequence').innerHTML = '';
            document.getElementById('observed-sequence').innerHTML = '';
            document.getElementById('viterbi-sequence').innerHTML = '';
            document.getElementById('viterbi-row').style.display = 'none';
        }

        // ---- Animation ----

        animateSequence() {
            this.currentStep = 0;
            this.visitedStates.clear();
            this.isAnimating = true;
            this.highlightStep(0);
            this.scheduleNextStep();
        }

        scheduleNextStep() {
            if (!this.isAnimating) return;
            const delay = 1200 - (this.animSpeed - 1) * 110; // 1200ms at speed 1, ~200ms at speed 10
            this.animTimer = setTimeout(() => {
                this.stepForward();
                if (this.isAnimating && this.currentStep < this.getSequenceLength() - 1) {
                    this.scheduleNextStep();
                } else {
                    this.isAnimating = false;
                    this.activeTransition = null;
                    this.render();
                    this.updateMetrics();
                }
            }, delay);
        }

        stepForward() {
            const seqLen = this.getSequenceLength();
            if (seqLen === 0) return;

            if (this.currentStep < seqLen - 1) {
                this.currentStep++;
                this.highlightStep(this.currentStep);
            }
        }

        highlightStep(step) {
            const seq = this.mode === 'mc'
                ? this.engine.sequence
                : this.engine.hiddenSequence;

            if (!seq || seq.length === 0) return;

            const currentState = seq[step];
            this.visitedStates.add(currentState);

            // Track active transition
            if (step > 0) {
                this.activeTransition = { from: seq[step - 1], to: seq[step] };
            } else {
                this.activeTransition = null;
            }

            // Update sequence token highlights
            this.updateTokenHighlights(step);

            this.render();
            this.updateMetrics();
        }

        updateTokenHighlights(activeStep) {
            const seqLen = this.getSequenceLength();

            if (this.mode === 'mc') {
                for (let t = 0; t < seqLen; t++) {
                    const el = document.getElementById('seq-mc-' + t);
                    if (!el) continue;
                    el.classList.remove('active', 'dimmed');
                    if (t === activeStep) {
                        el.classList.add('active');
                    } else if (t > activeStep) {
                        el.classList.add('dimmed');
                    }
                }
            } else {
                for (let t = 0; t < seqLen; t++) {
                    const hidEl = document.getElementById('seq-hidden-' + t);
                    const obsEl = document.getElementById('seq-obs-' + t);
                    if (hidEl) {
                        hidEl.classList.remove('active', 'dimmed');
                        if (t === activeStep) hidEl.classList.add('active');
                        else if (t > activeStep) hidEl.classList.add('dimmed');
                    }
                    if (obsEl) {
                        obsEl.classList.remove('active', 'dimmed');
                        if (t === activeStep) obsEl.classList.add('active');
                        else if (t > activeStep) obsEl.classList.add('dimmed');
                    }
                }
            }
        }

        stopAnimation() {
            this.isAnimating = false;
            if (this.animTimer) {
                clearTimeout(this.animTimer);
                this.animTimer = null;
            }
        }

        getSequenceLength() {
            if (this.mode === 'mc') return this.engine.sequence.length;
            return this.engine.hiddenSequence.length;
        }

        // ---- Viterbi ----

        runViterbi() {
            if (this.mode !== 'hmm') return;
            if (this.engine.observedSequence.length === 0) {
                this.generate();
            }

            const result = this.engine.viterbi(this.engine.observedSequence);
            this.displayViterbiPath(result.path);
            this.updateMetrics();
        }

        displayViterbiPath(path) {
            const m = this.engine.model;
            const hidden = this.engine.hiddenSequence;
            const container = document.getElementById('viterbi-sequence');
            const row = document.getElementById('viterbi-row');

            let html = '';
            for (let t = 0; t < path.length; t++) {
                if (t > 0) html += '<span class="seq-arrow"><i class="fa fa-caret-right"></i></span>';
                const match = path[t] === hidden[t];
                const extraClass = match ? 'viterbi-match' : 'viterbi-mismatch';
                html += '<span class="seq-token state-' + m.stateColors[path[t]]
                    + ' ' + extraClass
                    + '">' + m.states[path[t]] + '</span>';
            }
            container.innerHTML = html;
            row.style.display = '';
        }

        // ---- Rendering ----

        render() {
            const seq = this.mode === 'mc'
                ? this.engine.sequence
                : this.engine.hiddenSequence;
            const currentState = (seq && this.currentStep >= 0 && this.currentStep < seq.length)
                ? seq[this.currentStep]
                : -1;

            this.diagram.render(
                this.engine.model,
                currentState,
                this.visitedStates,
                this.activeTransition
            );
        }

        // ---- Metrics ----

        updateMetrics() {
            const m = this.engine.model;
            const seq = this.mode === 'mc'
                ? this.engine.sequence
                : this.engine.hiddenSequence;

            document.getElementById('metric-states').textContent = m.states.length;
            document.getElementById('metric-seqlen').textContent = this.seqLen;

            if (seq && seq.length > 0 && this.currentStep >= 0) {
                document.getElementById('metric-current').textContent =
                    m.states[seq[this.currentStep]];
                document.getElementById('metric-step').textContent =
                    (this.currentStep + 1) + ' / ' + seq.length;

                const pathProb = this.engine.pathProbability(
                    seq.slice(0, this.currentStep + 1)
                );
                document.getElementById('metric-prob').textContent = fmtProb(pathProb);
            } else {
                document.getElementById('metric-current').textContent = '-';
                document.getElementById('metric-step').textContent = '0';
                document.getElementById('metric-prob').textContent = '-';
            }

            // Status
            let status = 'Ready';
            if (this.isAnimating) {
                status = 'Animating...';
            } else if (seq && seq.length > 0 && this.currentStep >= seq.length - 1) {
                status = 'Complete';
            } else if (seq && seq.length > 0) {
                status = 'Paused';
            }
            if (this.engine.viterbiPath.length > 0 && this.mode === 'hmm') {
                const matches = this.engine.viterbiPath.filter(
                    (s, t) => s === this.engine.hiddenSequence[t]
                ).length;
                status += ' | Viterbi: ' + matches + '/' + this.engine.viterbiPath.length + ' correct';
            }
            document.getElementById('metric-status').textContent = status;
        }

        // ---- Reset ----

        resetAll() {
            this.stopAnimation();
            this.engine.reset();
            this.currentStep = -1;
            this.visitedStates.clear();
            this.activeTransition = null;
            this.clearSequenceDisplay();
            this.updateMetrics();
            this.render();
        }
    }

    // ============================================
    // Initialization
    // ============================================
    function init() {
        const viz = new MarkovVisualizer();
        viz.init();
    }

    window.addEventListener('vizlib-ready', init);
})();

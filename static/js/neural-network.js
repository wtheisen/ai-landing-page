/**
 * Feed-Forward Neural Network Visualizer
 *
 * Interactive visualization of a feed-forward neural network with real
 * backpropagation, decision boundary rendering, and network architecture diagram.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const BOUNDARY_W = 560;
    const BOUNDARY_H = 400;
    const NETWORK_W = 560;
    const NETWORK_H = 200;
    const POINT_RADIUS = 5;
    const DEFAULT_NUM_POINTS = 200;
    const BOUNDARY_RESOLUTION = 60; // grid cells for decision boundary

    // ============================================
    // Utility helpers (assigned in init() after VizLib is available)
    // ============================================
    let clamp;
    let gaussian;

    function shuffleArray(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ============================================
    // Activation functions and derivatives
    // ============================================
    const Activations = {
        relu: {
            fn: x => Math.max(0, x),
            dfn: x => x > 0 ? 1 : 0
        },
        sigmoid: {
            fn: x => 1 / (1 + Math.exp(-clamp(x, -500, 500))),
            dfn: x => {
                const s = 1 / (1 + Math.exp(-clamp(x, -500, 500)));
                return s * (1 - s);
            }
        },
        tanh: {
            fn: x => Math.tanh(x),
            dfn: x => 1 - Math.tanh(x) ** 2
        }
    };

    // ============================================
    // Feed-Forward Neural Network
    // ============================================
    class NeuralNetwork {
        /**
         * @param {number[]} layerSizes e.g. [2, 4, 4, 2] for 2-input, two hidden(4), 2-output
         * @param {string} activationName 'relu' | 'sigmoid' | 'tanh'
         * @param {number} learningRate
         */
        constructor(layerSizes, activationName = 'relu', learningRate = 0.05) {
            this.layerSizes = layerSizes;
            this.numLayers = layerSizes.length;
            this.activation = Activations[activationName] || Activations.relu;
            this.activationName = activationName;
            this.lr = learningRate;

            // Initialize weights and biases with Xavier initialization
            this.weights = []; // weights[l] is a 2D array [nextSize][prevSize]
            this.biases = [];  // biases[l] is a 1D array [nextSize]

            for (let l = 0; l < this.numLayers - 1; l++) {
                const fanIn = layerSizes[l];
                const fanOut = layerSizes[l + 1];
                const scale = Math.sqrt(2 / (fanIn + fanOut));

                const W = [];
                const b = [];
                for (let j = 0; j < fanOut; j++) {
                    const row = [];
                    for (let i = 0; i < fanIn; i++) {
                        row.push(gaussian() * scale);
                    }
                    W.push(row);
                    b.push(0);
                }
                this.weights.push(W);
                this.biases.push(b);
            }
        }

        /**
         * Forward pass - returns activations at each layer and pre-activation values
         * @param {number[]} input
         * @returns {{activations: number[][], preActivations: number[][]}}
         */
        forward(input) {
            const activations = [input.slice()];
            const preActivations = [input.slice()];

            let current = input.slice();

            for (let l = 0; l < this.numLayers - 1; l++) {
                const W = this.weights[l];
                const b = this.biases[l];
                const nextSize = this.layerSizes[l + 1];
                const z = []; // pre-activation
                const a = []; // post-activation

                for (let j = 0; j < nextSize; j++) {
                    let sum = b[j];
                    for (let i = 0; i < current.length; i++) {
                        sum += W[j][i] * current[i];
                    }
                    z.push(sum);

                    // Output layer uses softmax (applied after), hidden layers use chosen activation
                    if (l < this.numLayers - 2) {
                        a.push(this.activation.fn(sum));
                    } else {
                        a.push(sum); // raw logits for output
                    }
                }

                preActivations.push(z);

                // Apply softmax to output layer
                if (l === this.numLayers - 2) {
                    const softmaxA = this._softmax(a);
                    activations.push(softmaxA);
                    current = softmaxA;
                } else {
                    activations.push(a);
                    current = a;
                }
            }

            return { activations, preActivations };
        }

        /**
         * Predict class probabilities for a single input
         * @param {number[]} input
         * @returns {number[]} class probabilities
         */
        predict(input) {
            const { activations } = this.forward(input);
            return activations[activations.length - 1];
        }

        /**
         * Train on a single sample via backpropagation
         * @param {number[]} input
         * @param {number[]} target one-hot target
         * @returns {number} cross-entropy loss for this sample
         */
        trainSample(input, target) {
            const { activations, preActivations } = this.forward(input);

            // Cross-entropy loss
            const output = activations[this.numLayers - 1];
            let loss = 0;
            for (let k = 0; k < output.length; k++) {
                const p = clamp(output[k], 1e-7, 1 - 1e-7);
                loss -= target[k] * Math.log(p);
            }

            // Backpropagation
            // Compute deltas for each layer (output to hidden)
            const deltas = new Array(this.numLayers);

            // Output layer delta: softmax + cross-entropy derivative = output - target
            const outputDelta = [];
            for (let k = 0; k < this.layerSizes[this.numLayers - 1]; k++) {
                outputDelta.push(output[k] - target[k]);
            }
            deltas[this.numLayers - 1] = outputDelta;

            // Hidden layer deltas
            for (let l = this.numLayers - 2; l >= 1; l--) {
                const delta = [];
                const nextDelta = deltas[l + 1];
                const W = this.weights[l]; // W[j][i] connects layer l -> l+1

                for (let i = 0; i < this.layerSizes[l]; i++) {
                    let sum = 0;
                    for (let j = 0; j < this.layerSizes[l + 1]; j++) {
                        sum += W[j][i] * nextDelta[j];
                    }
                    const dAct = this.activation.dfn(preActivations[l][i]);
                    delta.push(sum * dAct);
                }
                deltas[l] = delta;
            }

            // Update weights and biases
            for (let l = 0; l < this.numLayers - 1; l++) {
                const layerDelta = deltas[l + 1];
                const layerInput = activations[l];

                for (let j = 0; j < this.layerSizes[l + 1]; j++) {
                    for (let i = 0; i < this.layerSizes[l]; i++) {
                        this.weights[l][j][i] -= this.lr * layerDelta[j] * layerInput[i];
                    }
                    this.biases[l][j] -= this.lr * layerDelta[j];
                }
            }

            return loss;
        }

        /**
         * Train one epoch over the full dataset
         * @param {Array<{x:number, y:number, classLabel:number}>} data
         * @returns {{loss: number, accuracy: number}}
         */
        trainEpoch(data) {
            const shuffled = shuffleArray(data);
            let totalLoss = 0;
            let correct = 0;

            for (const point of shuffled) {
                const input = [point.x, point.y];
                const target = point.classLabel === 0 ? [1, 0] : [0, 1];
                totalLoss += this.trainSample(input, target);

                const probs = this.predict(input);
                const predicted = probs[0] > probs[1] ? 0 : 1;
                if (predicted === point.classLabel) correct++;
            }

            return {
                loss: totalLoss / data.length,
                accuracy: correct / data.length
            };
        }

        /**
         * Evaluate accuracy and loss on the full dataset (no weight updates)
         */
        evaluate(data) {
            let totalLoss = 0;
            let correct = 0;

            for (const point of data) {
                const input = [point.x, point.y];
                const target = point.classLabel === 0 ? [1, 0] : [0, 1];
                const probs = this.predict(input);

                for (let k = 0; k < probs.length; k++) {
                    const p = clamp(probs[k], 1e-7, 1 - 1e-7);
                    totalLoss -= target[k] * Math.log(p);
                }

                const predicted = probs[0] > probs[1] ? 0 : 1;
                if (predicted === point.classLabel) correct++;
            }

            return {
                loss: totalLoss / data.length,
                accuracy: correct / data.length
            };
        }

        _softmax(logits) {
            const maxLogit = Math.max(...logits);
            const exps = logits.map(z => Math.exp(z - maxLogit));
            const sumExp = exps.reduce((a, b) => a + b, 0);
            return exps.map(e => e / sumExp);
        }
    }

    // ============================================
    // Dataset generation (local fallbacks + VizLib)
    // ============================================
    function generateDataset(type, n = DEFAULT_NUM_POINTS) {
        const DG = window.VizLib?.DatasetGenerators;

        switch (type) {
            case 'moons':
                return DG ? DG.moons(n, 0.1) : generateMoonsLocal(n);
            case 'circles':
                return DG ? DG.circles(n, 0.05) : generateCirclesLocal(n);
            case 'spiral':
                return DG ? DG.spiral(n, 0.03) : generateSpiralLocal(n);
            case 'blobs':
                return DG ? DG.blobs(n, 2) : generateBlobsLocal(n);
            case 'xor':
            default:
                return generateXOR(n);
        }
    }

    function generateXOR(n) {
        const points = [];
        const nPer = Math.floor(n / 4);
        const quadrants = [
            { cx: 0.25, cy: 0.75, label: 0 },
            { cx: 0.75, cy: 0.75, label: 1 },
            { cx: 0.25, cy: 0.25, label: 1 },
            { cx: 0.75, cy: 0.25, label: 0 }
        ];
        for (const q of quadrants) {
            for (let i = 0; i < nPer; i++) {
                points.push({
                    x: clamp(q.cx + (Math.random() - 0.5) * 0.35 + gaussian() * 0.03, 0.02, 0.98),
                    y: clamp(q.cy + (Math.random() - 0.5) * 0.35 + gaussian() * 0.03, 0.02, 0.98),
                    classLabel: q.label
                });
            }
        }
        return points;
    }

    function generateSpiralLocal(n) {
        const points = [];
        const nPerSpiral = Math.floor(n / 2);
        const turns = 1.5;
        for (let i = 0; i < nPerSpiral; i++) {
            const t = i / nPerSpiral;
            const angle = turns * 2 * Math.PI * t;
            const radius = 0.05 + 0.4 * t;
            points.push({
                x: clamp(0.5 + radius * Math.cos(angle) + gaussian() * 0.03, 0.02, 0.98),
                y: clamp(0.5 + radius * Math.sin(angle) + gaussian() * 0.03, 0.02, 0.98),
                classLabel: 0
            });
            points.push({
                x: clamp(0.5 + radius * Math.cos(angle + Math.PI) + gaussian() * 0.03, 0.02, 0.98),
                y: clamp(0.5 + radius * Math.sin(angle + Math.PI) + gaussian() * 0.03, 0.02, 0.98),
                classLabel: 1
            });
        }
        return points;
    }

    function generateMoonsLocal(n) {
        const points = [];
        const nPer = Math.floor(n / 2);
        for (let i = 0; i < nPer; i++) {
            const angle = Math.PI * i / nPer;
            const noise = () => (Math.random() - 0.5) * 0.2;
            const remap = (v, lo, hi) => (v - lo) / (hi - lo);
            points.push({
                x: remap(Math.cos(angle) + noise(), -1.5, 2.5),
                y: remap(Math.sin(angle) + noise(), -0.6, 1.6),
                classLabel: 0
            });
            points.push({
                x: remap(1 - Math.cos(angle) + noise(), -1.5, 2.5),
                y: remap(0.5 - Math.sin(angle) + noise(), -0.6, 1.6),
                classLabel: 1
            });
        }
        return points;
    }

    function generateCirclesLocal(n) {
        const points = [];
        const nPer = Math.floor(n / 2);
        for (let i = 0; i < nPer; i++) {
            const angle = 2 * Math.PI * Math.random();
            const r1 = 0.25 * (0.8 + 0.4 * Math.random()) + gaussian() * 0.03;
            points.push({
                x: clamp(0.5 + r1 * Math.cos(angle), 0.02, 0.98),
                y: clamp(0.5 + r1 * Math.sin(angle), 0.02, 0.98),
                classLabel: 0
            });
            const r2 = 0.5 * (0.8 + 0.4 * Math.random()) + gaussian() * 0.03;
            points.push({
                x: clamp(0.5 + r2 * Math.cos(angle), 0.02, 0.98),
                y: clamp(0.5 + r2 * Math.sin(angle), 0.02, 0.98),
                classLabel: 1
            });
        }
        return points;
    }

    function generateBlobsLocal(n) {
        const points = [];
        const centers = [
            { x: 0.3, y: 0.7, label: 0 },
            { x: 0.7, y: 0.3, label: 1 }
        ];
        const nPer = Math.floor(n / 2);
        for (const c of centers) {
            for (let i = 0; i < nPer; i++) {
                points.push({
                    x: clamp(c.x + gaussian() * 0.08, 0.02, 0.98),
                    y: clamp(c.y + gaussian() * 0.08, 0.02, 0.98),
                    classLabel: c.label
                });
            }
        }
        return points;
    }

    // ============================================
    // Decision Boundary Renderer
    // ============================================
    class BoundaryRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.logicalW = BOUNDARY_W;
            this.logicalH = BOUNDARY_H;
            this.classColors = [EAIColor('red'), EAIColor('blue')];
            this.gridColor = EAIColor('grid');
            this.textColor = EAIColor('ink-soft');
            this._setup();
        }

        _setup() {
            if (!this.canvas) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                const info = CU.setupHiDPICanvas(this.canvas);
                this.ctx = info.ctx;
                this.dpr = info.dpr;
                this.logicalW = info.logicalWidth;
                this.logicalH = info.logicalHeight;
            } else {
                this.ctx = this.canvas.getContext('2d');
                this.dpr = window.devicePixelRatio || 1;
                const rect = this.canvas.getBoundingClientRect();
                this.logicalW = rect.width;
                this.logicalH = rect.height;
                this.canvas.width = this.logicalW * this.dpr;
                this.canvas.height = this.logicalH * this.dpr;
                this.canvas.style.width = this.logicalW + 'px';
                this.canvas.style.height = this.logicalH + 'px';
            }
        }

        resize() {
            this._setup();
        }

        _resetTransform() {
            if (!this.ctx) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                CU.resetCanvasTransform(this.ctx, this.dpr);
            } else {
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        }

        updateColors() {
            if (window.VizLib?.ThemeManager) {
                const colors = window.VizLib.ThemeManager.getColors('categorical');
                this.classColors = [colors[0], colors[1]];
            }
            const style = getComputedStyle(document.documentElement);
            this.gridColor = style.getPropertyValue('--viz-border').trim() || '#dee2e6';
            this.textColor = style.getPropertyValue('--viz-text').trim() || '#333333';
            this.boundaryClass0 = style.getPropertyValue('--nn-boundary-class0').trim() || 'rgba(228,26,28,0.35)';
            this.boundaryClass1 = style.getPropertyValue('--nn-boundary-class1').trim() || 'rgba(55,126,184,0.35)';
        }

        render(network, data) {
            if (!this.ctx) return;
            this.updateColors();
            this._resetTransform();

            const ctx = this.ctx;
            const w = this.logicalW;
            const h = this.logicalH;
            ctx.clearRect(0, 0, w, h);

            // Draw decision boundary heatmap
            this._drawBoundary(network, w, h);

            // Draw grid
            this._drawGrid(w, h);

            // Draw data points
            this._drawPoints(data, w, h);
        }

        _drawBoundary(network, w, h) {
            if (!network) return;
            const ctx = this.ctx;
            const res = BOUNDARY_RESOLUTION;
            const cellW = w / res;
            const cellH = h / res;

            // Pre-parse the boundary colors to extract RGB for interpolation
            const c0rgb = this._parseColor(this.boundaryClass0);
            const c1rgb = this._parseColor(this.boundaryClass1);

            for (let gy = 0; gy < res; gy++) {
                for (let gx = 0; gx < res; gx++) {
                    const nx = (gx + 0.5) / res;
                    const ny = 1 - (gy + 0.5) / res;
                    const probs = network.predict([nx, ny]);
                    const p1 = probs[1]; // probability of class 1

                    // Interpolate between class0 color (p1=0) and class1 color (p1=1)
                    const r = Math.round(c0rgb[0] * (1 - p1) + c1rgb[0] * p1);
                    const g = Math.round(c0rgb[1] * (1 - p1) + c1rgb[1] * p1);
                    const b = Math.round(c0rgb[2] * (1 - p1) + c1rgb[2] * p1);
                    const a = 0.15 + 0.35 * Math.abs(p1 - 0.5) * 2;

                    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                    ctx.fillRect(gx * cellW, gy * cellH, cellW + 1, cellH + 1);
                }
            }
        }

        _parseColor(colorStr) {
            // Parse rgba(r,g,b,a) or hex
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            }
            // fallback hex
            if (colorStr.startsWith('#')) {
                const r = parseInt(colorStr.slice(1, 3), 16);
                const g = parseInt(colorStr.slice(3, 5), 16);
                const b = parseInt(colorStr.slice(5, 7), 16);
                return [r, g, b];
            }
            return [128, 128, 128];
        }

        _drawGrid(w, h) {
            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.3;
            const steps = 10;
            for (let i = 1; i < steps; i++) {
                const x = (w / steps) * i;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
                const y = (h / steps) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            ctx.restore();
        }

        _drawPoints(data, w, h) {
            const ctx = this.ctx;
            for (const pt of data) {
                const px = pt.x * w;
                const py = (1 - pt.y) * h;
                ctx.beginPath();
                ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = this.classColors[pt.classLabel];
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        getDataCoords(event) {
            const rect = this.canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            return {
                x: clamp(mx / this.logicalW, 0.02, 0.98),
                y: clamp(1 - my / this.logicalH, 0.02, 0.98)
            };
        }
    }

    // ============================================
    // Network Diagram Renderer
    // ============================================
    class NetworkRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.logicalW = NETWORK_W;
            this.logicalH = NETWORK_H;
            this._setup();
        }

        _setup() {
            if (!this.canvas) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                const info = CU.setupHiDPICanvas(this.canvas);
                this.ctx = info.ctx;
                this.dpr = info.dpr;
                this.logicalW = info.logicalWidth;
                this.logicalH = info.logicalHeight;
            } else {
                this.ctx = this.canvas.getContext('2d');
                this.dpr = window.devicePixelRatio || 1;
                const rect = this.canvas.getBoundingClientRect();
                this.logicalW = rect.width;
                this.logicalH = rect.height;
                this.canvas.width = this.logicalW * this.dpr;
                this.canvas.height = this.logicalH * this.dpr;
                this.canvas.style.width = this.logicalW + 'px';
                this.canvas.style.height = this.logicalH + 'px';
            }
        }

        resize() {
            this._setup();
        }

        _resetTransform() {
            if (!this.ctx) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                CU.resetCanvasTransform(this.ctx, this.dpr);
            } else {
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        }

        updateColors() {
            const style = getComputedStyle(document.documentElement);
            this.inputColor = style.getPropertyValue('--nn-input-node').trim() || '#377eb8';
            this.hiddenColor = style.getPropertyValue('--nn-hidden-node').trim() || '#4daf4a';
            this.outputColor = style.getPropertyValue('--nn-output-node').trim() || '#e41a1c';
            this.edgePositive = style.getPropertyValue('--nn-edge-positive').trim() || 'rgba(55,126,184,0.6)';
            this.edgeNegative = style.getPropertyValue('--nn-edge-negative').trim() || 'rgba(228,26,28,0.6)';
            this.edgeNeutral = style.getPropertyValue('--nn-edge-neutral').trim() || 'rgba(150,150,150,0.3)';
            this.textColor = style.getPropertyValue('--viz-text').trim() || '#333333';
            this.bgColor = style.getPropertyValue('--viz-canvas-bg').trim() || '#fafafa';
            this.activationGlow = style.getPropertyValue('--nn-activation-glow').trim() || 'rgba(255,193,7,0.6)';
        }

        render(network, forwardData) {
            if (!this.ctx || !network) return;
            this.updateColors();
            this._resetTransform();

            const ctx = this.ctx;
            const w = this.logicalW;
            const h = this.logicalH;
            ctx.clearRect(0, 0, w, h);

            const layers = network.layerSizes;
            const numLayers = layers.length;
            const paddingX = 60;
            const paddingY = 20;
            const layerSpacing = (w - 2 * paddingX) / (numLayers - 1);
            const maxNeurons = Math.max(...layers);
            const nodeRadius = Math.min(14, (h - 2 * paddingY) / (maxNeurons * 2.5));

            // Compute node positions
            const nodePositions = []; // [layer][neuron] = {x, y}
            for (let l = 0; l < numLayers; l++) {
                const layerNodes = [];
                const n = layers[l];
                const totalHeight = (n - 1) * nodeRadius * 2.8;
                const startY = (h - totalHeight) / 2;
                for (let i = 0; i < n; i++) {
                    layerNodes.push({
                        x: paddingX + l * layerSpacing,
                        y: startY + i * nodeRadius * 2.8
                    });
                }
                nodePositions.push(layerNodes);
            }

            // Get activation values if available
            let activations = null;
            if (forwardData) {
                activations = forwardData.activations;
            }

            // Draw edges (weights)
            for (let l = 0; l < numLayers - 1; l++) {
                const W = network.weights[l];
                // Find max weight magnitude for scaling
                let maxW = 0;
                for (let j = 0; j < layers[l + 1]; j++) {
                    for (let i = 0; i < layers[l]; i++) {
                        maxW = Math.max(maxW, Math.abs(W[j][i]));
                    }
                }
                if (maxW < 1e-6) maxW = 1;

                for (let j = 0; j < layers[l + 1]; j++) {
                    for (let i = 0; i < layers[l]; i++) {
                        const from = nodePositions[l][i];
                        const to = nodePositions[l + 1][j];
                        const weight = W[j][i];
                        const magnitude = Math.abs(weight) / maxW;

                        ctx.beginPath();
                        ctx.moveTo(from.x + nodeRadius, from.y);
                        ctx.lineTo(to.x - nodeRadius, to.y);
                        ctx.lineWidth = 0.5 + magnitude * 3;

                        if (weight > 0.01) {
                            ctx.strokeStyle = this.edgePositive;
                        } else if (weight < -0.01) {
                            ctx.strokeStyle = this.edgeNegative;
                        } else {
                            ctx.strokeStyle = this.edgeNeutral;
                        }
                        ctx.globalAlpha = 0.3 + magnitude * 0.7;
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                }
            }

            // Draw nodes
            for (let l = 0; l < numLayers; l++) {
                for (let i = 0; i < layers[l]; i++) {
                    const pos = nodePositions[l][i];

                    // Node color by layer type
                    let fillColor;
                    if (l === 0) {
                        fillColor = this.inputColor;
                    } else if (l === numLayers - 1) {
                        fillColor = this.outputColor;
                    } else {
                        fillColor = this.hiddenColor;
                    }

                    // Activation glow
                    if (activations && activations[l]) {
                        const actVal = Math.abs(activations[l][i]);
                        const glowIntensity = Math.min(1, actVal);
                        if (glowIntensity > 0.1) {
                            ctx.beginPath();
                            ctx.arc(pos.x, pos.y, nodeRadius + 4, 0, Math.PI * 2);
                            ctx.fillStyle = this.activationGlow;
                            ctx.globalAlpha = glowIntensity * 0.5;
                            ctx.fill();
                            ctx.globalAlpha = 1;
                        }
                    }

                    // Draw node circle
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Draw activation value inside node
                    if (activations && activations[l]) {
                        const val = activations[l][i];
                        ctx.fillStyle = EAIColor('surface');
                        ctx.font = `bold ${Math.max(8, nodeRadius * 0.8)}px sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(val.toFixed(1), pos.x, pos.y);
                    }
                }
            }

            // Layer labels
            ctx.font = '11px sans-serif';
            ctx.fillStyle = this.textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const labelY = h - 14;
            for (let l = 0; l < numLayers; l++) {
                const x = paddingX + l * layerSpacing;
                let label;
                if (l === 0) label = 'Input';
                else if (l === numLayers - 1) label = 'Output';
                else label = `Hidden ${l}`;
                ctx.fillText(label, x, labelY);
            }
        }
    }

    // ============================================
    // Main Controller
    // ============================================
    class NeuralNetworkViz {
        constructor() {
            this.boundaryCanvas = document.getElementById('boundary-canvas');
            this.networkCanvas = document.getElementById('network-canvas');

            this.boundaryRenderer = new BoundaryRenderer(this.boundaryCanvas);
            this.networkRenderer = new NetworkRenderer(this.networkCanvas);

            this.data = [];
            this.network = null;
            this.epoch = 0;
            this.isTraining = false;
            this.animationId = null;
            this.trainSpeed = 5; // epochs per animation frame
            this.addClassLabel = 0; // toggle for adding points

            this._init();
        }

        _init() {
            this._setupEventListeners();
            this._reset();

            // Theme change support
            if (window.VizLib?.ThemeManager) {
                window.VizLib.ThemeManager.onThemeChange(() => {
                    this._renderAll();
                });
            }

            // Resize handling
            window.addEventListener('resize', () => {
                this.boundaryRenderer.resize();
                this.networkRenderer.resize();
                this._renderAll();
            });
        }

        _setupEventListeners() {
            // Dataset
            document.getElementById('dataset-select')?.addEventListener('change', () => this._reset());

            // Activation
            document.getElementById('activation-select')?.addEventListener('change', () => this._reset());

            // Layer count stepper
            document.getElementById('layers-minus')?.addEventListener('click', () => {
                const el = document.getElementById('layers-value');
                const v = Math.max(1, parseInt(el.value) - 1);
                el.value = v;
                this._reset();
            });
            document.getElementById('layers-plus')?.addEventListener('click', () => {
                const el = document.getElementById('layers-value');
                const v = Math.min(3, parseInt(el.value) + 1);
                el.value = v;
                this._reset();
            });

            // Neuron count stepper
            document.getElementById('neurons-minus')?.addEventListener('click', () => {
                const el = document.getElementById('neurons-value');
                const v = Math.max(2, parseInt(el.value) - 1);
                el.value = v;
                this._reset();
            });
            document.getElementById('neurons-plus')?.addEventListener('click', () => {
                const el = document.getElementById('neurons-value');
                const v = Math.min(8, parseInt(el.value) + 1);
                el.value = v;
                this._reset();
            });

            // Learning rate slider
            const lrSlider = document.getElementById('lr-slider');
            const lrDisplay = document.getElementById('lr-value');
            lrSlider?.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                lrDisplay.textContent = val.toFixed(3);
                if (this.network) {
                    this.network.lr = val;
                }
                this._updateMetric('metric-lr', val.toFixed(3));
            });

            // Playback buttons
            document.getElementById('btn-train')?.addEventListener('click', () => this._startTraining());
            document.getElementById('btn-pause')?.addEventListener('click', () => this._pauseTraining());
            document.getElementById('btn-step')?.addEventListener('click', () => this._stepEpoch());
            document.getElementById('btn-reset')?.addEventListener('click', () => this._reset());

            // Speed slider
            document.getElementById('speed-slider')?.addEventListener('input', (e) => {
                this.trainSpeed = parseInt(e.target.value);
            });

            // Click on boundary canvas to add points
            this.boundaryCanvas?.addEventListener('click', (e) => {
                if (this.isTraining) return;
                const coords = this.boundaryRenderer.getDataCoords(e);
                // Determine class: left-click = alternating, use distance to nearest class centers or just alternate
                this.addClassLabel = 1 - this.addClassLabel;
                this.data.push({
                    x: coords.x,
                    y: coords.y,
                    classLabel: this.addClassLabel
                });
                this._renderAll();
            });
        }

        _getArchitecture() {
            const numHiddenLayers = parseInt(document.getElementById('layers-value')?.value || '1');
            const neuronsPerLayer = parseInt(document.getElementById('neurons-value')?.value || '4');
            const layers = [2]; // input layer: 2 features (x, y)
            for (let i = 0; i < numHiddenLayers; i++) {
                layers.push(neuronsPerLayer);
            }
            layers.push(2); // output layer: 2 classes
            return layers;
        }

        _reset() {
            this._pauseTraining();
            this.epoch = 0;

            const datasetType = document.getElementById('dataset-select')?.value || 'xor';
            const activation = document.getElementById('activation-select')?.value || 'relu';
            const lr = parseFloat(document.getElementById('lr-slider')?.value || '0.05');
            const architecture = this._getArchitecture();

            this.data = generateDataset(datasetType);
            this.network = new NeuralNetwork(architecture, activation, lr);

            this._updateMetrics();
            this._setStatus('Ready');
            this._renderAll();
        }

        _startTraining() {
            if (this.isTraining) return;
            this.isTraining = true;

            document.getElementById('btn-train').disabled = true;
            document.getElementById('btn-pause').disabled = false;
            this._setStatus('Training...');

            const trainLoop = () => {
                if (!this.isTraining) return;

                // Run multiple epochs per frame based on speed
                const epochsPerFrame = this.trainSpeed;
                let lastResult = null;
                for (let i = 0; i < epochsPerFrame; i++) {
                    lastResult = this.network.trainEpoch(this.data);
                    this.epoch++;
                }

                this._updateMetrics(lastResult);
                this._renderAll();

                this.animationId = requestAnimationFrame(trainLoop);
            };

            this.animationId = requestAnimationFrame(trainLoop);
        }

        _pauseTraining() {
            this.isTraining = false;
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            document.getElementById('btn-train').disabled = false;
            document.getElementById('btn-pause').disabled = true;
            if (this.epoch > 0) {
                this._setStatus('Paused');
            }
        }

        _stepEpoch() {
            if (this.isTraining) return;
            if (!this.network || this.data.length === 0) return;

            const result = this.network.trainEpoch(this.data);
            this.epoch++;
            this._updateMetrics(result);
            this._setStatus('Stepped');
            this._renderAll();
        }

        _renderAll() {
            // Get a forward pass for the network diagram visualization
            let forwardData = null;
            if (this.network && this.data.length > 0) {
                // Use the first data point for the forward pass visualization
                const samplePt = this.data[0];
                forwardData = this.network.forward([samplePt.x, samplePt.y]);
            }

            this.boundaryRenderer.render(this.network, this.data);
            this.networkRenderer.render(this.network, forwardData);
        }

        _updateMetrics(trainResult) {
            this._updateMetric('metric-epoch', String(this.epoch));

            if (trainResult) {
                this._updateMetric('metric-loss', trainResult.loss.toFixed(4));
                this._updateMetric('metric-accuracy', (trainResult.accuracy * 100).toFixed(1) + '%');
            } else if (this.network && this.data.length > 0) {
                const evalResult = this.network.evaluate(this.data);
                this._updateMetric('metric-loss', evalResult.loss.toFixed(4));
                this._updateMetric('metric-accuracy', (evalResult.accuracy * 100).toFixed(1) + '%');
            } else {
                this._updateMetric('metric-loss', '-');
                this._updateMetric('metric-accuracy', '0%');
            }

            const arch = this.network ? this.network.layerSizes.join('-') : '-';
            this._updateMetric('metric-architecture', arch);

            const lr = this.network ? this.network.lr.toFixed(3) : '-';
            this._updateMetric('metric-lr', lr);

            // Update epoch display
            const epochDisplay = document.getElementById('epoch-display');
            if (epochDisplay) epochDisplay.textContent = `Epoch: ${this.epoch}`;
        }

        _updateMetric(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }

        _setStatus(text) {
            this._updateMetric('metric-status', text);
        }
    }

    // ============================================
    // Initialize
    // ============================================
    function init() {
        clamp = VizLib.MathUtils.clamp;
        gaussian = VizLib.MathUtils.gaussian;
        new NeuralNetworkViz();
    }

    window.addEventListener('vizlib-ready', init);
})();

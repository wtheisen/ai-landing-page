/**
 * Backpropagation Visualizer
 *
 * Interactive inspection of backpropagation on a 2-3-1 feed-forward
 * network. Every connection exposes its forward value, analytic gradient,
 * chain-rule factors, proposed update, and numerical gradient check.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const NETWORK_W = 560;
    const NETWORK_H = 390;
    const LOSS_W = 560;
    const LOSS_H = 175;
    const MAX_LOSS_HISTORY = 100;

    // clamp assigned in init() after VizLib is available
    let clamp;

    // ============================================
    // Activation functions and derivatives
    // ============================================
    const Activations = {
        sigmoid: {
            fn: x => 1 / (1 + Math.exp(-clamp(x, -500, 500))),
            dfn: x => {
                const s = 1 / (1 + Math.exp(-clamp(x, -500, 500)));
                return s * (1 - s);
            },
            label: 'sigmoid'
        },
        relu: {
            fn: x => Math.max(0, x),
            dfn: x => x > 0 ? 1 : 0,
            label: 'ReLU'
        },
        tanh: {
            fn: x => Math.tanh(x),
            dfn: x => 1 - Math.tanh(x) ** 2,
            label: 'tanh'
        }
    };

    // ============================================
    // Simple 2-3-1 Network
    // ============================================
    class Network {
        constructor(activationName, presetName) {
            this.activation = Activations[activationName] || Activations.sigmoid;
            this.outputActivation = Activations.sigmoid;
            this.activationName = activationName;
            this.presetName = presetName || 'balanced';

            // Layer sizes: 2 inputs, 3 hidden, 1 output
            this.sizes = [2, 3, 1];

            // Weights: w_hidden[j][i] = weight from input i to hidden j
            // w_output[0][j] = weight from hidden j to output
            const presets = {
                balanced: {
                    hidden: [[0.45, -0.35], [0.20, 0.55], [-0.50, 0.40]],
                    hiddenBias: [0.10, -0.10, 0.05],
                    output: [0.60, -0.45, 0.35],
                    outputBias: -0.05
                },
                saturated: {
                    hidden: [[6.20, 5.40], [-5.80, -6.40], [7.10, 5.90]],
                    hiddenBias: [2.20, -2.00, 1.60],
                    output: [-5.60, 5.20, -6.10],
                    outputBias: -1.80
                },
                small: {
                    hidden: [[0.04, -0.03], [0.02, 0.05], [-0.05, 0.04]],
                    hiddenBias: [0.01, -0.01, 0.005],
                    output: [0.06, -0.045, 0.035],
                    outputBias: -0.005
                }
            };
            const preset = presets[this.presetName] || presets.balanced;
            this.w_hidden = preset.hidden.map(row => row.slice());
            this.b_hidden = preset.hiddenBias.slice();
            this.w_output = preset.output.slice();
            this.b_output = preset.outputBias;

            // Forward pass intermediate values
            this.x = [0, 0];         // inputs
            this.z_hidden = [0, 0, 0]; // pre-activation hidden
            this.a_hidden = [0, 0, 0]; // post-activation hidden
            this.z_output = 0;         // pre-activation output
            this.a_output = 0;         // post-activation output (final prediction)

            // Backward pass gradient values
            this.dL_da_out = 0;  // dL/d(a_output)
            this.da_out_dz_out = 0; // da_output/dz_output
            this.dL_dz_out = 0;  // dL/dz_output (delta_output)

            this.dL_dw_output = [0, 0, 0]; // dL/dw for output weights
            this.dL_db_output = 0;

            this.dL_da_hidden = [0, 0, 0]; // dL/d(a_hidden[j])
            this.da_dz_hidden = [0, 0, 0]; // da/dz for hidden neurons
            this.dL_dz_hidden = [0, 0, 0]; // delta for hidden neurons

            this.dL_dw_hidden = [];  // dL/dw for hidden weights [j][i]
            this.dL_db_hidden = [0, 0, 0];
            for (let j = 0; j < 3; j++) {
                this.dL_dw_hidden.push([0, 0]);
            }

            this.forwardDone = false;
            this.backwardDone = false;
        }

        forward(x1, x2) {
            this.x = [x1, x2];

            // Hidden layer
            for (let j = 0; j < 3; j++) {
                this.z_hidden[j] = this.b_hidden[j];
                for (let i = 0; i < 2; i++) {
                    this.z_hidden[j] += this.w_hidden[j][i] * this.x[i];
                }
                this.a_hidden[j] = this.activation.fn(this.z_hidden[j]);
            }

            // Keep the prediction in the target slider's 0–1 range. The selected
            // activation applies to the hidden layer, while the output is sigmoid.
            this.z_output = this.b_output;
            for (let j = 0; j < 3; j++) {
                this.z_output += this.w_output[j] * this.a_hidden[j];
            }
            this.a_output = this.outputActivation.fn(this.z_output);

            this.forwardDone = true;
            this.backwardDone = false;
            return this.a_output;
        }

        backward(target) {
            if (!this.forwardDone) return;

            // Loss = 0.5 * (target - a_output)^2
            // dL/da_output = a_output - target
            this.dL_da_out = this.a_output - target;

            // da_output/dz_output = f'(z_output)
            this.da_out_dz_out = this.outputActivation.dfn(this.z_output);

            // dL/dz_output = dL/da_output * da_output/dz_output
            this.dL_dz_out = this.dL_da_out * this.da_out_dz_out;

            // Gradients for output layer weights
            for (let j = 0; j < 3; j++) {
                // dz_output/dw_output[j] = a_hidden[j]
                this.dL_dw_output[j] = this.dL_dz_out * this.a_hidden[j];
            }
            this.dL_db_output = this.dL_dz_out;

            // Propagate to hidden layer
            for (let j = 0; j < 3; j++) {
                // dL/da_hidden[j] = dL/dz_output * dz_output/da_hidden[j]
                //                  = dL/dz_output * w_output[j]
                this.dL_da_hidden[j] = this.dL_dz_out * this.w_output[j];

                // da_hidden[j]/dz_hidden[j] = f'(z_hidden[j])
                this.da_dz_hidden[j] = this.activation.dfn(this.z_hidden[j]);

                // dL/dz_hidden[j] = dL/da_hidden[j] * da_hidden[j]/dz_hidden[j]
                this.dL_dz_hidden[j] = this.dL_da_hidden[j] * this.da_dz_hidden[j];

                // Gradients for hidden layer weights
                for (let i = 0; i < 2; i++) {
                    // dz_hidden[j]/dw_hidden[j][i] = x[i]
                    this.dL_dw_hidden[j][i] = this.dL_dz_hidden[j] * this.x[i];
                }
                this.dL_db_hidden[j] = this.dL_dz_hidden[j];
            }

            this.backwardDone = true;
        }

        applyGradients(lr) {
            if (!this.backwardDone) return;

            // Update output weights
            for (let j = 0; j < 3; j++) {
                this.w_output[j] -= lr * this.dL_dw_output[j];
            }
            this.b_output -= lr * this.dL_db_output;

            // Update hidden weights
            for (let j = 0; j < 3; j++) {
                for (let i = 0; i < 2; i++) {
                    this.w_hidden[j][i] -= lr * this.dL_dw_hidden[j][i];
                }
                this.b_hidden[j] -= lr * this.dL_db_hidden[j];
            }
        }

        getLoss(target) {
            return 0.5 * (target - this.a_output) ** 2;
        }

        getMaxGradMagnitude() {
            let maxG = 0;
            for (let j = 0; j < 3; j++) {
                maxG = Math.max(maxG, Math.abs(this.dL_dw_output[j]));
                for (let i = 0; i < 2; i++) {
                    maxG = Math.max(maxG, Math.abs(this.dL_dw_hidden[j][i]));
                }
            }
            return maxG;
        }

        getParameters() {
            const parameters = [];
            for (let j = 0; j < 3; j++) {
                for (let i = 0; i < 2; i++) {
                    parameters.push({
                        id: `wh-${j}-${i}`,
                        label: `x${i + 1} → h${j + 1}`,
                        shortLabel: `w(h${j + 1},x${i + 1})`,
                        value: this.w_hidden[j][i],
                        gradient: this.dL_dw_hidden[j][i],
                        layer: 'hidden',
                        hiddenIndex: j,
                        inputIndex: i
                    });
                }
            }
            for (let j = 0; j < 3; j++) {
                parameters.push({
                    id: `wo-${j}`,
                    label: `h${j + 1} → ŷ`,
                    shortLabel: `w(y,h${j + 1})`,
                    value: this.w_output[j],
                    gradient: this.dL_dw_output[j],
                    layer: 'output',
                    hiddenIndex: j
                });
            }
            return parameters;
        }

        getParameter(id) {
            return this.getParameters().find(parameter => parameter.id === id) || null;
        }

        setParameter(id, value) {
            const hiddenMatch = /^wh-(\d)-(\d)$/.exec(id);
            if (hiddenMatch) {
                this.w_hidden[Number(hiddenMatch[1])][Number(hiddenMatch[2])] = value;
                return;
            }
            const outputMatch = /^wo-(\d)$/.exec(id);
            if (outputMatch) {
                this.w_output[Number(outputMatch[1])] = value;
            }
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
            this.hitRegions = [];
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
                this.logicalW = rect.width || NETWORK_W;
                this.logicalH = rect.height || NETWORK_H;
                this.canvas.width = this.logicalW * this.dpr;
                this.canvas.height = this.logicalH * this.dpr;
                this.canvas.style.width = this.logicalW + 'px';
                this.canvas.style.height = this.logicalH + 'px';
            }
        }

        resize() { this._setup(); }

        _resetTransform() {
            if (!this.ctx) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                CU.resetCanvasTransform(this.ctx, this.dpr);
            } else {
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        }

        _readColors() {
            const s = getComputedStyle(document.documentElement);
            this.inputColor = s.getPropertyValue('--bp-input-node').trim() || '#377eb8';
            this.hiddenColor = s.getPropertyValue('--bp-hidden-node').trim() || '#4daf4a';
            this.outputColor = s.getPropertyValue('--bp-output-node').trim() || '#e41a1c';
            this.edgePositive = s.getPropertyValue('--bp-edge-positive').trim() || 'rgba(55,126,184,0.7)';
            this.edgeNegative = s.getPropertyValue('--bp-edge-negative').trim() || 'rgba(228,26,28,0.7)';
            this.edgeNeutral = s.getPropertyValue('--bp-edge-neutral').trim() || 'rgba(150,150,150,0.3)';
            this.gradientWarm = s.getPropertyValue('--bp-gradient-warm').trim() || '#ff6b35';
            this.gradientCool = s.getPropertyValue('--bp-gradient-cool').trim() || '#4a90d9';
            this.forwardHL = s.getPropertyValue('--bp-forward-highlight').trim() || 'rgba(76,175,80,0.5)';
            this.backwardHL = s.getPropertyValue('--bp-backward-highlight').trim() || 'rgba(255,152,0,0.5)';
            this.textColor = s.getPropertyValue('--viz-text').trim() || '#333333';
            this.nodeText = s.getPropertyValue('--bp-node-text').trim() || '#ffffff';
            this.canvasBg = s.getPropertyValue('--viz-canvas-bg').trim() || '#fafafa';
            this.layerBg = s.getPropertyValue('--bp-layer-bg').trim() || 'rgba(0,0,0,0.025)';
            this.layerBorder = s.getPropertyValue('--bp-layer-border').trim() || 'rgba(0,0,0,0.08)';
            this.selectedBorder = s.getPropertyValue('--bp-selected-border').trim() || '#007bff';
            this.vizBg = s.getPropertyValue('--viz-bg').trim() || '#ffffff';
            this.textMuted = s.getPropertyValue('--viz-text-muted').trim() || '#6c757d';
        }

        /**
         * Render the network diagram.
         * @param {Network} net - the network
         * @param {string} phase - 'idle', 'forward', 'backward'
         * @param {number} animProgress - 0..1 animation progress within the phase
         * @param {Object} options - selected/hovered connection and current value view
         */
        render(net, phase, animProgress, options) {
            if (!this.ctx) return;
            this._readColors();
            this._resetTransform();
            options = options || {};
            const selectedId = options.selectedId || '';
            const hoveredId = options.hoveredId || '';
            const viewMode = options.viewMode || 'gradient';

            const ctx = this.ctx;
            const w = this.logicalW;
            const h = this.logicalH;
            ctx.clearRect(0, 0, w, h);
            this.hitRegions = [];

            // Network layout: 3 columns for input(2), hidden(3), output(1)
            const layerX = [w * 0.15, w * 0.5, w * 0.85];
            const nodeRadius = 24;

            // Node positions
            const inputY = [h * 0.35, h * 0.65];
            const hiddenY = [h * 0.2, h * 0.5, h * 0.8];
            const outputY = [h * 0.5];

            const inputPos = inputY.map(y => ({ x: layerX[0], y }));
            const hiddenPos = hiddenY.map(y => ({ x: layerX[1], y }));
            const outputPos = outputY.map(y => ({ x: layerX[2], y }));

            // Layer columns make the architecture readable before interaction.
            const columnWidth = w * 0.20;
            for (let layer = 0; layer < layerX.length; layer++) {
                ctx.fillStyle = this.layerBg;
                ctx.strokeStyle = this.layerBorder;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(
                    layerX[layer] - columnWidth / 2,
                    h * 0.08,
                    columnWidth,
                    h * 0.82,
                    5
                );
                ctx.fill();
                ctx.stroke();
            }

            // Determine which layer is "active" during animation
            // Forward: left-to-right; Backward: right-to-left
            let activeLayer = -1; // -1 = none
            if (phase === 'forward') {
                if (animProgress < 0.33) activeLayer = 0;
                else if (animProgress < 0.66) activeLayer = 1;
                else activeLayer = 2;
            } else if (phase === 'backward') {
                if (animProgress < 0.33) activeLayer = 2;
                else if (animProgress < 0.66) activeLayer = 1;
                else activeLayer = 0;
            }

            // ---- Draw edges ----
            // Input -> Hidden edges
            for (let j = 0; j < 3; j++) {
                for (let i = 0; i < 2; i++) {
                    const weight = net.w_hidden[j][i];
                    this._drawEdge(ctx, inputPos[i], hiddenPos[j], weight, nodeRadius,
                        net, phase, animProgress, 'hidden', j, i,
                        `wh-${j}-${i}`, selectedId, hoveredId, viewMode);
                }
            }
            // Hidden -> Output edges
            for (let j = 0; j < 3; j++) {
                const weight = net.w_output[j];
                this._drawEdge(ctx, hiddenPos[j], outputPos[0], weight, nodeRadius,
                    net, phase, animProgress, 'output', 0, j,
                    `wo-${j}`, selectedId, hoveredId, viewMode);
            }

            // ---- Draw nodes ----
            // Input nodes
            for (let i = 0; i < 2; i++) {
                const val = net.forwardDone ? net.x[i] : null;
                const label = 'x' + (i + 1);
                const isActive = (phase === 'forward' && activeLayer === 0) ||
                                 (phase === 'backward' && activeLayer === 0);
                this._drawNode(ctx, inputPos[i], nodeRadius, this.inputColor,
                    val, label, isActive, phase);
            }

            // Hidden nodes
            for (let j = 0; j < 3; j++) {
                const val = net.forwardDone ? net.a_hidden[j] : null;
                const label = 'h' + (j + 1);
                const isActive = (phase === 'forward' && activeLayer === 1) ||
                                 (phase === 'backward' && activeLayer === 1);
                this._drawNode(ctx, hiddenPos[j], nodeRadius, this.hiddenColor,
                    val, label, isActive, phase);

                if (net.forwardDone) {
                    const isGradient = viewMode === 'gradient' && net.backwardDone;
                    const valueText = isGradient
                        ? `δ=${net.dL_dz_hidden[j].toFixed(4)}`
                        : `z=${net.z_hidden[j].toFixed(3)}`;
                    ctx.font = '10px monospace';
                    ctx.fillStyle = isGradient
                        ? this._gradientColor(Math.abs(net.dL_dz_hidden[j]), net.getMaxGradMagnitude())
                        : this.textMuted;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(valueText, hiddenPos[j].x, hiddenPos[j].y + nodeRadius + 6);
                }
            }

            // Output node
            {
                const val = net.forwardDone ? net.a_output : null;
                const label = 'y';
                const isActive = (phase === 'forward' && activeLayer === 2) ||
                                 (phase === 'backward' && activeLayer === 2);
                this._drawNode(ctx, outputPos[0], nodeRadius, this.outputColor,
                    val, label, isActive, phase);

                if (net.forwardDone) {
                    const isGradient = viewMode === 'gradient' && net.backwardDone;
                    const valueText = isGradient
                        ? `δ=${net.dL_dz_out.toFixed(4)}`
                        : `z=${net.z_output.toFixed(3)}`;
                    ctx.font = '10px monospace';
                    ctx.fillStyle = isGradient
                        ? this._gradientColor(Math.abs(net.dL_dz_out), net.getMaxGradMagnitude())
                        : this.textMuted;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(valueText, outputPos[0].x, outputPos[0].y + nodeRadius + 6);
                }
            }

            // ---- Layer labels ----
            ctx.font = '12px sans-serif';
            ctx.fillStyle = this.textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Input', layerX[0], h - 20);
            ctx.fillText('Hidden (3)', layerX[1], h - 20);
            ctx.fillText('Output', layerX[2], h - 20);
        }

        _drawEdge(ctx, from, to, weight, nodeRadius, net, phase, animProgress,
                  layerType, toIdx, fromIdx, paramId, selectedId, hoveredId, viewMode) {
            const magnitude = Math.abs(weight);
            const maxW = 3;
            const isSelected = paramId === selectedId;
            const isHovered = paramId === hoveredId;

            // Compute start and end, offset by node radius
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / dist;
            const ny = dy / dist;

            const sx = from.x + nx * nodeRadius;
            const sy = from.y + ny * nodeRadius;
            const ex = to.x - nx * nodeRadius;
            const ey = to.y - ny * nodeRadius;
            let gradient = 0;
            if (layerType === 'output') {
                gradient = net.dL_dw_output[fromIdx];
            } else {
                gradient = net.dL_dw_hidden[toIdx][fromIdx];
            }

            this.hitRegions.push({
                id: paramId,
                sx, sy, ex, ey,
                labelX: (sx + ex) / 2,
                labelY: (sy + ey) / 2,
                weight,
                gradient
            });

            if (isSelected || isHovered) {
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.lineWidth = isSelected ? 8 : 6;
                ctx.strokeStyle = this.selectedBorder;
                ctx.globalAlpha = isSelected ? 0.22 : 0.13;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Base edge
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.lineWidth = 0.5 + clamp(magnitude / maxW, 0, 1) * 3;

            if (weight > 0.01) {
                ctx.strokeStyle = this.edgePositive;
            } else if (weight < -0.01) {
                ctx.strokeStyle = this.edgeNegative;
            } else {
                ctx.strokeStyle = this.edgeNeutral;
            }
            ctx.globalAlpha = 0.3 + clamp(magnitude / maxW, 0, 1) * 0.5;
            ctx.stroke();
            ctx.globalAlpha = 1;

            if (isSelected || isHovered) {
                // Only the focused connection receives a number on the canvas.
                // The table below retains the complete dense parameter view.
                const mx = (sx + ex) / 2;
                const my = (sy + ey) / 2;
                const perpX = -ny * 10;
                const perpY = nx * 10;
                const labelX = mx + perpX;
                const labelY = my + perpY;
                const label = viewMode === 'gradient' && net.backwardDone
                    ? `∂ ${gradient.toFixed(3)}`
                    : `w ${weight.toFixed(2)}`;
                ctx.save();
                ctx.font = (isSelected ? 'bold ' : '') + '9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const metrics = ctx.measureText(label);
                ctx.fillStyle = this.vizBg;
                ctx.strokeStyle = this.selectedBorder;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.96;
                ctx.fillRect(labelX - metrics.width / 2 - 3, labelY - 7, metrics.width + 6, 14);
                ctx.strokeRect(labelX - metrics.width / 2 - 3, labelY - 7, metrics.width + 6, 14);
                ctx.fillStyle = this.selectedBorder;
                ctx.globalAlpha = 1;
                ctx.fillText(label, labelX, labelY);
                ctx.restore();
            }

            // Gradient flow overlay during backward pass
            if ((viewMode === 'gradient' || phase === 'backward') && net.backwardDone) {
                const gradMag = Math.abs(gradient);
                const maxG = net.getMaxGradMagnitude();

                if (maxG > 1e-8) {
                    const intensity = clamp(gradMag / maxG, 0, 1);
                    // Draw gradient flow as thick overlay in backward direction (to -> from)
                    ctx.beginPath();
                    ctx.moveTo(ex, ey);
                    ctx.lineTo(sx, sy);
                    ctx.lineWidth = 2 + intensity * 4;
                    ctx.strokeStyle = this._gradientColor(gradMag, maxG);
                    ctx.globalAlpha = 0.3 + intensity * 0.5;
                    ctx.stroke();
                    ctx.globalAlpha = 1;

                    // Small arrowhead on the from-end
                    if (intensity > 0.05) {
                        const arrowLen = 8 + intensity * 6;
                        const arrowAngle = Math.atan2(sy - ey, sx - ex);
                        ctx.beginPath();
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(sx - arrowLen * Math.cos(arrowAngle - 0.4),
                                   sy - arrowLen * Math.sin(arrowAngle - 0.4));
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(sx - arrowLen * Math.cos(arrowAngle + 0.4),
                                   sy - arrowLen * Math.sin(arrowAngle + 0.4));
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = this._gradientColor(gradMag, maxG);
                        ctx.globalAlpha = 0.5 + intensity * 0.5;
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                }
            }

            // Forward pass animation pulse
            if (phase === 'forward') {
                const edgeLayerIdx = (layerType === 'hidden') ? 0 : 1;
                const normalizedProgress = animProgress;
                const edgeStart = edgeLayerIdx * 0.5;
                const edgeEnd = edgeStart + 0.5;
                if (normalizedProgress >= edgeStart && normalizedProgress <= edgeEnd) {
                    const localT = (normalizedProgress - edgeStart) / 0.5;
                    const pulseX = sx + (ex - sx) * localT;
                    const pulseY = sy + (ey - sy) * localT;
                    ctx.beginPath();
                    ctx.arc(pulseX, pulseY, 4, 0, Math.PI * 2);
                    ctx.fillStyle = this.forwardHL;
                    ctx.fill();
                }
            }
        }

        _drawNode(ctx, pos, radius, color, value, label, isActive, phase) {
            // Glow for active node
            if (isActive) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
                ctx.fillStyle = (phase === 'forward') ? this.forwardHL : this.backwardHL;
                ctx.fill();
            }

            // Node circle
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Value inside node
            if (value !== null && value !== undefined) {
                ctx.fillStyle = this.nodeText;
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(value.toFixed(3), pos.x, pos.y);
            }

            // Label above node
            ctx.fillStyle = this.textColor;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, pos.x, pos.y - radius - 4);
        }

        _gradientColor(magnitude, maxMag) {
            if (maxMag < 1e-8) return this.gradientCool;
            const t = clamp(magnitude / maxMag, 0, 1);
            // Interpolate between cool (blue) and warm (orange/red)
            // Parse colors
            const cool = this._hexToRgb(this.gradientCool);
            const warm = this._hexToRgb(this.gradientWarm);
            const r = Math.round(cool[0] * (1 - t) + warm[0] * t);
            const g = Math.round(cool[1] * (1 - t) + warm[1] * t);
            const b = Math.round(cool[2] * (1 - t) + warm[2] * t);
            return `rgb(${r},${g},${b})`;
        }

        _hexToRgb(str) {
            if (str.startsWith('#')) {
                const hex = str.slice(1);
                return [
                    parseInt(hex.substring(0, 2), 16),
                    parseInt(hex.substring(2, 4), 16),
                    parseInt(hex.substring(4, 6), 16)
                ];
            }
            const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
            return [128, 128, 128];
        }

        hitTest(x, y) {
            let best = null;
            let bestDistance = Infinity;
            for (const region of this.hitRegions) {
                const distance = this._distanceToSegment(
                    x, y, region.sx, region.sy, region.ex, region.ey
                );
                if (distance < 12 && distance < bestDistance) {
                    best = region;
                    bestDistance = distance;
                }
            }
            return best;
        }

        _distanceToSegment(px, py, x1, y1, x2, y2) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
            const t = clamp(
                ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy),
                0,
                1
            );
            return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        }
    }

    // ============================================
    // Loss Curve Renderer
    // ============================================
    class LossCurveRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.logicalW = LOSS_W;
            this.logicalH = LOSS_H;
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
                this.logicalW = rect.width || LOSS_W;
                this.logicalH = rect.height || LOSS_H;
                this.canvas.width = this.logicalW * this.dpr;
                this.canvas.height = this.logicalH * this.dpr;
                this.canvas.style.width = this.logicalW + 'px';
                this.canvas.style.height = this.logicalH + 'px';
            }
        }

        resize() { this._setup(); }

        _resetTransform() {
            if (!this.ctx) return;
            const CU = window.VizLib?.CanvasUtils;
            if (CU) {
                CU.resetCanvasTransform(this.ctx, this.dpr);
            } else {
                this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            }
        }

        render(lossHistory) {
            if (!this.ctx) return;
            this._resetTransform();

            const s = getComputedStyle(document.documentElement);
            const lossLine = s.getPropertyValue('--bp-loss-line').trim() || '#e41a1c';
            const lossFill = s.getPropertyValue('--bp-loss-fill').trim() || 'rgba(228,26,28,0.1)';
            const gridColor = s.getPropertyValue('--bp-loss-grid').trim() || 'rgba(0,0,0,0.08)';
            const textColor = s.getPropertyValue('--viz-text').trim() || '#333';
            const textMuted = s.getPropertyValue('--viz-text-muted').trim() || '#6c757d';

            const ctx = this.ctx;
            const w = this.logicalW;
            const h = this.logicalH;
            const pad = { top: 20, right: 20, bottom: 30, left: 50 };
            const plotW = w - pad.left - pad.right;
            const plotH = h - pad.top - pad.bottom;

            ctx.clearRect(0, 0, w, h);

            // Grid lines
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = pad.top + (plotH / 4) * i;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + plotW, y);
                ctx.stroke();
            }

            if (lossHistory.length === 0) {
                ctx.fillStyle = textMuted;
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No data yet. Run a training step.', w / 2, h / 2);
                return;
            }

            // Determine Y scale
            const maxLoss = Math.max(0.01, ...lossHistory);
            const yScale = plotH / maxLoss;
            const xStep = lossHistory.length > 1 ? plotW / (lossHistory.length - 1) : plotW;

            // Draw filled area
            ctx.beginPath();
            ctx.moveTo(pad.left, pad.top + plotH);
            for (let i = 0; i < lossHistory.length; i++) {
                const px = pad.left + i * xStep;
                const py = pad.top + plotH - lossHistory[i] * yScale;
                ctx.lineTo(px, py);
            }
            ctx.lineTo(pad.left + (lossHistory.length - 1) * xStep, pad.top + plotH);
            ctx.closePath();
            ctx.fillStyle = lossFill;
            ctx.fill();

            // Draw line
            ctx.beginPath();
            for (let i = 0; i < lossHistory.length; i++) {
                const px = pad.left + i * xStep;
                const py = pad.top + plotH - lossHistory[i] * yScale;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = lossLine;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Latest point
            if (lossHistory.length > 0) {
                const lastI = lossHistory.length - 1;
                const lx = pad.left + lastI * xStep;
                const ly = pad.top + plotH - lossHistory[lastI] * yScale;
                ctx.beginPath();
                ctx.arc(lx, ly, 4, 0, Math.PI * 2);
                ctx.fillStyle = lossLine;
                ctx.fill();
            }

            // Y-axis labels
            ctx.fillStyle = textMuted;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let i = 0; i <= 4; i++) {
                const val = maxLoss * (1 - i / 4);
                const y = pad.top + (plotH / 4) * i;
                ctx.fillText(val.toFixed(3), pad.left - 6, y);
            }

            // X-axis label
            ctx.fillStyle = textMuted;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Training Step', w / 2, h - 12);

            // Y-axis title
            ctx.save();
            ctx.translate(14, h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = textMuted;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loss', 0, 0);
            ctx.restore();
        }
    }

    // ============================================
    // Computation Log Manager
    // ============================================
    class ComputationLog {
        constructor(container) {
            this.container = container;
        }

        clear() {
            if (this.container) this.container.innerHTML = '';
        }

        add(message, type) {
            if (!this.container) return;
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + (type || 'log-info');

            let icon = 'fa-info-circle';
            if (type === 'log-forward') icon = 'fa-arrow-right';
            else if (type === 'log-backward') icon = 'fa-arrow-left';
            else if (type === 'log-update') icon = 'fa-pencil';
            else if (type === 'log-success') icon = 'fa-check';
            else if (type === 'log-warning') icon = 'fa-exclamation-triangle';

            entry.innerHTML =
                '<span class="log-icon"><i class="fa ' + icon + '"></i></span>' +
                '<span class="log-message">' + message + '</span>';
            this.container.appendChild(entry);
            this.container.scrollTop = this.container.scrollHeight;
        }

        addSeparator() {
            if (!this.container) return;
            const hr = document.createElement('hr');
            hr.style.margin = '4px 0';
            hr.style.border = 'none';
            hr.style.borderTop = '1px dashed var(--viz-border)';
            this.container.appendChild(hr);
            this.container.scrollTop = this.container.scrollHeight;
        }
    }

    // ============================================
    // Main Visualization Controller
    // ============================================
    class BackpropViz {
        constructor() {
            this.networkCanvas = document.getElementById('network-canvas');
            this.lossCanvas = document.getElementById('loss-canvas');
            this.networkRenderer = new NetworkRenderer(this.networkCanvas);
            this.lossCurveRenderer = new LossCurveRenderer(this.lossCanvas);
            this.log = new ComputationLog(document.getElementById('computation-log'));

            this.network = null;
            this.step = 0;
            this.lossHistory = [];
            this.initialLoss = null;
            this.phase = 'idle';
            this.animProgress = 0;
            this.animId = null;
            this.isAnimating = false;
            this.viewMode = 'gradient';
            this.selectedParameterId = 'wo-0';
            this.hoveredParameterId = '';
            this.lastUpdate = new Map();

            this._init();
        }

        _init() {
            this._buildNetwork();
            this._setupEventListeners();
            this._renderAll();

            if (window.VizLib?.ThemeManager) {
                window.VizLib.ThemeManager.onThemeChange(() => this._renderAll());
            }

            window.addEventListener('resize', () => {
                this.networkRenderer.resize();
                this.lossCurveRenderer.resize();
                this._renderAll();
            });
        }

        _buildNetwork() {
            const activation = document.getElementById('activation-select')?.value || 'sigmoid';
            const preset = document.getElementById('weight-preset-select')?.value || 'balanced';
            this.network = new Network(activation, preset);
            this.step = 0;
            this.phase = 'idle';
            this.lastUpdate.clear();
            this._computeCurrentSample();
            this.initialLoss = this.network.getLoss(this._getTarget());
            this.lossHistory = [this.initialLoss];
        }

        _setupEventListeners() {
            const bindSlider = (id, displayId, decimals, recompute) => {
                const slider = document.getElementById(id);
                const display = document.getElementById(displayId);
                slider?.addEventListener('input', () => {
                    if (display) display.textContent = parseFloat(slider.value).toFixed(decimals);
                    if (recompute) {
                        this.step = 0;
                        this.lastUpdate.clear();
                        this._computeCurrentSample();
                        this.initialLoss = this.network.getLoss(this._getTarget());
                        this.lossHistory = [this.initialLoss];
                    }
                    this._renderAll();
                });
            };
            bindSlider('x1-slider', 'x1-value', 2, true);
            bindSlider('x2-slider', 'x2-value', 2, true);
            bindSlider('target-slider', 'target-value', 2, true);
            bindSlider('lr-slider', 'lr-value', 3, false);

            document.getElementById('activation-select')?.addEventListener('change', () => this._reset());
            document.getElementById('weight-preset-select')?.addEventListener('change', () => this._reset());

            document.getElementById('btn-view-forward')?.addEventListener('click', () => this._setViewMode('forward'));
            document.getElementById('btn-view-gradient')?.addEventListener('click', () => this._setViewMode('gradient'));
            document.getElementById('btn-forward')?.addEventListener('click', () => this._doForwardPass());
            document.getElementById('btn-backward')?.addEventListener('click', () => this._doBackwardPass());
            document.getElementById('btn-train-step')?.addEventListener('click', () => this._doTrainStep());
            document.getElementById('btn-train-many')?.addEventListener('click', () => this._doTrainMany());
            document.getElementById('btn-reset')?.addEventListener('click', () => this._reset());

            this.networkCanvas?.addEventListener('mousemove', event => this._handleCanvasMove(event));
            this.networkCanvas?.addEventListener('mouseleave', () => this._clearCanvasHover());
            this.networkCanvas?.addEventListener('click', event => {
                const hit = this._canvasHit(event);
                if (hit) this._selectParameter(hit.id);
            });

            document.getElementById('bp-gradient-tbody')?.addEventListener('click', event => {
                const row = event.target.closest('[data-param-id]');
                if (row) this._selectParameter(row.dataset.paramId);
            });

            document.querySelectorAll('.info-panel-tabs [data-tab]').forEach(button => {
                button.addEventListener('click', () => {
                    const panel = button.closest('.panel');
                    const tabId = button.getAttribute('data-tab');
                    panel.querySelectorAll('.info-panel-tabs .btn').forEach(tabButton => {
                        tabButton.classList.remove('active');
                    });
                    panel.querySelectorAll('.info-tab-content').forEach(content => {
                        content.classList.remove('active');
                    });
                    button.classList.add('active');
                    panel.querySelector('#tab-' + tabId)?.classList.add('active');
                });
            });
        }

        _getInputs() {
            return [
                parseFloat(document.getElementById('x1-slider')?.value || '0.5'),
                parseFloat(document.getElementById('x2-slider')?.value || '0.8')
            ];
        }

        _getTarget() {
            return parseFloat(document.getElementById('target-slider')?.value || '1.0');
        }

        _getLR() {
            return parseFloat(document.getElementById('lr-slider')?.value || '0.5');
        }

        _computeCurrentSample() {
            const [x1, x2] = this._getInputs();
            const target = this._getTarget();
            this.network.forward(x1, x2);
            this.network.backward(target);
        }

        _setViewMode(mode) {
            this.viewMode = mode;
            document.getElementById('btn-view-forward')?.classList.toggle('active', mode === 'forward');
            document.getElementById('btn-view-gradient')?.classList.toggle('active', mode === 'gradient');
            this._renderAll();
        }

        _canvasHit(event) {
            const rect = this.networkCanvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) * (this.networkRenderer.logicalW / rect.width);
            const y = (event.clientY - rect.top) * (this.networkRenderer.logicalH / rect.height);
            return this.networkRenderer.hitTest(x, y);
        }

        _handleCanvasMove(event) {
            const hit = this._canvasHit(event);
            const nextId = hit?.id || '';
            if (nextId !== this.hoveredParameterId) {
                this.hoveredParameterId = nextId;
                this._renderCanvases();
            }

            const tooltip = document.getElementById('bp-canvas-tooltip');
            if (!tooltip) return;
            if (!hit) {
                tooltip.style.display = 'none';
                return;
            }

            const parameter = this.network.getParameter(hit.id);
            const gradientText = this.network.backwardDone
                ? parameter.gradient.toFixed(6)
                : 'Run Backward to compute';
            tooltip.innerHTML =
                '<strong>' + parameter.label + '</strong><br>' +
                'w = ' + parameter.value.toFixed(4) + '<br>' +
                '∂L/∂w = ' + gradientText;
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top = (event.offsetY + 12) + 'px';
        }

        _clearCanvasHover() {
            this.hoveredParameterId = '';
            const tooltip = document.getElementById('bp-canvas-tooltip');
            if (tooltip) tooltip.style.display = 'none';
            this._renderCanvases();
        }

        _dismissCanvasHover() {
            this.hoveredParameterId = '';
            const tooltip = document.getElementById('bp-canvas-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        }

        _selectParameter(id) {
            if (!this.network.getParameter(id)) return;
            this.selectedParameterId = id;
            this._renderAll();
        }

        _beginAnimatedAction() {
            if (this.isAnimating) return false;
            this.isAnimating = true;
            this._syncActionButtons();
            return true;
        }

        _finishAnimatedAction() {
            this.isAnimating = false;
            this._syncActionButtons();
        }

        _syncActionButtons() {
            ['btn-forward', 'btn-backward', 'btn-train-step', 'btn-train-many'].forEach(id => {
                const button = document.getElementById(id);
                if (button) button.disabled = this.isAnimating;
            });
        }

        _doForwardPass() {
            if (!this._beginAnimatedAction()) return;
            this._dismissCanvasHover();
            const [x1, x2] = this._getInputs();
            const target = this._getTarget();
            this.network.forward(x1, x2);
            const loss = this.network.getLoss(target);
            this.viewMode = 'forward';
            this._syncViewButtons();

            this.log.addSeparator();
            this.log.add('<strong>Forward pass</strong>', 'log-forward');
            this.log.add(`Inputs: x1=${x1.toFixed(2)}, x2=${x2.toFixed(2)}`, 'log-forward');
            for (let j = 0; j < 3; j++) {
                this.log.add(
                    `h${j + 1}: z=${this.network.z_hidden[j].toFixed(4)}, ` +
                    `a=${this.network.activationName}(z)=${this.network.a_hidden[j].toFixed(4)}`,
                    'log-forward'
                );
            }
            this.log.add(
                `ŷ=${this.network.a_output.toFixed(4)}, ` +
                `L=½(${target.toFixed(2)}−${this.network.a_output.toFixed(4)})²=${loss.toFixed(6)}`,
                'log-forward'
            );

            this.phase = 'forward';
            this._setBadge('Forward Pass', 'forward-active');
            this._refreshPanels();
            this._animatePhase(() => {
                this.phase = 'idle';
                this._setBadge('Forward Complete', 'complete');
                this._finishAnimatedAction();
                this._renderAll();
            });
        }

        _doBackwardPass() {
            if (!this._beginAnimatedAction()) return;
            this._dismissCanvasHover();
            if (!this.network.forwardDone) this.network.forward(...this._getInputs());
            const target = this._getTarget();
            this.network.backward(target);
            this.viewMode = 'gradient';
            this._syncViewButtons();

            this.log.addSeparator();
            this.log.add('<strong>Backward pass</strong>', 'log-backward');
            this.log.add(
                `∂L/∂ŷ = ŷ − t = ${this.network.dL_da_out.toFixed(6)}`,
                'log-backward'
            );
            this.log.add(
                `δout = (∂L/∂ŷ)f′(zout) = ${this.network.dL_dz_out.toFixed(6)}`,
                'log-backward'
            );
            this.log.add(
                `Largest connection gradient: ${this.network.getMaxGradMagnitude().toFixed(6)}`,
                'log-backward'
            );

            this.phase = 'backward';
            this._setBadge('Backward Pass', 'backward-active');
            this._refreshPanels();
            this._animatePhase(() => {
                this.phase = 'idle';
                this._setBadge('Gradients Ready', 'complete');
                this._finishAnimatedAction();
                this._renderAll();
            });
        }

        _performTrainStep() {
            const [x1, x2] = this._getInputs();
            const target = this._getTarget();
            const lr = this._getLR();

            this.network.forward(x1, x2);
            const lossBefore = this.network.getLoss(target);
            this.network.backward(target);
            const before = new Map(
                this.network.getParameters().map(parameter => [
                    parameter.id,
                    { value: parameter.value, gradient: parameter.gradient }
                ])
            );

            this.network.applyGradients(lr);
            this.network.forward(x1, x2);
            const lossAfter = this.network.getLoss(target);
            this.network.backward(target);

            this.lastUpdate.clear();
            for (const parameter of this.network.getParameters()) {
                const prior = before.get(parameter.id);
                this.lastUpdate.set(parameter.id, {
                    before: prior.value,
                    gradient: prior.gradient,
                    after: parameter.value
                });
            }

            this.step++;
            this.lossHistory.push(lossAfter);
            if (this.lossHistory.length > MAX_LOSS_HISTORY) this.lossHistory.shift();
            return { lossBefore, lossAfter };
        }

        _doTrainStep() {
            if (!this._beginAnimatedAction()) return;
            this._dismissCanvasHover();
            const result = this._performTrainStep();
            this.viewMode = 'gradient';
            this._syncViewButtons();

            this.log.addSeparator();
            this.log.add(`<strong>Train step ${this.step}</strong>`, 'log-info');
            this.log.add(
                `Loss before update: ${result.lossBefore.toFixed(6)}`,
                'log-forward'
            );
            this.log.add(
                `Applied w ← w − ${this._getLR().toFixed(3)} · ∂L/∂w`,
                'log-update'
            );
            this.log.add(
                `Loss after update: ${result.lossAfter.toFixed(6)}`,
                'log-update'
            );

            this.phase = 'forward';
            this._setBadge('Training…', 'forward-active');
            this._refreshPanels();
            this._animatePhase(() => {
                this.phase = 'backward';
                this._setBadge('Training…', 'backward-active');
                this._animatePhase(() => {
                    this.phase = 'idle';
                    this._setBadge(`Step ${this.step} Complete`, 'complete');
                    this._finishAnimatedAction();
                    this._renderAll();
                });
            });
        }

        _doTrainMany() {
            if (this.isAnimating) return;
            this._dismissCanvasHover();
            const firstLoss = this.network.getLoss(this._getTarget());
            let result = null;
            for (let index = 0; index < 25; index++) result = this._performTrainStep();
            this.viewMode = 'gradient';
            this.phase = 'idle';
            this._syncViewButtons();
            this._setBadge(`${this.step} Steps Complete`, 'complete');

            this.log.addSeparator();
            this.log.add('<strong>Batch training: 25 steps</strong>', 'log-info');
            this.log.add(
                `Loss ${firstLoss.toFixed(6)} → ${result.lossAfter.toFixed(6)}`,
                'log-update'
            );
            this._renderAll();
        }

        _reset() {
            if (this.animId) cancelAnimationFrame(this.animId);
            this.animId = null;
            this._finishAnimatedAction();
            this.log.clear();
            this._buildNetwork();
            this.viewMode = 'gradient';
            this._syncViewButtons();
            this._setBadge('Ready', 'complete');
            this.log.add(
                'Reset with a reproducible preset. Forward values and gradients are already computed.',
                'log-info'
            );
            this._renderAll();
        }

        _registerURLState(urlState) {
            if (!urlState?.registerCustom) return;
            urlState.registerCustom(
                'training',
                () => this._serializeTrainingState(),
                value => this._restoreTrainingState(value)
            );
        }

        _serializeTrainingState() {
            if (this.step < 1) return '';
            const payload = {
                step: this.step,
                hidden: this.network.w_hidden,
                hiddenBias: this.network.b_hidden,
                output: this.network.w_output,
                outputBias: this.network.b_output,
                initialLoss: this.initialLoss,
                lossHistory: this.lossHistory
            };
            return btoa(JSON.stringify(payload))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
        }

        _restoreTrainingState(value) {
            try {
                const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
                const padding = '='.repeat((4 - (base64.length % 4)) % 4);
                const payload = JSON.parse(atob(base64 + padding));
                const finiteArray = (candidate, length) =>
                    Array.isArray(candidate) &&
                    candidate.length === length &&
                    candidate.every(Number.isFinite);
                const validHidden =
                    Array.isArray(payload.hidden) &&
                    payload.hidden.length === 3 &&
                    payload.hidden.every(row => finiteArray(row, 2));
                const validHistory =
                    Array.isArray(payload.lossHistory) &&
                    payload.lossHistory.length > 0 &&
                    payload.lossHistory.length <= MAX_LOSS_HISTORY &&
                    payload.lossHistory.every(Number.isFinite);

                if (
                    !Number.isInteger(payload.step) ||
                    payload.step < 1 ||
                    !validHidden ||
                    !finiteArray(payload.hiddenBias, 3) ||
                    !finiteArray(payload.output, 3) ||
                    !Number.isFinite(payload.outputBias) ||
                    !Number.isFinite(payload.initialLoss) ||
                    !validHistory
                ) {
                    return;
                }

                this.network.w_hidden = payload.hidden.map(row => row.slice());
                this.network.b_hidden = payload.hiddenBias.slice();
                this.network.w_output = payload.output.slice();
                this.network.b_output = payload.outputBias;
                this.step = payload.step;
                this.initialLoss = payload.initialLoss;
                this.lossHistory = payload.lossHistory.slice();
                this.phase = 'idle';
                this.lastUpdate.clear();
                this._computeCurrentSample();
                this.viewMode = 'gradient';
                this._syncViewButtons();
                const stepLabel = this.step === 1 ? 'Step 1' : `${this.step} Steps`;
                this._setBadge(`${stepLabel} Complete`, 'complete');
                this.log.clear();
                this.log.add(
                    `Restored shared training state at step ${this.step}.`,
                    'log-success'
                );
                this._renderAll();
            } catch (error) {
                // Ignore malformed or outdated shared state.
            }
        }

        _animatePhase(onComplete) {
            this.animProgress = 0;
            const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const duration = reduceMotion ? 1 : 600;
            const startTime = performance.now();

            const animate = now => {
                this.animProgress = clamp((now - startTime) / duration, 0, 1);
                this._renderCanvases();
                this._updateStages();
                if (this.animProgress < 1) {
                    this.animId = requestAnimationFrame(animate);
                } else {
                    this.animId = null;
                    if (onComplete) onComplete();
                }
            };
            this.animId = requestAnimationFrame(animate);
        }

        _syncViewButtons() {
            document.getElementById('btn-view-forward')?.classList.toggle('active', this.viewMode === 'forward');
            document.getElementById('btn-view-gradient')?.classList.toggle('active', this.viewMode === 'gradient');
        }

        _renderCanvases() {
            this.networkRenderer.render(this.network, this.phase, this.animProgress, {
                selectedId: this.selectedParameterId,
                hoveredId: this.hoveredParameterId,
                viewMode: this.viewMode
            });
            this.lossCurveRenderer.render(this.lossHistory);
        }

        _renderAll() {
            this._dismissCanvasHover();
            this._renderCanvases();
            this._refreshPanels();
        }

        _refreshPanels() {
            this._updateMetrics();
            this._updateGradientTable();
            this._updateMathPanel();
            this._updateStages();
        }

        _updateGradientTable() {
            const tbody = document.getElementById('bp-gradient-tbody');
            if (!tbody) return;
            const lr = this._getLR();
            const hasGradients = this.network.backwardDone;
            const maxGradient = Math.max(this.network.getMaxGradMagnitude(), 1e-12);
            tbody.innerHTML = this.network.getParameters().map(parameter => {
                const ratio = Math.abs(parameter.gradient) / maxGradient;
                const strengthClass = hasGradients
                    ? (ratio > 0.55 ? 'large' : ratio < 0.1 ? 'small' : '')
                    : '';
                const proposed = parameter.value - lr * parameter.gradient;
                return `
                    <tr class="bp-gradient-row ${parameter.id === this.selectedParameterId ? 'selected' : ''}"
                        data-param-id="${parameter.id}">
                        <td>${parameter.label}</td>
                        <td class="text-right">${parameter.value.toFixed(4)}</td>
                        <td class="text-right bp-gradient-value ${strengthClass}">${hasGradients ? parameter.gradient.toFixed(6) : '—'}</td>
                        <td class="text-right">${hasGradients ? (-lr * parameter.gradient).toFixed(6) : '—'}</td>
                        <td class="text-right">${hasGradients ? proposed.toFixed(4) : '—'}</td>
                    </tr>`;
            }).join('');

            const selected = this.network.getParameter(this.selectedParameterId);
            this._setText('bp-selected-label', `Selected: ${selected?.label || '—'}`);
        }

        _chainData(parameter) {
            const net = this.network;
            if (parameter.layer === 'output') {
                const j = parameter.hiddenIndex;
                return {
                    equation:
                        `∂L/∂${parameter.shortLabel} = (∂L/∂ŷ) · σ′(zᵧ) · a(h${j + 1})`,
                    factors: [
                        { symbol: 'ŷ − t', value: net.dL_da_out },
                        { symbol: 'σ′(zᵧ)', value: net.da_out_dz_out },
                        { symbol: `a(h${j + 1})`, value: net.a_hidden[j] }
                    ]
                };
            }

            const j = parameter.hiddenIndex;
            const i = parameter.inputIndex;
            return {
                equation:
                    `∂L/∂${parameter.shortLabel} = (∂L/∂ŷ) · σ′(zᵧ) · w(y,h${j + 1}) · f′(z(h${j + 1})) · x${i + 1}`,
                factors: [
                    { symbol: 'ŷ − t', value: net.dL_da_out },
                    { symbol: 'σ′(zᵧ)', value: net.da_out_dz_out },
                    { symbol: `w(y,h${j + 1})`, value: net.w_output[j] },
                    { symbol: `f′(z(h${j + 1}))`, value: net.da_dz_hidden[j] },
                    { symbol: `x${i + 1}`, value: net.x[i] }
                ]
            };
        }

        _numericalGradient(parameterId) {
            const epsilon = 1e-4;
            const [x1, x2] = this._getInputs();
            const target = this._getTarget();
            const original = this.network.getParameter(parameterId).value;

            this.network.setParameter(parameterId, original + epsilon);
            this.network.forward(x1, x2);
            const plus = this.network.getLoss(target);

            this.network.setParameter(parameterId, original - epsilon);
            this.network.forward(x1, x2);
            const minus = this.network.getLoss(target);

            this.network.setParameter(parameterId, original);
            this.network.forward(x1, x2);
            this.network.backward(target);
            return (plus - minus) / (2 * epsilon);
        }

        _updateMathPanel() {
            const parameter = this.network.getParameter(this.selectedParameterId);
            if (!parameter) return;
            if (!this.network.backwardDone) {
                this._setText('bp-math-param-badge', parameter.label);
                this._setText('bp-chain-equation', 'Run a backward pass to compute this gradient.');
                const factorContainer = document.getElementById('bp-chain-factors');
                if (factorContainer) factorContainer.innerHTML = '';
                [
                    'bp-math-weight',
                    'bp-math-gradient',
                    'bp-math-delta',
                    'bp-math-proposed',
                    'bp-check-analytic',
                    'bp-check-numeric'
                ].forEach(id => this._setText(id, '—'));
                const checkEl = document.getElementById('bp-check-error');
                if (checkEl) {
                    checkEl.textContent = '—';
                    checkEl.classList.remove('bp-check-pass', 'bp-check-warning');
                }
                return;
            }
            const lr = this._getLR();
            const chain = this._chainData(parameter);
            const numeric = this._numericalGradient(parameter.id);
            const analytic = this.network.getParameter(parameter.id).gradient;
            const relativeError = Math.abs(analytic - numeric) /
                Math.max(1e-12, Math.abs(analytic) + Math.abs(numeric));

            this._setText('bp-math-param-badge', parameter.label);
            this._setText('bp-chain-equation', chain.equation);
            const factorContainer = document.getElementById('bp-chain-factors');
            if (factorContainer) {
                factorContainer.innerHTML = chain.factors.map(factor => `
                    <div class="bp-chain-factor">
                        <span class="bp-factor-symbol">${factor.symbol}</span>
                        <span class="bp-factor-value">${factor.value.toFixed(6)}</span>
                    </div>`).join('');
            }

            this._setText('bp-math-weight', parameter.value.toFixed(6));
            this._setText('bp-math-gradient', analytic.toFixed(8));
            this._setText('bp-math-delta', (-lr * analytic).toFixed(8));
            this._setText('bp-math-proposed', (parameter.value - lr * analytic).toFixed(6));
            this._setText('bp-check-analytic', analytic.toFixed(8));
            this._setText('bp-check-numeric', numeric.toFixed(8));
            const checkEl = document.getElementById('bp-check-error');
            if (checkEl) {
                checkEl.textContent = relativeError.toExponential(2);
                checkEl.classList.toggle('bp-check-pass', relativeError < 1e-5);
                checkEl.classList.toggle('bp-check-warning', relativeError >= 1e-5);
            }
        }

        _updateMetrics() {
            const target = this._getTarget();
            const loss = this.network.getLoss(target);
            this._setText('metric-step', String(this.step));
            this._setText('metric-target', target.toFixed(2));
            this._setText('metric-loss', loss.toFixed(6));
            this._setText('metric-output', this.network.a_output.toFixed(4));
            this._setText(
                'metric-max-grad',
                this.network.backwardDone ? this.network.getMaxGradMagnitude().toFixed(6) : '—'
            );
            this._setText('metric-status', this.phase === 'idle' ? 'Ready' : this.phase);
            this._setText('bp-output-badge', `ŷ = ${this.network.a_output.toFixed(4)}`);
            this._setText('bp-loss-badge', `L = ${loss.toFixed(5)}`);

            const initialLoss = this.initialLoss ?? loss;
            const reduction = initialLoss > 0 ? (1 - loss / initialLoss) * 100 : 0;
            this._setText(
                'bp-history-summary',
                this.step === 0
                    ? `Initial loss ${loss.toFixed(5)}`
                    : `${this.step} ${this.step === 1 ? 'step' : 'steps'} · ${reduction.toFixed(1)}% reduction`
            );
        }

        _updateStages() {
            const stageIds = ['bp-stage-forward', 'bp-stage-loss', 'bp-stage-backward', 'bp-stage-update'];
            for (const id of stageIds) {
                document.getElementById(id)?.classList.remove('active');
            }
            document.getElementById('bp-stage-forward')?.classList.toggle('complete', this.network.forwardDone);
            document.getElementById('bp-stage-loss')?.classList.toggle('complete', this.network.forwardDone);
            document.getElementById('bp-stage-backward')?.classList.toggle('complete', this.network.backwardDone);
            document.getElementById('bp-stage-update')?.classList.toggle('complete', this.step > 0);
            if (this.phase === 'forward') {
                document.getElementById('bp-stage-forward')?.classList.add('active');
            } else if (this.phase === 'backward') {
                document.getElementById('bp-stage-backward')?.classList.add('active');
            }
        }

        _setText(id, value) {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        }

        _setBadge(text, className) {
            const badge = document.getElementById('pass-badge');
            if (!badge) return;
            badge.textContent = text;
            badge.className = 'viz-badge';
            if (className) badge.classList.add(className);
        }
    }

    // ============================================
    // Initialize
    // ============================================
    function init() {
        clamp = VizLib.MathUtils.clamp;
        const visualization = new BackpropViz();
        window.addEventListener('urlstate-ready', event => {
            visualization._registerURLState(event.detail);
        });
    }

    window.addEventListener('vizlib-ready', init);
})();

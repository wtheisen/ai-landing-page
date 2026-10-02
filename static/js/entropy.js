/**
 * Shannon Entropy Visualizer
 *
 * Interactive visualization of information entropy concepts.
 * Features probability distribution editor with draggable bars,
 * entropy gauge display, and step-by-step calculation breakdown.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    let CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 340;

    // Bar chart layout
    const BAR_CHART_TOP = 25;
    const BAR_CHART_HEIGHT = 220;
    const BAR_CHART_BOTTOM = BAR_CHART_TOP + BAR_CHART_HEIGHT;
    const BAR_PADDING_LEFT = 85;
    const BAR_PADDING_RIGHT = 30;
    const BAR_MIN_WIDTH = 30;
    const BAR_MAX_WIDTH = 80;
    const BAR_GAP = 10;

    // Gauge layout
    const GAUGE_CENTER_Y = 435;
    const GAUGE_RADIUS = 50;

    // Constraints
    const MIN_OUTCOMES = 2;
    const MAX_OUTCOMES = 12;

    // Preset configurations
    const PRESETS = {
        fairCoin: {
            name: 'Fair Coin',
            probabilities: [0.5, 0.5],
            labels: ['Heads', 'Tails']
        },
        biasedCoin: {
            name: 'Biased Coin (90/10)',
            probabilities: [0.9, 0.1],
            labels: ['Heads', 'Tails']
        },
        fairDie: {
            name: 'Fair Die',
            probabilities: [1/6, 1/6, 1/6, 1/6, 1/6, 1/6],
            labels: ['1', '2', '3', '4', '5', '6']
        },
        loadedDie: {
            name: 'Loaded Die',
            probabilities: [0.30, 0.20, 0.18, 0.15, 0.10, 0.07],
            labels: ['1', '2', '3', '4', '5', '6']
        },
        ballsInBag: {
            name: 'Balls in Bag',
            ballCounts: [3, 2, 1],
            probabilities: [0.5, 1/3, 1/6],
            labels: ['Red', 'Blue', 'Green']
        },
        custom: {
            name: 'Custom',
            probabilities: [0.25, 0.25, 0.25, 0.25],
            labels: ['A', 'B', 'C', 'D']
        }
    };

    // ============================================
    // EntropyCalculator Class
    // ============================================
    class EntropyCalculator {
        /**
         * Calculate Shannon entropy of a probability distribution
         * @param {number[]} probabilities - Array of probabilities (should sum to 1)
         * @returns {number} Entropy in bits
         */
        static calculate(probabilities) {
            let entropy = 0;
            for (const p of probabilities) {
                if (p > 0) {
                    entropy -= p * Math.log2(p);
                }
            }
            return entropy;
        }

        /**
         * Calculate maximum possible entropy for n outcomes
         * @param {number} n - Number of outcomes
         * @returns {number} Maximum entropy (log2(n))
         */
        static maxEntropy(n) {
            return Math.log2(n);
        }

        /**
         * Calculate "surprise" (self-information) for a single probability
         * @param {number} p - Probability value
         * @returns {number} Surprise in bits (-log2(p))
         */
        static surprise(p) {
            if (p <= 0) return Infinity;
            return -Math.log2(p);
        }

        /**
         * Get step-by-step calculation breakdown
         * @param {number[]} probabilities
         * @param {string[]} labels
         * @returns {Object[]} Array of {label, p, surprise, contribution}
         */
        static getBreakdown(probabilities, labels) {
            return probabilities.map((p, i) => ({
                label: labels[i] || `Outcome ${i + 1}`,
                p: p,
                surprise: p > 0 ? -Math.log2(p) : 0,
                contribution: p > 0 ? -p * Math.log2(p) : 0
            }));
        }

    }

    // ============================================
    // DistributionState Class
    // ============================================
    class DistributionState {
        constructor() {
            this.probabilities = [0.5, 0.5];
            this.labels = ['Heads', 'Tails'];
            this.currentPreset = 'fairCoin';
            this.linkedMode = true;  // When true, adjusting one bar affects others
        }

        loadPreset(presetKey) {
            const preset = PRESETS[presetKey];
            if (preset) {
                this.probabilities = [...preset.probabilities];
                this.labels = [...preset.labels];
                this.currentPreset = presetKey;
            }
        }

        setProbability(index, value) {
            if (index >= 0 && index < this.probabilities.length) {
                this.probabilities[index] = Math.max(0, Math.min(1, value));
                this.currentPreset = 'custom';
            }
        }

        /**
         * Set probability with linked adjustment - other bars scale to maintain sum=1
         */
        setProbabilityLinked(index, newValue) {
            if (index < 0 || index >= this.probabilities.length) return;

            // Clamp to valid range
            newValue = Math.max(0, Math.min(1, newValue));

            const otherIndices = this.probabilities
                .map((_, i) => i)
                .filter(i => i !== index);

            const otherSum = otherIndices.reduce((s, i) => s + this.probabilities[i], 0);

            // If trying to set > 1, cap it
            if (newValue > 1) newValue = 1;

            // If all others are 0 and we're trying to increase, we can only go to 1
            if (otherSum === 0) {
                this.probabilities[index] = newValue;
            } else {
                // Scale others proportionally so total remains 1
                const targetOtherSum = 1 - newValue;
                const scale = targetOtherSum / otherSum;

                this.probabilities[index] = newValue;
                otherIndices.forEach(i => {
                    this.probabilities[i] = Math.max(0, this.probabilities[i] * scale);
                });
            }

            // Clean up floating point errors
            const sum = this.probabilities.reduce((a, b) => a + b, 0);
            if (Math.abs(sum - 1) > 0.0001) {
                this.probabilities = this.probabilities.map(p => p / sum);
            }

            this.currentPreset = 'custom';
        }

        addOutcome() {
            if (this.probabilities.length < MAX_OUTCOMES) {
                // Add new outcome with 0 probability
                this.probabilities.push(0);
                this.labels.push(this._generateLabel(this.probabilities.length));
                this.normalize();
                this.currentPreset = 'custom';
                return true;
            }
            return false;
        }

        removeOutcome() {
            if (this.probabilities.length > MIN_OUTCOMES) {
                this.probabilities.pop();
                this.labels.pop();
                this.normalize();
                this.currentPreset = 'custom';
                return true;
            }
            return false;
        }

        normalize() {
            this.probabilities = VizLib.MathUtils.normalize(this.probabilities);
        }

        makeUniform() {
            const n = this.probabilities.length;
            this.probabilities = this.probabilities.map(() => 1 / n);
            this.currentPreset = 'custom';
        }

        getEntropy() {
            return EntropyCalculator.calculate(this.probabilities);
        }

        getMaxEntropy() {
            return EntropyCalculator.maxEntropy(this.probabilities.length);
        }

        getSum() {
            return this.probabilities.reduce((a, b) => a + b, 0);
        }

        _generateLabel(index) {
            // Generate labels: A, B, C, ... Z, AA, AB, ...
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            if (index <= 26) {
                return alphabet[index - 1] || String(index);
            }
            return String(index);
        }
    }

    // ============================================
    // BarChartRenderer Class
    // ============================================
    class BarChartRenderer {
        constructor(ctx, state, colors) {
            this.ctx = ctx;
            this.state = state;
            this.colors = colors;
            this.hoveredBar = -1;
            this.draggingBar = -1;
            this.barBounds = [];
            this.huffmanCodes = null;
        }

        render() {
            const { ctx, state, colors } = this;
            const n = state.probabilities.length;

            // Calculate bar dimensions
            const chartWidth = CANVAS_WIDTH - BAR_PADDING_LEFT - BAR_PADDING_RIGHT;
            const totalGaps = (n - 1) * BAR_GAP;
            let barWidth = (chartWidth - totalGaps) / n;
            barWidth = Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, barWidth));

            // Center bars if they don't fill the space
            const totalBarsWidth = n * barWidth + totalGaps;
            const startX = BAR_PADDING_LEFT + (chartWidth - totalBarsWidth) / 2;

            // Clear bar bounds for hit detection
            this.barBounds = [];

            // Draw Y-axis labels and grid lines
            this._drawYAxis();

            // Draw bars
            state.probabilities.forEach((p, i) => {
                const x = startX + i * (barWidth + BAR_GAP);
                const barHeight = p * BAR_CHART_HEIGHT;
                const y = BAR_CHART_BOTTOM - barHeight;

                // Store bounds for hit detection
                this.barBounds.push({ x, y: BAR_CHART_TOP, width: barWidth, height: BAR_CHART_HEIGHT });

                // Bar fill
                ctx.fillStyle = colors[i % colors.length];
                ctx.fillRect(x, y, barWidth, barHeight);

                // Bar border (highlight if hovered/dragging)
                const isActive = i === this.hoveredBar || i === this.draggingBar;
                ctx.strokeStyle = isActive ? EAIColor('gold') : 'rgba(0,0,0,0.3)';
                ctx.lineWidth = isActive ? 3 : 1;
                ctx.strokeRect(x, y, barWidth, barHeight);

                // Probability label above bar
                ctx.fillStyle = this._getTextColor();
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                const labelY = Math.min(y - 5, BAR_CHART_BOTTOM - 5);
                ctx.fillText(`${(p * 100).toFixed(1)}%`, x + barWidth / 2, labelY);

                // Outcome label below bar
                ctx.font = '12px sans-serif';
                ctx.textBaseline = 'top';
                ctx.fillText(state.labels[i], x + barWidth / 2, BAR_CHART_BOTTOM + 8);

                // Huffman code bits below outcome label
                if (this.huffmanCodes && this.huffmanCodes[i]) {
                    this._drawHuffmanBits(x + barWidth / 2, BAR_CHART_BOTTOM + 30, this.huffmanCodes[i].code);
                }

                // Entropy contribution calculation
                this._drawContribution(x + barWidth / 2, BAR_CHART_BOTTOM + 50, p);

                // Draw "+" between adjacent contribution results
                if (i > 0) {
                    const prevCenterX = startX + (i - 1) * (barWidth + BAR_GAP) + barWidth / 2;
                    const currCenterX = x + barWidth / 2;
                    const plusX = (prevCenterX + currCenterX) / 2;
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillStyle = this._getMutedColor();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText('+', plusX, BAR_CHART_BOTTOM + 68);
                }
            });

            // Draw row labels on the left margin
            const labelX = BAR_PADDING_LEFT - 8;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.font = '10px sans-serif';
            ctx.fillStyle = this._getMutedColor();
            ctx.fillText('Huffman', labelX, BAR_CHART_BOTTOM + 36);
            ctx.fillText('−p·log₂p', labelX, BAR_CHART_BOTTOM + 54);
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText('bits', labelX, BAR_CHART_BOTTOM + 72);

            // Draw drag handles indicator on hovered bar
            if (this.hoveredBar >= 0 || this.draggingBar >= 0) {
                const activeBar = this.draggingBar >= 0 ? this.draggingBar : this.hoveredBar;
                const bounds = this.barBounds[activeBar];
                if (bounds) {
                    ctx.fillStyle = EAIColor('gold', 0.8);
                    ctx.beginPath();
                    ctx.arc(bounds.x + bounds.width / 2, BAR_CHART_BOTTOM - state.probabilities[activeBar] * BAR_CHART_HEIGHT, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = EAIColor('gold');
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        _drawYAxis() {
            const { ctx } = this;
            const textColor = this._getTextColor();
            const gridColor = this._getGridColor();

            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = textColor;

            // Draw labels and grid lines at 0%, 25%, 50%, 75%, 100%
            [0, 0.25, 0.5, 0.75, 1].forEach(pct => {
                const y = BAR_CHART_BOTTOM - pct * BAR_CHART_HEIGHT;

                // Label
                ctx.fillText(`${(pct * 100).toFixed(0)}%`, BAR_PADDING_LEFT - 8, y);

                // Grid line
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                ctx.setLineDash(pct === 0 ? [] : [3, 3]);
                ctx.beginPath();
                ctx.moveTo(BAR_PADDING_LEFT - 3, y);
                ctx.lineTo(CANVAS_WIDTH - BAR_PADDING_RIGHT, y);
                ctx.stroke();
                ctx.setLineDash([]);
            });
        }

        _getTextColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
        }

        _getGridColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('muted', 0.3, 'dark') : 'rgba(0, 0, 0, 0.1)';
        }

        _drawContribution(centerX, y, p) {
            const ctx = this.ctx;
            const mutedColor = this._getMutedColor();
            const textColor = this._getTextColor();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            if (p <= 0) {
                ctx.font = '9px sans-serif';
                ctx.fillStyle = mutedColor;
                ctx.fillText('0', centerX, y);
                return;
            }

            const contribution = -p * Math.log2(p);
            const pStr = p.toFixed(2);

            // Line 1: formula with actual values
            ctx.font = '9px sans-serif';
            ctx.fillStyle = mutedColor;
            ctx.fillText(`\u2212(${pStr})log\u2082(${pStr})`, centerX, y);

            // Line 2: result
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = textColor;
            ctx.fillText(contribution.toFixed(3), centerX, y + 18);
        }

        _getMutedColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('muted', 'dark') : EAIColor('axis', 'light');
        }

        _drawHuffmanBits(centerX, y, code) {
            const ctx = this.ctx;
            const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const bitSize = 13;
            const bitGap = 1;
            const totalWidth = code.length * (bitSize + bitGap) - bitGap;
            let bx = centerX - totalWidth / 2;

            for (let b = 0; b < code.length; b++) {
                const bit = code[b];

                // Background
                ctx.fillStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 0.3, 'dark') : EAIColor('blue-mid', 0.15))
                    : (isDark ? EAIColor('sunken', 0.8, 'dark') : 'rgba(0, 0, 0, 0.05)');
                ctx.fillRect(bx, y, bitSize, bitSize);

                // Border
                ctx.strokeStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 0.5, 'dark') : EAIColor('blue-mid', 0.4))
                    : (isDark ? EAIColor('muted', 0.3, 'dark') : 'rgba(0, 0, 0, 0.15)');
                ctx.lineWidth = 1;
                ctx.strokeRect(bx, y, bitSize, bitSize);

                // Bit text
                ctx.fillStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 'dark') : EAIColor('blue', 'light'))
                    : (isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light'));
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(bit, bx + bitSize / 2, y + bitSize / 2);

                bx += bitSize + bitGap;
            }
        }

        getBarAtPosition(x, y) {
            for (let i = 0; i < this.barBounds.length; i++) {
                const b = this.barBounds[i];
                if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
                    return i;
                }
            }
            return -1;
        }

        getProbabilityFromY(y) {
            // Convert Y position to probability (inverted)
            const p = (BAR_CHART_BOTTOM - y) / BAR_CHART_HEIGHT;
            return Math.max(0, Math.min(1, p));
        }
    }

    // ============================================
    // BallBagRenderer Class
    // ============================================
    class BallBagRenderer {
        constructor(ctx, state, colors) {
            this.ctx = ctx;
            this.state = state;
            this.colors = colors;
            this.huffmanCodes = null;

            // Ball counts per color
            this.counts = [3, 2, 1];
            // Currently selected color index for adding balls
            this.selectedColor = 0;

            // Layout constants
            this.bagTop = 20;
            this.bagBottom = 230;
            this.bagPadding = 60;

            // Cached ball positions for hit testing
            this.ballPositions = [];
            // Palette strip bounds for hit testing
            this.paletteBounds = [];
        }

        /**
         * Load counts from preset, sync probabilities
         */
        loadCounts(counts) {
            this.counts = counts.slice();
            this._syncProbabilities();
        }

        _syncProbabilities() {
            const total = this.counts.reduce((a, b) => a + b, 0);
            if (total === 0) {
                this.state.probabilities = this.counts.map(() => 0);
            } else {
                this.state.probabilities = this.counts.map(c => c / total);
            }
        }

        addBall(colorIndex) {
            if (colorIndex >= 0 && colorIndex < this.counts.length) {
                this.counts[colorIndex]++;
                this._syncProbabilities();
            }
        }

        removeBall(colorIndex) {
            if (colorIndex >= 0 && colorIndex < this.counts.length && this.counts[colorIndex] > 0) {
                this.counts[colorIndex]--;
                // Remove color if all counts are zero? No, keep the color.
                this._syncProbabilities();
            }
        }

        /**
         * Find which ball is at the given canvas coordinates
         * Returns {colorIndex} or null
         */
        getBallAtPosition(x, y) {
            // Check in reverse order so top-drawn balls are hit first
            for (let i = this.ballPositions.length - 1; i >= 0; i--) {
                const bp = this.ballPositions[i];
                const dx = x - bp.x;
                const dy = y - bp.y;
                if (dx * dx + dy * dy <= bp.r * bp.r) {
                    return { colorIndex: bp.colorIndex };
                }
            }
            return null;
        }

        /**
         * Find which palette swatch was clicked
         * Returns colorIndex or -1
         */
        getPaletteAtPosition(x, y) {
            for (let i = 0; i < this.paletteBounds.length; i++) {
                const b = this.paletteBounds[i];
                if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                    return i;
                }
            }
            return -1;
        }

        /**
         * Check if position is inside the bag area
         */
        isInsideBag(x, y) {
            const bagLeft = this.bagPadding;
            const bagRight = CANVAS_WIDTH - this.bagPadding;
            return x >= bagLeft && x <= bagRight && y >= this.bagTop && y <= this.bagBottom;
        }

        render() {
            const { ctx, state, colors, counts } = this;
            const n = counts.length;
            const total = counts.reduce((a, b) => a + b, 0);

            const bagLeft = this.bagPadding;
            const bagRight = CANVAS_WIDTH - this.bagPadding;
            const bagWidth = bagRight - bagLeft;
            const bagHeight = this.bagBottom - this.bagTop;

            const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const textColor = isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
            const mutedColor = isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light');
            const bagBg = isDark ? EAIColor('sunken', 'dark') : EAIColor('gold-fill', 'light');
            const bagBorder = isDark ? EAIColor('axis', 'dark') : EAIColor('gold-mid', 'light');

            // --- Draw bag container ---
            ctx.fillStyle = bagBg;
            ctx.strokeStyle = bagBorder;
            ctx.lineWidth = 2;
            VizLib.CanvasUtils.roundRect(ctx, bagLeft, this.bagTop, bagWidth, bagHeight, 16);
            ctx.fill();
            ctx.stroke();

            // Bag opening (top trapezoid shape)
            ctx.beginPath();
            ctx.moveTo(bagLeft + 15, this.bagTop);
            ctx.lineTo(bagLeft - 5, this.bagTop - 10);
            ctx.lineTo(bagRight + 5, this.bagTop - 10);
            ctx.lineTo(bagRight - 15, this.bagTop);
            ctx.fillStyle = bagBorder;
            ctx.fill();

            // --- Layout balls inside bag ---
            this.ballPositions = [];

            if (total > 0) {
                // Determine ball radius - scale down for many balls
                const maxRadius = 16;
                const minRadius = 6;
                let radius = maxRadius;
                if (total > 15) {
                    radius = Math.max(minRadius, maxRadius - (total - 15) * 0.4);
                }

                // Build array of all balls with their color
                const allBalls = [];
                for (let ci = 0; ci < n; ci++) {
                    for (let j = 0; j < counts[ci]; j++) {
                        allBalls.push(ci);
                    }
                }

                // Pack balls in a hex grid pattern inside the bag
                const spacing = radius * 2.2;
                const usableWidth = bagWidth - radius * 4;
                const cols = Math.max(1, Math.floor(usableWidth / spacing));
                const rows = Math.ceil(allBalls.length / cols);

                // Center the grid vertically and horizontally in the bag
                const gridWidth = Math.min(allBalls.length, cols) * spacing;
                const gridHeight = rows * spacing;
                const startX = bagLeft + (bagWidth - gridWidth) / 2 + spacing / 2;
                const startY = this.bagTop + (bagHeight - gridHeight) / 2 + spacing / 2;

                for (let idx = 0; idx < allBalls.length; idx++) {
                    const row = Math.floor(idx / cols);
                    const col = idx % cols;
                    // Hex offset: odd rows shift right by half spacing
                    const offsetX = (row % 2) * (spacing / 2);
                    const bx = startX + col * spacing + offsetX;
                    const by = startY + row * spacing;

                    const ci = allBalls[idx];

                    // Draw ball shadow
                    ctx.beginPath();
                    ctx.arc(bx + 1.5, by + 1.5, radius, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(0,0,0,0.15)';
                    ctx.fill();

                    // Draw ball
                    ctx.beginPath();
                    ctx.arc(bx, by, radius, 0, Math.PI * 2);
                    ctx.fillStyle = colors[ci % colors.length];
                    ctx.fill();
                    ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Highlight/shine on ball
                    ctx.beginPath();
                    ctx.arc(bx - radius * 0.25, by - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.35)';
                    ctx.fill();

                    this.ballPositions.push({ x: bx, y: by, r: radius, colorIndex: ci });
                }
            } else {
                // Empty bag message
                ctx.fillStyle = mutedColor;
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Click to add balls', bagLeft + bagWidth / 2, this.bagTop + bagHeight / 2);
            }

            // --- Draw color palette strip below bag ---
            const paletteY = this.bagBottom + 12;
            const swatchSize = 18;
            const swatchGap = 8;
            const totalPaletteWidth = n * swatchSize + (n - 1) * swatchGap;
            let paletteStartX = (CANVAS_WIDTH - totalPaletteWidth) / 2;

            this.paletteBounds = [];

            for (let ci = 0; ci < n; ci++) {
                const sx = paletteStartX + ci * (swatchSize + swatchGap);

                // Selection indicator
                if (ci === this.selectedColor) {
                    ctx.strokeStyle = isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
                    ctx.lineWidth = 2;
                    ctx.strokeRect(sx - 3, paletteY - 3, swatchSize + 6, swatchSize + 6);
                }

                // Swatch
                ctx.fillStyle = colors[ci % colors.length];
                ctx.fillRect(sx, paletteY, swatchSize, swatchSize);

                this.paletteBounds.push({ x: sx - 3, y: paletteY - 3, w: swatchSize + 6, h: swatchSize + 6 });
            }

            // --- Draw labels row: color name + count ---
            const labelY = paletteY + swatchSize + 10;
            const labelSpacing = Math.min(80, (CANVAS_WIDTH - 2 * this.bagPadding) / n);
            const labelsStartX = CANVAS_WIDTH / 2 - (n * labelSpacing) / 2 + labelSpacing / 2;

            for (let ci = 0; ci < n; ci++) {
                const lx = labelsStartX + ci * labelSpacing;

                // Color dot + label
                ctx.fillStyle = colors[ci % colors.length];
                ctx.beginPath();
                ctx.arc(lx - 20, labelY + 4, 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = textColor;
                ctx.font = '11px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(`${state.labels[ci]}: ${counts[ci]}`, lx - 14, labelY);
            }

            // --- Draw Huffman codes row ---
            if (this.huffmanCodes) {
                const huffY = labelY + 20;
                ctx.font = '10px sans-serif';
                ctx.fillStyle = mutedColor;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                ctx.fillText('Huffman', this.bagPadding - 8, huffY);

                for (let ci = 0; ci < n; ci++) {
                    if (this.huffmanCodes[ci]) {
                        const lx = labelsStartX + ci * labelSpacing;
                        this._drawHuffmanBits(lx, huffY, this.huffmanCodes[ci].code);
                    }
                }
            }

            // --- Draw contribution formula row ---
            const contribY = (this.huffmanCodes ? labelY + 40 : labelY + 20);
            ctx.font = '10px sans-serif';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('\u2212p\u00B7log\u2082p', this.bagPadding - 8, contribY);

            for (let ci = 0; ci < n; ci++) {
                const lx = labelsStartX + ci * labelSpacing;
                const p = state.probabilities[ci] || 0;
                this._drawContribution(lx, contribY, p);
            }

            // Draw "+" between contributions
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (let ci = 1; ci < n; ci++) {
                const prevX = labelsStartX + (ci - 1) * labelSpacing;
                const currX = labelsStartX + ci * labelSpacing;
                ctx.fillText('+', (prevX + currX) / 2, contribY + 14);
            }

            // Result row
            const resultY = contribY + 14;
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('bits', this.bagPadding - 8, resultY);
        }

        _drawContribution(centerX, y, p) {
            const ctx = this.ctx;
            const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const mutedColor = isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light');
            const textColor = isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            if (p <= 0) {
                ctx.font = '9px sans-serif';
                ctx.fillStyle = mutedColor;
                ctx.fillText('0', centerX, y);
                return;
            }

            const contribution = -p * Math.log2(p);
            const pStr = p.toFixed(2);

            ctx.font = '9px sans-serif';
            ctx.fillStyle = mutedColor;
            ctx.fillText(`\u2212(${pStr})log\u2082(${pStr})`, centerX, y);

            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = textColor;
            ctx.fillText(contribution.toFixed(3), centerX, y + 14);
        }

        _drawHuffmanBits(centerX, y, code) {
            const ctx = this.ctx;
            const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const bitSize = 12;
            const bitGap = 1;
            const totalWidth = code.length * (bitSize + bitGap) - bitGap;
            let bx = centerX - totalWidth / 2;

            for (let b = 0; b < code.length; b++) {
                const bit = code[b];
                ctx.fillStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 0.3, 'dark') : EAIColor('blue-mid', 0.15))
                    : (isDark ? EAIColor('sunken', 0.8, 'dark') : 'rgba(0, 0, 0, 0.05)');
                ctx.fillRect(bx, y, bitSize, bitSize);

                ctx.strokeStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 0.5, 'dark') : EAIColor('blue-mid', 0.4))
                    : (isDark ? EAIColor('muted', 0.3, 'dark') : 'rgba(0, 0, 0, 0.15)');
                ctx.lineWidth = 1;
                ctx.strokeRect(bx, y, bitSize, bitSize);

                ctx.fillStyle = bit === '1'
                    ? (isDark ? EAIColor('green', 'dark') : EAIColor('blue', 'light'))
                    : (isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light'));
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(bit, bx + bitSize / 2, y + bitSize / 2);

                bx += bitSize + bitGap;
            }
        }
    }

    // ============================================
    // EntropyGaugeRenderer Class
    // ============================================
    class EntropyGaugeRenderer {
        constructor(ctx) {
            this.ctx = ctx;
            this.centerX = CANVAS_WIDTH / 2;
            this.centerY = GAUGE_CENTER_Y;
            this.radius = GAUGE_RADIUS;
        }

        render(currentEntropy, maxEntropy) {
            const { ctx, centerX, centerY, radius } = this;
            const textColor = this._getTextColor();

            // Draw subtle separator line between bar chart and gauge
            const separatorY = centerY - radius - 35;
            ctx.strokeStyle = this._getBackgroundColor();
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(BAR_PADDING_LEFT, separatorY);
            ctx.lineTo(CANVAS_WIDTH - BAR_PADDING_RIGHT, separatorY);
            ctx.stroke();

            // Draw title
            ctx.fillStyle = textColor;
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('Entropy', centerX, centerY - radius - 15);

            // Draw gauge background arc
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
            ctx.strokeStyle = this._getBackgroundColor();
            ctx.lineWidth = 12;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw filled portion based on entropy ratio
            const ratio = maxEntropy > 0 ? Math.min(currentEntropy / maxEntropy, 1) : 0;
            const endAngle = Math.PI + (Math.PI * ratio);

            // Create gradient for gauge fill
            const gradient = ctx.createLinearGradient(
                centerX - radius, centerY,
                centerX + radius, centerY
            );
            gradient.addColorStop(0, this._getLowColor());
            gradient.addColorStop(0.5, this._getMidColor());
            gradient.addColorStop(1, this._getHighColor());

            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, Math.PI, endAngle, false);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 12;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw entropy value in center
            ctx.fillStyle = textColor;
            ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(currentEntropy.toFixed(3), centerX, centerY - 5);

            ctx.font = '11px sans-serif';
            ctx.fillStyle = this._getMutedColor();
            ctx.fillText('bits', centerX, centerY + 12);

            // Draw min/max labels
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('0', centerX - radius - 5, centerY + 25);
            ctx.textAlign = 'right';
            ctx.fillText(maxEntropy.toFixed(2), centerX + radius + 5, centerY + 25);

            // Draw percentage indicator
            ctx.textAlign = 'center';
            ctx.fillText(`${(ratio * 100).toFixed(0)}% of max`, centerX, centerY + 38);
        }

        _getTextColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
        }

        _getMutedColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('muted', 'dark') : EAIColor('muted', 'light');
        }

        _getBackgroundColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('sunken', 'dark') : EAIColor('sunken', 'light');
        }

        _getLowColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('green', 'dark') : EAIColor('green', 'light');
        }

        _getMidColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('gold', 'dark') : EAIColor('gold', 'light');
        }

        _getHighColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('red', 'dark') : EAIColor('red-mid', 'light');
        }
    }

    // ============================================
    // MathBreakdownRenderer Class
    // ============================================
    class MathBreakdownRenderer {
        constructor(container, colors) {
            this.container = container;
            this.colors = colors;
        }

        render(breakdown, totalEntropy) {
            let html = '<div class="entropy-breakdown">';

            // Formula with actual values
            html += '<div class="breakdown-formula">H = ';
            const terms = breakdown
                .filter(item => item.p > 0)
                .map(item => `−(${item.p.toFixed(3)} × log₂(${item.p.toFixed(3)}))`)
                .join(' + ');
            html += terms || '0';
            html += ` = <strong>${totalEntropy.toFixed(4)}</strong> bits</div>`;

            // Detailed table
            html += '<table class="viz-breakdown-table breakdown-table">';
            html += '<thead><tr>';
            html += '<th>Outcome</th>';
            html += '<th>p</th>';
            html += '<th>−log₂(p)</th>';
            html += '<th>−p·log₂(p)</th>';
            html += '</tr></thead>';
            html += '<tbody>';

            for (let i = 0; i < breakdown.length; i++) {
                const item = breakdown[i];
                const color = this.colors[i % this.colors.length];
                html += '<tr>';
                html += `<td><span class="outcome-dot" style="background-color: ${color}"></span>${item.label}</td>`;
                html += `<td>${item.p.toFixed(4)}</td>`;
                html += `<td>${item.p > 0 ? item.surprise.toFixed(4) : '∞'}</td>`;
                html += `<td>${item.contribution.toFixed(4)}</td>`;
                html += '</tr>';
            }

            html += `<tr class="total-row">
                <td colspan="3"><strong>Total Entropy H(X)</strong></td>
                <td><strong>${totalEntropy.toFixed(4)} bits</strong></td>
            </tr>`;
            html += '</tbody></table>';
            html += '</div>';

            this.container.innerHTML = html;
        }
    }

    // ============================================
    // SamplingSimulator Class
    // ============================================
    class SamplingSimulator {
        constructor(state, colors) {
            this.state = state;
            this.colors = colors;
            this.samples = [];      // Array of {outcome, surprise}
            this.counts = {};       // outcome -> count
        }

        sampleOnce() {
            const probs = this.state.probabilities;
            const r = Math.random();
            let cumulative = 0;

            for (let i = 0; i < probs.length; i++) {
                cumulative += probs[i];
                if (r < cumulative) {
                    const surprise = EntropyCalculator.surprise(probs[i]);
                    this.samples.push({ outcome: i, surprise });
                    this.counts[i] = (this.counts[i] || 0) + 1;
                    return {
                        outcome: i,
                        label: this.state.labels[i],
                        probability: probs[i],
                        surprise
                    };
                }
            }

            // Fallback (shouldn't happen with normalized probabilities)
            const lastIdx = probs.length - 1;
            const surprise = EntropyCalculator.surprise(probs[lastIdx]);
            this.samples.push({ outcome: lastIdx, surprise });
            this.counts[lastIdx] = (this.counts[lastIdx] || 0) + 1;
            return {
                outcome: lastIdx,
                label: this.state.labels[lastIdx],
                probability: probs[lastIdx],
                surprise
            };
        }

        sampleMany(n) {
            const results = [];
            for (let i = 0; i < n; i++) {
                results.push(this.sampleOnce());
            }
            return results;
        }

        getAverageSurprise() {
            if (this.samples.length === 0) return 0;
            return this.samples.reduce((sum, s) => sum + s.surprise, 0) / this.samples.length;
        }

        getTotalSamples() {
            return this.samples.length;
        }

        getEmpiricalDistribution() {
            const total = this.samples.length;
            if (total === 0) return this.state.probabilities.map(() => 0);
            return this.state.probabilities.map((_, i) => (this.counts[i] || 0) / total);
        }

        clear() {
            this.samples = [];
            this.counts = {};
        }

        renderHistogram(container) {
            const total = this.samples.length;
            const n = this.state.probabilities.length;

            if (total === 0) {
                container.innerHTML = '<div class="histogram-empty">No samples yet. Click "Sample" to begin.</div>';
                return;
            }

            let html = '<div class="histogram-container">';
            html += '<div class="histogram-legend">';
            html += '<span class="legend-theoretical">▢ Theoretical</span>';
            html += '<span class="legend-empirical">▮ Empirical</span>';
            html += '</div>';
            html += '<div class="histogram-bars">';

            const maxP = Math.max(
                ...this.state.probabilities,
                ...this.getEmpiricalDistribution()
            );

            for (let i = 0; i < n; i++) {
                const theoretical = this.state.probabilities[i];
                const empirical = (this.counts[i] || 0) / total;
                const color = this.colors[i % this.colors.length];

                const theoreticalHeight = (theoretical / maxP) * 100;
                const empiricalHeight = (empirical / maxP) * 100;

                html += `<div class="histogram-bar-group">
                    <div class="histogram-bar-wrapper">
                        <div class="histogram-bar theoretical" style="height: ${theoreticalHeight}%; border-color: ${color};"></div>
                        <div class="histogram-bar empirical" style="height: ${empiricalHeight}%; background-color: ${color};"></div>
                    </div>
                    <div class="histogram-label">${this.state.labels[i]}</div>
                    <div class="histogram-count">${this.counts[i] || 0}</div>
                </div>`;
            }

            html += '</div></div>';
            container.innerHTML = html;
        }
    }

    // ============================================
    // HuffmanEncoder Class
    // ============================================
    class HuffmanEncoder {
        constructor() {
            this.codes = {};
            this.tree = null;
        }

        /**
         * Build Huffman tree and generate codes
         */
        encode(probabilities, labels) {
            // Create leaf nodes for non-zero probabilities
            const nodes = probabilities.map((p, i) => ({
                symbol: labels[i],
                prob: p,
                index: i,
                code: '',
                isLeaf: true
            })).filter(n => n.prob > 0);

            // Handle edge cases
            if (nodes.length === 0) {
                this.codes = {};
                return this.codes;
            }

            if (nodes.length === 1) {
                nodes[0].code = '0';
                this.codes = { [nodes[0].index]: nodes[0] };
                return this.codes;
            }

            // Build tree by repeatedly combining two smallest
            while (nodes.length > 1) {
                nodes.sort((a, b) => a.prob - b.prob);
                const left = nodes.shift();
                const right = nodes.shift();

                // Prefix existing codes
                this._prefixCode(left, '0');
                this._prefixCode(right, '1');

                // Create internal node
                nodes.push({
                    prob: left.prob + right.prob,
                    left: left,
                    right: right,
                    isLeaf: false
                });
            }

            this.tree = nodes[0];

            // Extract codes from tree
            this.codes = {};
            this._extractCodes(this.tree);
            return this.codes;
        }

        _prefixCode(node, bit) {
            if (node.isLeaf) {
                node.code = bit + node.code;
            } else {
                if (node.left) this._prefixCode(node.left, bit);
                if (node.right) this._prefixCode(node.right, bit);
            }
        }

        _extractCodes(node) {
            if (!node) return;
            if (node.isLeaf) {
                this.codes[node.index] = {
                    symbol: node.symbol,
                    prob: node.prob,
                    code: node.code,
                    index: node.index
                };
            } else {
                this._extractCodes(node.left);
                this._extractCodes(node.right);
            }
        }

        getAverageCodeLength(probabilities) {
            let avg = 0;
            for (const [idx, node] of Object.entries(this.codes)) {
                avg += probabilities[parseInt(idx)] * node.code.length;
            }
            return avg;
        }

        renderTable(container, colors) {
            if (Object.keys(this.codes).length === 0) {
                container.innerHTML = '<div class="encoding-empty">No encoding available.</div>';
                return;
            }

            let html = '<table class="encoding-code-table">';
            html += '<thead><tr><th>Outcome</th><th>p</th><th>Huffman Code</th><th>Bits</th></tr></thead>';
            html += '<tbody>';

            // Sort by index for consistent display
            const sortedEntries = Object.entries(this.codes).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

            for (const [idx, node] of sortedEntries) {
                const color = colors[parseInt(idx) % colors.length];
                const bits = node.code.split('').map(b =>
                    `<span class="bit bit-${b}">${b}</span>`
                ).join('');

                html += `<tr>
                    <td><span class="outcome-dot" style="background-color: ${color}"></span>${node.symbol}</td>
                    <td>${node.prob.toFixed(4)}</td>
                    <td class="code-cell">${bits}</td>
                    <td>${node.code.length}</td>
                </tr>`;
            }

            html += '</tbody></table>';
            container.innerHTML = html;
        }
    }

    // ============================================
    // EntropyVisualizer (Main Controller)
    // ============================================
    class EntropyVisualizer {
        constructor() {
            this.canvas = null;
            this.ctx = null;
            this.dpr = 1;

            this.state = new DistributionState();
            this.barChartRenderer = null;
            this.ballBagRenderer = null;
            this.gaugeRenderer = null;
            this.mathRenderer = null;
            this.sampler = null;
            this.encoder = null;

            // 'barChart' or 'ballBag'
            this.activeRenderer = 'barChart';

            this.isDragging = false;
            this.dragBarIndex = -1;

            // Colors for outcomes
            this.colors = [];
        }

        init() {
            // Wait for VizLib to be ready
            if (window.VizLib) {
                this._setup();
            } else {
                window.addEventListener('vizlib-ready', () => this._setup());
            }
        }

        _setup() {
            // Get DOM elements
            this.canvas = document.getElementById('entropy-canvas');
            if (!this.canvas) {
                console.error('Entropy canvas not found');
                return;
            }

            // Measure actual container width and update CANVAS_WIDTH
            this._resizeCanvas();

            // Get colors from ThemeManager
            this._updateColors();

            // Initialize renderers
            this.barChartRenderer = new BarChartRenderer(this.ctx, this.state, this.colors);
            this.ballBagRenderer = new BallBagRenderer(this.ctx, this.state, this.colors);
            this.gaugeRenderer = new EntropyGaugeRenderer(this.ctx);

            const mathContainer = document.getElementById('entropy-math-breakdown');
            if (mathContainer) {
                this.mathRenderer = new MathBreakdownRenderer(mathContainer, this.colors);
            }

            // Initialize sampling simulator
            this.sampler = new SamplingSimulator(this.state, this.colors);

            // Initialize Huffman encoder
            this.encoder = new HuffmanEncoder();

            // Bind events
            this._bindEvents();

            // Initial render
            this.render();

            // Initial encoding update
            this._updateEncoding();
        }

        _resizeCanvas() {
            // Read actual CSS size and update the logical width
            const rect = this.canvas.getBoundingClientRect();
            CANVAS_WIDTH = rect.width;

            // Re-setup hi-DPI canvas with new dimensions
            const result = VizLib.setupHiDPICanvas(this.canvas);
            this.ctx = result.ctx;
            this.dpr = result.dpr;

            // Update gauge center if renderer exists
            if (this.gaugeRenderer) {
                this.gaugeRenderer.ctx = this.ctx;
                this.gaugeRenderer.centerX = CANVAS_WIDTH / 2;
            }
            if (this.barChartRenderer) {
                this.barChartRenderer.ctx = this.ctx;
            }
            if (this.ballBagRenderer) {
                this.ballBagRenderer.ctx = this.ctx;
            }
        }

        _updateColors() {
            this.colors = VizLib.ThemeManager.getColors('categorical', 12);

            // Update renderers if they exist
            if (this.barChartRenderer) {
                this.barChartRenderer.colors = this.colors;
            }
            if (this.ballBagRenderer) {
                this.ballBagRenderer.colors = this.colors;
            }
            if (this.mathRenderer) {
                this.mathRenderer.colors = this.colors;
            }
        }

        _bindEvents() {
            // Canvas mouse events
            this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
            this.canvas.addEventListener('mouseup', () => this._onMouseUp());
            this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());

            // Right-click for ball bag mode (debounce to prevent double-fire)
            let lastContextMenu = 0;
            this.canvas.addEventListener('contextmenu', (e) => {
                if (this.activeRenderer === 'ballBag') {
                    e.preventDefault();
                    const now = Date.now();
                    if (now - lastContextMenu < 200) return;
                    lastContextMenu = now;
                    const pos = this._getMousePos(e);
                    const hit = this.ballBagRenderer.getBallAtPosition(pos.x, pos.y);
                    if (hit) {
                        this.ballBagRenderer.removeBall(hit.colorIndex);
                        this.render();
                    }
                }
            });

            // Touch events for mobile
            this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e));
            this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e));
            this.canvas.addEventListener('touchend', () => this._onMouseUp());

            // Resize handling
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    this._resizeCanvas();
                    this.render();
                }, 100);
            });

            // Control events
            const presetSelect = document.getElementById('preset-select');
            if (presetSelect) {
                presetSelect.addEventListener('change', (e) => this._onPresetChange(e));
            }

            const addBtn = document.getElementById('btn-add-outcome');
            if (addBtn) {
                addBtn.addEventListener('click', () => this._onAddOutcome());
            }

            const removeBtn = document.getElementById('btn-remove-outcome');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => this._onRemoveOutcome());
            }

            const normalizeBtn = document.getElementById('btn-normalize');
            if (normalizeBtn) {
                normalizeBtn.addEventListener('click', () => this._onNormalize());
            }

            const uniformBtn = document.getElementById('btn-uniform');
            if (uniformBtn) {
                uniformBtn.addEventListener('click', () => this._onUniform());
            }

            const resetBtn = document.getElementById('btn-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this._onReset());
            }

            // Theme change listener
            document.addEventListener('themechange', () => {
                this._updateColors();
                this.render();
            });

            // Tab change - update math breakdown when Math tab is shown
            document.querySelectorAll('.panel-tabs a[data-toggle="tab"]').forEach(tab => {
                tab.addEventListener('shown.bs.tab', (e) => {
                    if (e.target.getAttribute('href') === '#tab-math') {
                        this._updateMathBreakdown();
                    }
                    if (e.target.getAttribute('href') === '#tab-sampling') {
                        this._updateSamplingDisplay();
                    }
                });
                // Also handle click for Bootstrap 3
                tab.addEventListener('click', () => {
                    setTimeout(() => {
                        this._updateMathBreakdown();
                        this._updateSamplingDisplay();
                    }, 50);
                });
            });

            // Linked probabilities checkbox
            const linkCheckbox = document.getElementById('link-probabilities');
            if (linkCheckbox) {
                linkCheckbox.addEventListener('change', (e) => {
                    this.state.linkedMode = e.target.checked;
                });
            }

            // Show encoding checkbox
            const encodingCheckbox = document.getElementById('show-encoding');
            if (encodingCheckbox) {
                encodingCheckbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this._updateEncoding();
                    } else {
                        this.barChartRenderer.huffmanCodes = null;
                        const avgDisplay = document.getElementById('avg-code-display');
                        if (avgDisplay) avgDisplay.style.display = 'none';
                    }
                    this.render();
                });
            }

            // Sampling buttons
            const sampleOneBtn = document.getElementById('btn-sample-one');
            if (sampleOneBtn) {
                sampleOneBtn.addEventListener('click', () => this._onSampleOnce());
            }

            const sampleManyBtn = document.getElementById('btn-sample-many');
            if (sampleManyBtn) {
                sampleManyBtn.addEventListener('click', () => this._onSampleMany());
            }

            const clearSamplesBtn = document.getElementById('btn-clear-samples');
            if (clearSamplesBtn) {
                clearSamplesBtn.addEventListener('click', () => this._onClearSamples());
            }
        }

        _getMousePos(e) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
                y: (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height)
            };
        }

        _getTouchPos(e) {
            const touch = e.touches[0];
            return this._getMousePos(touch);
        }

        _onMouseDown(e) {
            const pos = this._getMousePos(e);

            if (this.activeRenderer === 'ballBag') {
                // Left-click only (right-click handled in contextmenu)
                if (e.button !== 0) return;
                const bbr = this.ballBagRenderer;

                // Check palette click first
                const paletteIdx = bbr.getPaletteAtPosition(pos.x, pos.y);
                if (paletteIdx >= 0) {
                    bbr.selectedColor = paletteIdx;
                    this.render();
                    return;
                }

                // Check if clicking an existing ball (tap to remove on desktop too? No - only right-click removes)
                // Left-click inside bag = add ball of selected color
                if (bbr.isInsideBag(pos.x, pos.y)) {
                    bbr.addBall(bbr.selectedColor);
                    this.render();
                }
                return;
            }

            const barIndex = this.barChartRenderer.getBarAtPosition(pos.x, pos.y);
            if (barIndex >= 0) {
                this.isDragging = true;
                this.dragBarIndex = barIndex;
                this.barChartRenderer.draggingBar = barIndex;
                this.canvas.style.cursor = 'ns-resize';
                this.render();
            }
        }

        _onMouseMove(e) {
            if (this.activeRenderer === 'ballBag') {
                const pos = this._getMousePos(e);
                const bbr = this.ballBagRenderer;
                // Cursor hint: pointer over balls/palette, crosshair in bag
                if (bbr.getPaletteAtPosition(pos.x, pos.y) >= 0) {
                    this.canvas.style.cursor = 'pointer';
                } else if (bbr.getBallAtPosition(pos.x, pos.y)) {
                    this.canvas.style.cursor = 'pointer';
                } else if (bbr.isInsideBag(pos.x, pos.y)) {
                    this.canvas.style.cursor = 'crosshair';
                } else {
                    this.canvas.style.cursor = 'default';
                }
                return;
            }

            const pos = this._getMousePos(e);

            if (this.isDragging && this.dragBarIndex >= 0) {
                // Update probability based on Y position
                const newP = this.barChartRenderer.getProbabilityFromY(pos.y);
                this.state.setProbabilityLinked(this.dragBarIndex, newP);
                this.render();
            } else {
                // Hover detection
                const barIndex = this.barChartRenderer.getBarAtPosition(pos.x, pos.y);
                if (barIndex !== this.barChartRenderer.hoveredBar) {
                    this.barChartRenderer.hoveredBar = barIndex;
                    this.canvas.style.cursor = barIndex >= 0 ? 'ns-resize' : 'default';
                    this.render();
                }
            }
        }

        _onMouseUp() {
            if (this.isDragging) {
                this.isDragging = false;
                this.dragBarIndex = -1;
                if (this.activeRenderer !== 'ballBag') {
                    this.barChartRenderer.draggingBar = -1;
                }
                this.canvas.style.cursor = 'default';
                this.render();
            }
        }

        _onMouseLeave() {
            if (this.activeRenderer !== 'ballBag') {
                this.barChartRenderer.hoveredBar = -1;
            }
            this._onMouseUp();
        }

        _onTouchStart(e) {
            e.preventDefault();
            const pos = this._getTouchPos(e);

            if (this.activeRenderer === 'ballBag') {
                const bbr = this.ballBagRenderer;

                // Palette tap
                const paletteIdx = bbr.getPaletteAtPosition(pos.x, pos.y);
                if (paletteIdx >= 0) {
                    bbr.selectedColor = paletteIdx;
                    this.render();
                    return;
                }

                // Tap on existing ball = remove it
                const hit = bbr.getBallAtPosition(pos.x, pos.y);
                if (hit) {
                    bbr.removeBall(hit.colorIndex);
                    this.render();
                    return;
                }

                // Tap empty space in bag = add ball
                if (bbr.isInsideBag(pos.x, pos.y)) {
                    bbr.addBall(bbr.selectedColor);
                    this.render();
                }
                return;
            }

            const barIndex = this.barChartRenderer.getBarAtPosition(pos.x, pos.y);
            if (barIndex >= 0) {
                this.isDragging = true;
                this.dragBarIndex = barIndex;
                this.barChartRenderer.draggingBar = barIndex;
                this.render();
            }
        }

        _onTouchMove(e) {
            e.preventDefault();
            if (this.activeRenderer === 'ballBag') return;
            if (this.isDragging && this.dragBarIndex >= 0) {
                const pos = this._getTouchPos(e);
                const newP = this.barChartRenderer.getProbabilityFromY(pos.y);

                this.state.setProbabilityLinked(this.dragBarIndex, newP);
                this.render();
            }
        }

        _onPresetChange(e) {
            const presetKey = e.target.value;
            this.state.loadPreset(presetKey);

            if (presetKey === 'ballsInBag') {
                this.activeRenderer = 'ballBag';
                const preset = PRESETS.ballsInBag;
                this.ballBagRenderer.loadCounts(preset.ballCounts);
                // Update hint text
                const hint = document.querySelector('.entropy-hint');
                if (hint) hint.innerHTML = '<i class="fa fa-hand-pointer-o"></i> Click bag to add, right-click ball to remove';
            } else {
                this.activeRenderer = 'barChart';
                const hint = document.querySelector('.entropy-hint');
                if (hint) hint.innerHTML = '<i class="fa fa-hand-pointer-o"></i> Drag bars to adjust probabilities';
            }

            this._updateOutcomeCount();
            this.render();
        }

        _onAddOutcome() {
            if (this.state.addOutcome()) {
                this._updateOutcomeCount();
                this._updatePresetSelect();
                this.render();
            }
        }

        _onRemoveOutcome() {
            if (this.state.removeOutcome()) {
                this._updateOutcomeCount();
                this._updatePresetSelect();
                this.render();
            }
        }

        _onNormalize() {
            this.state.normalize();
            this.render();
        }

        _onUniform() {
            this.state.makeUniform();
            this._updatePresetSelect();
            this.render();
        }

        _onReset() {
            const presetSelect = document.getElementById('preset-select');
            const presetKey = presetSelect ? presetSelect.value : 'fairCoin';
            this.state.loadPreset(presetKey);
            if (presetKey === 'ballsInBag') {
                this.ballBagRenderer.loadCounts(PRESETS.ballsInBag.ballCounts);
            }
            this._updateOutcomeCount();
            this.render();
        }

        _updateOutcomeCount() {
            const countEl = document.getElementById('outcome-count');
            if (countEl) {
                countEl.textContent = this.state.probabilities.length;
            }

            // Update button states
            const addBtn = document.getElementById('btn-add-outcome');
            const removeBtn = document.getElementById('btn-remove-outcome');
            if (addBtn) {
                addBtn.disabled = this.state.probabilities.length >= MAX_OUTCOMES;
            }
            if (removeBtn) {
                removeBtn.disabled = this.state.probabilities.length <= MIN_OUTCOMES;
            }
        }

        _updatePresetSelect() {
            const presetSelect = document.getElementById('preset-select');
            if (presetSelect && this.state.currentPreset === 'custom') {
                presetSelect.value = 'custom';
            }
        }

        _updateMathBreakdown() {
            if (this.mathRenderer) {
                const breakdown = EntropyCalculator.getBreakdown(
                    this.state.probabilities,
                    this.state.labels
                );
                this.mathRenderer.render(breakdown, this.state.getEntropy());
            }
        }

        _updateSumIndicator() {
            const sumEl = document.getElementById('sum-indicator');
            if (sumEl) {
                const sum = this.state.getSum();
                const pct = (sum * 100).toFixed(1);
                sumEl.textContent = `Sum: ${pct}%`;

                // Visual feedback for valid/invalid sum
                const isValid = Math.abs(sum - 1) < 0.001;
                sumEl.classList.toggle('valid', isValid);
                sumEl.classList.toggle('invalid', !isValid);
            }
        }

        _updateEntropyBadge() {
            const badgeEl = document.getElementById('entropy-value');
            if (badgeEl) {
                const entropy = this.state.getEntropy();
                badgeEl.textContent = `H = ${entropy.toFixed(3)} bits`;
            }
        }

        // ============================================
        // Sampling Methods
        // ============================================

        _onSampleOnce() {
            const result = this.sampler.sampleOnce();
            this._updateSamplingDisplay(result);
        }

        _onSampleMany() {
            this.sampler.sampleMany(100);
            this._updateSamplingDisplay();
        }

        _onClearSamples() {
            this.sampler.clear();
            this._updateSamplingDisplay();
        }

        _updateSamplingDisplay(lastSample = null) {
            // Update last sample display
            const outcomeEl = document.getElementById('sample-outcome');
            const surpriseEl = document.getElementById('sample-surprise');

            if (lastSample && outcomeEl && surpriseEl) {
                outcomeEl.textContent = lastSample.label;
                outcomeEl.style.color = this.colors[lastSample.outcome % this.colors.length];
                surpriseEl.textContent = lastSample.surprise.toFixed(3);
            }

            // Update count and average
            const countEl = document.getElementById('sample-count');
            const avgEl = document.getElementById('avg-surprise');

            if (countEl) {
                countEl.textContent = this.sampler.getTotalSamples();
            }

            if (avgEl) {
                const avg = this.sampler.getAverageSurprise();
                avgEl.textContent = this.sampler.getTotalSamples() > 0
                    ? `${avg.toFixed(3)} bits`
                    : '-';
            }

            // Update histogram
            const histogramEl = document.getElementById('sample-histogram');
            if (histogramEl) {
                this.sampler.renderHistogram(histogramEl);
            }
        }

        // ============================================
        // Encoding Methods
        // ============================================

        _updateEncoding() {
            // Rebuild Huffman codes
            this.encoder.encode(this.state.probabilities, this.state.labels);

            // Pass codes to active renderer
            this.barChartRenderer.huffmanCodes = this.encoder.codes;
            this.ballBagRenderer.huffmanCodes = this.encoder.codes;

            // Update average code length display in footer
            const avgEl = document.getElementById('avg-code-length');
            if (avgEl) {
                const avgLen = this.encoder.getAverageCodeLength(this.state.probabilities);
                const entropy = this.state.getEntropy();
                avgEl.textContent = `${avgLen.toFixed(3)} bits (H = ${entropy.toFixed(3)})`;
            }
        }

        render() {
            const { ctx, dpr } = this;

            // Reset transform and clear canvas
            VizLib.resetCanvasTransform(ctx, dpr);
            const bgColor = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light');
            VizLib.clearCanvas(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, bgColor);

            // Update encoding before drawing (codes appear on bars/balls)
            this._updateEncoding();

            // Render active canvas renderer
            if (this.activeRenderer === 'ballBag') {
                this.ballBagRenderer.render();
            } else {
                this.barChartRenderer.render();
            }

            // Update UI elements
            this._updateEntropyBadge();
            this._updateSumIndicator();
            this._updateMathBreakdown();
        }
    }

    // ============================================
    // Initialize on DOM ready
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        const visualizer = new EntropyVisualizer();
        visualizer.init();
    });

})();

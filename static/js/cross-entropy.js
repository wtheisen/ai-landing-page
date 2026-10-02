/**
 * Cross-Entropy Loss Visualizer
 *
 * Interactive visualization showing how cross-entropy loss evolves during
 * neural network training. Features overlaid histograms comparing expected
 * and predicted distributions, with MNIST training animation.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const NUM_CLASSES = 10;
    const EPSILON = 1e-15;
    const CHART_PADDING = { top: 30, right: 70, bottom: 125, left: 95 };
    const ASPECT_RATIO = 0.55; // height / width - compressed

    // Data paths for different datasets
    const DATA_PATHS = {
        mnist: 'static/json/cross-entropy-training.json',
        cifar10: 'static/json/cross-entropy-cifar10.json',
        text: 'static/json/cross-entropy-text.json'
    };

    // Default class labels for each dataset
    const DEFAULT_CLASS_LABELS = {
        mnist: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        cifar10: ['airplane', 'automobile', 'bird', 'cat', 'deer', 'dog', 'frog', 'horse', 'ship', 'truck'],
        text: ['[PAD]', 'the', 'cat', 'sat', 'on', 'mat', 'dog', 'ran', 'a', '.']
    };

    // ============================================
    // CrossEntropyCalculator
    // ============================================
    class CrossEntropyCalculator {
        static calculate(expected, predicted) {
            let loss = 0;
            for (let i = 0; i < expected.length; i++) {
                if (expected[i] > 0) {
                    const p = Math.max(EPSILON, predicted[i]);
                    loss -= expected[i] * Math.log(p);
                }
            }
            return loss;
        }

        static calculateTerms(expected, predicted) {
            return expected.map((y, i) => {
                const p = Math.max(EPSILON, predicted[i]);
                return {
                    index: i,
                    expected: y,
                    predicted: p,
                    term: y > 0 ? -y * Math.log(p) : 0
                };
            });
        }

        static createOneHot(classIndex, numClasses = NUM_CLASSES) {
            const oneHot = new Array(numClasses).fill(0);
            oneHot[classIndex] = 1;
            return oneHot;
        }

    }

    // ============================================
    // TrainingDataManager
    // ============================================
    class TrainingDataManager {
        constructor() {
            this.data = null;
            this.loaded = false;
            this.currentDataset = 'mnist';
        }

        async loadData(dataset = null) {
            if (dataset) {
                this.currentDataset = dataset;
            }
            const dataPath = DATA_PATHS[this.currentDataset];
            try {
                const response = await fetch(dataPath);
                this.data = await response.json();
                this.loaded = true;
                return this.data;
            } catch (error) {
                console.error(`Failed to load training data for ${this.currentDataset}:`, error);
                throw error;
            }
        }

        async switchDataset(dataset) {
            if (dataset === this.currentDataset && this.loaded) {
                return this.data;
            }
            this.currentDataset = dataset;
            this.loaded = false;
            return this.loadData(dataset);
        }

        getCurrentDataset() {
            return this.currentDataset;
        }

        getMetadata() {
            return this.data?.metadata || null;
        }

        getSamples() {
            return this.data?.samples || [];
        }

        getSample(index) {
            return this.data?.samples?.[index] || null;
        }

        getSnapshot(sampleIndex, snapshotIndex) {
            const sample = this.getSample(sampleIndex);
            return sample?.snapshots?.[snapshotIndex] || null;
        }

        getSnapshotEpochs() {
            return this.data?.metadata?.snapshotEpochs || [];
        }

        getNumSnapshots() {
            return this.data?.metadata?.numSnapshots || 0;
        }
    }

    // ============================================
    // DistributionState
    // ============================================
    class DistributionState {
        constructor() {
            this.expected = CrossEntropyCalculator.createOneHot(0);
            this.predicted = new Array(NUM_CLASSES).fill(1 / NUM_CLASSES);
            this.mode = 'training'; // 'training' or 'manual'
            this.selectedSampleIndex = 0;
            this.currentSnapshotIndex = 0;
            this.trueLabel = 0;
        }

        setFromSnapshot(snapshot, trueLabel, expectedDistribution = null) {
            // Use soft labels if provided, otherwise fall back to one-hot
            if (expectedDistribution && Array.isArray(expectedDistribution)) {
                this.expected = [...expectedDistribution];
            } else {
                this.expected = CrossEntropyCalculator.createOneHot(trueLabel);
            }
            this.predicted = [...snapshot.predictions];
            this.trueLabel = trueLabel;
        }

        setExpectedOneHot(classIndex) {
            this.expected = CrossEntropyCalculator.createOneHot(classIndex);
            this.trueLabel = classIndex;
        }

        setPredicted(predictions) {
            this.predicted = VizLib.MathUtils.normalize([...predictions]);
        }

        setPredictedValue(index, value) {
            this.predicted[index] = Math.max(0, Math.min(1, value));
            // Normalize to sum to 1
            this.predicted = VizLib.MathUtils.normalize(this.predicted);
        }

        makeUniform() {
            this.predicted = new Array(NUM_CLASSES).fill(1 / NUM_CLASSES);
        }

        makeRandom() {
            this.predicted = VizLib.MathUtils.normalize(
                new Array(NUM_CLASSES).fill(0).map(() => Math.random())
            );
        }

        getLoss() {
            return CrossEntropyCalculator.calculate(this.expected, this.predicted);
        }

        getTerms() {
            return CrossEntropyCalculator.calculateTerms(this.expected, this.predicted);
        }
    }

    // ============================================
    // OverlaidHistogramRenderer
    // ============================================
    class OverlaidHistogramRenderer {
        constructor(ctx) {
            this.ctx = ctx;
            this.hoveredBar = -1;
            this.draggingBar = -1;
            this.barBounds = [];
            // Dynamic dimensions - set by setDimensions()
            this.canvasWidth = 480;
            this.canvasHeight = 380;
            this.isTextMode = false;
        }

        setDimensions(width, height) {
            this.canvasWidth = width;
            this.canvasHeight = height;
        }

        setTextMode(isText) {
            this.isTextMode = isText;
        }

        _getChartWidth() {
            return this.canvasWidth - CHART_PADDING.left - CHART_PADDING.right;
        }

        _getChartHeight() {
            return this.canvasHeight - CHART_PADDING.top - CHART_PADDING.bottom;
        }

        _getBarGroupWidth() {
            return this._getChartWidth() / NUM_CLASSES;
        }

        _getBarWidth() {
            return this._getBarGroupWidth() * 0.6;
        }

        render(expected, predicted, labels) {
            const { ctx } = this;
            this.barBounds = [];

            const chartHeight = this._getChartHeight();
            const barGroupWidth = this._getBarGroupWidth();
            const barWidth = this._getBarWidth();

            // Find argmax of predicted (highest probability bar)
            const argmaxIndex = predicted.indexOf(Math.max(...predicted));
            // Find the true class (index where expected is 1)
            const trueClass = expected.indexOf(Math.max(...expected));
            const isArgmaxCorrect = argmaxIndex === trueClass;

            // Draw axes (class labels)
            this._drawAxes(labels);

            // Draw bars - overlaid at the same X position
            for (let i = 0; i < NUM_CLASSES; i++) {
                const groupX = CHART_PADDING.left + i * barGroupWidth + barGroupWidth / 2;
                const barX = groupX - barWidth / 2;  // Centered in the group

                // Draw expected bar FIRST (outline underneath)
                const expHeight = expected[i] * chartHeight;
                const expY = CHART_PADDING.top + chartHeight - expHeight;
                this._drawExpectedBar(barX, expY, barWidth, expHeight, i);

                // Draw predicted bar SECOND (semi-transparent on top)
                const predHeight = predicted[i] * chartHeight;
                const predY = CHART_PADDING.top + chartHeight - predHeight;
                const isArgmax = i === argmaxIndex;
                this._drawPredictedBar(barX, predY, barWidth, predHeight, i, isArgmax, isArgmaxCorrect);

                // Store bounds for interaction (uses same centered position)
                this.barBounds.push({
                    x: barX,
                    y: CHART_PADDING.top,
                    width: barWidth,
                    height: chartHeight,
                    index: i
                });
            }

            // Draw tensor displays below the chart
            this._drawTensorDisplays(expected, predicted, trueClass);

            // Draw drag handle if hovering/dragging
            if (this.hoveredBar >= 0 || this.draggingBar >= 0) {
                const activeBar = this.draggingBar >= 0 ? this.draggingBar : this.hoveredBar;
                const bounds = this.barBounds[activeBar];
                if (bounds) {
                    const predHeight = predicted[activeBar] * chartHeight;
                    const handleY = CHART_PADDING.top + chartHeight - predHeight;
                    this._drawDragHandle(bounds.x + barWidth / 2, handleY);
                }
            }
        }

        _drawExpectedBar(x, y, width, height, index) {
            const { ctx } = this;
            const color = this._getExpectedColor();

            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 3]);

            if (height > 0) {
                ctx.strokeRect(x, y, width, height);
            }

            ctx.setLineDash([]);
        }

        _drawPredictedBar(x, y, width, height, index, isArgmax = false, isArgmaxCorrect = false) {
            const { ctx } = this;
            const isActive = index === this.hoveredBar || index === this.draggingBar;

            // Determine bar color
            let fillColor, borderColor;
            if (isActive) {
                fillColor = this._getHighlightColor();
                borderColor = this._getHighlightBorderColor();
            } else if (isArgmax) {
                // Argmax bar: green if correct, red if wrong
                fillColor = isArgmaxCorrect ? this._getCorrectColor() : this._getIncorrectColor();
                borderColor = isArgmaxCorrect ? this._getCorrectBorderColor() : this._getIncorrectBorderColor();
            } else {
                fillColor = this._getPredictedColor();
                borderColor = this._getPredictedColor();
            }

            // Fill
            ctx.fillStyle = fillColor;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x, y, width, height);
            ctx.globalAlpha = 1;

            // Border
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isActive || isArgmax ? 2 : 1;
            ctx.strokeRect(x, y, width, height);
        }

        _drawDragHandle(x, y) {
            const { ctx } = this;
            ctx.fillStyle = this._getHighlightBorderColor();
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = EAIColor('surface');
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        _drawAxes(labels) {
            const { ctx } = this;
            const textColor = this._getTextColor();
            const gridColor = this._getGridColor();
            const mutedColor = this._getMutedTextColor();
            const chartHeight = this._getChartHeight();
            const barGroupWidth = this._getBarGroupWidth();

            // Y-axis labels and grid
            ctx.font = '11px sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            for (let i = 0; i <= 4; i++) {
                const pct = i / 4;
                const y = CHART_PADDING.top + chartHeight * (1 - pct);

                // Label - show as 0-1 values
                ctx.fillText(pct.toFixed(2), CHART_PADDING.left - 8, y);

                // Grid line
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                ctx.setLineDash(pct === 0 ? [] : [3, 3]);
                ctx.beginPath();
                ctx.moveTo(CHART_PADDING.left, y);
                ctx.lineTo(this.canvasWidth - CHART_PADDING.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // X-axis labels - directly below bars
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            for (let i = 0; i < NUM_CLASSES; i++) {
                const x = CHART_PADDING.left + (i + 0.5) * barGroupWidth;

                if (this.isTextMode) {
                    // Text mode: show token ID on first line, word on second line
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillStyle = textColor;
                    ctx.fillText(String(i), x, CHART_PADDING.top + chartHeight + 8);

                    ctx.font = '9px sans-serif';
                    ctx.fillStyle = mutedColor;
                    ctx.fillText(labels[i] || '', x, CHART_PADDING.top + chartHeight + 22);
                } else {
                    // Image mode: just show the label
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillStyle = textColor;
                    ctx.fillText(labels[i] || String(i), x, CHART_PADDING.top + chartHeight + 12);
                }
            }
        }

        _drawTensorDisplays(expected, predicted, trueClass) {
            const { ctx } = this;
            const chartHeight = this._getChartHeight();
            const barGroupWidth = this._getBarGroupWidth();
            const textColor = this._getTextColor();
            const mutedColor = this._getMutedTextColor();

            const classLabelY = CHART_PADDING.top + chartHeight + 12;
            const tensorStartY = CHART_PADDING.top + chartHeight + 30;
            const rowHeight = 18;

            // Draw "class" label for the index row
            ctx.font = '11px monospace';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('class', CHART_PADDING.left - 4, classLabelY);

            // Draw "predicted" tensor
            ctx.font = '11px monospace';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('predicted (ŷ)', CHART_PADDING.left - 4, tensorStartY);

            // Draw bracket and values for predicted
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.font = '10px monospace';

            // Left bracket
            ctx.textAlign = 'left';
            ctx.fillText('[', CHART_PADDING.left - 2, tensorStartY);

            // Values
            ctx.textAlign = 'center';
            const argmax = predicted.indexOf(Math.max(...predicted));
            const isCorrect = argmax === trueClass;
            for (let i = 0; i < NUM_CLASSES; i++) {
                const x = CHART_PADDING.left + (i + 0.5) * barGroupWidth;
                // Highlight argmax green if correct, red if wrong
                if (i === argmax) {
                    ctx.fillStyle = isCorrect ? this._getCorrectColor() : this._getIncorrectColor();
                    ctx.font = 'bold 10px monospace';
                } else {
                    ctx.fillStyle = textColor;
                    ctx.font = '10px monospace';
                }
                ctx.fillText(predicted[i].toFixed(2), x, tensorStartY);
            }

            // Right bracket
            ctx.textAlign = 'right';
            ctx.fillText(']', this.canvasWidth - CHART_PADDING.right + 2, tensorStartY);

            // Draw "expected" tensor
            const expectedY = tensorStartY + rowHeight;

            ctx.font = '11px monospace';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.fillText('expected (y)', CHART_PADDING.left - 4, expectedY);

            // Draw bracket and values for expected (one-hot)
            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';

            // Left bracket
            ctx.textAlign = 'left';
            ctx.fillText('[', CHART_PADDING.left - 2, expectedY);

            // Values (one-hot encoding)
            ctx.textAlign = 'center';
            for (let i = 0; i < NUM_CLASSES; i++) {
                const x = CHART_PADDING.left + (i + 0.5) * barGroupWidth;
                const val = expected[i];
                // Highlight the true class
                if (val === 1) {
                    ctx.fillStyle = this._getExpectedColor();
                    ctx.font = 'bold 10px monospace';
                } else {
                    ctx.fillStyle = textColor;
                    ctx.font = '10px monospace';
                }
                ctx.fillText(val.toFixed(2), x, expectedY);
            }

            // Right bracket
            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(']', this.canvasWidth - CHART_PADDING.right + 2, expectedY);

            // Draw "-y·log(p)" loss terms row
            const lossY = expectedY + rowHeight;

            ctx.font = '11px monospace';
            ctx.fillStyle = mutedColor;
            ctx.textAlign = 'right';
            ctx.fillText('-y·log(ŷ)', CHART_PADDING.left - 4, lossY);

            // Calculate and draw loss terms
            let totalLoss = 0;
            const lossTerms = [];
            for (let i = 0; i < NUM_CLASSES; i++) {
                const p = Math.max(EPSILON, predicted[i]);
                const term = expected[i] > 0 ? -expected[i] * Math.log(p) : 0;
                lossTerms.push(term);
                totalLoss += term;
            }

            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';

            // Left bracket
            ctx.textAlign = 'left';
            ctx.fillText('[', CHART_PADDING.left - 2, lossY);

            // Values with + signs between them
            ctx.textAlign = 'center';
            for (let i = 0; i < NUM_CLASSES; i++) {
                const x = CHART_PADDING.left + (i + 0.5) * barGroupWidth;
                const term = lossTerms[i];
                // Highlight non-zero terms (the true class contribution)
                if (term > 0) {
                    ctx.fillStyle = this._getHighlightBorderColor();
                    ctx.font = 'bold 10px monospace';
                } else {
                    ctx.fillStyle = textColor;
                    ctx.font = '10px monospace';
                }
                ctx.fillText(term.toFixed(2), x, lossY);

                // Add + sign after each value except the last
                if (i < NUM_CLASSES - 1) {
                    ctx.fillStyle = mutedColor;
                    ctx.font = '10px monospace';
                    const plusX = CHART_PADDING.left + (i + 1) * barGroupWidth;
                    ctx.fillText('+', plusX, lossY);
                }
            }

            // Right bracket and sum
            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(']', this.canvasWidth - CHART_PADDING.right, lossY);

            // Draw summation result
            ctx.fillStyle = this._getHighlightBorderColor();
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(` = ${totalLoss.toFixed(3)}`, this.canvasWidth - CHART_PADDING.right + 2, lossY);
        }

        _getMutedTextColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('muted', 'dark') : EAIColor('axis', 'light');
        }

        getBarAtPosition(x, y) {
            for (const bounds of this.barBounds) {
                if (x >= bounds.x && x <= bounds.x + bounds.width &&
                    y >= bounds.y && y <= bounds.y + bounds.height) {
                    return bounds.index;
                }
            }
            return -1;
        }

        getProbabilityFromY(y) {
            const chartHeight = this._getChartHeight();
            const chartBottom = CHART_PADDING.top + chartHeight;
            const p = (chartBottom - y) / chartHeight;
            return Math.max(0, Math.min(1, p));
        }

        _getTextColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
        }

        _getGridColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('muted', 0.3, 'dark') : 'rgba(0, 0, 0, 0.1)';
        }

        _getExpectedColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('green', 'dark') : EAIColor('green', 'light');
        }

        _getPredictedColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('blue', 'dark') : EAIColor('blue', 'light');
        }

        _getHighlightColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('gold', 'dark') : EAIColor('gold', 'light');
        }

        _getHighlightBorderColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('gold-text', 'dark') : EAIColor('gold-strong', 'light');
        }

        _getCorrectColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('green-mid', 'dark') : EAIColor('green', 'light');
        }

        _getCorrectBorderColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('green', 'dark') : EAIColor('green', 'light');
        }

        _getIncorrectColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('red-mid', 'dark') : EAIColor('red-mid', 'light');
        }

        _getIncorrectBorderColor() {
            return document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('red', 'dark') : EAIColor('red', 'light');
        }
    }

    // ============================================
    // SampleGalleryRenderer
    // ============================================
    class SampleGalleryRenderer {
        constructor(container) {
            this.container = container;
            this.onSampleClick = null;
            this.classLabels = null;
            this.isTextMode = false;
        }

        setClassLabels(labels) {
            this.classLabels = labels;
        }

        setTextMode(isText) {
            this.isTextMode = isText;
        }

        render(samples, selectedIndex) {
            this.container.innerHTML = '';

            samples.forEach((sample, index) => {
                const item = document.createElement('div');
                item.className = 'gallery-item' + (index === selectedIndex ? ' selected' : '');
                item.dataset.index = index;

                // Check if this is a text sample (has context property) or image sample
                if (sample.context !== undefined) {
                    // Text mode - show context with token IDs
                    item.classList.add('gallery-item-text');

                    // Show the words
                    const textEl = document.createElement('div');
                    textEl.className = 'gallery-text';
                    textEl.textContent = sample.context || '[START]';
                    item.appendChild(textEl);

                    // Show the token IDs below
                    if (sample.contextTokens) {
                        const tokensEl = document.createElement('div');
                        tokensEl.className = 'gallery-tokens';
                        tokensEl.textContent = '[' + sample.contextTokens.join(', ') + ']';
                        item.appendChild(tokensEl);
                    }

                    // Show the target token ID and word
                    const label = document.createElement('span');
                    label.className = 'gallery-label';
                    const labelWord = this.classLabels ? this.classLabels[sample.trueLabel] : '';
                    label.textContent = `→ ${sample.trueLabel}`;
                    label.title = `Next token: ${sample.trueLabel} = "${labelWord}"`;
                    item.appendChild(label);
                } else {
                    // Image mode - existing code
                    const img = document.createElement('img');
                    img.src = sample.imageBase64;
                    const labelText = this.classLabels ? this.classLabels[sample.trueLabel] : sample.trueLabel;
                    img.alt = `${labelText}`;
                    img.className = 'gallery-image';

                    const label = document.createElement('span');
                    label.className = 'gallery-label';
                    // Show index for CIFAR-10 (labels too long), full label for MNIST
                    label.textContent = sample.trueLabel;
                    label.title = labelText; // Full label in tooltip

                    item.appendChild(img);
                    item.appendChild(label);
                }

                item.addEventListener('click', () => {
                    if (this.onSampleClick) {
                        this.onSampleClick(index);
                    }
                });

                this.container.appendChild(item);
            });
        }

        setSelected(index) {
            const items = this.container.querySelectorAll('.gallery-item');
            items.forEach((item, i) => {
                item.classList.toggle('selected', i === index);
            });
        }
    }

    // ============================================
    // CrossEntropyVisualizer (Main Controller)
    // ============================================
    class CrossEntropyVisualizer {
        constructor() {
            this.canvas = null;
            this.ctx = null;
            this.dpr = 1;
            this.canvasWidth = 480;
            this.canvasHeight = 380;

            this.dataManager = new TrainingDataManager();
            this.state = new DistributionState();
            this.histogramRenderer = null;
            this.galleryRenderer = null;
            this.timeline = new VizLib.PlaybackController({
                initialSpeed: 1000,
                getDelayFn: (speed) => speed, // speed is delay in ms
                onPlayStateChange: (isPlaying) => {
                    const icon = document.getElementById('play-icon');
                    if (icon) icon.className = isPlaying ? 'fa fa-pause' : 'fa fa-play';
                },
            });

            this.isDragging = false;
            this.dragBarIndex = -1;
            this._resizeTimeout = null;
        }

        _sizeCanvas() {
            const container = this.canvas.parentElement;
            const containerWidth = container.clientWidth;

            // Set canvas size to fill container width, maintain aspect ratio
            this.canvasWidth = containerWidth;
            this.canvasHeight = Math.round(containerWidth * ASPECT_RATIO);

            // Set canvas element size
            this.canvas.width = this.canvasWidth;
            this.canvas.height = this.canvasHeight;

            // Setup HiDPI
            const result = VizLib.setupHiDPICanvas(this.canvas, this.canvasWidth, this.canvasHeight);
            this.ctx = result.ctx;
            this.dpr = result.dpr;
        }

        _onResize() {
            // Debounce resize
            if (this._resizeTimeout) {
                clearTimeout(this._resizeTimeout);
            }
            this._resizeTimeout = setTimeout(() => {
                this._sizeCanvas();
                if (this.histogramRenderer) {
                    this.histogramRenderer.setDimensions(this.canvasWidth, this.canvasHeight);
                }
                this.render();
            }, 100);
        }

        async init() {
            // Show loading overlay
            const loadingOverlay = document.getElementById('loading-overlay');

            try {
                // Load data
                await this.dataManager.loadData();

                // Wait for VizLib
                if (window.VizLib) {
                    this._setup();
                } else {
                    window.addEventListener('vizlib-ready', () => this._setup());
                }
            } catch (error) {
                console.error('Initialization failed:', error);
                if (loadingOverlay) {
                    loadingOverlay.innerHTML = '<div class="loading-content"><i class="fa fa-exclamation-triangle fa-3x"></i><p>Failed to load training data</p></div>';
                }
            }
        }

        _setup() {
            // Hide loading overlay
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }

            // Setup canvas
            this.canvas = document.getElementById('histogram-canvas');
            if (!this.canvas) {
                console.error('Canvas not found');
                return;
            }

            // Size canvas to fill container
            this._sizeCanvas();

            // Initialize renderers
            this.histogramRenderer = new OverlaidHistogramRenderer(this.ctx);
            this.histogramRenderer.setDimensions(this.canvasWidth, this.canvasHeight);

            // Handle window resize
            window.addEventListener('resize', () => this._onResize());

            const galleryContainer = document.getElementById('sample-gallery');
            if (galleryContainer) {
                this.galleryRenderer = new SampleGalleryRenderer(galleryContainer);
                this.galleryRenderer.onSampleClick = (index) => this._onSampleSelect(index);
            }

            // Setup timeline
            const metadata = this.dataManager.getMetadata();
            if (metadata) {
                this.timeline.load(metadata.snapshotEpochs);
                this.timeline.onStepChange = (index) => {
                    if (index >= 0) this._onTimelineChange(index);
                };

                // Update total epochs display
                const totalEpochsEl = document.getElementById('total-epochs');
                if (totalEpochsEl) {
                    totalEpochsEl.textContent = metadata.totalEpochs;
                }
            }

            // Initialize state with first sample
            this._loadSampleAtSnapshot(0, 0);

            // Render gallery
            if (this.galleryRenderer) {
                const metadata = this.dataManager.getMetadata();
                this.galleryRenderer.setClassLabels(metadata?.classLabels);
                this.galleryRenderer.render(this.dataManager.getSamples(), 0);
            }

            // Setup epoch markers
            this._setupEpochMarkers();

            // Setup manual mode class selector
            this._setupClassSelector();

            // Bind events
            this._bindEvents();

            // Initial render
            this.render();
        }

        _setupEpochMarkers() {
            const container = document.getElementById('epoch-markers');
            if (!container) return;

            const epochs = this.dataManager.getSnapshotEpochs();
            container.innerHTML = '';

            epochs.forEach((epoch, index) => {
                const marker = document.createElement('span');
                marker.className = 'epoch-marker';
                marker.textContent = epoch;
                marker.style.left = `${(index / (epochs.length - 1)) * 100}%`;
                container.appendChild(marker);
            });
        }

        _setupClassSelector() {
            const container = document.getElementById('expected-class-selector');
            if (!container) return;

            const dataset = this.dataManager.getCurrentDataset();
            const labels = this.dataManager.getMetadata()?.classLabels ||
                           DEFAULT_CLASS_LABELS[dataset] ||
                           Array.from({length: NUM_CLASSES}, (_, i) => String(i));

            container.innerHTML = '';
            for (let i = 0; i < NUM_CLASSES; i++) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-xs btn-default class-btn' + (i === 0 ? ' active' : '');
                // For CIFAR-10, use shorter labels or indices for space
                btn.textContent = dataset === 'cifar10' ? i : labels[i];
                btn.title = labels[i]; // Full label in tooltip
                btn.dataset.class = i;
                btn.addEventListener('click', () => this._onExpectedClassChange(i));
                container.appendChild(btn);
            }
        }

        _loadSampleAtSnapshot(sampleIndex, snapshotIndex) {
            const sample = this.dataManager.getSample(sampleIndex);
            const snapshot = this.dataManager.getSnapshot(sampleIndex, snapshotIndex);

            if (sample && snapshot) {
                this.state.selectedSampleIndex = sampleIndex;
                this.state.currentSnapshotIndex = snapshotIndex;
                // Pass expectedDistribution for soft labels (text mode)
                this.state.setFromSnapshot(snapshot, sample.trueLabel, sample.expectedDistribution);

                // Update UI
                const selectedLabel = document.getElementById('selected-label');
                const trueLabel = document.getElementById('true-label');
                if (selectedLabel) selectedLabel.textContent = sampleIndex;
                if (trueLabel) trueLabel.textContent = sample.trueLabel;
            }
        }

        _bindEvents() {
            // Canvas events
            this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
            this.canvas.addEventListener('mouseup', () => this._onMouseUp());
            this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());

            // Touch events
            this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e));
            this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e));
            this.canvas.addEventListener('touchend', () => this._onMouseUp());

            // Mode toggle (MNIST / CIFAR-10 / Text / Manual)
            const btnMnist = document.getElementById('btn-mode-mnist');
            const btnCifar = document.getElementById('btn-mode-cifar10');
            const btnText = document.getElementById('btn-mode-text');
            const btnManual = document.getElementById('btn-mode-manual');
            if (btnMnist) btnMnist.addEventListener('click', () => this._setModeAndDataset('training', 'mnist'));
            if (btnCifar) btnCifar.addEventListener('click', () => this._setModeAndDataset('training', 'cifar10'));
            if (btnText) btnText.addEventListener('click', () => this._setModeAndDataset('training', 'text'));
            if (btnManual) btnManual.addEventListener('click', () => this._setModeAndDataset('manual', null));

            // Timeline controls
            const btnPlay = document.getElementById('btn-play');
            const btnReset = document.getElementById('btn-reset-timeline');
            const btnStep = document.getElementById('btn-step');
            const epochSlider = document.getElementById('epoch-slider');
            const speedSelect = document.getElementById('playback-speed');

            if (btnPlay) btnPlay.addEventListener('click', () => this._onPlayToggle());
            if (btnReset) btnReset.addEventListener('click', () => { this.timeline.pause(); this.timeline.goToStep(0); });
            if (btnStep) btnStep.addEventListener('click', () => this.timeline.stepForward());
            if (epochSlider) {
                epochSlider.max = this.dataManager.getNumSnapshots() - 1;
                epochSlider.addEventListener('input', (e) => {
                    this.timeline.goToStep(parseInt(e.target.value));
                });
            }
            if (speedSelect) {
                speedSelect.addEventListener('change', (e) => {
                    this.timeline.setSpeed(parseInt(e.target.value));
                });
            }

            // Manual mode controls
            const btnUniform = document.getElementById('btn-uniform');
            const btnRandom = document.getElementById('btn-random');
            if (btnUniform) btnUniform.addEventListener('click', () => {
                this.state.makeUniform();
                this.render();
            });
            if (btnRandom) btnRandom.addEventListener('click', () => {
                this.state.makeRandom();
                this.render();
            });

            // Theme change
            document.addEventListener('themechange', () => this.render());
        }

        _setMode(mode) {
            this.state.mode = mode;

            // Show/hide panels - training controls panel vs manual panel
            const trainingControlsPanel = document.getElementById('training-controls-panel');
            const manualPanel = document.getElementById('manual-panel');

            if (trainingControlsPanel) trainingControlsPanel.style.display = mode === 'training' ? 'block' : 'none';
            if (manualPanel) manualPanel.style.display = mode === 'manual' ? 'block' : 'none';

            // In manual mode, stop playback
            if (mode === 'manual') {
                this.timeline.pause();
            }

            this.render();
        }

        async _setModeAndDataset(mode, dataset) {
            // Update button states
            const btnMnist = document.getElementById('btn-mode-mnist');
            const btnCifar = document.getElementById('btn-mode-cifar10');
            const btnText = document.getElementById('btn-mode-text');
            const btnManual = document.getElementById('btn-mode-manual');

            if (btnMnist) btnMnist.classList.toggle('active', mode === 'training' && dataset === 'mnist');
            if (btnCifar) btnCifar.classList.toggle('active', mode === 'training' && dataset === 'cifar10');
            if (btnText) btnText.classList.toggle('active', mode === 'training' && dataset === 'text');
            if (btnManual) btnManual.classList.toggle('active', mode === 'manual');

            // If switching to a dataset mode, load that dataset
            if (mode === 'training' && dataset) {
                await this._switchDataset(dataset);
            }

            // Set the mode (shows/hides appropriate panels)
            this._setMode(mode);
        }

        async _switchDataset(dataset) {
            if (dataset === this.dataManager.getCurrentDataset()) {
                return;
            }

            // Show loading state
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.innerHTML = '<div class="loading-content"><i class="fa fa-spinner fa-spin fa-3x"></i><p>Loading training data...</p></div>';
                loadingOverlay.style.display = 'flex';
            }

            // Pause playback
            this.timeline.pause();

            try {
                // Load new dataset
                await this.dataManager.switchDataset(dataset);

                // Update UI state
                this._updateDatasetUI(dataset);

                // Set text mode flag for renderers
                const isTextMode = dataset === 'text';
                if (this.histogramRenderer) {
                    this.histogramRenderer.setTextMode(isTextMode);
                }
                if (this.galleryRenderer) {
                    this.galleryRenderer.setTextMode(isTextMode);
                }

                // Reset timeline
                const metadata = this.dataManager.getMetadata();
                if (metadata) {
                    this.timeline.load(metadata.snapshotEpochs);
                    this.timeline.goToStep(0);
                }

                // Update sample gallery
                if (this.galleryRenderer) {
                    this.galleryRenderer.setClassLabels(metadata?.classLabels);
                    this.galleryRenderer.render(this.dataManager.getSamples(), 0);
                }

                // Reset to first sample at first snapshot
                this.state.selectedSampleIndex = 0;
                this.state.currentSnapshotIndex = 0;
                this._loadSampleAtSnapshot(0, 0);

                // Update class selector for manual mode
                this._setupClassSelector();

                // Render
                this.render();
            } catch (error) {
                console.error('Failed to switch dataset:', error);
                // Show error
                if (loadingOverlay) {
                    loadingOverlay.innerHTML = '<div class="loading-content"><i class="fa fa-exclamation-triangle fa-3x"></i><p>Failed to load dataset</p></div>';
                }
                return;
            }

            // Hide loading overlay
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }

        _updateDatasetUI(dataset) {
            // Update toggle buttons
            const btnMnist = document.getElementById('btn-mode-mnist');
            const btnCifar = document.getElementById('btn-mode-cifar10');
            const btnText = document.getElementById('btn-mode-text');
            const btnManual = document.getElementById('btn-mode-manual');
            if (btnMnist) btnMnist.classList.toggle('active', dataset === 'mnist');
            if (btnCifar) btnCifar.classList.toggle('active', dataset === 'cifar10');
            if (btnText) btnText.classList.toggle('active', dataset === 'text');
            if (btnManual) btnManual.classList.remove('active');

            // Update section title
            const sampleTitle = document.getElementById('samples-section-title');
            if (sampleTitle) {
                const titles = {
                    mnist: 'MNIST Samples',
                    cifar10: 'CIFAR-10 Samples',
                    text: 'Text Contexts'
                };
                sampleTitle.textContent = titles[dataset] || 'Samples';
            }
        }

        _onSampleSelect(index) {
            this.state.selectedSampleIndex = index;
            this._loadSampleAtSnapshot(index, this.state.currentSnapshotIndex);
            if (this.galleryRenderer) {
                this.galleryRenderer.setSelected(index);
            }
            this.render();
        }

        _onTimelineChange(snapshotIndex) {
            this._loadSampleAtSnapshot(this.state.selectedSampleIndex, snapshotIndex);

            // Update slider
            const slider = document.getElementById('epoch-slider');
            if (slider) slider.value = snapshotIndex;

            // Update epoch display
            const epochDisplay = document.getElementById('current-epoch');
            if (epochDisplay) epochDisplay.textContent = this.timeline.getCurrentStep() || 0;

            this.render();
        }

        _onPlayToggle() {
            this.timeline.toggle();
        }

        _onExpectedClassChange(classIndex) {
            this.state.setExpectedOneHot(classIndex);

            // Update button states
            const buttons = document.querySelectorAll('#expected-class-selector .class-btn');
            buttons.forEach((btn, i) => {
                btn.classList.toggle('active', i === classIndex);
            });

            this.render();
        }

        _getMousePos(e) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (this.canvasWidth / rect.width),
                y: (e.clientY - rect.top) * (this.canvasHeight / rect.height)
            };
        }

        _getTouchPos(e) {
            const touch = e.touches[0];
            return this._getMousePos(touch);
        }

        _onMouseDown(e) {
            if (this.state.mode !== 'manual') return;

            const pos = this._getMousePos(e);
            const barIndex = this.histogramRenderer.getBarAtPosition(pos.x, pos.y);

            if (barIndex >= 0) {
                this.isDragging = true;
                this.dragBarIndex = barIndex;
                this.histogramRenderer.draggingBar = barIndex;
                this.canvas.style.cursor = 'ns-resize';
                this.render();
            }
        }

        _onMouseMove(e) {
            const pos = this._getMousePos(e);

            if (this.isDragging && this.dragBarIndex >= 0) {
                const newP = this.histogramRenderer.getProbabilityFromY(pos.y);
                this.state.setPredictedValue(this.dragBarIndex, newP);
                this.render();
            } else if (this.state.mode === 'manual') {
                const barIndex = this.histogramRenderer.getBarAtPosition(pos.x, pos.y);
                if (barIndex !== this.histogramRenderer.hoveredBar) {
                    this.histogramRenderer.hoveredBar = barIndex;
                    this.canvas.style.cursor = barIndex >= 0 ? 'ns-resize' : 'default';
                    this.render();
                }
            }
        }

        _onMouseUp() {
            if (this.isDragging) {
                this.isDragging = false;
                this.dragBarIndex = -1;
                this.histogramRenderer.draggingBar = -1;
                this.canvas.style.cursor = 'default';
                this.render();
            }
        }

        _onMouseLeave() {
            this.histogramRenderer.hoveredBar = -1;
            this._onMouseUp();
        }

        _onTouchStart(e) {
            if (this.state.mode !== 'manual') return;
            e.preventDefault();
            const pos = this._getTouchPos(e);
            const barIndex = this.histogramRenderer.getBarAtPosition(pos.x, pos.y);

            if (barIndex >= 0) {
                this.isDragging = true;
                this.dragBarIndex = barIndex;
                this.histogramRenderer.draggingBar = barIndex;
                this.render();
            }
        }

        _onTouchMove(e) {
            if (!this.isDragging || this.dragBarIndex < 0) return;
            e.preventDefault();
            const pos = this._getTouchPos(e);
            const newP = this.histogramRenderer.getProbabilityFromY(pos.y);
            this.state.setPredictedValue(this.dragBarIndex, newP);
            this.render();
        }

        _updateLossDisplay() {
            const loss = this.state.getLoss();

            // Update badge
            const badge = document.getElementById('loss-value');
            if (badge) {
                badge.textContent = `L = ${loss.toFixed(3)}`;
                badge.classList.remove('low-loss', 'medium-loss', 'high-loss');
                if (loss < 0.5) badge.classList.add('low-loss');
                else if (loss < 2) badge.classList.add('medium-loss');
                else badge.classList.add('high-loss');
            }

            // Update predicted label
            const predictedLabel = document.getElementById('predicted-label');
            if (predictedLabel) {
                const argmax = this.state.predicted.indexOf(Math.max(...this.state.predicted));
                predictedLabel.textContent = argmax;
            }

            // Update breakdown
            this._updateLossBreakdown();
        }

        _updateLossBreakdown() {
            const container = document.getElementById('loss-breakdown');
            if (!container) return;

            const terms = this.state.getTerms();
            const trueClass = this.state.trueLabel;

            let html = '<table class="viz-breakdown-table breakdown-mini-table">';
            html += '<tr><th>Class</th><th>y</th><th>p</th><th>-y&middot;log(p)</th></tr>';

            terms.forEach(t => {
                const isTrue = t.index === trueClass;
                const rowClass = isTrue ? 'true-class' : '';
                html += `<tr class="${rowClass}">`;
                html += `<td>${t.index}${isTrue ? ' <i class="fa fa-star"></i>' : ''}</td>`;
                html += `<td>${t.expected.toFixed(0)}</td>`;
                html += `<td>${t.predicted.toFixed(4)}</td>`;
                html += `<td>${t.term.toFixed(4)}</td>`;
                html += '</tr>';
            });

            const totalLoss = this.state.getLoss();
            html += `<tr class="total-row"><td colspan="3"><strong>Total</strong></td><td><strong>${totalLoss.toFixed(4)}</strong></td></tr>`;
            html += '</table>';

            container.innerHTML = html;
        }

        render() {
            const { ctx, dpr } = this;

            VizLib.resetCanvasTransform(ctx, dpr);
            const bgColor = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark'
                ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light');
            VizLib.clearCanvas(ctx, this.canvasWidth, this.canvasHeight, bgColor);

            const labels = this.dataManager.getMetadata()?.classLabels ||
                           Array.from({length: NUM_CLASSES}, (_, i) => String(i));

            this.histogramRenderer.render(
                this.state.expected,
                this.state.predicted,
                labels
            );

            this._updateLossDisplay();
        }
    }

    // ============================================
    // Initialize
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        const visualizer = new CrossEntropyVisualizer();
        visualizer.init();
    });

})();

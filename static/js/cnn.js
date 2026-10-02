/**
 * CNN (Convolutional Neural Network) Visualizer
 *
 * Interactive visualization of convolution operations: filter sliding over
 * grayscale input images, feature map generation, editable kernels,
 * stride/padding controls, and max/average pooling demonstrations.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const INPUT_SIZE = 8;         // 8x8 input grid
    const CANVAS_SIZE = 280;      // logical canvas pixels
    const POOL_CANVAS_SIZE = 140; // pooling canvas pixels
    const POOL_WINDOW = 2;        // 2x2 pooling

    // ============================================
    // Filter Presets
    // ============================================
    const PRESETS_3x3 = {
        'identity':  [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
        'edge-h':    [[-1,-1,-1], [0, 0, 0], [1, 1, 1]],
        'edge-v':    [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]],
        'sharpen':   [[0,-1, 0], [-1, 5,-1], [0,-1, 0]],
        'blur':      [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
        'emboss':    [[-2,-1, 0], [-1, 1, 1], [0, 1, 2]]
    };

    const PRESETS_5x5 = {
        'identity':  [[0,0,0,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,0,0,0]],
        'edge-h':    [[-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1],[0,0,0,0,0],[1,1,1,1,1],[1,1,1,1,1]],
        'edge-v':    [[-1,-1,0,1,1],[-1,-1,0,1,1],[-1,-1,0,1,1],[-1,-1,0,1,1],[-1,-1,0,1,1]],
        'sharpen':   [[0,0,-1,0,0],[0,-1,-2,-1,0],[-1,-2,17,-2,-1],[0,-1,-2,-1,0],[0,0,-1,0,0]],
        'blur':      [[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1]],
        'emboss':    [[-2,-2,-1,0,0],[-2,-1,0,1,0],[-1,0,1,1,1],[0,0,1,2,1],[0,0,1,1,2]]
    };

    // ============================================
    // Input Image Generators
    // ============================================
    function generateImage(type, size) {
        const img = [];
        for (let r = 0; r < size; r++) {
            img[r] = [];
            for (let c = 0; c < size; c++) {
                let v = 0;
                switch (type) {
                    case 'checkerboard':
                        v = ((r + c) % 2 === 0) ? 220 : 40;
                        break;
                    case 'diagonal':
                        v = (r === c || r === c + 1 || r === c - 1) ? 255 : 30;
                        break;
                    case 'cross':
                        v = (r === Math.floor(size / 2) || c === Math.floor(size / 2)) ? 240 : 20;
                        break;
                    case 'random':
                        v = Math.floor(Math.random() * 256);
                        break;
                    case 'gradient':
                        v = Math.round((c / (size - 1)) * 255);
                        break;
                    default:
                        v = 128;
                }
                img[r][c] = v;
            }
        }
        return img;
    }

    // ============================================
    // Convolution Engine
    // ============================================
    function computeOutputSize(inputSize, kernelSize, stride, padding) {
        const padAmount = (padding === 'same') ? Math.floor(kernelSize / 2) : 0;
        return Math.floor((inputSize - kernelSize + 2 * padAmount) / stride) + 1;
    }

    function padImage(image, padAmount) {
        if (padAmount === 0) return image;
        const h = image.length;
        const w = image[0].length;
        const newH = h + 2 * padAmount;
        const newW = w + 2 * padAmount;
        const padded = [];
        for (let r = 0; r < newH; r++) {
            padded[r] = [];
            for (let c = 0; c < newW; c++) {
                const sr = r - padAmount;
                const sc = c - padAmount;
                if (sr >= 0 && sr < h && sc >= 0 && sc < w) {
                    padded[r][c] = image[sr][sc];
                } else {
                    padded[r][c] = 0;
                }
            }
        }
        return padded;
    }

    function convolve(image, kernel, stride, padding) {
        const kSize = kernel.length;
        const padAmount = (padding === 'same') ? Math.floor(kSize / 2) : 0;
        const paddedImg = padImage(image, padAmount);
        const outSize = computeOutputSize(image.length, kSize, stride, padding);
        const output = [];

        for (let i = 0; i < outSize; i++) {
            output[i] = [];
            for (let j = 0; j < outSize; j++) {
                let sum = 0;
                for (let m = 0; m < kSize; m++) {
                    for (let n = 0; n < kSize; n++) {
                        sum += paddedImg[i * stride + m][j * stride + n] * kernel[m][n];
                    }
                }
                output[i][j] = sum;
            }
        }
        return output;
    }

    function computeConvolutionAtPosition(paddedImg, kernel, stride, outRow, outCol) {
        const kSize = kernel.length;
        let sum = 0;
        const terms = [];
        for (let m = 0; m < kSize; m++) {
            for (let n = 0; n < kSize; n++) {
                const iv = paddedImg[outRow * stride + m][outCol * stride + n];
                const kv = kernel[m][n];
                terms.push({ inputVal: iv, kernelVal: kv, product: iv * kv });
                sum += iv * kv;
            }
        }
        return { sum, terms };
    }

    // ============================================
    // Pooling
    // ============================================
    function maxPool(featureMap, poolSize) {
        const inSize = featureMap.length;
        const outSize = Math.floor(inSize / poolSize);
        const result = [];
        for (let i = 0; i < outSize; i++) {
            result[i] = [];
            for (let j = 0; j < outSize; j++) {
                let maxVal = -Infinity;
                for (let m = 0; m < poolSize; m++) {
                    for (let n = 0; n < poolSize; n++) {
                        const val = featureMap[i * poolSize + m][j * poolSize + n];
                        if (val > maxVal) maxVal = val;
                    }
                }
                result[i][j] = maxVal;
            }
        }
        return result;
    }

    function avgPool(featureMap, poolSize) {
        const inSize = featureMap.length;
        const outSize = Math.floor(inSize / poolSize);
        const result = [];
        for (let i = 0; i < outSize; i++) {
            result[i] = [];
            for (let j = 0; j < outSize; j++) {
                let sum = 0;
                for (let m = 0; m < poolSize; m++) {
                    for (let n = 0; n < poolSize; n++) {
                        sum += featureMap[i * poolSize + m][j * poolSize + n];
                    }
                }
                result[i][j] = sum / (poolSize * poolSize);
            }
        }
        return result;
    }

    // ============================================
    // Color Helpers
    // ============================================
    function getColors() {
        const isDark = VizLib.ThemeManager.isDarkTheme();
        return {
            bg:              isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            cellBorder:      isDark ? EAIColor('grid', 'dark') : EAIColor('axis', 'light'),
            text:            isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            textMuted:       isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light'),
            highlight:       isDark ? EAIColor('gold-strong', 0.45, 'dark') : EAIColor('gold', 0.45),
            highlightBorder: isDark ? EAIColor('gold-strong', 'dark') : EAIColor('gold-strong', 'light'),
            positiveMax:     isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            negativeMax:     isDark ? EAIColor('red', 'dark') : EAIColor('red', 'light'),
            zeroColor:       isDark ? EAIColor('surface', 'dark') : EAIColor('surface', 'light'),
            poolMax:         isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            poolAvg:         isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light')
        };
    }

    /**
     * Map a grayscale value (0-255) to a fill color
     */
    function grayscaleColor(value, isDark) {
        const v = Math.max(0, Math.min(255, Math.round(value)));
        if (isDark) {
            // In dark theme, map 0->dark bg, 255->light fg
            const lo = 29;  // #1d2021 approx
            const hi = 235; // #ebdbb2 approx
            const mapped = lo + (v / 255) * (hi - lo);
            const m = Math.round(mapped);
            return `rgb(${m},${m},${m})`;
        }
        return `rgb(${v},${v},${v})`;
    }

    /**
     * Diverging color for feature map values: negative=red, zero=white/bg, positive=blue
     */
    function divergingColor(value, minVal, maxVal, colors) {
        const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 1);
        const t = value / absMax; // -1 to 1

        // Parse hex colors
        function hexToRGB(hex) {
            return {
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16)
            };
        }

        const neg = hexToRGB(colors.negativeMax);
        const zero = hexToRGB(colors.zeroColor);
        const pos = hexToRGB(colors.positiveMax);

        let r, g, b;
        if (t < 0) {
            const s = -t; // 0 to 1
            r = Math.round(zero.r + (neg.r - zero.r) * s);
            g = Math.round(zero.g + (neg.g - zero.g) * s);
            b = Math.round(zero.b + (neg.b - zero.b) * s);
        } else {
            const s = t;
            r = Math.round(zero.r + (pos.r - zero.r) * s);
            g = Math.round(zero.g + (pos.g - zero.g) * s);
            b = Math.round(zero.b + (pos.b - zero.b) * s);
        }
        return `rgb(${r},${g},${b})`;
    }

    // ============================================
    // Rendering Helpers
    // ============================================
    function drawGridValues(ctx, grid, canvasW, canvasH, colorFn, colors, highlightRect) {
        const rows = grid.length;
        const cols = grid[0].length;
        const cellW = canvasW / cols;
        const cellH = canvasH / rows;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * cellW;
                const y = r * cellH;

                // Fill cell
                ctx.fillStyle = colorFn(grid[r][c]);
                ctx.fillRect(x, y, cellW, cellH);

                // Cell border
                ctx.strokeStyle = colors.cellBorder;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, cellW, cellH);

                // Value text
                const val = grid[r][c];
                const displayVal = Number.isInteger(val) ? val.toString() : val.toFixed(1);
                ctx.fillStyle = (val > 128 && !VizLib.ThemeManager.isDarkTheme()) ||
                                (val < 128 && VizLib.ThemeManager.isDarkTheme())
                                ? EAIColor('ink-soft') : EAIColor('sunken');
                ctx.font = `${Math.max(9, Math.min(13, cellW * 0.35))}px ${getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim() || 'monospace'}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayVal, x + cellW / 2, y + cellH / 2);
            }
        }

        // Highlight rectangle (filter window)
        if (highlightRect) {
            const hx = highlightRect.col * cellW;
            const hy = highlightRect.row * cellH;
            const hw = highlightRect.size * cellW;
            const hh = highlightRect.size * cellH;
            ctx.fillStyle = colors.highlight;
            ctx.fillRect(hx, hy, hw, hh);
            ctx.strokeStyle = colors.highlightBorder;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(hx, hy, hw, hh);
        }
    }

    function drawFeatureMap(ctx, grid, canvasW, canvasH, colors, highlightPos) {
        if (!grid || grid.length === 0) return;
        const rows = grid.length;
        const cols = grid[0].length;
        const cellW = canvasW / cols;
        const cellH = canvasH / rows;

        // Find min/max
        let minVal = Infinity, maxVal = -Infinity;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] < minVal) minVal = grid[r][c];
                if (grid[r][c] > maxVal) maxVal = grid[r][c];
            }
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * cellW;
                const y = r * cellH;

                ctx.fillStyle = divergingColor(grid[r][c], minVal, maxVal, colors);
                ctx.fillRect(x, y, cellW, cellH);

                ctx.strokeStyle = colors.cellBorder;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, cellW, cellH);

                // Value text
                const val = grid[r][c];
                const displayVal = Number.isInteger(val) ? val.toString() : val.toFixed(0);
                // Determine text brightness from cell luminance
                const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 1);
                const intensity = Math.abs(val / absMax);
                ctx.fillStyle = intensity > 0.45 ? EAIColor('surface') : colors.text;
                ctx.font = `${Math.max(9, Math.min(13, cellW * 0.35))}px ${getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim() || 'monospace'}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayVal, x + cellW / 2, y + cellH / 2);
            }
        }

        // Highlight current output cell
        if (highlightPos) {
            const hx = highlightPos.col * cellW;
            const hy = highlightPos.row * cellH;
            ctx.strokeStyle = colors.highlightBorder;
            ctx.lineWidth = 3;
            ctx.strokeRect(hx, hy, cellW, cellH);
        }
    }

    function drawPoolingMap(ctx, grid, canvasW, canvasH, accentColor, colors) {
        if (!grid || grid.length === 0) {
            VizLib.resetCanvasTransform(ctx, ctx._dpr || 1);
            VizLib.clearCanvas(ctx, canvasW, canvasH, colors.bg);
            ctx.fillStyle = colors.textMuted;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Run convolution first', canvasW / 2, canvasH / 2);
            return;
        }
        const rows = grid.length;
        const cols = grid[0].length;
        const cellW = canvasW / cols;
        const cellH = canvasH / rows;

        // Min/max
        let minVal = Infinity, maxVal = -Infinity;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] < minVal) minVal = grid[r][c];
                if (grid[r][c] > maxVal) maxVal = grid[r][c];
            }
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * cellW;
                const y = r * cellH;

                ctx.fillStyle = divergingColor(grid[r][c], minVal, maxVal, colors);
                ctx.fillRect(x, y, cellW, cellH);

                ctx.strokeStyle = colors.cellBorder;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, cellW, cellH);

                const val = grid[r][c];
                const displayVal = val.toFixed(0);
                const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 1);
                const intensity = Math.abs(val / absMax);
                ctx.fillStyle = intensity > 0.45 ? EAIColor('surface') : colors.text;
                ctx.font = `${Math.max(8, Math.min(12, cellW * 0.35))}px ${getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim() || 'monospace'}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayVal, x + cellW / 2, y + cellH / 2);
            }
        }
    }

    // ============================================
    // Main Visualizer
    // ============================================
    class CNNVisualizer {
        constructor() {
            // Canvases
            this.inputCanvas = document.getElementById('input-canvas');
            this.featureCanvas = document.getElementById('feature-canvas');
            this.maxpoolCanvas = document.getElementById('maxpool-canvas');
            this.avgpoolCanvas = document.getElementById('avgpool-canvas');

            // Set up HiDPI
            const inputSetup = VizLib.CanvasUtils.setupHiDPICanvas(this.inputCanvas);
            this.inputCtx = inputSetup.ctx;
            this.inputCtx._dpr = inputSetup.dpr;
            this.inputW = inputSetup.logicalWidth;
            this.inputH = inputSetup.logicalHeight;
            this.inputDpr = inputSetup.dpr;

            const featureSetup = VizLib.CanvasUtils.setupHiDPICanvas(this.featureCanvas);
            this.featureCtx = featureSetup.ctx;
            this.featureCtx._dpr = featureSetup.dpr;
            this.featureW = featureSetup.logicalWidth;
            this.featureH = featureSetup.logicalHeight;
            this.featureDpr = featureSetup.dpr;

            const maxpoolSetup = VizLib.CanvasUtils.setupHiDPICanvas(this.maxpoolCanvas);
            this.maxpoolCtx = maxpoolSetup.ctx;
            this.maxpoolCtx._dpr = maxpoolSetup.dpr;
            this.maxpoolW = maxpoolSetup.logicalWidth;
            this.maxpoolH = maxpoolSetup.logicalHeight;
            this.maxpoolDpr = maxpoolSetup.dpr;

            const avgpoolSetup = VizLib.CanvasUtils.setupHiDPICanvas(this.avgpoolCanvas);
            this.avgpoolCtx = avgpoolSetup.ctx;
            this.avgpoolCtx._dpr = avgpoolSetup.dpr;
            this.avgpoolW = avgpoolSetup.logicalWidth;
            this.avgpoolH = avgpoolSetup.logicalHeight;
            this.avgpoolDpr = avgpoolSetup.dpr;

            // State
            this.inputImage = generateImage('checkerboard', INPUT_SIZE);
            this.filterSize = 3;
            this.stride = 1;
            this.padding = 'none';
            this.kernel = this._copyKernel(PRESETS_3x3['identity']);
            this.featureMap = null;
            this.maxPoolMap = null;
            this.avgPoolMap = null;
            this.currentPreset = 'identity';

            // Animation state
            this.animating = false;
            this.animTimer = null;
            this.currentPos = { row: -1, col: -1 }; // -1 means not started
            this.speed = 5;
            this.partialFeatureMap = null; // progressively built during animation

            this._buildKernelGrid();
            this._bindControls();
            this._bindThemeChange();
            this._computeAll();
            this._renderAll();
        }

        // ---- Kernel Grid UI ----
        _buildKernelGrid() {
            const grid = document.getElementById('kernel-grid');
            grid.innerHTML = '';
            grid.className = 'cnn-kernel-grid size-' + this.filterSize;

            for (let m = 0; m < this.filterSize; m++) {
                for (let n = 0; n < this.filterSize; n++) {
                    const inp = document.createElement('input');
                    inp.type = 'number';
                    inp.className = 'cnn-kernel-input';
                    inp.step = '0.5';
                    inp.value = this.kernel[m][n];
                    inp.dataset.row = m;
                    inp.dataset.col = n;
                    inp.addEventListener('change', () => {
                        this.kernel[m][n] = parseFloat(inp.value) || 0;
                        this._setActivePreset('custom');
                        this._computeAll();
                        this._renderAll();
                    });
                    grid.appendChild(inp);
                }
            }
        }

        _updateKernelGridValues() {
            const inputs = document.querySelectorAll('#kernel-grid .cnn-kernel-input');
            let idx = 0;
            for (let m = 0; m < this.filterSize; m++) {
                for (let n = 0; n < this.filterSize; n++) {
                    if (inputs[idx]) {
                        inputs[idx].value = this.kernel[m][n];
                    }
                    idx++;
                }
            }
        }

        _setActivePreset(name) {
            this.currentPreset = name;
            document.querySelectorAll('#preset-buttons .btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.preset === name);
            });
        }

        // ---- Controls ----
        _bindControls() {
            // Preset buttons
            document.querySelectorAll('#preset-buttons .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const preset = btn.dataset.preset;
                    if (preset === 'custom') {
                        this._setActivePreset('custom');
                        return;
                    }
                    const presets = (this.filterSize === 3) ? PRESETS_3x3 : PRESETS_5x5;
                    if (presets[preset]) {
                        this.kernel = this._copyKernel(presets[preset]);
                        this._setActivePreset(preset);
                        this._updateKernelGridValues();
                        this._stopAnimation();
                        this._computeAll();
                        this._renderAll();
                    }
                });
            });

            // Input image select
            document.getElementById('input-select').addEventListener('change', (e) => {
                this.inputImage = generateImage(e.target.value, INPUT_SIZE);
                this._stopAnimation();
                this._computeAll();
                this._renderAll();
            });

            // Filter size
            document.getElementById('filter-size-select').addEventListener('change', (e) => {
                this.filterSize = parseInt(e.target.value);
                const presets = (this.filterSize === 3) ? PRESETS_3x3 : PRESETS_5x5;
                const presetName = (presets[this.currentPreset]) ? this.currentPreset : 'identity';
                this.kernel = this._copyKernel(presets[presetName]);
                this._setActivePreset(presetName);
                this._buildKernelGrid();
                this._stopAnimation();
                this._computeAll();
                this._renderAll();
            });

            // Stride
            document.getElementById('stride-select').addEventListener('change', (e) => {
                this.stride = parseInt(e.target.value);
                this._stopAnimation();
                this._computeAll();
                this._renderAll();
            });

            // Padding
            document.getElementById('padding-select').addEventListener('change', (e) => {
                this.padding = e.target.value;
                this._stopAnimation();
                this._computeAll();
                this._renderAll();
            });

            // Animate button
            document.getElementById('btn-animate').addEventListener('click', () => {
                if (this.animating) {
                    this._stopAnimation();
                } else {
                    this._startAnimation();
                }
            });

            // Step button
            document.getElementById('btn-step').addEventListener('click', () => {
                this._stopAnimation();
                this._stepForward();
            });

            // Reset button
            document.getElementById('btn-reset').addEventListener('click', () => {
                this._stopAnimation();
                this.currentPos = { row: -1, col: -1 };
                this.partialFeatureMap = null;
                this._computeAll();
                this._renderAll();
                this._updateComputationDisplay(null);
                this._updateStatus('Ready');
            });

            // Speed slider
            const speedSlider = document.getElementById('speed-slider');
            const speedValue = document.getElementById('speed-value');
            speedSlider.addEventListener('input', (e) => {
                this.speed = parseInt(e.target.value);
                speedValue.textContent = this.speed;
                // If animating, restart with new speed
                if (this.animating) {
                    this._stopAnimation();
                    this._startAnimation();
                }
            });
        }

        _bindThemeChange() {
            VizLib.ThemeManager.onThemeChange(() => this._renderAll());
        }

        // ---- Computation ----
        _computeAll() {
            this.featureMap = convolve(this.inputImage, this.kernel, this.stride, this.padding);
            // Pooling on the full feature map
            if (this.featureMap.length >= POOL_WINDOW) {
                this.maxPoolMap = maxPool(this.featureMap, POOL_WINDOW);
                this.avgPoolMap = avgPool(this.featureMap, POOL_WINDOW);
            } else {
                this.maxPoolMap = null;
                this.avgPoolMap = null;
            }
            this._updateMetrics();
        }

        _updateMetrics() {
            const outSize = this.featureMap ? this.featureMap.length : 0;
            document.getElementById('metric-input-size').textContent = `${INPUT_SIZE} x ${INPUT_SIZE}`;
            document.getElementById('metric-filter-size').textContent = `${this.filterSize} x ${this.filterSize}`;
            document.getElementById('metric-output-size').textContent = `${outSize} x ${outSize}`;
            document.getElementById('metric-stride').textContent = this.stride;
            document.getElementById('metric-padding').textContent = (this.padding === 'same') ? 'Same' : 'None';

            // Update badges
            document.getElementById('input-badge').innerHTML = `${INPUT_SIZE} &times; ${INPUT_SIZE}`;
            document.getElementById('output-badge').innerHTML = `${outSize} &times; ${outSize}`;

            if (this.featureMap && outSize > 0) {
                let minV = Infinity, maxV = -Infinity;
                for (let r = 0; r < outSize; r++) {
                    for (let c = 0; c < outSize; c++) {
                        if (this.featureMap[r][c] < minV) minV = this.featureMap[r][c];
                        if (this.featureMap[r][c] > maxV) maxV = this.featureMap[r][c];
                    }
                }
                document.getElementById('metric-min-val').textContent = minV.toFixed(1);
                document.getElementById('metric-max-val').textContent = maxV.toFixed(1);
            } else {
                document.getElementById('metric-min-val').textContent = '-';
                document.getElementById('metric-max-val').textContent = '-';
            }
        }

        _updateStatus(text) {
            document.getElementById('metric-status').textContent = text;
        }

        // ---- Animation ----
        _startAnimation() {
            this.animating = true;
            const btn = document.getElementById('btn-animate');
            btn.innerHTML = '<i class="fa fa-pause"></i> Pause';
            btn.classList.remove('btn-success');
            btn.classList.add('btn-warning');

            // If no position set, start from beginning
            if (this.currentPos.row < 0) {
                this.currentPos = { row: 0, col: 0 };
                this._initPartialFeatureMap();
            }

            const outSize = computeOutputSize(INPUT_SIZE, this.filterSize, this.stride, this.padding);
            const delay = Math.max(50, 600 - this.speed * 55);

            const tick = () => {
                if (!this.animating) return;
                this._computeAtCurrentPos();
                this._renderAll();

                // Advance position
                let { row, col } = this.currentPos;
                col++;
                if (col >= outSize) {
                    col = 0;
                    row++;
                }
                if (row >= outSize) {
                    // Done
                    this._stopAnimation();
                    this._updateStatus('Complete');
                    return;
                }
                this.currentPos = { row, col };
                this.animTimer = setTimeout(tick, delay);
            };

            tick();
        }

        _stopAnimation() {
            this.animating = false;
            if (this.animTimer) {
                clearTimeout(this.animTimer);
                this.animTimer = null;
            }
            const btn = document.getElementById('btn-animate');
            btn.innerHTML = '<i class="fa fa-play"></i> Animate';
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-success');
        }

        _stepForward() {
            const outSize = computeOutputSize(INPUT_SIZE, this.filterSize, this.stride, this.padding);
            if (outSize === 0) return;

            if (this.currentPos.row < 0) {
                this.currentPos = { row: 0, col: 0 };
                this._initPartialFeatureMap();
            } else {
                // Advance
                let { row, col } = this.currentPos;
                col++;
                if (col >= outSize) {
                    col = 0;
                    row++;
                }
                if (row >= outSize) {
                    this._updateStatus('Complete');
                    return;
                }
                this.currentPos = { row, col };
            }

            this._computeAtCurrentPos();
            this._renderAll();
        }

        _initPartialFeatureMap() {
            const outSize = computeOutputSize(INPUT_SIZE, this.filterSize, this.stride, this.padding);
            this.partialFeatureMap = [];
            for (let r = 0; r < outSize; r++) {
                this.partialFeatureMap[r] = [];
                for (let c = 0; c < outSize; c++) {
                    this.partialFeatureMap[r][c] = null;
                }
            }
        }

        _computeAtCurrentPos() {
            const { row, col } = this.currentPos;
            const padAmount = (this.padding === 'same') ? Math.floor(this.filterSize / 2) : 0;
            const paddedImg = padImage(this.inputImage, padAmount);
            const result = computeConvolutionAtPosition(paddedImg, this.kernel, this.stride, row, col);

            if (this.partialFeatureMap) {
                this.partialFeatureMap[row][col] = result.sum;
            }

            this._updateComputationDisplay(result);
            const outSize = computeOutputSize(INPUT_SIZE, this.filterSize, this.stride, this.padding);
            const total = outSize * outSize;
            const current = row * outSize + col + 1;
            this._updateStatus(`Position (${row}, ${col}) - ${current}/${total}`);
        }

        _updateComputationDisplay(result) {
            const box = document.getElementById('computation-box');
            if (!result) {
                box.innerHTML = '<span class="text-muted">Press Animate or Step to begin</span>';
                return;
            }

            const { row, col } = this.currentPos;
            let html = `<strong>Output(${row}, ${col}):</strong>\n`;
            const terms = result.terms;
            const parts = [];
            for (let i = 0; i < terms.length; i++) {
                const t = terms[i];
                parts.push(`<span class="comp-multiply">${t.inputVal}*${t.kernelVal}</span>`);
            }
            html += parts.join(' + ') + '\n';
            html += `= <span class="comp-result">${result.sum.toFixed(1)}</span>`;
            box.innerHTML = html;
        }

        // ---- Rendering ----
        _renderAll() {
            const colors = getColors();
            const isDark = VizLib.ThemeManager.isDarkTheme();

            // Input canvas
            VizLib.resetCanvasTransform(this.inputCtx, this.inputDpr);
            VizLib.clearCanvas(this.inputCtx, this.inputW, this.inputH, colors.bg);

            // Determine highlight rect on input image
            let inputHighlight = null;
            if (this.currentPos.row >= 0) {
                const padAmount = (this.padding === 'same') ? Math.floor(this.filterSize / 2) : 0;
                const startRow = this.currentPos.row * this.stride - padAmount;
                const startCol = this.currentPos.col * this.stride - padAmount;
                inputHighlight = { row: startRow, col: startCol, size: this.filterSize };
            }

            // If padding is 'same', we need to draw the padded image
            const padAmount = (this.padding === 'same') ? Math.floor(this.filterSize / 2) : 0;
            const displayImage = padImage(this.inputImage, padAmount);

            drawGridValues(
                this.inputCtx, displayImage, this.inputW, this.inputH,
                (v) => grayscaleColor(v, isDark),
                colors,
                inputHighlight ? {
                    row: inputHighlight.row + padAmount,
                    col: inputHighlight.col + padAmount,
                    size: this.filterSize
                } : null
            );

            // Feature map canvas
            VizLib.resetCanvasTransform(this.featureCtx, this.featureDpr);
            VizLib.clearCanvas(this.featureCtx, this.featureW, this.featureH, colors.bg);

            // Use partial feature map during animation, full otherwise
            const displayFeatureMap = this.partialFeatureMap || this.featureMap;

            if (displayFeatureMap && displayFeatureMap.length > 0) {
                // Build a display-ready version (replace null with 0 for rendering)
                const outSize = displayFeatureMap.length;
                const renderMap = [];
                for (let r = 0; r < outSize; r++) {
                    renderMap[r] = [];
                    for (let c = 0; c < outSize; c++) {
                        renderMap[r][c] = (displayFeatureMap[r][c] !== null) ? displayFeatureMap[r][c] : 0;
                    }
                }

                const featureHighlight = (this.currentPos.row >= 0) ?
                    { row: this.currentPos.row, col: this.currentPos.col } : null;

                drawFeatureMap(
                    this.featureCtx, renderMap, this.featureW, this.featureH,
                    colors, featureHighlight
                );

                // Overlay "not yet computed" cells with dimming
                if (this.partialFeatureMap) {
                    const cellW = this.featureW / outSize;
                    const cellH = this.featureH / outSize;
                    this.featureCtx.fillStyle = isDark ? EAIColor('canvas', 0.6, 'dark') : 'rgba(200,200,200,0.5)';
                    for (let r = 0; r < outSize; r++) {
                        for (let c = 0; c < outSize; c++) {
                            if (this.partialFeatureMap[r][c] === null) {
                                this.featureCtx.fillRect(c * cellW, r * cellH, cellW, cellH);
                            }
                        }
                    }
                }
            } else {
                this.featureCtx.fillStyle = colors.textMuted;
                this.featureCtx.font = '14px sans-serif';
                this.featureCtx.textAlign = 'center';
                this.featureCtx.textBaseline = 'middle';
                this.featureCtx.fillText('Feature map will appear here', this.featureW / 2, this.featureH / 2);
            }

            // Pooling canvases
            VizLib.resetCanvasTransform(this.maxpoolCtx, this.maxpoolDpr);
            VizLib.clearCanvas(this.maxpoolCtx, this.maxpoolW, this.maxpoolH, colors.bg);
            drawPoolingMap(this.maxpoolCtx, this.maxPoolMap, this.maxpoolW, this.maxpoolH, colors.poolMax, colors);

            VizLib.resetCanvasTransform(this.avgpoolCtx, this.avgpoolDpr);
            VizLib.clearCanvas(this.avgpoolCtx, this.avgpoolW, this.avgpoolH, colors.bg);
            drawPoolingMap(this.avgpoolCtx, this.avgPoolMap, this.avgpoolW, this.avgpoolH, colors.poolAvg, colors);
        }

        // ---- Utility ----
        _copyKernel(k) {
            return k.map(row => row.slice());
        }
    }

    // ============================================
    // Bootstrap
    // ============================================
    function init() {
        new CNNVisualizer();

        // Wire up info-panel tabs (btn-group variant)
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

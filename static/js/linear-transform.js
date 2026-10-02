/**
 * Linear Transformations Visualizer
 *
 * Interactive visualization of how 2x2 weight matrices transform 2D space.
 * Shows grid warping, basis vector mapping, unit circle deformation,
 * eigenvectors, and data point transformation with smooth animation.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 400;
    const COORD_RANGE = 3; // math coords go from -3 to 3
    const GRID_STEP = 0.5;
    const GRID_SAMPLES = 40; // points per grid line
    const CIRCLE_SAMPLES = 64;
    const DATA_POINT_COUNT = 12;
    const ARROW_SIZE = 10;

    // ============================================
    // Presets
    // ============================================
    const PRESETS = {
        identity:    [[1, 0], [0, 1]],
        rotate45:    [[0.7071, -0.7071], [0.7071, 0.7071]],
        rotate90:    [[0, -1], [1, 0]],
        scale2x:     [[2, 0], [0, 2]],
        scaleNonUni: [[2, 0], [0, 0.5]],
        shearX:      [[1, 0.5], [0, 1]],
        shearY:      [[1, 0], [0.5, 1]],
        reflectX:    [[1, 0], [0, -1]],
        reflectY:    [[-1, 0], [0, 1]],
        projection:  [[1, 0], [0, 0]]
    };

    // ============================================
    // Matrix Math Utilities
    // ============================================
    function mat2x2_mul(W, v) {
        return [
            W[0][0] * v[0] + W[0][1] * v[1],
            W[1][0] * v[0] + W[1][1] * v[1]
        ];
    }

    function mat2x2_det(W) {
        return W[0][0] * W[1][1] - W[0][1] * W[1][0];
    }

    function mat2x2_eigenvalues(W) {
        const a = W[0][0], b = W[0][1], c = W[1][0], d = W[1][1];
        const trace = a + d;
        const det = a * d - b * c;
        const disc = trace * trace - 4 * det;

        if (disc >= 0) {
            const sqrtDisc = Math.sqrt(disc);
            return {
                real: true,
                values: [(trace + sqrtDisc) / 2, (trace - sqrtDisc) / 2]
            };
        } else {
            const sqrtDisc = Math.sqrt(-disc);
            return {
                real: false,
                values: [trace / 2, trace / 2],
                imag: [sqrtDisc / 2, -sqrtDisc / 2]
            };
        }
    }

    function mat2x2_eigenvectors(W, eigenInfo) {
        if (!eigenInfo.real) return [];

        const vectors = [];
        for (const lambda of eigenInfo.values) {
            const a = W[0][0] - lambda;
            const b = W[0][1];
            const c = W[1][0];
            const d = W[1][1] - lambda;

            let vx, vy;
            if (Math.abs(a) > 1e-10 || Math.abs(b) > 1e-10) {
                if (Math.abs(b) > 1e-10) {
                    vx = -b;
                    vy = a;
                } else {
                    vx = 0;
                    vy = 1;
                }
            } else if (Math.abs(c) > 1e-10 || Math.abs(d) > 1e-10) {
                if (Math.abs(d) > 1e-10) {
                    vx = -d;
                    vy = c;
                } else {
                    vx = 1;
                    vy = 0;
                }
            } else {
                // Zero matrix row — any direction is an eigenvector
                vx = 1;
                vy = 0;
            }

            const len = Math.sqrt(vx * vx + vy * vy);
            if (len > 1e-10) {
                vectors.push([vx / len, vy / len]);
            }
        }
        return vectors;
    }

    function mat2x2_svd(W) {
        // Singular values = sqrt of eigenvalues of W^T W
        const WtW = [
            [W[0][0] * W[0][0] + W[1][0] * W[1][0], W[0][0] * W[0][1] + W[1][0] * W[1][1]],
            [W[0][1] * W[0][0] + W[1][1] * W[1][0], W[0][1] * W[0][1] + W[1][1] * W[1][1]]
        ];
        const eig = mat2x2_eigenvalues(WtW);
        const sv = eig.values.map(v => Math.sqrt(Math.max(0, v)));
        sv.sort((a, b) => b - a);
        return sv;
    }

    function mat2x2_matmul(A, B) {
        return [
            [A[0][0]*B[0][0] + A[0][1]*B[1][0], A[0][0]*B[0][1] + A[0][1]*B[1][1]],
            [A[1][0]*B[0][0] + A[1][1]*B[1][0], A[1][0]*B[0][1] + A[1][1]*B[1][1]]
        ];
    }

    function mat2x2_lerp(A, B, t) {
        return [
            [A[0][0] + (B[0][0] - A[0][0]) * t, A[0][1] + (B[0][1] - A[0][1]) * t],
            [A[1][0] + (B[1][0] - A[1][0]) * t, A[1][1] + (B[1][1] - A[1][1]) * t]
        ];
    }

    function classifyTransformation(W) {
        const det = mat2x2_det(W);
        const a = W[0][0], b = W[0][1], c = W[1][0], d = W[1][1];
        const eps = 1e-3;

        if (Math.abs(a - 1) < eps && Math.abs(b) < eps &&
            Math.abs(c) < eps && Math.abs(d - 1) < eps) {
            return 'Identity';
        }
        if (Math.abs(det) < eps) return 'Singular (rank < 2)';
        if (det < 0) {
            // Check for pure reflection
            if (Math.abs(a * d + b * c + 1) < eps &&
                Math.abs(a * a + b * b - 1) < eps) {
                return 'Reflection';
            }
            return 'Reflection + other';
        }
        // Check rotation: W^T W = I and det > 0
        const wtw00 = a * a + c * c;
        const wtw01 = a * b + c * d;
        const wtw11 = b * b + d * d;
        if (Math.abs(wtw00 - 1) < eps && Math.abs(wtw01) < eps && Math.abs(wtw11 - 1) < eps) {
            return 'Rotation';
        }
        // Check uniform scaling
        if (Math.abs(b) < eps && Math.abs(c) < eps && Math.abs(a - d) < eps) {
            return 'Uniform Scaling';
        }
        // Check diagonal (non-uniform scaling)
        if (Math.abs(b) < eps && Math.abs(c) < eps) {
            return 'Non-uniform Scaling';
        }
        // Check shear
        if ((Math.abs(a - 1) < eps && Math.abs(d - 1) < eps) &&
            (Math.abs(b) > eps || Math.abs(c) > eps)) {
            return 'Shear';
        }
        return 'General';
    }

    // ============================================
    // CoordinateMapper
    // ============================================
    class CoordinateMapper {
        constructor(canvasW, canvasH, range) {
            // Uniform scaling: use the smaller dimension
            const usable = Math.min(canvasW, canvasH);
            this.scale = usable / (2 * range);
            this.cx = canvasW / 2;
            this.cy = canvasH / 2;
        }

        toCanvas(mx, my) {
            return [
                this.cx + mx * this.scale,
                this.cy - my * this.scale // flip Y
            ];
        }

        toMath(px, py) {
            return [
                (px - this.cx) / this.scale,
                -(py - this.cy) / this.scale
            ];
        }
    }

    // ============================================
    // Colors helper
    // ============================================
    function getColors() {
        const isDark = VizLib.ThemeManager.isDarkTheme();
        return {
            bg:        isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            gridOrig:  isDark ? EAIColor('muted', 0.15, 'dark') : 'rgba(0,0,0,0.08)',
            gridTrans: isDark ? EAIColor('blue', 0.35, 'dark') : EAIColor('blue', 0.25),
            axisOrig:  isDark ? EAIColor('muted', 0.3, 'dark')  : 'rgba(0,0,0,0.15)',
            axisTrans: isDark ? EAIColor('blue', 0.6, 'dark')  : EAIColor('blue', 0.45),
            e1:        isDark ? EAIColor('red', 'dark') : EAIColor('red', 'light'),
            e2:        isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            circle:    isDark ? EAIColor('gold', 'dark') : EAIColor('gold-strong', 'light'),
            circleRef: isDark ? EAIColor('gold', 0.2, 'dark') : EAIColor('gold-strong', 0.15),
            eigen:     isDark ? EAIColor('purple', 'dark') : EAIColor('purple', 'light'),
            data:      isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light'),
            dataGhost: isDark ? EAIColor('green', 0.3, 'dark') : EAIColor('green', 0.25),
            dataLine:  isDark ? EAIColor('green', 0.4, 'dark') : EAIColor('green', 0.3),
            origin:    isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            text:      isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light')
        };
    }

    // ============================================
    // Renderers
    // ============================================
    function drawGrid(ctx, mapper, W, colors) {
        const range = COORD_RANGE;

        // Draw original faint grid + axes
        ctx.lineWidth = 1;
        for (let v = -range; v <= range; v += GRID_STEP) {
            // Vertical line x=v
            ctx.strokeStyle = (Math.abs(v) < 0.01) ? colors.axisOrig : colors.gridOrig;
            ctx.beginPath();
            const [x0, y0] = mapper.toCanvas(v, -range);
            const [x1, y1] = mapper.toCanvas(v, range);
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            // Horizontal line y=v
            ctx.strokeStyle = (Math.abs(v) < 0.01) ? colors.axisOrig : colors.gridOrig;
            ctx.beginPath();
            const [x2, y2] = mapper.toCanvas(-range, v);
            const [x3, y3] = mapper.toCanvas(range, v);
            ctx.moveTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.stroke();
        }

        // Draw transformed grid
        ctx.lineWidth = 1.5;
        for (let v = -range; v <= range; v += GRID_STEP) {
            const isAxis = Math.abs(v) < 0.01;
            ctx.strokeStyle = isAxis ? colors.axisTrans : colors.gridTrans;

            // Vertical line x=v, varying y
            ctx.beginPath();
            for (let i = 0; i <= GRID_SAMPLES; i++) {
                const t = -range + (2 * range * i / GRID_SAMPLES);
                const [tx, ty] = mat2x2_mul(W, [v, t]);
                const [px, py] = mapper.toCanvas(tx, ty);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // Horizontal line y=v, varying x
            ctx.beginPath();
            for (let i = 0; i <= GRID_SAMPLES; i++) {
                const t = -range + (2 * range * i / GRID_SAMPLES);
                const [tx, ty] = mat2x2_mul(W, [t, v]);
                const [px, py] = mapper.toCanvas(tx, ty);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
    }

    function drawBasisVectors(ctx, mapper, W, colors) {
        const drawLine = VizLib.CanvasUtils.drawLine;

        const [ox, oy] = mapper.toCanvas(0, 0);

        // e1
        const e1 = mat2x2_mul(W, [1, 0]);
        const [e1x, e1y] = mapper.toCanvas(e1[0], e1[1]);
        ctx.strokeStyle = colors.e1;
        ctx.fillStyle = colors.e1;
        ctx.lineWidth = 3;
        drawLine(ctx, ox, oy, e1x, e1y, { arrow: true, arrowSize: ARROW_SIZE });

        // e2
        const e2 = mat2x2_mul(W, [0, 1]);
        const [e2x, e2y] = mapper.toCanvas(e2[0], e2[1]);
        ctx.strokeStyle = colors.e2;
        ctx.fillStyle = colors.e2;
        ctx.lineWidth = 3;
        drawLine(ctx, ox, oy, e2x, e2y, { arrow: true, arrowSize: ARROW_SIZE });
    }

    function drawUnitCircle(ctx, mapper, W, colors) {
        // Reference circle (faint)
        ctx.strokeStyle = colors.circleRef;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i <= CIRCLE_SAMPLES; i++) {
            const angle = (2 * Math.PI * i) / CIRCLE_SAMPLES;
            const [px, py] = mapper.toCanvas(Math.cos(angle), Math.sin(angle));
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // Transformed circle (ellipse)
        ctx.strokeStyle = colors.circle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= CIRCLE_SAMPLES; i++) {
            const angle = (2 * Math.PI * i) / CIRCLE_SAMPLES;
            const v = [Math.cos(angle), Math.sin(angle)];
            const tv = mat2x2_mul(W, v);
            const [px, py] = mapper.toCanvas(tv[0], tv[1]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
    }

    function drawEigenvectors(ctx, mapper, W, colors) {
        const eigenInfo = mat2x2_eigenvalues(W);
        if (!eigenInfo.real) return;

        const vectors = mat2x2_eigenvectors(W, eigenInfo);
        const range = COORD_RANGE;

        ctx.strokeStyle = colors.eigen;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);

        for (const v of vectors) {
            const [x0, y0] = mapper.toCanvas(-range * v[0], -range * v[1]);
            const [x1, y1] = mapper.toCanvas(range * v[0], range * v[1]);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        ctx.setLineDash([]);
    }

    function drawDataPoints(ctx, mapper, W, colors, dataPoints) {
        const drawCircle = VizLib.CanvasUtils.drawCircle;

        for (const pt of dataPoints) {
            const [gx, gy] = mapper.toCanvas(pt[0], pt[1]);
            const tv = mat2x2_mul(W, pt);
            const [tx, ty] = mapper.toCanvas(tv[0], tv[1]);

            // Connecting line
            ctx.strokeStyle = colors.dataLine;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(tx, ty);
            ctx.stroke();

            // Ghost (original)
            ctx.fillStyle = colors.dataGhost;
            drawCircle(ctx, gx, gy, 4);

            // Transformed
            ctx.fillStyle = colors.data;
            drawCircle(ctx, tx, ty, 5);
        }
    }

    function drawOrigin(ctx, mapper, colors) {
        const [ox, oy] = mapper.toCanvas(0, 0);
        ctx.fillStyle = colors.origin;
        ctx.beginPath();
        ctx.arc(ox, oy, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // ============================================
    // Animation Controller
    // ============================================
    class AnimationController {
        constructor(onFrame, onComplete) {
            this.onFrame = onFrame;
            this.onComplete = onComplete;
            this.animating = false;
            this.rafId = null;
        }

        start(from, to, durationMs, onComplete) {
            this.stop();
            this.animating = true;
            const startTime = performance.now();
            const completeFn = onComplete || this.onComplete;

            const tick = (now) => {
                const elapsed = now - startTime;
                let t = Math.min(elapsed / durationMs, 1);
                // Ease in-out
                t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

                const current = mat2x2_lerp(from, to, t);
                this.onFrame(current, t);

                if (elapsed < durationMs) {
                    this.rafId = requestAnimationFrame(tick);
                } else {
                    this.animating = false;
                    this.onFrame(to, 1);
                    if (completeFn) completeFn();
                }
            };

            this.rafId = requestAnimationFrame(tick);
        }

        stop() {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            this.animating = false;
        }
    }

    // ============================================
    // Main Visualizer
    // ============================================
    class LinearTransformVisualizer {
        constructor() {
            this.canvas = document.getElementById('transform-canvas');
            if (!this.canvas) return;

            const setup = VizLib.setupHiDPICanvas(this.canvas);
            this.ctx = setup.ctx;
            this.dpr = setup.dpr;
            this.logicalWidth = setup.logicalWidth;
            this.logicalHeight = setup.logicalHeight;

            this.mapper = new CoordinateMapper(this.logicalWidth, this.logicalHeight, COORD_RANGE);

            // State
            this.currentMatrix = [[1, 0], [0, 1]];
            this.targetMatrix = [[1, 0], [0, 1]];
            this.displayMatrix = [[1, 0], [0, 1]];

            this.show = {
                grid: true,
                basis: true,
                circle: true,
                eigen: false,
                data: false
            };

            this.dataPoints = this._generateDataPoints();
            this.speed = 5;
            this.chain = [];
            this.chainAnimating = false;

            this.animation = new AnimationController(
                (matrix, t) => {
                    this.displayMatrix = matrix;
                    this.render();
                    this.updateMetrics(matrix);
                    this.updateDetBadge(matrix);
                },
                () => {
                    this.currentMatrix = this.copyMatrix(this.targetMatrix);
                    this.displayMatrix = this.copyMatrix(this.targetMatrix);
                }
            );

            this._bindControls();
            this._bindCompositionControls();
            this._bindThemeChange();
            this.render();
            this.updateMetrics(this.currentMatrix);
            this.updateDetBadge(this.currentMatrix);
        }

        _generateDataPoints() {
            const points = [];
            for (let i = 0; i < DATA_POINT_COUNT; i++) {
                const angle = (2 * Math.PI * i) / DATA_POINT_COUNT;
                const r = 0.8 + Math.random() * 1.2;
                points.push([r * Math.cos(angle), r * Math.sin(angle)]);
            }
            return points;
        }

        _bindControls() {
            // Matrix inputs
            this.inputs = {
                w00: document.getElementById('w00'),
                w01: document.getElementById('w01'),
                w10: document.getElementById('w10'),
                w11: document.getElementById('w11')
            };

            for (const key in this.inputs) {
                this.inputs[key].addEventListener('change', () => this._onMatrixInput());
            }

            // Preset
            document.getElementById('preset-select').addEventListener('change', (e) => {
                const preset = PRESETS[e.target.value];
                if (preset) {
                    this._setInputs(preset);
                    this._animateToTarget(preset);
                }
            });

            // Toggles
            const toggleMap = {
                'toggle-grid': 'grid',
                'toggle-basis': 'basis',
                'toggle-circle': 'circle',
                'toggle-eigen': 'eigen',
                'toggle-data': 'data'
            };
            for (const [id, key] of Object.entries(toggleMap)) {
                document.getElementById(id).addEventListener('change', (e) => {
                    this.show[key] = e.target.checked;
                    this.render();
                });
            }

            // Buttons
            document.getElementById('btn-transform').addEventListener('click', () => {
                this._onMatrixInput();
            });

            document.getElementById('btn-reset').addEventListener('click', () => {
                this.animation.stop();
                const identity = [[1, 0], [0, 1]];
                this._setInputs(identity);
                document.getElementById('preset-select').value = 'identity';
                this._animateToTarget(identity);
            });

            // Speed
            const speedSlider = document.getElementById('speed-slider');
            const speedValue = document.getElementById('speed-value');
            speedSlider.addEventListener('input', (e) => {
                this.speed = parseInt(e.target.value);
                speedValue.textContent = this.speed;
            });
        }

        _bindThemeChange() {
            VizLib.ThemeManager.onThemeChange(() => this.render());
        }

        _onMatrixInput() {
            const W = [
                [parseFloat(this.inputs.w00.value) || 0, parseFloat(this.inputs.w01.value) || 0],
                [parseFloat(this.inputs.w10.value) || 0, parseFloat(this.inputs.w11.value) || 0]
            ];
            this._animateToTarget(W);
        }

        // ============================================
        // Composition Chain
        // ============================================
        _bindCompositionControls() {
            document.getElementById('btn-add-chain').addEventListener('click', () => this.addToChain());
            document.getElementById('btn-chain-step').addEventListener('click', () => this.animateChainStepByStep());
            document.getElementById('btn-chain-composed').addEventListener('click', () => this.animateChainComposed());
            document.getElementById('btn-chain-clear').addEventListener('click', () => this.clearChain());
        }

        _readMatrixInputs() {
            return [
                [parseFloat(this.inputs.w00.value) || 0, parseFloat(this.inputs.w01.value) || 0],
                [parseFloat(this.inputs.w10.value) || 0, parseFloat(this.inputs.w11.value) || 0]
            ];
        }

        _getCurrentPresetName() {
            const select = document.getElementById('preset-select');
            const presetKey = select.value;
            const preset = PRESETS[presetKey];
            const current = this._readMatrixInputs();

            if (preset &&
                Math.abs(current[0][0] - preset[0][0]) < 0.001 &&
                Math.abs(current[0][1] - preset[0][1]) < 0.001 &&
                Math.abs(current[1][0] - preset[1][0]) < 0.001 &&
                Math.abs(current[1][1] - preset[1][1]) < 0.001) {
                return select.options[select.selectedIndex].text;
            }
            return 'Custom';
        }

        addToChain() {
            if (this.chainAnimating) return;
            const matrix = this._readMatrixInputs();
            const name = this._getCurrentPresetName();
            this.chain.push({ matrix: this.copyMatrix(matrix), name });
            this.updateChainUI();
        }

        removeFromChain(index) {
            if (this.chainAnimating) return;
            this.chain.splice(index, 1);
            this.updateChainUI();
        }

        clearChain() {
            if (this.chainAnimating) return;
            this.chain = [];
            this.updateChainUI();
        }

        computeComposed() {
            if (this.chain.length === 0) return [[1, 0], [0, 1]];
            let result = this.copyMatrix(this.chain[0].matrix);
            for (let i = 1; i < this.chain.length; i++) {
                result = mat2x2_matmul(this.chain[i].matrix, result);
            }
            return result;
        }

        updateChainUI() {
            const display = document.getElementById('chain-display');
            const composedDiv = document.getElementById('chain-composed');
            const badge = document.getElementById('chain-count-badge');
            const btnStep = document.getElementById('btn-chain-step');
            const btnComposed = document.getElementById('btn-chain-composed');
            const btnClear = document.getElementById('btn-chain-clear');

            const hasChain = this.chain.length > 0;
            btnStep.disabled = this.chain.length < 2;
            btnComposed.disabled = this.chain.length < 2;
            btnClear.disabled = !hasChain;
            badge.textContent = this.chain.length + (this.chain.length === 1 ? ' transform' : ' transforms');

            if (!hasChain) {
                display.innerHTML = '<div class="chain-empty">No transforms in chain yet</div>';
                composedDiv.style.display = 'none';
                return;
            }

            // Build chain chips
            let html = '<div class="chain-items">';
            this.chain.forEach((entry, i) => {
                if (i > 0) html += '<span class="chain-arrow">\u2192</span>';
                const m = entry.matrix;
                html += '<div class="chain-chip" id="chain-chip-' + i + '">'
                    + '<div class="chain-chip-header">'
                    + '<span class="chain-chip-label">W<sub>' + (i + 1) + '</sub></span>'
                    + '<button class="chain-chip-remove" data-index="' + i + '" title="Remove">\u00d7</button>'
                    + '</div>'
                    + '<div class="chain-chip-name">' + entry.name + '</div>'
                    + '<div class="chain-chip-matrix">'
                    + '<span>' + m[0][0].toFixed(2) + ', ' + m[0][1].toFixed(2) + '</span><br>'
                    + '<span>' + m[1][0].toFixed(2) + ', ' + m[1][1].toFixed(2) + '</span>'
                    + '</div>'
                    + '</div>';
            });
            html += '</div>';
            display.innerHTML = html;

            // Bind remove buttons
            display.querySelectorAll('.chain-chip-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.removeFromChain(parseInt(e.target.dataset.index));
                });
            });

            // Show composed result
            if (this.chain.length >= 2) {
                composedDiv.style.display = 'block';
                const composed = this.computeComposed();
                const labels = [];
                for (let i = this.chain.length; i >= 1; i--) {
                    labels.push('W<sub>' + i + '</sub>');
                }
                document.getElementById('composed-equation').innerHTML =
                    '<span class="composed-label">' + labels.join(' \u00b7 ') + ' =</span>'
                    + '<span class="composed-matrix">'
                    + '<span class="matrix-bracket bracket-left">[</span>'
                    + '<span class="composed-values">'
                    + '<span>' + composed[0][0].toFixed(3) + ',\u2009' + composed[0][1].toFixed(3) + '</span><br>'
                    + '<span>' + composed[1][0].toFixed(3) + ',\u2009' + composed[1][1].toFixed(3) + '</span>'
                    + '</span>'
                    + '<span class="matrix-bracket bracket-right">]</span>'
                    + '</span>';
            } else {
                composedDiv.style.display = 'none';
            }
        }

        _animateAsync(from, to) {
            return new Promise(resolve => {
                const duration = 2200 - this.speed * 200;
                this.animation.start(from, to, duration, () => {
                    this.currentMatrix = this.copyMatrix(to);
                    this.displayMatrix = this.copyMatrix(to);
                    resolve();
                });
            });
        }

        async animateChainStepByStep() {
            if (this.chain.length < 2 || this.chainAnimating) return;
            this.chainAnimating = true;
            this._setChainButtonsEnabled(false);

            // Reset to identity
            const identity = [[1, 0], [0, 1]];
            this.currentMatrix = this.copyMatrix(identity);
            this.displayMatrix = this.copyMatrix(identity);
            this.render();
            this.updateMetrics(identity);
            this.updateDetBadge(identity);

            await new Promise(r => setTimeout(r, 300));

            let accumulated = this.copyMatrix(identity);

            for (let i = 0; i < this.chain.length; i++) {
                this._highlightChainStep(i);
                const next = mat2x2_matmul(this.chain[i].matrix, accumulated);
                await this._animateAsync(accumulated, next);
                accumulated = next;

                if (i < this.chain.length - 1) {
                    await new Promise(r => setTimeout(r, 400));
                }
            }

            this._setInputs(accumulated);
            this._clearChainHighlights();
            this.chainAnimating = false;
            this._setChainButtonsEnabled(true);
            this.updateChainUI();
        }

        async animateChainComposed() {
            if (this.chain.length < 2 || this.chainAnimating) return;
            this.chainAnimating = true;
            this._setChainButtonsEnabled(false);

            const composed = this.computeComposed();

            // Reset to identity
            const identity = [[1, 0], [0, 1]];
            this.currentMatrix = this.copyMatrix(identity);
            this.displayMatrix = this.copyMatrix(identity);
            this.render();
            this.updateMetrics(identity);
            this.updateDetBadge(identity);

            await new Promise(r => setTimeout(r, 300));

            await this._animateAsync(identity, composed);

            this._setInputs(composed);
            this.chainAnimating = false;
            this._setChainButtonsEnabled(true);
            this.updateChainUI();
        }

        _highlightChainStep(index) {
            document.querySelectorAll('.chain-chip').forEach((chip, i) => {
                chip.classList.toggle('chain-chip-active', i === index);
                chip.classList.toggle('chain-chip-done', i < index);
            });
        }

        _clearChainHighlights() {
            document.querySelectorAll('.chain-chip').forEach(chip => {
                chip.classList.remove('chain-chip-active');
                chip.classList.add('chain-chip-done');
            });
        }

        _setChainButtonsEnabled(enabled) {
            const disabled = !enabled;
            document.getElementById('btn-add-chain').disabled = disabled;
            document.getElementById('btn-chain-step').disabled = disabled;
            document.getElementById('btn-chain-composed').disabled = disabled;
            document.getElementById('btn-chain-clear').disabled = disabled;
            document.getElementById('btn-transform').disabled = disabled;
            document.getElementById('btn-reset').disabled = disabled;
        }

        _animateToTarget(target) {
            this.targetMatrix = this.copyMatrix(target);
            const from = this.copyMatrix(this.displayMatrix);
            // Speed 1 = 2000ms, 10 = 200ms
            const duration = 2200 - this.speed * 200;
            this.animation.start(from, target, duration);
        }

        _setInputs(W) {
            this.inputs.w00.value = parseFloat(W[0][0].toFixed(4));
            this.inputs.w01.value = parseFloat(W[0][1].toFixed(4));
            this.inputs.w10.value = parseFloat(W[1][0].toFixed(4));
            this.inputs.w11.value = parseFloat(W[1][1].toFixed(4));
        }

        copyMatrix(M) {
            return [[M[0][0], M[0][1]], [M[1][0], M[1][1]]];
        }

        render() {
            const ctx = this.ctx;
            const W = this.displayMatrix;
            const colors = getColors();

            VizLib.resetCanvasTransform(ctx, this.dpr);
            VizLib.clearCanvas(ctx, this.logicalWidth, this.logicalHeight, colors.bg);

            if (this.show.grid)   drawGrid(ctx, this.mapper, W, colors);
            if (this.show.circle) drawUnitCircle(ctx, this.mapper, W, colors);
            if (this.show.eigen)  drawEigenvectors(ctx, this.mapper, W, colors);
            if (this.show.data)   drawDataPoints(ctx, this.mapper, W, colors, this.dataPoints);
            if (this.show.basis)  drawBasisVectors(ctx, this.mapper, W, colors);

            drawOrigin(ctx, this.mapper, colors);
        }

        updateMetrics(W) {
            const det = mat2x2_det(W);
            const eigenInfo = mat2x2_eigenvalues(W);
            const sv = mat2x2_svd(W);
            const type = classifyTransformation(W);
            const rank = (Math.abs(det) < 1e-6) ? (sv[0] < 1e-6 ? 0 : 1) : 2;

            document.getElementById('metric-det').textContent = det.toFixed(3);
            document.getElementById('metric-type').textContent = type;
            document.getElementById('metric-rank').textContent = rank;
            document.getElementById('metric-svd').textContent =
                sv.map(v => v.toFixed(3)).join(', ');

            if (eigenInfo.real) {
                document.getElementById('metric-eigenvalues').textContent =
                    eigenInfo.values.map(v => v.toFixed(3)).join(', ');
            } else {
                const re = eigenInfo.values[0].toFixed(2);
                const im = Math.abs(eigenInfo.imag[0]).toFixed(2);
                document.getElementById('metric-eigenvalues').textContent =
                    `${re} \u00B1 ${im}i`;
            }
        }

        updateDetBadge(W) {
            const det = mat2x2_det(W);
            const badge = document.getElementById('det-badge');
            badge.textContent = `det(W) = ${det.toFixed(2)}`;

            // Remove old classes
            badge.classList.remove('low-loss', 'medium-loss', 'high-loss');

            if (Math.abs(det) < 0.01) {
                badge.classList.add('high-loss'); // singular — red
            } else if (det < 0) {
                badge.classList.add('medium-loss'); // reflection — yellow
            } else {
                badge.classList.add('low-loss'); // positive — green
            }
        }
    }

    // ============================================
    // Bootstrap
    // ============================================
    function init() {
        new LinearTransformVisualizer();

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

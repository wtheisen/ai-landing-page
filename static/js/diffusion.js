/**
 * Diffusion Models Visualizer
 *
 * Interactive visualization of forward and reverse diffusion processes
 * on 2D point distributions. Demonstrates how diffusion models progressively
 * add noise (forward) and remove noise (reverse) to generate data.
 *
 * The reverse process is simulated by interpolating between the noisy
 * distribution and the original, since true reverse diffusion requires
 * a trained neural network.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const MAIN_CANVAS_W = 560;
    const MAIN_CANVAS_H = 400;
    const SCHEDULE_CANVAS_W = 560;
    const SCHEDULE_CANVAS_H = 120;
    const NUM_POINTS = 300;
    const POINT_RADIUS = 2.5;

    // Noise schedule bounds (linear beta schedule)
    const BETA_START = 0.0001;
    const BETA_END = 0.02;

    // ============================================
    // State
    // ============================================
    let mainCanvas, mainCtx, mainDpr, mainLogW, mainLogH;
    let schedCanvas, schedCtx, schedDpr, schedLogW, schedLogH;

    let originalPoints = [];   // [{x, y}] original distribution in [-3, 3]
    let currentPoints = [];    // [{x, y}] current noisy/denoised positions
    let noiseEpsilons = [];    // [{x, y}] per-point noise vectors for closed-form forward

    let totalSteps = 50;
    let currentStep = 0;
    let processMode = 'forward';  // 'forward', 'reverse', 'both'
    let currentProcess = 'forward'; // which direction is currently running
    let distributionType = 'swiss-roll';
    let speed = 5;
    let isAnimating = false;
    let animTimer = null;

    // Precomputed noise schedule arrays
    let betas = [];
    let alphas = [];
    let alphaBars = [];

    // ============================================
    // Noise Schedule Computation
    // ============================================
    function computeSchedule(T) {
        betas = [];
        alphas = [];
        alphaBars = [];

        for (let t = 0; t < T; t++) {
            const beta = BETA_START + (BETA_END - BETA_START) * (t / (T - 1));
            betas.push(beta);
            alphas.push(1 - beta);
        }

        let cumProd = 1;
        for (let t = 0; t < T; t++) {
            cumProd *= alphas[t];
            alphaBars.push(cumProd);
        }
    }

    // ============================================
    // Distribution Generators
    // ============================================
    function generateDistribution(type, n) {
        const points = [];

        switch (type) {
            case 'swiss-roll':
                for (let i = 0; i < n; i++) {
                    const t = 1.5 * Math.PI * (1 + 2 * Math.random());
                    const x = t * Math.cos(t) * 0.15;
                    const y = t * Math.sin(t) * 0.15;
                    points.push({ x: x + gaussianRandom() * 0.08, y: y + gaussianRandom() * 0.08 });
                }
                break;

            case 'two-moons':
                for (let i = 0; i < n; i++) {
                    if (i < n / 2) {
                        const angle = Math.PI * Math.random();
                        points.push({
                            x: Math.cos(angle) + gaussianRandom() * 0.08,
                            y: Math.sin(angle) + gaussianRandom() * 0.08
                        });
                    } else {
                        const angle = Math.PI * Math.random();
                        points.push({
                            x: 1 - Math.cos(angle) + gaussianRandom() * 0.08,
                            y: -Math.sin(angle) + 0.5 + gaussianRandom() * 0.08
                        });
                    }
                }
                break;

            case 'gaussian-mixture': {
                const centers = [
                    { x: -1.2, y: -1.2 },
                    { x: 1.2, y: -1.2 },
                    { x: 0, y: 1.5 },
                    { x: -1.5, y: 0.8 },
                    { x: 1.5, y: 0.8 }
                ];
                for (let i = 0; i < n; i++) {
                    const c = centers[i % centers.length];
                    points.push({
                        x: c.x + gaussianRandom() * 0.25,
                        y: c.y + gaussianRandom() * 0.25
                    });
                }
                break;
            }

            case 'ring':
                for (let i = 0; i < n; i++) {
                    const angle = 2 * Math.PI * Math.random();
                    const r = 1.8 + gaussianRandom() * 0.15;
                    points.push({
                        x: r * Math.cos(angle),
                        y: r * Math.sin(angle)
                    });
                }
                break;

            default:
                return generateDistribution('swiss-roll', n);
        }

        return points;
    }

    // gaussianRandom assigned in init() after VizLib is available
    let gaussianRandom;

    // ============================================
    // Diffusion Process
    // ============================================

    /**
     * Generate per-point noise vectors (sampled once, reused for closed-form).
     */
    function generateNoiseVectors(n) {
        noiseEpsilons = [];
        for (let i = 0; i < n; i++) {
            noiseEpsilons.push({ x: gaussianRandom(), y: gaussianRandom() });
        }
    }

    /**
     * Compute points at timestep t using the closed-form forward formula:
     * x_t = sqrt(alpha_bar_t) * x_0 + sqrt(1 - alpha_bar_t) * epsilon
     */
    function getForwardPoints(t) {
        if (t <= 0) return originalPoints.map(p => ({ x: p.x, y: p.y }));

        const stepIdx = Math.min(t - 1, alphaBars.length - 1);
        const aBar = alphaBars[stepIdx];
        const sqrtABar = Math.sqrt(aBar);
        const sqrtOneMinusABar = Math.sqrt(1 - aBar);

        return originalPoints.map((p, i) => ({
            x: sqrtABar * p.x + sqrtOneMinusABar * noiseEpsilons[i].x,
            y: sqrtABar * p.y + sqrtOneMinusABar * noiseEpsilons[i].y
        }));
    }

    /**
     * Simulated reverse process: interpolate from noise back to original.
     * At step t in reverse (counting from T down to 0), we use a smooth
     * interpolation that mirrors the noise schedule.
     */
    function getReversePoints(t) {
        // t goes from totalSteps (pure noise) down to 0 (clean)
        // We compute the same as forward at step t, creating a smooth denoising
        return getForwardPoints(t);
    }

    // ============================================
    // Coordinate Mapping
    // ============================================
    const COORD_RANGE = 3.5;

    function dataToCanvasX(x) {
        return (x + COORD_RANGE) / (2 * COORD_RANGE) * mainLogW;
    }

    function dataToCanvasY(y) {
        return (COORD_RANGE - y) / (2 * COORD_RANGE) * mainLogH;
    }

    // ============================================
    // Colors
    // ============================================
    function getColors() {
        const isDark = VizLib.ThemeManager.isDarkTheme();
        return {
            bg:           isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            original:     isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            originalGhost: isDark ? EAIColor('blue', 0.2, 'dark') : EAIColor('blue', 0.15),
            noiseLow:     isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light'),
            noiseHigh:    isDark ? EAIColor('gold-strong', 'dark') : EAIColor('gold-strong', 'light'),
            noiseMid:     isDark ? EAIColor('gold', 'dark') : EAIColor('gold', 'light'),
            grid:         isDark ? EAIColor('muted', 0.1, 'dark') : 'rgba(0,0,0,0.06)',
            axis:         isDark ? EAIColor('muted', 0.25, 'dark') : 'rgba(0,0,0,0.12)',
            text:         isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            textMuted:    isDark ? EAIColor('muted', 'dark') : EAIColor('muted', 'light'),

            // Schedule canvas
            schedBg:      isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            schedLine:    isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            schedFill:    isDark ? EAIColor('blue', 0.2, 'dark') : EAIColor('blue', 0.15),
            schedMarker:  isDark ? EAIColor('red', 'dark') : EAIColor('red', 'light'),
            schedGrid:    isDark ? EAIColor('muted', 0.15, 'dark') : 'rgba(0,0,0,0.08)',
            schedAxis:    isDark ? EAIColor('muted', 0.3, 'dark') : 'rgba(0,0,0,0.2)',
            schedText:    isDark ? EAIColor('muted', 'dark') : EAIColor('muted', 'light')
        };
    }

    /**
     * Interpolate color from green (low noise) through yellow to orange (high noise)
     */
    function getNoiseColor(noiseRatio, colors) {
        if (noiseRatio < 0.5) {
            return lerpColor(colors.noiseLow, colors.noiseMid, noiseRatio * 2);
        } else {
            return lerpColor(colors.noiseMid, colors.noiseHigh, (noiseRatio - 0.5) * 2);
        }
    }

    function lerpColor(c1, c2, t) {
        const r1 = parseInt(c1.slice(1, 3), 16);
        const g1 = parseInt(c1.slice(3, 5), 16);
        const b1 = parseInt(c1.slice(5, 7), 16);
        const r2 = parseInt(c2.slice(1, 3), 16);
        const g2 = parseInt(c2.slice(3, 5), 16);
        const b2 = parseInt(c2.slice(5, 7), 16);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
    }

    // ============================================
    // Main Canvas Rendering
    // ============================================
    function renderMain() {
        const ctx = mainCtx;
        const colors = getColors();

        VizLib.resetCanvasTransform(ctx, mainDpr);
        VizLib.clearCanvas(ctx, mainLogW, mainLogH, colors.bg);

        // Draw subtle grid
        drawGrid(ctx, colors);

        // Draw original distribution as ghosts
        ctx.fillStyle = colors.originalGhost;
        for (const p of originalPoints) {
            const cx = dataToCanvasX(p.x);
            const cy = dataToCanvasY(p.y);
            ctx.beginPath();
            ctx.arc(cx, cy, POINT_RADIUS + 1, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw current points colored by noise level
        const noiseRatio = currentStep / totalSteps;
        for (let i = 0; i < currentPoints.length; i++) {
            const p = currentPoints[i];
            const cx = dataToCanvasX(p.x);
            const cy = dataToCanvasY(p.y);

            const color = getNoiseColor(noiseRatio, colors);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.arc(cx, cy, POINT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Draw step label
        ctx.fillStyle = colors.textMuted;
        ctx.font = '11px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim().split(',')[0].replace(/'/g, '');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const label = currentProcess === 'forward' ? 'Forward' : 'Reverse';
        ctx.fillText(label + ' t=' + currentStep + '/' + totalSteps, 8, 8);

        // Show alpha_bar value
        if (currentStep > 0 && currentStep <= totalSteps) {
            const aBar = alphaBars[Math.min(currentStep - 1, alphaBars.length - 1)];
            ctx.fillText('\u03B1\u0304_t = ' + aBar.toFixed(4), 8, 22);
        } else if (currentStep === 0) {
            ctx.fillText('\u03B1\u0304_t = 1.0000', 8, 22);
        }
    }

    function drawGrid(ctx, colors) {
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;

        // Vertical lines
        for (let x = -3; x <= 3; x++) {
            const cx = dataToCanvasX(x);
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, mainLogH);
            ctx.stroke();
        }

        // Horizontal lines
        for (let y = -3; y <= 3; y++) {
            const cy = dataToCanvasY(y);
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(mainLogW, cy);
            ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = colors.axis;
        ctx.lineWidth = 1.5;
        const ox = dataToCanvasX(0);
        const oy = dataToCanvasY(0);
        ctx.beginPath();
        ctx.moveTo(ox, 0);
        ctx.lineTo(ox, mainLogH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, oy);
        ctx.lineTo(mainLogW, oy);
        ctx.stroke();
    }

    // ============================================
    // Schedule Canvas Rendering
    // ============================================
    function renderSchedule() {
        const ctx = schedCtx;
        const colors = getColors();
        const PAD_L = 45, PAD_R = 15, PAD_T = 15, PAD_B = 25;
        const plotW = schedLogW - PAD_L - PAD_R;
        const plotH = schedLogH - PAD_T - PAD_B;

        VizLib.resetCanvasTransform(ctx, schedDpr);
        VizLib.clearCanvas(ctx, schedLogW, schedLogH, colors.schedBg);

        // Y-axis: alpha_bar_t from 0 to 1
        // X-axis: timestep from 0 to T

        // Grid lines
        ctx.strokeStyle = colors.schedGrid;
        ctx.lineWidth = 1;
        for (let v = 0; v <= 1; v += 0.25) {
            const y = PAD_T + plotH * (1 - v);
            ctx.beginPath();
            ctx.moveTo(PAD_L, y);
            ctx.lineTo(PAD_L + plotW, y);
            ctx.stroke();
        }

        // Axis labels
        ctx.fillStyle = colors.schedText;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let v = 0; v <= 1; v += 0.5) {
            const y = PAD_T + plotH * (1 - v);
            ctx.fillText(v.toFixed(1), PAD_L - 5, y);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('0', PAD_L, PAD_T + plotH + 5);
        ctx.fillText(String(totalSteps), PAD_L + plotW, PAD_T + plotH + 5);
        ctx.fillText('Timestep t', PAD_L + plotW / 2, PAD_T + plotH + 12);

        // Y-axis label
        ctx.save();
        ctx.translate(12, PAD_T + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u03B1\u0304_t', 0, 0);
        ctx.restore();

        // Draw alpha_bar curve with fill
        if (alphaBars.length > 0) {
            // Fill under curve
            ctx.fillStyle = colors.schedFill;
            ctx.beginPath();
            ctx.moveTo(PAD_L, PAD_T + plotH);
            // Step 0: alpha_bar = 1
            ctx.lineTo(PAD_L, PAD_T + plotH * (1 - 1));
            for (let t = 0; t < alphaBars.length; t++) {
                const x = PAD_L + ((t + 1) / totalSteps) * plotW;
                const y = PAD_T + plotH * (1 - alphaBars[t]);
                ctx.lineTo(x, y);
            }
            ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
            ctx.closePath();
            ctx.fill();

            // Draw curve line
            ctx.strokeStyle = colors.schedLine;
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Start from alpha_bar = 1 at t=0
            ctx.moveTo(PAD_L, PAD_T + plotH * (1 - 1));
            for (let t = 0; t < alphaBars.length; t++) {
                const x = PAD_L + ((t + 1) / totalSteps) * plotW;
                const y = PAD_T + plotH * (1 - alphaBars[t]);
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Draw current step marker
        if (currentStep >= 0 && currentStep <= totalSteps) {
            let aBarVal = (currentStep === 0) ? 1.0 : alphaBars[Math.min(currentStep - 1, alphaBars.length - 1)];
            const mx = PAD_L + (currentStep / totalSteps) * plotW;
            const my = PAD_T + plotH * (1 - aBarVal);

            // Vertical dashed line
            ctx.strokeStyle = colors.schedMarker;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, PAD_T);
            ctx.lineTo(mx, PAD_T + plotH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Marker dot
            ctx.fillStyle = colors.schedMarker;
            ctx.beginPath();
            ctx.arc(mx, my, 5, 0, Math.PI * 2);
            ctx.fill();

            // White center
            ctx.fillStyle = colors.schedBg;
            ctx.beginPath();
            ctx.arc(mx, my, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Axes border
        ctx.strokeStyle = colors.schedAxis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(PAD_L, PAD_T);
        ctx.lineTo(PAD_L, PAD_T + plotH);
        ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
        ctx.stroke();
    }

    // ============================================
    // Metrics Update
    // ============================================
    function updateMetrics() {
        document.getElementById('metric-step').textContent = currentStep;
        document.getElementById('metric-total-steps').textContent = totalSteps;
        document.getElementById('metric-process').textContent =
            currentProcess === 'forward' ? 'Forward' : 'Reverse';

        let aBar;
        if (currentStep === 0) {
            aBar = 1.0;
        } else {
            aBar = alphaBars[Math.min(currentStep - 1, alphaBars.length - 1)];
        }
        document.getElementById('metric-noise-level').textContent = aBar.toFixed(4);

        const distNames = {
            'swiss-roll': 'Swiss Roll',
            'two-moons': 'Two Moons',
            'gaussian-mixture': 'Gaussian Mixture',
            'ring': 'Ring'
        };
        document.getElementById('metric-distribution').textContent =
            distNames[distributionType] || distributionType;

        // Status
        let status;
        if (isAnimating) {
            status = currentProcess === 'forward' ? 'Adding noise...' : 'Denoising...';
        } else if (currentStep === 0) {
            status = 'Ready';
        } else if (currentStep === totalSteps) {
            status = currentProcess === 'forward' ? 'Pure noise' : 'Complete';
        } else {
            status = 'Paused at step ' + currentStep;
        }
        document.getElementById('metric-status').textContent = status;

        // Update badge
        const badge = document.getElementById('step-badge');
        badge.textContent = 'Step ' + currentStep + ' / ' + totalSteps;

        badge.classList.remove('low-loss', 'medium-loss', 'high-loss');
        if (aBar > 0.7) {
            badge.classList.add('low-loss');     // Low noise (mostly signal)
        } else if (aBar > 0.3) {
            badge.classList.add('medium-loss');  // Medium noise
        } else {
            badge.classList.add('high-loss');    // High noise
        }
    }

    // ============================================
    // Render All
    // ============================================
    function renderAll() {
        renderMain();
        renderSchedule();
        updateMetrics();
    }

    // ============================================
    // Animation
    // ============================================
    function stopAnimation() {
        isAnimating = false;
        if (animTimer) {
            clearTimeout(animTimer);
            animTimer = null;
        }
    }

    function getDelay() {
        // Speed 1 = 500ms, Speed 10 = 30ms
        return Math.max(30, 550 - speed * 52);
    }

    function runForward() {
        stopAnimation();
        currentProcess = 'forward';

        if (currentStep >= totalSteps) {
            // Already at end, reset first
            currentStep = 0;
            currentPoints = getForwardPoints(0);
        }

        isAnimating = true;
        renderAll();
        stepForwardAnim();
    }

    function stepForwardAnim() {
        if (!isAnimating) return;
        if (currentStep >= totalSteps) {
            isAnimating = false;

            if (processMode === 'both') {
                // After forward completes, start reverse
                setTimeout(function() { runReverse(); }, getDelay() * 2);
            } else {
                renderAll();
            }
            return;
        }

        currentStep++;
        currentPoints = getForwardPoints(currentStep);
        renderAll();

        animTimer = setTimeout(stepForwardAnim, getDelay());
    }

    function runReverse() {
        stopAnimation();
        currentProcess = 'reverse';

        if (currentStep <= 0) {
            // Start from pure noise
            currentStep = totalSteps;
            currentPoints = getForwardPoints(totalSteps);
        }

        isAnimating = true;
        renderAll();
        stepReverseAnim();
    }

    function stepReverseAnim() {
        if (!isAnimating) return;
        if (currentStep <= 0) {
            isAnimating = false;
            renderAll();
            return;
        }

        currentStep--;
        currentPoints = getReversePoints(currentStep);
        renderAll();

        animTimer = setTimeout(stepReverseAnim, getDelay());
    }

    function stepOnce() {
        stopAnimation();

        if (currentProcess === 'forward') {
            if (currentStep < totalSteps) {
                currentStep++;
                currentPoints = getForwardPoints(currentStep);
            }
        } else {
            if (currentStep > 0) {
                currentStep--;
                currentPoints = getReversePoints(currentStep);
            }
        }

        renderAll();
    }

    function resetVisualization() {
        stopAnimation();
        currentStep = 0;
        currentProcess = 'forward';

        originalPoints = generateDistribution(distributionType, NUM_POINTS);
        generateNoiseVectors(originalPoints.length);
        computeSchedule(totalSteps);
        currentPoints = getForwardPoints(0);

        renderAll();
    }

    // ============================================
    // Controls Binding
    // ============================================
    function bindControls() {
        // Distribution select
        document.getElementById('distribution-select').addEventListener('change', function(e) {
            distributionType = e.target.value;
            resetVisualization();
        });

        // Steps slider
        var stepsSlider = document.getElementById('steps-slider');
        var stepsValue = document.getElementById('steps-value');
        stepsSlider.addEventListener('input', function(e) {
            totalSteps = parseInt(e.target.value);
            stepsValue.textContent = totalSteps;
            computeSchedule(totalSteps);
            // Re-generate noise vectors to match new schedule
            generateNoiseVectors(originalPoints.length);
            currentStep = 0;
            currentPoints = getForwardPoints(0);
            renderAll();
        });

        // Process select
        document.getElementById('process-select').addEventListener('change', function(e) {
            processMode = e.target.value;
        });

        // Speed slider
        var speedSlider = document.getElementById('speed-slider');
        var speedValue = document.getElementById('speed-value');
        speedSlider.addEventListener('input', function(e) {
            speed = parseInt(e.target.value);
            speedValue.textContent = speed;
        });

        // Buttons
        document.getElementById('btn-forward').addEventListener('click', function() {
            if (processMode === 'both') {
                // In 'both' mode, forward button runs full forward then reverse
                currentStep = 0;
                currentPoints = getForwardPoints(0);
                currentProcess = 'forward';
                runForward();
            } else {
                currentProcess = 'forward';
                runForward();
            }
        });

        document.getElementById('btn-reverse').addEventListener('click', function() {
            currentProcess = 'reverse';
            runReverse();
        });

        document.getElementById('btn-step').addEventListener('click', function() {
            stepOnce();
        });

        document.getElementById('btn-reset').addEventListener('click', function() {
            resetVisualization();
        });
    }

    // ============================================
    // Theme Change Handler
    // ============================================
    function bindThemeChange() {
        VizLib.ThemeManager.onThemeChange(function() {
            renderAll();
        });
    }

    // ============================================
    // Info Panel Tab Wiring
    // ============================================
    function wireInfoTabs() {
        var tabButtons = document.querySelectorAll('.info-panel-tabs [data-tab]');
        tabButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                tabButtons.forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var panel = btn.closest('.panel');
                panel.querySelectorAll('.info-tab-content').forEach(function(c) {
                    c.classList.remove('active');
                });
                var target = panel.querySelector('#tab-' + btn.dataset.tab);
                if (target) target.classList.add('active');
            });
        });
    }

    // ============================================
    // Initialization
    // ============================================
    function init() {
        gaussianRandom = VizLib.MathUtils.gaussian;

        // Set up main canvas
        mainCanvas = document.getElementById('diffusion-canvas');
        if (!mainCanvas) return;

        var mainSetup = VizLib.setupHiDPICanvas(mainCanvas);
        mainCtx = mainSetup.ctx;
        mainDpr = mainSetup.dpr;
        mainLogW = mainSetup.logicalWidth;
        mainLogH = mainSetup.logicalHeight;

        // Set up schedule canvas
        schedCanvas = document.getElementById('schedule-canvas');
        if (!schedCanvas) return;

        var schedSetup = VizLib.setupHiDPICanvas(schedCanvas);
        schedCtx = schedSetup.ctx;
        schedDpr = schedSetup.dpr;
        schedLogW = schedSetup.logicalWidth;
        schedLogH = schedSetup.logicalHeight;

        // Generate initial data
        computeSchedule(totalSteps);
        originalPoints = generateDistribution(distributionType, NUM_POINTS);
        generateNoiseVectors(originalPoints.length);
        currentPoints = getForwardPoints(0);

        bindControls();
        bindThemeChange();
        wireInfoTabs();
        renderAll();
    }

    // ============================================
    // Bootstrap
    // ============================================
    window.addEventListener('vizlib-ready', init);
})();

/**
 * Polynomial Regression Visualizer
 *
 * Interactive visualization of polynomial regression with normal equation
 * and gradient descent methods. Supports point placement, residuals,
 * loss curve plotting, and loss surface contour visualization.
 */
(function() {
    'use strict';

    let CANVAS_W, CANVAS_H;
    const POINT_R = 6;
    const AXIS_PAD = 40;
    const PLOT_L = AXIS_PAD, PLOT_T = 10;
    let PLOT_W, PLOT_H;

    // Data range in data-space
    const DATA_MIN = 0, DATA_MAX = 10;
    const MAX_DEGREE = 8;

    // State — coefficients are arrays [c0, c1, c2, ...] for y = c0 + c1*x + c2*x² + ...
    let points = [];
    let polyDegree = 1;
    let fitCoeffs = null;       // animated, what gets drawn
    let targetCoeffs = null;    // computed target fitCoeffs lerps toward
    let gdCoeffs = null;        // during GD animation
    let gdHistory = [];         // [{coeffs, loss}]
    let gdTimer = null;
    let gdIteration = 0;
    let editMode = 'add';
    let method = 'normal';
    let mathSymbolic = { sums: true, slope: true, intercept: true, vander: true, normal: true };
    let animFrameId = null;
    const LERP = 0.10;

    // Line-dragging state
    let draggingLine = false;
    let didDrag = false;
    let dragStartCx = 0, dragStartCy = 0;  // mousedown canvas coords (for threshold)
    let dragOriginalCoeffs = null;           // fitCoeffs snapshot at drag start
    let dragGrabYOnCurve = 0;               // curve's y-value at grab point
    let dragHandleIdx = -1;                  // -1 = body, 0/1/2 = L/C/R handle
    let dragPivotX = 0, dragPivotY = 0;     // pivot point for endpoint drags
    let hoveredHandle = -1;                  // -1 = none, 0/1/2 = hovered handle

    // Canvas
    let canvas, ctx, dpr;
    let lossCanvas, lossCtx, lossDpr;
    let lossCurveCanvas, lossCurveCtx, lossCurveDpr;

    // ============================================
    // Coordinate transforms
    // ============================================
    function dataToCanvas(dx, dy) {
        const cx = PLOT_L + ((dx - DATA_MIN) / (DATA_MAX - DATA_MIN)) * PLOT_W;
        const cy = PLOT_T + PLOT_H - ((dy - DATA_MIN) / (DATA_MAX - DATA_MIN)) * PLOT_H;
        return { x: cx, y: cy };
    }

    function canvasToData(cx, cy) {
        const dx = DATA_MIN + ((cx - PLOT_L) / PLOT_W) * (DATA_MAX - DATA_MIN);
        const dy = DATA_MIN + ((PLOT_T + PLOT_H - cy) / PLOT_H) * (DATA_MAX - DATA_MIN);
        return { x: dx, y: dy };
    }

    // ============================================
    // Dataset generators
    // ============================================
    function generateDataset(type) {
        points = [];
        const n = 30;
        switch (type) {
            case 'linear':
                for (let i = 0; i < n; i++) {
                    const x = 1 + Math.random() * 8;
                    const y = 0.8 * x + 1.5 + (Math.random() - 0.5) * 2.5;
                    points.push({ x, y: Math.max(0.2, Math.min(9.8, y)) });
                }
                break;
            case 'quadratic':
                for (let i = 0; i < n; i++) {
                    const x = 0.5 + Math.random() * 9;
                    const y = 0.15 * (x - 5) * (x - 5) + 2 + (Math.random() - 0.5) * 1.5;
                    points.push({ x, y: Math.max(0.2, Math.min(9.8, y)) });
                }
                break;
            case 'sine':
                for (let i = 0; i < n; i++) {
                    const x = 0.5 + Math.random() * 9;
                    const y = 5 + 2.5 * Math.sin(x * 0.8) + (Math.random() - 0.5) * 1.5;
                    points.push({ x, y: Math.max(0.2, Math.min(9.8, y)) });
                }
                break;
            case 'cluster':
                const centers = [{ x: 2, y: 3 }, { x: 5, y: 5 }, { x: 8, y: 7 }];
                centers.forEach(c => {
                    for (let i = 0; i < 10; i++) {
                        points.push({
                            x: c.x + (Math.random() - 0.5) * 2,
                            y: c.y + (Math.random() - 0.5) * 2
                        });
                    }
                });
                break;
            case 'outliers':
                for (let i = 0; i < n - 3; i++) {
                    const x = 1 + Math.random() * 8;
                    const y = 0.7 * x + 2 + (Math.random() - 0.5) * 1.2;
                    points.push({ x, y: Math.max(0.2, Math.min(9.8, y)) });
                }
                points.push({ x: 2, y: 9 });
                points.push({ x: 8, y: 1 });
                points.push({ x: 5, y: 9.5 });
                break;
        }
    }

    // ============================================
    // Polynomial math
    // ============================================
    function evalPoly(coeffs, x) {
        let y = 0, xp = 1;
        for (let i = 0; i < coeffs.length; i++) { y += coeffs[i] * xp; xp *= x; }
        return y;
    }

    function solveSystem(A, b) {
        const n = A.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
            }
            [M[col], M[maxRow]] = [M[maxRow], M[col]];
            if (Math.abs(M[col][col]) < 1e-12) return null;
            for (let row = col + 1; row < n; row++) {
                const f = M[row][col] / M[col][col];
                for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
            }
        }
        const x = new Array(n);
        for (let i = n - 1; i >= 0; i--) {
            x[i] = M[i][n];
            for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
            x[i] /= M[i][i];
        }
        return x;
    }

    function polyFit(pts, degree) {
        if (pts.length <= degree) return null;
        const n = pts.length;
        const d = degree + 1;
        const A = [], rhs = [];
        for (let i = 0; i < d; i++) {
            A[i] = [];
            for (let j = 0; j < d; j++) {
                let s = 0;
                for (const p of pts) s += Math.pow(p.x, i + j);
                A[i][j] = s;
            }
            let s = 0;
            for (const p of pts) s += Math.pow(p.x, i) * p.y;
            rhs[i] = s;
        }
        return solveSystem(A, rhs);
    }

    function computeMSE(pts, coeffs) {
        if (pts.length === 0) return 0;
        let sum = 0;
        for (const p of pts) {
            const err = p.y - evalPoly(coeffs, p.x);
            sum += err * err;
        }
        return sum / pts.length;
    }

    function computeR2(pts, coeffs) {
        if (pts.length < 2) return 0;
        const mean = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        let ssTot = 0, ssRes = 0;
        for (const p of pts) {
            ssTot += (p.y - mean) ** 2;
            ssRes += (p.y - evalPoly(coeffs, p.x)) ** 2;
        }
        if (ssTot === 0) return 1;
        return 1 - ssRes / ssTot;
    }

    function gradientStep(pts, coeffs, lr) {
        const n = pts.length;
        const d = coeffs.length;
        const grad = new Array(d).fill(0);
        for (const p of pts) {
            const err = p.y - evalPoly(coeffs, p.x);
            let xp = 1;
            for (let k = 0; k < d; k++) { grad[k] += -2 * xp * err / n; xp *= p.x; }
        }
        return coeffs.map((c, i) => c - lr * grad[i]);
    }

    // Helper: make a zero coeffs array for given degree with intercept at mid
    function flatCoeffs(intercept) {
        const c = new Array(polyDegree + 1).fill(0);
        c[0] = intercept;
        return c;
    }

    // ============================================
    // Drawing
    // ============================================
    function getThemeColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            point: style.getPropertyValue('--lr-point-color').trim() || '#377eb8',
            pointStroke: style.getPropertyValue('--lr-point-stroke').trim() || '#2a5f8f',
            fitLine: style.getPropertyValue('--lr-fit-color').trim() || '#e41a1c',
            residual: style.getPropertyValue('--lr-residual-color').trim() || 'rgba(76,175,80,0.5)',
            gdLine: style.getPropertyValue('--lr-gd-color').trim() || '#ff9800',
            text: style.getPropertyValue('--viz-text').trim() || '#333',
            muted: style.getPropertyValue('--viz-text-muted').trim() || '#6c757d',
            border: style.getPropertyValue('--viz-border').trim() || '#dee2e6',
            bg: '#ffffff',
        };
    }

    function render() {
        const c = getThemeColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(ctx, dpr);
        CU.clearCanvas(ctx, CANVAS_W, CANVAS_H, c.bg);

        drawAxes(c);
        drawGridLines(c);

        // Residuals
        const active = gdCoeffs || fitCoeffs;
        if (active && points.length > 0) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = c.residual;
            ctx.lineWidth = 1.5;
            for (const p of points) {
                const predicted = evalPoly(active, p.x);
                const from = dataToCanvas(p.x, p.y);
                const to = dataToCanvas(p.x, predicted);
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // Fit curve
        if (fitCoeffs) {
            drawCurve(fitCoeffs, c.fitLine, 2.5, false);
        }

        // GD curve (animated)
        if (gdCoeffs) {
            drawCurve(gdCoeffs, c.gdLine, 2, true);
        }

        // Points
        for (const p of points) {
            const cp = dataToCanvas(p.x, p.y);
            ctx.fillStyle = c.point;
            ctx.strokeStyle = c.pointStroke;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, POINT_R, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Handles on the fit curve
        if (fitCoeffs && !gdCoeffs && gdTimer === null) {
            drawHandles(c);
        }
    }

    function buildEquationString(coeffs) {
        let parts = [];
        for (let i = coeffs.length - 1; i >= 0; i--) {
            const v = coeffs[i];
            const av = Math.abs(v);
            let term = '';
            if (i === 0) term = av.toFixed(2);
            else if (i === 1) term = av.toFixed(2) + 'x';
            else term = av.toFixed(2) + 'x' + superscript(i);
            if (parts.length === 0) {
                parts.push((v < 0 ? '−' : '') + term);
            } else {
                parts.push((v < 0 ? ' − ' : ' + ') + term);
            }
        }
        return 'y = ' + parts.join('');
    }

    function superscript(n) {
        const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
        return String(n).split('').map(d => sup[+d]).join('');
    }

    function subscript(n) {
        const sub = '₀₁₂₃₄₅₆₇₈₉';
        return String(n).split('').map(d => sub[+d]).join('');
    }

    function drawAxes(c) {
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PLOT_L, PLOT_T + PLOT_H);
        ctx.lineTo(PLOT_L + PLOT_W, PLOT_T + PLOT_H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PLOT_L, PLOT_T);
        ctx.lineTo(PLOT_L, PLOT_T + PLOT_H);
        ctx.stroke();

        ctx.fillStyle = c.muted;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let v = 0; v <= 10; v += 2) {
            const pos = dataToCanvas(v, 0);
            ctx.fillText(v, pos.x, PLOT_T + PLOT_H + 16);
        }
        ctx.textAlign = 'right';
        for (let v = 0; v <= 10; v += 2) {
            const pos = dataToCanvas(0, v);
            ctx.fillText(v, PLOT_L - 6, pos.y + 4);
        }
    }

    function drawGridLines(c) {
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 0.3;
        ctx.setLineDash([2, 4]);
        for (let v = 2; v <= 10; v += 2) {
            const h = dataToCanvas(0, v);
            ctx.beginPath(); ctx.moveTo(PLOT_L, h.y); ctx.lineTo(PLOT_L + PLOT_W, h.y); ctx.stroke();
            const vv = dataToCanvas(v, 0);
            ctx.beginPath(); ctx.moveTo(vv.x, PLOT_T); ctx.lineTo(vv.x, PLOT_T + PLOT_H); ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    function drawCurve(coeffs, color, width, dashed) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(PLOT_L, PLOT_T, PLOT_W, PLOT_H);
        ctx.clip();

        if (dashed) ctx.setLineDash([6, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        const steps = 200;
        for (let i = 0; i <= steps; i++) {
            const dx = DATA_MIN + (DATA_MAX - DATA_MIN) * i / steps;
            const dy = evalPoly(coeffs, dx);
            const cp = dataToCanvas(dx, dy);
            if (i === 0) ctx.moveTo(cp.x, cp.y);
            else ctx.lineTo(cp.x, cp.y);
        }
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
        ctx.restore();
    }

    // ============================================
    // Loss curve
    // ============================================
    function renderLossCurve() {
        if (!lossCurveCanvas || gdHistory.length < 2) return;
        const CU = window.VizLib.CanvasUtils;
        const c = getThemeColors();
        const W = 300, H = 180;
        const pad = { l: 40, r: 10, t: 10, b: 25 };

        CU.resetCanvasTransform(lossCurveCtx, lossCurveDpr);
        CU.clearCanvas(lossCurveCtx, W, H, c.bg);

        const maxLoss = Math.max(...gdHistory.map(h => h.loss)) * 1.1;
        const pw = W - pad.l - pad.r;
        const ph = H - pad.t - pad.b;

        lossCurveCtx.strokeStyle = c.border;
        lossCurveCtx.lineWidth = 1;
        lossCurveCtx.beginPath();
        lossCurveCtx.moveTo(pad.l, pad.t);
        lossCurveCtx.lineTo(pad.l, pad.t + ph);
        lossCurveCtx.lineTo(pad.l + pw, pad.t + ph);
        lossCurveCtx.stroke();

        lossCurveCtx.fillStyle = c.muted;
        lossCurveCtx.font = '9px sans-serif';
        lossCurveCtx.textAlign = 'center';
        lossCurveCtx.fillText('Iteration', pad.l + pw / 2, H - 2);
        lossCurveCtx.save();
        lossCurveCtx.translate(10, pad.t + ph / 2);
        lossCurveCtx.rotate(-Math.PI / 2);
        lossCurveCtx.fillText('MSE', 0, 0);
        lossCurveCtx.restore();

        lossCurveCtx.strokeStyle = c.fitLine;
        lossCurveCtx.lineWidth = 2;
        lossCurveCtx.beginPath();
        for (let i = 0; i < gdHistory.length; i++) {
            const x = pad.l + (i / (gdHistory.length - 1)) * pw;
            const y = pad.t + ph - (gdHistory[i].loss / maxLoss) * ph;
            if (i === 0) lossCurveCtx.moveTo(x, y);
            else lossCurveCtx.lineTo(x, y);
        }
        lossCurveCtx.stroke();
    }

    // ============================================
    // Loss surface (contour) — only for degree 1
    // ============================================
    function renderLossSurface() {
        if (!lossCanvas || points.length < 2 || polyDegree > 1) return;
        const CU = window.VizLib.CanvasUtils;
        const c = getThemeColors();
        const W = 560, H = 280;
        const pad = { l: 50, r: 20, t: 15, b: 30 };
        const pw = W - pad.l - pad.r;
        const ph = H - pad.t - pad.b;

        CU.resetCanvasTransform(lossCtx, lossDpr);
        CU.clearCanvas(lossCtx, W, H, c.bg);

        const optCoeffs = polyFit(points, 1);
        if (!optCoeffs) return;
        const optM = optCoeffs[1], optB = optCoeffs[0];

        const mRange = Math.max(2, Math.abs(optM) * 2);
        const bRange = Math.max(4, Math.abs(optB) * 2);
        const mMin = optM - mRange, mMax = optM + mRange;
        const bMin = optB - bRange, bMax = optB + bRange;

        const res = 60;
        const grid = [];
        let minLoss = Infinity, maxLoss = 0;
        for (let i = 0; i < res; i++) {
            grid[i] = [];
            for (let j = 0; j < res; j++) {
                const m = mMin + (mMax - mMin) * i / (res - 1);
                const b = bMin + (bMax - bMin) * j / (res - 1);
                const loss = computeMSE(points, [b, m]);
                grid[i][j] = loss;
                if (loss < minLoss) minLoss = loss;
                if (loss > maxLoss) maxLoss = loss;
            }
        }

        const cellW = pw / res;
        const cellH = ph / res;
        for (let i = 0; i < res; i++) {
            for (let j = 0; j < res; j++) {
                const t = Math.log(grid[i][j] - minLoss + 1) / Math.log(maxLoss - minLoss + 1);
                const r = Math.round(33 + t * 200);
                const g = Math.round(150 - t * 100);
                const b2 = Math.round(243 - t * 180);
                lossCtx.fillStyle = `rgb(${r},${g},${b2})`;
                lossCtx.fillRect(pad.l + i * cellW, pad.t + (res - 1 - j) * cellH, cellW + 1, cellH + 1);
            }
        }

        const optX = pad.l + ((optM - mMin) / (mMax - mMin)) * pw;
        const optY = pad.t + ph - ((optB - bMin) / (bMax - bMin)) * ph;
        lossCtx.fillStyle = '#fff';
        lossCtx.strokeStyle = c.fitLine;
        lossCtx.lineWidth = 2;
        lossCtx.beginPath();
        lossCtx.arc(optX, optY, 5, 0, Math.PI * 2);
        lossCtx.fill();
        lossCtx.stroke();

        if (gdHistory.length > 1) {
            lossCtx.strokeStyle = c.gdLine;
            lossCtx.lineWidth = 2;
            lossCtx.beginPath();
            for (let i = 0; i < gdHistory.length; i++) {
                const hc = gdHistory[i].coeffs;
                const px = pad.l + ((hc[1] - mMin) / (mMax - mMin)) * pw;
                const py = pad.t + ph - ((hc[0] - bMin) / (bMax - bMin)) * ph;
                if (i === 0) lossCtx.moveTo(px, py);
                else lossCtx.lineTo(px, py);
            }
            lossCtx.stroke();

            const last = gdHistory[gdHistory.length - 1].coeffs;
            const lx = pad.l + ((last[1] - mMin) / (mMax - mMin)) * pw;
            const ly = pad.t + ph - ((last[0] - bMin) / (bMax - bMin)) * ph;
            lossCtx.fillStyle = c.gdLine;
            lossCtx.beginPath();
            lossCtx.arc(lx, ly, 4, 0, Math.PI * 2);
            lossCtx.fill();
        }

        lossCtx.fillStyle = c.muted;
        lossCtx.font = '10px sans-serif';
        lossCtx.textAlign = 'center';
        lossCtx.fillText('slope (m)', pad.l + pw / 2, H - 4);
        lossCtx.save();
        lossCtx.translate(12, pad.t + ph / 2);
        lossCtx.rotate(-Math.PI / 2);
        lossCtx.fillText('intercept (b)', 0, 0);
        lossCtx.restore();

        lossCtx.fillStyle = c.muted;
        lossCtx.font = '9px sans-serif';
        for (let i = 0; i <= 4; i++) {
            const val = mMin + (mMax - mMin) * i / 4;
            const x = pad.l + (i / 4) * pw;
            lossCtx.textAlign = 'center';
            lossCtx.fillText(val.toFixed(1), x, H - 16);
        }
        lossCtx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const val = bMin + (bMax - bMin) * i / 4;
            const y = pad.t + ph - (i / 4) * ph;
            lossCtx.fillText(val.toFixed(1), pad.l - 5, y + 3);
        }
    }

    // ============================================
    // Metrics
    // ============================================
    function updateMetrics() {
        const coeffs = gdCoeffs || fitCoeffs;
        const hMse = document.querySelector('#header-mse span');
        const hR2 = document.querySelector('#header-r2 span');
        if (coeffs) {
            const mse = computeMSE(points, coeffs);
            const r2 = computeR2(points, coeffs);
            if (hMse) hMse.textContent = mse.toFixed(3);
            if (hR2) hR2.textContent = r2.toFixed(3);
        } else {
            if (hMse) hMse.textContent = '-';
            if (hR2) hR2.textContent = '-';
        }

        renderCalcPanel();
        renderEquationPanel();
    }

    function renderEquationPanel() {
        const el = document.getElementById('lr-equation-display');
        if (!el) return;
        const coeffs = gdCoeffs || fitCoeffs;
        if (!coeffs) return;

        let html = '<span class="lr-eq-y">y</span><span class="lr-eq-op">=</span>';
        let first = true;
        for (let i = coeffs.length - 1; i >= 0; i--) {
            const v = coeffs[i];
            const av = Math.abs(v);
            if (!first) {
                html += `<span class="lr-eq-op">${v < 0 ? '−' : '+'}</span>`;
            } else if (v < 0) {
                html += '<span class="lr-eq-op">−</span>';
            }
            const cls = i === 0 ? 'lr-eq-b' : (i === 1 ? 'lr-eq-m' : 'lr-eq-coeff');
            html += `<span class="${cls}">${av.toFixed(2)}</span>`;
            if (i === 1) html += '<span class="lr-eq-x">x</span>';
            else if (i > 1) html += `<span class="lr-eq-x">x<sup>${i}</sup></span>`;
            first = false;
        }
        el.innerHTML = html;

        // Scale down if equation overflows its container
        el.style.transform = '';
        requestAnimationFrame(() => {
            const parent = el.parentElement;
            if (!parent) return;
            const pw = parent.clientWidth - 32; // account for padding
            const ew = el.scrollWidth;
            if (ew > pw && pw > 0) {
                el.style.transform = `scale(${pw / ew})`;
            }
        });
    }

    function setStatus(msg) {
        const ps = document.getElementById('playback-step');
        if (ps) ps.textContent = msg;
    }

    // ============================================
    // Math tab panels
    // ============================================
    function fmt(v, d) { return v.toFixed(d === undefined ? 4 : d); }
    function frac(num, den) {
        return `<span class="lr-frac"><span class="lr-frac-num">${num}</span><span class="lr-frac-den">${den}</span></span>`;
    }
    function meq(...parts) { return `<div class="lr-math-eq">${parts.join('')}</div>`; }
    function mat(rows, dp) {
        const d = dp === undefined ? 2 : dp;
        let h = '<span class="lr-matrix"><table>';
        for (const row of rows) {
            h += '<tr>';
            for (const v of row) h += `<td>${typeof v === 'number' ? fmt(v, d) : v}</td>`;
            h += '</tr>';
        }
        return h + '</table></span>';
    }
    function badge(val, cls) {
        return `<span class="gnb-val-badge ${cls}">${val}</span>`;
    }
    function calcToggle(key) {
        const icon = mathSymbolic[key] ? 'fa-superscript' : 'fa-sort-numeric-asc';
        return ` <i class="fa ${icon} calc-sym-toggle" data-panel="${key}" title="Toggle symbols / numbers"></i>`;
    }

    const COEFF_NAMES = ['b (intercept)', 'm (slope)', 'c₂ (x²)', 'c₃ (x³)', 'c₄ (x⁴)', 'c₅ (x⁵)', 'c₆ (x⁶)', 'c₇ (x⁷)', 'c₈ (x⁸)', 'c₉ (x⁹)', 'c₁₀ (x¹⁰)'];
    const COEFF_BADGE = ['gnb-val-intercept', 'gnb-val-slope', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data', 'gnb-val-data'];

    function renderCalcPanel() {
        const el = document.getElementById('lr-calc-panel');
        if (!el) return;

        const coeffs = gdCoeffs || targetCoeffs || fitCoeffs;
        if (!coeffs || points.length < 2) {
            el.innerHTML = '<span class="formula-note">Fit a line to see the calculation breakdown.</span>';
            return;
        }

        const n = points.length;
        let html = '';

        if (polyDegree === 1 && (method === 'normal' || (method === 'gradient' && fitCoeffs && !gdCoeffs))) {
            // Degree 1: detailed normal equation step-by-step
            let sx = 0, sy = 0, sxx = 0, sxy = 0;
            for (const p of points) {
                sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
            }
            const denom = n * sxx - sx * sx;
            const m = (n * sxy - sx * sy) / denom;
            const b = (sy - m * sx) / n;

            const xs = points.map(p => fmt(p.x, 2));
            const ys = points.map(p => fmt(p.y, 2));
            const x2s = points.map(p => fmt(p.x * p.x, 2));
            const xys = points.map(p => fmt(p.x * p.y, 2));

            // Build terms column based on symbolic/numeric toggle
            let xTerms, yTerms, x2Terms, xyTerms;
            if (mathSymbolic.sums) {
                const symList = (prefix, suffix) => {
                    const s = suffix || '';
                    if (n <= 4) return Array.from({length: n}, (_, i) => prefix + subscript(i + 1) + s).join(' + ');
                    return prefix + subscript(1) + s + ' + ' + prefix + subscript(2) + s + ' + ⋯ + ' + prefix + subscript(n) + s;
                };
                xTerms = symList('x');
                yTerms = symList('y');
                x2Terms = symList('x', '²');
                xyTerms = n <= 4
                    ? Array.from({length: n}, (_, i) => 'x' + subscript(i + 1) + 'y' + subscript(i + 1)).join(' + ')
                    : 'x' + subscript(1) + 'y' + subscript(1) + ' + x' + subscript(2) + 'y' + subscript(2) + ' + ⋯ + x' + subscript(n) + 'y' + subscript(n);
            } else {
                xTerms = xs.join(' + ');
                yTerms = ys.join(' + ');
                x2Terms = x2s.join(' + ');
                xyTerms = xys.join(' + ');
            }

            html += '<div class="gnb-calc-class-block">';
            html += `<div class="gnb-calc-title">Step 1 — Compute Sums${calcToggle('sums')}</div>`;
            html += '<table class="gnb-fit-table">';
            html += '<tr><th>Sum</th><th class="gnb-calc-terms-header">Terms</th><th>Value</th></tr>';
            html += `<tr><td>Σx</td><td class="gnb-calc-terms">${xTerms}</td><td>${fmt(sx)}</td></tr>`;
            html += `<tr><td>Σy</td><td class="gnb-calc-terms">${yTerms}</td><td>${fmt(sy)}</td></tr>`;
            html += `<tr><td>Σx²</td><td class="gnb-calc-terms">${x2Terms}</td><td>${fmt(sxx)}</td></tr>`;
            html += `<tr><td>Σxy</td><td class="gnb-calc-terms">${xyTerms}</td><td>${fmt(sxy)}</td></tr>`;
            html += '</table></div>';

            const numM = `nΣxy − ΣxΣy`;
            const denM = `nΣx² − (Σx)²`;
            const numMvals = `${n}·${fmt(sxy)} − ${fmt(sx)}·${fmt(sy)}`;
            const denMvals = `${n}·${fmt(sxx)} − ${fmt(sx)}²`;
            const numMresult = fmt(n * sxy - sx * sy);
            const denMresult = fmt(denom);

            html += '<div class="gnb-calc-class-block">';
            html += `<div class="gnb-calc-title">Step 2 — Slope (m)${calcToggle('slope')}</div>`;
            html += meq('<span class="lr-math-label">m</span>', ' = ', frac(numM, denM));
            if (!mathSymbolic.slope) {
                html += meq(' = ', frac(numMvals, denMvals));
                html += meq(' = ', frac(numMresult, denMresult));
            }
            html += `<div class="gnb-calc-row gnb-calc-result"><span>m =</span>${badge(fmt(m), 'gnb-val-slope')}</div>`;
            html += '</div>';

            const numB = `Σy − mΣx`;
            const numBvals = `${fmt(sy)} − ${fmt(m)}·${fmt(sx)}`;
            const numBresult = fmt(sy - m * sx);

            html += '<div class="gnb-calc-class-block">';
            html += `<div class="gnb-calc-title">Step 3 — Intercept (b)${calcToggle('intercept')}</div>`;
            html += meq('<span class="lr-math-label">b</span>', ' = ', frac(numB, 'n'));
            if (!mathSymbolic.intercept) {
                html += meq(' = ', frac(numBvals, n));
                html += meq(' = ', frac(numBresult, n));
            }
            html += `<div class="gnb-calc-row gnb-calc-result"><span>b =</span>${badge(fmt(b), 'gnb-val-intercept')}</div>`;
            html += '</div>';

            const mse = computeMSE(points, [b, m]);
            const r2 = computeR2(points, [b, m]);
            html += '<div class="gnb-calc-class-block">';
            html += '<div class="gnb-calc-title">Result</div>';
            html += `<div class="gnb-calc-row gnb-calc-formula-row"><span>y = ${fmt(m, 2)}x ${b >= 0 ? '+' : '−'} ${fmt(Math.abs(b), 2)}</span></div>`;
            html += `<div class="gnb-calc-row"><span>MSE</span>${badge(fmt(mse), 'gnb-val-mse')}</div>`;
            html += `<div class="gnb-calc-row"><span>R²</span>${badge(fmt(r2), 'gnb-val-r2')}</div>`;
            html += '</div>';

        } else if (polyDegree > 1 && (method === 'normal' || (method === 'gradient' && fitCoeffs && !gdCoeffs))) {
            const d = polyDegree;
            const cols = d + 1;

            // Build Vandermonde rows
            const maxRows = Math.min(n, 10);
            const Xrows = [];
            for (let i = 0; i < maxRows; i++) {
                const p = points[i];
                const row = []; let xp = 1;
                for (let j = 0; j < cols; j++) { row.push(xp); xp *= p.x; }
                Xrows.push(row);
            }
            const yVec = points.slice(0, maxRows).map(p => [p.y]);

            // Build symbolic or numeric display matrices
            let displayX, displayY;
            if (mathSymbolic.vander) {
                displayX = [];
                for (let i = 0; i < maxRows; i++) {
                    const row = [];
                    for (let j = 0; j < cols; j++) {
                        if (j === 0) row.push('1');
                        else if (j === 1) row.push('x' + subscript(i + 1));
                        else row.push('x' + subscript(i + 1) + superscript(j));
                    }
                    displayX.push(row);
                }
                displayY = points.slice(0, maxRows).map((_, i) => ['y' + subscript(i + 1)]);
            } else {
                displayX = Xrows;
                displayY = yVec;
            }

            // Step 1 & 2 side by side
            html += '<div class="lr-calc-columns">';

            // Step 1: Show X and y
            html += '<div class="gnb-calc-class-block lr-calc-col">';
            html += `<div class="gnb-calc-title">Step 1 — Vandermonde${calcToggle('vander')}</div>`;
            html += '<div class="lr-matrix-row">';
            html += '<span class="lr-matrix-label">X =</span>';
            html += mat(displayX);
            html += '<span class="lr-matrix-label">y =</span>';
            html += mat(displayY);
            html += '</div>';
            if (n > maxRows) html += `<div style="opacity:0.5;font-size:0.8em;text-align:center">(${n - maxRows} more rows)</div>`;
            html += '</div>';

            // Compute X^T X and X^T y
            const XtX = Array.from({length: cols}, () => new Array(cols).fill(0));
            const Xty = new Array(cols).fill(0);
            for (const p of points) {
                const row = [1];
                for (let j = 1; j < cols; j++) row.push(row[j-1] * p.x);
                for (let r = 0; r < cols; r++) {
                    Xty[r] += row[r] * p.y;
                    for (let c = 0; c < cols; c++) XtX[r][c] += row[r] * row[c];
                }
            }

            // Step 2: Show X^T X and X^T y
            let displayXtX, displayXty;
            if (mathSymbolic.normal) {
                displayXtX = Array.from({length: cols}, (_, r) =>
                    Array.from({length: cols}, (_, c) => {
                        const pw = r + c;
                        if (pw === 0) return 'n';
                        if (pw === 1) return 'Σx';
                        return 'Σx' + superscript(pw);
                    })
                );
                displayXty = Array.from({length: cols}, (_, k) => {
                    if (k === 0) return ['Σy'];
                    if (k === 1) return ['Σxy'];
                    return ['Σx' + superscript(k) + 'y'];
                });
            } else {
                displayXtX = XtX;
                displayXty = Xty.map(v => [v]);
            }

            html += '<div class="gnb-calc-class-block lr-calc-col">';
            html += `<div class="gnb-calc-title">Step 2 — Normal Eq.${calcToggle('normal')}</div>`;
            html += '<div class="gnb-calc-row gnb-calc-formula-row"><span>(X<sup>T</sup>X) w = X<sup>T</sup>y</span></div>';
            html += '<div class="lr-matrix-row">';
            html += mat(displayXtX);
            html += '<span class="lr-matrix-label">w =</span>';
            html += mat(displayXty);
            html += '</div></div>';

            html += '</div>'; // close lr-calc-columns

            // Step 3: Solve (X^T X) w = X^T y → w
            html += '<div class="gnb-calc-class-block">';
            html += '<div class="gnb-calc-title">Step 3 — Solve (X<sup>T</sup>X) w = X<sup>T</sup>y</div>';
            html += '<div class="gnb-calc-row gnb-calc-numbers-row"><span>Gaussian elimination with partial pivoting</span></div>';
            for (let i = 0; i < coeffs.length; i++) {
                html += `<div class="gnb-calc-row"><span>${COEFF_NAMES[i] || 'c' + i}</span>${badge(fmt(coeffs[i]), COEFF_BADGE[i] || 'gnb-val-data')}</div>`;
            }
            html += '</div>';

            const mse = computeMSE(points, coeffs);
            const r2 = computeR2(points, coeffs);
            html += '<div class="gnb-calc-class-block">';
            html += '<div class="gnb-calc-title">Result</div>';
            html += `<div class="gnb-calc-row gnb-calc-formula-row"><span>${buildEquationString(coeffs)}</span></div>`;
            html += `<div class="gnb-calc-row"><span>MSE</span>${badge(fmt(mse), 'gnb-val-mse')}</div>`;
            html += `<div class="gnb-calc-row"><span>R²</span>${badge(fmt(r2), 'gnb-val-r2')}</div>`;
            html += '</div>';

        } else if (method === 'gradient' && gdCoeffs) {
            // Gradient descent step-by-step
            const lr = parseFloat(document.getElementById('lr-slider').value);
            const grad = new Array(gdCoeffs.length).fill(0);
            for (const p of points) {
                const err = p.y - evalPoly(gdCoeffs, p.x);
                let xp = 1;
                for (let k = 0; k < gdCoeffs.length; k++) { grad[k] += -2 * xp * err / n; xp *= p.x; }
            }
            const mse = computeMSE(points, gdCoeffs);

            html += '<div class="gnb-calc-class-block">';
            html += `<div class="gnb-calc-title">Iteration ${gdIteration} — Parameters</div>`;
            for (let i = 0; i < gdCoeffs.length; i++) {
                html += `<div class="gnb-calc-row"><span>${COEFF_NAMES[i] || 'c' + i}</span>${badge(fmt(gdCoeffs[i]), COEFF_BADGE[i] || 'gnb-val-data')}</div>`;
            }
            html += `<div class="gnb-calc-row"><span>MSE (loss)</span>${badge(fmt(mse), 'gnb-val-mse')}</div>`;
            html += '</div>';

            html += '<div class="gnb-calc-class-block">';
            html += '<div class="gnb-calc-title">Gradients</div>';
            for (let i = 0; i < grad.length; i++) {
                const label = i === 0 ? '∂MSE/∂b' : i === 1 ? '∂MSE/∂m' : `∂MSE/∂c${i}`;
                html += `<div class="gnb-calc-row"><span>${label}</span>${badge(fmt(grad[i]), 'gnb-val-gd')}</div>`;
            }
            html += '</div>';

            html += '<div class="gnb-calc-class-block">';
            html += '<div class="gnb-calc-title">Parameter Update</div>';
            for (let i = 0; i < gdCoeffs.length; i++) {
                const name = i === 0 ? 'b' : i === 1 ? 'm' : 'c' + i;
                const newVal = gdCoeffs[i] - lr * grad[i];
                html += `<div class="gnb-calc-row gnb-calc-numbers-row"><span>${name} ← ${fmt(gdCoeffs[i])} − ${fmt(lr, 3)}·${fmt(grad[i])}</span></div>`;
                html += `<div class="gnb-calc-row gnb-calc-result"><span>${name}_new =</span>${badge(fmt(newVal), COEFF_BADGE[i] || 'gnb-val-data')}</div>`;
            }
            html += '</div>';
        }

        el.innerHTML = html;
    }

    // ============================================
    // Actions
    // ============================================
    function doFit() {
        if (points.length < 2) {
            setStatus('Need at least 2 points');
            return;
        }

        if (method === 'normal') {
            const coeffs = polyFit(points, polyDegree);
            if (coeffs) {
                fitCoeffs = coeffs;
                targetCoeffs = [...coeffs];
            }
            gdCoeffs = null;
            gdHistory = [];
            gdIteration = 0;
            setStatus(`Fit complete (degree ${polyDegree} normal equation)`);
            updateMetrics();
            render();
        } else {
            startGradientDescent();
        }
    }

    function startGradientDescent() {
        stopGD();
        cancelAnimation();
        const lr = parseFloat(document.getElementById('lr-slider').value);
        const maxIter = parseInt(document.getElementById('iter-value').value);

        // Initialize randomly
        const d = polyDegree + 1;
        gdCoeffs = new Array(d).fill(0).map(() => (Math.random() - 0.5) * 4);
        gdCoeffs[0] += 5; // center intercept
        gdHistory = [{ coeffs: [...gdCoeffs], loss: computeMSE(points, gdCoeffs) }];
        gdIteration = 0;
        fitCoeffs = null;

        // Show loss panels
        document.getElementById('loss-panel').style.display = polyDegree === 1 ? '' : 'none';
        document.getElementById('loss-curve-panel').style.display = '';

        setStatus('Gradient descent running...');
        enableButtons(false);

        const speed = parseInt(document.getElementById('speed-slider').value);
        const delay = 1050 - speed * 100;

        function step() {
            if (gdIteration >= maxIter) {
                fitCoeffs = [...gdCoeffs];
                targetCoeffs = [...fitCoeffs];
                setStatus(`Converged after ${gdIteration} iterations`);
                enableButtons(true);
                updateMetrics();
                render();
                renderLossCurve();
                renderLossSurface();
                return;
            }

            gdCoeffs = gradientStep(points, gdCoeffs, lr);
            gdIteration++;
            const loss = computeMSE(points, gdCoeffs);
            gdHistory.push({ coeffs: [...gdCoeffs], loss });

            updateMetrics();
            render();
            renderLossCurve();
            if (gdIteration % 5 === 0 || gdIteration <= 3) {
                renderLossSurface();
            }

            gdTimer = setTimeout(step, delay);
        }

        step();
    }

    function stopGD() {
        if (gdTimer) {
            clearTimeout(gdTimer);
            gdTimer = null;
        }
        enableButtons(true);
    }

    function doReset() {
        stopGD();
        autoFit();
        document.getElementById('loss-panel').style.display = 'none';
        document.getElementById('loss-curve-panel').style.display = 'none';
        setStatus('Ready');
        updateMetrics();
        render();
    }

    function doStep() {
        if (points.length < 2) return;
        cancelAnimation();
        const lr = parseFloat(document.getElementById('lr-slider').value);

        if (!gdCoeffs) {
            const d = polyDegree + 1;
            gdCoeffs = new Array(d).fill(0).map(() => (Math.random() - 0.5) * 4);
            gdCoeffs[0] += 5;
            gdHistory = [{ coeffs: [...gdCoeffs], loss: computeMSE(points, gdCoeffs) }];
            gdIteration = 0;
            fitCoeffs = null;
            document.getElementById('loss-panel').style.display = polyDegree === 1 ? '' : 'none';
            document.getElementById('loss-curve-panel').style.display = '';
        }

        gdCoeffs = gradientStep(points, gdCoeffs, lr);
        gdIteration++;
        gdHistory.push({ coeffs: [...gdCoeffs], loss: computeMSE(points, gdCoeffs) });

        setStatus(`Step ${gdIteration}`);
        updateMetrics();
        render();
        renderLossCurve();
        renderLossSurface();
    }

    function enableButtons(enabled) {
        document.getElementById('btn-fit').disabled = !enabled;
        document.getElementById('btn-step').disabled = !enabled || method !== 'gradient';
        document.getElementById('btn-reset').disabled = !enabled;
    }

    // ============================================
    // Auto-fit: keep the curve updated as points change
    // ============================================
    function autoFit() {
        if (points.length === 0) {
            targetCoeffs = flatCoeffs(5);
        } else if (points.length === 1) {
            targetCoeffs = flatCoeffs(points[0].y);
        } else if (points.length <= polyDegree) {
            // Not enough points for this degree — fit max possible
            const tempCoeffs = polyFit(points, points.length - 1);
            if (tempCoeffs) {
                targetCoeffs = new Array(polyDegree + 1).fill(0);
                for (let i = 0; i < tempCoeffs.length; i++) targetCoeffs[i] = tempCoeffs[i];
            }
        } else {
            targetCoeffs = polyFit(points, polyDegree) || targetCoeffs;
        }
        // First call or degree changed — snap directly
        if (!fitCoeffs || fitCoeffs.length !== targetCoeffs.length) {
            fitCoeffs = [...targetCoeffs];
        }
        gdCoeffs = null;
        gdHistory = [];
        gdIteration = 0;
        startAnimation();
    }

    function startAnimation() {
        if (!animFrameId) animFrameId = requestAnimationFrame(animateStep);
    }

    function cancelAnimation() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    }

    function animateStep() {
        animFrameId = null;
        if (!fitCoeffs || !targetCoeffs) return;

        let settled = true;
        for (let i = 0; i < fitCoeffs.length; i++) {
            const diff = targetCoeffs[i] - fitCoeffs[i];
            if (Math.abs(diff) > 0.0001) {
                fitCoeffs[i] += diff * LERP;
                settled = false;
            } else {
                fitCoeffs[i] = targetCoeffs[i];
            }
        }

        render();
        updateMetrics();

        if (!settled) {
            animFrameId = requestAnimationFrame(animateStep);
        }
    }

    // ============================================
    // Degree controls
    // ============================================
    function addTerm() {
        if (polyDegree >= MAX_DEGREE) return;
        polyDegree++;
        // Extend current fitCoeffs with 0 for the new term
        if (fitCoeffs) fitCoeffs.push(0);
        autoFit();
        updateDegreeButtons();
        updateMetrics();
        render();
    }

    function removeTerm() {
        if (polyDegree <= 1) return;
        polyDegree--;
        // Trim fitCoeffs
        if (fitCoeffs && fitCoeffs.length > polyDegree + 1) {
            fitCoeffs.length = polyDegree + 1;
        }
        autoFit();
        updateDegreeButtons();
        updateMetrics();
        render();
    }

    function updateDegreeButtons() {
        const addBtn = document.getElementById('btn-add-term');
        const rmBtn = document.getElementById('btn-remove-term');
        if (addBtn) addBtn.disabled = polyDegree >= MAX_DEGREE;
        if (rmBtn) rmBtn.disabled = polyDegree <= 1;
        const degLabel = document.getElementById('lr-degree-label');
        if (degLabel) degLabel.textContent = polyDegree === 1 ? 'Linear' : `Degree ${polyDegree}`;
    }

    // ============================================
    // Event handlers
    // ============================================
    // ============================================
    // Line dragging
    // ============================================
    const DRAG_HIT_PX = 8;   // proximity threshold in canvas pixels
    const DRAG_MOVE_PX = 3;  // movement threshold before drag activates

    // Handle-based curve dragging
    const HANDLE_R = 6;              // diamond half-diagonal
    const HANDLE_HIT_R = 10;         // hit-test radius for handles
    const HANDLE_MARGIN = 1.5;       // inset from DATA_MIN / DATA_MAX

    // Returns polyDegree evenly-spaced handle x-positions
    function getHandleXs() {
        const n = polyDegree;
        if (n === 1) return [HANDLE_MARGIN, DATA_MAX - HANDLE_MARGIN];
        const range = DATA_MAX - 2 * HANDLE_MARGIN;
        const xs = [];
        for (let i = 0; i < n; i++) {
            xs.push(HANDLE_MARGIN + range * i / (n - 1));
        }
        return xs;
    }

    function isNearCurve(cx, cy) {
        if (!fitCoeffs) return false;
        // Sample curve at many points, find minimum distance to (cx, cy)
        const steps = 200;
        let minDist = Infinity;
        for (let i = 0; i <= steps; i++) {
            const dx = DATA_MIN + (DATA_MAX - DATA_MIN) * i / steps;
            const dy = evalPoly(fitCoeffs, dx);
            const cp = dataToCanvas(dx, dy);
            // Only consider points within the plot area
            if (cp.y < PLOT_T || cp.y > PLOT_T + PLOT_H) continue;
            const dist = Math.hypot(cp.x - cx, cp.y - cy);
            if (dist < minDist) minDist = dist;
        }
        return minDist <= DRAG_HIT_PX;
    }

    function getHandlePositions() {
        if (!fitCoeffs) return [];
        return getHandleXs().map(dx => {
            const dy = evalPoly(fitCoeffs, dx);
            const cp = dataToCanvas(dx, dy);
            return { cx: cp.x, cy: cp.y, dx, dy };
        });
    }

    function hitTestHandles(cx, cy) {
        if (!fitCoeffs || gdTimer !== null || gdCoeffs) return -1;
        const handles = getHandlePositions();
        let best = -1, bestDist = HANDLE_HIT_R;
        for (let i = 0; i < handles.length; i++) {
            const dist = Math.hypot(handles[i].cx - cx, handles[i].cy - cy);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        return best;
    }

    function drawHandles(c) {
        const handles = getHandlePositions();
        for (let i = 0; i < handles.length; i++) {
            const h = handles[i];
            const isActive = (draggingLine && dragHandleIdx === i);
            const isHovered = (hoveredHandle === i);
            const r = isActive ? 7 : HANDLE_R;

            // Draw diamond (rotated square)
            ctx.beginPath();
            ctx.moveTo(h.cx, h.cy - r);     // top
            ctx.lineTo(h.cx + r, h.cy);     // right
            ctx.lineTo(h.cx, h.cy + r);     // bottom
            ctx.lineTo(h.cx - r, h.cy);     // left
            ctx.closePath();
            ctx.fillStyle = (isActive || isHovered) ? '#F59E0B' : '#FBBC04';
            ctx.fill();
            ctx.strokeStyle = '#D97706';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function onCanvasMouseDown(e) {
        if (!fitCoeffs || gdTimer !== null || gdCoeffs) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // 1. Check handles first
        const hIdx = hitTestHandles(cx, cy);
        if (hIdx >= 0) {
            const handleXs = getHandleXs();
            draggingLine = true;
            didDrag = false;
            dragStartCx = cx;
            dragStartCy = cy;
            dragOriginalCoeffs = [...fitCoeffs];
            dragHandleIdx = hIdx;

            dragGrabYOnCurve = evalPoly(fitCoeffs, handleXs[hIdx]);

            // For degree 1 (2 handles): set pivot to the opposite endpoint
            if (polyDegree === 1) {
                const pivotIdx = hIdx === 0 ? 1 : 0;
                dragPivotX = handleXs[pivotIdx];
                dragPivotY = evalPoly(fitCoeffs, handleXs[pivotIdx]);
            }

            canvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        // 2. Check curve body
        if (!isNearCurve(cx, cy)) return;

        draggingLine = true;
        didDrag = false;
        dragStartCx = cx;
        dragStartCy = cy;
        dragOriginalCoeffs = [...fitCoeffs];
        dragHandleIdx = -1; // body drag = translate

        const d = canvasToData(cx, cy);
        dragGrabYOnCurve = evalPoly(fitCoeffs, d.x);

        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }

    function onCanvasMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        if (draggingLine) {
            // Check threshold before activating real drag
            if (!didDrag) {
                const moved = Math.hypot(cx - dragStartCx, cy - dragStartCy);
                if (moved <= DRAG_MOVE_PX) return;
                didDrag = true;
                cancelAnimation(); // stop LERP while dragging
            }

            const d = canvasToData(cx, cy);

            if (dragHandleIdx === -1) {
                // Body drag — vertical translate
                const deltaY = d.y - dragGrabYOnCurve;
                fitCoeffs = [...dragOriginalCoeffs];
                fitCoeffs[0] += deltaY;
            } else {
                // Handle drag — pivot (degree 1) or reshape (degree > 1)
                const handleXs = getHandleXs();
                const grabX = handleXs[dragHandleIdx];
                const mouseDataY = d.y;

                if (polyDegree === 1) {
                    const m = (mouseDataY - dragPivotY) / (grabX - dragPivotX);
                    const b = dragPivotY - m * dragPivotX;
                    fitCoeffs = [b, m];
                } else {
                    // Sample the curve at drag-start to preserve prior adjustments,
                    // then pull toward the drag point
                    const syntheticPts = [];
                    const nSyn = 20;
                    for (let si = 0; si <= nSyn; si++) {
                        const sx = DATA_MIN + (DATA_MAX - DATA_MIN) * si / nSyn;
                        syntheticPts.push({ x: sx, y: evalPoly(dragOriginalCoeffs, sx) });
                    }
                    for (let vi = 0; vi < 8; vi++) {
                        syntheticPts.push({ x: grabX, y: mouseDataY });
                    }
                    const newCoeffs = polyFit(syntheticPts, polyDegree);
                    if (newCoeffs) fitCoeffs = newCoeffs;
                }
            }

            targetCoeffs = [...fitCoeffs];
            render();
            updateMetrics();
            return;
        }

        // Not dragging — update hover state and cursor
        if (!fitCoeffs || gdTimer !== null || gdCoeffs) {
            canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
            return;
        }

        const prevHover = hoveredHandle;
        hoveredHandle = hitTestHandles(cx, cy);

        if (hoveredHandle >= 0) {
            canvas.style.cursor = 'grab';
        } else if (isNearCurve(cx, cy)) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
        }

        if (hoveredHandle !== prevHover) render();
    }

    function onCanvasMouseUp(e) {
        if (!draggingLine) return;
        draggingLine = false;
        dragHandleIdx = -1;

        if (didDrag) {
            targetCoeffs = [...fitCoeffs];
        }

        // Update hover state and cursor
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        hoveredHandle = hitTestHandles(cx, cy);

        if (hoveredHandle >= 0 || isNearCurve(cx, cy)) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
        }
        render();
    }

    function onCanvasClick(e) {
        // If we just finished a drag, suppress the click
        if (didDrag) {
            didDrag = false;
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const d = canvasToData(cx, cy);

        if (d.x < DATA_MIN || d.x > DATA_MAX || d.y < DATA_MIN || d.y > DATA_MAX) return;

        if (editMode === 'add') {
            points.push({ x: d.x, y: d.y });
        } else if (editMode === 'delete') {
            let closest = -1, minDist = 15;
            for (let i = 0; i < points.length; i++) {
                const cp = dataToCanvas(points[i].x, points[i].y);
                const dist = Math.hypot(cp.x - cx, cp.y - cy);
                if (dist < minDist) { minDist = dist; closest = i; }
            }
            if (closest >= 0) points.splice(closest, 1);
        }

        autoFit();
        updateMetrics();
        render();
    }

    function init() {
        document.getElementById('lr-open-regularization').addEventListener('click',function(){
            if(points.length<2) {document.getElementById('lr-regularization-status').textContent=' Add at least two points first.';return;}
            window.location.href='regularization.html?regression-data='+encodeURIComponent(JSON.stringify(points));
        });
        // Main canvas
        canvas = document.getElementById('regression-canvas');
        const setup = window.VizLib.CanvasUtils.setupHiDPICanvas(canvas);
        ctx = setup.ctx; dpr = setup.dpr;
        CANVAS_W = setup.logicalWidth;
        CANVAS_H = setup.logicalHeight;
        PLOT_W = CANVAS_W - AXIS_PAD - 10;
        PLOT_H = CANVAS_H - AXIS_PAD - 10;

        // Loss surface canvas
        lossCanvas = document.getElementById('loss-canvas');
        if (lossCanvas) {
            const ls = window.VizLib.CanvasUtils.setupHiDPICanvas(lossCanvas);
            lossCtx = ls.ctx; lossDpr = ls.dpr;
        }

        // Loss curve canvas
        lossCurveCanvas = document.getElementById('loss-curve-canvas');
        if (lossCurveCanvas) {
            const lc = window.VizLib.CanvasUtils.setupHiDPICanvas(lossCurveCanvas);
            lossCurveCtx = lc.ctx; lossCurveDpr = lc.dpr;
        }

        // Canvas click and line-dragging
        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseup', onCanvasMouseUp);

        // Cancel drag on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && draggingLine) {
                draggingLine = false;
                didDrag = false;
                dragHandleIdx = -1;
                hoveredHandle = -1;
                if (dragOriginalCoeffs) {
                    fitCoeffs = [...dragOriginalCoeffs];
                    targetCoeffs = [...dragOriginalCoeffs];
                }
                render();
                updateMetrics();
                canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
            }
        });

        // Edit mode buttons
        document.querySelectorAll('.edit-mode-buttons .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.edit-mode-buttons .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                editMode = this.dataset.mode;
                canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
            });
        });

        // Clear
        document.getElementById('btn-clear-points').addEventListener('click', () => {
            points = [];
            doReset();
        });

        // Dataset select
        document.getElementById('dataset-select').addEventListener('change', function() {
            if (this.value !== 'custom') {
                generateDataset(this.value);
                doReset();
            }
        });

        // Method select
        document.getElementById('method-select').addEventListener('change', function() {
            method = this.value;
            document.getElementById('gd-options').style.display = method === 'gradient' ? '' : 'none';
            document.getElementById('btn-step').disabled = method !== 'gradient';
            doReset();
        });

        // LR slider
        document.getElementById('lr-slider').addEventListener('input', function() {
            document.getElementById('lr-value').textContent = parseFloat(this.value).toFixed(3);
        });

        // Iteration stepper
        document.getElementById('iter-minus').addEventListener('click', () => {
            const el = document.getElementById('iter-value');
            el.value = Math.max(10, parseInt(el.value) - 50);
        });
        document.getElementById('iter-plus').addEventListener('click', () => {
            const el = document.getElementById('iter-value');
            el.value = Math.min(2000, parseInt(el.value) + 50);
        });

        // Buttons
        document.getElementById('btn-fit').addEventListener('click', doFit);
        document.getElementById('btn-step').addEventListener('click', doStep);
        document.getElementById('btn-reset').addEventListener('click', doReset);

        // Degree buttons
        const addBtn = document.getElementById('btn-add-term');
        const rmBtn = document.getElementById('btn-remove-term');
        if (addBtn) addBtn.addEventListener('click', addTerm);
        if (rmBtn) rmBtn.addEventListener('click', removeTerm);

        // Math toggle (event delegation since icons are dynamically created)
        document.getElementById('lr-calc-panel').addEventListener('click', (e) => {
            const toggle = e.target.closest('.calc-sym-toggle');
            if (toggle) {
                const key = toggle.dataset.panel;
                mathSymbolic[key] = !mathSymbolic[key];
                renderCalcPanel();
            }
        });

        // Info tabs
        document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const tabId = this.dataset.tab;
                document.querySelectorAll('.info-panel-tabs .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                document.querySelectorAll('.info-tab-content').forEach(c => c.classList.remove('active'));
                const content = document.getElementById('tab-' + tabId);
                if (content) content.classList.add('active');
            });
        });

        // Theme change
        document.addEventListener('themechange', () => {
            render();
            if (gdHistory.length > 1) {
                renderLossCurve();
                renderLossSurface();
            }
        });

        // Start with a flat line visible
        autoFit();
        updateDegreeButtons();
        render();
        updateMetrics();
    }

    // Wait for VizLib
    window.addEventListener('vizlib-ready', init);
})();

/**
 * PCA Visualizer
 *
 * Interactive visualization of Principal Component Analysis.
 * Shows eigenvectors, projections, scree plot, and dimensionality reduction.
 */
(function() {
    'use strict';

    const CANVAS_W = 560, CANVAS_H = 400;
    const SCREE_W = 560, SCREE_H = 160;
    const PROJ_W = 560, PROJ_H = 220;
    const PAD = 10;
    const POINT_R = 5;

    // State
    let points = [];
    let pcaResult = null; // { mean, eigenvalues, eigenvectors, projected }
    let numComponents = 2;
    let editMode = 'add';
    let showProjections = false, showMean = true, showPCAxes = true;
    let computed = false;

    let canvas, ctx, dpr;
    let screeCanvas, screeCtx, screeDpr;
    let projectionCanvas, projectionCtx, projectionDpr;

    // ============================================
    // Coordinate transforms (data [0,1] → canvas)
    // ============================================
    function d2c(dx, dy) {
        return {
            x: PAD + dx * (CANVAS_W - 2 * PAD),
            y: PAD + (1 - dy) * (CANVAS_H - 2 * PAD)
        };
    }
    function c2d(cx, cy) {
        return {
            x: (cx - PAD) / (CANVAS_W - 2 * PAD),
            y: 1 - (cy - PAD) / (CANVAS_H - 2 * PAD)
        };
    }

    // ============================================
    // PCA Computation (2D)
    // ============================================
    function computePCA(pts) {
        const n = pts.length;
        if (n < 2) return null;

        // Mean
        let mx = 0, my = 0;
        for (const p of pts) { mx += p.x; my += p.y; }
        mx /= n; my /= n;

        // Covariance matrix
        let cxx = 0, cxy = 0, cyy = 0;
        for (const p of pts) {
            const dx = p.x - mx, dy = p.y - my;
            cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
        }
        cxx /= n; cxy /= n; cyy /= n;

        // Eigenvalues via quadratic formula for 2x2 symmetric matrix
        const trace = cxx + cyy;
        const det = cxx * cyy - cxy * cxy;
        const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
        const lambda1 = trace / 2 + disc;
        const lambda2 = trace / 2 - disc;

        // Eigenvectors
        let v1, v2;
        if (Math.abs(cxy) > 1e-10) {
            v1 = { x: lambda1 - cyy, y: cxy };
            v2 = { x: lambda2 - cyy, y: cxy };
        } else {
            v1 = cxx >= cyy ? { x: 1, y: 0 } : { x: 0, y: 1 };
            v2 = cxx >= cyy ? { x: 0, y: 1 } : { x: 1, y: 0 };
        }

        // Normalize
        const norm1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const norm2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
        v1.x /= norm1; v1.y /= norm1;
        v2.x /= norm2; v2.y /= norm2;

        // Project points onto PC1 (for 1D projection)
        const projected = pts.map(p => {
            const dx = p.x - mx, dy = p.y - my;
            const proj1 = dx * v1.x + dy * v1.y;
            const proj2 = dx * v2.x + dy * v2.y;
            return {
                original: p,
                pc1: proj1,
                pc2: proj2,
                // Reconstruction from PC1 only
                recon1: { x: mx + proj1 * v1.x, y: my + proj1 * v1.y },
                recon2: {
                    x: mx + proj1 * v1.x + proj2 * v2.x,
                    y: my + proj1 * v1.y + proj2 * v2.y
                }
            };
        });

        return {
            mean: { x: mx, y: my },
            eigenvalues: [lambda1, lambda2],
            eigenvectors: [v1, v2],
            projected
        };
    }

    // ============================================
    // Dataset generators
    // ============================================
    function generateDataset(type) {
        points = [];
        const n = 60;
        const clamp = value => Math.max(0.05, Math.min(0.95, value));
        const g = () => {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };

        switch (type) {
            case 'correlated':
                for (let i = 0; i < n; i++) {
                    const t = g() * 0.12;
                    const s = g() * 0.03;
                    const x = 0.5 + t + s;
                    const y = 0.5 + t * 0.8 + s;
                    points.push({ x: clamp(x), y: clamp(y) });
                }
                break;
            case 'uncorrelated':
                for (let i = 0; i < n; i++) {
                    points.push({
                        x: clamp(0.5 + g() * 0.12),
                        y: clamp(0.5 + g() * 0.12)
                    });
                }
                break;
            case 'anisotropic':
                for (let i = 0; i < n; i++) {
                    const angle = 0.7;
                    const s1 = g() * 0.15;
                    const s2 = g() * 0.02;
                    const x = 0.5 + s1 * Math.cos(angle) - s2 * Math.sin(angle);
                    const y = 0.5 + s1 * Math.sin(angle) + s2 * Math.cos(angle);
                    points.push({ x: clamp(x), y: clamp(y) });
                }
                break;
            case 'circular':
                for (let i = 0; i < n; i++) {
                    const angle = Math.random() * 2 * Math.PI;
                    const r = 0.15 + g() * 0.02;
                    points.push({
                        x: clamp(0.5 + r * Math.cos(angle)),
                        y: clamp(0.5 + r * Math.sin(angle))
                    });
                }
                break;
        }
    }

    // ============================================
    // Drawing
    // ============================================
    function getColors() {
        const s = getComputedStyle(document.documentElement);
        return {
            point: s.getPropertyValue('--pca-point-color').trim() || '#377eb8',
            projected: s.getPropertyValue('--pca-point-projected').trim() || '#e41a1c',
            pc1: s.getPropertyValue('--pca-pc1-color').trim() || '#e41a1c',
            pc2: s.getPropertyValue('--pca-pc2-color').trim() || '#4daf4a',
            projection: s.getPropertyValue('--pca-projection-color').trim() || 'rgba(100,100,100,0.3)',
            mean: s.getPropertyValue('--pca-mean-color').trim() || '#ff9800',
            bar: s.getPropertyValue('--pca-bar-color').trim() || '#377eb8',
            bg: s.getPropertyValue('--viz-canvas-bg').trim() || '#fafafa',
            muted: s.getPropertyValue('--viz-text-muted').trim() || '#6c757d',
            border: s.getPropertyValue('--viz-border').trim() || '#dee2e6',
        };
    }

    function render() {
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(ctx, dpr);
        CU.clearCanvas(ctx, CANVAS_W, CANVAS_H, c.bg);

        // PC axes
        if (showPCAxes && computed && pcaResult) {
            const { mean, eigenvectors, eigenvalues } = pcaResult;
            const mc = d2c(mean.x, mean.y);

            for (let k = 0; k < 2; k++) {
                const ev = eigenvectors[k];
                const scale = Math.sqrt(eigenvalues[k]) * 3;
                const color = k === 0 ? c.pc1 : c.pc2;

                ctx.strokeStyle = color;
                ctx.lineWidth = k === 0 ? 3 : 2;

                const p1 = d2c(mean.x - ev.x * scale, mean.y - ev.y * scale);
                const p2 = d2c(mean.x + ev.x * scale, mean.y + ev.y * scale);

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();

                // Arrow head
                const arrowSize = 10;
                const angle = Math.atan2(p1.y - p2.y, p1.x - p2.x);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(p2.x, p2.y);
                ctx.lineTo(p2.x + arrowSize * Math.cos(angle - Math.PI / 6), p2.y + arrowSize * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(p2.x + arrowSize * Math.cos(angle + Math.PI / 6), p2.y + arrowSize * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();

                // Label
                ctx.fillStyle = color;
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`PC${k + 1}`, p2.x + 8, p2.y - 5);
            }
        }

        // Projection lines (to PC1)
        if (showProjections && computed && pcaResult && numComponents === 1) {
            ctx.strokeStyle = c.projection;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            for (const proj of pcaResult.projected) {
                const from = d2c(proj.original.x, proj.original.y);
                const to = d2c(proj.recon1.x, proj.recon1.y);
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            // Draw projected points on PC1 line
            for (const proj of pcaResult.projected) {
                const cp = d2c(proj.recon1.x, proj.recon1.y);
                ctx.fillStyle = c.projected;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Data points
        for (const p of points) {
            const cp = d2c(p.x, p.y);
            ctx.fillStyle = c.point;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, POINT_R, 0, Math.PI * 2);
            ctx.fill();
        }

        // Mean
        if (showMean && computed && pcaResult) {
            const mc = d2c(pcaResult.mean.x, pcaResult.mean.y);
            ctx.fillStyle = c.mean;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(mc.x, mc.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            // Cross marker
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mc.x - 4, mc.y); ctx.lineTo(mc.x + 4, mc.y);
            ctx.moveTo(mc.x, mc.y - 4); ctx.lineTo(mc.x, mc.y + 4);
            ctx.stroke();
        }

        const overlay = document.getElementById('click-overlay');
        if (overlay) overlay.classList.toggle('hidden', points.length > 0);
    }

    // ============================================
    // Scree plot
    // ============================================
    function renderScree() {
        if (!screeCanvas || !pcaResult) return;
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(screeCtx, screeDpr);
        CU.clearCanvas(screeCtx, SCREE_W, SCREE_H, c.bg);

        const pad = { l: 50, r: 20, t: 15, b: 30 };
        const pw = SCREE_W - pad.l - pad.r;
        const ph = SCREE_H - pad.t - pad.b;
        const { eigenvalues } = pcaResult;
        const total = Math.max(1e-12, eigenvalues[0] + eigenvalues[1]);
        const ratios = eigenvalues.map(e => e / total);

        // Bars
        const barW = pw / 4;
        for (let i = 0; i < 2; i++) {
            const bx = pad.l + (i + 0.5) * (pw / 2) - barW / 2;
            const bh = ratios[i] * ph;
            const by = pad.t + ph - bh;

            ctx.fillStyle = i === 0 ? c.pc1 : c.pc2;
            screeCtx.fillStyle = i === 0 ? c.pc1 : c.pc2;
            screeCtx.fillRect(bx, by, barW, bh);

            // Border
            screeCtx.strokeStyle = c.border;
            screeCtx.lineWidth = 1;
            screeCtx.strokeRect(bx, by, barW, bh);

            // Label
            screeCtx.fillStyle = c.muted;
            screeCtx.font = '11px sans-serif';
            screeCtx.textAlign = 'center';
            screeCtx.fillText(`PC${i + 1}`, bx + barW / 2, pad.t + ph + 16);
            screeCtx.fillText(`${(ratios[i] * 100).toFixed(1)}%`, bx + barW / 2, by - 5);
        }

        // Cumulative line
        screeCtx.strokeStyle = c.mean;
        screeCtx.lineWidth = 2;
        screeCtx.beginPath();
        const cx1 = pad.l + 0.5 * (pw / 2);
        const cy1 = pad.t + ph - ratios[0] * ph;
        const cx2 = pad.l + 1.5 * (pw / 2);
        const cy2 = pad.t;
        screeCtx.moveTo(cx1, cy1);
        screeCtx.lineTo(cx2, cy2);
        screeCtx.stroke();

        // Y axis
        screeCtx.strokeStyle = c.border;
        screeCtx.lineWidth = 1;
        screeCtx.beginPath();
        screeCtx.moveTo(pad.l, pad.t);
        screeCtx.lineTo(pad.l, pad.t + ph);
        screeCtx.lineTo(pad.l + pw, pad.t + ph);
        screeCtx.stroke();

        screeCtx.fillStyle = c.muted;
        screeCtx.font = '10px sans-serif';
        screeCtx.textAlign = 'right';
        screeCtx.fillText('100%', pad.l - 5, pad.t + 8);
        screeCtx.fillText('0%', pad.l - 5, pad.t + ph + 3);
    }

    function renderProjectionSpace() {
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        if (!projectionCanvas || !projectionCtx) return;
        CU.resetCanvasTransform(projectionCtx, projectionDpr);
        CU.clearCanvas(projectionCtx, PROJ_W, PROJ_H, c.bg);
        if (!pcaResult) return;

        const pad = { l: 54, r: 20, t: 18, b: 36 };
        const plotW = PROJ_W - pad.l - pad.r;
        const plotH = PROJ_H - pad.t - pad.b;
        const xVals = pcaResult.projected.map(p => p.pc1);
        const yVals = numComponents === 1 ? [0] : pcaResult.projected.map(p => p.pc2);
        const maxAbsX = Math.max(0.05, ...xVals.map(v => Math.abs(v))) * 1.15;
        const maxAbsY = (numComponents === 1 ? 1 : Math.max(0.05, ...yVals.map(v => Math.abs(v))) * 1.2);

        const xToCanvas = value => pad.l + ((value + maxAbsX) / (2 * maxAbsX)) * plotW;
        const yToCanvas = value => pad.t + plotH - ((value + maxAbsY) / (2 * maxAbsY)) * plotH;
        const axisY = numComponents === 1 ? pad.t + plotH / 2 : yToCanvas(0);
        const axisX = xToCanvas(0);

        projectionCtx.strokeStyle = c.border;
        projectionCtx.lineWidth = 1;
        projectionCtx.beginPath();
        projectionCtx.moveTo(pad.l, axisY);
        projectionCtx.lineTo(pad.l + plotW, axisY);
        projectionCtx.moveTo(axisX, pad.t);
        projectionCtx.lineTo(axisX, pad.t + plotH);
        projectionCtx.stroke();

        projectionCtx.fillStyle = c.muted;
        projectionCtx.font = '11px sans-serif';
        projectionCtx.textAlign = 'center';
        projectionCtx.fillText('PC1', pad.l + plotW / 2, PROJ_H - 10);
        projectionCtx.save();
        projectionCtx.translate(14, pad.t + plotH / 2);
        projectionCtx.rotate(-Math.PI / 2);
        projectionCtx.fillText(numComponents === 1 ? 'collapsed' : 'PC2', 0, 0);
        projectionCtx.restore();

        projectionCtx.fillStyle = c.muted;
        projectionCtx.textAlign = 'left';
        projectionCtx.fillText('0', axisX + 5, axisY - 6);

        if (numComponents === 1) {
            projectionCtx.setLineDash([4, 4]);
            projectionCtx.strokeStyle = c.projection;
            projectionCtx.beginPath();
            projectionCtx.moveTo(pad.l, axisY);
            projectionCtx.lineTo(pad.l + plotW, axisY);
            projectionCtx.stroke();
            projectionCtx.setLineDash([]);
        }

        for (const proj of pcaResult.projected) {
            const cx = xToCanvas(proj.pc1);
            const cy = numComponents === 1 ? axisY : yToCanvas(proj.pc2);

            projectionCtx.fillStyle = numComponents === 1 ? c.projected : c.point;
            projectionCtx.beginPath();
            projectionCtx.arc(cx, cy, 4.5, 0, Math.PI * 2);
            projectionCtx.fill();

            if (numComponents === 2) {
                projectionCtx.strokeStyle = 'rgba(255,255,255,0.75)';
                projectionCtx.lineWidth = 1;
                projectionCtx.stroke();
            }
        }

        projectionCtx.fillStyle = c.muted;
        projectionCtx.font = '12px sans-serif';
        projectionCtx.textAlign = 'right';
        const label = numComponents === 1
            ? '1D embedding along PC1'
            : '2D coordinates in the PC basis';
        projectionCtx.fillText(label, PROJ_W - 10, 16);
    }

    // ============================================
    // Metrics
    // ============================================
    function updateMetrics() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('metric-points', points.length);

        if (pcaResult) {
            const { eigenvalues, mean } = pcaResult;
            const total = Math.max(1e-12, eigenvalues[0] + eigenvalues[1]);
            const explained1 = eigenvalues[0] / total;
            let reconError = 0;

            for (const proj of pcaResult.projected) {
                const recon = numComponents === 1 ? proj.recon1 : proj.recon2;
                const dx = proj.original.x - recon.x;
                const dy = proj.original.y - recon.y;
                reconError += dx * dx + dy * dy;
            }
            reconError /= pcaResult.projected.length;

            set('metric-var1', eigenvalues[0].toFixed(6));
            set('metric-var2', eigenvalues[1].toFixed(6));
            set('metric-expl1', (explained1 * 100).toFixed(1) + '%');
            set('metric-expl-selected', ((numComponents === 1 ? explained1 : 1) * 100).toFixed(1) + '%');
            set('metric-recon', reconError.toFixed(6));
            set('metric-mean', `(${mean.x.toFixed(3)}, ${mean.y.toFixed(3)})`);
        } else {
            set('metric-var1', '-'); set('metric-var2', '-');
            set('metric-expl1', '-'); set('metric-expl-selected', '-');
            set('metric-recon', '-'); set('metric-mean', '-');
        }
    }

    function setStatus(msg) {
        const el = document.getElementById('metric-status'); if (el) el.textContent = msg;
        const ps = document.getElementById('playback-step'); if (ps) ps.textContent = msg;
    }

    // ============================================
    // Actions
    // ============================================
    function doCompute() {
        if (points.length < 3) { setStatus('Need at least 3 points'); return; }
        pcaResult = computePCA(points);
        computed = true;
        document.getElementById('scree-panel').style.display = '';
        document.getElementById('projection-panel').style.display = '';
        setStatus('PCA computed');
        updateMetrics();
        render();
        renderScree();
        renderProjectionSpace();
    }

    function doReset() {
        pcaResult = null;
        computed = false;
        document.getElementById('scree-panel').style.display = 'none';
        document.getElementById('projection-panel').style.display = 'none';
        setStatus('Ready');
        updateMetrics();
        render();
        renderProjectionSpace();
    }

    // ============================================
    // Init
    // ============================================
    function init() {
        canvas = document.getElementById('pca-canvas');
        const setup = window.VizLib.CanvasUtils.setupHiDPICanvas(canvas);
        ctx = setup.ctx; dpr = setup.dpr;

        screeCanvas = document.getElementById('scree-canvas');
        if (screeCanvas) {
            const s = window.VizLib.CanvasUtils.setupHiDPICanvas(screeCanvas);
            screeCtx = s.ctx; screeDpr = s.dpr;
        }
        projectionCanvas = document.getElementById('projection-canvas');
        if (projectionCanvas) {
            const p = window.VizLib.CanvasUtils.setupHiDPICanvas(projectionCanvas);
            projectionCtx = p.ctx; projectionDpr = p.dpr;
        }

        canvas.addEventListener('click', function(e) {
            const rect = canvas.getBoundingClientRect();
            const d = c2d(e.clientX - rect.left, e.clientY - rect.top);
            if (d.x < 0 || d.x > 1 || d.y < 0 || d.y > 1) return;

            if (editMode === 'add') {
                points.push({ x: d.x, y: d.y });
            } else {
                let closest = -1, minDist = 20;
                for (let i = 0; i < points.length; i++) {
                    const cp = d2c(points[i].x, points[i].y);
                    const dist = Math.hypot(cp.x - (e.clientX - rect.left), cp.y - (e.clientY - rect.top));
                    if (dist < minDist) { minDist = dist; closest = i; }
                }
                if (closest >= 0) points.splice(closest, 1);
            }
            if (computed) doReset(); else { updateMetrics(); render(); }
        });

        // Edit mode
        document.querySelectorAll('.edit-mode-buttons .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.edit-mode-buttons .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                editMode = this.dataset.mode;
                canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
            });
        });

        document.getElementById('btn-clear-points').addEventListener('click', () => { points = []; doReset(); });

        document.getElementById('dataset-select').addEventListener('change', function() {
            if (this.value !== 'custom') { generateDataset(this.value); doReset(); }
        });

        // Component selector
        document.querySelectorAll('[data-k]').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('[data-k]').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                numComponents = parseInt(this.dataset.k);
                updateMetrics();
                render();
                renderProjectionSpace();
            });
        });

        document.getElementById('show-projections').addEventListener('change', function() { showProjections = this.checked; render(); });
        document.getElementById('show-mean').addEventListener('change', function() { showMean = this.checked; render(); });
        document.getElementById('show-pc-axes').addEventListener('change', function() { showPCAxes = this.checked; render(); });

        document.getElementById('btn-compute').addEventListener('click', doCompute);
        document.getElementById('btn-reset').addEventListener('click', doReset);

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

        document.addEventListener('themechange', () => { render(); renderScree(); renderProjectionSpace(); });

        render();
        updateMetrics();
    }

    window.addEventListener('vizlib-ready', init);
})();

/**
 * PCA Explorer — drag principal component axes to explore variance maximization.
 */
(function () {
    'use strict';

    // ── constants ──────────────────────────────────────────
    const HANDLE_R = 10;          // drag-handle radius (canvas px)
    const HANDLE_HIT = 18;        // hit-test radius
    const POINT_R = 4.5;
    const ARROW_SIZE = 10;
    const AXIS_LEN_FACTOR = 0.38; // axis length relative to canvas width
    const SNAP_DURATION = 600;    // ms

    // ── state ──────────────────────────────────────────────
    let points = [];              // {x,y} in [0,1]
    let theta1 = Math.PI / 4;    // angle of axis 1 (radians, from +x)
    let theta2 = -Math.PI / 4;   // angle of axis 2
    let lockOrtho = false;
    let showProjection = true;
    let projectionPCs = 2;  // 1 = project onto PC1 only, 2 = both (lossless in 2D)
    let showProj1 = true;
    let showProj2 = true;
    let noiseX1 = 0.5;
    let noiseX2 = 0.5;
    let basePoints = [];              // pre-noise points for regeneration
    let currentDataset = 'correlated';
    let dragging = null;          // 'axis1' | 'axis2' | null
    let hovering = null;          // 'axis1' | 'axis2' | null
    let animating = false;

    // computed cache
    let covResult = null;         // {mean, cov, eigenvalues, eigenvectors}

    // canvas refs
    let canvas, ctx, dpr;
    let W, H;                     // logical size

    // ── coordinate helpers ─────────────────────────────────
    const PAD = 40;
    // viewExtent: how many std-devs to show in each direction from origin
    let viewExtent = 3.2;

    /** Standardized data coords → canvas px.  Origin (0,0) maps to center. */
    function d2c(sx, sy) {
        var cx = W / 2, cy = H / 2;
        var scale = (Math.min(W, H) - 2 * PAD) / (2 * viewExtent);
        return { x: cx + sx * scale, y: cy - sy * scale };
    }
    /** Canvas px → standardized data coords. */
    function c2d(px, py) {
        var cx = W / 2, cy = H / 2;
        var scale = (Math.min(W, H) - 2 * PAD) / (2 * viewExtent);
        return { x: (px - cx) / scale, y: -(py - cy) / scale };
    }

    /** Standardize a raw point {x,y} using covResult mean & std. */
    function standardize(p) {
        if (!covResult) return { x: 0, y: 0 };
        return {
            x: (p.x - covResult.mean.x) / covResult.std.x,
            y: (p.y - covResult.mean.y) / covResult.std.y
        };
    }
    /** Un-standardize back to raw [0,1] coords. */
    function unstandardize(sx, sy) {
        if (!covResult) return { x: 0.5, y: 0.5 };
        return {
            x: sx * covResult.std.x + covResult.mean.x,
            y: sy * covResult.std.y + covResult.mean.y
        };
    }

    // ── PCA math ───────────────────────────────────────────
    function computeCovariance() {
        const n = points.length;
        if (n < 2) { covResult = null; return; }
        let mx = 0, my = 0;
        for (const p of points) { mx += p.x; my += p.y; }
        mx /= n; my /= n;

        let cxx = 0, cxy = 0, cyy = 0;
        for (const p of points) {
            const dx = p.x - mx, dy = p.y - my;
            cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
        }
        cxx /= n; cxy /= n; cyy /= n;

        // eigenvalues of 2×2 symmetric
        const trace = cxx + cyy;
        const det = cxx * cyy - cxy * cxy;
        const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
        const l1 = trace / 2 + disc;
        const l2 = trace / 2 - disc;

        // eigenvectors
        let v1, v2;
        if (Math.abs(cxy) > 1e-12) {
            v1 = normalize({ x: l1 - cyy, y: cxy });
            v2 = normalize({ x: l2 - cyy, y: cxy });
        } else {
            v1 = cxx >= cyy ? { x: 1, y: 0 } : { x: 0, y: 1 };
            v2 = cxx >= cyy ? { x: 0, y: 1 } : { x: 1, y: 0 };
        }

        var sdx = Math.sqrt(cxx) || 1e-6;
        var sdy = Math.sqrt(cyy) || 1e-6;

        covResult = {
            mean: { x: mx, y: my },
            std: { x: sdx, y: sdy },
            cov: { xx: cxx, xy: cxy, yy: cyy },
            eigenvalues: [l1, l2],
            eigenvectors: [v1, v2],
            totalVar: cxx + cyy
        };
        syncThetaToEigenvectors();
    }

    function syncThetaToEigenvectors() {
        if (!covResult) return;
        theta1 = Math.atan2(covResult.eigenvectors[0].y, covResult.eigenvectors[0].x);
        theta2 = Math.atan2(covResult.eigenvectors[1].y, covResult.eigenvectors[1].x);
    }

    function normalize(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y);
        return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
    }

    /** Variance of data projected onto unit direction (cos(a), sin(a)). */
    function varianceAlongAngle(a) {
        if (!covResult) return 0;
        const c = Math.cos(a), s = Math.sin(a);
        const { xx, xy, yy } = covResult.cov;
        return xx * c * c + 2 * xy * c * s + yy * s * s; // v^T C v
    }

    /** Combined variance captured by two axes, accounting for non-orthogonality.
     *  PC2 only contributes the portion of its variance that is independent of PC1.
     *  When parallel: combined = max(v1,v2). When orthogonal: combined = v1+v2. */
    function combinedVariance(a1, a2) {
        if (!covResult) return 0;
        var v1 = varianceAlongAngle(a1);
        var v2 = varianceAlongAngle(a2);
        // sin²(angle between axes) = fraction of PC2 that's independent of PC1
        var c1 = Math.cos(a1), s1 = Math.sin(a1);
        var c2 = Math.cos(a2), s2 = Math.sin(a2);
        var dot = c1 * c2 + s1 * s2;
        var sin2 = 1 - dot * dot;
        return Math.min(covResult.totalVar, v1 + v2 * sin2);
    }

    // ── colors ─────────────────────────────────────────────
    function getColors() {
        const s = getComputedStyle(document.documentElement);
        const g = v => s.getPropertyValue(v).trim();
        return {
            axis1:     g('--pce-axis1') || '#e41a1c',
            axis2:     g('--pce-axis2') || '#377eb8',
            proj:      g('--pce-proj') || 'rgba(100,100,100,0.25)',
            ellipse:   g('--pce-ellipse') || 'rgba(150,100,200,0.4)',
            optimal:   g('--pce-optimal') || 'rgba(100,100,100,0.3)',
            mean:      g('--pce-mean') || '#ff9800',
            point:     g('--pce-point') || '#555',
            pointStr:  g('--pce-point-stroke') || 'rgba(255,255,255,0.8)',
            handleStr: g('--pce-handle-stroke') || '#fff',
            pc1:       g('--pce-pc1') || '#8e44ad',
            pc2:       g('--pce-pc2') || '#27ae60',
            bg:        g('--viz-canvas-bg') || '#fafafa',
            muted:     g('--viz-text-muted') || '#6c757d',
            border:    g('--viz-border') || '#dee2e6',
        };
    }

    // ── drawing ────────────────────────────────────────────
    function render() {
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(ctx, dpr);
        CU.clearCanvas(ctx, W, H, c.bg);

        // ── original x/y axes ──
        drawOriginalAxes(c);

        if (!covResult) {
            renderPoints(c);
            updateOverlay();
            return;
        }

        const origin = d2c(0, 0);
        const axisLen = W * AXIS_LEN_FACTOR;

        // ── dashed PC guide lines (full extent, behind everything) ──
        var guideLen = Math.max(W, H);
        for (var k = 0; k < 2; k++) {
            var a = k === 0 ? theta1 : theta2;
            var col = k === 0 ? c.pc1 : c.pc2;
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.35;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(origin.x - Math.cos(a) * guideLen, origin.y + Math.sin(a) * guideLen);
            ctx.lineTo(origin.x + Math.cos(a) * guideLen, origin.y - Math.sin(a) * guideLen);
            ctx.stroke();
            ctx.restore();
        }

        // ── projection lines ──
        if (showProjection) drawProjection(origin, c);

        // ── draggable PC axes (scaled by √variance along current direction) ──
        var maxSd = Math.sqrt(covResult.eigenvalues[0]) || 1;
        var scaleFactor = axisLen / maxSd;
        var len1 = Math.sqrt(Math.max(0, varianceAlongAngle(theta1))) * scaleFactor;
        var len2 = Math.sqrt(Math.max(0, varianceAlongAngle(theta2))) * scaleFactor;
        drawPCVector(origin, theta1, len1, c.pc1, 0,
            hovering === 'axis1' || dragging === 'axis1' ? 1.3 : 1);
        drawPCVector(origin, theta2, len2, c.pc2, 1,
            hovering === 'axis2' || dragging === 'axis2' ? 1.3 : 1);

        // ── data points ──
        renderPoints(c);

        updateOverlay();
        updateVarianceBars();
        updateMathTab();
        updateBadges();
        drawDistributions();
    }

    function renderPoints(c) {
        for (const p of points) {
            var sp = covResult ? standardize(p) : { x: p.x - 0.5, y: p.y - 0.5 };
            const cp = d2c(sp.x, sp.y);
            ctx.fillStyle = c.point;
            ctx.strokeStyle = c.pointStr;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, POINT_R, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
        }
    }

    function drawAxisLine(mc, angle, len, color, lineW, dash, handleScale, label) {
        // Note: angle is in data space (y-up), canvas is y-down
        const dx = Math.cos(angle), dy = Math.sin(angle);
        // In canvas coords, positive data-y is up (negative canvas-y)
        const endX = mc.x + dx * len;
        const endY = mc.y - dy * len; // flip y
        const startX = mc.x - dx * len * 0.3;
        const startY = mc.y + dy * len * 0.3;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        if (dash.length) ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        // arrowhead
        const aAngle = Math.atan2(startY - endY, startX - endX);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX + ARROW_SIZE * Math.cos(aAngle - Math.PI / 6),
                   endY + ARROW_SIZE * Math.sin(aAngle - Math.PI / 6));
        ctx.lineTo(endX + ARROW_SIZE * Math.cos(aAngle + Math.PI / 6),
                   endY + ARROW_SIZE * Math.sin(aAngle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        // drag handle
        if (handleScale !== null) {
            const hr = HANDLE_R * (handleScale || 1);
            ctx.beginPath();
            ctx.arc(endX, endY, hr, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = getColors().handleStr;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // label
        if (label) {
            ctx.fillStyle = color;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, endX + 14, endY - 8);
        }
        ctx.restore();
    }

    function drawPCVector(mc, angle, len, color, idx, handleScale) {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const startX = mc.x;
        const startY = mc.y;

        // arrowhead size — elongated and narrow
        var as = handleScale ? ARROW_SIZE * 2.2 * handleScale : ARROW_SIZE * 1.3;
        var aSpread = handleScale ? Math.PI / 9 : Math.PI / 10;

        // tip of arrowhead extends past len
        const tipX = mc.x + dx * (len + as * 0.4);
        const tipY = mc.y - dy * (len + as * 0.4);
        // line ends where arrowhead base starts
        const lineEndX = mc.x + dx * (len - as * 0.3);
        const lineEndY = mc.y - dy * (len - as * 0.3);
        // arrowhead base position
        const baseX = mc.x + dx * len;
        const baseY = mc.y - dy * len;

        ctx.save();
        // line (stops short of arrowhead)
        ctx.strokeStyle = color;
        ctx.lineWidth = idx === 0 ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(lineEndX, lineEndY);
        ctx.stroke();

        // arrowhead
        const aAngle = Math.atan2(startY - tipY, startX - tipX);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + as * Math.cos(aAngle - aSpread),
                   tipY + as * Math.sin(aAngle - aSpread));
        ctx.lineTo(tipX + as * Math.cos(aAngle + aSpread),
                   tipY + as * Math.sin(aAngle + aSpread));
        ctx.closePath();
        ctx.fill();

        // label with vector components
        var vx = Math.cos(angle), vy = Math.sin(angle);
        var lbl = 'PC' + (idx + 1) + ' (' + vx.toFixed(2) + ', ' + vy.toFixed(2) + ')';
        ctx.fillStyle = color;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lbl, tipX + 14, tipY - 8);
        ctx.restore();
    }

    function drawProjection(origin, c) {
        var cos1 = Math.cos(theta1), sin1 = Math.sin(theta1);
        var cos2 = Math.cos(theta2), sin2 = Math.sin(theta2);

        ctx.save();

        for (var i = 0; i < points.length; i++) {
            var sp = standardize(points[i]);
            var ptCanvas = d2c(sp.x, sp.y);

            // PC scores: coordinates in the new PC basis
            var score1 = sp.x * cos1 + sp.y * sin1;
            var score2 = sp.x * cos2 + sp.y * sin2;

            // Step 1 (PC1): original (x1, x2) → (score1, x2) — PC1 changes the x-coord
            // Step 2 (PC2): (score1, x2) → (score1, score2) — PC2 changes the y-coord
            var midCanvas = d2c(score1, sp.y);
            var finalCanvas = d2c(score1, score2);

            // Arrow 1: PC1 effect (horizontal movement in PC space)
            if (showProj1) {
                drawMiniArrow(ptCanvas.x, ptCanvas.y, midCanvas.x, midCanvas.y, c.pc1);
                ctx.fillStyle = c.pc1;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.arc(midCanvas.x, midCanvas.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Arrow 2: PC2 effect (vertical movement in PC space)
            if (showProj2) {
                var fromCanvas = showProj1 ? midCanvas : ptCanvas;
                drawMiniArrow(fromCanvas.x, fromCanvas.y, finalCanvas.x, finalCanvas.y, c.pc2);
                ctx.fillStyle = c.pc2;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.arc(finalCanvas.x, finalCanvas.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;
        ctx.restore();
    }

    function drawMiniArrow(x1, y1, x2, y2, color) {
        var dx = x2 - x1, dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 2) return;

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // arrowhead
        if (dist > 6) {
            var aAngle = Math.atan2(y1 - y2, x1 - x2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + 4 * Math.cos(aAngle - Math.PI / 8),
                       y2 + 4 * Math.sin(aAngle - Math.PI / 8));
            ctx.lineTo(x2 + 4 * Math.cos(aAngle + Math.PI / 8),
                       y2 + 4 * Math.sin(aAngle + Math.PI / 8));
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawEllipse(mc, c) {
        if (!covResult) return;
        const { eigenvalues, eigenvectors } = covResult;
        const scale = 2.5; // ~2 std devs
        const a = Math.sqrt(Math.max(0, eigenvalues[0])) * scale;
        const b = Math.sqrt(Math.max(0, eigenvalues[1])) * scale;
        const angle = Math.atan2(eigenvectors[0].y, eigenvectors[0].x);

        // Convert radii from data space to canvas px
        const rx = a * (W - 2 * PAD);
        const ry = b * (H - 2 * PAD);

        ctx.save();
        ctx.translate(mc.x, mc.y);
        ctx.rotate(-angle); // negative because canvas y is flipped
        ctx.strokeStyle = c.ellipse;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawOriginalAxes(c) {
        ctx.save();
        var ext = viewExtent;
        var left = d2c(-ext, 0), right = d2c(ext, 0);
        var bottom = d2c(0, -ext), top = d2c(0, ext);

        // axis lines through origin
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y); ctx.lineTo(right.x, right.y);
        ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(top.x, top.y);
        ctx.stroke();

        // arrowheads
        ctx.fillStyle = c.border;
        var as = 7;
        ctx.beginPath();
        ctx.moveTo(right.x, right.y);
        ctx.lineTo(right.x - as, right.y - as * 0.5);
        ctx.lineTo(right.x - as, right.y + as * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x - as * 0.5, top.y + as);
        ctx.lineTo(top.x + as * 0.5, top.y + as);
        ctx.closePath(); ctx.fill();

        // axis labels
        ctx.fillStyle = c.muted;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('x\u2081', right.x - 14, right.y - 8);
        ctx.textAlign = 'center';
        ctx.fillText('x\u2082', top.x + 12, top.y + 12);

        ctx.restore();
    }

    // ── distribution mini-canvas ────────────────────────────
    var distCanvas, distCtx, distDpr;
    var DIST_ROW_H = 40;   // height per row
    var DIST_ROWS = 4;     // x1, x2, PC1, PC2

    function initDistCanvas() {
        distCanvas = document.getElementById('pce-dist-canvas');
        if (!distCanvas) return;
        // Use the canvas's own CSS-rendered width (width:100% of parent)
        var cw = distCanvas.clientWidth;
        if (cw < 10) return; // tab not visible yet
        var ch = DIST_ROW_H * DIST_ROWS;
        distDpr = window.devicePixelRatio || 1;
        distCanvas.width = Math.round(cw * distDpr);
        distCanvas.height = Math.round(ch * distDpr);
        // Let CSS width:100% handle display size; only set height
        distCanvas.style.height = ch + 'px';
        distCtx = distCanvas.getContext('2d');
    }

    function drawDistributions() {
        if (!distCanvas || !distCtx) return;
        if (!covResult || points.length < 2) return;

        var col = getColors();
        var cw = Math.round(distCanvas.width / distDpr);
        var ch = Math.round(distCanvas.height / distDpr);
        distCtx.setTransform(distDpr, 0, 0, distDpr, 0, 0);
        distCtx.clearRect(0, 0, cw, ch);
        distCtx.fillStyle = col.bg;
        distCtx.fillRect(0, 0, cw, ch);

        var cos1 = Math.cos(theta1), sin1 = Math.sin(theta1);
        var cos2 = Math.cos(theta2), sin2 = Math.sin(theta2);
        var mx = covResult.mean.x, my = covResult.mean.y;

        // Compute scores along each axis for all points
        var axes = [
            { label: 'x\u2081', color: col.muted, scores: [] },
            { label: 'x\u2082', color: col.muted, scores: [] },
            { label: 'PC1',     color: col.pc1,   scores: [] },
            { label: 'PC2',     color: col.pc2,   scores: [] }
        ];
        for (var i = 0; i < points.length; i++) {
            var dx = points[i].x - mx, dy = points[i].y - my;
            axes[0].scores.push(dx);
            axes[1].scores.push(dy);
            axes[2].scores.push(dx * cos1 + dy * sin1);
            axes[3].scores.push(dx * cos2 + dy * sin2);
        }

        // Compute stats for each axis
        var stats = axes.map(function (ax) {
            var mean = 0;
            for (var j = 0; j < ax.scores.length; j++) mean += ax.scores[j];
            mean /= ax.scores.length;
            var variance = 0;
            for (var j = 0; j < ax.scores.length; j++) variance += (ax.scores[j] - mean) * (ax.scores[j] - mean);
            variance /= ax.scores.length;
            return { mean: mean, sd: Math.sqrt(variance) || 1e-6 };
        });

        // Shared x-axis range: use the largest σ so curve widths are visually comparable
        var maxSd = 0;
        for (var r = 0; r < DIST_ROWS; r++) {
            if (stats[r].sd > maxSd) maxSd = stats[r].sd;
        }
        var sharedRange = maxSd * 3.5;

        var labelW = 30;
        var padR = 62; // room for σ label
        var plotW = cw - labelW - padR;

        for (var r = 0; r < DIST_ROWS; r++) {
            var ax = axes[r];
            var st = stats[r];
            var y0 = r * DIST_ROW_H;
            var yMid = y0 + DIST_ROW_H * 0.65;
            var plotH = DIST_ROW_H * 0.5;

            // All rows share the same x range centered on 0
            var xMin = -sharedRange, xMax = sharedRange;

            // Label
            distCtx.fillStyle = ax.color;
            distCtx.font = 'bold 10px sans-serif';
            distCtx.textAlign = 'right';
            distCtx.textBaseline = 'middle';
            distCtx.fillText(ax.label, labelW - 4, yMid);

            // Number line
            distCtx.strokeStyle = col.border;
            distCtx.lineWidth = 1;
            distCtx.beginPath();
            distCtx.moveTo(labelW, yMid);
            distCtx.lineTo(labelW + plotW, yMid);
            distCtx.stroke();

            // Zero tick
            var zeroX = labelW + ((0 - xMin) / (xMax - xMin)) * plotW;
            if (zeroX > labelW && zeroX < labelW + plotW) {
                distCtx.strokeStyle = col.border;
                distCtx.beginPath();
                distCtx.moveTo(zeroX, yMid - 4);
                distCtx.lineTo(zeroX, yMid + 4);
                distCtx.stroke();
            }

            // Gaussian curve — height scaled by σ/maxσ so narrow distributions are tall & thin
            var heightScale = st.sd / maxSd;
            distCtx.beginPath();
            var steps = 80;
            for (var s = 0; s <= steps; s++) {
                var t = s / steps;
                var xVal = xMin + t * (xMax - xMin);
                var z = (xVal - st.mean) / st.sd;
                var gVal = Math.exp(-0.5 * z * z);
                var px = labelW + t * plotW;
                var py = yMid - gVal * plotH;
                if (s === 0) distCtx.moveTo(px, py);
                else distCtx.lineTo(px, py);
            }
            distCtx.lineTo(labelW + plotW, yMid);
            distCtx.closePath();
            distCtx.fillStyle = ax.color;
            distCtx.globalAlpha = 0.15;
            distCtx.fill();
            distCtx.globalAlpha = 0.7;
            distCtx.strokeStyle = ax.color;
            distCtx.lineWidth = 1.5;
            distCtx.stroke();
            distCtx.globalAlpha = 1;

            // Data points as ticks on the number line
            distCtx.fillStyle = ax.color;
            distCtx.globalAlpha = 0.4;
            for (var j = 0; j < ax.scores.length; j++) {
                var px = labelW + ((ax.scores[j] - xMin) / (xMax - xMin)) * plotW;
                if (px >= labelW && px <= labelW + plotW) {
                    distCtx.beginPath();
                    distCtx.moveTo(px, yMid + 1);
                    distCtx.lineTo(px, yMid + 6);
                    distCtx.strokeStyle = ax.color;
                    distCtx.lineWidth = 0.7;
                    distCtx.stroke();
                }
            }
            distCtx.globalAlpha = 1;

            // Separator line between rows
            if (r < DIST_ROWS - 1) {
                distCtx.strokeStyle = col.border;
                distCtx.globalAlpha = 0.3;
                distCtx.lineWidth = 0.5;
                distCtx.beginPath();
                distCtx.moveTo(labelW, y0 + DIST_ROW_H);
                distCtx.lineTo(labelW + plotW, y0 + DIST_ROW_H);
                distCtx.stroke();
                distCtx.globalAlpha = 1;
            }

            // σ label (right of plot area)
            distCtx.fillStyle = ax.color;
            distCtx.globalAlpha = 0.6;
            distCtx.font = '9px sans-serif';
            distCtx.textAlign = 'left';
            distCtx.fillText('\u03C3=' + st.sd.toFixed(3), labelW + plotW + 4, yMid + 3);
            distCtx.globalAlpha = 1;
        }
    }

    // ── UI updates ─────────────────────────────────────────
    function updateOverlay() {
        const el = document.getElementById('pce-overlay');
        if (el) el.classList.toggle('hidden', points.length > 0);
    }

    function updateVarianceBars() {
        if (!covResult) return;
        const total = covResult.totalVar;
        if (total < 1e-14) return;
        const v1 = varianceAlongAngle(theta1);
        const v2 = varianceAlongAngle(theta2);
        const pct1 = (v1 / total) * 100;
        const pct2 = (v2 / total) * 100;
        const combined = (combinedVariance(theta1, theta2) / total) * 100;

        const set = (id, w) => { const el = document.getElementById(id); if (el) el.style.width = Math.min(100, w) + '%'; };
        const txt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        set('pce-bar1', pct1);
        set('pce-bar2', pct2);
        set('pce-bar-total', combined);
        txt('pce-val1', pct1.toFixed(1) + '%');
        txt('pce-val2', pct2.toFixed(1) + '%');
        txt('pce-val-total', combined.toFixed(1) + '%');

        // covariance bar — covariance of projected scores along current axes
        // cov(s1,s2) = e1^T C e2  (should be 0 when axes are orthogonal eigenvectors)
        var c1 = Math.cos(theta1), s1 = Math.sin(theta1);
        var c2 = Math.cos(theta2), s2 = Math.sin(theta2);
        var { xx, xy, yy } = covResult.cov;
        var projCov = c1 * c2 * xx + (c1 * s2 + s1 * c2) * xy + s1 * s2 * yy;
        var maxCov = Math.sqrt(v1 * v2) || 1e-10;
        var covPct = (Math.abs(projCov) / maxCov) * 100;
        set('pce-bar-cov', covPct);
        txt('pce-val-cov', (projCov >= 0 ? '+' : '') + projCov.toFixed(4));

        // optimal markers
        const opt1Pct = (covResult.eigenvalues[0] / total) * 100;
        const opt2Pct = (covResult.eigenvalues[1] / total) * 100;
        const setL = (id, l) => { const el = document.getElementById(id); if (el) el.style.left = l + '%'; };
        setL('pce-opt1', opt1Pct);
        setL('pce-opt2', opt2Pct);
    }

    function updateBadges() {
        if (!covResult) return;
        const total = covResult.totalVar;
        if (total < 1e-14) return;
        const v1 = varianceAlongAngle(theta1);
        const v2 = varianceAlongAngle(theta2);
        const txt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        txt('badge-axis1-var', 'PC1: ' + ((v1 / total) * 100).toFixed(1) + '%');
        txt('badge-axis2-var', 'PC2: ' + ((v2 / total) * 100).toFixed(1) + '%');
        txt('badge-total-var', 'Total: ' + ((combinedVariance(theta1, theta2) / total) * 100).toFixed(1) + '%');
    }

    function updateMathTab() {
        if (!covResult) return;
        const { cov, eigenvalues, eigenvectors, totalVar } = covResult;
        const f = (v, d) => v.toFixed(d === undefined ? 5 : d);

        // ── Covariance matrix as a proper labeled table ──
        const covEl = document.getElementById('pce-cov-display');
        if (covEl) {
            covEl.innerHTML =
                '<div class="pce-matrix-wrapper">' +
                    '<span class="pce-matrix-eq">C =</span>' +
                    '<table class="pce-matrix">' +
                        '<thead><tr><th></th><th>x\u2081</th><th>x\u2082</th></tr></thead>' +
                        '<tbody>' +
                            '<tr><th>x\u2081</th>' +
                                '<td class="pce-cov-diag">' + f(cov.xx) + '</td>' +
                                '<td>' + f(cov.xy) + '</td></tr>' +
                            '<tr><th>x\u2082</th>' +
                                '<td>' + f(cov.xy) + '</td>' +
                                '<td class="pce-cov-diag">' + f(cov.yy) + '</td></tr>' +
                        '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div class="pce-matrix-note">Total variance (trace): ' + f(totalVar) + '</div>';
        }

        // ── Eigenvectors as a styled table ──
        const eigEl = document.getElementById('pce-eigen-display');
        if (eigEl) {
            const v1 = eigenvectors[0], v2 = eigenvectors[1];
            const pct1 = ((eigenvalues[0] / totalVar) * 100).toFixed(1);
            const pct2 = ((eigenvalues[1] / totalVar) * 100).toFixed(1);
            eigEl.innerHTML =
                '<table class="pce-eigen-table">' +
                    '<thead><tr><th></th><th>Direction</th><th>\u03BB</th><th>Explained</th></tr></thead>' +
                    '<tbody>' +
                        '<tr class="pce-eigen-row-pc1"><td class="pce-eigen-label">PC1</td>' +
                            '<td>(' + f(v1.x, 4) + ', ' + f(v1.y, 4) + ')</td>' +
                            '<td>' + f(eigenvalues[0]) + '</td>' +
                            '<td><span class="pce-pct-bar"><span class="pce-pct-fill pce-pct-pc1" style="width:' + pct1 + '%"></span></span> ' + pct1 + '%</td></tr>' +
                        '<tr class="pce-eigen-row-pc2"><td class="pce-eigen-label">PC2</td>' +
                            '<td>(' + f(v2.x, 4) + ', ' + f(v2.y, 4) + ')</td>' +
                            '<td>' + f(eigenvalues[1]) + '</td>' +
                            '<td><span class="pce-pct-bar"><span class="pce-pct-fill pce-pct-pc2" style="width:' + pct2 + '%"></span></span> ' + pct2 + '%</td></tr>' +
                    '</tbody>' +
                '</table>';
        }

        // ── Your axes variance ──
        const yourEl = document.getElementById('pce-your-var-display');
        if (yourEl) {
            const va1 = varianceAlongAngle(theta1);
            const va2 = varianceAlongAngle(theta2);
            const pctA1 = ((va1 / totalVar) * 100).toFixed(1);
            const pctA2 = ((va2 / totalVar) * 100).toFixed(1);
            const optPct1 = ((eigenvalues[0] / totalVar) * 100).toFixed(1);
            const angleBetween = Math.abs(theta1 - theta2);
            const angleDeg = ((angleBetween * 180 / Math.PI) % 360).toFixed(1);
            yourEl.innerHTML =
                '<table class="pce-your-table">' +
                    '<thead><tr><th></th><th>Direction</th><th>Variance</th><th>% of Total</th></tr></thead>' +
                    '<tbody>' +
                        '<tr><td class="pce-your-label pce-math-val-axis1">PC1</td>' +
                            '<td>(' + Math.cos(theta1).toFixed(3) + ', ' + Math.sin(theta1).toFixed(3) + ')</td>' +
                            '<td class="pce-math-val-axis1">' + f(va1) + '</td>' +
                            '<td class="pce-math-val-axis1">' + pctA1 + '%</td></tr>' +
                        '<tr><td class="pce-your-label pce-math-val-axis2">PC2</td>' +
                            '<td>(' + Math.cos(theta2).toFixed(3) + ', ' + Math.sin(theta2).toFixed(3) + ')</td>' +
                            '<td class="pce-math-val-axis2">' + f(va2) + '</td>' +
                            '<td class="pce-math-val-axis2">' + pctA2 + '%</td></tr>' +
                    '</tbody>' +
                '</table>' +
                '<div class="pce-your-footer">' +
                    '<span>Angle between axes: <strong>' + angleDeg + '\u00B0</strong></span>' +
                    '<span class="pce-gap-label">Gap from optimal: <strong>' + (parseFloat(optPct1) - parseFloat(pctA1)).toFixed(1) + '%</strong></span>' +
                '</div>' +
                '<div class="pce-formula">v<sup>T</sup>Cv = c<sub>xx</sub>cos\u00B2\u03B8 + 2c<sub>xy</sub>cos\u03B8 sin\u03B8 + c<sub>yy</sub>sin\u00B2\u03B8</div>';
        }
    }

    // ── datasets ───────────────────────────────────────────
    function gauss() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /** Generate base points with separate signal and per-point noise vectors. */
    function generateBasePoints(type) {
        basePoints = [];
        currentDataset = type;
        const n = 45;
        switch (type) {
            case 'correlated':
                for (let i = 0; i < n; i++) {
                    const t = gauss() * 0.12;
                    basePoints.push({ bx: 0.5 + t, by: 0.5 + t * 0.8, nx: gauss(), ny: gauss() });
                }
                break;
            case 'uncorrelated':
                for (let i = 0; i < n; i++)
                    basePoints.push({ bx: 0.5, by: 0.5, nx: gauss(), ny: gauss() });
                break;
            case 'anisotropic':
                for (let i = 0; i < n; i++) {
                    const a = 0.7, s1 = gauss() * 0.15;
                    basePoints.push({ bx: 0.5 + s1 * Math.cos(a), by: 0.5 + s1 * Math.sin(a), nx: gauss(), ny: gauss() });
                }
                break;
            case 'clustered':
                for (let i = 0; i < Math.floor(n / 2); i++) {
                    basePoints.push({ bx: 0.3, by: 0.35, nx: gauss(), ny: gauss() });
                    basePoints.push({ bx: 0.7, by: 0.65, nx: gauss(), ny: gauss() });
                }
                break;
            case 'circular':
                for (let i = 0; i < n; i++) {
                    const a = Math.random() * 2 * Math.PI;
                    const r = 0.15;
                    basePoints.push({ bx: 0.5 + r * Math.cos(a), by: 0.5 + r * Math.sin(a), nx: gauss(), ny: gauss() });
                }
                break;
        }
        applyNoise();
    }

    /** Apply noise sliders to base points to produce final points. */
    function applyNoise() {
        const cl = v => Math.max(0.05, Math.min(0.95, v));
        const sx = noiseX1 * 0.12;  // scale: 0 = no noise, 1 = heavy noise
        const sy = noiseX2 * 0.12;
        points = basePoints.map(function (p) {
            return { x: cl(p.bx + p.nx * sx), y: cl(p.by + p.ny * sy) };
        });
    }

    // ── drag interaction ───────────────────────────────────
    function getHandlePos(angle, idx) {
        if (!covResult) return null;
        const origin = d2c(0, 0);
        const axisLen = W * AXIS_LEN_FACTOR;
        var maxSd = Math.sqrt(covResult.eigenvalues[0]) || 1;
        var scaleFactor = axisLen / maxSd;
        var len = Math.sqrt(Math.max(0, varianceAlongAngle(angle))) * scaleFactor;
        var as = ARROW_SIZE * 2.2;
        var tipLen = len + as * 0.4;
        return { x: origin.x + Math.cos(angle) * tipLen, y: origin.y - Math.sin(angle) * tipLen };
    }

    function hitTestHandle(cx, cy) {
        const h1 = getHandlePos(theta1, 0);
        const h2 = getHandlePos(theta2, 1);
        if (h1 && Math.hypot(cx - h1.x, cy - h1.y) < HANDLE_HIT) return 'axis1';
        if (h2 && Math.hypot(cx - h2.x, cy - h2.y) < HANDLE_HIT) return 'axis2';
        return null;
    }

    function angleFromMeanToCanvas(cx, cy) {
        const origin = d2c(0, 0);
        return Math.atan2(-(cy - origin.y), cx - origin.x);
    }

    function onMouseDown(e) {
        if (animating) return;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (W / rect.width);
        const cy = (e.clientY - rect.top) * (H / rect.height);
        const hit = hitTestHandle(cx, cy);
        if (hit) {
            dragging = hit;
            e.preventDefault();
            return;
        }
        // add point — convert canvas click to raw data coords
        const sd = c2d(cx, cy);
        const raw = unstandardize(sd.x, sd.y);
        if (raw.x >= 0 && raw.x <= 1 && raw.y >= 0 && raw.y <= 1) {
            points.push({ x: raw.x, y: raw.y });
            computeCovariance();
            render();
        }
    }

    function onMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (W / rect.width);
        const cy = (e.clientY - rect.top) * (H / rect.height);

        if (dragging) {
            const a = angleFromMeanToCanvas(cx, cy);
            if (dragging === 'axis1') {
                theta1 = a;
                if (lockOrtho) theta2 = a - Math.PI / 2;
            } else {
                theta2 = a;
                if (lockOrtho) theta1 = a + Math.PI / 2;
            }
            render();
            return;
        }

        // hover detection
        const hit = hitTestHandle(cx, cy);
        if (hit !== hovering) {
            hovering = hit;
            canvas.style.cursor = hit ? 'grab' : 'crosshair';
            render();
        }
    }

    function onMouseUp() {
        if (dragging) {
            dragging = null;
            canvas.style.cursor = hovering ? 'grab' : 'crosshair';
        }
    }

    // ── snap to PCA animation ──────────────────────────────
    function snapToPCA() {
        if (!covResult || animating) return;
        animating = true;

        const ev = covResult.eigenvectors[0];
        let targetTheta1 = Math.atan2(ev.y, ev.x);

        // choose shortest rotation
        let diff = targetTheta1 - theta1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        targetTheta1 = theta1 + diff;

        const startTheta1 = theta1;
        const startTheta2 = theta2;
        const targetTheta2 = lockOrtho ? targetTheta1 - Math.PI / 2 : (function () {
            const ev2 = covResult.eigenvectors[1];
            let t = Math.atan2(ev2.y, ev2.x);
            let d = t - theta2;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            return theta2 + d;
        })();

        const startTime = performance.now();

        function step(now) {
            let t = Math.min(1, (now - startTime) / SNAP_DURATION);
            // ease-out cubic
            t = 1 - Math.pow(1 - t, 3);
            theta1 = startTheta1 + (targetTheta1 - startTheta1) * t;
            theta2 = startTheta2 + (targetTheta2 - startTheta2) * t;
            render();
            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                animating = false;
            }
        }
        requestAnimationFrame(step);
    }

    // ── init ───────────────────────────────────────────────
    function init() {
        canvas = document.getElementById('pce-canvas');
        if (!canvas) return;

        // size canvas to fill panel
        const container = canvas.parentElement;
        const cw = container.clientWidth;
        const ch = Math.round(cw * 0.72); // aspect ratio ~4:3ish
        canvas.width = cw;
        canvas.height = ch;
        W = cw; H = ch;

        const setup = window.VizLib.CanvasUtils.setupHiDPICanvas(canvas);
        ctx = setup.ctx;
        dpr = setup.dpr;

        initDistCanvas();

        // events
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        // touch support
        canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            const t = e.touches[0];
            onMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function(){} });
        }, { passive: false });
        canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            const t = e.touches[0];
            onMouseMove({ clientX: t.clientX, clientY: t.clientY });
        }, { passive: false });
        canvas.addEventListener('touchend', onMouseUp);

        // controls
        document.getElementById('pce-dataset').addEventListener('change', function () {
            if (this.value !== 'custom') {
                generateBasePoints(this.value);
                computeCovariance();
                render();
            }
        });

        // noise sliders
        function wireNoiseSlider(id, valId, setter) {
            var slider = document.getElementById(id);
            var valEl = document.getElementById(valId);
            slider.addEventListener('input', function () {
                setter(parseFloat(this.value));
                valEl.textContent = parseFloat(this.value).toFixed(2);
                if (currentDataset !== 'custom') {
                    applyNoise();
                    computeCovariance();
                    render();
                }
            });
        }
        wireNoiseSlider('pce-noise-x1', 'pce-noise-x1-val', function (v) { noiseX1 = v; });
        wireNoiseSlider('pce-noise-x2', 'pce-noise-x2-val', function (v) { noiseX2 = v; });

        document.getElementById('pce-lock-ortho').addEventListener('change', function () {
            lockOrtho = this.checked;
            if (lockOrtho) { theta2 = theta1 - Math.PI / 2; render(); }
        });
        document.querySelectorAll('[data-proj]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('[data-proj]').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                var val = parseInt(this.dataset.proj);
                showProjection = val > 0;
                projectionPCs = val;
                render();
            });
        });


        document.getElementById('pce-toggle-proj1').addEventListener('change', function () {
            showProj1 = this.checked;
            showProjection = showProj1 || showProj2;
            render();
        });
        document.getElementById('pce-toggle-proj2').addEventListener('change', function () {
            showProj2 = this.checked;
            showProjection = showProj1 || showProj2;
            render();
        });

        document.getElementById('pce-btn-snap').addEventListener('click', snapToPCA);
        document.getElementById('pce-btn-clear').addEventListener('click', function () {
            points = [];
            basePoints = [];
            currentDataset = 'custom';
            covResult = null;
            theta1 = Math.PI / 4;
            theta2 = lockOrtho ? theta1 - Math.PI / 2 : -Math.PI / 4;
            document.getElementById('pce-dataset').value = 'custom';
            render();
        });

        // info tabs wiring
        document.querySelectorAll('.info-panel-tabs .btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tabId = this.dataset.tab;
                document.querySelectorAll('.info-panel-tabs .btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                document.querySelectorAll('.info-tab-content').forEach(function (c) { c.classList.remove('active'); });
                var content = document.getElementById('tab-' + tabId);
                if (content) content.classList.add('active');
                if (tabId === 'math') {
                    initDistCanvas();
                    drawDistributions();
                }
            });
        });

        // theme change
        document.addEventListener('themechange', render);

        // resize handler
        let resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                const cw2 = container.clientWidth;
                const ch2 = Math.round(cw2 * 0.72);
                canvas.width = cw2;
                canvas.height = ch2;
                W = cw2; H = ch2;
                const s = window.VizLib.CanvasUtils.setupHiDPICanvas(canvas);
                ctx = s.ctx; dpr = s.dpr;
                initDistCanvas();
                render();
            }, 100);
        });

        // load whatever dataset the select defaults to
        var defaultDataset = document.getElementById('pce-dataset').value;
        if (defaultDataset && defaultDataset !== 'custom') {
            generateBasePoints(defaultDataset);
        }
        computeCovariance();
        render();
    }

    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();

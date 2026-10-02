(function() {
    'use strict';

    // ========== State ==========
    var state = {
        N: 2, C: 4, S: 4, G: 2,
        eps: 1e-5,
        noise: 1.5,
        affine: true,
        normType: 'batch',
        tensor: null,       // Float64Array [N * C * S]
        gamma: null,        // Float64Array [C]
        beta: null,         // Float64Array [C]
        hoveredCell: null,   // {n, c, s} or null
        lockedCell: null,    // {n, c, s} or null
        cellLayout: null     // precomputed pixel rects
    };

    var tensorCanvas, tensorCtx;
    var distCanvas, distCtx;
    var isDark = false;

    // ========== Helpers ==========
    function idx(n, c, s) {
        return n * state.C * state.S + c * state.S + s;
    }

    function gaussRandom() {
        var u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function generateTensor() {
        var size = state.N * state.C * state.S;
        state.tensor = new Float64Array(size);
        // Per-channel mean/variance offsets for realism
        for (var c = 0; c < state.C; c++) {
            var channelMean = (c - state.C / 2) * 1.5;
            var channelStd = 0.5 + Math.random() * 1.5;
            for (var n = 0; n < state.N; n++) {
                for (var s = 0; s < state.S; s++) {
                    state.tensor[idx(n, c, s)] = channelMean + gaussRandom() * channelStd * state.noise;
                }
            }
        }
        // gamma=1, beta=0 per channel
        state.gamma = new Float64Array(state.C);
        state.beta = new Float64Array(state.C);
        for (var ci = 0; ci < state.C; ci++) {
            state.gamma[ci] = 0.8 + Math.random() * 0.4;
            state.beta[ci] = (Math.random() - 0.5) * 0.5;
        }
    }

    // ========== Group Computation (core logic) ==========
    function getGroupId(normType, n, c, s, N, C, S, G) {
        switch (normType) {
            case 'batch':
                // Same channel across all batch & spatial -> one group per channel
                return c;
            case 'layer':
                // All channels + spatial for one batch item -> one group per batch item
                return n;
            case 'instance':
                // One channel, one batch item, all spatial -> one group per (n, c)
                return n * C + c;
            case 'group':
                // G groups of C/G channels, per batch item
                var groupIdx = Math.floor(c / (C / G));
                return n * G + groupIdx;
            case 'rms':
                // Same grouping as LayerNorm (but different normalization formula)
                return n;
            default:
                return 0;
        }
    }

    function getGroupMembers(normType, groupId, N, C, S, G) {
        var members = [];
        for (var n = 0; n < N; n++) {
            for (var c = 0; c < C; c++) {
                for (var s = 0; s < S; s++) {
                    if (getGroupId(normType, n, c, s, N, C, S, G) === groupId) {
                        members.push({n: n, c: c, s: s});
                    }
                }
            }
        }
        return members;
    }

    function computeGroupStats(members) {
        var sum = 0;
        var sumSq = 0;
        var count = members.length;
        for (var i = 0; i < count; i++) {
            var val = state.tensor[idx(members[i].n, members[i].c, members[i].s)];
            sum += val;
            sumSq += val * val;
        }
        var mean = sum / count;
        var variance = sumSq / count - mean * mean;
        return {mean: mean, variance: variance, meanSq: sumSq / count, count: count};
    }

    function normalizeValue(val, stats, c) {
        var normed;
        if (state.normType === 'rms') {
            normed = val / Math.sqrt(stats.meanSq + state.eps);
        } else {
            normed = (val - stats.mean) / Math.sqrt(stats.variance + state.eps);
        }
        if (state.affine) {
            normed = state.gamma[c] * normed + state.beta[c];
        }
        return normed;
    }

    // ========== Color Mapping ==========
    function getCS() {
        var style = getComputedStyle(document.documentElement);
        return {
            neg: style.getPropertyValue('--norm-neg-color').trim(),
            zero: style.getPropertyValue('--norm-zero-color').trim(),
            pos: style.getPropertyValue('--norm-pos-color').trim(),
            highlight: style.getPropertyValue('--norm-highlight-color').trim(),
            highlightBorder: style.getPropertyValue('--norm-highlight-border').trim(),
            lockedBorder: style.getPropertyValue('--norm-locked-border').trim(),
            batchColor: style.getPropertyValue('--norm-batch-color').trim(),
            channelColor: style.getPropertyValue('--norm-channel-color').trim(),
            spatialColor: style.getPropertyValue('--norm-spatial-color').trim(),
            text: style.getPropertyValue('--viz-text').trim(),
            textMuted: style.getPropertyValue('--viz-text-muted').trim(),
            bg: style.getPropertyValue('--viz-canvas-bg').trim(),
            border: style.getPropertyValue('--viz-border').trim(),
            rawBar: style.getPropertyValue('--norm-raw-bar').trim(),
            normedBar: style.getPropertyValue('--norm-normed-bar').trim()
        };
    }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return {
            r: parseInt(hex.substring(0,2), 16),
            g: parseInt(hex.substring(2,4), 16),
            b: parseInt(hex.substring(4,6), 16)
        };
    }

    function lerpColor(hex1, hex2, t) {
        var c1 = hexToRgb(hex1);
        var c2 = hexToRgb(hex2);
        var r = Math.round(c1.r + (c2.r - c1.r) * t);
        var g = Math.round(c1.g + (c2.g - c1.g) * t);
        var b = Math.round(c1.b + (c2.b - c1.b) * t);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function valueToDivergingColor(val, colors) {
        // Map value to color. Assume typical range [-3, 3]
        var clamped = Math.max(-3, Math.min(3, val));
        var t = (clamped + 3) / 6; // 0..1
        if (t < 0.5) {
            return lerpColor(colors.neg, colors.zero, t * 2);
        } else {
            return lerpColor(colors.zero, colors.pos, (t - 0.5) * 2);
        }
    }

    // ========== Tensor Canvas Rendering ==========
    function computeCellLayout() {
        var canvas = tensorCanvas;
        var w = canvas.width;
        var h = canvas.height;
        var dpr = window.devicePixelRatio || 1;
        var pw = w / dpr;
        var ph = h / dpr;

        // Layout: N stacked blocks, each is C rows x S cols
        // Reserve margins for labels
        var marginLeft = pw * 0.1;
        var marginRight = pw * 0.04;
        var marginTop = pw * 0.06;
        var marginBottom = pw * 0.04;
        var blockGap = pw * 0.04;

        var usableW = pw - marginLeft - marginRight;
        var usableH = ph - marginTop - marginBottom - (state.N - 1) * blockGap;
        var blockH = usableH / state.N;

        var cellW = usableW / state.S;
        var cellH = blockH / state.C;
        // Keep cells roughly square
        var cellSize = Math.min(cellW, cellH) * 0.92;
        var cellGap = cellSize * 0.08;

        // Recalculate to center
        var gridW = state.S * (cellSize + cellGap) - cellGap;
        var gridH = state.C * (cellSize + cellGap) - cellGap;
        var fullGridH = state.N * gridH + (state.N - 1) * blockGap;

        var startX = marginLeft + (usableW - gridW) / 2;
        var startY = marginTop + (usableH - fullGridH) / 2;

        var layout = {
            cells: [], // [{n, c, s, x, y, w, h}]
            blockRects: [], // [{x, y, w, h}] per batch item
            cellSize: cellSize,
            cellGap: cellGap,
            gridW: gridW,
            gridH: gridH,
            startX: startX,
            startY: startY,
            blockGap: blockGap,
            marginLeft: marginLeft,
            marginTop: marginTop,
            pw: pw,
            ph: ph
        };

        for (var n = 0; n < state.N; n++) {
            var blockY = startY + n * (gridH + blockGap);
            layout.blockRects.push({x: startX, y: blockY, w: gridW, h: gridH});
            for (var c = 0; c < state.C; c++) {
                for (var s = 0; s < state.S; s++) {
                    layout.cells.push({
                        n: n, c: c, s: s,
                        x: startX + s * (cellSize + cellGap),
                        y: blockY + c * (cellSize + cellGap),
                        w: cellSize,
                        h: cellSize
                    });
                }
            }
        }

        state.cellLayout = layout;
        return layout;
    }

    function drawTensorCanvas() {
        if (!state.tensor) return;
        var colors = getCS();
        var dpr = window.devicePixelRatio || 1;
        var layout = state.cellLayout;

        tensorCtx.save();
        tensorCtx.scale(dpr, dpr);
        tensorCtx.clearRect(0, 0, layout.pw, layout.ph);

        // Determine active cell and group
        var activeCell = state.lockedCell || state.hoveredCell;
        var activeGroupId = null;
        var activeMembers = null;
        if (activeCell) {
            activeGroupId = getGroupId(state.normType, activeCell.n, activeCell.c, activeCell.s, state.N, state.C, state.S, state.G);
            activeMembers = getGroupMembers(state.normType, activeGroupId, state.N, state.C, state.S, state.G);
        }

        // Build set for quick lookup
        var memberSet = {};
        if (activeMembers) {
            for (var m = 0; m < activeMembers.length; m++) {
                var key = activeMembers[m].n + ',' + activeMembers[m].c + ',' + activeMembers[m].s;
                memberSet[key] = true;
            }
        }

        // Draw batch labels
        for (var n = 0; n < state.N; n++) {
            var br = layout.blockRects[n];
            tensorCtx.save();
            tensorCtx.font = '600 ' + Math.max(10, layout.cellSize * 0.45) + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            tensorCtx.fillStyle = colors.batchColor;
            tensorCtx.textAlign = 'right';
            tensorCtx.textBaseline = 'middle';
            tensorCtx.fillText('n=' + n, layout.startX - layout.cellGap * 2, br.y + br.h / 2);
            tensorCtx.restore();
        }

        // Draw column headers (spatial) above first block
        if (layout.blockRects.length > 0) {
            tensorCtx.save();
            tensorCtx.font = '600 ' + Math.max(9, layout.cellSize * 0.4) + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            tensorCtx.fillStyle = colors.spatialColor;
            tensorCtx.textAlign = 'center';
            tensorCtx.textBaseline = 'bottom';
            for (var s = 0; s < state.S; s++) {
                var cx = layout.startX + s * (layout.cellSize + layout.cellGap) + layout.cellSize / 2;
                tensorCtx.fillText('s' + s, cx, layout.blockRects[0].y - 3);
            }
            tensorCtx.restore();
        }

        // Draw row labels (channels) beside first block
        if (layout.blockRects.length > 0) {
            tensorCtx.save();
            tensorCtx.font = '600 ' + Math.max(9, layout.cellSize * 0.4) + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            tensorCtx.fillStyle = colors.channelColor;
            tensorCtx.textAlign = 'left';
            tensorCtx.textBaseline = 'middle';
            for (var c = 0; c < state.C; c++) {
                var cy = layout.blockRects[0].y + c * (layout.cellSize + layout.cellGap) + layout.cellSize / 2;
                tensorCtx.fillText('c' + c, layout.startX + layout.gridW + layout.cellGap * 2, cy);
            }
            tensorCtx.restore();
        }

        // Draw cells
        for (var i = 0; i < layout.cells.length; i++) {
            var cell = layout.cells[i];
            var val = state.tensor[idx(cell.n, cell.c, cell.s)];
            var cellKey = cell.n + ',' + cell.c + ',' + cell.s;
            var inGroup = memberSet[cellKey];

            // Dim cells not in group when group is active
            var alpha = 1.0;
            if (activeCell && !inGroup) {
                alpha = 0.25;
            }

            tensorCtx.save();
            tensorCtx.globalAlpha = alpha;

            // Cell fill
            tensorCtx.fillStyle = valueToDivergingColor(val, colors);
            tensorCtx.fillRect(cell.x, cell.y, cell.w, cell.h);

            // Value text
            tensorCtx.font = '600 ' + Math.max(8, layout.cellSize * 0.32) + 'px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            tensorCtx.fillStyle = (Math.abs(val) < 1) ? colors.text : EAIColor('surface');
            tensorCtx.textAlign = 'center';
            tensorCtx.textBaseline = 'middle';
            tensorCtx.fillText(val.toFixed(1), cell.x + cell.w / 2, cell.y + cell.h / 2);

            tensorCtx.restore();

            // Highlight border for group members
            if (inGroup) {
                tensorCtx.save();
                tensorCtx.strokeStyle = colors.highlightBorder;
                tensorCtx.lineWidth = 2;
                tensorCtx.strokeRect(cell.x, cell.y, cell.w, cell.h);
                tensorCtx.restore();
            }

            // Extra border for active cell
            if (activeCell && cell.n === activeCell.n && cell.c === activeCell.c && cell.s === activeCell.s) {
                tensorCtx.save();
                tensorCtx.strokeStyle = state.lockedCell ? colors.lockedBorder : colors.highlightBorder;
                tensorCtx.lineWidth = 3;
                tensorCtx.strokeRect(cell.x - 1, cell.y - 1, cell.w + 2, cell.h + 2);
                tensorCtx.restore();
            }
        }

        // Draw block outlines (dashed) for batch items
        tensorCtx.save();
        tensorCtx.strokeStyle = colors.border;
        tensorCtx.lineWidth = 1;
        tensorCtx.setLineDash([4, 3]);
        for (var bn = 0; bn < state.N; bn++) {
            var rect = layout.blockRects[bn];
            tensorCtx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
        }
        tensorCtx.restore();

        // Draw norm type label
        var normLabels = {batch: 'BatchNorm', layer: 'LayerNorm', instance: 'InstanceNorm', group: 'GroupNorm', rms: 'RMSNorm'};
        tensorCtx.save();
        tensorCtx.font = 'bold ' + Math.max(12, layout.pw * 0.028) + 'px sans-serif';
        tensorCtx.fillStyle = colors.textMuted;
        tensorCtx.textAlign = 'left';
        tensorCtx.textBaseline = 'top';
        tensorCtx.fillText(normLabels[state.normType], 6, 6);
        tensorCtx.restore();

        tensorCtx.restore(); // dpr scale
    }

    // ========== Distribution Canvas ==========
    function drawDistCanvas() {
        var colors = getCS();
        var dpr = window.devicePixelRatio || 1;
        var w = distCanvas.width / dpr;
        var h = distCanvas.height / dpr;

        distCtx.save();
        distCtx.scale(dpr, dpr);
        distCtx.clearRect(0, 0, w, h);

        var activeCell = state.lockedCell || state.hoveredCell;
        if (!activeCell || !state.tensor) {
            tensorCtx.save();
            distCtx.font = '13px sans-serif';
            distCtx.fillStyle = colors.textMuted;
            distCtx.textAlign = 'center';
            distCtx.textBaseline = 'middle';
            distCtx.fillText('Hover or click a cell to see distributions', w / 2, h / 2);
            tensorCtx.restore();
            distCtx.restore();
            return;
        }

        var groupId = getGroupId(state.normType, activeCell.n, activeCell.c, activeCell.s, state.N, state.C, state.S, state.G);
        var members = getGroupMembers(state.normType, groupId, state.N, state.C, state.S, state.G);
        var stats = computeGroupStats(members);

        // Get raw and normalized values
        var rawVals = [];
        var normVals = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            var val = state.tensor[idx(m.n, m.c, m.s)];
            rawVals.push(val);
            normVals.push(normalizeValue(val, stats, m.c));
        }

        // Draw side-by-side histograms
        var halfW = w / 2 - 8;
        var padTop = 18;
        var padBottom = 20;
        var padSide = 12;
        var barAreaH = h - padTop - padBottom;

        // Helper: draw histogram
        function drawHist(vals, startX, areaW, color, label) {
            var numBins = Math.max(5, Math.min(15, Math.ceil(Math.sqrt(vals.length) * 1.5)));
            var min = Infinity, max = -Infinity;
            for (var j = 0; j < vals.length; j++) {
                if (vals[j] < min) min = vals[j];
                if (vals[j] > max) max = vals[j];
            }
            if (max === min) { max = min + 1; }
            var range = max - min;
            var binW = range / numBins;
            var bins = new Array(numBins).fill(0);
            for (var j = 0; j < vals.length; j++) {
                var bi = Math.min(numBins - 1, Math.floor((vals[j] - min) / binW));
                bins[bi]++;
            }
            var maxBin = Math.max.apply(null, bins);
            if (maxBin === 0) maxBin = 1;

            // Label
            distCtx.font = 'bold 11px sans-serif';
            distCtx.fillStyle = colors.text;
            distCtx.textAlign = 'center';
            distCtx.fillText(label, startX + areaW / 2, 12);

            // Bars
            var barW = (areaW - padSide * 2) / numBins;
            for (var b = 0; b < numBins; b++) {
                var barH = (bins[b] / maxBin) * barAreaH;
                var bx = startX + padSide + b * barW;
                var by = padTop + barAreaH - barH;
                distCtx.fillStyle = color;
                distCtx.fillRect(bx, by, barW - 1, barH);
            }

            // Axis labels
            distCtx.font = '10px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            distCtx.fillStyle = colors.textMuted;
            distCtx.textAlign = 'left';
            distCtx.fillText(min.toFixed(1), startX + padSide, h - 4);
            distCtx.textAlign = 'right';
            distCtx.fillText(max.toFixed(1), startX + areaW - padSide, h - 4);

            // Mean/std line
            distCtx.save();
            var meanX = startX + padSide + ((vals.reduce(function(a,b){return a+b;}, 0) / vals.length) - min) / range * (areaW - padSide * 2);
            distCtx.strokeStyle = colors.text;
            distCtx.lineWidth = 1.5;
            distCtx.setLineDash([3, 2]);
            distCtx.beginPath();
            distCtx.moveTo(meanX, padTop);
            distCtx.lineTo(meanX, padTop + barAreaH);
            distCtx.stroke();
            distCtx.restore();
        }

        drawHist(rawVals, 0, halfW, colors.rawBar, 'Raw Activations');
        drawHist(normVals, halfW + 16, halfW, colors.normedBar, 'Normalized');

        // Divider
        distCtx.save();
        distCtx.strokeStyle = colors.border;
        distCtx.lineWidth = 1;
        distCtx.setLineDash([3, 3]);
        distCtx.beginPath();
        distCtx.moveTo(w / 2, 4);
        distCtx.lineTo(w / 2, h - 4);
        distCtx.stroke();
        distCtx.restore();

        distCtx.restore(); // dpr scale
    }

    // ========== Math Panel ==========
    function updateMathPanel() {
        var panel = document.getElementById('norm-math-panel');
        var activeCell = state.lockedCell || state.hoveredCell;
        if (!activeCell || !state.tensor) {
            panel.innerHTML = '<span class="formula-note">Hover or click a cell to see the computation breakdown.</span>';
            return;
        }

        var n = activeCell.n, c = activeCell.c, s = activeCell.s;
        var val = state.tensor[idx(n, c, s)];
        var groupId = getGroupId(state.normType, n, c, s, state.N, state.C, state.S, state.G);
        var members = getGroupMembers(state.normType, groupId, state.N, state.C, state.S, state.G);
        var stats = computeGroupStats(members);
        var normed = normalizeValue(val, stats, c);

        var normLabels = {batch: 'BatchNorm', layer: 'LayerNorm', instance: 'InstanceNorm', group: 'GroupNorm', rms: 'RMSNorm'};
        var isRMS = state.normType === 'rms';

        var html = '<div class="norm-calc-row"><span>Cell:</span><span>[n=' + n + ', c=' + c + ', s=' + s + ']</span></div>';
        html += '<div class="norm-calc-row"><span>Value (x):</span><span>' + val.toFixed(4) + '</span></div>';
        html += '<div class="norm-calc-row"><span>Norm Type:</span><span>' + normLabels[state.normType] + '</span></div>';
        html += '<div class="norm-calc-row"><span>Group Size:</span><span>' + members.length + ' cells</span></div>';

        if (isRMS) {
            html += '<div class="norm-calc-row"><span>mean(x&sup2;):</span><span>' + stats.meanSq.toFixed(4) + '</span></div>';
            html += '<div class="norm-calc-row"><span>&radic;(mean(x&sup2;) + &epsilon;):</span><span>' + Math.sqrt(stats.meanSq + state.eps).toFixed(4) + '</span></div>';
            var rawNorm = val / Math.sqrt(stats.meanSq + state.eps);
            html += '<div class="norm-calc-row"><span>x / &radic;(...):</span><span>' + rawNorm.toFixed(4) + '</span></div>';
        } else {
            html += '<div class="norm-calc-row"><span>&mu; (mean):</span><span>' + stats.mean.toFixed(4) + '</span></div>';
            html += '<div class="norm-calc-row"><span>&sigma;&sup2; (var):</span><span>' + stats.variance.toFixed(4) + '</span></div>';
            html += '<div class="norm-calc-row"><span>&sigma; (std):</span><span>' + Math.sqrt(stats.variance + state.eps).toFixed(4) + '</span></div>';
            var rawNorm2 = (val - stats.mean) / Math.sqrt(stats.variance + state.eps);
            html += '<div class="norm-calc-row"><span>(x - &mu;) / &sigma;:</span><span>' + rawNorm2.toFixed(4) + '</span></div>';
        }

        if (state.affine) {
            html += '<div class="norm-calc-row"><span>&gamma;[' + c + ']:</span><span>' + state.gamma[c].toFixed(4) + '</span></div>';
            html += '<div class="norm-calc-row"><span>&beta;[' + c + ']:</span><span>' + state.beta[c].toFixed(4) + '</span></div>';
        }

        html += '<div class="norm-calc-row norm-calc-result"><span>Output:</span><span>' + normed.toFixed(4) + '</span></div>';

        panel.innerHTML = html;
    }

    // ========== UI Updates ==========
    function updateShapeBadge() {
        document.getElementById('norm-shape-badge').innerHTML =
            '[<span class="norm-dim-n">N=' + state.N + '</span>, <span class="norm-dim-c">C=' + state.C + '</span>, <span class="norm-dim-s">S=' + state.S + '</span>]';
    }

    function updateLockBadge() {
        var badge = document.getElementById('norm-lock-badge');
        var label = document.getElementById('norm-lock-label');
        if (state.lockedCell) {
            badge.style.display = '';
            label.textContent = '[' + state.lockedCell.n + ',' + state.lockedCell.c + ',' + state.lockedCell.s + ']';
        } else {
            badge.style.display = 'none';
        }
    }

    function setupCanvas(canvas, aspectH) {
        var dpr = window.devicePixelRatio || 1;
        var parentW = canvas.parentElement.clientWidth;
        var h = aspectH || parentW * 0.65;
        canvas.style.width = parentW + 'px';
        canvas.style.height = h + 'px';
        canvas.width = parentW * dpr;
        canvas.height = h * dpr;
    }

    function redraw() {
        setupCanvas(tensorCanvas);
        setupCanvas(distCanvas, distCanvas.parentElement.clientWidth * 0.35);
        computeCellLayout();
        drawTensorCanvas();
        drawDistCanvas();
        updateMathPanel();
        updateShapeBadge();
        updateLockBadge();
    }

    // ========== Hit Testing ==========
    function hitTestCell(mouseX, mouseY) {
        if (!state.cellLayout) return null;
        var layout = state.cellLayout;
        for (var i = 0; i < layout.cells.length; i++) {
            var cell = layout.cells[i];
            if (mouseX >= cell.x && mouseX <= cell.x + cell.w &&
                mouseY >= cell.y && mouseY <= cell.y + cell.h) {
                return {n: cell.n, c: cell.c, s: cell.s};
            }
        }
        return null;
    }

    // ========== Event Wiring ==========
    function init() {
        tensorCanvas = document.getElementById('norm-tensor-canvas');
        distCanvas = document.getElementById('norm-dist-canvas');
        tensorCtx = tensorCanvas.getContext('2d');
        distCtx = distCanvas.getContext('2d');

        isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';

        generateTensor();
        redraw();

        // Theme changes
        if (window.VizLib && window.VizLib.ThemeManager) {
            window.VizLib.ThemeManager.onThemeChange(function(theme) {
                isDark = theme === 'gruvbox-dark';
                redraw();
            });
        }

        // Norm type buttons
        var normBtns = document.querySelectorAll('.norm-type-toggle .btn');
        normBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                normBtns.forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                state.normType = btn.getAttribute('data-norm');
                state.lockedCell = null;
                redraw();
            });
        });

        // Canvas hover
        tensorCanvas.addEventListener('mousemove', function(e) {
            var rect = tensorCanvas.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            var mx = (e.clientX - rect.left);
            var my = (e.clientY - rect.top);
            var cell = hitTestCell(mx, my);
            if (cell) {
                state.hoveredCell = cell;
            } else {
                state.hoveredCell = null;
            }
            drawTensorCanvas();
            drawDistCanvas();
            updateMathPanel();
        });

        tensorCanvas.addEventListener('mouseleave', function() {
            state.hoveredCell = null;
            drawTensorCanvas();
            drawDistCanvas();
            updateMathPanel();
        });

        // Canvas click (lock)
        tensorCanvas.addEventListener('click', function(e) {
            var rect = tensorCanvas.getBoundingClientRect();
            var mx = (e.clientX - rect.left);
            var my = (e.clientY - rect.top);
            var cell = hitTestCell(mx, my);
            if (cell) {
                if (state.lockedCell && state.lockedCell.n === cell.n && state.lockedCell.c === cell.c && state.lockedCell.s === cell.s) {
                    state.lockedCell = null;
                } else {
                    state.lockedCell = cell;
                }
            } else {
                state.lockedCell = null;
            }
            updateLockBadge();
            drawTensorCanvas();
            drawDistCanvas();
            updateMathPanel();
        });

        // Sliders
        function wireSlider(id, key, display, formatter) {
            var slider = document.getElementById(id);
            var valEl = document.getElementById(display);
            if (!slider) return;
            slider.addEventListener('input', function() {
                var v = parseFloat(slider.value);
                if (key === 'eps') {
                    state.eps = Math.pow(10, v);
                    valEl.textContent = state.eps.toExponential(0);
                } else {
                    state[key] = v;
                    valEl.textContent = formatter ? formatter(v) : v;
                }
                if (key === 'N' || key === 'C' || key === 'S') {
                    // Clamp G to valid range
                    var maxG = state.C;
                    if (state.G > maxG) state.G = maxG;
                    var gSlider = document.getElementById('norm-g-slider');
                    gSlider.max = maxG;
                    if (parseInt(gSlider.value) > maxG) gSlider.value = maxG;
                    document.getElementById('norm-g-value').textContent = state.G;

                    state.lockedCell = null;
                    generateTensor();
                }
                redraw();
            });
        }

        wireSlider('norm-n-slider', 'N', 'norm-n-value');
        wireSlider('norm-c-slider', 'C', 'norm-c-value');
        wireSlider('norm-s-slider', 'S', 'norm-s-value');
        wireSlider('norm-g-slider', 'G', 'norm-g-value');
        wireSlider('norm-eps-slider', 'eps', 'norm-eps-value');
        wireSlider('norm-noise-slider', 'noise', 'norm-noise-value', function(v) { return v.toFixed(1); });

        // Affine checkbox
        var affineCb = document.getElementById('norm-affine-cb');
        affineCb.addEventListener('change', function() {
            state.affine = affineCb.checked;
            redraw();
        });

        // Randomize
        document.getElementById('norm-randomize-btn').addEventListener('click', function() {
            generateTensor();
            redraw();
        });

        // Reset
        document.getElementById('norm-reset-btn').addEventListener('click', function() {
            state.N = 2; state.C = 4; state.S = 4; state.G = 2;
            state.eps = 1e-5; state.noise = 1.5; state.affine = true;
            state.normType = 'batch'; state.lockedCell = null; state.hoveredCell = null;

            document.getElementById('norm-n-slider').value = 2;
            document.getElementById('norm-n-value').textContent = '2';
            document.getElementById('norm-c-slider').value = 4;
            document.getElementById('norm-c-value').textContent = '4';
            document.getElementById('norm-s-slider').value = 4;
            document.getElementById('norm-s-value').textContent = '4';
            document.getElementById('norm-g-slider').value = 2;
            document.getElementById('norm-g-slider').max = 4;
            document.getElementById('norm-g-value').textContent = '2';
            document.getElementById('norm-eps-slider').value = -5;
            document.getElementById('norm-eps-value').textContent = '1e-5';
            document.getElementById('norm-noise-slider').value = 1.5;
            document.getElementById('norm-noise-value').textContent = '1.5';
            document.getElementById('norm-affine-cb').checked = true;

            var normBtns2 = document.querySelectorAll('.norm-type-toggle .btn');
            normBtns2.forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-norm') === 'batch');
            });

            generateTensor();
            redraw();
        });

        // Resize
        var resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(redraw, 100);
        });

        // Info tab switching (btn-group variant)
        document.querySelectorAll('.info-panel-tabs .btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tabId = btn.getAttribute('data-tab');
                btn.closest('.info-panel-tabs').querySelectorAll('.btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var panel = btn.closest('.panel');
                panel.querySelectorAll('.info-tab-content').forEach(function(t) { t.classList.remove('active'); });
                var target = panel.querySelector('#tab-' + tabId);
                if (target) target.classList.add('active');
                setTimeout(redraw, 50);
            });
        });
    }

    // ========== Entry Point ==========
    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();

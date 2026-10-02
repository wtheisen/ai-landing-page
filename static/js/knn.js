/**
 * KNN Classification Visualizer
 *
 * Interactive visualization of K-Nearest Neighbors classification algorithm.
 * Features step-through playback, multiple distance metrics, decision boundaries,
 * and custom dataset drawing.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 480;
    const PADDING = 0;
    const PLOT_WIDTH = CANVAS_WIDTH;
    const PLOT_HEIGHT = CANVAS_HEIGHT;

    const POINT_RADIUS = 6;
    const QUERY_RADIUS = 8;
    const DEFAULT_NUM_POINTS = 100;

    // Step types for playback
    const STEP_TYPES = {
        INIT: 'INIT',
        COMPUTE_DISTANCES: 'COMPUTE_DISTANCES',
        ADD_NEIGHBOR: 'ADD_NEIGHBOR',
        VOTE: 'VOTE',
        CLASSIFICATION_COMPLETE: 'CLASSIFICATION_COMPLETE'
    };

    // Dataset descriptions
    const DATASET_INFO = {
        moons: 'Two interleaving half circles - a classic non-linear classification problem',
        circles: 'Concentric circles - tests circular decision boundaries',
        blobs: 'Three Gaussian clusters - demonstrates multi-class classification',
        linear: 'Linearly separable points - a simple baseline case',
        xor: 'XOR pattern - requires non-linear decision boundaries',
        spiral: 'Two intertwining spirals - a challenging non-linear case',
        custom: 'Draw your own training points using Add/Delete modes'
    };

    // ============================================
    // DatasetState Class
    // ============================================
    class DatasetState {
        constructor() {
            this.points = [];
            this.currentType = 'moons';
            this.numClasses = 2;
        }

        getPoints() {
            return this.points;
        }

        getNumClasses() {
            return this.numClasses;
        }

        getCurrentType() {
            return this.currentType;
        }

        clear() {
            this.points = [];
        }

        addPoint(point) {
            this.points.push({
                x: Math.max(0, Math.min(1, point.x)),
                y: Math.max(0, Math.min(1, point.y)),
                classLabel: point.classLabel
            });
        }

        removeNearestPoint(target, threshold = 0.03) {
            if (this.points.length === 0) return false;

            let minDist = Infinity;
            let minIdx = -1;

            this.points.forEach((p, i) => {
                const dist = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    minIdx = i;
                }
            });

            if (minDist < threshold && minIdx >= 0) {
                this.points.splice(minIdx, 1);
                return true;
            }
            return false;
        }

        loadDataset(type, numPoints = DEFAULT_NUM_POINTS) {
            this.currentType = type;
            this.points = [];

            const gen = VizLib.DatasetGenerators;
            switch (type) {
                case 'moons':
                    this.points = gen.moons(numPoints);
                    this.numClasses = 2;
                    break;
                case 'circles':
                    this.points = gen.circles(numPoints);
                    this.numClasses = 2;
                    break;
                case 'blobs':
                    this.points = gen.blobs(numPoints, 3);
                    this.numClasses = 3;
                    break;
                case 'linear':
                    this.points = gen.linear(numPoints);
                    this.numClasses = 2;
                    break;
                case 'xor':
                    this.points = gen.xor(numPoints);
                    this.numClasses = 2;
                    break;
                case 'spiral':
                    this.points = gen.spiral(numPoints);
                    this.numClasses = 2;
                    break;
                case 'custom':
                    // Keep existing points or start empty
                    this.numClasses = 3; // Allow all 3 classes in custom mode
                    break;
            }

            return this.points;
        }

        // Get a hash for caching
        getHash() {
            return `${this.currentType}_${this.points.length}_${this.points.slice(0, 5).map(p => p.x.toFixed(3)).join('')}`;
        }
    }

    // ============================================
    // KNNSolver Class
    // ============================================
    class KNNSolver {
        /**
         * Classify a query point
         * @param {Object} query - {x, y}
         * @param {Array} points - Array of {x, y, classLabel}
         * @param {Object} options - {k, metric, weighted}
         * @returns {Object} {prediction, confidence, neighbors, steps, voteBreakdown}
         */
        classify(query, points, options = {}) {
            const { k = 3, metric = 'euclidean', weighted = false } = options;
            const steps = [];
            const startTime = performance.now();

            if (points.length === 0) {
                return { prediction: null, confidence: 0, neighbors: [], steps: [], voteBreakdown: {} };
            }

            const effectiveK = Math.min(k, points.length);

            // Step 1: Init
            steps.push({
                type: STEP_TYPES.INIT,
                query: { ...query },
                k: effectiveK,
                metric,
                weighted,
                message: `Starting KNN with K=${effectiveK}, ${metric} distance${weighted ? ', weighted voting' : ''}`
            });

            // Step 2: Compute all distances
            const distances = this._computeDistances(query, points, metric);
            steps.push({
                type: STEP_TYPES.COMPUTE_DISTANCES,
                distances: distances.slice(0, 10).map(d => ({
                    point: d.point,
                    distance: d.distance
                })),
                totalPoints: points.length,
                message: `Computed distances to ${points.length} training points`
            });

            // Step 3: Add neighbors one by one
            const neighbors = [];
            for (let i = 0; i < effectiveK; i++) {
                neighbors.push(distances[i]);
                steps.push({
                    type: STEP_TYPES.ADD_NEIGHBOR,
                    neighbor: distances[i],
                    neighbors: neighbors.map(n => ({ ...n })),
                    rank: i + 1,
                    message: `Neighbor ${i + 1}: Class ${distances[i].point.classLabel}, distance=${distances[i].distance.toFixed(4)}`
                });
            }

            // Step 4: Vote
            const { prediction, confidence, voteBreakdown } = this._vote(neighbors, weighted);
            steps.push({
                type: STEP_TYPES.VOTE,
                voteBreakdown,
                prediction,
                confidence,
                weighted,
                message: `Vote: ${Object.entries(voteBreakdown).map(([c, v]) => `Class ${c}: ${v.toFixed(2)}`).join(', ')}`
            });

            // Step 5: Complete
            const time = performance.now() - startTime;
            steps.push({
                type: STEP_TYPES.CLASSIFICATION_COMPLETE,
                query: { ...query },
                prediction,
                confidence,
                neighbors: neighbors.map(n => ({ ...n })),
                voteBreakdown,
                time,
                message: `Classification: Class ${prediction} (${(confidence * 100).toFixed(1)}% confidence)`
            });

            return { prediction, confidence, neighbors, steps, voteBreakdown, time };
        }

        /**
         * Fast classification without step recording (for boundaries)
         */
        classifyFast(query, points, options = {}) {
            const { k = 3, metric = 'euclidean', weighted = false } = options;

            if (points.length === 0) {
                return { prediction: 0, confidence: 0 };
            }

            const effectiveK = Math.min(k, points.length);
            const distances = this._computeDistances(query, points, metric);
            const neighbors = distances.slice(0, effectiveK);
            return this._vote(neighbors, weighted);
        }

        /**
         * Run comparison with multiple configurations
         */
        compare(query, points, configs) {
            return configs.map(config => {
                const result = this.classifyFast(query, points, config);
                return {
                    ...config,
                    prediction: result.prediction,
                    confidence: result.confidence
                };
            });
        }

        _computeDistances(query, points, metric) {
            const distanceFn = this._getDistanceFunction(metric);

            return points.map((point, idx) => ({
                point,
                distance: distanceFn(query, point),
                idx
            })).sort((a, b) => a.distance - b.distance);
        }

        _getDistanceFunction(metric) {
            const MU = VizLib.MathUtils;
            switch (metric) {
                case 'manhattan':
                    return MU.manhattanDistance;
                case 'chebyshev':
                    return MU.chebyshevDistance;
                case 'euclidean':
                default:
                    return MU.euclideanDistance;
            }
        }

        _vote(neighbors, weighted) {
            const votes = {};
            let totalVotes = 0;

            // Check for zero-distance neighbors
            const zeroDistNeighbors = neighbors.filter(n => n.distance === 0);
            if (zeroDistNeighbors.length > 0) {
                // Give all votes to zero-distance neighbors
                zeroDistNeighbors.forEach(n => {
                    votes[n.point.classLabel] = (votes[n.point.classLabel] || 0) + 1;
                    totalVotes++;
                });
            } else if (weighted) {
                // Weighted voting
                neighbors.forEach(n => {
                    const weight = 1 / n.distance;
                    votes[n.point.classLabel] = (votes[n.point.classLabel] || 0) + weight;
                    totalVotes += weight;
                });
            } else {
                // Simple majority voting
                neighbors.forEach(n => {
                    votes[n.point.classLabel] = (votes[n.point.classLabel] || 0) + 1;
                    totalVotes++;
                });
            }

            // Find winner
            const maxVote = Math.max(...Object.values(votes));
            const winners = Object.keys(votes).filter(c => votes[c] === maxVote);

            let prediction;
            if (winners.length > 1) {
                // Tie-break: prefer class of nearest neighbor
                const nearestClass = neighbors[0].point.classLabel;
                if (winners.includes(String(nearestClass))) {
                    prediction = nearestClass;
                } else {
                    prediction = parseInt(winners[0]);
                }
            } else {
                prediction = parseInt(winners[0]);
            }

            const confidence = maxVote / totalVotes;

            return { prediction, confidence, voteBreakdown: votes };
        }
    }

    // ============================================
    // UIRenderer Class
    // ============================================
    class UIRenderer {
        constructor() {
            this.canvas = document.getElementById('knn-canvas');
            this.boundaryCanvas = document.getElementById('boundary-canvas');
            this.ctx = this.canvas?.getContext('2d');
            this.boundaryCtx = this.boundaryCanvas?.getContext('2d');

            this.queryPoint = null;
            this.neighbors = [];
            this.highlightedNeighborRank = -1;

            // Get colors from ThemeManager
            this._updateColors();

            // Set up Hi-DPI
            this._setupHiDPI();
        }

        _setupHiDPI() {
            if (!this.canvas || !this.boundaryCanvas) return;

            const dpr = window.devicePixelRatio || 1;
            this.dpr = dpr;

            // Get the actual display size from the container
            const wrapper = this.canvas.parentElement;
            const displayWidth = wrapper.clientWidth;
            const displayHeight = Math.round(displayWidth * (CANVAS_HEIGHT / CANVAS_WIDTH));

            // Calculate scale to fit logical canvas in display area
            const scale = displayWidth / CANVAS_WIDTH;

            // Set canvas internal resolution to match display size * dpr for crisp rendering
            this.canvas.width = displayWidth * dpr;
            this.canvas.height = displayHeight * dpr;
            this.canvas.style.width = displayWidth + 'px';
            this.canvas.style.height = displayHeight + 'px';
            // Scale context: dpr for hi-DPI, plus scale for fitting
            this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

            this.boundaryCanvas.width = displayWidth * dpr;
            this.boundaryCanvas.height = displayHeight * dpr;
            this.boundaryCanvas.style.width = displayWidth + 'px';
            this.boundaryCanvas.style.height = displayHeight + 'px';
            this.boundaryCtx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

            // Store the scale factor for mouse coordinate conversion
            this.displayScale = scale;
        }

        _updateColors() {
            if (window.VizLib?.ThemeManager) {
                const colors = window.VizLib.ThemeManager.getColors('categorical');
                this.classColors = colors.slice(0, 3);
            } else {
                // Fallback colors
                this.classColors = [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];
            }

            // Get CSS custom properties for query point
            const style = getComputedStyle(document.documentElement);
            this.queryColor = style.getPropertyValue('--knn-query-bg').trim() || '#ffd700';
            this.queryBorder = style.getPropertyValue('--knn-query-border').trim() || '#b8860b';
            this.neighborLineColor = style.getPropertyValue('--knn-neighbor-line').trim() || 'rgba(0,0,0,0.5)';
        }

        // Convert data coordinates [0,1] to canvas pixels
        dataToCanvas(x, y) {
            return {
                x: PADDING + x * PLOT_WIDTH,
                y: PADDING + (1 - y) * PLOT_HEIGHT  // Flip Y axis
            };
        }

        // Convert canvas pixels to data coordinates [0,1]
        canvasToData(canvasX, canvasY) {
            return {
                x: (canvasX - PADDING) / PLOT_WIDTH,
                y: 1 - (canvasY - PADDING) / PLOT_HEIGHT  // Flip Y axis
            };
        }

        // Get mouse position in data coordinates
        getMouseDataCoords(event) {
            const rect = this.canvas.getBoundingClientRect();
            // Convert from display coordinates to logical canvas coordinates
            const scale = this.displayScale || 1;
            const canvasX = (event.clientX - rect.left) / scale;
            const canvasY = (event.clientY - rect.top) / scale;
            return this.canvasToData(canvasX, canvasY);
        }

        // Main render function
        render(points, queryPoint = null, neighbors = [], result = null) {
            if (!this.ctx) return;

            this._updateColors();
            this.queryPoint = queryPoint;
            this.neighbors = neighbors;
            this.result = result;

            // Clear canvas
            this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            // Draw axes/grid
            this._drawGrid();

            // Draw neighbor lines first (behind points)
            if (queryPoint && neighbors.length > 0) {
                this._drawNeighborLines(queryPoint, neighbors);
            }

            // Draw training points
            this._drawPoints(points);

            // Draw query point on top
            if (queryPoint) {
                this._drawQueryPoint(queryPoint, result);
            }

            // Draw prediction popup
            if (queryPoint && result && result.prediction !== undefined) {
                this._drawPredictionPopup(queryPoint, result);
            }

            // Update legend vote dots
            this._updateLegendVotes(result);
        }

        _drawGrid() {
            // Grid removed for cleaner look - canvas fills its container
        }

        _drawPoints(points) {
            const ctx = this.ctx;

            points.forEach(point => {
                const pos = this.dataToCanvas(point.x, point.y);
                const color = this.classColors[point.classLabel] || this.classColors[0];

                ctx.beginPath();
                ctx.arc(pos.x, pos.y, POINT_RADIUS, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = EAIColor('surface');
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });
        }

        _drawQueryPoint(query, result = null) {
            const ctx = this.ctx;
            const pos = this.dataToCanvas(query.x, query.y);

            // Calculate blended color based on vote proportions
            let fillColor = this.queryColor;
            if (result && result.voteBreakdown) {
                fillColor = this._getBlendedColor(result.voteBreakdown);
            }

            // Outer glow with prediction color
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, QUERY_RADIUS + 4, 0, 2 * Math.PI);
            ctx.fillStyle = this._hexToRgba(fillColor, 0.3);
            ctx.fill();

            // Main point with blended color
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, QUERY_RADIUS, 0, 2 * Math.PI);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = EAIColor('surface');
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        _getBlendedColor(voteBreakdown) {
            const totalVotes = Object.values(voteBreakdown).reduce((a, b) => a + b, 0);
            if (totalVotes === 0) return this.queryColor;

            let r = 0, g = 0, b = 0;
            for (const [classLabel, votes] of Object.entries(voteBreakdown)) {
                const weight = votes / totalVotes;
                const color = this.classColors[parseInt(classLabel)] || this.classColors[0];
                const rgb = this._hexToRgbObj(color);
                r += rgb.r * weight;
                g += rgb.g * weight;
                b += rgb.b * weight;
            }
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }

        _hexToRgbObj(hex) {
            // Handle rgb() format
            if (hex.startsWith('rgb')) {
                const match = hex.match(/(\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
                }
            }
            // Handle hex format
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : { r: 255, g: 215, b: 0 };
        }

        _hexToRgba(color, alpha) {
            const rgb = this._hexToRgbObj(color);
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }

        _drawPredictionPopup(query, result) {
            const ctx = this.ctx;
            const pos = this.dataToCanvas(query.x, query.y);
            const prediction = result.prediction;
            const confidence = result.confidence;

            // Position popup above and to the right of query point
            const popupX = pos.x + 20;
            const popupY = pos.y - 30;

            // Popup background
            const text = `Class ${prediction + 1}`;
            const confText = `${(confidence * 100).toFixed(0)}%`;
            ctx.font = 'bold 12px sans-serif';
            const textWidth = Math.max(ctx.measureText(text).width, ctx.measureText(confText).width);
            const padding = 8;
            const popupWidth = textWidth + padding * 2;
            const popupHeight = 36;

            // Adjust position if popup would go off canvas
            let finalX = popupX;
            let finalY = popupY;
            if (finalX + popupWidth > CANVAS_WIDTH - PADDING) {
                finalX = pos.x - popupWidth - 20;
            }
            if (finalY < PADDING) {
                finalY = pos.y + 30;
            }

            // Draw popup background
            ctx.fillStyle = this.classColors[prediction];
            ctx.beginPath();
            ctx.roundRect(finalX, finalY, popupWidth, popupHeight, 4);
            ctx.fill();

            // Draw text
            ctx.fillStyle = EAIColor('surface');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(text, finalX + popupWidth / 2, finalY + 6);
            ctx.font = '10px sans-serif';
            ctx.fillText(confText, finalX + popupWidth / 2, finalY + 20);
        }

        _updateLegendVotes(result) {
            // Update legend with vote indicator dots
            for (let c = 0; c < 3; c++) {
                const legendItem = document.querySelector(`.legend-color.class-${c}`);
                if (!legendItem) continue;

                // Find or create vote indicator container
                let voteIndicator = legendItem.parentElement.querySelector('.vote-indicator');
                if (!voteIndicator) {
                    voteIndicator = document.createElement('span');
                    voteIndicator.className = 'vote-indicator';
                    legendItem.parentElement.appendChild(voteIndicator);
                }

                if (result && result.voteBreakdown && result.voteBreakdown[c]) {
                    const votes = result.voteBreakdown[c];
                    const totalVotes = Object.values(result.voteBreakdown).reduce((a, b) => a + b, 0);
                    const numDots = Math.round((votes / totalVotes) * 5); // Max 5 dots
                    voteIndicator.innerHTML = '<span class="vote-dot"></span>'.repeat(numDots);
                    voteIndicator.style.display = 'inline-flex';
                } else {
                    voteIndicator.innerHTML = '';
                    voteIndicator.style.display = 'none';
                }
            }
        }

        _drawNeighborLines(query, neighbors) {
            const ctx = this.ctx;
            const queryPos = this.dataToCanvas(query.x, query.y);

            // Calculate max distance for scaling
            const maxDist = neighbors.length > 0
                ? Math.max(...neighbors.map(n => n.distance))
                : 1;

            neighbors.forEach((neighbor, i) => {
                const pos = this.dataToCanvas(neighbor.point.x, neighbor.point.y);
                const isHighlighted = i === this.highlightedNeighborRank;
                const classColor = this.classColors[neighbor.point.classLabel];

                // Distance-based blend with white (closer = more saturated, farther = more white)
                const distRatio = neighbor.distance / maxDist;
                const blendedLineColor = this._blendWithWhite(classColor, distRatio * 0.7);

                ctx.beginPath();
                ctx.moveTo(queryPos.x, queryPos.y);
                ctx.lineTo(pos.x, pos.y);

                if (isHighlighted) {
                    ctx.strokeStyle = classColor;
                    ctx.lineWidth = 3;
                } else {
                    ctx.strokeStyle = blendedLineColor;
                    ctx.lineWidth = 2;
                }
                ctx.stroke();

                // Draw class-colored circle at midpoint with size scaled by distance
                const midX = (queryPos.x + pos.x) / 2;
                const midY = (queryPos.y + pos.y) / 2;

                // Closer = larger circle (range 8 to 14)
                const circleRadius = 8 + (1 - distRatio) * 6;

                // Circle fill also blends with white based on distance
                const blendedCircleColor = this._blendWithWhite(classColor, distRatio * 0.5);

                ctx.beginPath();
                ctx.arc(midX, midY, circleRadius, 0, 2 * Math.PI);
                ctx.fillStyle = blendedCircleColor;
                ctx.fill();
                ctx.strokeStyle = EAIColor('surface');
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Draw rank number
                ctx.fillStyle = EAIColor('surface');
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(i + 1), midX, midY);
            });
        }

        _blendWithWhite(color, ratio) {
            // Blend color with white: ratio 0 = pure color, ratio 1 = pure white
            const rgb = this._hexToRgbObj(color);
            const r = Math.round(rgb.r + (255 - rgb.r) * ratio);
            const g = Math.round(rgb.g + (255 - rgb.g) * ratio);
            const b = Math.round(rgb.b + (255 - rgb.b) * ratio);
            return `rgb(${r}, ${g}, ${b})`;
        }

        highlightNeighbor(rank) {
            this.highlightedNeighborRank = rank;
        }

        // Decision boundary rendering
        drawDecisionBoundary(grid, numClasses) {
            if (!this.boundaryCtx || !grid) return;

            const ctx = this.boundaryCtx;
            const resolution = grid.length;

            // Clear
            ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            const cellWidth = PLOT_WIDTH / resolution;
            const cellHeight = PLOT_HEIGHT / resolution;

            // Draw each cell
            ctx.globalAlpha = 0.25;

            for (let row = 0; row < resolution; row++) {
                for (let col = 0; col < resolution; col++) {
                    const classLabel = grid[row][col];
                    const color = this.classColors[classLabel] || this.classColors[0];

                    ctx.fillStyle = color;
                    ctx.fillRect(
                        PADDING + col * cellWidth,
                        PADDING + row * cellHeight,
                        cellWidth + 0.5,
                        cellHeight + 0.5
                    );
                }
            }

            ctx.globalAlpha = 1.0;
        }

        clearBoundary() {
            if (!this.boundaryCtx) return;
            this.boundaryCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.boundaryCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }

        showLoading(show, text = 'Computing boundaries...') {
            const overlay = document.getElementById('loading-overlay');
            const loadingText = overlay?.querySelector('.loading-text');
            if (overlay) {
                overlay.style.display = show ? 'flex' : 'none';
            }
            if (loadingText) {
                loadingText.textContent = text;
            }
        }

        // Update neighbors list
        updateNeighborsList(neighbors) {
            const listEl = document.getElementById('neighbors-list');
            const countEl = document.getElementById('neighbors-count');

            if (!listEl) return;

            if (countEl) {
                countEl.textContent = neighbors.length;
            }

            if (neighbors.length === 0) {
                listEl.innerHTML = '<div class="list-empty">Click to classify a point</div>';
                return;
            }

            let html = '';
            neighbors.forEach((n, i) => {
                html += `
                    <div class="neighbor-item class-${n.point.classLabel}" data-rank="${i}">
                        <span class="neighbor-rank">#${i + 1}</span>
                        <span class="neighbor-class class-${n.point.classLabel}">C${n.point.classLabel + 1}</span>
                        <span class="neighbor-distance">d=${n.distance.toFixed(4)}</span>
                        <span class="neighbor-coords">(${n.point.x.toFixed(2)}, ${n.point.y.toFixed(2)})</span>
                    </div>
                `;
            });

            listEl.innerHTML = html;
        }

        // Update comparison table
        updateComparisonTable(results, currentConfig) {
            const tbody = document.querySelector('#comparison-table tbody');
            if (!tbody) return;

            if (!results || results.length === 0) {
                tbody.innerHTML = '<tr class="compare-empty"><td colspan="4">Classify a point to compare</td></tr>';
                return;
            }

            // Find best confidence
            const maxConf = Math.max(...results.map(r => r.confidence));

            let html = '';
            results.forEach(r => {
                const isCurrent = currentConfig &&
                    r.k === currentConfig.k &&
                    r.metric === currentConfig.metric &&
                    r.weighted === currentConfig.weighted;
                const isBest = r.confidence === maxConf;

                html += `
                    <tr class="${isCurrent ? 'current-config' : ''}">
                        <td>${r.k}</td>
                        <td>${r.metric}</td>
                        <td><span class="prediction-badge class-${r.prediction}">C${r.prediction + 1}</span></td>
                        <td class="${isBest ? 'best-value' : ''}">${(r.confidence * 100).toFixed(1)}%</td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;
        }

        clearComparisonTable() {
            const tbody = document.querySelector('#comparison-table tbody');
            if (tbody) {
                tbody.innerHTML = '<tr class="compare-empty"><td colspan="4">Classify a point to compare</td></tr>';
            }
        }

        // Update playback status
        updatePlaybackStatus(text) {
            const el = document.getElementById('playback-step');
            if (el) el.textContent = text;
        }

        // Update dataset description
        updateDatasetDescription(type) {
            const el = document.getElementById('dataset-description');
            if (el) {
                el.textContent = DATASET_INFO[type] || '';
            }
        }
    }

    // ============================================
    // KNNApp Class (Main Controller)
    // ============================================
    class KNNApp {
        constructor() {
            this.dataset = new DatasetState();
            this.solver = new KNNSolver();
            this.ui = new UIRenderer();
            this.playback = null;

            this.currentQuery = null;
            this.currentResult = null;
            this.editMode = 'classify';
            this.selectedClass = 0;
            this.showBoundaries = false;
            this.boundaryCache = null;

            this._init();
        }

        _init() {
            // Wait for VizLib to be ready
            if (window.VizLib?.PlaybackController) {
                this._setupPlayback();
                this._setupEventListeners();
                this._loadInitialDataset();
            } else {
                window.addEventListener('vizlib-ready', () => {
                    this._setupPlayback();
                    this._setupEventListeners();
                    this._loadInitialDataset();
                });
            }
        }

        _setupPlayback() {
            const PlaybackController = window.VizLib?.PlaybackController;
            if (!PlaybackController) {
                console.warn('PlaybackController not available');
                return;
            }

            this.playback = new PlaybackController({
                initialSpeed: 6,
                onRenderStep: (step, index, metadata) => this._onRenderStep(step, index, metadata),
                onPlayStateChange: (isPlaying) => this._onPlayStateChange(isPlaying),
                onStepChange: (index, total) => this._onStepChange(index, total),
                onFinished: () => this._onPlaybackFinished(),
                onReset: () => this._onPlaybackReset()
            });
        }

        _setupEventListeners() {
            // Dataset selection (dropdown)
            document.getElementById('dataset-select')?.addEventListener('change', (e) => {
                const type = e.target.value;
                this._selectDataset(type);
            });

            // Canvas interaction
            this.ui.canvas?.addEventListener('click', (e) => this._handleCanvasClick(e));
            this.ui.canvas?.addEventListener('mousemove', (e) => this._handleCanvasHover(e));

            // Algorithm options - K stepper
            document.getElementById('k-minus')?.addEventListener('click', () => {
                const input = document.getElementById('k-value');
                const current = parseInt(input.value) || 3;
                if (current > 1) {
                    input.value = current - 1;
                    this._onOptionsChange();
                }
            });

            document.getElementById('k-plus')?.addEventListener('click', () => {
                const input = document.getElementById('k-value');
                const current = parseInt(input.value) || 3;
                if (current < 15) {
                    input.value = current + 1;
                    this._onOptionsChange();
                }
            });

            document.getElementById('distance-metric')?.addEventListener('change', () => {
                this._onOptionsChange();
            });

            document.getElementById('show-boundaries')?.addEventListener('change', (e) => {
                this.showBoundaries = e.target.checked;
                if (this.showBoundaries) {
                    this._computeBoundaries();
                } else {
                    this.ui.clearBoundary();
                }
            });

            document.getElementById('weighted-knn')?.addEventListener('change', () => {
                this._onOptionsChange();
            });

            // Edit toolbar
            document.querySelectorAll('[data-mode]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.editMode = e.currentTarget.dataset.mode;
                    document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this._updateCursor();
                });
            });

            document.querySelectorAll('[data-class]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.selectedClass = parseInt(e.currentTarget.dataset.class);
                    document.querySelectorAll('[data-class]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                });
            });

            document.getElementById('btn-clear-points')?.addEventListener('click', () => {
                this.dataset.clear();
                this._reset();
                this.ui.render(this.dataset.getPoints());
                this._invalidateBoundaryCache();
            });

            // Playback controls
            document.getElementById('btn-play')?.addEventListener('click', () => {
                if (this.playback?.isPlaying) {
                    this.playback.pause();
                } else {
                    this.playback?.play();
                }
            });

            document.getElementById('btn-pause')?.addEventListener('click', () => {
                this.playback?.pause();
            });

            document.getElementById('btn-step-forward')?.addEventListener('click', () => {
                this.playback?.pause();
                this.playback?.stepForward();
            });

            document.getElementById('btn-step-back')?.addEventListener('click', () => {
                this.playback?.pause();
                this.playback?.stepBackward();
            });

            document.getElementById('btn-reset')?.addEventListener('click', () => {
                this._reset();
            });

            // Speed slider
            document.getElementById('speed-slider')?.addEventListener('input', (e) => {
                this.playback?.setSpeed(parseInt(e.target.value));
            });

            // Comparison
            document.getElementById('btn-run-comparison')?.addEventListener('click', () => {
                this._runComparison();
            });

            // Info panel tabs
            document.querySelectorAll('.info-panel-tabs [data-tab]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tabId = e.currentTarget.dataset.tab;
                    // Update button states
                    document.querySelectorAll('.info-panel-tabs [data-tab]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    // Update tab content visibility
                    document.querySelectorAll('.info-tab-content').forEach(content => {
                        content.classList.toggle('active', content.id === `tab-${tabId}`);
                    });
                });
            });

            // Neighbor list hover
            document.getElementById('neighbors-list')?.addEventListener('mouseover', (e) => {
                const item = e.target.closest('.neighbor-item');
                if (item) {
                    const rank = parseInt(item.dataset.rank);
                    this.ui.highlightNeighbor(rank);
                    this.ui.render(this.dataset.getPoints(), this.currentQuery, this.currentResult?.neighbors || [], this.currentResult);
                }
            });

            document.getElementById('neighbors-list')?.addEventListener('mouseout', () => {
                this.ui.highlightNeighbor(-1);
                this.ui.render(this.dataset.getPoints(), this.currentQuery, this.currentResult?.neighbors || [], this.currentResult);
            });

            // Theme changes
            if (window.VizLib?.ThemeManager) {
                window.VizLib.ThemeManager.onThemeChange(() => {
                    this.ui._updateColors();
                    this.ui.render(this.dataset.getPoints(), this.currentQuery, this.currentResult?.neighbors || [], this.currentResult);
                    if (this.showBoundaries) {
                        this._computeBoundaries();
                    }
                });
            }
        }

        _loadInitialDataset() {
            this._selectDataset('moons');
        }

        _selectDataset(type) {
            this.dataset.loadDataset(type);
            this._reset();
            this.ui.render(this.dataset.getPoints());
            this.ui.updateDatasetDescription(type);
            this._updateUIForDataset(type);
            this._invalidateBoundaryCache();

            if (this.showBoundaries) {
                this._computeBoundaries();
            }
        }

        _updateUIForDataset(type) {
            // Show/hide edit toolbar for custom mode
            const editToolbar = document.querySelector('.edit-toolbar');
            if (editToolbar) {
                editToolbar.classList.toggle('active', type === 'custom');
            }

            // Show/hide 3rd class
            const legendClass2 = document.getElementById('legend-class-2');
            const classBtn2 = document.querySelector('[data-class="2"]');
            const show3 = type === 'blobs' || type === 'custom';

            if (legendClass2) legendClass2.style.display = show3 ? '' : 'none';
            if (classBtn2) classBtn2.style.display = show3 ? '' : 'none';

            // Reset selected class if hidden
            if (!show3 && this.selectedClass === 2) {
                this.selectedClass = 0;
                document.querySelectorAll('[data-class]').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-class="0"]')?.classList.add('active');
            }
        }

        _handleCanvasClick(e) {
            const coords = this.ui.getMouseDataCoords(e);

            // Hide click overlay on first interaction
            const clickOverlay = document.getElementById('click-overlay');
            if (clickOverlay) {
                clickOverlay.classList.add('hidden');
            }

            // Clamp to valid range
            if (coords.x < 0 || coords.x > 1 || coords.y < 0 || coords.y > 1) {
                return;
            }

            switch (this.editMode) {
                case 'classify':
                    this._classify(coords);
                    break;
                case 'add':
                    this.dataset.addPoint({ x: coords.x, y: coords.y, classLabel: this.selectedClass });
                    this.ui.render(this.dataset.getPoints(), this.currentQuery, this.currentResult?.neighbors || [], this.currentResult);
                    this._invalidateBoundaryCache();
                    if (this.showBoundaries) {
                        this._computeBoundaries();
                    }
                    break;
                case 'delete':
                    if (this.dataset.removeNearestPoint(coords)) {
                        this.ui.render(this.dataset.getPoints(), this.currentQuery, this.currentResult?.neighbors || [], this.currentResult);
                        this._invalidateBoundaryCache();
                        if (this.showBoundaries) {
                            this._computeBoundaries();
                        }
                    }
                    break;
            }
        }

        _handleCanvasHover(e) {
            // Could add hover effects here
        }

        _updateCursor() {
            if (!this.ui.canvas) return;

            switch (this.editMode) {
                case 'classify':
                    this.ui.canvas.style.cursor = 'crosshair';
                    break;
                case 'add':
                    this.ui.canvas.style.cursor = 'cell';
                    break;
                case 'delete':
                    this.ui.canvas.style.cursor = 'not-allowed';
                    break;
            }
        }

        _getOptions() {
            return {
                k: parseInt(document.getElementById('k-value')?.value || '3'),
                metric: document.getElementById('distance-metric')?.value || 'euclidean',
                weighted: document.getElementById('weighted-knn')?.checked || false
            };
        }

        _classify(query) {
            const points = this.dataset.getPoints();
            if (points.length === 0) {
                this.ui.updatePlaybackStatus('Add training points first');
                return;
            }

            const options = this._getOptions();
            if (points.length < options.k) {
                this.ui.updatePlaybackStatus(`Need at least ${options.k} points for K=${options.k}`);
                return;
            }

            this.currentQuery = query;
            this.currentResult = this.solver.classify(query, points, options);

            // Load steps into playback
            if (this.playback) {
                this.playback.load(this.currentResult.steps, { query });
                this._updatePlaybackButtons(true);

                // Auto-play
                this.playback.play();
            }

            // Enable comparison button
            document.getElementById('btn-run-comparison').disabled = false;
        }

        _onOptionsChange() {
            if (this.currentQuery) {
                // Re-classify with new options
                this._classify(this.currentQuery);
            }

            // Recompute boundaries if enabled
            if (this.showBoundaries) {
                this._invalidateBoundaryCache();
                this._computeBoundaries();
            }
        }

        _reset() {
            this.currentQuery = null;
            this.currentResult = null;

            if (this.playback) {
                this.playback.reset();
            }

            this.ui.render(this.dataset.getPoints(), null, [], null);
            this.ui.updateNeighborsList([]);
            this.ui.clearComparisonTable();
            this.ui.updatePlaybackStatus('Click anywhere to classify');
            this._updatePlaybackButtons(false);

            document.getElementById('btn-run-comparison').disabled = true;
        }

        _updatePlaybackButtons(hasSteps) {
            const isPlaying = this.playback?.isPlaying || false;

            document.getElementById('btn-play').disabled = !hasSteps;
            document.getElementById('btn-pause').disabled = !hasSteps || !isPlaying;
            document.getElementById('btn-step-forward').disabled = !hasSteps;
            document.getElementById('btn-step-back').disabled = !hasSteps;
        }

        // Playback callbacks
        _onRenderStep(step, index, metadata) {
            const points = this.dataset.getPoints();

            switch (step.type) {
                case STEP_TYPES.INIT:
                    this.ui.render(points, step.query, [], null);
                    this.ui.updateNeighborsList([]);
                    break;

                case STEP_TYPES.COMPUTE_DISTANCES:
                    // Just update status
                    break;

                case STEP_TYPES.ADD_NEIGHBOR:
                    // Partial result during animation
                    this.ui.render(points, metadata.query, step.neighbors, null);
                    this.ui.updateNeighborsList(step.neighbors);
                    break;

                case STEP_TYPES.VOTE:
                    // Vote breakdown now shown in legend
                    break;

                case STEP_TYPES.CLASSIFICATION_COMPLETE:
                    // Full result with vote breakdown for blended colors and popup
                    const result = {
                        prediction: step.prediction,
                        confidence: step.confidence,
                        voteBreakdown: step.voteBreakdown,
                        neighbors: step.neighbors
                    };
                    this.ui.render(points, step.query, step.neighbors, result);
                    break;
            }
        }

        _onPlayStateChange(isPlaying) {
            const playBtn = document.getElementById('btn-play');
            const pauseBtn = document.getElementById('btn-pause');

            if (playBtn) {
                const icon = playBtn.querySelector('i');
                if (icon) {
                    icon.className = isPlaying ? 'fa fa-pause' : 'fa fa-play';
                }
            }

            if (pauseBtn) {
                pauseBtn.disabled = !isPlaying;
            }
        }

        _onStepChange(index, total) {
            if (index < 0) {
                this.ui.updatePlaybackStatus('Click anywhere to classify');
            } else {
                const step = this.playback?.getCurrentStep();
                this.ui.updatePlaybackStatus(`Step ${index + 1}/${total}: ${step?.message || ''}`);
            }
        }

        _onPlaybackFinished() {
            this._onPlayStateChange(false);
        }

        _onPlaybackReset() {
            this.ui.render(this.dataset.getPoints(), null, [], null);
            this.ui.updateNeighborsList([]);
        }

        // Decision boundary computation
        _invalidateBoundaryCache() {
            this.boundaryCache = null;
        }

        async _computeBoundaries() {
            if (!this.showBoundaries) return;

            const points = this.dataset.getPoints();
            if (points.length === 0) {
                this.ui.clearBoundary();
                return;
            }

            const options = this._getOptions();
            const cacheKey = this.dataset.getHash() + JSON.stringify(options);

            if (this.boundaryCache?.key === cacheKey) {
                this.ui.drawDecisionBoundary(this.boundaryCache.grid, this.dataset.getNumClasses());
                return;
            }

            this.ui.showLoading(true);

            // Compute in chunks to keep UI responsive
            const resolution = 50;
            const grid = await this._computeBoundaryGrid(resolution, options);

            this.boundaryCache = { key: cacheKey, grid };
            this.ui.drawDecisionBoundary(grid, this.dataset.getNumClasses());
            this.ui.showLoading(false);
        }

        _computeBoundaryGrid(resolution, options) {
            return new Promise((resolve) => {
                const points = this.dataset.getPoints();
                const grid = [];
                let row = 0;

                const processChunk = () => {
                    const chunkSize = 5;
                    const endRow = Math.min(row + chunkSize, resolution);

                    for (; row < endRow; row++) {
                        const gridRow = [];
                        // Note: row 0 is top of canvas (y=1 in data space)
                        const y = 1 - (row / (resolution - 1));

                        for (let col = 0; col < resolution; col++) {
                            const x = col / (resolution - 1);
                            const result = this.solver.classifyFast({ x, y }, points, options);
                            gridRow.push(result.prediction);
                        }
                        grid.push(gridRow);
                    }

                    if (row < resolution) {
                        requestAnimationFrame(processChunk);
                    } else {
                        resolve(grid);
                    }
                };

                processChunk();
            });
        }

        // Comparison feature
        _runComparison() {
            if (!this.currentQuery) return;

            const points = this.dataset.getPoints();
            const configs = [];

            // Generate configs for different K values and metrics
            const kValues = [1, 3, 5, 7, 9];
            const metrics = ['euclidean', 'manhattan', 'chebyshev'];
            const weighted = document.getElementById('weighted-knn')?.checked || false;

            for (const k of kValues) {
                if (k <= points.length) {
                    for (const metric of metrics) {
                        configs.push({ k, metric, weighted });
                    }
                }
            }

            const results = this.solver.compare(this.currentQuery, points, configs);
            const currentConfig = this._getOptions();

            this.ui.updateComparisonTable(results, currentConfig);
        }
    }

    // ============================================
    // Initialize
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        new KNNApp();
    });
})();

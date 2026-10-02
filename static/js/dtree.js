/**
 * Decision Tree Classification Visualizer
 *
 * Interactive visualization of Decision Tree classification algorithm.
 * Features auto-build mode, manual design mode, step-through playback,
 * decision boundaries, and custom dataset drawing.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 400;
    const PADDING = 0;
    const PLOT_WIDTH = CANVAS_WIDTH;
    const PLOT_HEIGHT = CANVAS_HEIGHT;

    const POINT_RADIUS = 6;
    const QUERY_RADIUS = 8;
    const DEFAULT_NUM_POINTS = 100;

    // Tree visualization constants
    const TREE_SVG_WIDTH = 560;
    const TREE_SVG_HEIGHT = 200;
    const NODE_RADIUS = 20;
    const NODE_SPACING_H = 80;
    const NODE_SPACING_V = 60;

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

            switch (type) {
                case 'moons':
                    this._generateMoons(numPoints);
                    this.numClasses = 2;
                    break;
                case 'circles':
                    this._generateCircles(numPoints);
                    this.numClasses = 2;
                    break;
                case 'blobs':
                    this._generateBlobs(numPoints, 3);
                    this.numClasses = 3;
                    break;
                case 'linear':
                    this._generateLinear(numPoints);
                    this.numClasses = 2;
                    break;
                case 'xor':
                    this._generateXOR(numPoints);
                    this.numClasses = 2;
                    break;
                case 'spiral':
                    this._generateSpiral(numPoints);
                    this.numClasses = 2;
                    break;
                case 'custom':
                    this.numClasses = 3;
                    break;
            }

            return this.points;
        }

        _generateMoons(n, noise = 0.1) {
            const nPerClass = Math.floor(n / 2);
            for (let i = 0; i < nPerClass; i++) {
                const angle1 = Math.PI * i / nPerClass;
                const x1 = Math.cos(angle1) + this._noise(noise);
                const y1 = Math.sin(angle1) + this._noise(noise);
                this.points.push({
                    x: this._normalize(x1, -1.5, 2.5),
                    y: this._normalize(y1, -0.6, 1.6),
                    classLabel: 0
                });
                const x2 = 1 - Math.cos(angle1) + this._noise(noise);
                const y2 = 0.5 - Math.sin(angle1) + this._noise(noise);
                this.points.push({
                    x: this._normalize(x2, -1.5, 2.5),
                    y: this._normalize(y2, -0.6, 1.6),
                    classLabel: 1
                });
            }
        }

        _generateCircles(n, noise = 0.05) {
            const nPerClass = Math.floor(n / 2);
            const innerRadius = 0.25;
            const outerRadius = 0.5;
            for (let i = 0; i < nPerClass; i++) {
                const angle = 2 * Math.PI * Math.random();
                const r1 = innerRadius * (0.8 + 0.4 * Math.random()) + this._noise(noise);
                this.points.push({
                    x: 0.5 + r1 * Math.cos(angle),
                    y: 0.5 + r1 * Math.sin(angle),
                    classLabel: 0
                });
                const r2 = outerRadius * (0.8 + 0.4 * Math.random()) + this._noise(noise);
                this.points.push({
                    x: 0.5 + r2 * Math.cos(angle),
                    y: 0.5 + r2 * Math.sin(angle),
                    classLabel: 1
                });
            }
        }

        _generateBlobs(n, numBlobs = 3) {
            const centers = [
                { x: 0.25, y: 0.75 },
                { x: 0.75, y: 0.75 },
                { x: 0.5, y: 0.25 }
            ];
            const std = 0.08;
            const nPerBlob = Math.floor(n / numBlobs);
            for (let b = 0; b < numBlobs; b++) {
                for (let i = 0; i < nPerBlob; i++) {
                    const x = centers[b].x + this._gaussian() * std;
                    const y = centers[b].y + this._gaussian() * std;
                    this.points.push({
                        x: Math.max(0.02, Math.min(0.98, x)),
                        y: Math.max(0.02, Math.min(0.98, y)),
                        classLabel: b
                    });
                }
            }
        }

        _generateLinear(n, noise = 0.08) {
            const nPerClass = Math.floor(n / 2);
            for (let i = 0; i < nPerClass; i++) {
                const x0 = 0.1 + 0.8 * Math.random();
                const maxY0 = x0 + 0.05;
                const y0 = Math.random() * maxY0 * 0.8 + this._noise(noise);
                this.points.push({
                    x: x0,
                    y: Math.max(0.05, Math.min(0.95, y0)),
                    classLabel: 0
                });
                const x1 = 0.1 + 0.8 * Math.random();
                const minY1 = x1 + 0.15;
                const y1 = minY1 + (0.95 - minY1) * Math.random() + this._noise(noise);
                this.points.push({
                    x: x1,
                    y: Math.max(0.05, Math.min(0.95, y1)),
                    classLabel: 1
                });
            }
        }

        _generateXOR(n, noise = 0.05) {
            const nPerQuadrant = Math.floor(n / 4);
            const quadrants = [
                { cx: 0.25, cy: 0.75, label: 0 },
                { cx: 0.75, cy: 0.75, label: 1 },
                { cx: 0.25, cy: 0.25, label: 1 },
                { cx: 0.75, cy: 0.25, label: 0 }
            ];
            for (const q of quadrants) {
                for (let i = 0; i < nPerQuadrant; i++) {
                    this.points.push({
                        x: q.cx + (Math.random() - 0.5) * 0.35 + this._noise(noise),
                        y: q.cy + (Math.random() - 0.5) * 0.35 + this._noise(noise),
                        classLabel: q.label
                    });
                }
            }
        }

        _generateSpiral(n, noise = 0.03) {
            const nPerSpiral = Math.floor(n / 2);
            const turns = 1.5;
            for (let i = 0; i < nPerSpiral; i++) {
                const t = i / nPerSpiral;
                const angle = turns * 2 * Math.PI * t;
                const radius = 0.05 + 0.4 * t;
                this.points.push({
                    x: 0.5 + radius * Math.cos(angle) + this._noise(noise),
                    y: 0.5 + radius * Math.sin(angle) + this._noise(noise),
                    classLabel: 0
                });
                this.points.push({
                    x: 0.5 + radius * Math.cos(angle + Math.PI) + this._noise(noise),
                    y: 0.5 + radius * Math.sin(angle + Math.PI) + this._noise(noise),
                    classLabel: 1
                });
            }
        }

        _noise(scale) {
            return (Math.random() - 0.5) * 2 * scale;
        }

        _gaussian() {
            const u1 = Math.random();
            const u2 = Math.random();
            return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        }

        _normalize(val, min, max) {
            return (val - min) / (max - min);
        }

        getHash() {
            return `${this.currentType}_${this.points.length}_${this.points.slice(0, 5).map(p => p.x.toFixed(3)).join('')}`;
        }
    }

    // ============================================
    // DecisionTreeSolver Class
    // ============================================
    class DecisionTreeSolver {
        constructor() {
            this.root = null;
            this.nodeCounter = 0;
        }

        /**
         * Build a decision tree from training data
         * @param {Array} points - Array of {x, y, classLabel}
         * @param {Object} options - {maxDepth, minSamplesSplit, criterion}
         * @returns {Object} The root node of the tree
         */
        fit(points, options = {}) {
            const { maxDepth = 5, minSamplesSplit = 2, criterion = 'gini' } = options;
            this.nodeCounter = 0;
            this.criterion = criterion;
            this.root = this._buildTree(points, 0, maxDepth, minSamplesSplit, { minX: 0, maxX: 1, minY: 0, maxY: 1 });
            return this.root;
        }

        _buildTree(points, depth, maxDepth, minSamplesSplit, bounds) {
            const nodeId = this.nodeCounter++;
            const classCounts = this._getClassCounts(points);
            const majorityClass = this._getMajorityClass(classCounts);
            const impurity = this._calculateImpurity(classCounts, points.length);

            // Base cases: create leaf node
            if (depth >= maxDepth ||
                points.length < minSamplesSplit ||
                Object.keys(classCounts).length <= 1 ||
                impurity === 0) {
                return {
                    id: nodeId,
                    isLeaf: true,
                    prediction: majorityClass,
                    samples: points.length,
                    classCounts,
                    impurity,
                    depth,
                    bounds
                };
            }

            // Find best split
            const bestSplit = this._findBestSplit(points, bounds);

            if (!bestSplit || bestSplit.gain <= 0) {
                return {
                    id: nodeId,
                    isLeaf: true,
                    prediction: majorityClass,
                    samples: points.length,
                    classCounts,
                    impurity,
                    depth,
                    bounds
                };
            }

            // Split data
            const { leftPoints, rightPoints, leftBounds, rightBounds } =
                this._splitData(points, bestSplit.feature, bestSplit.threshold, bounds);

            // Recursively build children
            const leftChild = this._buildTree(leftPoints, depth + 1, maxDepth, minSamplesSplit, leftBounds);
            const rightChild = this._buildTree(rightPoints, depth + 1, maxDepth, minSamplesSplit, rightBounds);

            return {
                id: nodeId,
                isLeaf: false,
                feature: bestSplit.feature,
                threshold: bestSplit.threshold,
                gain: bestSplit.gain,
                samples: points.length,
                classCounts,
                impurity,
                depth,
                bounds,
                left: leftChild,
                right: rightChild
            };
        }

        _getClassCounts(points) {
            const counts = {};
            for (const p of points) {
                counts[p.classLabel] = (counts[p.classLabel] || 0) + 1;
            }
            return counts;
        }

        _getMajorityClass(classCounts) {
            let maxCount = 0;
            let majorityClass = 0;
            for (const [cls, count] of Object.entries(classCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    majorityClass = parseInt(cls);
                }
            }
            return majorityClass;
        }

        _calculateImpurity(classCounts, total) {
            if (total === 0) return 0;

            if (this.criterion === 'entropy') {
                // Information entropy: H = -sum(p * log2(p))
                let entropy = 0;
                for (const count of Object.values(classCounts)) {
                    if (count > 0) {
                        const p = count / total;
                        entropy -= p * Math.log2(p);
                    }
                }
                return entropy;
            } else {
                // Gini impurity: G = 1 - sum(p^2)
                let gini = 1;
                for (const count of Object.values(classCounts)) {
                    const p = count / total;
                    gini -= p * p;
                }
                return gini;
            }
        }

        _findBestSplit(points, bounds) {
            let bestSplit = null;
            let bestGain = -Infinity;

            const parentImpurity = this._calculateImpurity(
                this._getClassCounts(points),
                points.length
            );

            // Try both features (x and y)
            for (const feature of ['x', 'y']) {
                // Get unique values and create candidate thresholds
                const values = points.map(p => p[feature]).sort((a, b) => a - b);
                const thresholds = [];

                for (let i = 0; i < values.length - 1; i++) {
                    if (values[i] !== values[i + 1]) {
                        thresholds.push((values[i] + values[i + 1]) / 2);
                    }
                }

                for (const threshold of thresholds) {
                    const leftPoints = points.filter(p => p[feature] <= threshold);
                    const rightPoints = points.filter(p => p[feature] > threshold);

                    if (leftPoints.length === 0 || rightPoints.length === 0) continue;

                    const leftImpurity = this._calculateImpurity(
                        this._getClassCounts(leftPoints),
                        leftPoints.length
                    );
                    const rightImpurity = this._calculateImpurity(
                        this._getClassCounts(rightPoints),
                        rightPoints.length
                    );

                    // Weighted average impurity after split
                    const weightedImpurity =
                        (leftPoints.length / points.length) * leftImpurity +
                        (rightPoints.length / points.length) * rightImpurity;

                    const gain = parentImpurity - weightedImpurity;

                    if (gain > bestGain) {
                        bestGain = gain;
                        bestSplit = { feature, threshold, gain };
                    }
                }
            }

            return bestSplit;
        }

        _splitData(points, feature, threshold, bounds) {
            const leftPoints = points.filter(p => p[feature] <= threshold);
            const rightPoints = points.filter(p => p[feature] > threshold);

            let leftBounds, rightBounds;
            if (feature === 'x') {
                leftBounds = { ...bounds, maxX: threshold };
                rightBounds = { ...bounds, minX: threshold };
            } else {
                leftBounds = { ...bounds, maxY: threshold };
                rightBounds = { ...bounds, minY: threshold };
            }

            return { leftPoints, rightPoints, leftBounds, rightBounds };
        }

        /**
         * Classify a query point
         * @param {Object} query - {x, y}
         * @returns {Object} {prediction, path, leafNode}
         */
        predict(query) {
            if (!this.root) return { prediction: 0, path: [], leafNode: null };

            const path = [];
            let node = this.root;

            while (!node.isLeaf) {
                path.push({
                    nodeId: node.id,
                    feature: node.feature,
                    threshold: node.threshold,
                    value: query[node.feature],
                    direction: query[node.feature] <= node.threshold ? 'left' : 'right'
                });

                if (query[node.feature] <= node.threshold) {
                    node = node.left;
                } else {
                    node = node.right;
                }
            }

            path.push({
                nodeId: node.id,
                isLeaf: true,
                prediction: node.prediction,
                classCounts: node.classCounts
            });

            return {
                prediction: node.prediction,
                path,
                leafNode: node
            };
        }

        /**
         * Fast prediction without path tracking (for boundaries)
         */
        predictFast(query) {
            if (!this.root) return 0;

            let node = this.root;
            while (!node.isLeaf) {
                if (query[node.feature] <= node.threshold) {
                    node = node.left;
                } else {
                    node = node.right;
                }
            }
            return node.prediction;
        }

        /**
         * Get tree statistics
         */
        getStats() {
            if (!this.root) return { depth: 0, leaves: 0, nodes: 0 };

            let depth = 0;
            let leaves = 0;
            let nodes = 0;

            const traverse = (node, d) => {
                nodes++;
                depth = Math.max(depth, d);
                if (node.isLeaf) {
                    leaves++;
                } else {
                    traverse(node.left, d + 1);
                    traverse(node.right, d + 1);
                }
            };

            traverse(this.root, 0);
            return { depth, leaves, nodes };
        }

        /**
         * Get all split lines for visualization
         */
        getSplitLines() {
            const lines = [];

            const traverse = (node) => {
                if (!node || node.isLeaf) return;

                lines.push({
                    feature: node.feature,
                    threshold: node.threshold,
                    bounds: node.bounds,
                    depth: node.depth,
                    nodeId: node.id  // Include node ID for color matching
                });

                traverse(node.left);
                traverse(node.right);
            };

            traverse(this.root);
            return lines;
        }

        /**
         * Get tree structure for visualization
         */
        getTreeStructure() {
            return this.root;
        }

        /**
         * Find a node by ID
         */
        _findNode(node, id) {
            if (!node) return null;
            if (node.id === id) return node;
            if (node.isLeaf) return null;
            return this._findNode(node.left, id) || this._findNode(node.right, id);
        }

        /**
         * Check if a point is in bounds
         */
        _isInBounds(point, bounds) {
            return point.x >= bounds.minX && point.x <= bounds.maxX &&
                   point.y >= bounds.minY && point.y <= bounds.maxY;
        }

        /**
         * Update a split node's threshold (for dragging)
         */
        updateThreshold(nodeId, newThreshold, points) {
            const node = this._findNode(this.root, nodeId);
            if (!node || node.isLeaf) return false;

            // Clamp threshold to node's bounds
            const feature = node.feature;
            if (feature === 'x') {
                newThreshold = Math.max(node.bounds.minX + 0.01, Math.min(node.bounds.maxX - 0.01, newThreshold));
            } else {
                newThreshold = Math.max(node.bounds.minY + 0.01, Math.min(node.bounds.maxY - 0.01, newThreshold));
            }

            node.threshold = newThreshold;

            // Update bounds for children
            if (feature === 'x') {
                node.left.bounds = { ...node.left.bounds, maxX: newThreshold };
                node.right.bounds = { ...node.right.bounds, minX: newThreshold };
            } else {
                node.left.bounds = { ...node.left.bounds, maxY: newThreshold };
                node.right.bounds = { ...node.right.bounds, minY: newThreshold };
            }

            // Recursively update children
            this._rebuildSubtree(node.left, points);
            this._rebuildSubtree(node.right, points);

            return true;
        }

        /**
         * Rebuild a subtree after threshold change
         */
        _rebuildSubtree(node, allPoints) {
            if (!node) return;

            // Get points in this node's bounds
            const nodePoints = allPoints.filter(p => this._isInBounds(p, node.bounds));
            const classCounts = {};
            for (const p of nodePoints) {
                classCounts[p.classLabel] = (classCounts[p.classLabel] || 0) + 1;
            }

            node.samples = nodePoints.length;
            node.classCounts = classCounts;

            if (node.isLeaf) {
                // Update prediction based on majority class
                let maxCount = 0;
                let majorityClass = 0;
                for (const [cls, count] of Object.entries(classCounts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        majorityClass = parseInt(cls);
                    }
                }
                node.prediction = majorityClass;
            } else {
                // Update child bounds based on current threshold
                if (node.feature === 'x') {
                    node.left.bounds = { ...node.bounds, maxX: node.threshold };
                    node.right.bounds = { ...node.bounds, minX: node.threshold };
                } else {
                    node.left.bounds = { ...node.bounds, maxY: node.threshold };
                    node.right.bounds = { ...node.bounds, minY: node.threshold };
                }

                // Recursively rebuild children
                this._rebuildSubtree(node.left, allPoints);
                this._rebuildSubtree(node.right, allPoints);
            }
        }
    }

    // ============================================
    // ManualTreeBuilder Class (for Design Mode)
    // ============================================
    class ManualTreeBuilder {
        constructor() {
            this.root = null;
            this.nodeCounter = 0;
        }

        /**
         * Initialize with a single leaf node
         */
        initialize(points) {
            const classCounts = this._getClassCounts(points);
            const majorityClass = this._getMajorityClass(classCounts);

            this.nodeCounter = 0;
            this.root = {
                id: this.nodeCounter++,
                isLeaf: true,
                prediction: majorityClass,
                samples: points.length,
                classCounts,
                depth: 0,
                bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }
            };

            return this.root;
        }

        /**
         * Split a leaf node
         */
        splitNode(nodeId, feature, threshold, points) {
            const node = this._findNode(this.root, nodeId);
            if (!node || !node.isLeaf) return false;

            // Filter points in this node's region
            const nodePoints = points.filter(p => this._isInBounds(p, node.bounds));

            // Split points
            const leftPoints = nodePoints.filter(p => p[feature] <= threshold);
            const rightPoints = nodePoints.filter(p => p[feature] > threshold);

            // Create bounds for children
            let leftBounds, rightBounds;
            if (feature === 'x') {
                leftBounds = { ...node.bounds, maxX: threshold };
                rightBounds = { ...node.bounds, minX: threshold };
            } else {
                leftBounds = { ...node.bounds, maxY: threshold };
                rightBounds = { ...node.bounds, minY: threshold };
            }

            // Create child nodes
            const leftClassCounts = this._getClassCounts(leftPoints);
            const rightClassCounts = this._getClassCounts(rightPoints);

            node.isLeaf = false;
            node.feature = feature;
            node.threshold = threshold;
            node.left = {
                id: this.nodeCounter++,
                isLeaf: true,
                prediction: this._getMajorityClass(leftClassCounts),
                samples: leftPoints.length,
                classCounts: leftClassCounts,
                depth: node.depth + 1,
                bounds: leftBounds
            };
            node.right = {
                id: this.nodeCounter++,
                isLeaf: true,
                prediction: this._getMajorityClass(rightClassCounts),
                samples: rightPoints.length,
                classCounts: rightClassCounts,
                depth: node.depth + 1,
                bounds: rightBounds
            };

            return true;
        }

        /**
         * Change the class of a leaf node
         */
        setNodeClass(nodeId, classLabel) {
            const node = this._findNode(this.root, nodeId);
            if (node && node.isLeaf) {
                node.prediction = classLabel;
                return true;
            }
            return false;
        }

        /**
         * Update a split node's threshold (for dragging)
         */
        updateThreshold(nodeId, newThreshold, points) {
            const node = this._findNode(this.root, nodeId);
            if (!node || node.isLeaf) return false;

            // Clamp threshold to node's bounds
            const feature = node.feature;
            if (feature === 'x') {
                newThreshold = Math.max(node.bounds.minX + 0.01, Math.min(node.bounds.maxX - 0.01, newThreshold));
            } else {
                newThreshold = Math.max(node.bounds.minY + 0.01, Math.min(node.bounds.maxY - 0.01, newThreshold));
            }

            node.threshold = newThreshold;

            // Update bounds for children
            if (feature === 'x') {
                node.left.bounds = { ...node.left.bounds, maxX: newThreshold };
                node.right.bounds = { ...node.right.bounds, minX: newThreshold };
            } else {
                node.left.bounds = { ...node.left.bounds, maxY: newThreshold };
                node.right.bounds = { ...node.right.bounds, minY: newThreshold };
            }

            // Recursively update children bounds and rebuild their subtrees
            this._rebuildSubtree(node.left, points);
            this._rebuildSubtree(node.right, points);

            return true;
        }

        /**
         * Rebuild a subtree after threshold change
         */
        _rebuildSubtree(node, allPoints) {
            if (!node) return;

            // Get points in this node's bounds
            const nodePoints = allPoints.filter(p => this._isInBounds(p, node.bounds));
            const classCounts = this._getClassCounts(nodePoints);

            node.samples = nodePoints.length;
            node.classCounts = classCounts;

            if (node.isLeaf) {
                node.prediction = this._getMajorityClass(classCounts);
            } else {
                // Update child bounds based on current threshold
                if (node.feature === 'x') {
                    node.left.bounds = { ...node.bounds, maxX: node.threshold };
                    node.right.bounds = { ...node.bounds, minX: node.threshold };
                } else {
                    node.left.bounds = { ...node.bounds, maxY: node.threshold };
                    node.right.bounds = { ...node.bounds, minY: node.threshold };
                }

                // Recursively rebuild children
                this._rebuildSubtree(node.left, allPoints);
                this._rebuildSubtree(node.right, allPoints);
            }
        }

        _findNode(node, id) {
            if (!node) return null;
            if (node.id === id) return node;
            if (node.isLeaf) return null;
            return this._findNode(node.left, id) || this._findNode(node.right, id);
        }

        _isInBounds(point, bounds) {
            return point.x >= bounds.minX && point.x <= bounds.maxX &&
                   point.y >= bounds.minY && point.y <= bounds.maxY;
        }

        _getClassCounts(points) {
            const counts = {};
            for (const p of points) {
                counts[p.classLabel] = (counts[p.classLabel] || 0) + 1;
            }
            return counts;
        }

        _getMajorityClass(classCounts) {
            let maxCount = 0;
            let majorityClass = 0;
            for (const [cls, count] of Object.entries(classCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    majorityClass = parseInt(cls);
                }
            }
            return majorityClass;
        }

        predict(query) {
            if (!this.root) return { prediction: 0, path: [], leafNode: null };

            const path = [];
            let node = this.root;

            while (!node.isLeaf) {
                path.push({
                    nodeId: node.id,
                    feature: node.feature,
                    threshold: node.threshold,
                    value: query[node.feature],
                    direction: query[node.feature] <= node.threshold ? 'left' : 'right'
                });

                if (query[node.feature] <= node.threshold) {
                    node = node.left;
                } else {
                    node = node.right;
                }
            }

            path.push({
                nodeId: node.id,
                isLeaf: true,
                prediction: node.prediction,
                classCounts: node.classCounts
            });

            return {
                prediction: node.prediction,
                path,
                leafNode: node
            };
        }

        predictFast(query) {
            if (!this.root) return 0;
            let node = this.root;
            while (!node.isLeaf) {
                if (query[node.feature] <= node.threshold) {
                    node = node.left;
                } else {
                    node = node.right;
                }
            }
            return node.prediction;
        }

        getStats() {
            if (!this.root) return { depth: 0, leaves: 0, nodes: 0 };

            let depth = 0;
            let leaves = 0;
            let nodes = 0;

            const traverse = (node, d) => {
                nodes++;
                depth = Math.max(depth, d);
                if (node.isLeaf) {
                    leaves++;
                } else {
                    traverse(node.left, d + 1);
                    traverse(node.right, d + 1);
                }
            };

            traverse(this.root, 0);
            return { depth, leaves, nodes };
        }

        getSplitLines() {
            const lines = [];

            const traverse = (node) => {
                if (!node || node.isLeaf) return;

                lines.push({
                    feature: node.feature,
                    threshold: node.threshold,
                    bounds: node.bounds,
                    depth: node.depth,
                    nodeId: node.id  // Include node ID for color matching
                });

                traverse(node.left);
                traverse(node.right);
            };

            traverse(this.root);
            return lines;
        }

        getTreeStructure() {
            return this.root;
        }

        clear() {
            this.root = null;
            this.nodeCounter = 0;
        }
    }

    // ============================================
    // UIRenderer Class
    // ============================================
    class UIRenderer {
        constructor() {
            this.canvas = document.getElementById('dtree-canvas');
            this.boundaryCanvas = document.getElementById('boundary-canvas');
            this.treeSvg = document.getElementById('tree-svg');
            this.treeWrapper = document.getElementById('tree-wrapper');
            this.ctx = this.canvas?.getContext('2d');
            this.boundaryCtx = this.boundaryCanvas?.getContext('2d');

            this.queryPoint = null;
            this.highlightedPath = [];
            this.selectedNodeId = null;

            // Pan/zoom state for tree
            this.treeViewBox = { x: 0, y: 0, width: 400, height: 300 };
            this.treeBounds = { width: 400, height: 300 };
            this.treeZoom = 1;
            this.treePan = { x: 0, y: 0 };
            this.isDragging = false;
            this.dragStart = { x: 0, y: 0 };

            this._updateColors();
            this._setupHiDPI();
            this._setupTreePanZoom();
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
            const fullScale = scale * dpr;
            this.ctx.setTransform(fullScale, 0, 0, fullScale, 0, 0);

            this.boundaryCanvas.width = displayWidth * dpr;
            this.boundaryCanvas.height = displayHeight * dpr;
            this.boundaryCanvas.style.width = displayWidth + 'px';
            this.boundaryCanvas.style.height = displayHeight + 'px';
            this.boundaryCtx.setTransform(fullScale, 0, 0, fullScale, 0, 0);

            // Store the scale factors for coordinate conversion and rendering
            this.displayScale = scale;
            this.fullScale = fullScale;
        }

        _setupTreePanZoom() {
            if (!this.treeWrapper || !this.treeSvg) return;

            // Mouse drag for panning
            this.treeWrapper.addEventListener('mousedown', (e) => {
                if (e.target.closest('.tree-node')) return; // Don't pan when clicking nodes
                this.isDragging = true;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.treeWrapper.style.cursor = 'grabbing';
            });

            document.addEventListener('mousemove', (e) => {
                if (!this.isDragging) return;
                const dx = e.clientX - this.dragStart.x;
                const dy = e.clientY - this.dragStart.y;
                this.treePan.x += dx / this.treeZoom;
                this.treePan.y += dy / this.treeZoom;
                this.dragStart = { x: e.clientX, y: e.clientY };
                this._updateTreeViewBox();
            });

            document.addEventListener('mouseup', () => {
                this.isDragging = false;
                if (this.treeWrapper) this.treeWrapper.style.cursor = 'grab';
            });

            // Mouse wheel for zooming
            this.treeWrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                this.treeZoom = Math.max(0.3, Math.min(3, this.treeZoom * zoomFactor));
                this._updateTreeViewBox();
            }, { passive: false });

            // Zoom control buttons
            document.getElementById('tree-zoom-in')?.addEventListener('click', () => {
                this.treeZoom = Math.min(3, this.treeZoom * 1.25);
                this._updateTreeViewBox();
            });

            document.getElementById('tree-zoom-out')?.addEventListener('click', () => {
                this.treeZoom = Math.max(0.3, this.treeZoom * 0.8);
                this._updateTreeViewBox();
            });

            document.getElementById('tree-zoom-fit')?.addEventListener('click', () => {
                this._fitTreeToView();
            });
        }

        _updateTreeViewBox() {
            if (!this.treeSvg) return;
            const wrapperWidth = this.treeWrapper?.clientWidth || 400;
            const wrapperHeight = this.treeWrapper?.clientHeight || 300;

            const viewWidth = wrapperWidth / this.treeZoom;
            const viewHeight = wrapperHeight / this.treeZoom;

            const centerX = this.treeBounds.width / 2 - this.treePan.x;
            const centerY = this.treeBounds.height / 2 - this.treePan.y;

            const viewX = centerX - viewWidth / 2;
            const viewY = centerY - viewHeight / 2;

            this.treeSvg.setAttribute('viewBox', `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
        }

        _fitTreeToView() {
            if (!this.treeSvg || !this.treeWrapper) return;
            const wrapperWidth = this.treeWrapper.clientWidth;
            const wrapperHeight = this.treeWrapper.clientHeight;

            const padding = 20;
            const scaleX = wrapperWidth / (this.treeBounds.width + padding * 2);
            const scaleY = wrapperHeight / (this.treeBounds.height + padding * 2);

            this.treeZoom = Math.min(scaleX, scaleY, 1.5);
            this.treePan = { x: 0, y: 0 };
            this._updateTreeViewBox();
        }

        _updateColors() {
            if (window.VizLib?.ThemeManager) {
                const colors = window.VizLib.ThemeManager.getColors('categorical');
                this.classColors = colors.slice(0, 3);
            } else {
                this.classColors = [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];
            }

            const style = getComputedStyle(document.documentElement);
            this.queryColor = style.getPropertyValue('--dtree-query-bg').trim() || '#ffd700';
            this.queryBorder = style.getPropertyValue('--dtree-query-border').trim() || '#b8860b';
            this.splitLineColor = style.getPropertyValue('--dtree-split-line').trim() || '#333';
        }

        dataToCanvas(x, y) {
            return {
                x: PADDING + x * PLOT_WIDTH,
                y: PADDING + (1 - y) * PLOT_HEIGHT
            };
        }

        canvasToData(canvasX, canvasY) {
            return {
                x: (canvasX - PADDING) / PLOT_WIDTH,
                y: 1 - (canvasY - PADDING) / PLOT_HEIGHT
            };
        }

        getMouseDataCoords(event) {
            const rect = this.canvas.getBoundingClientRect();
            // Convert from display coordinates to logical canvas coordinates
            const scale = this.displayScale || 1;
            const canvasX = (event.clientX - rect.left) / scale;
            const canvasY = (event.clientY - rect.top) / scale;
            return this.canvasToData(canvasX, canvasY);
        }

        render(points, queryPoint = null, result = null, splitLines = [], solver = null) {
            if (!this.ctx) return;

            this._updateColors();
            this.queryPoint = queryPoint;

            this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            this._drawGrid();
            this._drawSplitLines(splitLines);
            this._drawPoints(points, solver);

            if (queryPoint) {
                this._drawQueryPoint(queryPoint, result);
            }
        }

        setQueryPoint(query) {
            this.queryPoint = query;
        }

        _drawGrid() {
            // Grid removed for cleaner look - canvas fills its container
        }

        _drawSplitLines(splitLines) {
            const ctx = this.ctx;

            // Store node-to-color mapping for tree visualization
            this.splitColors = {};

            for (const line of splitLines) {
                const { feature, threshold, bounds, depth, nodeId } = line;

                // Generate a distinct color for each split based on nodeId
                const color = this._getSplitColor(nodeId);
                this.splitColors[nodeId] = color;

                // Adjust line width based on depth
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(1.5, 3 - depth * 0.4);
                ctx.setLineDash([5, 3]);

                ctx.beginPath();
                if (feature === 'x') {
                    const x = PADDING + threshold * PLOT_WIDTH;
                    const yStart = PADDING + (1 - bounds.maxY) * PLOT_HEIGHT;
                    const yEnd = PADDING + (1 - bounds.minY) * PLOT_HEIGHT;
                    ctx.moveTo(x, yStart);
                    ctx.lineTo(x, yEnd);
                } else {
                    const y = PADDING + (1 - threshold) * PLOT_HEIGHT;
                    const xStart = PADDING + bounds.minX * PLOT_WIDTH;
                    const xEnd = PADDING + bounds.maxX * PLOT_WIDTH;
                    ctx.moveTo(xStart, y);
                    ctx.lineTo(xEnd, y);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        _getSplitColor(nodeId) {
            // Colorful palette for splits - easily distinguishable colors
            const splitPalette = [
                EAIColor('class-3'), // violet
                EAIColor('class-4'), // amber
                EAIColor('class-9'), // emerald
                EAIColor('class-1'), // blue
                EAIColor('class-0'), // red
                EAIColor('class-7'), // pink
                EAIColor('class-2'), // cyan
                EAIColor('class-5'), // lime
                EAIColor('class-6'), // orange
                EAIColor('class-8'), // indigo
            ];
            return splitPalette[nodeId % splitPalette.length];
        }

        _drawPoints(points, solver = null) {
            const ctx = this.ctx;

            points.forEach(point => {
                const pos = this.dataToCanvas(point.x, point.y);
                const color = this.classColors[point.classLabel] || this.classColors[0];

                // Check if point is misclassified
                let isMisclassified = false;
                if (solver && solver.predictFast) {
                    const prediction = solver.predictFast({ x: point.x, y: point.y });
                    isMisclassified = prediction !== point.classLabel;
                }

                ctx.beginPath();
                ctx.arc(pos.x, pos.y, POINT_RADIUS, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = EAIColor('surface');
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Draw X marker for misclassified points
                if (isMisclassified) {
                    // Draw a larger contrasting outline
                    ctx.strokeStyle = EAIColor('surface');
                    ctx.lineWidth = 4;
                    const size = POINT_RADIUS + 2;
                    ctx.beginPath();
                    ctx.moveTo(pos.x - size, pos.y - size);
                    ctx.lineTo(pos.x + size, pos.y + size);
                    ctx.moveTo(pos.x + size, pos.y - size);
                    ctx.lineTo(pos.x - size, pos.y + size);
                    ctx.stroke();

                    // Draw the X
                    ctx.strokeStyle = EAIColor('ink');
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(pos.x - size, pos.y - size);
                    ctx.lineTo(pos.x + size, pos.y + size);
                    ctx.moveTo(pos.x + size, pos.y - size);
                    ctx.lineTo(pos.x - size, pos.y + size);
                    ctx.stroke();
                }
            });
        }

        _drawQueryPoint(query, result = null) {
            const ctx = this.ctx;
            const pos = this.dataToCanvas(query.x, query.y);

            let fillColor = this.queryColor;
            if (result && result.prediction !== undefined) {
                fillColor = this.classColors[result.prediction] || this.queryColor;
            }

            // Outer glow
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, QUERY_RADIUS + 4, 0, 2 * Math.PI);
            ctx.fillStyle = this._hexToRgba(fillColor, 0.3);
            ctx.fill();

            // Main point
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, QUERY_RADIUS, 0, 2 * Math.PI);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = EAIColor('surface');
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw prediction popup
            if (result && result.prediction !== undefined) {
                this._drawPredictionPopup(query, result);
            }
        }

        _drawPredictionPopup(query, result) {
            const ctx = this.ctx;
            const pos = this.dataToCanvas(query.x, query.y);

            const popupX = pos.x + 20;
            const popupY = pos.y - 30;

            const text = `Class ${result.prediction + 1}`;
            ctx.font = 'bold 12px sans-serif';
            const textWidth = ctx.measureText(text).width;
            const padding = 8;
            const popupWidth = textWidth + padding * 2;
            const popupHeight = 24;

            let finalX = popupX;
            let finalY = popupY;
            if (finalX + popupWidth > CANVAS_WIDTH - PADDING) {
                finalX = pos.x - popupWidth - 20;
            }
            if (finalY < PADDING) {
                finalY = pos.y + 30;
            }

            ctx.fillStyle = this.classColors[result.prediction];
            ctx.beginPath();
            ctx.roundRect(finalX, finalY, popupWidth, popupHeight, 4);
            ctx.fill();

            ctx.fillStyle = EAIColor('surface');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, finalX + popupWidth / 2, finalY + popupHeight / 2);
        }

        _hexToRgba(color, alpha) {
            if (color.startsWith('rgb')) {
                const match = color.match(/(\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
                }
            }
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
            if (result) {
                return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
            }
            return `rgba(255, 215, 0, ${alpha})`;
        }

        // Decision boundary rendering using ImageData for pixel-perfect rendering
        // If selectedNode is provided, only show the boundary for that node's split (not descendants)
        drawDecisionBoundary(solver, numClasses, selectedNode = null) {
            if (!this.boundaryCtx || !solver) return;

            const ctx = this.boundaryCtx;
            const scale = this.fullScale || this.dpr || 1;

            // Reset transform for pixel manipulation
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.boundaryCanvas.width, this.boundaryCanvas.height);

            // Create ImageData for the plot area
            const plotStartX = Math.round(PADDING * scale);
            const plotStartY = Math.round(PADDING * scale);
            const plotW = Math.round(PLOT_WIDTH * scale);
            const plotH = Math.round(PLOT_HEIGHT * scale);

            const imageData = ctx.createImageData(plotW, plotH);
            const data = imageData.data;

            // Parse class colors to RGB
            const classRGB = this.classColors.map(color => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
                if (result) {
                    return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
                }
                return [128, 128, 128];
            });

            // Fill each pixel
            for (let py = 0; py < plotH; py++) {
                for (let px = 0; px < plotW; px++) {
                    const x = px / (plotW - 1);
                    const y = 1 - py / (plotH - 1);

                    let prediction;
                    if (selectedNode) {
                        // Simplified prediction: traverse tree but stop at selected node
                        const root = solver.getTreeStructure();
                        prediction = this._predictWithStopNode(root, { x, y }, selectedNode.id);
                    } else {
                        prediction = solver.predictFast({ x, y });
                    }
                    const rgb = classRGB[prediction] || classRGB[0];

                    const idx = (py * plotW + px) * 4;
                    data[idx] = rgb[0];     // R
                    data[idx + 1] = rgb[1]; // G
                    data[idx + 2] = rgb[2]; // B
                    data[idx + 3] = 64;     // A (0.25 * 255)
                }
            }

            ctx.putImageData(imageData, plotStartX, plotStartY);
        }

        // Predict class traversing from root, but treating selectedNode's children as leaves
        // This shows the boundary as if no splits exist below the selected node
        _predictWithStopNode(root, point, stopNodeId) {
            const traverse = (node) => {
                if (!node) return 0;

                // If this is a leaf, return its prediction
                if (node.isLeaf) {
                    return node.prediction ?? 0;
                }

                // If this is the stop node, go one more level but treat children as leaves
                if (node.id === stopNodeId) {
                    const goLeft = node.feature === 'x'
                        ? point.x < node.threshold
                        : point.y < node.threshold;
                    const child = goLeft ? node.left : node.right;
                    // Return the child's prediction directly (treat as leaf)
                    return child?.prediction ?? 0;
                }

                // Normal traversal - continue down the tree
                const goLeft = node.feature === 'x'
                    ? point.x < node.threshold
                    : point.y < node.threshold;

                return traverse(goLeft ? node.left : node.right);
            };

            return traverse(root);
        }

        clearBoundary() {
            if (!this.boundaryCtx) return;
            const scale = this.fullScale || this.dpr || 1;
            this.boundaryCtx.setTransform(scale, 0, 0, scale, 0, 0);
            this.boundaryCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }

        // Tree visualization using SVG
        renderTree(treeRoot, highlightPath = [], selectedNodeId = null, onNodeClick = null) {
            if (!this.treeSvg || !treeRoot) {
                this._clearTree();
                return;
            }

            this._updateColors();
            const TreeLayoutEngine = window.VizLib?.TreeLayoutEngine;
            if (!TreeLayoutEngine) {
                console.warn('TreeLayoutEngine not available');
                return;
            }

            const layout = new TreeLayoutEngine({
                horizontalSpacing: NODE_SPACING_H,
                verticalSpacing: NODE_SPACING_V,
                minNodeWidth: NODE_RADIUS * 2 + 10
            });

            const getChildren = (node) => {
                if (node.isLeaf) return [];
                return [node.left, node.right].filter(Boolean);
            };

            const positions = layout.computeLayout(treeRoot, getChildren, n => String(n.id));
            layout.centerLayout(positions);

            const bounds = layout.getBounds(positions);
            const padding = 40;
            const svgWidth = Math.max(TREE_SVG_WIDTH, bounds.width + padding * 2);
            const svgHeight = Math.max(TREE_SVG_HEIGHT, bounds.height + padding * 2);

            // Store bounds for pan/zoom
            this.treeBounds = { width: svgWidth, height: svgHeight };

            this.treeSvg.setAttribute('width', '100%');
            this.treeSvg.setAttribute('height', '100%');
            this.treeSvg.innerHTML = '';

            // Auto-fit tree to view on render
            this._fitTreeToView();

            const offsetX = svgWidth / 2;
            const offsetY = padding + NODE_RADIUS;

            const highlightNodeIds = new Set(highlightPath.map(p => p.nodeId));

            // Draw edges first
            const drawEdges = (node) => {
                if (node.isLeaf) return;
                const parentPos = positions.get(String(node.id));

                for (const child of [node.left, node.right]) {
                    if (!child) continue;
                    const childPos = positions.get(String(child.id));

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', parentPos.x + offsetX);
                    line.setAttribute('y1', -parentPos.y + offsetY);
                    line.setAttribute('x2', childPos.x + offsetX);
                    line.setAttribute('y2', -childPos.y + offsetY);

                    const isHighlighted = highlightNodeIds.has(node.id) && highlightNodeIds.has(child.id);
                    line.setAttribute('stroke', isHighlighted ? EAIColor('gold') : EAIColor('axis'));
                    line.setAttribute('stroke-width', isHighlighted ? '3' : '2');

                    this.treeSvg.appendChild(line);

                    // Add edge label
                    const midX = (parentPos.x + childPos.x) / 2 + offsetX;
                    const midY = (-parentPos.y - childPos.y) / 2 + offsetY;
                    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    label.setAttribute('x', midX + (child === node.left ? -10 : 10));
                    label.setAttribute('y', midY);
                    label.setAttribute('text-anchor', 'middle');
                    label.setAttribute('font-size', '10');
                    label.setAttribute('fill', EAIColor('muted'));
                    label.textContent = child === node.left ? '≤' : '>';
                    this.treeSvg.appendChild(label);

                    drawEdges(child);
                }
            };

            drawEdges(treeRoot);

            // Draw nodes
            const drawNode = (node) => {
                const pos = positions.get(String(node.id));
                const cx = pos.x + offsetX;
                const cy = -pos.y + offsetY;

                const isHighlighted = highlightNodeIds.has(node.id);
                const isSelected = node.id === selectedNodeId;

                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                group.setAttribute('class', 'tree-node');
                group.setAttribute('data-node-id', node.id);
                group.style.cursor = 'pointer';

                // Get split color for internal nodes (matches canvas split line)
                const splitColor = !node.isLeaf && this.splitColors ? this.splitColors[node.id] : null;

                // Node circle
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', cx);
                circle.setAttribute('cy', cy);
                circle.setAttribute('r', NODE_RADIUS);

                if (node.isLeaf) {
                    circle.setAttribute('fill', this.classColors[node.prediction] || '#999');
                } else {
                    // Use split color for internal nodes
                    circle.setAttribute('fill', splitColor || '#fff');
                }

                // Stroke color: yellow for highlight/selection, otherwise use split color or default
                let strokeColor = EAIColor('ink-soft');
                if (isSelected || isHighlighted) {
                    strokeColor = EAIColor('gold');
                } else if (splitColor && !node.isLeaf) {
                    strokeColor = splitColor;
                }
                circle.setAttribute('stroke', strokeColor);
                circle.setAttribute('stroke-width', isSelected || isHighlighted ? '4' : '2');
                group.appendChild(circle);

                // Node label
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', cx);
                text.setAttribute('y', cy);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', '10');
                text.setAttribute('font-weight', 'bold');
                // White text on colored backgrounds
                text.setAttribute('fill', (node.isLeaf || splitColor) ? EAIColor('surface') : EAIColor('ink-soft'));

                if (node.isLeaf) {
                    text.textContent = `C${node.prediction + 1}`;
                } else {
                    text.textContent = node.feature === 'x' ? 'X' : 'Y';
                }
                group.appendChild(text);

                // Threshold label for internal nodes
                if (!node.isLeaf) {
                    const threshText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    threshText.setAttribute('x', cx);
                    threshText.setAttribute('y', cy + NODE_RADIUS + 12);
                    threshText.setAttribute('text-anchor', 'middle');
                    threshText.setAttribute('font-size', '9');
                    threshText.setAttribute('font-weight', '600');
                    // Use matching split color for threshold text
                    threshText.setAttribute('fill', splitColor || '#666');
                    threshText.textContent = node.threshold.toFixed(2);
                    group.appendChild(threshText);
                }

                // Sample count
                const sampleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                sampleText.setAttribute('x', cx);
                sampleText.setAttribute('y', cy - NODE_RADIUS - 5);
                sampleText.setAttribute('text-anchor', 'middle');
                sampleText.setAttribute('font-size', '8');
                sampleText.setAttribute('fill', EAIColor('axis'));
                sampleText.textContent = `n=${node.samples}`;
                group.appendChild(sampleText);

                if (onNodeClick) {
                    group.addEventListener('click', () => onNodeClick(node));
                }

                this.treeSvg.appendChild(group);

                if (!node.isLeaf) {
                    drawNode(node.left);
                    drawNode(node.right);
                }
            };

            drawNode(treeRoot);
        }

        _clearTree() {
            if (this.treeSvg) {
                this.treeSvg.innerHTML = '<text x="280" y="100" text-anchor="middle" style="fill:var(--book-axis)">No tree built</text>';
            }
        }

        updateStats(stats) {
            const depthEl = document.getElementById('stat-depth');
            const leavesEl = document.getElementById('stat-leaves');
            const nodesEl = document.getElementById('stat-nodes');

            if (depthEl) depthEl.textContent = stats.depth;
            if (leavesEl) leavesEl.textContent = stats.leaves;
            if (nodesEl) nodesEl.textContent = stats.nodes;
        }

        updateMetrics(query, result) {
            const queryEl = document.getElementById('metric-query');
            const predEl = document.getElementById('metric-prediction');
            const pathEl = document.getElementById('metric-path');
            const samplesEl = document.getElementById('metric-samples');

            if (queryEl) {
                queryEl.innerHTML = query ? `(${query.x.toFixed(2)}, ${query.y.toFixed(2)})` : '-';
            }

            if (predEl) {
                if (result && result.prediction !== undefined) {
                    predEl.innerHTML = `<span class="prediction-badge class-${result.prediction}">Class ${result.prediction + 1}</span>`;
                } else {
                    predEl.innerHTML = '-';
                }
            }

            if (pathEl) {
                pathEl.innerHTML = result ? String(result.path.length - 1) : '-';
            }

            if (samplesEl && result && result.leafNode) {
                const counts = result.leafNode.classCounts;
                const parts = Object.entries(counts).map(([cls, count]) =>
                    `<span class="class-${cls}">C${parseInt(cls) + 1}: ${count}</span>`
                ).join(', ');
                samplesEl.innerHTML = parts || '-';
            } else if (samplesEl) {
                samplesEl.innerHTML = '-';
            }

            // Update class distribution bars
            this._updateDistributionBars(result);
        }

        _updateDistributionBars(result) {
            const container = document.getElementById('class-distribution');
            const barsEl = document.getElementById('distribution-bars');

            if (!container || !barsEl) return;

            if (!result || !result.leafNode) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';
            const counts = result.leafNode.classCounts;
            const total = Object.values(counts).reduce((a, b) => a + b, 0);

            let html = '';
            for (let c = 0; c < 3; c++) {
                const count = counts[c] || 0;
                const pct = total > 0 ? (count / total * 100) : 0;
                html += `
                    <div class="distribution-bar">
                        <span class="distribution-label class-${c}">C${c + 1}</span>
                        <div class="distribution-track">
                            <div class="distribution-fill class-${c}" style="width: ${pct}%"></div>
                        </div>
                        <span class="distribution-value">${count}</span>
                    </div>
                `;
            }
            barsEl.innerHTML = html;
        }

        updatePath(path) {
            const pathList = document.getElementById('path-list');
            const pathLength = document.getElementById('path-length');

            if (pathLength) {
                pathLength.textContent = path.length > 0 ? path.length - 1 : 0;
            }

            if (!pathList) return;

            if (!path || path.length === 0) {
                pathList.innerHTML = '<div class="list-empty">Click to classify a point</div>';
                return;
            }

            let html = '';
            path.forEach((step, i) => {
                if (step.isLeaf) {
                    html += `
                        <div class="path-item path-leaf">
                            <span class="path-step">${i + 1}</span>
                            <span class="path-desc">
                                <i class="fa fa-leaf"></i> Leaf:
                                <span class="prediction-badge class-${step.prediction}">Class ${step.prediction + 1}</span>
                            </span>
                        </div>
                    `;
                } else {
                    const featureLabel = step.feature === 'x' ? 'X' : 'Y';
                    const dirIcon = step.direction === 'left' ? 'fa-arrow-left' : 'fa-arrow-right';
                    html += `
                        <div class="path-item">
                            <span class="path-step">${i + 1}</span>
                            <span class="path-desc">
                                ${featureLabel} = ${step.value.toFixed(2)}
                                ${step.direction === 'left' ? '≤' : '>'} ${step.threshold.toFixed(2)}
                                <i class="fa ${dirIcon}"></i>
                            </span>
                        </div>
                    `;
                }
            });

            pathList.innerHTML = html;
        }

        updateDatasetDescription(type) {
            const el = document.getElementById('dataset-description');
            if (el) {
                el.textContent = DATASET_INFO[type] || '';
            }
        }

        showDesignInstructions(show, text = null) {
            const el = document.getElementById('design-instructions');
            const textEl = document.getElementById('design-instruction-text');
            if (el) {
                el.style.display = show ? 'block' : 'none';
            }
            if (textEl && text) {
                textEl.innerHTML = text;
            }
        }
    }

    // ============================================
    // DTreeApp Class (Main Controller)
    // ============================================
    class DTreeApp {
        constructor() {
            this.dataset = new DatasetState();
            this.solver = new DecisionTreeSolver();
            this.manualBuilder = new ManualTreeBuilder();
            this.ui = new UIRenderer();

            this.currentQuery = null;
            this.currentResult = null;
            this.editMode = 'classify';
            this.selectedClass = 0;
            this.treeMode = 'auto'; // 'auto' or 'design'
            this.showBoundaries = true;
            this.selectedNode = null;

            // Split dialog state
            this.splitDialogNode = null;
            this.splitFeature = 'x';
            this.splitThreshold = 0.5;

            // Drag state for split lines
            this.isDraggingSplit = false;
            this.draggedSplitNode = null;
            this.hoveredSplitLine = null;

            // Math tab state
            this.selectedMathNode = null;

            this._init();
        }

        _init() {
            if (window.VizLib?.TreeLayoutEngine) {
                this._setupEventListeners();
                this._loadInitialDataset();
            } else {
                window.addEventListener('vizlib-ready', () => {
                    this._setupEventListeners();
                    this._loadInitialDataset();
                });
            }
        }

        _setupEventListeners() {
            // Dataset selection (dropdown selector)
            document.getElementById('dataset-select')?.addEventListener('change', (e) => {
                this._selectDataset(e.target.value);
            });

            // Canvas interaction
            this.ui.canvas?.addEventListener('click', (e) => this._handleCanvasClick(e));

            // Split line dragging
            this.ui.canvas?.addEventListener('mousedown', (e) => this._handleMouseDown(e));
            this.ui.canvas?.addEventListener('mousemove', (e) => this._handleMouseMove(e));
            this.ui.canvas?.addEventListener('mouseup', (e) => this._handleMouseUp(e));
            this.ui.canvas?.addEventListener('mouseleave', (e) => this._handleMouseUp(e));

            // Algorithm options - depth stepper
            document.getElementById('depth-minus')?.addEventListener('click', () => {
                const input = document.getElementById('max-depth-value');
                const current = parseInt(input.value) || 5;
                if (current > 1) {
                    input.value = current - 1;
                    if (this.treeMode === 'auto') this._rebuildTree();
                }
            });

            document.getElementById('depth-plus')?.addEventListener('click', () => {
                const input = document.getElementById('max-depth-value');
                const current = parseInt(input.value) || 5;
                if (current < 15) {
                    input.value = current + 1;
                    if (this.treeMode === 'auto') this._rebuildTree();
                }
            });

            document.getElementById('criterion-select')?.addEventListener('change', () => {
                if (this.treeMode === 'auto') this._rebuildTree();
            });

            document.getElementById('show-boundaries')?.addEventListener('change', (e) => {
                this.showBoundaries = e.target.checked;
                this._updateBoundaries();
            });

            // Math tab reset button
            document.getElementById('math-reset-btn')?.addEventListener('click', () => {
                this.selectedMathNode = null;
                this._clearMathTab();
                this._updateMathNodeHighlight();
                this._renderAll();
            });

            // Tree mode toggle
            document.getElementById('btn-auto-mode')?.addEventListener('click', () => {
                this._setTreeMode('auto');
            });

            document.getElementById('btn-design-mode')?.addEventListener('click', () => {
                this._setTreeMode('design');
            });

            document.getElementById('btn-rebuild-tree')?.addEventListener('click', () => {
                this._rebuildTree();
            });

            document.getElementById('btn-clear-tree')?.addEventListener('click', () => {
                this._clearTree();
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
                this._rebuildTree();
            });

            // Split dialog
            document.querySelectorAll('#split-dialog [data-feature]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.splitFeature = e.currentTarget.dataset.feature;
                    document.querySelectorAll('#split-dialog [data-feature]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this._updateSplitPreview();
                });
            });

            document.getElementById('threshold-slider')?.addEventListener('input', (e) => {
                this.splitThreshold = e.target.value / 100;
                this._updateSplitPreview();
            });

            document.getElementById('btn-apply-split')?.addEventListener('click', () => {
                this._applySplit();
            });

            document.getElementById('btn-cancel-split')?.addEventListener('click', () => {
                this._closeSplitDialog();
            });

            document.getElementById('btn-close-split-dialog')?.addEventListener('click', () => {
                this._closeSplitDialog();
            });

            // Info panel tabs
            document.querySelectorAll('.info-panel-tabs [data-tab]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tabId = e.currentTarget.dataset.tab;
                    document.querySelectorAll('.info-panel-tabs [data-tab]').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    document.querySelectorAll('.info-tab-content').forEach(content => {
                        content.classList.toggle('active', content.id === `tab-${tabId}`);
                    });
                });
            });

            // Theme changes
            if (window.VizLib?.ThemeManager) {
                window.VizLib.ThemeManager.onThemeChange(() => {
                    this.ui._updateColors();
                    this._renderAll();
                });
            }
        }

        _loadInitialDataset() {
            this._selectDataset('moons');
        }

        _selectDataset(type) {
            this.dataset.loadDataset(type);
            this._reset();
            this._rebuildTree();
            this.ui.updateDatasetDescription(type);
            this._updateUIForDataset(type);
        }

        _updateUIForDataset(type) {
            const editToolbar = document.querySelector('.edit-toolbar');
            if (editToolbar) {
                editToolbar.classList.toggle('active', type === 'custom');
            }

            const legendClass2 = document.getElementById('legend-class-2');
            const classBtn2 = document.querySelector('[data-class="2"]');
            const show3 = type === 'blobs' || type === 'custom';

            if (legendClass2) legendClass2.style.display = show3 ? '' : 'none';
            if (classBtn2) classBtn2.style.display = show3 ? '' : 'none';

            if (!show3 && this.selectedClass === 2) {
                this.selectedClass = 0;
                document.querySelectorAll('[data-class]').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-class="0"]')?.classList.add('active');
            }
        }

        _setTreeMode(mode) {
            this.treeMode = mode;

            document.getElementById('btn-auto-mode')?.classList.toggle('active', mode === 'auto');
            document.getElementById('btn-design-mode')?.classList.toggle('active', mode === 'design');
            document.getElementById('btn-clear-tree').style.display = mode === 'design' ? '' : 'none';

            this.ui.showDesignInstructions(mode === 'design');

            if (mode === 'design') {
                this.manualBuilder.initialize(this.dataset.getPoints());
            }

            this._rebuildTree();
        }

        _rebuildTree() {
            const points = this.dataset.getPoints();

            if (this.treeMode === 'auto') {
                const options = this._getOptions();
                this.solver.fit(points, options);
            } else {
                if (!this.manualBuilder.root) {
                    this.manualBuilder.initialize(points);
                }
            }

            this._renderAll();
        }

        _clearTree() {
            this.manualBuilder.clear();
            this.manualBuilder.initialize(this.dataset.getPoints());
            this.selectedNode = null;
            this._closeSplitDialog();
            this._renderAll();
        }

        _getOptions() {
            return {
                maxDepth: parseInt(document.getElementById('max-depth-value')?.value || '5'),
                minSamplesSplit: 2,  // Fixed default value
                criterion: document.getElementById('criterion-select')?.value || 'gini'
            };
        }

        _handleCanvasClick(e) {
            // Don't process click if we were dragging a split line
            if (this.isDraggingSplit) {
                return;
            }

            const coords = this.ui.getMouseDataCoords(e);

            if (coords.x < 0 || coords.x > 1 || coords.y < 0 || coords.y > 1) {
                return;
            }

            // Check if clicking on a split line - select it for math tab
            if (this.editMode === 'classify') {
                const splitLine = this._getSplitLineAtPosition(coords);
                if (splitLine) {
                    this._selectSplitForMath(splitLine.nodeId);
                    return;
                }
            }

            switch (this.editMode) {
                case 'classify':
                    this._classify(coords);
                    break;
                case 'add':
                    this.dataset.addPoint({ x: coords.x, y: coords.y, classLabel: this.selectedClass });
                    this._rebuildTree();
                    break;
                case 'delete':
                    if (this.dataset.removeNearestPoint(coords)) {
                        this._rebuildTree();
                    }
                    break;
            }
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

        _classify(query) {
            this.currentQuery = query;

            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            this.currentResult = currentSolver.predict(query);

            const animateCheckbox = document.getElementById('animate-classification');
            const shouldAnimate = animateCheckbox?.checked ?? true;

            if (shouldAnimate && this.currentResult.path.length > 1) {
                this._animateClassification(query, this.currentResult);
            } else {
                this._renderAll();
                this.ui.updateMetrics(query, this.currentResult);
                this.ui.updatePath(this.currentResult.path);
            }
        }

        _animateClassification(query, result) {
            // Cancel any existing animation
            if (this.animationTimer) {
                clearTimeout(this.animationTimer);
            }

            const speedSlider = document.getElementById('animation-speed');
            const speed = speedSlider ? parseInt(speedSlider.value) : 5;
            const delay = 600 - (speed - 1) * 50; // 550ms at speed 1, 100ms at speed 10

            const path = result.path;
            let step = 0;

            // Get the tree and split lines
            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            const tree = currentSolver.getTreeStructure();
            const splitLines = currentSolver.getSplitLines();

            // Show query point and canvas immediately
            this.ui.render(this.dataset.getPoints(), query, null, splitLines);

            // Clear previous metrics
            this.ui.updateMetrics(query, null);
            this.ui.updatePath([]);

            const animateStep = () => {
                if (step >= path.length) {
                    // Animation complete - show final result
                    this._renderAll();  // Re-render everything properly
                    this.ui.updateMetrics(query, result);
                    this.ui.updatePath(path);
                    return;
                }

                // Highlight path up to current step
                const partialPath = path.slice(0, step + 1);
                const currentNode = path[step];

                // Render tree with partial path highlighted
                this.ui.renderTree(
                    tree,
                    partialPath,
                    null,
                    (n) => this._handleNodeClick(n)
                );

                // Add pulse animation to current node
                const nodeGroup = this.ui.treeSvg?.querySelector(`[data-node-id="${currentNode.nodeId}"]`);
                if (nodeGroup) {
                    nodeGroup.classList.add('animating');
                    setTimeout(() => nodeGroup.classList.remove('animating'), 300);
                }

                // Update path display progressively
                this.ui.updatePath(partialPath);

                if (currentNode.isLeaf) {
                    this.ui.updateMetrics(query, result);
                } else {
                    // Show decision being made
                    const val = currentNode.feature === 'x' ? query.x : query.y;
                    const decision = val <= currentNode.threshold ? '≤' : '>';
                    const predEl = document.getElementById('metric-prediction');
                    if (predEl) {
                        predEl.innerHTML =
                            `<span class="animating-decision">${currentNode.feature.toUpperCase()} ${decision} ${currentNode.threshold.toFixed(2)}</span>`;
                    }
                }

                step++;
                this.animationTimer = setTimeout(animateStep, delay);
            };

            // Start animation after a brief pause
            this.animationTimer = setTimeout(animateStep, 200);
        }

        _handleNodeClick(node) {
            // Always handle math tab updates for non-leaf nodes
            this._handleMathNodeClick(node);

            // Design mode specific handling
            if (this.treeMode === 'design') {
                this.selectedNode = node;

                if (node.isLeaf) {
                    // Show split dialog for leaf nodes
                    this._openSplitDialog(node);
                }
            }

            this._renderAll();
        }

        _openSplitDialog(node) {
            this.splitDialogNode = node;
            this.splitFeature = 'x';
            this.splitThreshold = 0.5;

            // Reset UI
            document.querySelectorAll('#split-dialog [data-feature]').forEach(b => {
                b.classList.toggle('active', b.dataset.feature === 'x');
            });
            document.getElementById('threshold-slider').value = 50;
            this._updateSplitPreview();

            document.getElementById('split-dialog').style.display = 'block';
        }

        _closeSplitDialog() {
            this.splitDialogNode = null;
            document.getElementById('split-dialog').style.display = 'none';
        }

        _updateSplitPreview() {
            const thresholdEl = document.getElementById('threshold-value');
            const previewEl = document.getElementById('split-preview-text');

            if (thresholdEl) {
                thresholdEl.textContent = this.splitThreshold.toFixed(2);
            }

            if (previewEl) {
                const featureLabel = this.splitFeature === 'x' ? 'x' : 'y';
                previewEl.textContent = `${featureLabel} ≤ ${this.splitThreshold.toFixed(2)}`;
            }
        }

        _applySplit() {
            if (!this.splitDialogNode) return;

            this.manualBuilder.splitNode(
                this.splitDialogNode.id,
                this.splitFeature,
                this.splitThreshold,
                this.dataset.getPoints()
            );

            this._closeSplitDialog();
            this.selectedNode = null;
            this._renderAll();
        }

        _reset() {
            this.currentQuery = null;
            this.currentResult = null;
            this.selectedNode = null;
            this._closeSplitDialog();

            this.ui.updateMetrics(null, null);
            this.ui.updatePath([]);
        }

        _renderAll() {
            const points = this.dataset.getPoints();
            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            const treeRoot = currentSolver.getTreeStructure();
            let splitLines = currentSolver.getSplitLines();
            const stats = currentSolver.getStats();

            // If a node is selected for Math tab, filter out its descendants to reduce visual clutter
            if (this.selectedMathNode) {
                const descendantIds = this._getDescendantIds(this.selectedMathNode);
                splitLines = splitLines.filter(line => !descendantIds.has(line.nodeId));
            }

            // Render canvas (pass solver to show misclassified points)
            this.ui.render(points, this.currentQuery, this.currentResult, splitLines, currentSolver);

            // Render boundaries
            this._updateBoundaries();

            // Render tree
            const highlightPath = this.currentResult?.path || [];
            this.ui.renderTree(
                treeRoot,
                highlightPath,
                this.selectedNode?.id,
                (node) => this._handleNodeClick(node)
            );

            // Update math node highlight
            this._updateMathNodeHighlight();

            // Update stats
            this.ui.updateStats(stats);
        }

        _updateBoundaries() {
            if (this.showBoundaries) {
                const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
                if (currentSolver.getTreeStructure()) {
                    // Pass selected math node to simplify boundary visualization
                    this.ui.drawDecisionBoundary(currentSolver, this.dataset.getNumClasses(), this.selectedMathNode);
                }
            } else {
                this.ui.clearBoundary();
            }
        }

        // ============================================
        // Split Line Dragging
        // ============================================

        _getSplitLineAtPosition(coords) {
            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            const splitLines = currentSolver.getSplitLines();
            const threshold = 0.08; // Distance threshold for detecting hover/click on split lines (larger = easier to click)

            for (const line of splitLines) {
                const { feature, threshold: splitValue, bounds, nodeId } = line;

                if (feature === 'x') {
                    // Vertical line - check X distance and Y within bounds
                    if (Math.abs(coords.x - splitValue) < threshold &&
                        coords.y >= bounds.minY && coords.y <= bounds.maxY) {
                        return { ...line, nodeId };
                    }
                } else {
                    // Horizontal line - check Y distance and X within bounds
                    if (Math.abs(coords.y - splitValue) < threshold &&
                        coords.x >= bounds.minX && coords.x <= bounds.maxX) {
                        return { ...line, nodeId };
                    }
                }
            }
            return null;
        }

        _handleMouseDown(e) {
            if (this.editMode !== 'classify') return;

            const coords = this.ui.getMouseDataCoords(e);
            if (coords.x < 0 || coords.x > 1 || coords.y < 0 || coords.y > 1) return;

            const splitLine = this._getSplitLineAtPosition(coords);
            if (splitLine) {
                this.isDraggingSplit = true;
                this.draggedSplitNode = splitLine;
                this.ui.canvas.style.cursor = splitLine.feature === 'x' ? 'ew-resize' : 'ns-resize';
                e.preventDefault();
                e.stopPropagation();
            }
        }

        _handleMouseMove(e) {
            const coords = this.ui.getMouseDataCoords(e);

            if (this.isDraggingSplit && this.draggedSplitNode) {
                // Update the threshold based on mouse position
                const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
                const feature = this.draggedSplitNode.feature;
                const newThreshold = feature === 'x' ? coords.x : coords.y;

                currentSolver.updateThreshold(
                    this.draggedSplitNode.nodeId,
                    newThreshold,
                    this.dataset.getPoints()
                );

                // Update math tab if this node is selected or select it
                this.selectedMathNode = this._findNodeById(currentSolver.getTreeStructure(), this.draggedSplitNode.nodeId);
                this._updateMathTab(this.draggedSplitNode.nodeId);

                // Re-render everything
                this._renderAll();
                return;
            }

            // Check for hover over split lines (only in classify mode)
            if (this.editMode === 'classify' && !this.isDraggingSplit) {
                if (coords.x < 0 || coords.x > 1 || coords.y < 0 || coords.y > 1) {
                    this.hoveredSplitLine = null;
                    this.ui.canvas.style.cursor = 'crosshair';
                    return;
                }

                const splitLine = this._getSplitLineAtPosition(coords);
                if (splitLine) {
                    this.hoveredSplitLine = splitLine;
                    this.ui.canvas.style.cursor = splitLine.feature === 'x' ? 'ew-resize' : 'ns-resize';
                } else {
                    this.hoveredSplitLine = null;
                    this.ui.canvas.style.cursor = 'crosshair';
                }
            }
        }

        _handleMouseUp(e) {
            if (this.isDraggingSplit) {
                this.isDraggingSplit = false;
                this.draggedSplitNode = null;
                this._updateCursor();
            }
        }

        // ============================================
        // Math Tab
        // ============================================

        _selectSplitForMath(nodeId) {
            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            const node = this._findNodeById(currentSolver.getTreeStructure(), nodeId);

            if (node && !node.isLeaf) {
                this.selectedMathNode = node;
                this._updateMathTab(nodeId);
                this._updateMathNodeHighlight();
                this._renderAll();
            }
        }

        _handleMathNodeClick(node) {
            if (node.isLeaf) {
                // Clear math tab for leaf nodes
                this.selectedMathNode = null;
                this._clearMathTab('Leaf nodes have no split to analyze');
            } else {
                this.selectedMathNode = node;
                this._updateMathTab(node.id);
            }
            this._updateMathNodeHighlight();
        }

        _updateMathNodeHighlight() {
            // Remove existing highlights
            document.querySelectorAll('.tree-node.math-selected').forEach(el => {
                el.classList.remove('math-selected');
            });

            // Add highlight to selected node
            if (this.selectedMathNode) {
                const nodeEl = this.ui.treeSvg?.querySelector(`[data-node-id="${this.selectedMathNode.id}"]`);
                if (nodeEl) {
                    nodeEl.classList.add('math-selected');
                }
            }
        }

        _clearMathTab(message = 'Click a split line on the canvas to see calculations') {
            const emptyEl = document.getElementById('math-empty');
            const detailsEl = document.getElementById('math-details');

            if (emptyEl) {
                emptyEl.style.display = 'block';
                emptyEl.textContent = message;
            }
            if (detailsEl) {
                detailsEl.style.display = 'none';
            }
        }

        _updateMathTab(nodeId) {
            const currentSolver = this.treeMode === 'auto' ? this.solver : this.manualBuilder;
            const node = this._findNodeById(currentSolver.getTreeStructure(), nodeId);

            if (!node || node.isLeaf) {
                this._clearMathTab();
                return;
            }

            const points = this.dataset.getPoints();
            const criterion = document.getElementById('criterion-select')?.value || 'gini';
            const criterionLabel = criterion === 'gini' ? 'Gini' : 'Entropy';
            const criterionSymbol = criterion === 'gini' ? 'G' : 'H';

            // Get points in this node's bounds
            const nodePoints = points.filter(p =>
                p.x >= node.bounds.minX && p.x <= node.bounds.maxX &&
                p.y >= node.bounds.minY && p.y <= node.bounds.maxY
            );

            // Calculate parent stats
            const parentCounts = this._getClassCounts(nodePoints);
            const parentTotal = nodePoints.length;
            const parentImpurity = this._calculateImpurity(parentCounts, parentTotal, criterion);

            // Split points by threshold
            const leftPoints = nodePoints.filter(p => p[node.feature] <= node.threshold);
            const rightPoints = nodePoints.filter(p => p[node.feature] > node.threshold);

            // Calculate child stats
            const leftCounts = this._getClassCounts(leftPoints);
            const leftTotal = leftPoints.length;
            const leftImpurity = this._calculateImpurity(leftCounts, leftTotal, criterion);

            const rightCounts = this._getClassCounts(rightPoints);
            const rightTotal = rightPoints.length;
            const rightImpurity = this._calculateImpurity(rightCounts, rightTotal, criterion);

            // Calculate weighted impurity and gain
            const leftWeight = parentTotal > 0 ? leftTotal / parentTotal : 0;
            const rightWeight = parentTotal > 0 ? rightTotal / parentTotal : 0;
            const weightedImpurity = leftWeight * leftImpurity + rightWeight * rightImpurity;
            const gain = parentImpurity - weightedImpurity;

            // Update DOM
            const emptyEl = document.getElementById('math-empty');
            const detailsEl = document.getElementById('math-details');

            if (emptyEl) emptyEl.style.display = 'none';
            if (detailsEl) detailsEl.style.display = 'block';

            // Header
            const nodeLabel = document.getElementById('math-node-label');
            const criterionBadge = document.getElementById('math-criterion-badge');
            const splitText = document.getElementById('math-split-text');

            if (nodeLabel) nodeLabel.textContent = `Split Node (depth ${node.depth || 0})`;
            if (criterionBadge) criterionBadge.textContent = criterionLabel;
            if (splitText) splitText.textContent = `${node.feature.toUpperCase()} ≤ ${node.threshold.toFixed(3)}`;

            // Parent section
            document.getElementById('math-parent-n').textContent = parentTotal;
            document.getElementById('math-parent-classes').innerHTML = this._formatClassCounts(parentCounts);
            document.getElementById('math-parent-formula').innerHTML = this._formatImpurityFormula(parentCounts, parentTotal, criterion);
            document.getElementById('math-parent-impurity').textContent = parentImpurity.toFixed(4);

            // Determine region labels based on split feature
            const isVerticalSplit = node.feature === 'x';
            const leftLabel = isVerticalSplit ? 'Left Region' : 'Lower Region';
            const rightLabel = isVerticalSplit ? 'Right Region' : 'Upper Region';

            // Get the majority class for each child to determine background color
            const leftMajority = node.left?.prediction ?? 0;
            const rightMajority = node.right?.prediction ?? 0;
            const colors = this.ui.classColors || [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];

            // Left child
            document.getElementById('math-left-label').textContent = leftLabel;
            document.getElementById('math-left-condition').textContent = `(${node.feature.toUpperCase()} ≤ ${node.threshold.toFixed(2)})`;
            document.getElementById('math-left-n').textContent = leftTotal;
            document.getElementById('math-left-classes').innerHTML = this._formatClassCounts(leftCounts);
            document.getElementById('math-left-formula').innerHTML = this._formatImpurityFormula(leftCounts, leftTotal, criterion);
            document.getElementById('math-left-impurity').textContent = leftImpurity.toFixed(4);
            document.getElementById('math-left-section').style.backgroundColor = this._hexToRgba(colors[leftMajority], 0.15);

            // Right child
            document.getElementById('math-right-label').textContent = rightLabel;
            document.getElementById('math-right-condition').textContent = `(${node.feature.toUpperCase()} > ${node.threshold.toFixed(2)})`;
            document.getElementById('math-right-n').textContent = rightTotal;
            document.getElementById('math-right-classes').innerHTML = this._formatClassCounts(rightCounts);
            document.getElementById('math-right-formula').innerHTML = this._formatImpurityFormula(rightCounts, rightTotal, criterion);
            document.getElementById('math-right-impurity').textContent = rightImpurity.toFixed(4);
            document.getElementById('math-right-section').style.backgroundColor = this._hexToRgba(colors[rightMajority], 0.15);

            // Information gain breakdown
            const gainBreakdown = document.getElementById('math-gain-breakdown');
            if (gainBreakdown) {
                const leftSum = this._formatClassSum(leftCounts, 'math-sum-left');
                const rightSum = this._formatClassSum(rightCounts, 'math-sum-right');
                const parentSum = this._formatClassSum(parentCounts, 'math-sum-parent');

                gainBreakdown.innerHTML = `
                    <div class="math-gain-weights">
                        <div class="math-weight-left">
                            <span class="math-symbol-left">◀</span> w<sub>L</sub> =
                            <span class="math-fraction">
                                <span class="math-numerator">n<sub>L</sub></span>
                                <span class="math-denominator">n<sub>p</sub></span>
                            </span> =
                            <span class="math-fraction">
                                <span class="math-numerator">${leftSum}</span>
                                <span class="math-denominator">${parentSum}</span>
                            </span> = <strong>${leftWeight.toFixed(3)}</strong>
                        </div>
                        <div class="math-weight-right">
                            <span class="math-symbol-right">▶</span> w<sub>R</sub> =
                            <span class="math-fraction">
                                <span class="math-numerator">n<sub>R</sub></span>
                                <span class="math-denominator">n<sub>p</sub></span>
                            </span> =
                            <span class="math-fraction">
                                <span class="math-numerator">${rightSum}</span>
                                <span class="math-denominator">${parentSum}</span>
                            </span> = <strong>${rightWeight.toFixed(3)}</strong>
                        </div>
                    </div>
                    <div class="math-gain-calculation">
                        <span class="math-val-parent">${criterionSymbol}<sub>p</sub></span> − (<span class="math-val-left">w<sub>L</sub></span> × <span class="math-val-left">${criterionSymbol}<sub>L</sub></span> + <span class="math-val-right">w<sub>R</sub></span> × <span class="math-val-right">${criterionSymbol}<sub>R</sub></span>)<br>
                        = <span class="math-val-parent">${parentImpurity.toFixed(4)}</span> − (<span class="math-val-left">${leftWeight.toFixed(3)}</span> × <span class="math-val-left">${leftImpurity.toFixed(4)}</span> + <span class="math-val-right">${rightWeight.toFixed(3)}</span> × <span class="math-val-right">${rightImpurity.toFixed(4)}</span>)<br>
                        = <span class="math-val-parent">${parentImpurity.toFixed(4)}</span> − ${weightedImpurity.toFixed(4)}
                    </div>
                `;
            }
            document.getElementById('math-gain-value').textContent = gain.toFixed(4);
        }

        _findNodeById(root, nodeId) {
            if (!root) return null;
            if (root.id === nodeId) return root;
            if (root.isLeaf) return null;

            const left = this._findNodeById(root.left, nodeId);
            if (left) return left;

            return this._findNodeById(root.right, nodeId);
        }

        _getDescendantIds(node) {
            const ids = new Set();
            const collectIds = (n) => {
                if (!n || n.isLeaf) return;
                // Add child node IDs (not the current node itself)
                if (n.left) {
                    ids.add(n.left.id);
                    collectIds(n.left);
                }
                if (n.right) {
                    ids.add(n.right.id);
                    collectIds(n.right);
                }
            };
            collectIds(node);
            return ids;
        }

        _getClassCounts(points) {
            const counts = {};
            for (const p of points) {
                counts[p.classLabel] = (counts[p.classLabel] || 0) + 1;
            }
            return counts;
        }

        _calculateImpurity(classCounts, total, criterion) {
            if (total === 0) return 0;

            if (criterion === 'entropy') {
                let entropy = 0;
                for (const count of Object.values(classCounts)) {
                    if (count > 0) {
                        const p = count / total;
                        entropy -= p * Math.log2(p);
                    }
                }
                return entropy;
            } else {
                let gini = 1;
                for (const count of Object.values(classCounts)) {
                    const p = count / total;
                    gini -= p * p;
                }
                return gini;
            }
        }

        _formatClassCounts(counts) {
            const parts = [];
            const sortedKeys = Object.keys(counts).sort((a, b) => parseInt(a) - parseInt(b));
            const colors = this.ui.classColors || [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];
            for (const key of sortedKeys) {
                const classIdx = parseInt(key);
                const color = colors[classIdx] || colors[0];
                parts.push(`<span class="math-class-dot" style="background-color: ${color}"></span>${counts[key]}`);
            }
            return parts.join(' ');
        }

        // Format class counts as a summation with colored dots, wrapped in a colored box
        _formatClassSum(counts, boxClass) {
            const parts = [];
            const sortedKeys = Object.keys(counts).sort((a, b) => parseInt(a) - parseInt(b));
            const colors = this.ui.classColors || [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];
            for (const key of sortedKeys) {
                const classIdx = parseInt(key);
                const color = colors[classIdx] || colors[0];
                parts.push(`<span class="math-class-dot" style="background-color: ${color}"></span>${counts[key]}`);
            }
            return `<span class="math-sum-box ${boxClass}">${parts.join(' + ')}</span>`;
        }

        _formatImpurityFormula(counts, total, criterion) {
            if (total === 0) return '';

            const sortedKeys = Object.keys(counts).sort((a, b) => parseInt(a) - parseInt(b));
            const colors = this.ui.classColors || [EAIColor('class-0'), EAIColor('class-1'), EAIColor('class-2')];
            const terms = [];
            const symbol = criterion === 'entropy' ? 'H' : 'G';

            // Build denominator as sum of colored balls
            const denomParts = [];
            for (const key of sortedKeys) {
                const classIdx = parseInt(key);
                const color = colors[classIdx] || colors[0];
                const dot = `<span class="math-class-dot" style="background-color: ${color}"></span>`;
                denomParts.push(`${dot}${counts[key]}`);
            }
            const denominator = denomParts.join('+');

            for (const key of sortedKeys) {
                const classIdx = parseInt(key);
                const color = colors[classIdx] || colors[0];
                const count = counts[key];
                const dot = `<span class="math-class-dot" style="background-color: ${color}"></span>`;
                const fraction = `<span class="math-fraction"><span class="math-numerator">${dot}${count}</span><span class="math-denominator">${denominator}</span></span>`;

                if (criterion === 'entropy') {
                    terms.push(`<span class="math-term">${fraction}·log₂${fraction}</span>`);
                } else {
                    terms.push(`<span class="math-term">${fraction}²</span>`);
                }
            }

            if (criterion === 'entropy') {
                return `${symbol} = −(${terms.join(' + ')})`;
            } else {
                return `${symbol} = 1 − (${terms.join(' + ')})`;
            }
        }

        _hexToRgba(hex, alpha) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (result) {
                return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
            }
            return `rgba(128, 128, 128, ${alpha})`;
        }
    }

    // ============================================
    // Initialize
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        new DTreeApp();
    });
})();

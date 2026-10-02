/**
 * Minimax & Alpha-Beta Pruning Visualizer
 * Version: 6.0 - Collapsible tree for interactive exploration
 *
 * Uses pre-computed game tree binary files and Sigma.js for
 * high-performance WebGL rendering. Only visible nodes are laid out,
 * allowing exploration of trees with 500K+ nodes.
 */

(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================

    const TREE_DATA_PATH = 'static/data/';
    const NODE_SIZE = 8;  // Base size (will be multiplied for board display)
    const VERTICAL_SPACING = 150;  // Increased for larger nodes with boards
    const HORIZONTAL_SPACING = 120;  // Increased so boards are visible without zooming
    const MIN_NODE_WIDTH = 100;  // Increased to prevent overlap

    // Colors - use shared ThemeManager when available
    const getGameTreeColors = () => {
        const TM = window.VizLib?.ThemeManager;
        if (TM) {
            return TM.getColors('gameTree');
        }
        // Fallback
        return {
            maxNode: EAIColor('blue'),
            minNode: EAIColor('red'),
            optimalNode: EAIColor('green'),
            beyondDepth: EAIColor('grid'),
            selectedNode: EAIColor('gold-strong'),
            edge: EAIColor('axis'),
            optimalEdge: EAIColor('green'),
            beyondEdge: EAIColor('grid')
        };
    };
    // For backwards compatibility, also expose as COLORS
    const COLORS = getGameTreeColors();

    // Board image cache (key: board string like "XO_X_____", value: data URL)
    const boardImageCache = new Map();

    // Generate a data URL for a tic-tac-toe board state
    function generateBoardImage(board, size = 64) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // White background with slight rounded corners effect
        ctx.fillStyle = EAIColor('surface');
        ctx.fillRect(0, 0, size, size);

        // Draw grid lines
        const cellSize = size / 3;
        ctx.strokeStyle = EAIColor('ink-soft');
        ctx.lineWidth = Math.max(1, size / 32);

        // Vertical lines
        ctx.beginPath();
        ctx.moveTo(cellSize, 0);
        ctx.lineTo(cellSize, size);
        ctx.moveTo(cellSize * 2, 0);
        ctx.lineTo(cellSize * 2, size);

        // Horizontal lines
        ctx.moveTo(0, cellSize);
        ctx.lineTo(size, cellSize);
        ctx.moveTo(0, cellSize * 2);
        ctx.lineTo(size, cellSize * 2);
        ctx.stroke();

        // Draw X's and O's
        const padding = cellSize * 0.2;
        const lineWidth = Math.max(2, size / 20);

        for (let i = 0; i < 9; i++) {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const x = col * cellSize;
            const y = row * cellSize;

            if (board[i] === 'X') {
                ctx.strokeStyle = COLORS.maxNode;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x + padding, y + padding);
                ctx.lineTo(x + cellSize - padding, y + cellSize - padding);
                ctx.moveTo(x + cellSize - padding, y + padding);
                ctx.lineTo(x + padding, y + cellSize - padding);
                ctx.stroke();
            } else if (board[i] === 'O') {
                ctx.strokeStyle = COLORS.minNode;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 2 - padding, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        return canvas.toDataURL('image/png');
    }

    // Get or create cached board image
    function getBoardImage(board) {
        if (!board) return null;
        const key = board.map(c => c || '_').join('');
        if (!boardImageCache.has(key)) {
            boardImageCache.set(key, generateBoardImage(board));
        }
        return boardImageCache.get(key);
    }

    // ============================================
    // Collapsible Tree Visualizer
    // ============================================

    class CollapsibleTreeVisualizer {
        constructor(containerId) {
            this.container = document.getElementById(containerId);
            this.graph = null;
            this.renderer = null;
            this.treeData = null;
            this.depthLimit = 2;
            this.selectedNodeId = null;
            this.onNodeSelect = null;

            // Tree structure data from worker
            this.nodeDepths = null;
            this.nodeFlags = null;
            this.nodeOptimalBits = null;
            this.nodeBoards = null;
            this.nodeMoves = null;
            this.nodeValuesOffsets = null;
            this.childOffsets = null;
            this.allChildren = null;

            // Original binary buffer for value lookups
            this.binaryBuffer = null;
            this.binaryDataView = null;

            // Collapsible state
            this.expandedNodes = new Set(['0']);  // Root starts expanded
            this.visibleNodes = new Set();
            this.nodePositions = new Map();  // nodeId -> {x, y}

            // Worker
            this.worker = null;
            this.initWorker();
        }

        initWorker() {
            this.worker = new Worker('static/js/minimax-worker.js');

            this.worker.onmessage = (e) => {
                const { type, data, phase, progress, detail, error } = e.data;

                switch (type) {
                    case 'progress':
                        this.updatePhase(phase, progress, detail);
                        break;

                    case 'complete':
                        this.handleWorkerComplete(data);
                        break;

                    case 'error':
                        console.error('Worker error:', error);
                        this.showError(`Worker error: ${error}`);
                        break;
                }
            };

            this.worker.onerror = (e) => {
                console.error('Worker error:', e);
                this.showError(`Worker failed: ${e.message}`);
            };
        }

        // Get children of a node
        getChildren(nodeId) {
            const id = typeof nodeId === 'string' ? parseInt(nodeId, 10) : nodeId;
            if (!this.childOffsets) return [];

            const start = this.childOffsets[id];
            const end = this.childOffsets[id + 1];
            const children = [];
            for (let i = start; i < end; i++) {
                children.push(this.allChildren[i]);
            }
            return children;
        }

        // Check if node has children
        hasChildren(nodeId) {
            const id = typeof nodeId === 'string' ? parseInt(nodeId, 10) : nodeId;
            if (!this.childOffsets) return false;
            return this.childOffsets[id + 1] > this.childOffsets[id];
        }

        // Check if node is expanded
        isExpanded(nodeId) {
            return this.expandedNodes.has(String(nodeId));
        }

        // Toggle expand/collapse
        toggleExpand(nodeId) {
            const key = String(nodeId);
            if (this.expandedNodes.has(key)) {
                // Collapse: remove this node and all descendants from expanded
                this.collapseNode(nodeId);
            } else {
                // Expand: add this node to expanded
                this.expandedNodes.add(key);
            }
            this.updateVisibleNodes();
            this.computeLayout();
            this.updateGraph();
        }

        // Collapse a node and all its descendants
        collapseNode(nodeId) {
            const key = String(nodeId);
            this.expandedNodes.delete(key);

            // Also collapse all descendants
            const children = this.getChildren(nodeId);
            for (const childId of children) {
                this.collapseNode(childId);
            }
        }

        // Update the set of visible nodes based on expanded state
        updateVisibleNodes() {
            this.visibleNodes.clear();

            // BFS from root, adding visible nodes
            const queue = [0];  // Root is always visible
            this.visibleNodes.add('0');

            while (queue.length > 0) {
                const nodeId = queue.shift();

                // If this node is expanded, its children are visible
                if (this.isExpanded(nodeId)) {
                    const children = this.getChildren(nodeId);
                    for (const childId of children) {
                        this.visibleNodes.add(String(childId));
                        queue.push(childId);
                    }
                }
            }
        }

        // Compute layout for visible nodes only using shared TreeLayoutEngine
        computeLayout() {
            const layoutEngine = new window.VizLib.TreeLayoutEngine({
                horizontalSpacing: HORIZONTAL_SPACING,
                verticalSpacing: VERTICAL_SPACING,
                minNodeWidth: MIN_NODE_WIDTH
            });

            this.nodePositions = layoutEngine.computeVisibleLayout(
                this.visibleNodes,
                (nodeId) => this.getChildren(nodeId),
                (nodeId) => this.isExpanded(nodeId),
                '0'
            );
        }

        // Read value at specific depth from binary data
        getNodeValue(nodeId, depth) {
            const id = typeof nodeId === 'string' ? parseInt(nodeId, 10) : nodeId;
            if (!this.binaryDataView || !this.nodeValuesOffsets) return null;
            if (depth < 1 || depth > this.treeData.maxDepth) return null;

            const offset = this.nodeValuesOffsets[id];
            return this.binaryDataView.getInt16(offset + (depth - 1) * 2, true);
        }

        // Get board state for a node
        getNodeBoard(nodeId) {
            const id = typeof nodeId === 'string' ? parseInt(nodeId, 10) : nodeId;
            if (!this.nodeBoards) return null;
            const board = new Array(9);
            const offset = id * 9;
            for (let i = 0; i < 9; i++) {
                const cell = this.nodeBoards[offset + i];
                board[i] = cell === 1 ? 'X' : (cell === 2 ? 'O' : null);
            }
            return board;
        }

        // Get full node data object
        getNodeData(nodeId) {
            const id = typeof nodeId === 'string' ? parseInt(nodeId, 10) : nodeId;
            if (!this.nodeDepths || id >= this.nodeDepths.length) return null;

            const flags = this.nodeFlags[id];
            const isMaximizing = (flags & 1) !== 0;

            return {
                id,
                depth: this.nodeDepths[id],
                board: this.getNodeBoard(id),
                move: this.nodeMoves[id] === 255 ? null : this.nodeMoves[id],
                isMaximizing,
                isTerminal: (flags & 2) !== 0,
                currentPlayer: isMaximizing ? 'X' : 'O',
                optimalBits: this.nodeOptimalBits[id],
                hasChildren: this.hasChildren(id),
                isExpanded: this.isExpanded(id),
                childCount: this.getChildren(id).length
            };
        }

        async loadTree(position) {
            const binUrl = `${TREE_DATA_PATH}tictactoe-${position}.bin.gz`;

            try {
                this.showLoading();

                console.time('Total load time');

                // Fetch compressed data
                console.time('Fetch');
                const compressedData = await this.fetchWithProgress(binUrl);
                this.updatePhase('download', 100, 'Done', true);
                console.timeEnd('Fetch');

                // Decompress
                this.updatePhase('decompress', 50, 'Working...');
                console.time('Decompress');
                const decompressed = await this.decompressGzip(compressedData);
                this.binaryBuffer = decompressed;
                this.binaryDataView = new DataView(decompressed);
                this.updatePhase('decompress', 100, 'Done', true);
                console.timeEnd('Decompress');

                // Send to worker for parsing
                console.time('Worker processing');
                this.updatePhase('parse', 5, 'Starting...');

                const workerResult = await new Promise((resolve, reject) => {
                    this.workerResolve = resolve;
                    this.workerReject = reject;

                    const bufferClone = decompressed.slice(0);
                    this.worker.postMessage({
                        type: 'parse',
                        data: { buffer: bufferClone }
                    }, [bufferClone]);
                });

                console.timeEnd('Worker processing');

                // Initialize tree state
                this.expandedNodes = new Set(['0']);
                this.updateVisibleNodes();
                this.computeLayout();

                // Build and render graph
                this.updatePhase('render', 50, 'Building graph...');
                await this.buildGraph();

                console.time('Render');
                this.render();
                console.timeEnd('Render');

                console.timeEnd('Total load time');

                return this.treeData;
            } catch (error) {
                console.error('Error loading tree:', error);
                this.showError(`Could not load tree for position: ${position}`);
                return null;
            }
        }

        handleWorkerComplete(data) {
            // Store typed arrays
            this.nodeDepths = data.nodeDepths;
            this.nodeFlags = data.nodeFlags;
            this.nodeOptimalBits = data.nodeOptimalBits;
            this.nodeBoards = data.nodeBoards;
            this.nodeMoves = data.nodeMoves;
            this.nodeValuesOffsets = data.nodeValuesOffsets;
            this.childOffsets = data.childOffsets;
            this.allChildren = data.allChildren;

            this.treeData = {
                nodeCount: data.nodeCount,
                edgeCount: data.edgeCount,
                maxDepth: data.maxDepth
            };

            if (this.workerResolve) {
                this.workerResolve(data);
            }
        }

        async decompressGzip(compressedData) {
            if (typeof DecompressionStream !== 'undefined') {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = new Response(compressedData).body.pipeThrough(ds);
                const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
                return decompressedBuffer;
            }

            if (typeof pako !== 'undefined') {
                const decompressed = pako.inflate(new Uint8Array(compressedData));
                return decompressed.buffer;
            }

            throw new Error('No decompression method available');
        }

        showLoading() {
            this.container.innerHTML = `
                <div class="tree-loading-container">
                    <div class="loading-phases">
                        <div class="loading-phase" id="phase-download">
                            <div class="phase-header">
                                <span class="phase-icon"><i class="fa fa-download"></i></span>
                                <span class="phase-label">Download</span>
                                <span class="phase-status" id="status-download"></span>
                            </div>
                            <div class="phase-progress-container">
                                <div class="phase-progress-bar" id="bar-download"></div>
                            </div>
                        </div>
                        <div class="loading-phase" id="phase-decompress">
                            <div class="phase-header">
                                <span class="phase-icon"><i class="fa fa-file-archive-o"></i></span>
                                <span class="phase-label">Decompress</span>
                                <span class="phase-status" id="status-decompress"></span>
                            </div>
                            <div class="phase-progress-container">
                                <div class="phase-progress-bar" id="bar-decompress"></div>
                            </div>
                        </div>
                        <div class="loading-phase" id="phase-parse">
                            <div class="phase-header">
                                <span class="phase-icon"><i class="fa fa-cogs"></i></span>
                                <span class="phase-label">Parse Tree</span>
                                <span class="phase-status" id="status-parse"></span>
                            </div>
                            <div class="phase-progress-container">
                                <div class="phase-progress-bar" id="bar-parse"></div>
                            </div>
                        </div>
                        <div class="loading-phase" id="phase-nodes">
                            <div class="phase-header">
                                <span class="phase-icon"><i class="fa fa-circle-o"></i></span>
                                <span class="phase-label">Process Nodes</span>
                                <span class="phase-status" id="status-nodes"></span>
                            </div>
                            <div class="phase-progress-container">
                                <div class="phase-progress-bar" id="bar-nodes"></div>
                            </div>
                        </div>
                        <div class="loading-phase" id="phase-render">
                            <div class="phase-header">
                                <span class="phase-icon"><i class="fa fa-paint-brush"></i></span>
                                <span class="phase-label">Render</span>
                                <span class="phase-status" id="status-render"></span>
                            </div>
                            <div class="phase-progress-container">
                                <div class="phase-progress-bar" id="bar-render"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        updatePhase(phase, progress, detail = '', complete = false) {
            const phaseEl = document.getElementById(`phase-${phase}`);
            const barEl = document.getElementById(`bar-${phase}`);
            const statusEl = document.getElementById(`status-${phase}`);

            if (phaseEl) {
                phaseEl.classList.remove('pending', 'active', 'complete');
                phaseEl.classList.add(complete ? 'complete' : (progress > 0 ? 'active' : 'pending'));
            }
            if (barEl) {
                barEl.style.width = `${progress}%`;
            }
            if (statusEl) {
                if (complete) {
                    statusEl.innerHTML = '<i class="fa fa-check"></i>';
                } else if (progress > 0) {
                    statusEl.textContent = detail || `${Math.round(progress)}%`;
                } else {
                    statusEl.textContent = '';
                }
            }
        }

        async fetchWithProgress(url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const contentLength = response.headers.get('content-length');
            if (!contentLength || !response.body) {
                return await response.arrayBuffer();
            }

            const total = parseInt(contentLength, 10);
            let loaded = 0;

            const reader = response.body.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loaded += value.length;

                const progress = (loaded / total) * 100;
                const loadedKB = (loaded / 1024).toFixed(0);
                const totalKB = (total / 1024).toFixed(0);
                this.updatePhase('download', progress, `${loadedKB}/${totalKB} KB`);
            }

            const combined = new Uint8Array(loaded);
            let position = 0;
            for (const chunk of chunks) {
                combined.set(chunk, position);
                position += chunk.length;
            }

            return combined.buffer;
        }

        showError(message) {
            this.container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center;
                            height: 100%; color: #d32f2f; font-size: 14px;">
                    <i class="fa fa-exclamation-triangle"></i>&nbsp; ${message}
                </div>
            `;
        }

        async buildGraph() {
            this.graph = new graphology.DirectedGraph();

            // Add only visible nodes
            for (const nodeKey of this.visibleNodes) {
                const nodeId = parseInt(nodeKey, 10);
                const pos = this.nodePositions.get(nodeKey);
                const flags = this.nodeFlags[nodeId];
                const isMaximizing = (flags & 1) !== 0;
                const depth = this.nodeDepths[nodeId];
                const optimalBits = this.nodeOptimalBits[nodeId];
                const isOptimal = (optimalBits & (1 << (this.depthLimit - 1))) !== 0;
                const isBeyond = depth > this.depthLimit;
                const hasChildren = this.hasChildren(nodeId);
                const isExpanded = this.isExpanded(nodeId);

                const originalColor = isMaximizing ? COLORS.maxNode : COLORS.minNode;
                let color;
                if (isBeyond) {
                    color = COLORS.beyondDepth;
                } else if (isOptimal) {
                    color = COLORS.optimalNode;
                } else {
                    color = originalColor;
                }

                // Get value for label
                let label = '';
                if (!isBeyond) {
                    const value = this.getNodeValue(nodeId, this.depthLimit);
                    if (value !== null) {
                        label = String(value);
                    }
                }

                // Add expand indicator to label
                if (hasChildren && !isExpanded) {
                    const childCount = this.getChildren(nodeId).length;
                    label = label ? `${label} [+${childCount}]` : `[+${childCount}]`;
                }

                // Get board state for this node
                const board = this.getNodeBoard(nodeId);

                this.graph.addNode(nodeKey, {
                    x: pos.x,
                    y: pos.y,
                    size: NODE_SIZE * 4,  // Larger size for board visibility
                    color: 'rgba(0,0,0,0)',  // Transparent - let board drawing be the only visual
                    borderColor: color,  // Store color for board border
                    originalColor,
                    depth,
                    isMaximizing,
                    isTerminal: (flags & 2) !== 0,
                    label,
                    hasChildren,
                    isExpanded,
                    board  // Board state array for custom drawing
                });
            }

            // Add edges between visible nodes
            for (const nodeKey of this.visibleNodes) {
                if (this.isExpanded(nodeKey)) {
                    const children = this.getChildren(nodeKey);
                    for (const childId of children) {
                        const childKey = String(childId);
                        if (this.visibleNodes.has(childKey)) {
                            const targetDepth = this.nodeDepths[childId];
                            const targetOptimalBits = this.nodeOptimalBits[childId];
                            const isBeyond = targetDepth > this.depthLimit;
                            const isOptimal = (targetOptimalBits & (1 << (this.depthLimit - 1))) !== 0;

                            let edgeColor = COLORS.edge;
                            let edgeSize = 1;
                            if (isBeyond) {
                                edgeColor = COLORS.beyondEdge;
                                edgeSize = 0.5;
                            } else if (isOptimal) {
                                edgeColor = COLORS.optimalEdge;
                                edgeSize = 2;
                            }

                            this.graph.addEdge(nodeKey, childKey, {
                                size: edgeSize,
                                color: edgeColor
                            });
                        }
                    }
                }
            }
        }

        updateGraph() {
            // Recompute positions and rebuild graph
            this.computeLayout();

            // Clear and rebuild
            this.graph.clear();

            // Re-add nodes and edges
            for (const nodeKey of this.visibleNodes) {
                const nodeId = parseInt(nodeKey, 10);
                const pos = this.nodePositions.get(nodeKey);
                const flags = this.nodeFlags[nodeId];
                const isMaximizing = (flags & 1) !== 0;
                const depth = this.nodeDepths[nodeId];
                const optimalBits = this.nodeOptimalBits[nodeId];
                const isOptimal = (optimalBits & (1 << (this.depthLimit - 1))) !== 0;
                const isBeyond = depth > this.depthLimit;
                const hasChildren = this.hasChildren(nodeId);
                const isExpanded = this.isExpanded(nodeId);

                const originalColor = isMaximizing ? COLORS.maxNode : COLORS.minNode;
                let color;
                if (nodeKey === this.selectedNodeId) {
                    color = COLORS.selectedNode;
                } else if (isBeyond) {
                    color = COLORS.beyondDepth;
                } else if (isOptimal) {
                    color = COLORS.optimalNode;
                } else {
                    color = originalColor;
                }

                let label = '';
                if (!isBeyond) {
                    const value = this.getNodeValue(nodeId, this.depthLimit);
                    if (value !== null) {
                        label = String(value);
                    }
                }

                if (hasChildren && !isExpanded) {
                    const childCount = this.getChildren(nodeId).length;
                    label = label ? `${label} [+${childCount}]` : `[+${childCount}]`;
                }

                // Get board state for this node
                const board = this.getNodeBoard(nodeId);

                this.graph.addNode(nodeKey, {
                    x: pos.x,
                    y: pos.y,
                    size: NODE_SIZE * 4,  // Larger size for board visibility
                    color: 'rgba(0,0,0,0)',  // Transparent - let board drawing be the only visual
                    borderColor: color,  // Store color for board border
                    originalColor,
                    depth,
                    isMaximizing,
                    isTerminal: (flags & 2) !== 0,
                    label,
                    hasChildren,
                    isExpanded,
                    board  // Board state array for custom drawing
                });
            }

            // Add edges
            for (const nodeKey of this.visibleNodes) {
                if (this.isExpanded(nodeKey)) {
                    const children = this.getChildren(nodeKey);
                    for (const childId of children) {
                        const childKey = String(childId);
                        if (this.visibleNodes.has(childKey)) {
                            const targetDepth = this.nodeDepths[childId];
                            const targetOptimalBits = this.nodeOptimalBits[childId];
                            const isBeyond = targetDepth > this.depthLimit;
                            const isOptimal = (targetOptimalBits & (1 << (this.depthLimit - 1))) !== 0;

                            let edgeColor = COLORS.edge;
                            let edgeSize = 1;
                            if (isBeyond) {
                                edgeColor = COLORS.beyondEdge;
                            } else if (isOptimal) {
                                edgeColor = COLORS.optimalEdge;
                                edgeSize = 2;
                            }

                            this.graph.addEdge(nodeKey, childKey, {
                                size: edgeSize,
                                color: edgeColor
                            });
                        }
                    }
                }
            }

            this.renderer.refresh();
            this.zoomToFit();
        }

        render() {
            this.container.innerHTML = '';

            if (this.renderer) {
                this.renderer.kill();
            }

            // Custom function to draw board state on each node
            const self = this;
            const drawBoardOnNode = (context, data, settings) => {
                // Always draw a board grid, even if board data is missing
                const board = data.board || [null, null, null, null, null, null, null, null, null];

                // Enforce minimum size so boards are always visible
                const MIN_BOARD_SIZE = 30;
                const size = Math.max(data.size * 2, MIN_BOARD_SIZE);  // Board size relative to node
                const x = data.x - size / 2;
                const y = data.y - size / 2;
                const cellSize = size / 3;

                // Draw white background
                context.fillStyle = EAIColor('surface');
                context.fillRect(x, y, size, size);

                // Draw grid lines
                context.strokeStyle = EAIColor('ink-soft');
                context.lineWidth = Math.max(0.5, size / 32);
                context.beginPath();
                // Vertical lines
                context.moveTo(x + cellSize, y);
                context.lineTo(x + cellSize, y + size);
                context.moveTo(x + cellSize * 2, y);
                context.lineTo(x + cellSize * 2, y + size);
                // Horizontal lines
                context.moveTo(x, y + cellSize);
                context.lineTo(x + size, y + cellSize);
                context.moveTo(x, y + cellSize * 2);
                context.lineTo(x + size, y + cellSize * 2);
                context.stroke();

                // Draw X's and O's
                const padding = cellSize * 0.2;
                const lineWidth = Math.max(1, size / 16);

                for (let i = 0; i < 9; i++) {
                    const row = Math.floor(i / 3);
                    const col = i % 3;
                    const cx = x + col * cellSize;
                    const cy = y + row * cellSize;

                    if (board[i] === 'X') {
                        context.strokeStyle = COLORS.maxNode;
                        context.lineWidth = lineWidth;
                        context.lineCap = 'round';
                        context.beginPath();
                        context.moveTo(cx + padding, cy + padding);
                        context.lineTo(cx + cellSize - padding, cy + cellSize - padding);
                        context.moveTo(cx + cellSize - padding, cy + padding);
                        context.lineTo(cx + padding, cy + cellSize - padding);
                        context.stroke();
                    } else if (board[i] === 'O') {
                        context.strokeStyle = COLORS.minNode;
                        context.lineWidth = lineWidth;
                        context.beginPath();
                        context.arc(cx + cellSize / 2, cy + cellSize / 2, cellSize / 2 - padding, 0, Math.PI * 2);
                        context.stroke();
                    }
                }

                // Draw border to indicate node state (use borderColor since color is transparent)
                context.strokeStyle = data.borderColor || data.originalColor || '#333333';
                context.lineWidth = Math.max(2, size / 12);
                context.strokeRect(x, y, size, size);

                // Draw label below
                if (data.label) {
                    context.fillStyle = EAIColor('ink');
                    context.font = `bold ${Math.max(10, size / 4)}px Arial`;
                    context.textAlign = 'center';
                    context.textBaseline = 'top';
                    context.fillText(data.label, data.x, y + size + 4);
                }
            };

            this.renderer = new Sigma(this.graph, this.container, {
                renderLabels: true,  // Enable label rendering
                defaultEdgeType: 'line',
                defaultDrawNodeLabel: drawBoardOnNode,
                labelRenderedSizeThreshold: 0,  // Always render labels
                minCameraRatio: 0.1,
                maxCameraRatio: 5,
                // Pass board and borderColor data through to label renderer
                nodeReducer: (node, data) => {
                    const board = this.graph.getNodeAttribute(node, 'board');
                    const borderColor = this.graph.getNodeAttribute(node, 'borderColor');
                    return { ...data, board, borderColor };
                }
            });

            this.setupEventHandlers();
            this.zoomToFit();
            this.updateInfo();

            // Select root
            this.selectNode('0');
        }

        setupEventHandlers() {
            // Single click: select node
            this.renderer.on('clickNode', ({ node }) => {
                this.selectNode(node);
            });

            // Double click: collapse (since single-click auto-expands)
            this.renderer.on('doubleClickNode', ({ node }) => {
                const nodeData = this.getNodeData(node);
                if (nodeData && nodeData.hasChildren && this.isExpanded(node)) {
                    this.collapseNode(node);
                    this.updateVisibleNodes();
                    this.computeLayout();
                    this.updateGraph();
                }
            });

            // Background click: deselect
            this.renderer.on('clickStage', () => {
                this.selectNode(null);
            });
        }

        setDepthLimit(depth) {
            this.depthLimit = depth;
            this.updateGraph();
            this.updateInfo();

            if (this.selectedNodeId && this.onNodeSelect) {
                const nodeData = this.getNodeData(this.selectedNodeId);
                if (nodeData) {
                    this.onNodeSelect(nodeData);
                }
            }
        }

        selectNode(nodeId) {
            // Reset previous selection
            if (this.selectedNodeId && this.graph.hasNode(this.selectedNodeId)) {
                const id = parseInt(this.selectedNodeId, 10);
                const optimalBits = this.nodeOptimalBits[id];
                const isOptimal = (optimalBits & (1 << (this.depthLimit - 1))) !== 0;
                const isBeyond = this.nodeDepths[id] > this.depthLimit;

                let color;
                if (isBeyond) {
                    color = COLORS.beyondDepth;
                } else if (isOptimal) {
                    color = COLORS.optimalNode;
                } else {
                    color = this.graph.getNodeAttribute(this.selectedNodeId, 'originalColor');
                }
                this.graph.setNodeAttribute(this.selectedNodeId, 'color', color);
            }

            this.selectedNodeId = nodeId;

            if (nodeId && this.graph.hasNode(nodeId)) {
                this.graph.setNodeAttribute(nodeId, 'color', COLORS.selectedNode);

                // Auto-expand if node has children and isn't already expanded
                const nodeData = this.getNodeData(nodeId);
                if (nodeData && nodeData.hasChildren && !this.isExpanded(nodeId)) {
                    this.expandedNodes.add(String(nodeId));
                    this.updateVisibleNodes();
                    this.computeLayout();
                    this.updateGraph();
                }

                if (this.onNodeSelect) {
                    this.onNodeSelect(nodeData);
                }
            } else if (this.onNodeSelect) {
                this.onNodeSelect(null);
            }

            this.renderer?.refresh();
        }

        zoomToFit() {
            if (!this.renderer) return;
            const camera = this.renderer.getCamera();
            camera.animatedReset({ duration: 300 });
        }

        zoomToNode(nodeId, animate = true) {
            if (!this.renderer || !this.graph.hasNode(nodeId)) return;

            const camera = this.renderer.getCamera();
            // Use getNodeDisplayData for camera-space coordinates (not raw graph coords)
            const nodeDisplayData = this.renderer.getNodeDisplayData(nodeId);

            if (!nodeDisplayData) return;

            if (animate) {
                camera.animate(
                    { x: nodeDisplayData.x, y: nodeDisplayData.y, ratio: 0.5 },
                    { duration: 300 }
                );
            } else {
                camera.setState({ x: nodeDisplayData.x, y: nodeDisplayData.y, ratio: 0.5 });
            }
        }

        updateInfo() {
            const depthEl = document.getElementById('tree-depth');
            const nodesEl = document.getElementById('tree-nodes');
            const timeEl = document.getElementById('metric-time');

            if (this.treeData) {
                if (depthEl) depthEl.textContent = `depth ${this.treeData.maxDepth}`;
                if (nodesEl) nodesEl.textContent = `${this.visibleNodes.size} visible / ${this.treeData.nodeCount.toLocaleString()} total`;
                if (timeEl) timeEl.textContent = 'Collapsible';
            }
        }

        // Expand all nodes up to a certain depth
        expandToDepth(maxDepth) {
            const queue = [0];
            while (queue.length > 0) {
                const nodeId = queue.shift();
                const depth = this.nodeDepths[nodeId];

                if (depth < maxDepth && this.hasChildren(nodeId)) {
                    this.expandedNodes.add(String(nodeId));
                    const children = this.getChildren(nodeId);
                    for (const childId of children) {
                        queue.push(childId);
                    }
                }
            }
            this.updateVisibleNodes();
            this.computeLayout();
            this.updateGraph();
        }

        // Collapse all except root
        collapseAll() {
            this.expandedNodes.clear();
            this.expandedNodes.add('0');
            this.updateVisibleNodes();
            this.computeLayout();
            this.updateGraph();
        }
    }

    // ============================================
    // UI Controller
    // ============================================

    class UIController {
        constructor() {
            this.gameType = 'tictactoe';
            this.initBoardPreview();
        }

        initBoardPreview() {
            const previewGrid = document.getElementById('preview-grid');
            if (!previewGrid) return;

            previewGrid.innerHTML = '';
            for (let i = 0; i < 9; i++) {
                const cell = document.createElement('div');
                cell.className = 'preview-cell';
                cell.dataset.index = i;
                previewGrid.appendChild(cell);
            }
        }

        renderBoardPreview(board, lastMove = null, childMoves = [], currentPlayer = 'X', onMoveClick = null) {
            const previewContainer = document.getElementById('selected-board-preview');
            const previewGrid = document.getElementById('preview-grid');

            if (!previewContainer || !previewGrid) return;

            if (!board) {
                previewContainer.style.display = 'none';
                return;
            }

            previewContainer.style.display = 'block';
            const cells = previewGrid.querySelectorAll('.preview-cell');

            cells.forEach((cell, i) => {
                cell.textContent = board[i] || '';
                cell.className = 'preview-cell';

                if (board[i]) {
                    cell.classList.add(board[i] === 'X' ? 'x-cell' : 'o-cell');
                }
                if (lastMove === i) {
                    cell.classList.add('last-move');
                }

                const childMove = childMoves.find(cm => cm.move === i);
                if (childMove && !board[i]) {
                    cell.classList.add('available-move');
                    cell.classList.add(currentPlayer === 'X' ? 'ghost-x' : 'ghost-o');
                    cell.dataset.childId = childMove.childId;

                    cell.style.cursor = 'pointer';
                    cell.onclick = () => {
                        if (onMoveClick) {
                            onMoveClick(childMove.childId);
                        }
                    };
                } else {
                    cell.style.cursor = 'default';
                    cell.onclick = null;
                    delete cell.dataset.childId;
                }
            });
        }

        updateNodeDetails(node, depthLimit = null, childMoves = [], onMoveClick = null, value = null, isOptimal = false) {
            const detailsDiv = document.getElementById('node-details');
            const noNodeDiv = document.getElementById('no-node-selected');

            if (!node) {
                if (detailsDiv) detailsDiv.style.display = 'none';
                if (noNodeDiv) noNodeDiv.style.display = 'block';
                this.renderBoardPreview(null);
                return;
            }

            this.renderBoardPreview(node.board, node.move, childMoves, node.currentPlayer, onMoveClick);

            if (detailsDiv) detailsDiv.style.display = 'block';
            if (noNodeDiv) noNodeDiv.style.display = 'none';

            const playerEl = document.getElementById('detail-player');
            if (playerEl) {
                playerEl.textContent = node.isMaximizing ? 'X (MAX)' : 'O (MIN)';
                playerEl.className = 'node-detail-value ' + (node.isMaximizing ? 'max-text' : 'min-text');
            }

            const depthEl = document.getElementById('detail-depth');
            if (depthEl) depthEl.textContent = node.depth;

            const valueEl = document.getElementById('detail-value');
            if (valueEl) {
                if (value !== undefined && value !== null) {
                    valueEl.textContent = value;
                    valueEl.className = 'node-detail-value';
                    if (value > 0) valueEl.classList.add('positive-value');
                    else if (value < 0) valueEl.classList.add('negative-value');
                } else {
                    valueEl.textContent = 'N/A';
                    valueEl.className = 'node-detail-value';
                }
            }

            const alphaRows = document.querySelectorAll('.alpha-beta-row');
            alphaRows.forEach(row => row.style.display = 'none');

            const statusEl = document.getElementById('detail-status');
            if (statusEl) {
                let status = node.isTerminal ? 'Terminal' : 'Internal';
                if (node.hasChildren) {
                    status += node.isExpanded ? ' (Expanded)' : ` (${node.childCount} children)`;
                }
                if (isOptimal) status += ' - Optimal';
                statusEl.textContent = status;
                statusEl.className = 'node-detail-value';
                if (isOptimal) statusEl.classList.add('optimal-text');
            }

            const moveRow = document.getElementById('detail-move-row');
            const moveEl = document.getElementById('detail-move');
            if (node.move !== null && node.move !== undefined) {
                if (moveRow) moveRow.style.display = 'flex';
                if (moveEl) moveEl.textContent = `Position ${node.move}`;
            } else {
                if (moveRow) moveRow.style.display = 'none';
            }
        }

        updateMetrics(metrics) {
            const evalEl = document.getElementById('metric-evaluated');
            const expandedEl = document.getElementById('metric-expanded');

            if (evalEl) evalEl.textContent = metrics?.nodesEvaluated?.toLocaleString() || '-';
            if (expandedEl) expandedEl.textContent = metrics?.nodesExpanded?.toLocaleString() || '-';
        }

        switchGame(game) {
            this.gameType = game;

            document.querySelectorAll('.game-selector .btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.game === game);
            });

            document.getElementById('tictactoe-container').style.display = game === 'tictactoe' ? 'block' : 'none';
            document.getElementById('nim-container').style.display = game === 'nim' ? 'block' : 'none';
            document.getElementById('position-control').style.display = game === 'tictactoe' ? 'block' : 'none';
        }
    }

    // ============================================
    // Main Application
    // ============================================

    class MinimaxApp {
        constructor() {
            this.ui = new UIController();
            this.treeViz = new CollapsibleTreeVisualizer('game-tree-container');

            this.gameType = 'tictactoe';
            this.currentDepth = 2;
            this.currentPosition = 'mid';

            this.initEventListeners();
            this.loadPosition(this.currentPosition);
        }

        initEventListeners() {
            // Game switching
            document.querySelectorAll('.game-selector .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.dataset.game === 'tictactoe') {
                        this.switchGame(btn.dataset.game);
                    } else {
                        alert('Pre-generated trees are only available for Tic-Tac-Toe');
                    }
                });
            });

            // Reset button
            document.getElementById('btn-reset')?.addEventListener('click', () => {
                this.treeViz.collapseAll();
            });

            // Depth controls
            const depthValue = document.getElementById('depth-value');
            const depthMinus = document.getElementById('depth-minus');
            const depthPlus = document.getElementById('depth-plus');

            if (depthMinus) {
                depthMinus.addEventListener('click', () => {
                    if (this.currentDepth > 1) {
                        this.currentDepth--;
                        if (depthValue) depthValue.textContent = this.currentDepth;
                        this.treeViz.setDepthLimit(this.currentDepth);
                    }
                });
            }

            if (depthPlus) {
                depthPlus.addEventListener('click', () => {
                    const maxDepth = this.treeViz.treeData?.maxDepth || 9;
                    if (this.currentDepth < maxDepth) {
                        this.currentDepth++;
                        if (depthValue) depthValue.textContent = this.currentDepth;
                        this.treeViz.setDepthLimit(this.currentDepth);
                    }
                });
            }

            // Position preset
            const positionPreset = document.getElementById('position-preset');
            if (positionPreset) {
                positionPreset.innerHTML = `
                    <option value="empty">Empty Board (550K nodes)</option>
                    <option value="early">Early Game (7K nodes)</option>
                    <option value="mid" selected>Mid Game (150 nodes)</option>
                    <option value="near-win">Near Win (157 nodes)</option>
                    <option value="forced">Forced Mate (126 nodes)</option>
                    <option value="late">Late Game (16 nodes)</option>
                `;

                positionPreset.addEventListener('change', () => {
                    this.loadPosition(positionPreset.value);
                });
            }

            // Node selection callback
            this.treeViz.onNodeSelect = (node) => {
                if (!node) {
                    this.ui.updateNodeDetails(null);
                    return;
                }

                // Get all child moves for board preview (even if node is collapsed)
                const childMoves = [];
                const children = this.treeViz.getChildren(node.id);
                for (const childId of children) {
                    const move = this.treeViz.nodeMoves[childId];
                    if (move !== 255) {
                        childMoves.push({ move, childId });
                    }
                }

                const onMoveClick = (childId) => {
                    const childKey = String(childId);
                    const parentKey = String(node.id);

                    // Ensure parent is expanded (don't toggle, explicitly expand)
                    if (!this.treeViz.isExpanded(parentKey)) {
                        this.treeViz.expandedNodes.add(parentKey);
                        this.treeViz.updateVisibleNodes();
                        this.treeViz.computeLayout();
                        this.treeViz.updateGraph();
                    }

                    // Now child should be in the graph - select it
                    if (this.treeViz.graph.hasNode(childKey)) {
                        this.treeViz.selectNode(childKey);
                        // Zoom after a brief delay to let graph updates settle
                        // (selectNode may trigger auto-expand which rebuilds the graph)
                        requestAnimationFrame(() => {
                            if (this.treeViz.graph.hasNode(childKey)) {
                                this.treeViz.zoomToNode(childKey);
                            }
                        });
                    }
                };

                const value = this.treeViz.getNodeValue(node.id, this.currentDepth);
                const isOptimal = node.optimalBits ? (node.optimalBits & (1 << (this.currentDepth - 1))) !== 0 : false;

                this.ui.updateNodeDetails(node, this.currentDepth, childMoves, onMoveClick, value, isOptimal);
            };

            // Zoom controls
            document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
                this.treeViz.zoomToFit();
            });
        }

        switchGame(game) {
            this.gameType = game;
            this.ui.switchGame(game);
        }

        async loadPosition(position) {
            this.currentPosition = position;

            this.currentDepth = 2;
            const depthValue = document.getElementById('depth-value');
            if (depthValue) depthValue.textContent = this.currentDepth;

            const treeData = await this.treeViz.loadTree(position);

            if (treeData) {
                this.treeViz.setDepthLimit(this.currentDepth);

                this.ui.updateMetrics({
                    nodesEvaluated: treeData.nodeCount,
                    nodesExpanded: this.treeViz.visibleNodes.size
                });
            }
        }
    }

    // ============================================
    // Initialize on DOM ready
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        window.minimaxApp = new MinimaxApp();
    });

})();

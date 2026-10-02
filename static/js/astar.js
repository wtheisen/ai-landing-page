/**
 * A* Pathfinding Visualizer
 * Interactive visualization of the A* search algorithm
 */

(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================

    const GRID_WIDTH = 20;
    const GRID_HEIGHT = 15;
    const CELL_EMPTY = 0;
    const CELL_WALL = 1;
    const CELL_START = 2;
    const CELL_GOAL = 3;

    // Step types for playback
    const STEP_INIT = 'INIT';
    const STEP_EXPAND = 'EXPAND';
    const STEP_NEIGHBOR_CHECK = 'NEIGHBOR_CHECK';
    const STEP_ADD_TO_OPEN = 'ADD_TO_OPEN';
    const STEP_UPDATE_PATH = 'UPDATE_PATH';
    const STEP_GOAL_FOUND = 'GOAL_FOUND';
    const STEP_NO_SOLUTION = 'NO_SOLUTION';

    // Sample puzzles
    const SAMPLE_PUZZLES = {
        easy: {
            walls: [[5,3],[5,4],[5,5],[5,6],[5,7],[5,8],[5,9],[5,10],[5,11]],
            start: [2, 7],
            goal: [17, 7]
        },
        medium: {
            walls: [
                [4,2],[4,3],[4,4],[4,5],[4,6],
                [8,8],[8,9],[8,10],[8,11],[8,12],
                [12,3],[12,4],[12,5],[12,6],[12,7],
                [15,7],[15,8],[15,9],[15,10],[15,11]
            ],
            start: [1, 7],
            goal: [18, 7]
        },
        hard: {
            walls: [
                // Vertical barriers
                [3,1],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9],[3,10],
                [7,4],[7,5],[7,6],[7,7],[7,8],[7,9],[7,10],[7,11],[7,12],[7,13],
                [11,0],[11,1],[11,2],[11,3],[11,4],[11,5],[11,6],[11,7],[11,8],[11,9],
                [15,5],[15,6],[15,7],[15,8],[15,9],[15,10],[15,11],[15,12],[15,13],[15,14]
            ],
            start: [1, 7],
            goal: [18, 7]
        },
        maze: {
            walls: [
                // Outer walls with gaps
                [2,0],[2,1],[2,2],[2,3],[2,5],[2,6],[2,7],[2,8],[2,9],[2,10],[2,11],[2,12],[2,13],[2,14],
                [4,1],[4,2],[4,3],[4,4],[4,5],[4,6],[4,8],[4,9],[4,10],[4,11],[4,12],[4,13],
                [6,0],[6,1],[6,3],[6,4],[6,5],[6,6],[6,7],[6,8],[6,9],[6,10],[6,12],[6,13],[6,14],
                [8,1],[8,2],[8,3],[8,4],[8,6],[8,7],[8,8],[8,9],[8,10],[8,11],[8,12],[8,13],
                [10,0],[10,1],[10,2],[10,4],[10,5],[10,6],[10,7],[10,8],[10,10],[10,11],[10,12],[10,13],[10,14],
                [12,1],[12,2],[12,3],[12,4],[12,5],[12,7],[12,8],[12,9],[12,10],[12,11],[12,12],[12,13],
                [14,0],[14,1],[14,2],[14,3],[14,5],[14,6],[14,7],[14,8],[14,9],[14,11],[14,12],[14,13],[14,14],
                [16,1],[16,2],[16,3],[16,4],[16,5],[16,6],[16,8],[16,9],[16,10],[16,11],[16,13]
            ],
            start: [0, 7],
            goal: [19, 7]
        },
        nosolution: {
            walls: [
                // Complete wall blocking the goal
                [14,0],[14,1],[14,2],[14,3],[14,4],[14,5],[14,6],[14,7],[14,8],[14,9],[14,10],[14,11],[14,12],[14,13],[14,14]
            ],
            start: [2, 7],
            goal: [17, 7]
        }
    };

    // Sample direct graphs (non-grid)
    const SAMPLE_GRAPHS = {
        simple: {
            name: 'Simple',
            nodes: {
                'St': { label: 'St', x: 200, y: 50, h: 7 },
                'A':  { label: 'A',  x: 100, y: 180, h: 6 },
                'B':  { label: 'B',  x: 300, y: 180, h: 4 },
                'C':  { label: 'C',  x: 300, y: 320, h: 2 },
                'Gl': { label: 'Gl', x: 100, y: 320, h: 0 }
            },
            edges: [
                { from: 'St', to: 'A', cost: 1 },
                { from: 'St', to: 'B', cost: 4 },
                { from: 'A', to: 'B', cost: 2 },
                { from: 'A', to: 'C', cost: 5 },
                { from: 'A', to: 'Gl', cost: 12 },
                { from: 'B', to: 'C', cost: 2 },
                { from: 'C', to: 'Gl', cost: 3 }
            ],
            start: 'St',
            goal: 'Gl'
        },
        trap: {
            name: 'Trap',
            nodes: {
                'St': { label: 'St', x: 280, y: 200, h: 8 },
                'A':  { label: 'A',  x: 380, y: 200, h: 3 },
                'B':  { label: 'B',  x: 180, y: 280, h: 9 },
                'C':  { label: 'C',  x: 180, y: 120, h: 9 },
                'D':  { label: 'D',  x: 100, y: 200, h: 10 },
                'E':  { label: 'E',  x: 40, y: 280, h: 11 },
                'F':  { label: 'F',  x: 40, y: 120, h: 11 },
                'G':  { label: 'G',  x: 100, y: 360, h: 12 },
                'H':  { label: 'H',  x: 280, y: 40, h: 12 },
                'Gl': { label: 'Gl', x: 480, y: 200, h: 0 }
            },
            edges: [
                // Main path through A
                { from: 'St', to: 'A', cost: 5 },
                { from: 'A', to: 'Gl', cost: 5 },
                // Trap cluster connections (all cost 1)
                { from: 'St', to: 'B', cost: 1 },
                { from: 'St', to: 'C', cost: 1 },
                { from: 'B', to: 'D', cost: 1 },
                { from: 'C', to: 'D', cost: 1 },
                { from: 'D', to: 'E', cost: 1 },
                { from: 'D', to: 'F', cost: 1 },
                { from: 'D', to: 'B', cost: 1 },
                { from: 'D', to: 'C', cost: 1 },
                { from: 'E', to: 'F', cost: 1 },
                { from: 'F', to: 'C', cost: 1 },
                { from: 'E', to: 'B', cost: 1 },
                { from: 'E', to: 'G', cost: 1 },
                { from: 'F', to: 'H', cost: 1 }
            ],
            start: 'St',
            goal: 'Gl'
        }
    };

    // ============================================
    // Direct Graph State (for non-grid graphs)
    // ============================================

    class DirectGraphState {
        constructor() {
            this.nodes = new Map(); // id -> {label, x, y, h}
            this.edges = [];        // [{from, to, cost}]
            this.start = null;      // node id
            this.goal = null;       // node id
            this.adjacencyList = new Map(); // id -> [{id, cost}]
        }

        clear() {
            this.nodes.clear();
            this.edges = [];
            this.start = null;
            this.goal = null;
            this.adjacencyList.clear();
        }

        addNode(id, label, x, y, h = 0) {
            this.nodes.set(id, { label, x, y, h });
            if (!this.adjacencyList.has(id)) {
                this.adjacencyList.set(id, []);
            }
        }

        addEdge(from, to, cost) {
            this.edges.push({ from, to, cost });
            // Update adjacency list (directed)
            if (!this.adjacencyList.has(from)) {
                this.adjacencyList.set(from, []);
            }
            this.adjacencyList.get(from).push({ id: to, cost });
        }

        setStart(nodeId) {
            this.start = nodeId;
        }

        setGoal(nodeId) {
            this.goal = nodeId;
        }

        getNode(id) {
            return this.nodes.get(id) || null;
        }

        getNeighbors(nodeId) {
            return this.adjacencyList.get(nodeId) || [];
        }

        getHeuristic(nodeId) {
            const node = this.nodes.get(nodeId);
            return node ? node.h : 0;
        }

        updateNodeHeuristic(nodeId, h) {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.h = h;
            }
        }

        clone() {
            const copy = new DirectGraphState();
            this.nodes.forEach((node, id) => {
                copy.addNode(id, node.label, node.x, node.y, node.h);
            });
            this.edges.forEach(edge => {
                copy.addEdge(edge.from, edge.to, edge.cost);
            });
            copy.start = this.start;
            copy.goal = this.goal;
            return copy;
        }

        loadSample(name) {
            this.clear();
            const sample = SAMPLE_GRAPHS[name];
            if (!sample) return;

            // Add nodes
            Object.entries(sample.nodes).forEach(([id, node]) => {
                this.addNode(id, node.label, node.x, node.y, node.h);
            });

            // Add edges
            sample.edges.forEach(edge => {
                this.addEdge(edge.from, edge.to, edge.cost);
            });

            this.start = sample.start;
            this.goal = sample.goal;
        }

        getAllNodeIds() {
            return Array.from(this.nodes.keys());
        }

        removeNode(nodeId) {
            this.nodes.delete(nodeId);
            this.adjacencyList.delete(nodeId);
            // Remove edges involving this node
            this.edges = this.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
            // Update adjacency lists of other nodes
            this.adjacencyList.forEach((neighbors, id) => {
                this.adjacencyList.set(id, neighbors.filter(n => n.id !== nodeId));
            });
            if (this.start === nodeId) this.start = null;
            if (this.goal === nodeId) this.goal = null;
        }

        removeEdge(from, to) {
            this.edges = this.edges.filter(e => !(e.from === from && e.to === to));
            if (this.adjacencyList.has(from)) {
                this.adjacencyList.set(from,
                    this.adjacencyList.get(from).filter(n => n.id !== to)
                );
            }
        }

        updateNodePosition(nodeId, x, y) {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.x = x;
                node.y = y;
            }
        }

        updateNodeHeuristic(nodeId, h) {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.h = h;
            }
        }
    }

    // ============================================
    // Priority Queue (Sorted Array - simpler, correct implementation)
    // ============================================

    class PriorityQueue {
        constructor(compareFn) {
            this.items = [];
            this.compare = compareFn || ((a, b) => a.f - b.f);
            this.nodeMap = new Map(); // key -> item for quick lookup
        }

        push(item) {
            const key = this._key(item);
            this.nodeMap.set(key, item);
            this.items.push(item);
            // Keep sorted by inserting in correct position
            this._sort();
        }

        pop() {
            if (this.items.length === 0) return null;
            const min = this.items.shift(); // Remove first (smallest) element
            this.nodeMap.delete(this._key(min));
            return min;
        }

        contains(x, y) {
            return this.nodeMap.has(`${x},${y}`);
        }

        get(x, y) {
            return this.nodeMap.get(`${x},${y}`) || null;
        }

        updatePriority(item) {
            const key = this._key(item);
            if (!this.nodeMap.has(key)) return;

            // Update in map
            this.nodeMap.set(key, item);

            // Find and update in array
            const idx = this.items.findIndex(n => this._key(n) === key);
            if (idx !== -1) {
                this.items[idx] = item;
                this._sort();
            }
        }

        isEmpty() {
            return this.items.length === 0;
        }

        size() {
            return this.items.length;
        }

        toArray() {
            return [...this.items]; // Already sorted
        }

        _key(item) {
            return `${item.x},${item.y}`;
        }

        _sort() {
            this.items.sort(this.compare);
        }
    }

    // ============================================
    // Grid State
    // ============================================

    class GridState {
        constructor(width = GRID_WIDTH, height = GRID_HEIGHT) {
            this.width = width;
            this.height = height;
            this.cells = [];
            this.start = null;
            this.goal = null;
            this.clear();
        }

        clear() {
            this.cells = [];
            for (let y = 0; y < this.height; y++) {
                this.cells[y] = [];
                for (let x = 0; x < this.width; x++) {
                    this.cells[y][x] = CELL_EMPTY;
                }
            }
            this.start = null;
            this.goal = null;
        }

        setCell(x, y, type) {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

            // Handle special cells
            if (type === CELL_START) {
                if (this.start) {
                    this.cells[this.start.y][this.start.x] = CELL_EMPTY;
                }
                this.start = { x, y };
            } else if (type === CELL_GOAL) {
                if (this.goal) {
                    this.cells[this.goal.y][this.goal.x] = CELL_EMPTY;
                }
                this.goal = { x, y };
            }

            // Clear old start/goal if overwriting
            if (this.start && this.start.x === x && this.start.y === y && type !== CELL_START) {
                this.start = null;
            }
            if (this.goal && this.goal.x === x && this.goal.y === y && type !== CELL_GOAL) {
                this.goal = null;
            }

            this.cells[y][x] = type;
        }

        getCell(x, y) {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return CELL_WALL;
            return this.cells[y][x];
        }

        isWalkable(x, y) {
            return this.getCell(x, y) !== CELL_WALL;
        }

        getNeighbors(x, y, allowDiagonal = false) {
            const neighbors = [];
            const dirs = [
                { dx: 0, dy: -1, cost: 1 },  // up
                { dx: 1, dy: 0, cost: 1 },   // right
                { dx: 0, dy: 1, cost: 1 },   // down
                { dx: -1, dy: 0, cost: 1 }   // left
            ];

            if (allowDiagonal) {
                dirs.push(
                    { dx: 1, dy: -1, cost: Math.SQRT2 },  // up-right
                    { dx: 1, dy: 1, cost: Math.SQRT2 },   // down-right
                    { dx: -1, dy: 1, cost: Math.SQRT2 }, // down-left
                    { dx: -1, dy: -1, cost: Math.SQRT2 } // up-left
                );
            }

            for (const dir of dirs) {
                const nx = x + dir.dx;
                const ny = y + dir.dy;
                if (this.isWalkable(nx, ny)) {
                    // For diagonal, check that we can actually cut the corner
                    if (Math.abs(dir.dx) + Math.abs(dir.dy) === 2) {
                        if (!this.isWalkable(x + dir.dx, y) || !this.isWalkable(x, y + dir.dy)) {
                            continue; // Can't cut corner
                        }
                    }
                    neighbors.push({ x: nx, y: ny, cost: dir.cost });
                }
            }

            return neighbors;
        }

        clone() {
            const copy = new GridState(this.width, this.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    copy.cells[y][x] = this.cells[y][x];
                }
            }
            copy.start = this.start ? { ...this.start } : null;
            copy.goal = this.goal ? { ...this.goal } : null;
            return copy;
        }

        loadSample(name) {
            this.clear();
            const sample = SAMPLE_PUZZLES[name];
            if (!sample) return;

            for (const [x, y] of sample.walls) {
                this.setCell(x, y, CELL_WALL);
            }
            this.setCell(sample.start[0], sample.start[1], CELL_START);
            this.setCell(sample.goal[0], sample.goal[1], CELL_GOAL);
        }
    }

    // ============================================
    // A* Solver
    // ============================================

    class AStarSolver {
        constructor() {
            this.heuristics = {
                manhattan: (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2),
                euclidean: (x1, y1, x2, y2) => Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2),
                chebyshev: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
                dijkstra: () => 0
            };
        }

        solve(grid, options = {}) {
            const {
                heuristic = 'manhattan',
                allowDiagonal = false,
                tiebreaker = 'none',
                weight = 1.0
            } = options;

            const hFunc = this.heuristics[heuristic] || this.heuristics.manhattan;
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!grid.start || !grid.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const { x: sx, y: sy } = grid.start;
            const { x: gx, y: gy } = grid.goal;

            // Create comparator with tie-breaker
            const compareFn = (a, b) => {
                if (a.f !== b.f) return a.f - b.f;
                if (tiebreaker === 'highg') return b.g - a.g; // Prefer higher g
                if (tiebreaker === 'lowg') return a.g - b.g;  // Prefer lower g
                return 0;
            };

            const openSet = new PriorityQueue(compareFn);
            const closedSet = new Map();
            const cameFrom = new Map();
            const gScore = new Map();
            const fScore = new Map();

            const key = (x, y) => `${x},${y}`;

            // Initialize start node
            const startH = hFunc(sx, sy, gx, gy) * weight;
            gScore.set(key(sx, sy), 0);
            fScore.set(key(sx, sy), startH);
            openSet.push({ x: sx, y: sy, g: 0, h: startH, f: startH });
            metrics.nodesGenerated++;

            // Record initial state
            steps.push({
                type: STEP_INIT,
                openList: [{ x: sx, y: sy, g: 0, h: startH, f: startH }],
                closedList: [],
                current: null,
                message: `Starting A* from (${sx},${sy}) to (${gx},${gy})`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null }
            });

            while (!openSet.isEmpty()) {
                const current = openSet.pop();
                const { x: cx, y: cy, g: cg, h: ch, f: cf } = current;
                const currentKey = key(cx, cy);

                // Skip if already in closed set (might have duplicate entries)
                if (closedSet.has(currentKey)) continue;

                // Add to closed set
                closedSet.set(currentKey, { x: cx, y: cy, g: cg, h: ch, f: cf });
                metrics.nodesExpanded++;

                // Record expansion
                steps.push({
                    type: STEP_EXPAND,
                    current: { x: cx, y: cy, g: cg, h: ch, f: cf },
                    openList: openSet.toArray().map(n => ({ x: n.x, y: n.y, g: n.g, h: n.h, f: n.f })),
                    closedList: Array.from(closedSet.values()),
                    message: `Expanding (${cx},${cy}) with f=${cf.toFixed(2)}, g=${cg.toFixed(2)}, h=${ch.toFixed(2)}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                });

                // Check if goal reached
                if (cx === gx && cy === gy) {
                    const path = this._reconstructPath(cameFrom, cx, cy);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: openSet.toArray().map(n => ({ x: n.x, y: n.y, g: n.g, h: n.h, f: n.f })),
                        closedList: Array.from(closedSet.values()),
                        message: `Goal found! Path length: ${path.length}, cost: ${cg.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg }
                    });

                    return { success: true, path, steps, metrics };
                }

                // Explore neighbors
                const neighbors = grid.getNeighbors(cx, cy, allowDiagonal);
                for (const neighbor of neighbors) {
                    const { x: nx, y: ny, cost } = neighbor;
                    const neighborKey = key(nx, ny);

                    // Skip if in closed set
                    if (closedSet.has(neighborKey)) continue;

                    const tentativeG = cg + cost;
                    const existingG = gScore.get(neighborKey);

                    // Record neighbor check
                    steps.push({
                        type: STEP_NEIGHBOR_CHECK,
                        current: { x: cx, y: cy, g: cg, h: ch, f: cf },
                        neighbor: { x: nx, y: ny },
                        tentativeG: tentativeG,
                        existingG: existingG !== undefined ? existingG : null,
                        openList: openSet.toArray().map(n => ({ x: n.x, y: n.y, g: n.g, h: n.h, f: n.f })),
                        closedList: Array.from(closedSet.values()),
                        message: `Checking neighbor (${nx},${ny}): tentative g=${tentativeG.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                    });

                    if (existingG === undefined || tentativeG < existingG) {
                        // This path is better
                        const nh = hFunc(nx, ny, gx, gy) * weight;
                        const nf = tentativeG + nh;

                        cameFrom.set(neighborKey, { x: cx, y: cy });
                        gScore.set(neighborKey, tentativeG);
                        fScore.set(neighborKey, nf);

                        const newNode = { x: nx, y: ny, g: tentativeG, h: nh, f: nf };

                        if (existingG !== undefined) {
                            // Update existing node
                            openSet.updatePriority(newNode);
                            steps.push({
                                type: STEP_UPDATE_PATH,
                                node: newNode,
                                openList: openSet.toArray().map(n => ({ x: n.x, y: n.y, g: n.g, h: n.h, f: n.f })),
                                closedList: Array.from(closedSet.values()),
                                message: `Updated (${nx},${ny}): new g=${tentativeG.toFixed(2)}, f=${nf.toFixed(2)}`,
                                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                            });
                        } else {
                            // Add new node
                            openSet.push(newNode);
                            metrics.nodesGenerated++;
                            steps.push({
                                type: STEP_ADD_TO_OPEN,
                                node: newNode,
                                openList: openSet.toArray().map(n => ({ x: n.x, y: n.y, g: n.g, h: n.h, f: n.f })),
                                closedList: Array.from(closedSet.values()),
                                message: `Added (${nx},${ny}) to open: f=${nf.toFixed(2)}, g=${tentativeG.toFixed(2)}, h=${nh.toFixed(2)}`,
                                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                            });
                        }
                    }
                }
            }

            // No solution found
            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: Array.from(closedSet.values()),
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
            });

            return { success: false, path: [], steps, metrics };
        }

        _reconstructPath(cameFrom, x, y) {
            const path = [{ x, y }];
            let current = `${x},${y}`;

            while (cameFrom.has(current)) {
                const prev = cameFrom.get(current);
                path.unshift(prev);
                current = `${prev.x},${prev.y}`;
            }

            return path;
        }

        solveBFS(grid, options = {}) {
            const { allowDiagonal = false } = options;
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!grid.start || !grid.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const { x: sx, y: sy } = grid.start;
            const { x: gx, y: gy } = grid.goal;
            const key = (x, y) => `${x},${y}`;

            const queue = [{ x: sx, y: sy, g: 0 }];
            const visited = new Map();
            const cameFrom = new Map();

            visited.set(key(sx, sy), { x: sx, y: sy, g: 0, h: 0, f: 0 });
            metrics.nodesGenerated++;

            steps.push({
                type: STEP_INIT,
                openList: [{ x: sx, y: sy, g: 0, h: 0, f: 0 }],
                closedList: [],
                current: null,
                message: `Starting BFS from (${sx},${sy}) to (${gx},${gy})`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null }
            });

            const closedList = [];

            while (queue.length > 0) {
                const current = queue.shift();
                const { x: cx, y: cy, g: cg } = current;
                const currentKey = key(cx, cy);

                metrics.nodesExpanded++;
                closedList.push({ x: cx, y: cy, g: cg, h: 0, f: cg });

                steps.push({
                    type: STEP_EXPAND,
                    current: { x: cx, y: cy, g: cg, h: 0, f: cg },
                    openList: queue.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                    closedList: [...closedList],
                    message: `Expanding (${cx},${cy}) at depth ${cg}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                });

                if (cx === gx && cy === gy) {
                    const path = this._reconstructPath(cameFrom, cx, cy);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: queue.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                        closedList: [...closedList],
                        message: `Goal found! Path length: ${path.length}, cost: ${cg}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg }
                    });

                    return { success: true, path, steps, metrics };
                }

                const neighbors = grid.getNeighbors(cx, cy, allowDiagonal);
                for (const neighbor of neighbors) {
                    const { x: nx, y: ny, cost } = neighbor;
                    const neighborKey = key(nx, ny);

                    if (!visited.has(neighborKey)) {
                        const ng = cg + cost;
                        visited.set(neighborKey, { x: nx, y: ny, g: ng, h: 0, f: ng });
                        cameFrom.set(neighborKey, { x: cx, y: cy });
                        queue.push({ x: nx, y: ny, g: ng });
                        metrics.nodesGenerated++;

                        steps.push({
                            type: STEP_ADD_TO_OPEN,
                            node: { x: nx, y: ny, g: ng, h: 0, f: ng },
                            openList: queue.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                            closedList: [...closedList],
                            message: `Added (${nx},${ny}) to queue at depth ${ng}`,
                            metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                        });
                    }
                }
            }

            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: [...closedList],
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
            });

            return { success: false, path: [], steps, metrics };
        }

        solveDFS(grid, options = {}) {
            const { allowDiagonal = false } = options;
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!grid.start || !grid.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const { x: sx, y: sy } = grid.start;
            const { x: gx, y: gy } = grid.goal;
            const key = (x, y) => `${x},${y}`;

            const stack = [{ x: sx, y: sy, g: 0 }];
            const visited = new Set();
            const cameFrom = new Map();

            metrics.nodesGenerated++;

            steps.push({
                type: STEP_INIT,
                openList: [{ x: sx, y: sy, g: 0, h: 0, f: 0 }],
                closedList: [],
                current: null,
                message: `Starting DFS from (${sx},${sy}) to (${gx},${gy})`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null }
            });

            const closedList = [];

            while (stack.length > 0) {
                const current = stack.pop();
                const { x: cx, y: cy, g: cg } = current;
                const currentKey = key(cx, cy);

                if (visited.has(currentKey)) continue;
                visited.add(currentKey);

                metrics.nodesExpanded++;
                closedList.push({ x: cx, y: cy, g: cg, h: 0, f: cg });

                steps.push({
                    type: STEP_EXPAND,
                    current: { x: cx, y: cy, g: cg, h: 0, f: cg },
                    openList: stack.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                    closedList: [...closedList],
                    message: `Expanding (${cx},${cy}) at depth ${cg}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                });

                if (cx === gx && cy === gy) {
                    const path = this._reconstructPath(cameFrom, cx, cy);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: stack.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                        closedList: [...closedList],
                        message: `Goal found! Path length: ${path.length}, cost: ${cg.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg }
                    });

                    return { success: true, path, steps, metrics };
                }

                const neighbors = grid.getNeighbors(cx, cy, allowDiagonal);
                // Reverse to maintain consistent ordering when popping from stack
                for (const neighbor of neighbors.reverse()) {
                    const { x: nx, y: ny, cost } = neighbor;
                    const neighborKey = key(nx, ny);

                    if (!visited.has(neighborKey)) {
                        const ng = cg + cost;
                        cameFrom.set(neighborKey, { x: cx, y: cy });
                        stack.push({ x: nx, y: ny, g: ng });
                        metrics.nodesGenerated++;

                        steps.push({
                            type: STEP_ADD_TO_OPEN,
                            node: { x: nx, y: ny, g: ng, h: 0, f: ng },
                            openList: stack.map(n => ({ x: n.x, y: n.y, g: n.g, h: 0, f: n.g })),
                            closedList: [...closedList],
                            message: `Added (${nx},${ny}) to stack`,
                            metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
                        });
                    }
                }
            }

            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: [...closedList],
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null }
            });

            return { success: false, path: [], steps, metrics };
        }

        // ============================================
        // Graph Solver Methods (for DirectGraphState)
        // ============================================

        solveGraph(graph, options = {}) {
            const { tiebreaker = 'none', weight = 1.0 } = options;
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!graph.start || !graph.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const startId = graph.start;
            const goalId = graph.goal;

            // Create comparator with tie-breaker
            const compareFn = (a, b) => {
                if (a.f !== b.f) return a.f - b.f;
                if (tiebreaker === 'highg') return b.g - a.g;
                if (tiebreaker === 'lowg') return a.g - b.g;
                return 0;
            };

            const openSet = new PriorityQueue(compareFn);
            // Override _key for graph nodes (use id instead of x,y)
            openSet._key = (item) => item.id;

            const closedSet = new Map();
            const cameFrom = new Map();
            const gScore = new Map();
            const fScore = new Map();

            // Initialize start node
            const startH = graph.getHeuristic(startId) * weight;
            gScore.set(startId, 0);
            fScore.set(startId, startH);
            openSet.push({ id: startId, g: 0, h: startH, f: startH });
            metrics.nodesGenerated++;

            // Record initial state
            steps.push({
                type: STEP_INIT,
                openList: [{ id: startId, g: 0, h: startH, f: startH }],
                closedList: [],
                current: null,
                message: `Starting A* from ${startId} to ${goalId}`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null },
                isGraph: true
            });

            while (!openSet.isEmpty()) {
                const current = openSet.pop();
                const { id: cId, g: cg, h: ch, f: cf } = current;

                // Skip if already in closed set
                if (closedSet.has(cId)) continue;

                // Add to closed set
                closedSet.set(cId, { id: cId, g: cg, h: ch, f: cf });
                metrics.nodesExpanded++;

                // Record expansion
                steps.push({
                    type: STEP_EXPAND,
                    current: { id: cId, g: cg, h: ch, f: cf },
                    openList: openSet.toArray().map(n => ({ id: n.id, g: n.g, h: n.h, f: n.f })),
                    closedList: Array.from(closedSet.values()),
                    message: `Expanding ${cId} with f=${cf.toFixed(2)}, g=${cg.toFixed(2)}, h=${ch.toFixed(2)}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                    isGraph: true
                });

                // Check if goal reached
                if (cId === goalId) {
                    const path = this._reconstructGraphPath(cameFrom, cId);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: openSet.toArray().map(n => ({ id: n.id, g: n.g, h: n.h, f: n.f })),
                        closedList: Array.from(closedSet.values()),
                        message: `Goal found! Path length: ${path.length}, cost: ${cg.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg },
                        isGraph: true
                    });

                    return { success: true, path, steps, metrics };
                }

                // Explore neighbors
                const neighbors = graph.getNeighbors(cId);
                for (const neighbor of neighbors) {
                    const { id: nId, cost } = neighbor;

                    // Skip if in closed set
                    if (closedSet.has(nId)) continue;

                    const tentativeG = cg + cost;
                    const existingG = gScore.get(nId);

                    // Record neighbor check
                    steps.push({
                        type: STEP_NEIGHBOR_CHECK,
                        current: { id: cId, g: cg, h: ch, f: cf },
                        neighbor: { id: nId },
                        tentativeG: tentativeG,
                        existingG: existingG !== undefined ? existingG : null,
                        openList: openSet.toArray().map(n => ({ id: n.id, g: n.g, h: n.h, f: n.f })),
                        closedList: Array.from(closedSet.values()),
                        message: `Checking neighbor ${nId}: tentative g=${tentativeG.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                        isGraph: true
                    });

                    if (existingG === undefined || tentativeG < existingG) {
                        const nh = graph.getHeuristic(nId) * weight;
                        const nf = tentativeG + nh;

                        cameFrom.set(nId, cId);
                        gScore.set(nId, tentativeG);
                        fScore.set(nId, nf);

                        const newNode = { id: nId, g: tentativeG, h: nh, f: nf };

                        if (existingG !== undefined) {
                            openSet.updatePriority(newNode);
                            steps.push({
                                type: STEP_UPDATE_PATH,
                                node: newNode,
                                openList: openSet.toArray().map(n => ({ id: n.id, g: n.g, h: n.h, f: n.f })),
                                closedList: Array.from(closedSet.values()),
                                message: `Updated ${nId}: new g=${tentativeG.toFixed(2)}, f=${nf.toFixed(2)}`,
                                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                                isGraph: true
                            });
                        } else {
                            openSet.push(newNode);
                            metrics.nodesGenerated++;
                            steps.push({
                                type: STEP_ADD_TO_OPEN,
                                node: newNode,
                                openList: openSet.toArray().map(n => ({ id: n.id, g: n.g, h: n.h, f: n.f })),
                                closedList: Array.from(closedSet.values()),
                                message: `Added ${nId} to open: f=${nf.toFixed(2)}, g=${tentativeG.toFixed(2)}, h=${nh.toFixed(2)}`,
                                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                                isGraph: true
                            });
                        }
                    }
                }
            }

            // No solution found
            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: Array.from(closedSet.values()),
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                isGraph: true
            });

            return { success: false, path: [], steps, metrics };
        }

        solveGraphBFS(graph) {
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!graph.start || !graph.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const startId = graph.start;
            const goalId = graph.goal;

            const queue = [{ id: startId, g: 0 }];
            const visited = new Map();
            const cameFrom = new Map();

            visited.set(startId, { id: startId, g: 0, h: 0, f: 0 });
            metrics.nodesGenerated++;

            steps.push({
                type: STEP_INIT,
                openList: [{ id: startId, g: 0, h: 0, f: 0 }],
                closedList: [],
                current: null,
                message: `Starting BFS from ${startId} to ${goalId}`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null },
                isGraph: true
            });

            const closedList = [];

            while (queue.length > 0) {
                const current = queue.shift();
                const { id: cId, g: cg } = current;

                metrics.nodesExpanded++;
                closedList.push({ id: cId, g: cg, h: 0, f: cg });

                steps.push({
                    type: STEP_EXPAND,
                    current: { id: cId, g: cg, h: 0, f: cg },
                    openList: queue.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                    closedList: [...closedList],
                    message: `Expanding ${cId} at depth ${cg}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                    isGraph: true
                });

                if (cId === goalId) {
                    const path = this._reconstructGraphPath(cameFrom, cId);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: queue.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                        closedList: [...closedList],
                        message: `Goal found! Path length: ${path.length}, cost: ${cg}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg },
                        isGraph: true
                    });

                    return { success: true, path, steps, metrics };
                }

                const neighbors = graph.getNeighbors(cId);
                for (const neighbor of neighbors) {
                    const { id: nId, cost } = neighbor;

                    if (!visited.has(nId)) {
                        const ng = cg + cost;
                        visited.set(nId, { id: nId, g: ng, h: 0, f: ng });
                        cameFrom.set(nId, cId);
                        queue.push({ id: nId, g: ng });
                        metrics.nodesGenerated++;

                        steps.push({
                            type: STEP_ADD_TO_OPEN,
                            node: { id: nId, g: ng, h: 0, f: ng },
                            openList: queue.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                            closedList: [...closedList],
                            message: `Added ${nId} to queue at depth ${ng}`,
                            metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                            isGraph: true
                        });
                    }
                }
            }

            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: [...closedList],
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                isGraph: true
            });

            return { success: false, path: [], steps, metrics };
        }

        solveGraphDFS(graph) {
            const startTime = performance.now();
            const steps = [];
            const metrics = {
                nodesExpanded: 0,
                nodesGenerated: 0,
                pathLength: 0,
                pathCost: 0,
                time: 0
            };

            if (!graph.start || !graph.goal) {
                return { success: false, path: [], steps, metrics, error: 'Missing start or goal' };
            }

            const startId = graph.start;
            const goalId = graph.goal;

            const stack = [{ id: startId, g: 0 }];
            const visited = new Set();
            const cameFrom = new Map();

            metrics.nodesGenerated++;

            steps.push({
                type: STEP_INIT,
                openList: [{ id: startId, g: 0, h: 0, f: 0 }],
                closedList: [],
                current: null,
                message: `Starting DFS from ${startId} to ${goalId}`,
                metrics: { nodesExpanded: 0, nodesGenerated: 1, pathLength: null, pathCost: null },
                isGraph: true
            });

            const closedList = [];

            while (stack.length > 0) {
                const current = stack.pop();
                const { id: cId, g: cg } = current;

                if (visited.has(cId)) continue;
                visited.add(cId);

                metrics.nodesExpanded++;
                closedList.push({ id: cId, g: cg, h: 0, f: cg });

                steps.push({
                    type: STEP_EXPAND,
                    current: { id: cId, g: cg, h: 0, f: cg },
                    openList: stack.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                    closedList: [...closedList],
                    message: `Expanding ${cId} at depth ${cg}`,
                    metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                    isGraph: true
                });

                if (cId === goalId) {
                    const path = this._reconstructGraphPath(cameFrom, cId);
                    metrics.pathLength = path.length;
                    metrics.pathCost = cg;
                    metrics.time = performance.now() - startTime;

                    steps.push({
                        type: STEP_GOAL_FOUND,
                        path: path,
                        openList: stack.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                        closedList: [...closedList],
                        message: `Goal found! Path length: ${path.length}, cost: ${cg.toFixed(2)}`,
                        metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: path.length, pathCost: cg },
                        isGraph: true
                    });

                    return { success: true, path, steps, metrics };
                }

                const neighbors = graph.getNeighbors(cId);
                // Reverse to maintain consistent ordering when popping from stack
                for (const neighbor of [...neighbors].reverse()) {
                    const { id: nId, cost } = neighbor;

                    if (!visited.has(nId)) {
                        const ng = cg + cost;
                        cameFrom.set(nId, cId);
                        stack.push({ id: nId, g: ng });
                        metrics.nodesGenerated++;

                        steps.push({
                            type: STEP_ADD_TO_OPEN,
                            node: { id: nId, g: ng, h: 0, f: ng },
                            openList: stack.map(n => ({ id: n.id, g: n.g, h: 0, f: n.g })),
                            closedList: [...closedList],
                            message: `Added ${nId} to stack`,
                            metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                            isGraph: true
                        });
                    }
                }
            }

            metrics.time = performance.now() - startTime;
            steps.push({
                type: STEP_NO_SOLUTION,
                openList: [],
                closedList: [...closedList],
                message: 'No path found - goal is unreachable',
                metrics: { nodesExpanded: metrics.nodesExpanded, nodesGenerated: metrics.nodesGenerated, pathLength: null, pathCost: null },
                isGraph: true
            });

            return { success: false, path: [], steps, metrics };
        }

        solveGraphDijkstra(graph, options = {}) {
            // Dijkstra is A* with h=0 for all nodes
            // For graphs, we override the heuristic to always return 0
            const originalGetHeuristic = graph.getHeuristic.bind(graph);
            graph.getHeuristic = () => 0;
            const result = this.solveGraph(graph, { ...options, weight: 1.0 });
            graph.getHeuristic = originalGetHeuristic;
            return result;
        }

        _reconstructGraphPath(cameFrom, nodeId) {
            const path = [{ id: nodeId }];
            let current = nodeId;

            while (cameFrom.has(current)) {
                const prev = cameFrom.get(current);
                path.unshift({ id: prev });
                current = prev;
            }

            return path;
        }
    }

    // ============================================
    // UI Controller
    // ============================================

    class UIController {
        constructor(grid) {
            this.grid = grid;
            this.editMode = 'wall';
            this.isDrawing = false;
            this.showValues = false;
            this.nodeValues = new Map(); // Store f/g/h values for cells
            this.currentHeuristic = 'manhattan';
            this.cellSize = 28; // Default cell size, updated on init
            this.gridGap = 1;
            this.editingEnabled = false; // Start with editing disabled
            this.simulationRunning = false;
            this.initGrid();
            this.initEventListeners();
        }

        initGrid() {
            const container = document.getElementById('pathfinding-grid');
            if (!container) return;

            container.innerHTML = '';

            // Add corner spacer
            const corner = document.createElement('div');
            corner.className = 'grid-label grid-corner';
            container.appendChild(corner);

            // Add column headers (x coordinates)
            for (let x = 0; x < this.grid.width; x++) {
                const label = document.createElement('div');
                label.className = 'grid-label grid-col-label';
                label.textContent = x;
                container.appendChild(label);
            }

            // Add rows with row labels
            for (let y = 0; y < this.grid.height; y++) {
                // Row label (y coordinate)
                const rowLabel = document.createElement('div');
                rowLabel.className = 'grid-label grid-row-label';
                rowLabel.textContent = y;
                container.appendChild(rowLabel);

                // Grid cells for this row
                for (let x = 0; x < this.grid.width; x++) {
                    const cell = document.createElement('div');
                    cell.className = 'grid-cell';
                    cell.dataset.x = x;
                    cell.dataset.y = y;

                    // Add value display elements
                    const values = document.createElement('div');
                    values.className = 'cell-values';
                    values.innerHTML = `
                        <span class="f-value"></span>
                        <span class="g-value"></span>
                        <span class="h-value"></span>
                    `;
                    cell.appendChild(values);

                    container.appendChild(cell);
                }
            }

            this.renderGrid();
        }

        initEventListeners() {
            const container = document.getElementById('pathfinding-grid');
            if (!container) return;

            // Mouse events for drawing
            container.addEventListener('mousedown', (e) => {
                if (!this.editingEnabled || this.simulationRunning) return;
                if (e.target.classList.contains('grid-cell') || e.target.closest('.grid-cell')) {
                    this.isDrawing = true;
                    this.handleCellClick(e);
                }
            });

            container.addEventListener('mousemove', (e) => {
                if (!this.editingEnabled || this.simulationRunning) return;
                if (this.isDrawing) {
                    this.handleCellClick(e);
                }
            });

            document.addEventListener('mouseup', () => {
                this.isDrawing = false;
            });

            // Edit mode buttons
            document.querySelectorAll('.edit-mode-buttons .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (!this.editingEnabled || this.simulationRunning) return;
                    document.querySelectorAll('.edit-mode-buttons .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.editMode = btn.dataset.mode;
                });
            });

            // Clear grid button
            document.getElementById('btn-clear-grid')?.addEventListener('click', () => {
                if (!this.editingEnabled || this.simulationRunning) return;
                this.grid.clear();
                this.nodeValues.clear();
                this.renderGrid();
            });

            // Show values checkbox
            document.getElementById('show-values')?.addEventListener('change', (e) => {
                this.showValues = e.target.checked;
                this.renderGrid();
            });
        }

        handleCellClick(e) {
            const cell = e.target.classList.contains('grid-cell') ? e.target : e.target.closest('.grid-cell');
            if (!cell) return;

            const x = parseInt(cell.dataset.x);
            const y = parseInt(cell.dataset.y);

            switch (this.editMode) {
                case 'wall':
                    if (this.grid.getCell(x, y) === CELL_EMPTY) {
                        this.grid.setCell(x, y, CELL_WALL);
                    }
                    break;
                case 'start':
                    this.grid.setCell(x, y, CELL_START);
                    break;
                case 'goal':
                    this.grid.setCell(x, y, CELL_GOAL);
                    break;
                case 'erase':
                    this.grid.setCell(x, y, CELL_EMPTY);
                    break;
            }

            this.renderGrid();
        }

        renderGrid() {
            const container = document.getElementById('pathfinding-grid');
            if (!container) return;

            const cells = container.querySelectorAll('.grid-cell');
            cells.forEach(cell => {
                const x = parseInt(cell.dataset.x);
                const y = parseInt(cell.dataset.y);
                const type = this.grid.getCell(x, y);

                // Reset classes
                cell.className = 'grid-cell';
                if (this.showValues) cell.classList.add('show-values');

                // Set type class
                switch (type) {
                    case CELL_WALL:
                        cell.classList.add('wall');
                        break;
                    case CELL_START:
                        cell.classList.add('start');
                        break;
                    case CELL_GOAL:
                        cell.classList.add('goal');
                        break;
                }

                // Update values display
                const key = `${x},${y}`;
                const values = this.nodeValues.get(key);
                const fSpan = cell.querySelector('.f-value');
                const gSpan = cell.querySelector('.g-value');
                const hSpan = cell.querySelector('.h-value');

                if (values && type !== CELL_WALL && type !== CELL_START && type !== CELL_GOAL) {
                    fSpan.textContent = values.f.toFixed(1);
                    gSpan.textContent = values.g.toFixed(1);
                    hSpan.textContent = values.h.toFixed(1);
                } else {
                    fSpan.textContent = '';
                    gSpan.textContent = '';
                    hSpan.textContent = '';
                }
            });
        }

        renderStep(step, path = [], goal = null) {
            const container = document.getElementById('pathfinding-grid');
            if (!container) return;

            // First reset to base grid state
            this.nodeValues.clear();

            // Clear heuristic line by default
            this.clearHeuristicLine();

            const cells = container.querySelectorAll('.grid-cell');
            cells.forEach(cell => {
                const x = parseInt(cell.dataset.x);
                const y = parseInt(cell.dataset.y);
                const type = this.grid.getCell(x, y);

                // Reset classes
                cell.className = 'grid-cell';
                if (this.showValues) cell.classList.add('show-values');

                // Set type class
                switch (type) {
                    case CELL_WALL:
                        cell.classList.add('wall');
                        break;
                    case CELL_START:
                        cell.classList.add('start');
                        break;
                    case CELL_GOAL:
                        cell.classList.add('goal');
                        break;
                }
            });

            // Apply step state
            if (step) {
                // Closed list
                if (step.closedList) {
                    for (const node of step.closedList) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                            cell.classList.add('closed');
                        }
                        this.nodeValues.set(`${node.x},${node.y}`, { f: node.f, g: node.g, h: node.h });
                    }
                }

                // Open list
                if (step.openList) {
                    for (const node of step.openList) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal') && !cell.classList.contains('closed')) {
                            cell.classList.add('open');
                        }
                        this.nodeValues.set(`${node.x},${node.y}`, { f: node.f, g: node.g, h: node.h });
                    }
                }

                // Current node
                if (step.current) {
                    const cell = container.querySelector(`[data-x="${step.current.x}"][data-y="${step.current.y}"]`);
                    if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                        cell.classList.remove('open', 'closed');
                        cell.classList.add('current');
                    }
                }

                // Neighbor being checked
                if (step.neighbor && step.type === STEP_NEIGHBOR_CHECK) {
                    const cell = container.querySelector(`[data-x="${step.neighbor.x}"][data-y="${step.neighbor.y}"]`);
                    if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                        cell.classList.add('neighbor');
                    }
                }

                // Path (for goal found)
                if (step.path) {
                    for (const node of step.path) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                            cell.classList.remove('open', 'closed', 'current');
                            cell.classList.add('path');
                        }
                    }
                }

                // Draw heuristic line from current node to goal (only for algorithms that use a heuristic)
                const noHeuristicAlgorithms = ['bfs', 'dfs', 'dijkstra'];
                if (step.current && goal && step.type !== STEP_GOAL_FOUND && step.type !== STEP_NO_SOLUTION && !noHeuristicAlgorithms.includes(this.currentHeuristic)) {
                    this.drawHeuristicLine(step.current, goal, step.current.h);
                }
            }

            // Render values
            this.renderGrid();

            // Re-apply visualization classes after renderGrid
            if (step) {
                if (step.closedList) {
                    for (const node of step.closedList) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal') && !cell.classList.contains('wall')) {
                            cell.classList.add('closed');
                        }
                    }
                }
                if (step.openList) {
                    for (const node of step.openList) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal') && !cell.classList.contains('wall') && !cell.classList.contains('closed')) {
                            cell.classList.add('open');
                        }
                    }
                }
                if (step.current) {
                    const cell = container.querySelector(`[data-x="${step.current.x}"][data-y="${step.current.y}"]`);
                    if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                        cell.classList.remove('open', 'closed');
                        cell.classList.add('current');
                    }
                }
                if (step.path) {
                    for (const node of step.path) {
                        const cell = container.querySelector(`[data-x="${node.x}"][data-y="${node.y}"]`);
                        if (cell && !cell.classList.contains('start') && !cell.classList.contains('goal')) {
                            cell.classList.remove('open', 'closed', 'current');
                            cell.classList.add('path');
                        }
                    }
                    // Draw path line
                    this.drawPathLine(step.path);
                }
            }
        }

        updateMetrics(metrics) {
            document.getElementById('metric-expanded').textContent = metrics.nodesExpanded ?? 0;
            document.getElementById('metric-generated').textContent = metrics.nodesGenerated ?? 0;
            document.getElementById('metric-path-length').textContent = metrics.pathLength !== null && metrics.pathLength !== undefined ? metrics.pathLength : '-';
            document.getElementById('metric-path-cost').textContent = metrics.pathCost !== null && metrics.pathCost !== undefined ? metrics.pathCost.toFixed(2) : '-';
            document.getElementById('metric-time').textContent = metrics.time ? metrics.time.toFixed(2) + 'ms' : '-';
        }

        updateLists(openList, closedList, goal = null) {
            const openContainer = document.getElementById('open-list');
            const closedContainer = document.getElementById('closed-list');
            const openCount = document.getElementById('open-count');
            const closedCount = document.getElementById('closed-count');

            if (openContainer) {
                if (openList && openList.length > 0) {
                    openContainer.innerHTML = openList.map(n =>
                        `<span class="node-list-item" data-x="${n.x}" data-y="${n.y}" data-h="${n.h}">(${n.x},${n.y}) f=${n.f.toFixed(1)}</span>`
                    ).join('');
                } else {
                    openContainer.innerHTML = '<div class="list-empty">No nodes</div>';
                }
            }

            if (closedContainer) {
                if (closedList && closedList.length > 0) {
                    closedContainer.innerHTML = closedList.map(n =>
                        `<span class="node-list-item" data-x="${n.x}" data-y="${n.y}" data-h="${n.h}">(${n.x},${n.y})</span>`
                    ).join('');
                } else {
                    closedContainer.innerHTML = '<div class="list-empty">No nodes</div>';
                }
            }

            if (openCount) openCount.textContent = openList ? openList.length : 0;
            if (closedCount) closedCount.textContent = closedList ? closedList.length : 0;

            // Add hover listeners for highlighting
            this.setupListHoverListeners(goal);
        }

        setupListHoverListeners(goal) {
            const listItems = document.querySelectorAll('.node-list-item');
            const gridContainer = document.getElementById('pathfinding-grid');

            listItems.forEach(item => {
                item.addEventListener('mouseenter', () => {
                    const x = parseInt(item.dataset.x);
                    const y = parseInt(item.dataset.y);
                    const h = parseFloat(item.dataset.h);

                    // Highlight the cell in the grid
                    const cell = gridContainer?.querySelector(`[data-x="${x}"][data-y="${y}"]`);
                    if (cell) {
                        cell.classList.add('hover-highlight');
                    }

                    // Draw heuristic line if we have goal and h value (only for algorithms that use a heuristic)
                    const noHeuristicAlgorithms = ['bfs', 'dfs', 'dijkstra'];
                    if (goal && !isNaN(h) && !noHeuristicAlgorithms.includes(this.currentHeuristic)) {
                        this.drawHeuristicLine({ x, y }, goal, h);
                    }

                    // Highlight the list item
                    item.classList.add('highlight');
                });

                item.addEventListener('mouseleave', () => {
                    const x = parseInt(item.dataset.x);
                    const y = parseInt(item.dataset.y);

                    // Remove highlight from cell
                    const cell = gridContainer?.querySelector(`[data-x="${x}"][data-y="${y}"]`);
                    if (cell) {
                        cell.classList.remove('hover-highlight');
                    }

                    // Clear heuristic line
                    this.clearHeuristicLine();

                    // Remove list item highlight
                    item.classList.remove('highlight');
                });
            });
        }

        addLogEntry(message, type = 'info') {
            const log = document.getElementById('execution-log');
            if (!log) return;

            const icons = {
                info: 'fa-info-circle',
                expand: 'fa-expand',
                neighbor: 'fa-arrows-alt',
                add: 'fa-plus',
                update: 'fa-pencil',
                success: 'fa-check-circle',
                failure: 'fa-times-circle'
            };

            const entry = document.createElement('div');
            entry.className = `log-entry log-${type}`;
            entry.innerHTML = `
                <span class="log-icon"><i class="fa ${icons[type] || icons.info}"></i></span>
                <span class="log-message">${message}</span>
            `;

            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
        }

        clearLog() {
            const log = document.getElementById('execution-log');
            if (log) {
                log.innerHTML = `
                    <div class="log-entry log-info">
                        <span class="log-icon"><i class="fa fa-info-circle"></i></span>
                        <span class="log-message">Draw walls, place start/goal, then click Solve to begin.</span>
                    </div>
                `;
            }
        }

        setHeuristic(heuristic) {
            this.currentHeuristic = heuristic;
        }

        setEditingEnabled(enabled) {
            this.editingEnabled = enabled;
            const editButtons = document.querySelectorAll('#edit-mode-buttons .btn');
            const clearBtn = document.getElementById('btn-clear-grid');
            const grid = document.getElementById('pathfinding-grid');

            editButtons.forEach(btn => {
                btn.disabled = !enabled || this.simulationRunning;
            });
            if (clearBtn) {
                clearBtn.disabled = !enabled || this.simulationRunning;
            }
            if (grid) {
                grid.classList.toggle('editing-disabled', !enabled || this.simulationRunning);
            }

            // Set the first edit button as active when enabling
            if (enabled && !this.simulationRunning) {
                const firstBtn = document.querySelector('#edit-mode-buttons .btn[data-mode="wall"]');
                if (firstBtn) {
                    editButtons.forEach(b => b.classList.remove('active'));
                    firstBtn.classList.add('active');
                    this.editMode = 'wall';
                }
            }
        }

        setSimulationRunning(running) {
            this.simulationRunning = running;
            const editButtons = document.querySelectorAll('#edit-mode-buttons .btn');
            const clearBtn = document.getElementById('btn-clear-grid');
            const sampleSelect = document.getElementById('sample-select');
            const grid = document.getElementById('pathfinding-grid');

            editButtons.forEach(btn => {
                btn.disabled = !this.editingEnabled || running;
            });
            if (clearBtn) {
                clearBtn.disabled = !this.editingEnabled || running;
            }
            if (sampleSelect) {
                sampleSelect.disabled = running;
            }
            if (grid) {
                grid.classList.toggle('editing-disabled', !this.editingEnabled || running);
            }
        }

        // Update pseudocode highlighting based on step type
        updatePseudocode(stepType) {
            const pseudocodeContainer = document.querySelector('.pseudocode');
            if (!pseudocodeContainer) return;

            // Clear all active lines
            pseudocodeContainer.querySelectorAll('.line').forEach(line => {
                line.classList.remove('active');
            });

            // Map step types to pseudocode line data-line values
            const stepToLines = {
                [STEP_INIT]: ['init', 'init-open', 'init-closed', 'init-g', 'init-f'],
                [STEP_EXPAND]: ['while', 'select', 'remove-open', 'add-closed'],
                [STEP_NEIGHBOR_CHECK]: ['for-neighbor', 'skip-closed', 'tentative-g'],
                [STEP_ADD_TO_OPEN]: ['if-better', 'update-parent', 'update-g', 'update-f', 'add-to-open', 'push-open'],
                [STEP_UPDATE_PATH]: ['if-better', 'update-parent', 'update-g', 'update-f'],
                [STEP_GOAL_FOUND]: ['goal-found', 'return-path'],
                [STEP_NO_SOLUTION]: ['no-path']
            };

            const linesToHighlight = stepToLines[stepType] || [];
            linesToHighlight.forEach(lineId => {
                const line = pseudocodeContainer.querySelector(`.line[data-line="${lineId}"]`);
                if (line) {
                    line.classList.add('active');
                }
            });

            // Scroll to first active line
            const firstActive = pseudocodeContainer.querySelector('.line.active');
            if (firstActive) {
                firstActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        clearPseudocode() {
            const pseudocodeContainer = document.querySelector('.pseudocode');
            if (!pseudocodeContainer) return;

            pseudocodeContainer.querySelectorAll('.line').forEach(line => {
                line.classList.remove('active');
            });
        }

        // Calculate cell center position in pixels
        getCellCenter(x, y) {
            // Account for grid border (2px), gap (1px between cells), and label row/column
            const borderWidth = 2;
            const padding = 1;
            const labelSize = 20; // Size of label row/column
            const cellWithGap = this.cellSize + this.gridGap;

            return {
                px: borderWidth + padding + labelSize + this.gridGap + (x * cellWithGap) + (this.cellSize / 2),
                py: borderWidth + padding + labelSize + this.gridGap + (y * cellWithGap) + (this.cellSize / 2)
            };
        }

        // Draw heuristic visualization line from current node to goal
        drawHeuristicLine(current, goal, hValue) {
            const overlay = document.getElementById('heuristic-overlay');
            if (!overlay || !current || !goal || hValue === undefined || hValue === null) {
                this.clearHeuristicLine();
                return;
            }

            // Don't show line for Dijkstra (h=0)
            if (this.currentHeuristic === 'dijkstra') {
                this.clearHeuristicLine();
                return;
            }

            // Update cell size based on actual grid
            const gridEl = document.getElementById('pathfinding-grid');
            if (gridEl) {
                const firstCell = gridEl.querySelector('.grid-cell');
                if (firstCell) {
                    this.cellSize = firstCell.offsetWidth;
                }
            }

            const start = this.getCellCenter(current.x, current.y);
            const end = this.getCellCenter(goal.x, goal.y);

            // Build path based on heuristic type
            let pathData;
            let arrowAngle;
            let labelPos;

            if (this.currentHeuristic === 'manhattan') {
                // Manhattan: L-shaped path (horizontal then vertical)
                const corner = { px: end.px, py: start.py };

                // Shorten final segment for arrow
                const finalAngle = Math.atan2(end.py - corner.py, end.px - corner.px);
                const lineEnd = {
                    px: end.px - Math.cos(finalAngle) * 10,
                    py: end.py - Math.sin(finalAngle) * 10
                };

                pathData = `M ${start.px} ${start.py} L ${corner.px} ${corner.py} L ${lineEnd.px} ${lineEnd.py}`;
                arrowAngle = Math.PI / 2 * Math.sign(end.py - start.py) || Math.PI / 2; // Pointing down/up
                if (end.py === start.py) {
                    // Same row, just horizontal
                    arrowAngle = end.px > start.px ? 0 : Math.PI;
                }

                // Label at the corner
                labelPos = { x: corner.px, y: corner.py };

            } else if (this.currentHeuristic === 'chebyshev') {
                // Chebyshev: diagonal then straight (king's movement)
                const dx = end.px - start.px;
                const dy = end.py - start.py;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);

                // Move diagonally first, then straight
                const diagDist = Math.min(absDx, absDy);
                const diagX = start.px + diagDist * Math.sign(dx);
                const diagY = start.py + diagDist * Math.sign(dy);

                const corner = { px: diagX, py: diagY };

                // Calculate arrow angle for final segment
                const finalAngle = Math.atan2(end.py - corner.py, end.px - corner.px);
                const lineEnd = {
                    px: end.px - Math.cos(finalAngle) * 10,
                    py: end.py - Math.sin(finalAngle) * 10
                };

                if (absDx === absDy) {
                    // Pure diagonal
                    pathData = `M ${start.px} ${start.py} L ${lineEnd.px} ${lineEnd.py}`;
                    arrowAngle = Math.atan2(dy, dx);
                    labelPos = { x: (start.px + end.px) / 2, y: (start.py + end.py) / 2 };
                } else {
                    pathData = `M ${start.px} ${start.py} L ${corner.px} ${corner.py} L ${lineEnd.px} ${lineEnd.py}`;
                    arrowAngle = finalAngle;
                    labelPos = { x: corner.px, y: corner.py };
                }

            } else {
                // Euclidean: straight line
                const angle = Math.atan2(end.py - start.py, end.px - start.px);
                const lineEnd = {
                    px: end.px - Math.cos(angle) * 10,
                    py: end.py - Math.sin(angle) * 10
                };

                pathData = `M ${start.px} ${start.py} L ${lineEnd.px} ${lineEnd.py}`;
                arrowAngle = angle;
                labelPos = { x: (start.px + end.px) / 2, y: (start.py + end.py) / 2 };
            }

            // Arrow head calculations
            const arrowLength = 8;
            const arrowWidth = 5;
            const arrowTip = {
                x: end.px - Math.cos(arrowAngle) * 5,
                y: end.py - Math.sin(arrowAngle) * 5
            };
            const arrowLeft = {
                x: arrowTip.x - arrowLength * Math.cos(arrowAngle) - arrowWidth * Math.sin(arrowAngle),
                y: arrowTip.y - arrowLength * Math.sin(arrowAngle) + arrowWidth * Math.cos(arrowAngle)
            };
            const arrowRight = {
                x: arrowTip.x - arrowLength * Math.cos(arrowAngle) + arrowWidth * Math.sin(arrowAngle),
                y: arrowTip.y - arrowLength * Math.sin(arrowAngle) - arrowWidth * Math.cos(arrowAngle)
            };

            const heuristicClass = `heuristic-${this.currentHeuristic}`;

            overlay.innerHTML = `
                <g class="${heuristicClass}">
                    <!-- Glow effect -->
                    <path class="heuristic-line-glow" d="${pathData}" />

                    <!-- Main dashed line -->
                    <path class="heuristic-line" d="${pathData}" />

                    <!-- Arrow head -->
                    <polygon class="heuristic-arrow"
                             points="${arrowTip.x},${arrowTip.y} ${arrowLeft.x},${arrowLeft.y} ${arrowRight.x},${arrowRight.y}" />

                    <!-- Label background -->
                    <rect class="heuristic-label-bg"
                          x="${labelPos.x - 18}" y="${labelPos.y - 8}"
                          width="36" height="16" rx="3" />

                    <!-- H value label -->
                    <text class="heuristic-label"
                          x="${labelPos.x}" y="${labelPos.y + 4}"
                          text-anchor="middle">h=${hValue.toFixed(1)}</text>
                </g>
            `;
        }

        clearHeuristicLine() {
            const overlay = document.getElementById('heuristic-overlay');
            if (overlay) {
                overlay.innerHTML = '';
            }
        }

        drawPathLine(path) {
            const overlay = document.getElementById('heuristic-overlay');
            if (!overlay || !path || path.length < 2) return;

            // Update cell size based on actual grid
            const gridEl = document.getElementById('pathfinding-grid');
            if (gridEl) {
                const firstCell = gridEl.querySelector('.grid-cell');
                if (firstCell) {
                    this.cellSize = firstCell.offsetWidth;
                }
            }

            // Build path data
            const points = path.map(node => this.getCellCenter(node.x, node.y));
            const pathData = points.map((p, i) =>
                (i === 0 ? 'M' : 'L') + ` ${p.px} ${p.py}`
            ).join(' ');

            overlay.innerHTML = `
                <g class="path-line-group">
                    <!-- Glow effect -->
                    <path class="path-line-glow" d="${pathData}" />
                    <!-- Main path line -->
                    <path class="path-line" d="${pathData}" />
                </g>
            `;
        }
    }

    // ============================================
    // Graph UI Controller (SVG-based)
    // ============================================

    class GraphUIController {
        constructor(graph) {
            this.graph = graph;
            this.svgContainer = null;
            this.nodeElements = new Map();
            this.edgeElements = new Map();
            this.nodeRadius = 25;
            this.editMode = 'node'; // 'node', 'edge', 'start', 'goal', 'delete'
            this.editingEnabled = false;
            this.simulationRunning = false;
            this.edgeSourceNode = null; // For edge creation
            this.showValues = false;
            this.nodeValues = new Map();
            // Track visualization state to persist across re-renders
            this.pathEdges = new Set();  // edge keys that are part of path
            this.nodeStates = new Map(); // nodeId -> 'open'|'closed'|'current'|'path'
            this.initGraph();
            this.initEventListeners();
        }

        initGraph() {
            const container = document.getElementById('graph-visualization');
            if (!container) return;

            // Clear existing content
            container.innerHTML = '';

            // Create SVG element
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', '0 0 550 400');
            svg.classList.add('graph-svg');
            container.appendChild(svg);
            this.svgContainer = svg;

            // Create layers for proper z-ordering
            const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            edgeLayer.setAttribute('class', 'edge-layer');
            svg.appendChild(edgeLayer);

            const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeLayer.setAttribute('class', 'node-layer');
            svg.appendChild(nodeLayer);

            // Create arrow marker for directed edges (smaller arrows)
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                    <polygon points="0 0, 6 2, 0 4" style="fill:var(--book-axis)" />
                </marker>
                <marker id="arrowhead-path" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                    <polygon points="0 0, 6 2, 0 4" style="fill:var(--book-green)" />
                </marker>
                <marker id="arrowhead-frontier" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                    <polygon points="0 0, 6 2, 0 4" style="fill:var(--book-gold)" />
                </marker>
            `;
            svg.insertBefore(defs, svg.firstChild);

            // Render the graph nodes and edges
            this.renderGraph();
        }

        renderGraph() {
            if (!this.svgContainer) return;

            const edgeLayer = this.svgContainer.querySelector('.edge-layer');
            const nodeLayer = this.svgContainer.querySelector('.node-layer');

            // Clear existing elements
            edgeLayer.innerHTML = '';
            nodeLayer.innerHTML = '';
            this.nodeElements.clear();
            this.edgeElements.clear();

            // Render edges first (so they appear behind nodes)
            this.graph.edges.forEach((edge, index) => {
                const fromNode = this.graph.getNode(edge.from);
                const toNode = this.graph.getNode(edge.to);
                if (!fromNode || !toNode) return;

                // Calculate edge endpoints (offset from node centers to account for radius)
                const dx = toNode.x - fromNode.x;
                const dy = toNode.y - fromNode.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const offsetX = (dx / dist) * this.nodeRadius;
                const offsetY = (dy / dist) * this.nodeRadius;

                const x1 = fromNode.x + offsetX;
                const y1 = fromNode.y + offsetY;
                const x2 = toNode.x - offsetX - 2; // Small offset for arrowhead
                const y2 = toNode.y - offsetY - (dy / dist) * 2;

                // Create edge line
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1);
                line.setAttribute('y1', y1);
                line.setAttribute('x2', x2);
                line.setAttribute('y2', y2);
                line.setAttribute('class', 'graph-edge');
                line.setAttribute('marker-end', 'url(#arrowhead)');
                line.setAttribute('data-from', edge.from);
                line.setAttribute('data-to', edge.to);
                edgeLayer.appendChild(line);

                // Create cost label
                const midX = (fromNode.x + toNode.x) / 2;
                const midY = (fromNode.y + toNode.y) / 2;

                // Offset label perpendicular to edge
                const perpX = -dy / dist * 12;
                const perpY = dx / dist * 12;

                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', midX + perpX);
                label.setAttribute('y', midY + perpY);
                label.setAttribute('class', 'graph-edge-label');
                label.textContent = edge.cost;
                edgeLayer.appendChild(label);

                this.edgeElements.set(`${edge.from}->${edge.to}`, { line, label });
            });

            // Render nodes
            this.graph.nodes.forEach((node, id) => {
                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                group.setAttribute('class', 'graph-node-group');
                group.setAttribute('data-id', id);
                group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

                // Node circle
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('r', this.nodeRadius);
                circle.setAttribute('class', 'graph-node');

                // Apply special styling for start/goal
                if (id === this.graph.start) {
                    circle.classList.add('start');
                } else if (id === this.graph.goal) {
                    circle.classList.add('goal');
                }

                group.appendChild(circle);

                // Node label
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('class', 'graph-node-label');
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('dominant-baseline', 'middle');
                label.textContent = node.label;
                group.appendChild(label);

                // Values display (f/g/h) - shown below node
                if (this.showValues) {
                    const values = this.nodeValues.get(id);
                    if (values) {
                        const valuesText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        valuesText.setAttribute('class', 'graph-node-values');
                        valuesText.setAttribute('text-anchor', 'middle');
                        valuesText.setAttribute('y', this.nodeRadius + 15);
                        valuesText.textContent = `f=${values.f.toFixed(1)} g=${values.g.toFixed(1)} h=${values.h.toFixed(1)}`;
                        group.appendChild(valuesText);
                    }
                }

                // Heuristic value display (always shown for graph mode)
                const hText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                hText.setAttribute('class', 'graph-node-heuristic');
                hText.setAttribute('text-anchor', 'middle');
                hText.setAttribute('y', -this.nodeRadius - 5);
                hText.textContent = `h=${node.h}`;
                group.appendChild(hText);

                nodeLayer.appendChild(group);
                this.nodeElements.set(id, { group, circle, label });
            });

            // Re-apply visualization state (for path edges and node states)
            this.applyVisualizationState();
        }

        applyVisualizationState() {
            // Apply node states
            this.nodeStates.forEach((state, nodeId) => {
                const elem = this.nodeElements.get(nodeId);
                if (elem && nodeId !== this.graph.start && nodeId !== this.graph.goal) {
                    elem.circle.classList.add(state);
                }
            });

            // Apply path edge states
            this.pathEdges.forEach(edgeKey => {
                const edgeElem = this.edgeElements.get(edgeKey);
                if (edgeElem) {
                    edgeElem.line.classList.add('path-edge');
                    edgeElem.line.setAttribute('marker-end', 'url(#arrowhead-path)');
                }
            });
        }

        initEventListeners() {
            const container = document.getElementById('graph-visualization');
            if (!container) return;

            // Node click handling
            container.addEventListener('click', (e) => {
                if (this.simulationRunning) return;

                const nodeGroup = e.target.closest('.graph-node-group');
                const edge = e.target.closest('.graph-edge');

                if (nodeGroup && this.editingEnabled) {
                    const nodeId = nodeGroup.getAttribute('data-id');
                    this.handleNodeClick(nodeId);
                } else if (edge && this.editingEnabled && this.editMode === 'delete') {
                    const from = edge.getAttribute('data-from');
                    const to = edge.getAttribute('data-to');
                    this.graph.removeEdge(from, to);
                    this.renderGraph();
                } else if (!nodeGroup && !edge && this.editingEnabled && this.editMode === 'node') {
                    // Click on empty space - add new node
                    const rect = this.svgContainer.getBoundingClientRect();
                    const viewBox = this.svgContainer.viewBox.baseVal;
                    const scaleX = viewBox.width / rect.width;
                    const scaleY = viewBox.height / rect.height;
                    const x = (e.clientX - rect.left) * scaleX;
                    const y = (e.clientY - rect.top) * scaleY;

                    const nodeId = this.generateNodeId();
                    const h = prompt(`Enter heuristic value for node ${nodeId}:`, '0');
                    if (h !== null) {
                        this.graph.addNode(nodeId, nodeId, x, y, parseFloat(h) || 0);
                        this.renderGraph();
                    }
                }
            });

            // Node dragging
            let draggedNode = null;
            let dragOffset = { x: 0, y: 0 };

            container.addEventListener('mousedown', (e) => {
                if (!this.editingEnabled || this.simulationRunning) return;

                const nodeGroup = e.target.closest('.graph-node-group');
                if (nodeGroup && this.editMode !== 'edge') {
                    const nodeId = nodeGroup.getAttribute('data-id');
                    const node = this.graph.getNode(nodeId);
                    if (node) {
                        draggedNode = nodeId;
                        const rect = this.svgContainer.getBoundingClientRect();
                        const viewBox = this.svgContainer.viewBox.baseVal;
                        const scaleX = viewBox.width / rect.width;
                        const scaleY = viewBox.height / rect.height;
                        dragOffset.x = node.x - (e.clientX - rect.left) * scaleX;
                        dragOffset.y = node.y - (e.clientY - rect.top) * scaleY;
                    }
                }
            });

            document.addEventListener('mousemove', (e) => {
                if (draggedNode && this.editingEnabled && !this.simulationRunning) {
                    const rect = this.svgContainer.getBoundingClientRect();
                    const viewBox = this.svgContainer.viewBox.baseVal;
                    const scaleX = viewBox.width / rect.width;
                    const scaleY = viewBox.height / rect.height;
                    const x = (e.clientX - rect.left) * scaleX + dragOffset.x;
                    const y = (e.clientY - rect.top) * scaleY + dragOffset.y;
                    this.graph.updateNodePosition(draggedNode, x, y);
                    this.renderGraph();
                }
            });

            document.addEventListener('mouseup', () => {
                draggedNode = null;
            });

            // Edit mode buttons
            document.querySelectorAll('.graph-edit-buttons .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (!this.editingEnabled || this.simulationRunning) return;
                    document.querySelectorAll('.graph-edit-buttons .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.editMode = btn.dataset.mode;
                    this.edgeSourceNode = null; // Reset edge creation
                });
            });

            // Clear graph button
            document.getElementById('btn-clear-graph')?.addEventListener('click', () => {
                if (!this.editingEnabled || this.simulationRunning) return;
                this.graph.clear();
                this.nodeValues.clear();
                this.renderGraph();
            });

            // Show values checkbox
            document.getElementById('show-values')?.addEventListener('change', (e) => {
                this.showValues = e.target.checked;
                this.renderGraph();
            });
        }

        handleNodeClick(nodeId) {
            switch (this.editMode) {
                case 'start':
                    this.graph.setStart(nodeId);
                    this.renderGraph();
                    break;
                case 'goal':
                    this.graph.setGoal(nodeId);
                    this.renderGraph();
                    break;
                case 'delete':
                    this.graph.removeNode(nodeId);
                    this.renderGraph();
                    break;
                case 'edge':
                    if (this.edgeSourceNode === null) {
                        this.edgeSourceNode = nodeId;
                        // Highlight source node
                        const elem = this.nodeElements.get(nodeId);
                        if (elem) elem.circle.classList.add('edge-source');
                    } else if (this.edgeSourceNode !== nodeId) {
                        const cost = prompt(`Enter edge cost from ${this.edgeSourceNode} to ${nodeId}:`, '1');
                        if (cost !== null) {
                            this.graph.addEdge(this.edgeSourceNode, nodeId, parseFloat(cost) || 1);
                        }
                        // Clear source highlight
                        const elem = this.nodeElements.get(this.edgeSourceNode);
                        if (elem) elem.circle.classList.remove('edge-source');
                        this.edgeSourceNode = null;
                        this.renderGraph();
                    }
                    break;
                case 'node':
                    // Click on existing node in node mode - edit heuristic
                    const node = this.graph.getNode(nodeId);
                    if (node) {
                        const newH = prompt(`Enter new heuristic value for ${nodeId}:`, node.h.toString());
                        if (newH !== null) {
                            this.graph.updateNodeHeuristic(nodeId, parseFloat(newH) || 0);
                            this.renderGraph();
                        }
                    }
                    break;
            }
        }

        generateNodeId() {
            const existing = this.graph.getAllNodeIds();
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (const letter of letters) {
                if (!existing.includes(letter)) return letter;
            }
            // Fallback to numbered nodes
            let i = 1;
            while (existing.includes(`N${i}`)) i++;
            return `N${i}`;
        }

        renderStep(step, path, goalId) {
            if (!step || !step.isGraph) return;

            // Clear stored visualization state
            this.nodeStates.clear();
            this.pathEdges.clear();

            // Reset all node states
            this.nodeElements.forEach((elem, id) => {
                elem.circle.classList.remove('open', 'closed', 'current', 'path');
            });

            // Reset all edge states
            this.edgeElements.forEach(elem => {
                elem.line.classList.remove('path-edge');
                elem.line.setAttribute('marker-end', 'url(#arrowhead)');
            });

            // Apply closed list styling
            if (step.closedList) {
                for (const node of step.closedList) {
                    const elem = this.nodeElements.get(node.id);
                    if (elem && node.id !== this.graph.start && node.id !== this.graph.goal) {
                        elem.circle.classList.add('closed');
                        this.nodeStates.set(node.id, 'closed');
                    }
                    // Store values
                    this.nodeValues.set(node.id, { g: node.g, h: node.h, f: node.f });
                }
            }

            // Apply open list styling
            if (step.openList) {
                for (const node of step.openList) {
                    const elem = this.nodeElements.get(node.id);
                    if (elem && node.id !== this.graph.start && node.id !== this.graph.goal && !elem.circle.classList.contains('closed')) {
                        elem.circle.classList.add('open');
                        this.nodeStates.set(node.id, 'open');
                    }
                    // Store values
                    this.nodeValues.set(node.id, { g: node.g, h: node.h, f: node.f });
                }
            }

            // Highlight current node
            if (step.current) {
                const elem = this.nodeElements.get(step.current.id);
                if (elem && step.current.id !== this.graph.start && step.current.id !== this.graph.goal) {
                    elem.circle.classList.remove('open', 'closed');
                    elem.circle.classList.add('current');
                    this.nodeStates.set(step.current.id, 'current');
                }
            }

            // Highlight path
            if (step.path) {
                for (let i = 0; i < step.path.length; i++) {
                    const node = step.path[i];
                    const elem = this.nodeElements.get(node.id);
                    if (elem && node.id !== this.graph.start && node.id !== this.graph.goal) {
                        elem.circle.classList.remove('open', 'closed', 'current');
                        elem.circle.classList.add('path');
                        this.nodeStates.set(node.id, 'path');
                    }

                    // Highlight path edges
                    if (i < step.path.length - 1) {
                        const nextNode = step.path[i + 1];
                        const edgeKey = `${node.id}->${nextNode.id}`;
                        const edgeElem = this.edgeElements.get(edgeKey);
                        if (edgeElem) {
                            edgeElem.line.classList.add('path-edge');
                            edgeElem.line.setAttribute('marker-end', 'url(#arrowhead-path)');
                            this.pathEdges.add(edgeKey);
                        }
                    }
                }
            }

            // Re-render to show values if enabled (state will be reapplied)
            if (this.showValues) {
                this.renderGraph();
            }
        }

        updateLists(openList, closedList, goalId) {
            // Similar to grid version but for graph nodes
            const openContainer = document.getElementById('open-list');
            const closedContainer = document.getElementById('closed-list');
            const openCount = document.getElementById('open-count');
            const closedCount = document.getElementById('closed-count');

            if (openContainer) {
                if (openList.length === 0) {
                    openContainer.innerHTML = '<div class="list-empty">No nodes yet</div>';
                } else {
                    openContainer.innerHTML = openList.map(node => `
                        <div class="list-item" data-id="${node.id}" data-g="${node.g}" data-h="${node.h}" data-f="${node.f}">
                            <span class="list-item-coord">${node.id}</span>
                            <span class="list-item-values">f=${node.f.toFixed(1)} g=${node.g.toFixed(1)} h=${node.h.toFixed(1)}</span>
                        </div>
                    `).join('');
                }
            }

            if (closedContainer) {
                if (closedList.length === 0) {
                    closedContainer.innerHTML = '<div class="list-empty">No nodes yet</div>';
                } else {
                    closedContainer.innerHTML = closedList.map(node => `
                        <div class="list-item" data-id="${node.id}" data-g="${node.g}" data-h="${node.h}" data-f="${node.f}">
                            <span class="list-item-coord">${node.id}</span>
                            <span class="list-item-values">f=${node.f.toFixed(1)} g=${node.g.toFixed(1)} h=${node.h.toFixed(1)}</span>
                        </div>
                    `).join('');
                }
            }

            if (openCount) openCount.textContent = openList.length;
            if (closedCount) closedCount.textContent = closedList.length;
        }

        updateMetrics(metrics) {
            document.getElementById('metric-expanded').textContent = metrics.nodesExpanded ?? 0;
            document.getElementById('metric-generated').textContent = metrics.nodesGenerated ?? 0;
            document.getElementById('metric-path-length').textContent = metrics.pathLength ?? '-';
            document.getElementById('metric-path-cost').textContent = metrics.pathCost !== null && metrics.pathCost !== undefined
                ? metrics.pathCost.toFixed(2) : '-';
            document.getElementById('metric-time').textContent = metrics.time !== undefined
                ? `${metrics.time.toFixed(2)}ms` : '0.00ms';
        }

        clearLog() {
            const log = document.getElementById('execution-log');
            if (log) {
                log.innerHTML = `
                    <div class="log-entry log-info">
                        <span class="log-icon"><i class="fa fa-info-circle"></i></span>
                        <span class="log-message">Select a sample graph or create custom, then click Solve.</span>
                    </div>
                `;
            }
            // Clear visualization state
            this.nodeStates.clear();
            this.pathEdges.clear();
            this.nodeValues.clear();
        }

        addLogEntry(message, type = 'info') {
            const log = document.getElementById('execution-log');
            if (!log) return;

            const iconMap = {
                info: 'fa-info-circle',
                expand: 'fa-expand',
                add: 'fa-plus',
                update: 'fa-refresh',
                success: 'fa-check-circle',
                error: 'fa-times-circle'
            };

            const entry = document.createElement('div');
            entry.className = `log-entry log-${type}`;
            entry.innerHTML = `
                <span class="log-icon"><i class="fa ${iconMap[type] || 'fa-info-circle'}"></i></span>
                <span class="log-message">${message}</span>
            `;
            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
        }

        setEditingEnabled(enabled) {
            this.editingEnabled = enabled;
            const editButtons = document.querySelectorAll('.graph-edit-buttons .btn');
            const clearBtn = document.getElementById('btn-clear-graph');
            const container = document.getElementById('graph-visualization');

            editButtons.forEach(btn => {
                btn.disabled = !enabled || this.simulationRunning;
            });
            if (clearBtn) {
                clearBtn.disabled = !enabled || this.simulationRunning;
            }
            if (container) {
                container.classList.toggle('editing-disabled', !enabled || this.simulationRunning);
            }

            if (enabled && !this.simulationRunning) {
                const firstBtn = document.querySelector('.graph-edit-buttons .btn[data-mode="node"]');
                if (firstBtn) {
                    editButtons.forEach(b => b.classList.remove('active'));
                    firstBtn.classList.add('active');
                    this.editMode = 'node';
                }
            }
        }

        setSimulationRunning(running) {
            this.simulationRunning = running;
            const editButtons = document.querySelectorAll('.graph-edit-buttons .btn');
            const clearBtn = document.getElementById('btn-clear-graph');
            const sampleSelect = document.getElementById('sample-select');
            const container = document.getElementById('graph-visualization');

            editButtons.forEach(btn => {
                btn.disabled = !this.editingEnabled || running;
            });
            if (clearBtn) {
                clearBtn.disabled = !this.editingEnabled || running;
            }
            if (sampleSelect) {
                sampleSelect.disabled = running;
            }
            if (container) {
                container.classList.toggle('editing-disabled', !this.editingEnabled || running);
            }
        }

        updatePseudocode(stepType) {
            // Same as grid version - pseudocode is generic
            const pseudocodeContainer = document.querySelector('.pseudocode');
            if (!pseudocodeContainer) return;

            pseudocodeContainer.querySelectorAll('.line').forEach(line => {
                line.classList.remove('active');
            });

            const stepToLines = {
                [STEP_INIT]: ['init', 'init-open', 'init-closed', 'init-g', 'init-f'],
                [STEP_EXPAND]: ['while', 'select', 'remove-open', 'add-closed'],
                [STEP_NEIGHBOR_CHECK]: ['for-neighbor', 'skip-closed', 'tentative-g'],
                [STEP_ADD_TO_OPEN]: ['if-better', 'update-parent', 'update-g', 'update-f', 'add-to-open', 'push-open'],
                [STEP_UPDATE_PATH]: ['if-better', 'update-parent', 'update-g', 'update-f'],
                [STEP_GOAL_FOUND]: ['goal-found', 'return-path'],
                [STEP_NO_SOLUTION]: ['no-path']
            };

            const linesToHighlight = stepToLines[stepType] || [];
            linesToHighlight.forEach(lineId => {
                const line = pseudocodeContainer.querySelector(`.line[data-line="${lineId}"]`);
                if (line) {
                    line.classList.add('active');
                }
            });

            const firstActive = pseudocodeContainer.querySelector('.line.active');
            if (firstActive) {
                firstActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        clearPseudocode() {
            const pseudocodeContainer = document.querySelector('.pseudocode');
            if (!pseudocodeContainer) return;

            pseudocodeContainer.querySelectorAll('.line').forEach(line => {
                line.classList.remove('active');
            });
        }

        // No-op for graph mode (no heuristic line to draw)
        clearHeuristicLine() {
            // Graph mode doesn't draw heuristic lines
        }

        // For grid interface compatibility - but don't re-render during playback
        // as it would wipe out the algorithm state visualization
        renderGrid() {
            // Only re-render if not in simulation (playback would wipe state)
            if (!this.simulationRunning) {
                this.renderGraph();
            }
        }

        // Compute shortest path costs from each node to goal using reverse Dijkstra
        computeOptimalCostsToGoal() {
            const goal = this.graph.goal;
            if (!goal) return {};

            // Build reverse adjacency list (edges pointing TO each node)
            const reverseAdj = new Map();
            this.graph.nodes.forEach((_, id) => reverseAdj.set(id, []));
            this.graph.edges.forEach(edge => {
                reverseAdj.get(edge.to).push({ id: edge.from, cost: edge.cost });
            });

            // Dijkstra from goal using reverse edges
            const dist = {};
            this.graph.nodes.forEach((_, id) => dist[id] = Infinity);
            dist[goal] = 0;

            const pq = [{ id: goal, cost: 0 }];
            const visited = new Set();

            while (pq.length > 0) {
                pq.sort((a, b) => a.cost - b.cost);
                const { id: current, cost } = pq.shift();

                if (visited.has(current)) continue;
                visited.add(current);

                // Check reverse neighbors (nodes that can reach current)
                for (const { id: neighbor, cost: edgeCost } of reverseAdj.get(current)) {
                    const newDist = cost + edgeCost;
                    if (newDist < dist[neighbor]) {
                        dist[neighbor] = newDist;
                        pq.push({ id: neighbor, cost: newDist });
                    }
                }
            }

            return dist;
        }

        // Check which heuristics are inadmissible or inconsistent
        checkHeuristicQuality() {
            const optimalCosts = this.computeOptimalCostsToGoal();
            const issues = {}; // nodeId -> { inadmissible: bool, inconsistent: bool, reason: string }

            this.graph.nodes.forEach((node, id) => {
                const h = node.h;
                const optimal = optimalCosts[id];
                issues[id] = { inadmissible: false, inconsistent: false, reasons: [] };

                // Check admissibility: h(n) <= h*(n) (actual cost to goal)
                if (optimal !== Infinity && h > optimal) {
                    issues[id].inadmissible = true;
                    issues[id].reasons.push(`h(${node.label})=${h} > optimal cost ${optimal.toFixed(1)}`);
                }

                // Check consistency: h(n) <= cost(n,n') + h(n') for all neighbors
                const neighbors = this.graph.getNeighbors(id);
                for (const { id: neighborId, cost } of neighbors) {
                    const neighborNode = this.graph.getNode(neighborId);
                    if (neighborNode) {
                        const neighborH = neighborNode.h;
                        if (h > cost + neighborH) {
                            issues[id].inconsistent = true;
                            issues[id].reasons.push(`h(${node.label})=${h} > ${cost}+h(${neighborNode.label})=${cost + neighborH}`);
                        }
                    }
                }
            });

            return issues;
        }

        renderHeuristicsTable() {
            const container = document.getElementById('graph-heuristics-table');
            if (!container) return;

            const nodes = Array.from(this.graph.nodes.entries());
            const issues = this.checkHeuristicQuality();

            // Sort: start first, then alphabetically, goal last
            nodes.sort((a, b) => {
                if (a[0] === this.graph.start) return -1;
                if (b[0] === this.graph.start) return 1;
                if (a[0] === this.graph.goal) return 1;
                if (b[0] === this.graph.goal) return -1;
                return a[0].localeCompare(b[0]);
            });

            container.innerHTML = nodes.map(([id, node]) => {
                const isStart = id === this.graph.start;
                const isGoal = id === this.graph.goal;
                const issue = issues[id] || {};

                // Determine CSS class: inadmissible > inconsistent > start/goal
                let extraClass = '';
                let title = '';
                if (issue.inadmissible) {
                    extraClass = 'inadmissible';
                    title = 'Inadmissible: ' + issue.reasons.join('; ');
                } else if (issue.inconsistent) {
                    extraClass = 'inconsistent';
                    title = 'Inconsistent: ' + issue.reasons.join('; ');
                } else if (isStart) {
                    extraClass = 'start';
                    title = 'Start node';
                } else if (isGoal) {
                    extraClass = 'goal';
                    title = 'Goal always has h=0';
                } else {
                    title = 'Heuristic estimate to goal';
                }

                const disabled = isGoal ? 'disabled' : '';

                return `
                    <div class="heuristic-item ${extraClass}">
                        <label>${node.label}:</label>
                        <input type="number"
                               data-node="${id}"
                               value="${node.h}"
                               min="0"
                               step="1"
                               ${disabled}
                               title="${title}">
                    </div>
                `;
            }).join('');
        }

        getHeuristicsFromTable() {
            const inputs = document.querySelectorAll('#graph-heuristics-table input');
            const heuristics = {};
            inputs.forEach(input => {
                const nodeId = input.dataset.node;
                const value = parseFloat(input.value) || 0;
                heuristics[nodeId] = value;
            });
            return heuristics;
        }

        applyHeuristics(heuristics) {
            for (const [nodeId, h] of Object.entries(heuristics)) {
                this.graph.updateNodeHeuristic(nodeId, h);
            }
            // Re-render to update h= labels on nodes
            this.renderGraph();
        }
    }

    // ============================================
    // Playback Controller
    // Uses shared VizLib.PlaybackController when available with A*-specific rendering
    // ============================================

    // Helper to map step type to log type
    function getLogType(stepType) {
        switch (stepType) {
            case STEP_INIT: return 'info';
            case STEP_EXPAND: return 'expand';
            case STEP_NEIGHBOR_CHECK: return 'neighbor';
            case STEP_ADD_TO_OPEN: return 'add';
            case STEP_UPDATE_PATH: return 'update';
            case STEP_GOAL_FOUND: return 'success';
            case STEP_NO_SOLUTION: return 'failure';
            default: return 'info';
        }
    }

    function createAStarPlaybackController(ui) {
        // Use shared PlaybackController from VizLib
        let onStepChangeCallback = null;

        const controller = new window.VizLib.PlaybackController({
            initialSpeed: 9,
            onRenderStep: (step, index, metadata) => {
                const goal = metadata;
                ui.renderStep(step, [], goal);
                ui.updateLists(step.openList, step.closedList, goal);

                if (step.metrics) {
                    ui.updateMetrics(step.metrics);
                }

                ui.updatePseudocode(step.type);

                const logType = getLogType(step.type);
                ui.addLogEntry(step.message, logType);

                if (onStepChangeCallback) {
                    onStepChangeCallback(step, index);
                }
            },
            onStepChange: (index, total) => {
                const display = document.getElementById('playback-step');
                if (display) {
                    display.textContent = `Step: ${index + 1} / ${total}`;
                }
            },
            onReset: () => {
                ui.clearHeuristicLine();
                ui.clearPseudocode();
                ui.renderGrid();
                const display = document.getElementById('playback-step');
                if (display) {
                    display.textContent = `Step: 0 / 0`;
                }
            }
        });

        // Return adapted interface matching original API
        return {
            loadSteps: (steps, goal = null) => controller.load(steps, goal),
            play: () => controller.play(),
            pause: () => controller.pause(),
            stepForward: () => controller.stepForward(),
            stepBackward: () => controller.stepBackward(),
            goToStep: (index) => controller.goToStep(index),
            reset: () => controller.reset(),
            setSpeed: (speed) => controller.setSpeed(speed),
            getDelay: () => controller.getDelay(),
            get isPlaying() { return controller.getIsPlaying(); },
            get currentStepIndex() { return controller.getCurrentIndex(); },
            get steps() { return controller.steps; },
            get goal() { return controller.getMetadata(); },
            set onStepChange(fn) { onStepChangeCallback = fn; }
        };
    }

    // ============================================
    // Main Application
    // ============================================

    class AStarApp {
        constructor() {
            // Grid mode components
            this.grid = new GridState();
            this.solver = new AStarSolver();
            this.ui = new UIController(this.grid);
            this.playback = createAStarPlaybackController(this.ui);

            // Graph mode components
            this.graphState = new DirectGraphState();
            this.graphUI = new GraphUIController(this.graphState);
            this.graphPlayback = createAStarPlaybackController(this.graphUI);

            // Mode tracking
            this.isGraphMode = false;

            this.currentResult = null;
            this.comparisonResults = new Map();

            this.initEventListeners();
            this.loadSample('easy');
        }

        initEventListeners() {
            // Sample input dropdown
            document.getElementById('sample-select')?.addEventListener('change', (e) => {
                const value = e.target.value;
                if (value === 'custom') {
                    this.enableCustomMode();
                } else if (value === 'graph-custom') {
                    this.enableGraphCustomMode();
                } else if (value.startsWith('graph-')) {
                    this.loadGraphSample(value.replace('graph-', ''));
                } else {
                    this.loadSample(value);
                }
            });

            // Solve button
            document.getElementById('btn-solve')?.addEventListener('click', () => this.solve());

            // Pause button
            document.getElementById('btn-pause')?.addEventListener('click', () => {
                const playback = this.isGraphMode ? this.graphPlayback : this.playback;
                if (playback.isPlaying) {
                    playback.pause();
                    document.getElementById('btn-pause').innerHTML = '<i class="fa fa-play"></i>';
                } else {
                    playback.play();
                    document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i>';
                }
            });

            // Step buttons
            document.getElementById('btn-step')?.addEventListener('click', () => {
                const playback = this.isGraphMode ? this.graphPlayback : this.playback;
                playback.pause();
                playback.stepForward();
                document.getElementById('btn-pause').innerHTML = '<i class="fa fa-play"></i>';
            });

            document.getElementById('btn-step-back')?.addEventListener('click', () => {
                const playback = this.isGraphMode ? this.graphPlayback : this.playback;
                playback.pause();
                playback.stepBackward();
                document.getElementById('btn-pause').innerHTML = '<i class="fa fa-play"></i>';
            });

            // Reset button
            document.getElementById('btn-reset')?.addEventListener('click', () => this.reset());

            // Speed slider
            document.getElementById('speed-slider')?.addEventListener('input', (e) => {
                const speed = parseInt(e.target.value);
                this.playback.setSpeed(speed);
                this.graphPlayback.setSpeed(speed);
            });

            // Movement mode dropdown - auto-select appropriate heuristic
            document.getElementById('movement-mode')?.addEventListener('change', (e) => {
                const heuristicSelect = document.getElementById('heuristic-select');
                if (heuristicSelect) {
                    if (e.target.value === 'grid') {
                        heuristicSelect.value = 'manhattan';
                    } else {
                        heuristicSelect.value = 'euclidean';
                    }
                }
                // Re-run comparison with new movement mode
                this.runComparison();
            });

            // Heuristic dropdown - re-run comparison when changed
            document.getElementById('heuristic-select')?.addEventListener('change', () => {
                this.runComparison();
            });

            // Heuristic weight slider
            document.getElementById('heuristic-weight')?.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                document.getElementById('weight-value').textContent = value.toFixed(1);
                this.runComparison();
            });

            // Clear log button
            document.getElementById('btn-clear-log')?.addEventListener('click', () => {
                this.ui.clearLog();
            });

            // Info panel tabs
            document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.info-panel-tabs .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    document.querySelectorAll('.info-tab-content').forEach(tab => tab.classList.remove('active'));
                    const tabId = `tab-${btn.dataset.tab}`;
                    document.getElementById(tabId)?.classList.add('active');
                });
            });

            // Run comparison button
            document.getElementById('btn-run-comparison')?.addEventListener('click', () => this.runComparison());

            // Comparison table row click
            document.getElementById('comparison-table')?.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                if (row && row.dataset.heuristic) {
                    this.loadComparisonResult(row.dataset.heuristic);
                }
            });

            // Auto-apply heuristics when input changes (graph mode)
            document.getElementById('graph-heuristics-table')?.addEventListener('input', (e) => {
                if (e.target.tagName === 'INPUT') {
                    this.applyGraphHeuristics();
                }
            });
        }

        loadSample(name) {
            this.switchToGridMode();
            this.reset();
            this.ui.setEditingEnabled(false);
            this.ui.setSimulationRunning(false);
            this.grid.loadSample(name);
            this.ui.renderGrid();
            // Auto-populate comparison table
            this.runComparison();
        }

        enableCustomMode() {
            this.switchToGridMode();
            this.reset();
            this.ui.setSimulationRunning(false);
            this.grid.clear();
            this.ui.setEditingEnabled(true);
            this.ui.renderGrid();
            // Clear comparison table
            const tbody = document.querySelector('#comparison-table tbody');
            if (tbody) tbody.innerHTML = '';
        }

        loadGraphSample(name) {
            this.switchToGraphMode();
            this.resetGraph();
            this.graphUI.setEditingEnabled(false);
            this.graphUI.setSimulationRunning(false);
            this.graphState.loadSample(name);
            this.graphUI.initGraph();
            this.graphUI.renderHeuristicsTable();
            // Auto-populate comparison table
            this.runComparison();
        }

        enableGraphCustomMode() {
            this.switchToGraphMode();
            this.resetGraph();
            this.graphUI.setSimulationRunning(false);
            this.graphState.clear();
            this.graphUI.setEditingEnabled(true);
            this.graphUI.initGraph();
            this.graphUI.renderHeuristicsTable();
            // Clear comparison table
            const tbody = document.querySelector('#comparison-table tbody');
            if (tbody) tbody.innerHTML = '';
        }

        applyGraphHeuristics() {
            // Get heuristics from the table and apply to graph state
            const heuristics = this.graphUI.getHeuristicsFromTable();
            this.graphUI.applyHeuristics(heuristics);
            // Reset and re-run comparison
            this.resetGraph();
            this.graphUI.renderHeuristicsTable();
            this.runComparison();
        }

        switchToGridMode() {
            if (!this.isGraphMode) return;
            this.isGraphMode = false;

            // Show grid visualization, hide graph
            document.getElementById('pathfinding-grid')?.style.setProperty('display', '');
            document.getElementById('heuristic-overlay')?.style.setProperty('display', '');
            document.getElementById('graph-visualization')?.style.setProperty('display', 'none');

            // Show grid controls, hide graph controls
            document.querySelectorAll('.grid-controls').forEach(el => el.style.display = '');
            document.querySelectorAll('.graph-controls').forEach(el => el.style.display = 'none');

            // Reset graph playback
            this.graphPlayback.reset();
        }

        switchToGraphMode() {
            if (this.isGraphMode) return;
            this.isGraphMode = true;

            // Hide grid visualization, show graph
            document.getElementById('pathfinding-grid')?.style.setProperty('display', 'none');
            document.getElementById('heuristic-overlay')?.style.setProperty('display', 'none');
            document.getElementById('graph-visualization')?.style.setProperty('display', '');

            // Hide grid controls, show graph controls
            document.querySelectorAll('.grid-controls').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.graph-controls').forEach(el => el.style.display = '');

            // Reset grid playback
            this.playback.reset();
        }

        resetGraph() {
            this.graphPlayback.reset();
            this.graphUI.clearLog();
            this.graphUI.setSimulationRunning(false);
            this.graphUI.initGraph();
            this.graphUI.updateMetrics({});
            this.graphUI.updateLists([], []);

            // Disable controls
            document.getElementById('btn-pause').disabled = true;
            document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i>';
            document.getElementById('btn-step').disabled = true;
            document.getElementById('btn-step-back').disabled = true;
        }

        solve() {
            if (this.isGraphMode) {
                this.solveGraph();
            } else {
                this.solveGrid();
            }
        }

        solveGrid() {
            if (!this.grid.start || !this.grid.goal) {
                alert('Please place both a start and goal position.');
                return;
            }

            // Lock editing during simulation
            this.ui.setSimulationRunning(true);
            this.ui.clearLog();

            const movementMode = document.getElementById('movement-mode')?.value || 'grid';
            const options = {
                heuristic: document.getElementById('heuristic-select')?.value || 'manhattan',
                allowDiagonal: movementMode === 'free',
                tiebreaker: document.getElementById('tiebreaker-select')?.value || 'none',
                weight: parseFloat(document.getElementById('heuristic-weight')?.value) || 1.0
            };

            // Set heuristic on UI for visualization
            this.ui.setHeuristic(options.heuristic);

            // Choose solve method based on algorithm selection
            if (options.heuristic === 'bfs') {
                this.currentResult = this.solver.solveBFS(this.grid, options);
            } else if (options.heuristic === 'dfs') {
                this.currentResult = this.solver.solveDFS(this.grid, options);
            } else {
                this.currentResult = this.solver.solve(this.grid, options);
            }
            this.playback.loadSteps(this.currentResult.steps, this.grid.goal);

            // Enable controls
            document.getElementById('btn-pause').disabled = false;
            document.getElementById('btn-step').disabled = false;
            document.getElementById('btn-step-back').disabled = false;

            // Start playback (metrics will update incrementally)
            document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i>';
            this.playback.play();
        }

        solveGraph() {
            if (!this.graphState.start || !this.graphState.goal) {
                alert('Please set both a start and goal node.');
                return;
            }

            // Lock editing during simulation
            this.graphUI.setSimulationRunning(true);
            this.graphUI.clearLog();

            const algorithm = document.getElementById('heuristic-select')?.value || 'manhattan';

            // Choose solve method based on algorithm selection
            if (algorithm === 'bfs') {
                this.currentResult = this.solver.solveGraphBFS(this.graphState);
            } else if (algorithm === 'dfs') {
                this.currentResult = this.solver.solveGraphDFS(this.graphState);
            } else if (algorithm === 'dijkstra') {
                this.currentResult = this.solver.solveGraphDijkstra(this.graphState);
            } else {
                // A* variants all use the same graph solver (uses node heuristics)
                this.currentResult = this.solver.solveGraph(this.graphState);
            }
            this.graphPlayback.loadSteps(this.currentResult.steps, this.graphState.goal);

            // Enable controls
            document.getElementById('btn-pause').disabled = false;
            document.getElementById('btn-step').disabled = false;
            document.getElementById('btn-step-back').disabled = false;

            // Start playback
            document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i>';
            this.graphPlayback.play();
        }

        reset() {
            if (this.isGraphMode) {
                this.resetGraph();
            } else {
                this.resetGrid();
            }
        }

        resetGrid() {
            this.playback.reset();
            this.ui.nodeValues.clear();
            this.ui.clearHeuristicLine();
            this.ui.setSimulationRunning(false);
            this.ui.renderGrid();
            this.ui.updateMetrics({});
            this.ui.updateLists([], []);
            this.ui.clearLog();

            // Disable controls
            document.getElementById('btn-pause').disabled = true;
            document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i>';
            document.getElementById('btn-step').disabled = true;
            document.getElementById('btn-step-back').disabled = true;
        }

        runComparison() {
            if (this.isGraphMode) {
                this.runGraphComparison();
            } else {
                this.runGridComparison();
            }
        }

        runGridComparison() {
            if (!this.grid.start || !this.grid.goal) {
                // Clear comparison table if no start/goal
                const tbody = document.querySelector('#comparison-table tbody');
                if (tbody) tbody.innerHTML = '';
                return;
            }

            this.comparisonResults.clear();
            const algorithms = ['manhattan', 'euclidean', 'chebyshev', 'dijkstra', 'bfs', 'dfs'];
            const movementMode = document.getElementById('movement-mode')?.value || 'grid';
            const allowDiagonal = movementMode === 'free';
            const tiebreaker = document.getElementById('tiebreaker-select')?.value || 'none';
            const weight = parseFloat(document.getElementById('heuristic-weight')?.value) || 1.0;

            const results = [];

            for (const algorithm of algorithms) {
                let result;
                if (algorithm === 'bfs') {
                    result = this.solver.solveBFS(this.grid, { allowDiagonal });
                } else if (algorithm === 'dfs') {
                    result = this.solver.solveDFS(this.grid, { allowDiagonal });
                } else {
                    result = this.solver.solve(this.grid, { heuristic: algorithm, allowDiagonal, tiebreaker, weight });
                }
                this.comparisonResults.set(algorithm, result);

                results.push({
                    heuristic: algorithm,
                    expanded: result.metrics.nodesExpanded,
                    generated: result.metrics.nodesGenerated,
                    pathLength: result.success ? result.metrics.pathLength : null,
                    pathCost: result.success ? result.metrics.pathCost : null,
                    time: result.metrics.time,
                    success: result.success
                });
            }

            this.renderComparisonTable(results);
        }

        runGraphComparison() {
            if (!this.graphState.start || !this.graphState.goal) {
                // Clear comparison table if no start/goal
                const tbody = document.querySelector('#comparison-table tbody');
                if (tbody) tbody.innerHTML = '';
                return;
            }

            this.comparisonResults.clear();
            // For graphs, only A* (with node heuristics), Dijkstra, BFS, DFS make sense
            const algorithms = ['astar', 'dijkstra', 'bfs', 'dfs'];

            const results = [];

            for (const algorithm of algorithms) {
                let result;
                if (algorithm === 'bfs') {
                    result = this.solver.solveGraphBFS(this.graphState);
                } else if (algorithm === 'dfs') {
                    result = this.solver.solveGraphDFS(this.graphState);
                } else if (algorithm === 'dijkstra') {
                    result = this.solver.solveGraphDijkstra(this.graphState);
                } else {
                    result = this.solver.solveGraph(this.graphState);
                }
                this.comparisonResults.set(algorithm, result);

                results.push({
                    heuristic: algorithm,
                    expanded: result.metrics.nodesExpanded,
                    generated: result.metrics.nodesGenerated,
                    pathLength: result.success ? result.metrics.pathLength : null,
                    pathCost: result.success ? result.metrics.pathCost : null,
                    time: result.metrics.time,
                    success: result.success
                });
            }

            this.renderComparisonTable(results);
        }

        renderComparisonTable(results) {
            const tbody = document.querySelector('#comparison-table tbody');
            if (!tbody) return;

            // Find best values (lowest expanded, shortest path, etc.)
            const best = {
                expanded: Math.min(...results.map(r => r.expanded)),
                generated: Math.min(...results.map(r => r.generated)),
                pathLength: Math.min(...results.filter(r => r.pathLength !== null).map(r => r.pathLength)),
                pathCost: Math.min(...results.filter(r => r.pathCost !== null).map(r => r.pathCost)),
                time: Math.min(...results.map(r => r.time))
            };

            tbody.innerHTML = results.map(r => {
                const isBestExpanded = r.expanded === best.expanded;
                const isBestGenerated = r.generated === best.generated;
                const isBestLength = r.pathLength !== null && r.pathLength === best.pathLength;
                const isBestCost = r.pathCost !== null && r.pathCost === best.pathCost;
                const isBestTime = r.time === best.time;

                const heuristicName = r.heuristic.charAt(0).toUpperCase() + r.heuristic.slice(1);

                return `
                    <tr data-heuristic="${r.heuristic}">
                        <td>${heuristicName}</td>
                        <td class="${isBestExpanded ? 'best-value' : ''}">${r.expanded}</td>
                        <td class="${isBestGenerated ? 'best-value' : ''}">${r.generated}</td>
                        <td class="${r.pathLength === null ? 'no-solution-value' : (isBestLength ? 'best-value' : '')}">${r.pathLength ?? 'No path'}</td>
                        <td class="${r.pathCost === null ? 'no-solution-value' : (isBestCost ? 'best-value' : '')}">${r.pathCost !== null ? r.pathCost.toFixed(2) : 'N/A'}</td>
                        <td class="${isBestTime ? 'best-value' : ''}">${r.time.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }

        loadComparisonResult(heuristic) {
            const result = this.comparisonResults.get(heuristic);
            if (!result) return;

            // Update selection in table
            document.querySelectorAll('#comparison-table tbody tr').forEach(row => {
                row.classList.toggle('selected-row', row.dataset.heuristic === heuristic);
            });

            // Update heuristic dropdown
            const select = document.getElementById('heuristic-select');
            if (select && !this.isGraphMode) select.value = heuristic;

            if (this.isGraphMode) {
                // Load the result for graph mode
                this.currentResult = result;
                this.graphPlayback.loadSteps(result.steps, this.graphState.goal);
                this.graphUI.clearLog();

                // Enable controls
                document.getElementById('btn-pause').disabled = false;
                document.getElementById('btn-step').disabled = false;
                document.getElementById('btn-step-back').disabled = false;

                // Go to last step to show final state
                if (result.steps.length > 0) {
                    this.graphPlayback.goToStep(result.steps.length - 1);
                }
            } else {
                // Load the result for grid mode
                this.ui.setHeuristic(heuristic);
                this.currentResult = result;
                this.playback.loadSteps(result.steps, this.grid.goal);
                this.ui.clearLog();

                // Enable controls
                document.getElementById('btn-pause').disabled = false;
                document.getElementById('btn-step').disabled = false;
                document.getElementById('btn-step-back').disabled = false;

                // Go to last step to show final state
                if (result.steps.length > 0) {
                    this.playback.goToStep(result.steps.length - 1);
                }
            }
        }
    }

    // ============================================
    // Initialize on DOM ready
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        window.astarApp = new AStarApp();
    });

})();

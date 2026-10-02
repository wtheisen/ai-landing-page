/**
 * Reinforcement Learning (Grid World) Visualizer
 *
 * Interactive visualization of Q-Learning and SARSA algorithms in grid worlds.
 * Supports Cliff Walking, Frozen Lake, and Custom environments.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 480;

    // Cell types
    const EMPTY = 0;
    const WALL = 1;
    const GOAL = 2;
    const PIT = 3;
    const START = 4;

    // Actions: 0=up, 1=right, 2=down, 3=left
    const ACTIONS = [0, 1, 2, 3];
    const ACTION_NAMES = ['Up', 'Right', 'Down', 'Left'];
    const ACTION_DELTAS = [
        [-1, 0],  // up
        [0, 1],   // right
        [1, 0],   // down
        [0, -1]   // left
    ];
    const ARROW_CHARS = ['\u2191', '\u2192', '\u2193', '\u2190']; // arrows

    // Rewards
    const REWARD_STEP = -1;
    const REWARD_GOAL = 100;
    const REWARD_PIT = -100;
    const REWARD_WALL = -1;

    const MAX_STEPS_PER_EPISODE = 500;

    // ============================================
    // Environments
    // ============================================
    const ENVIRONMENTS = {
        cliff: {
            name: 'Cliff Walking',
            rows: 4,
            cols: 12,
            grid: null, // built dynamically
            start: [3, 0],
            build() {
                const g = [];
                for (let r = 0; r < 4; r++) {
                    g[r] = [];
                    for (let c = 0; c < 12; c++) {
                        g[r][c] = EMPTY;
                    }
                }
                g[3][0] = START;
                g[3][11] = GOAL;
                // Cliff: bottom row columns 1-10
                for (let c = 1; c <= 10; c++) {
                    g[3][c] = PIT;
                }
                return g;
            }
        },
        frozen: {
            name: 'Frozen Lake',
            rows: 4,
            cols: 4,
            start: [0, 0],
            build() {
                // Classic Frozen Lake 4x4
                const g = [
                    [START, EMPTY, EMPTY, EMPTY],
                    [EMPTY, PIT,   EMPTY, PIT],
                    [EMPTY, EMPTY, EMPTY, PIT],
                    [PIT,   EMPTY, EMPTY, GOAL]
                ];
                return g;
            }
        },
        custom: {
            name: 'Custom 5x5',
            rows: 5,
            cols: 5,
            start: [0, 0],
            build() {
                const g = [
                    [START, EMPTY, EMPTY, WALL,  EMPTY],
                    [EMPTY, WALL,  EMPTY, EMPTY, EMPTY],
                    [EMPTY, EMPTY, PIT,   EMPTY, WALL],
                    [EMPTY, WALL,  EMPTY, EMPTY, EMPTY],
                    [EMPTY, EMPTY, EMPTY, WALL,  GOAL]
                ];
                return g;
            }
        }
    };

    // ============================================
    // Theme Colors
    // ============================================
    function getColors() {
        const isDark = VizLib.ThemeManager.isDarkTheme();
        return {
            bg:        isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            cellBg:    isDark ? EAIColor('sunken', 'dark') : EAIColor('surface', 'light'),
            gridLine:  isDark ? EAIColor('grid', 'dark') : EAIColor('grid', 'light'),
            text:      isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            textMuted: isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light'),
            agent:     isDark ? EAIColor('blue', 'dark') : EAIColor('blue', 'light'),
            goal:      isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light'),
            wall:      isDark ? EAIColor('canvas', 'dark') : EAIColor('ink-soft', 'light'),
            pit:       isDark ? EAIColor('red', 'dark') : EAIColor('red-mid', 'light'),
            path:      isDark ? EAIColor('blue', 0.3, 'dark') : EAIColor('blue', 0.3),
            arrow:     isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            qPositive: isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light'),
            qNegative: isDark ? EAIColor('red', 'dark') : EAIColor('red-mid', 'light'),
            start:     isDark ? EAIColor('gold', 'dark') : EAIColor('gold-strong', 'light')
        };
    }

    // ============================================
    // Q-Table
    // ============================================
    class QTable {
        constructor(rows, cols) {
            this.rows = rows;
            this.cols = cols;
            // Q[row][col][action]
            this.data = [];
            this.reset();
        }

        reset() {
            this.data = [];
            for (let r = 0; r < this.rows; r++) {
                this.data[r] = [];
                for (let c = 0; c < this.cols; c++) {
                    this.data[r][c] = [0, 0, 0, 0];
                }
            }
        }

        get(r, c, a) {
            return this.data[r][c][a];
        }

        set(r, c, a, val) {
            this.data[r][c][a] = val;
        }

        maxQ(r, c) {
            return Math.max(...this.data[r][c]);
        }

        bestAction(r, c) {
            const qValues = this.data[r][c];
            let best = 0;
            for (let a = 1; a < 4; a++) {
                if (qValues[a] > qValues[best]) {
                    best = a;
                }
            }
            return best;
        }

        globalMaxQ() {
            let maxVal = -Infinity;
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    for (let a = 0; a < 4; a++) {
                        if (this.data[r][c][a] > maxVal) {
                            maxVal = this.data[r][c][a];
                        }
                    }
                }
            }
            return maxVal === -Infinity ? 0 : maxVal;
        }
    }

    // ============================================
    // RL Environment
    // ============================================
    class GridWorld {
        constructor(envKey) {
            const env = ENVIRONMENTS[envKey];
            this.rows = env.rows;
            this.cols = env.cols;
            this.grid = env.build();
            this.startPos = env.start.slice();
            this.agentPos = this.startPos.slice();
        }

        reset() {
            this.agentPos = this.startPos.slice();
            return this.agentPos.slice();
        }

        step(action) {
            const [dr, dc] = ACTION_DELTAS[action];
            let nr = this.agentPos[0] + dr;
            let nc = this.agentPos[1] + dc;

            // Boundary check
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) {
                return { nextState: this.agentPos.slice(), reward: REWARD_WALL, done: false };
            }

            // Wall check
            if (this.grid[nr][nc] === WALL) {
                return { nextState: this.agentPos.slice(), reward: REWARD_WALL, done: false };
            }

            this.agentPos = [nr, nc];
            const cellType = this.grid[nr][nc];

            if (cellType === GOAL) {
                return { nextState: [nr, nc], reward: REWARD_GOAL, done: true };
            }
            if (cellType === PIT) {
                return { nextState: [nr, nc], reward: REWARD_PIT, done: true };
            }

            return { nextState: [nr, nc], reward: REWARD_STEP, done: false };
        }

        isTerminal(r, c) {
            const cell = this.grid[r][c];
            return cell === GOAL || cell === PIT;
        }
    }

    // ============================================
    // Epsilon-Greedy Action Selection
    // ============================================
    function epsilonGreedy(qTable, state, epsilon) {
        if (Math.random() < epsilon) {
            return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
        }
        return qTable.bestAction(state[0], state[1]);
    }

    // ============================================
    // Training: Run One Episode
    // ============================================
    function runEpisodeQLearning(env, qTable, alpha, gamma, epsilon) {
        let state = env.reset();
        let totalReward = 0;
        let steps = 0;
        const path = [state.slice()];

        for (let t = 0; t < MAX_STEPS_PER_EPISODE; t++) {
            const action = epsilonGreedy(qTable, state, epsilon);
            const { nextState, reward, done } = env.step(action);

            const oldQ = qTable.get(state[0], state[1], action);
            const maxNextQ = qTable.maxQ(nextState[0], nextState[1]);
            const newQ = oldQ + alpha * (reward + gamma * maxNextQ - oldQ);
            qTable.set(state[0], state[1], action, newQ);

            totalReward += reward;
            steps++;
            path.push(nextState.slice());
            state = nextState;

            if (done) break;
        }

        return { totalReward, steps, path };
    }

    function runEpisodeSARSA(env, qTable, alpha, gamma, epsilon) {
        let state = env.reset();
        let action = epsilonGreedy(qTable, state, epsilon);
        let totalReward = 0;
        let steps = 0;
        const path = [state.slice()];

        for (let t = 0; t < MAX_STEPS_PER_EPISODE; t++) {
            const { nextState, reward, done } = env.step(action);
            const nextAction = done ? 0 : epsilonGreedy(qTable, nextState, epsilon);

            const oldQ = qTable.get(state[0], state[1], action);
            const nextQ = done ? 0 : qTable.get(nextState[0], nextState[1], nextAction);
            const newQ = oldQ + alpha * (reward + gamma * nextQ - oldQ);
            qTable.set(state[0], state[1], action, newQ);

            totalReward += reward;
            steps++;
            path.push(nextState.slice());
            state = nextState;
            action = nextAction;

            if (done) break;
        }

        return { totalReward, steps, path };
    }

    // ============================================
    // Convergence Detection
    // ============================================
    function checkConvergence(rewardHistory, windowSize) {
        if (rewardHistory.length < windowSize * 2) return false;
        const recent = rewardHistory.slice(-windowSize);
        const prev = rewardHistory.slice(-windowSize * 2, -windowSize);
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgPrev = prev.reduce((a, b) => a + b, 0) / prev.length;
        return Math.abs(avgRecent - avgPrev) < 1;
    }

    // ============================================
    // Canvas Rendering
    // ============================================
    function renderGrid(ctx, dpr, logicalWidth, logicalHeight, world, qTable, agentPos, path, showQValues, showPolicy) {
        const colors = getColors();
        const CU = VizLib.CanvasUtils;

        CU.resetCanvasTransform(ctx, dpr);
        CU.clearCanvas(ctx, logicalWidth, logicalHeight, colors.bg);

        const rows = world.rows;
        const cols = world.cols;

        // Calculate cell size to fit canvas with padding
        const padding = 20;
        const availW = logicalWidth - 2 * padding;
        const availH = logicalHeight - 2 * padding;
        const cellSize = Math.min(availW / cols, availH / rows);
        const gridW = cellSize * cols;
        const gridH = cellSize * rows;
        const offsetX = (logicalWidth - gridW) / 2;
        const offsetY = (logicalHeight - gridH) / 2;

        // Draw grid cells
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = offsetX + c * cellSize;
                const y = offsetY + r * cellSize;
                const cell = world.grid[r][c];

                // Cell background
                let cellColor = colors.cellBg;
                if (cell === WALL) cellColor = colors.wall;
                else if (cell === GOAL) cellColor = colors.goal;
                else if (cell === PIT) cellColor = colors.pit;
                else if (cell === START) cellColor = colors.start;

                ctx.fillStyle = cellColor;
                ctx.fillRect(x, y, cellSize, cellSize);

                // Cell border
                ctx.strokeStyle = colors.gridLine;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, cellSize, cellSize);

                // Cell labels
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (cell === GOAL) {
                    ctx.fillStyle = EAIColor('surface');
                    ctx.font = 'bold 14px sans-serif';
                    ctx.fillText('G', x + cellSize / 2, y + cellSize / 2);
                } else if (cell === PIT) {
                    ctx.fillStyle = EAIColor('surface');
                    ctx.font = 'bold 14px sans-serif';
                    ctx.fillText('X', x + cellSize / 2, y + cellSize / 2);
                } else if (cell === START) {
                    ctx.fillStyle = EAIColor('surface');
                    ctx.font = 'bold 12px sans-serif';
                    ctx.fillText('S', x + cellSize / 2, y + cellSize / 2);
                }

                // Q-value heat map background (subtle)
                if (showQValues && cell !== WALL && cell !== GOAL && cell !== PIT) {
                    const maxQ = qTable.maxQ(r, c);
                    if (maxQ !== 0) {
                        const intensity = Math.min(Math.abs(maxQ) / 50, 0.4);
                        if (maxQ > 0) {
                            ctx.fillStyle = `rgba(76, 175, 80, ${intensity})`;
                        } else {
                            ctx.fillStyle = `rgba(244, 67, 54, ${intensity})`;
                        }
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                    }
                }

                // Q-value text
                if (showQValues && cell !== WALL && cell !== GOAL && cell !== PIT) {
                    ctx.font = '7px ' + 'monospace';
                    const qVals = qTable.data[r][c];
                    const cx = x + cellSize / 2;
                    const cy = y + cellSize / 2;
                    const off = cellSize * 0.3;

                    // Up
                    ctx.fillStyle = qVals[0] >= 0 ? colors.qPositive : colors.qNegative;
                    ctx.fillText(qVals[0].toFixed(1), cx, cy - off);
                    // Right
                    ctx.fillStyle = qVals[1] >= 0 ? colors.qPositive : colors.qNegative;
                    ctx.fillText(qVals[1].toFixed(1), cx + off, cy);
                    // Down
                    ctx.fillStyle = qVals[2] >= 0 ? colors.qPositive : colors.qNegative;
                    ctx.fillText(qVals[2].toFixed(1), cx, cy + off);
                    // Left
                    ctx.fillStyle = qVals[3] >= 0 ? colors.qPositive : colors.qNegative;
                    ctx.fillText(qVals[3].toFixed(1), cx - off, cy);
                }

                // Policy arrows
                if (showPolicy && cell !== WALL && cell !== GOAL && cell !== PIT) {
                    const best = qTable.bestAction(r, c);
                    const allZero = qTable.data[r][c].every(v => v === 0);
                    if (!allZero) {
                        const cx = x + cellSize / 2;
                        const cy = y + cellSize / 2;
                        const arrowLen = cellSize * 0.25;
                        const [dr, dc] = ACTION_DELTAS[best];

                        ctx.strokeStyle = colors.arrow;
                        ctx.lineWidth = 2;
                        ctx.fillStyle = colors.arrow;

                        const ex = cx + dc * arrowLen;
                        const ey = cy + dr * arrowLen;

                        CU.drawLine(ctx, cx, cy, ex, ey, { arrow: true, arrowSize: 6 });
                    }
                }
            }
        }

        // Draw path trail
        if (path && path.length > 1) {
            ctx.strokeStyle = colors.agent;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            for (let i = 0; i < path.length; i++) {
                const px = offsetX + path[i][1] * cellSize + cellSize / 2;
                const py = offsetY + path[i][0] * cellSize + cellSize / 2;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Path dots
            for (let i = 0; i < path.length; i++) {
                const px = offsetX + path[i][1] * cellSize + cellSize / 2;
                const py = offsetY + path[i][0] * cellSize + cellSize / 2;
                ctx.fillStyle = colors.path;
                CU.drawCircle(ctx, px, py, 3, { fill: true });
            }
        }

        // Draw agent
        if (agentPos) {
            const ax = offsetX + agentPos[1] * cellSize + cellSize / 2;
            const ay = offsetY + agentPos[0] * cellSize + cellSize / 2;
            const agentRadius = cellSize * 0.3;

            // Glow effect
            ctx.fillStyle = colors.agent;
            ctx.globalAlpha = 0.3;
            CU.drawCircle(ctx, ax, ay, agentRadius + 4, { fill: true });
            ctx.globalAlpha = 1.0;

            // Agent body
            ctx.fillStyle = colors.agent;
            CU.drawCircle(ctx, ax, ay, agentRadius, { fill: true });

            // Agent label
            ctx.fillStyle = EAIColor('surface');
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('A', ax, ay);
        }
    }

    // ============================================
    // Q-Table Mini Display
    // ============================================
    function renderQTableDisplay(world, qTable) {
        const container = document.getElementById('qtable-display');
        if (!container) return;

        const rows = world.rows;
        const cols = world.cols;

        // Only render mini table for small grids
        if (rows * cols > 30) {
            container.innerHTML = '<p class="text-muted text-center" style="font-size:12px;">Q-table too large to display. Use the canvas Q-Values toggle.</p>';
            return;
        }

        let html = '<div class="qtable-grid" style="grid-template-columns: repeat(' + cols + ', 48px);">';

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = world.grid[r][c];
                let cellClass = 'qtable-cell';
                if (cell === WALL) cellClass += ' wall-cell';
                else if (cell === GOAL) cellClass += ' goal-cell';
                else if (cell === PIT) cellClass += ' pit-cell';

                html += '<div class="' + cellClass + '">';

                if (cell !== WALL && cell !== GOAL && cell !== PIT) {
                    const qVals = qTable.data[r][c];
                    const allZero = qVals.every(v => v === 0);

                    if (!allZero) {
                        const best = qTable.bestAction(r, c);
                        html += '<span class="policy-arrow">' + ARROW_CHARS[best] + '</span>';
                        html += '<span class="q-up ' + (qVals[0] >= 0 ? 'q-positive' : 'q-negative') + '">' + qVals[0].toFixed(0) + '</span>';
                        html += '<span class="q-right ' + (qVals[1] >= 0 ? 'q-positive' : 'q-negative') + '">' + qVals[1].toFixed(0) + '</span>';
                        html += '<span class="q-down ' + (qVals[2] >= 0 ? 'q-positive' : 'q-negative') + '">' + qVals[2].toFixed(0) + '</span>';
                        html += '<span class="q-left ' + (qVals[3] >= 0 ? 'q-positive' : 'q-negative') + '">' + qVals[3].toFixed(0) + '</span>';
                    }
                } else if (cell === GOAL) {
                    html += '<span style="font-weight:bold;color:var(--rl-goal-color);">G</span>';
                } else if (cell === PIT) {
                    html += '<span style="font-weight:bold;color:var(--rl-pit-color);">X</span>';
                }

                html += '</div>';
            }
        }

        html += '</div>';
        container.innerHTML = html;
    }

    // ============================================
    // Main Visualizer
    // ============================================
    class RLVisualizer {
        constructor() {
            this.canvas = document.getElementById('rl-canvas');
            if (!this.canvas) return;

            const setup = VizLib.CanvasUtils.setupHiDPICanvas(this.canvas);
            this.ctx = setup.ctx;
            this.dpr = setup.dpr;
            this.logicalWidth = setup.logicalWidth;
            this.logicalHeight = setup.logicalHeight;

            // Environment & algorithm state
            this.envKey = 'cliff';
            this.algorithm = 'qlearning';
            this.epsilon = 0.10;
            this.alpha = 0.10;
            this.gamma = 0.99;
            this.maxEpisodes = 500;
            this.speed = 5;

            // Display toggles
            this.showQValues = false;
            this.showPolicy = true;

            // Training state
            this.world = null;
            this.qTable = null;
            this.episode = 0;
            this.rewardHistory = [];
            this.currentPath = [];
            this.agentPos = null;
            this.isTraining = false;
            this.isPaused = false;
            this.trainTimer = null;

            this._initEnvironment();
            this._bindControls();
            this._bindThemeChange();
            this.render();
        }

        _initEnvironment() {
            this.world = new GridWorld(this.envKey);
            this.qTable = new QTable(this.world.rows, this.world.cols);
            this.episode = 0;
            this.rewardHistory = [];
            this.currentPath = [];
            this.agentPos = this.world.startPos.slice();
            this._updateMetrics(0, 0);
            renderQTableDisplay(this.world, this.qTable);
        }

        _bindControls() {
            // Environment select
            document.getElementById('env-select').addEventListener('change', (e) => {
                this.envKey = e.target.value;
                this._stopTraining();
                this._initEnvironment();
                this.render();
            });

            // Algorithm select
            document.getElementById('algo-select').addEventListener('change', (e) => {
                this.algorithm = e.target.value;
            });

            // Epsilon slider
            const epsilonSlider = document.getElementById('epsilon-slider');
            const epsilonValue = document.getElementById('epsilon-value');
            epsilonSlider.addEventListener('input', (e) => {
                this.epsilon = parseFloat(e.target.value);
                epsilonValue.textContent = this.epsilon.toFixed(2);
            });

            // Learning rate slider
            const lrSlider = document.getElementById('lr-slider');
            const lrValue = document.getElementById('lr-value');
            lrSlider.addEventListener('input', (e) => {
                this.alpha = parseFloat(e.target.value);
                lrValue.textContent = this.alpha.toFixed(2);
            });

            // Discount slider
            const gammaSlider = document.getElementById('gamma-slider');
            const gammaValue = document.getElementById('gamma-value');
            gammaSlider.addEventListener('input', (e) => {
                this.gamma = parseFloat(e.target.value);
                gammaValue.textContent = this.gamma.toFixed(2);
            });

            // Max episodes stepper
            const episodesValue = document.getElementById('episodes-value');
            document.getElementById('episodes-dec').addEventListener('click', () => {
                this.maxEpisodes = Math.max(100, this.maxEpisodes - 100);
                episodesValue.textContent = this.maxEpisodes;
            });
            document.getElementById('episodes-inc').addEventListener('click', () => {
                this.maxEpisodes = Math.min(5000, this.maxEpisodes + 100);
                episodesValue.textContent = this.maxEpisodes;
            });

            // Speed slider
            const speedSlider = document.getElementById('speed-slider');
            const speedValue = document.getElementById('speed-value');
            speedSlider.addEventListener('input', (e) => {
                this.speed = parseInt(e.target.value);
                speedValue.textContent = this.speed;
            });

            // Display toggles
            document.getElementById('toggle-qvalues').addEventListener('change', (e) => {
                this.showQValues = e.target.checked;
                this.render();
            });
            document.getElementById('toggle-policy').addEventListener('change', (e) => {
                this.showPolicy = e.target.checked;
                this.render();
            });

            // Playback buttons
            document.getElementById('btn-train').addEventListener('click', () => this._startTraining());
            document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
            document.getElementById('btn-step').addEventListener('click', () => this._stepEpisode());
            document.getElementById('btn-reset').addEventListener('click', () => this._resetAll());
        }

        _bindThemeChange() {
            VizLib.ThemeManager.onThemeChange(() => this.render());
        }

        // ---- Training Control ----

        _startTraining() {
            if (this.isTraining && !this.isPaused) return;

            if (this.isPaused) {
                this._togglePause();
                return;
            }

            this.isTraining = true;
            this.isPaused = false;
            document.getElementById('btn-train').disabled = true;
            document.getElementById('btn-pause').disabled = false;
            document.getElementById('btn-step').disabled = true;
            document.getElementById('env-select').disabled = true;

            this._setStatus('Training...');
            this._trainLoop();
        }

        _trainLoop() {
            if (!this.isTraining || this.isPaused) return;
            if (this.episode >= this.maxEpisodes) {
                this._stopTraining();
                this._setStatus('Done (' + this.episode + ' episodes)');
                return;
            }

            // Run a batch of episodes per frame based on speed
            const batchSize = Math.max(1, Math.floor(Math.pow(2, this.speed - 1)));
            for (let i = 0; i < batchSize && this.episode < this.maxEpisodes; i++) {
                this._runOneEpisode();
            }

            this.render();
            renderQTableDisplay(this.world, this.qTable);

            // Check convergence
            if (checkConvergence(this.rewardHistory, 50)) {
                document.getElementById('metric-converged').textContent = 'Yes';
            }

            // Schedule next batch -- speed 1 = 200ms delay, speed 10 = 10ms
            const delay = Math.max(10, 220 - this.speed * 22);
            this.trainTimer = setTimeout(() => this._trainLoop(), delay);
        }

        _runOneEpisode() {
            let result;
            if (this.algorithm === 'qlearning') {
                result = runEpisodeQLearning(this.world, this.qTable, this.alpha, this.gamma, this.epsilon);
            } else {
                result = runEpisodeSARSA(this.world, this.qTable, this.alpha, this.gamma, this.epsilon);
            }

            this.episode++;
            this.rewardHistory.push(result.totalReward);
            this.currentPath = result.path;
            this.agentPos = result.path[result.path.length - 1];

            this._updateMetrics(result.totalReward, result.steps);
        }

        _stepEpisode() {
            if (this.isTraining) return;
            this._runOneEpisode();
            this.render();
            renderQTableDisplay(this.world, this.qTable);

            if (checkConvergence(this.rewardHistory, 50)) {
                document.getElementById('metric-converged').textContent = 'Yes';
            }
            this._setStatus('Stepped (ep ' + this.episode + ')');
        }

        _togglePause() {
            this.isPaused = !this.isPaused;
            const pauseBtn = document.getElementById('btn-pause');

            if (this.isPaused) {
                pauseBtn.innerHTML = '<i class="fa fa-play"></i> Resume';
                clearTimeout(this.trainTimer);
                this._setStatus('Paused');
            } else {
                pauseBtn.innerHTML = '<i class="fa fa-pause"></i> Pause';
                this._setStatus('Training...');
                this._trainLoop();
            }
        }

        _stopTraining() {
            this.isTraining = false;
            this.isPaused = false;
            clearTimeout(this.trainTimer);
            document.getElementById('btn-train').disabled = false;
            document.getElementById('btn-pause').disabled = true;
            document.getElementById('btn-pause').innerHTML = '<i class="fa fa-pause"></i> Pause';
            document.getElementById('btn-step').disabled = false;
            document.getElementById('env-select').disabled = false;
        }

        _resetAll() {
            this._stopTraining();
            this._initEnvironment();
            document.getElementById('metric-converged').textContent = 'No';
            this._setStatus('Ready');
            this.render();
        }

        // ---- Metrics ----

        _updateMetrics(reward, steps) {
            document.getElementById('metric-episode').textContent = this.episode;
            document.getElementById('metric-steps').textContent = steps;
            document.getElementById('metric-reward').textContent = reward.toFixed(2);
            document.getElementById('metric-epsilon').textContent = this.epsilon.toFixed(2);
            document.getElementById('metric-maxq').textContent = this.qTable.globalMaxQ().toFixed(2);

            // Update episode badge
            const badge = document.getElementById('episode-badge');
            if (badge) badge.textContent = 'Episode: ' + this.episode;
        }

        _setStatus(status) {
            document.getElementById('metric-status').textContent = status;
        }

        // ---- Rendering ----

        render() {
            renderGrid(
                this.ctx, this.dpr, this.logicalWidth, this.logicalHeight,
                this.world, this.qTable, this.agentPos, this.currentPath,
                this.showQValues, this.showPolicy
            );
        }
    }

    // ============================================
    // Bootstrap
    // ============================================
    function init() {
        new RLVisualizer();

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

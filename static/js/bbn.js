/**
 * Bayesian Belief Network Visualizer
 * Interactive visualization for probabilistic graphical models
 */
(function() {
    'use strict';

    // Polyfill for roundRect if not supported
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radii) {
            const r = typeof radii === 'number' ? radii : (radii[0] || 0);
            this.moveTo(x + r, y);
            this.lineTo(x + width - r, y);
            this.quadraticCurveTo(x + width, y, x + width, y + r);
            this.lineTo(x + width, y + height - r);
            this.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
            this.lineTo(x + r, y + height);
            this.quadraticCurveTo(x, y + height, x, y + height - r);
            this.lineTo(x, y + r);
            this.quadraticCurveTo(x, y, x + r, y);
            this.closePath();
        };
    }

    // ============================================
    // Example Networks
    // ============================================
    const NETWORKS = {
        alarm: {
            name: 'Alarm Network',
            nodes: [
                { id: 'burglary', name: 'Burglary', values: ['True', 'False'] },
                { id: 'earthquake', name: 'Earthquake', values: ['True', 'False'] },
                { id: 'alarm', name: 'Alarm', values: ['True', 'False'] },
                { id: 'john', name: 'John Calls', values: ['True', 'False'] },
                { id: 'mary', name: 'Mary Calls', values: ['True', 'False'] }
            ],
            edges: [
                { from: 'burglary', to: 'alarm' },
                { from: 'earthquake', to: 'alarm' },
                { from: 'alarm', to: 'john' },
                { from: 'alarm', to: 'mary' }
            ],
            cpts: {
                burglary: { '': [0.001, 0.999] },
                earthquake: { '': [0.002, 0.998] },
                alarm: {
                    'True,True': [0.95, 0.05],
                    'True,False': [0.94, 0.06],
                    'False,True': [0.29, 0.71],
                    'False,False': [0.001, 0.999]
                },
                john: {
                    'True': [0.90, 0.10],
                    'False': [0.05, 0.95]
                },
                mary: {
                    'True': [0.70, 0.30],
                    'False': [0.01, 0.99]
                }
            }
        },
        student: {
            name: 'Student Network',
            nodes: [
                { id: 'difficulty', name: 'Difficulty', values: ['Hard', 'Easy'] },
                { id: 'intelligence', name: 'Intelligence', values: ['High', 'Low'] },
                { id: 'grade', name: 'Grade', values: ['A', 'B', 'C'] },
                { id: 'sat', name: 'SAT', values: ['High', 'Low'] },
                { id: 'letter', name: 'Letter', values: ['Strong', 'Weak'] }
            ],
            edges: [
                { from: 'difficulty', to: 'grade' },
                { from: 'intelligence', to: 'grade' },
                { from: 'intelligence', to: 'sat' },
                { from: 'grade', to: 'letter' }
            ],
            cpts: {
                difficulty: { '': [0.4, 0.6] },
                intelligence: { '': [0.3, 0.7] },
                grade: {
                    'Hard,High': [0.3, 0.4, 0.3],
                    'Hard,Low': [0.05, 0.25, 0.7],
                    'Easy,High': [0.9, 0.08, 0.02],
                    'Easy,Low': [0.5, 0.3, 0.2]
                },
                sat: {
                    'High': [0.95, 0.05],
                    'Low': [0.2, 0.8]
                },
                letter: {
                    'A': [0.9, 0.1],
                    'B': [0.6, 0.4],
                    'C': [0.1, 0.9]
                }
            }
        },
        sprinkler: {
            name: 'Rain/Sprinkler',
            nodes: [
                { id: 'cloudy', name: 'Cloudy', values: ['True', 'False'] },
                { id: 'rain', name: 'Rain', values: ['True', 'False'] },
                { id: 'sprinkler', name: 'Sprinkler', values: ['True', 'False'] },
                { id: 'wet', name: 'Wet Grass', values: ['True', 'False'] }
            ],
            edges: [
                { from: 'cloudy', to: 'rain' },
                { from: 'cloudy', to: 'sprinkler' },
                { from: 'rain', to: 'wet' },
                { from: 'sprinkler', to: 'wet' }
            ],
            cpts: {
                cloudy: { '': [0.5, 0.5] },
                rain: {
                    'True': [0.8, 0.2],
                    'False': [0.2, 0.8]
                },
                sprinkler: {
                    'True': [0.1, 0.9],
                    'False': [0.5, 0.5]
                },
                wet: {
                    'True,True': [0.99, 0.01],
                    'True,False': [0.9, 0.1],
                    'False,True': [0.9, 0.1],
                    'False,False': [0.0, 1.0]
                }
            }
        }
    };

    // ============================================
    // Theme Colors
    // ============================================
    function getColors() {
        const style = getComputedStyle(document.documentElement);
        const get = (prop) => style.getPropertyValue(prop).trim() || null;

        return {
            canvasBg: get('--bbn-canvas-bg') || '#fafafa',
            nodeBg: get('--bbn-node-bg') || '#f5f5f5',
            nodeBorder: get('--bbn-node-border') || '#dee2e6',
            nodeHeader: get('--bbn-node-header') || '#f5f5f5',
            nodeHeaderText: get('--bbn-node-header-text') || '#2c3e50',
            nodeText: get('--bbn-node-text') || '#333333',
            // Evidence True - green
            evidenceTrueBg: get('--bbn-evidence-true-bg') || '#e8f5e9',
            evidenceTrueBorder: get('--bbn-evidence-true-border') || '#4caf50',
            evidenceTrueText: get('--bbn-evidence-true-text') || '#2e7d32',
            // Evidence False - red
            evidenceFalseBg: get('--bbn-evidence-false-bg') || '#ffebee',
            evidenceFalseBorder: get('--bbn-evidence-false-border') || '#f44336',
            evidenceFalseText: get('--bbn-evidence-false-text') || '#c62828',
            // Selected - light blue
            selectedBg: get('--bbn-selected-bg') || '#e3f2fd',
            selectedBorder: get('--bbn-selected-border') || '#2196f3',
            selectedText: get('--bbn-selected-text') || '#1565c0',
            edgeColor: get('--bbn-edge-color') || '#90a4ae',
            edgeArrow: get('--bbn-edge-arrow') || '#607d8b',
            text: get('--bbn-text') || '#333333',
            probBarBg: get('--bbn-prob-bar-bg') || '#e0e0e0',
            probBarFill: get('--bbn-prob-bar-fill') || '#4caf50'
        };
    }

    // ============================================
    // Bayesian Network Visualizer Class
    // ============================================
    class BayesianNetworkVisualizer {
        constructor(canvasId) {
            this.canvas = document.getElementById(canvasId);
            this.ctx = this.canvas.getContext('2d');

            // High DPI support
            this.dpr = window.devicePixelRatio || 1;
            this.setupCanvas();

            this.network = null;
            this.nodePositions = new Map();
            this.evidence = new Map();
            this.posteriors = new Map();
            this.selectedNode = null;
            this.hoveredNode = null;
            this.hoveredRow = null; // {nodeId, valueIndex} for label hover (evidence)
            this.hoveredQueryRow = null; // {nodeId, valueIndex} for percentage hover (query)
            this.hoveredCptCell = null; // {nodeId, rowKey, valueIndex} for CPT cell hover
            this.selectedCptCell = null; // {nodeId, rowKey, valueIndex} for CPT display (not used for calc anymore)
            this.selectedPosterior = null; // {nodeId, valueIndex} for showing posterior calculation
            this.previewAssignment = null; // Map<nodeId, value> for previewing summation term assignments (hover)
            this.selectedSumTerm = null; // {assignment: Map, element: HTMLElement} for clicked/locked summation term
            // Panning state
            this.isPanning = false;
            this.panStart = { x: 0, y: 0 };
            this.panOffset = { x: 0, y: 0 };

            this.nodeWidth = 240; // Wide enough for CPT tables with parent names
            this.baseNodeHeight = 80; // Base height with header + padding
            this.headerHeight = 26;
            this.valueRowHeight = 22; // Height per value row
            this.cptRowHeight = 16; // Height per CPT row
            this.cptHeaderHeight = 18; // Height for CPT column headers
            this.cptSectionPadding = 6; // Padding before CPT section

            this.colors = getColors();

            this.setupEventListeners();
            this.loadNetwork('alarm');
        }

        setupCanvas() {
            const displayWidth = this.canvas.width;
            const displayHeight = this.canvas.height;

            // Set actual canvas size in memory (scaled for high DPI)
            this.canvas.width = displayWidth * this.dpr;
            this.canvas.height = displayHeight * this.dpr;

            // Scale canvas back down with CSS
            this.canvas.style.width = displayWidth + 'px';
            this.canvas.style.height = displayHeight + 'px';

            // Store display dimensions for calculations
            this.displayWidth = displayWidth;
            this.displayHeight = displayHeight;

            // Scale context to match DPI
            this.ctx.scale(this.dpr, this.dpr);
        }

        setupEventListeners() {
            // Canvas mouse events
            this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
            this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
            this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
            this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());

            // Right-click for panning
            this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

            // Theme change
            document.addEventListener('themechange', () => {
                this.colors = getColors();
                this.render();
            });

            // Handle window resize for DPI changes
            window.addEventListener('resize', () => {
                const newDpr = window.devicePixelRatio || 1;
                if (newDpr !== this.dpr) {
                    this.dpr = newDpr;
                    this.setupCanvas();
                    this.render();
                }
            });
        }

        loadNetwork(networkId) {
            const networkDef = NETWORKS[networkId];
            if (!networkDef) return;

            this.network = JSON.parse(JSON.stringify(networkDef)); // Deep copy
            this.evidence.clear();
            this.selectedNode = null;
            this.panOffset = { x: 0, y: 0 }; // Reset pan on network change

            this.calculateNodePositions();
            this.runInference();
            this.render();
            this.updateUI();
        }

        calculateNodePositions() {
            // Use a simple layered layout (topological sort by depth)
            const nodes = this.network.nodes;
            const edges = this.network.edges;

            // Calculate depth for each node
            const depths = new Map();
            const parents = new Map();

            nodes.forEach(n => {
                depths.set(n.id, 0);
                parents.set(n.id, []);
            });

            edges.forEach(e => {
                parents.get(e.to).push(e.from);
            });

            // Iteratively update depths
            let changed = true;
            while (changed) {
                changed = false;
                nodes.forEach(n => {
                    const pars = parents.get(n.id);
                    if (pars.length > 0) {
                        const maxParentDepth = Math.max(...pars.map(p => depths.get(p)));
                        const newDepth = maxParentDepth + 1;
                        if (newDepth > depths.get(n.id)) {
                            depths.set(n.id, newDepth);
                            changed = true;
                        }
                    }
                });
            }

            // Group nodes by depth
            const layers = new Map();
            nodes.forEach(n => {
                const d = depths.get(n.id);
                if (!layers.has(d)) layers.set(d, []);
                layers.get(d).push(n);
            });

            // Calculate max height for each layer
            const layerHeights = new Map();
            layers.forEach((nodesInLayer, depth) => {
                const maxHeight = Math.max(...nodesInLayer.map(n => this.getNodeHeight(n)));
                layerHeights.set(depth, maxHeight);
            });

            // Position nodes with proper vertical spacing based on actual node heights
            const maxDepth = Math.max(...layers.keys());
            const padding = 20;
            const verticalGap = 60; // Gap between layers for edges to be clearly visible

            // Calculate cumulative Y positions - track the BOTTOM of each layer
            let currentBottom = padding; // Start at top padding
            const layerYPositions = new Map();

            for (let depth = 0; depth <= maxDepth; depth++) {
                const layerHeight = layerHeights.get(depth) || 100;
                // Node center is currentBottom + half the node height
                const centerY = currentBottom + layerHeight / 2;
                layerYPositions.set(depth, centerY);
                // Next layer starts after this layer's bottom plus the gap
                currentBottom = currentBottom + layerHeight + verticalGap;
            }

            // Position nodes - space them properly based on node width
            const minGap = 40; // Minimum gap between node edges

            layers.forEach((nodesInLayer, depth) => {
                const y = layerYPositions.get(depth);

                // Calculate total width needed for this layer
                const totalNodesWidth = nodesInLayer.length * this.nodeWidth;
                const totalGapsWidth = (nodesInLayer.length - 1) * minGap;
                const totalLayerWidth = totalNodesWidth + totalGapsWidth;

                // Start position to center the layer
                const startX = (this.displayWidth - totalLayerWidth) / 2 + this.nodeWidth / 2;

                nodesInLayer.forEach((node, i) => {
                    const x = startX + i * (this.nodeWidth + minGap);
                    this.nodePositions.set(node.id, { x, y });
                });
            });
        }

        // ============================================
        // Rendering
        // ============================================
        render() {
            const ctx = this.ctx;

            // Clear canvas (use display dimensions since context is scaled)
            ctx.fillStyle = this.colors.canvasBg;
            ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);

            if (!this.network) return;

            // Apply pan offset
            ctx.save();
            ctx.translate(this.panOffset.x, this.panOffset.y);

            // Draw edges first
            this.network.edges.forEach(edge => this.drawEdge(edge));

            // Draw nodes
            this.network.nodes.forEach(node => this.drawNode(node));

            ctx.restore();
        }

        drawEdge(edge) {
            const ctx = this.ctx;
            const fromPos = this.nodePositions.get(edge.from);
            const toPos = this.nodePositions.get(edge.to);

            if (!fromPos || !toPos) return;

            // Get nodes for dynamic height
            const fromNode = this.network.nodes.find(n => n.id === edge.from);
            const toNode = this.network.nodes.find(n => n.id === edge.to);
            const fromHeight = this.getNodeHeight(fromNode);
            const toHeight = this.getNodeHeight(toNode);

            // Determine edge color based on source node evidence
            let edgeColor = this.colors.edgeColor;
            let arrowColor = this.colors.edgeArrow;
            const sourceEvidence = this.evidence.get(edge.from);
            if (sourceEvidence !== undefined) {
                const isTrue = sourceEvidence.toLowerCase() === 'true';
                const isFalse = sourceEvidence.toLowerCase() === 'false';
                if (isTrue) {
                    edgeColor = this.colors.evidenceTrueBorder;
                    arrowColor = this.colors.evidenceTrueBorder;
                } else if (isFalse) {
                    edgeColor = this.colors.evidenceFalseBorder;
                    arrowColor = this.colors.evidenceFalseBorder;
                } else {
                    edgeColor = this.colors.selectedBorder;
                    arrowColor = this.colors.selectedBorder;
                }
            }

            // Calculate start and end points at node boundaries
            const startY = fromPos.y + fromHeight / 2;
            const endY = toPos.y - toHeight / 2;

            ctx.beginPath();
            ctx.strokeStyle = edgeColor;
            ctx.lineWidth = 2;
            ctx.moveTo(fromPos.x, startY);
            ctx.lineTo(toPos.x, endY);
            ctx.stroke();

            // Draw arrowhead
            const arrowSize = 8;
            const angle = Math.atan2(endY - startY, toPos.x - fromPos.x);

            ctx.beginPath();
            ctx.fillStyle = arrowColor;
            ctx.moveTo(toPos.x, endY);
            ctx.lineTo(
                toPos.x - arrowSize * Math.cos(angle - Math.PI / 6),
                endY - arrowSize * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                toPos.x - arrowSize * Math.cos(angle + Math.PI / 6),
                endY - arrowSize * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
        }

        drawNode(node) {
            const ctx = this.ctx;
            const pos = this.nodePositions.get(node.id);
            if (!pos) return;

            const hasEvidence = this.evidence.has(node.id);
            const evidenceValue = hasEvidence ? this.evidence.get(node.id) : null;
            const isSelected = this.selectedNode === node.id;
            const isHovered = this.hoveredNode === node.id;

            // Choose colors based on state
            let bgColor, borderColor, textColor, headerBg, headerTextColor;
            if (hasEvidence) {
                // Check if evidence is True or False (case-insensitive)
                const isTrue = evidenceValue && evidenceValue.toLowerCase() === 'true';
                const isFalse = evidenceValue && evidenceValue.toLowerCase() === 'false';

                if (isTrue) {
                    // Green for True
                    bgColor = this.colors.evidenceTrueBg;
                    borderColor = this.colors.evidenceTrueBorder;
                    textColor = this.colors.evidenceTrueText;
                    headerBg = this.colors.evidenceTrueBorder;
                    headerTextColor = EAIColor('surface');
                } else if (isFalse) {
                    // Red for False
                    bgColor = this.colors.evidenceFalseBg;
                    borderColor = this.colors.evidenceFalseBorder;
                    textColor = this.colors.evidenceFalseText;
                    headerBg = this.colors.evidenceFalseBorder;
                    headerTextColor = EAIColor('surface');
                } else {
                    // Other values - use selected blue color
                    bgColor = this.colors.selectedBg;
                    borderColor = this.colors.selectedBorder;
                    textColor = this.colors.selectedText;
                    headerBg = this.colors.selectedBorder;
                    headerTextColor = EAIColor('surface');
                }
            } else if (isSelected) {
                // Light blue for selected
                bgColor = this.colors.selectedBg;
                borderColor = this.colors.selectedBorder;
                textColor = this.colors.selectedText;
                headerBg = this.colors.selectedBorder;
                headerTextColor = EAIColor('surface');
            } else {
                bgColor = this.colors.nodeBg;
                borderColor = this.colors.nodeBorder;
                textColor = this.colors.nodeText;
                headerBg = this.colors.nodeHeader;
                headerTextColor = this.colors.nodeHeaderText;
            }

            const nodeHeight = this.getNodeHeight(node);
            const x = pos.x - this.nodeWidth / 2;
            const y = pos.y - nodeHeight / 2;
            const radius = 4;

            // Draw main rounded rectangle (body)
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + this.nodeWidth - radius, y);
            ctx.quadraticCurveTo(x + this.nodeWidth, y, x + this.nodeWidth, y + radius);
            ctx.lineTo(x + this.nodeWidth, y + nodeHeight - radius);
            ctx.quadraticCurveTo(x + this.nodeWidth, y + nodeHeight, x + this.nodeWidth - radius, y + nodeHeight);
            ctx.lineTo(x + radius, y + nodeHeight);
            ctx.quadraticCurveTo(x, y + nodeHeight, x, y + nodeHeight - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();

            ctx.fillStyle = bgColor;
            ctx.fill();
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isHovered || isSelected ? 2 : 1;
            ctx.stroke();

            // Draw header background (navy)
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + this.nodeWidth - radius, y);
            ctx.quadraticCurveTo(x + this.nodeWidth, y, x + this.nodeWidth, y + radius);
            ctx.lineTo(x + this.nodeWidth, y + this.headerHeight);
            ctx.lineTo(x, y + this.headerHeight);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fillStyle = headerBg;
            ctx.fill();

            // Draw node name (left-aligned in header)
            ctx.fillStyle = headerTextColor;
            ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const headerY = y + this.headerHeight / 2;
            ctx.fillText(node.name, x + 8, headerY);

            // Initialize row bounds arrays for click detection
            node._rowBounds = [];      // Left side: label area for setting evidence
            node._queryBounds = [];    // Right side: percentage area for querying

            // Draw probability rows (clickable to set evidence)
            const posterior = this.posteriors.get(node.id);
            const rowPadding = 8;
            const rowHeight = 18;
            const rowSpacing = this.valueRowHeight;
            const bodyStartY = y + this.headerHeight + 6;
            const percentageAreaWidth = 38; // Width of the percentage text area on the right

            node.values.forEach((value, i) => {
                const rowY = bodyStartY + i * rowSpacing;
                const prob = posterior ? posterior[i] : 0;
                const isEvidenceValue = evidenceValue === value;
                const isHoveredRow = this.hoveredRow && this.hoveredRow.nodeId === node.id && this.hoveredRow.valueIndex === i;
                const isHoveredQuery = this.hoveredQueryRow && this.hoveredQueryRow.nodeId === node.id && this.hoveredQueryRow.valueIndex === i;
                const isPreviewValue = this.previewAssignment && this.previewAssignment.get(node.id) === value;

                // Store label bounds for evidence click detection (left side)
                node._rowBounds.push({
                    x: x + 4,
                    y: rowY,
                    width: this.nodeWidth - 8 - percentageAreaWidth,
                    height: rowHeight,
                    value: value,
                    valueIndex: i
                });

                // Store percentage bounds for query click detection (right side)
                node._queryBounds.push({
                    x: x + this.nodeWidth - rowPadding - percentageAreaWidth,
                    y: rowY,
                    width: percentageAreaWidth + rowPadding,
                    height: rowHeight,
                    value: value,
                    valueIndex: i
                });

                // Determine color based on evidence
                let rowColor = this.colors.text;
                if (isEvidenceValue) {
                    const isTrue = value.toLowerCase() === 'true';
                    const isFalse = value.toLowerCase() === 'false';
                    if (isTrue) {
                        rowColor = this.colors.evidenceTrueBorder;
                    } else if (isFalse) {
                        rowColor = this.colors.evidenceFalseBorder;
                    } else {
                        rowColor = this.colors.selectedBorder;
                    }
                }

                // Draw hover/selection/preview background
                if (isEvidenceValue || isHoveredRow || isPreviewValue) {
                    let bgColor;
                    if (isPreviewValue && !isEvidenceValue) {
                        bgColor = EAIColor('gold', 0.3); // Amber/yellow highlight for preview
                    } else if (isEvidenceValue) {
                        bgColor = value.toLowerCase() === 'true' ? this.colors.evidenceTrueBg :
                                  value.toLowerCase() === 'false' ? this.colors.evidenceFalseBg : this.colors.selectedBg;
                    } else {
                        bgColor = 'rgba(0, 0, 0, 0.05)';
                    }
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(x + 4, rowY, this.nodeWidth - 8, rowHeight);

                    // Draw preview border for emphasis on non-evidence values
                    if (isPreviewValue && !isEvidenceValue) {
                        ctx.strokeStyle = EAIColor('gold'); // Amber border
                        ctx.lineWidth = 2;
                        ctx.strokeRect(x + 4, rowY, this.nodeWidth - 8, rowHeight);
                    }

                    // Draw small amber corner indicator for evidence values that are part of preview
                    if (isPreviewValue && isEvidenceValue) {
                        const cornerSize = 8;
                        ctx.fillStyle = EAIColor('gold');
                        ctx.beginPath();
                        ctx.moveTo(x + 4, rowY);
                        ctx.lineTo(x + 4 + cornerSize, rowY);
                        ctx.lineTo(x + 4, rowY + cornerSize);
                        ctx.closePath();
                        ctx.fill();
                    }
                }

                // Draw eye icon on hover (to indicate "observe" action)
                let labelStartX = x + rowPadding;
                if (isHoveredRow && !isEvidenceValue) {
                    ctx.font = '10px FontAwesome';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = EAIColor('axis');
                    ctx.fillText('\uf06e', x + rowPadding, rowY + rowHeight / 2); // fa-eye unicode
                    labelStartX = x + rowPadding + 14; // Shift label right to make room for icon
                }

                // Value label
                ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isEvidenceValue ? rowColor : this.colors.text;
                // Truncate long labels
                const maxLabelWidth = isHoveredRow && !isEvidenceValue ? 41 : 55;
                let labelText = value;
                while (ctx.measureText(labelText).width > maxLabelWidth && labelText.length > 3) {
                    labelText = labelText.substring(0, labelText.length - 1);
                }
                if (labelText !== value) labelText += '..';
                ctx.fillText(labelText, labelStartX, rowY + rowHeight / 2);

                // Probability bar (read-only display of posterior)
                const trackX = x + 65;
                const trackWidth = this.nodeWidth - 65 - 38 - rowPadding; // Leave room for percentage
                const trackHeight = 10;
                const trackY = rowY + (rowHeight - trackHeight) / 2;

                // Track background
                ctx.fillStyle = this.colors.probBarBg;
                ctx.fillRect(trackX, trackY, trackWidth, trackHeight);

                // Track fill
                const fillColor = isEvidenceValue ? rowColor : this.colors.probBarFill;
                ctx.fillStyle = fillColor;
                ctx.fillRect(trackX, trackY, trackWidth * prob, trackHeight);

                // Track border
                ctx.strokeStyle = isEvidenceValue ? rowColor : EAIColor('grid');
                ctx.lineWidth = 1;
                ctx.strokeRect(trackX, trackY, trackWidth, trackHeight);

                // Percentage on right (clickable for query)
                const percentX = x + this.nodeWidth - rowPadding - percentageAreaWidth;
                const isSelectedQuery = this.selectedPosterior &&
                    this.selectedPosterior.nodeId === node.id &&
                    this.selectedPosterior.valueIndex === i;

                // Highlight percentage area if hovered or selected
                if (isHoveredQuery || isSelectedQuery) {
                    ctx.fillStyle = isSelectedQuery ? this.colors.selectedBg : EAIColor('blue', 0.1);
                    ctx.fillRect(percentX, rowY, percentageAreaWidth + rowPadding, rowHeight);
                    if (isSelectedQuery) {
                        ctx.strokeStyle = this.colors.selectedBorder;
                        ctx.lineWidth = 1;
                        ctx.strokeRect(percentX, rowY, percentageAreaWidth + rowPadding, rowHeight);
                    }
                }

                // Draw question mark icon on hover (to indicate "query" action)
                let percentTextX = x + this.nodeWidth - rowPadding;
                if (isHoveredQuery && !isSelectedQuery) {
                    ctx.font = '10px FontAwesome';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = this.colors.selectedBorder;
                    ctx.fillText('\uf059', percentX + 2, rowY + rowHeight / 2); // fa-question-circle unicode
                }

                ctx.font = '10px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isSelectedQuery ? this.colors.selectedText :
                               (isHoveredQuery ? this.colors.selectedBorder : this.colors.text);
                ctx.fillText((prob * 100).toFixed(0) + '%', x + this.nodeWidth - rowPadding, rowY + rowHeight / 2);
            });

            // Draw CPT section
            this.drawCPTSection(node, x, y, bodyStartY + node.values.length * rowSpacing);
        }

        drawCPTSection(node, nodeX, nodeY, startY) {
            const ctx = this.ctx;
            const cpt = this.network.cpts[node.id];
            const parents = this.getParents(node.id);

            // Don't draw CPT for root nodes (no parents)
            if (parents.length === 0) {
                node._cptCellBounds = [];
                return;
            }

            // Initialize CPT cell bounds for click detection
            node._cptCellBounds = [];

            const padding = 6;
            const tablePadding = 4; // Inner padding for table

            let cptY = startY + this.cptSectionPadding;

            // Draw separator line
            ctx.strokeStyle = this.colors.nodeBorder;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodeX + padding, cptY - 2);
            ctx.lineTo(nodeX + this.nodeWidth - padding, cptY - 2);
            ctx.stroke();

            // Calculate table dimensions
            const parentNodes = parents.map(pid => this.network.nodes.find(n => n.id === pid));
            const numParentCols = parents.length;
            const numValueCols = node.values.length;
            const totalCols = numParentCols + numValueCols;

            const tableWidth = this.nodeWidth - padding * 2;
            const colWidth = tableWidth / totalCols; // Equal width columns

            const cptKeys = Object.keys(cpt);
            const numRows = cptKeys.length + 1; // +1 for header
            const tableHeight = numRows * this.cptRowHeight + tablePadding * 2;

            // Draw table background
            ctx.fillStyle = this.colors.nodeBg;
            ctx.fillRect(nodeX + padding, cptY, tableWidth, tableHeight);

            // Draw table border
            ctx.strokeStyle = this.colors.nodeBorder;
            ctx.lineWidth = 1;
            ctx.strokeRect(nodeX + padding, cptY, tableWidth, tableHeight);

            // Draw vertical lines for columns
            for (let i = 1; i < totalCols; i++) {
                const lineX = nodeX + padding + i * colWidth;
                ctx.beginPath();
                ctx.moveTo(lineX, cptY);
                ctx.lineTo(lineX, cptY + tableHeight);
                ctx.stroke();
            }

            // Draw header row background
            const headerY = cptY + tablePadding;
            ctx.fillStyle = this.colors.nodeHeader;
            ctx.fillRect(nodeX + padding + 1, cptY + 1, tableWidth - 2, this.cptRowHeight);

            // Draw header separator line
            ctx.beginPath();
            ctx.moveTo(nodeX + padding, cptY + this.cptRowHeight + tablePadding);
            ctx.lineTo(nodeX + padding + tableWidth, cptY + this.cptRowHeight + tablePadding);
            ctx.stroke();

            // Draw column headers
            ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillStyle = this.colors.nodeHeaderText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let colX = nodeX + padding;
            const headerTextY = headerY + this.cptRowHeight / 2;

            // Parent column headers
            parentNodes.forEach((pNode, i) => {
                const name = this.abbreviateName(pNode.name);
                ctx.fillText(name, colX + colWidth / 2, headerTextY);
                colX += colWidth;
            });

            // Value column headers (P(T), P(F) or just T, F)
            node.values.forEach((value, i) => {
                const abbrev = this.abbreviateValue(value);
                ctx.fillText(abbrev, colX + colWidth / 2, headerTextY);
                colX += colWidth;
            });

            // Get parent evidence values for highlighting
            const parentEvidenceValues = parents.map(pid => this.evidence.get(pid));

            // Draw CPT data rows
            ctx.font = '9px monospace';

            cptKeys.forEach((key, rowIndex) => {
                const rowY = cptY + tablePadding + (rowIndex + 1) * this.cptRowHeight;
                const probs = cpt[key];
                const keyParts = parents.length > 0 ? key.split(',') : [];
                const textY = rowY + this.cptRowHeight / 2;

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = this.colors.text;
                ctx.globalAlpha = 0.7;

                colX = nodeX + padding;

                // Parent values - highlight cells that match evidence
                if (parents.length > 0) {
                    keyParts.forEach((val, i) => {
                        const abbrev = this.abbreviateValue(val);
                        const parentEvidence = parentEvidenceValues[i];
                        const cellMatches = parentEvidence !== undefined && parentEvidence === val;

                        // Highlight the specific cell if it matches parent evidence
                        if (cellMatches) {
                            const cellX = colX;
                            const isTrue = val.toLowerCase() === 'true';
                            const isFalse = val.toLowerCase() === 'false';
                            ctx.save();
                            ctx.globalAlpha = 1.0;
                            // Fill background
                            ctx.fillStyle = isTrue ? this.colors.evidenceTrueBg :
                                           isFalse ? this.colors.evidenceFalseBg : this.colors.selectedBg;
                            ctx.fillRect(cellX + 1, rowY + 1, colWidth - 2, this.cptRowHeight - 1);
                            // Draw border
                            ctx.strokeStyle = isTrue ? this.colors.evidenceTrueBorder :
                                             isFalse ? this.colors.evidenceFalseBorder : this.colors.selectedBorder;
                            ctx.lineWidth = 1.5;
                            ctx.strokeRect(cellX + 1, rowY + 1, colWidth - 2, this.cptRowHeight - 1);
                            // Draw text
                            ctx.fillStyle = isTrue ? this.colors.evidenceTrueText :
                                           isFalse ? this.colors.evidenceFalseText : this.colors.selectedText;
                            ctx.fillText(abbrev, colX + colWidth / 2, textY);
                            ctx.restore();
                        } else {
                            ctx.fillText(abbrev, colX + colWidth / 2, textY);
                        }
                        colX += colWidth;
                    });
                }

                // Probability values (clickable)
                probs.forEach((prob, valIndex) => {
                    const cellX = colX;
                    const probText = (prob * 100).toFixed(0);

                    // Store cell bounds for click detection
                    node._cptCellBounds.push({
                        x: cellX,
                        y: rowY,
                        width: colWidth,
                        height: this.cptRowHeight,
                        nodeId: node.id,
                        rowKey: key,
                        valueIndex: valIndex,
                        prob: prob
                    });

                    // Check if this cell is hovered or selected
                    const isHovered = this.hoveredCptCell &&
                        this.hoveredCptCell.nodeId === node.id &&
                        this.hoveredCptCell.rowKey === key &&
                        this.hoveredCptCell.valueIndex === valIndex;
                    const isSelected = this.selectedCptCell &&
                        this.selectedCptCell.nodeId === node.id &&
                        this.selectedCptCell.rowKey === key &&
                        this.selectedCptCell.valueIndex === valIndex;

                    if (isSelected || isHovered) {
                        ctx.save();
                        ctx.globalAlpha = 1.0;
                        ctx.fillStyle = isSelected ? this.colors.selectedBg : 'rgba(0, 0, 0, 0.08)';
                        ctx.fillRect(cellX + 1, rowY + 1, colWidth - 2, this.cptRowHeight - 1);
                        if (isSelected) {
                            ctx.strokeStyle = this.colors.selectedBorder;
                            ctx.lineWidth = 1.5;
                            ctx.strokeRect(cellX + 1, rowY + 1, colWidth - 2, this.cptRowHeight - 1);
                        }
                        ctx.fillStyle = isSelected ? this.colors.selectedText : this.colors.text;
                        ctx.fillText(probText, colX + colWidth / 2, textY);
                        ctx.restore();
                    } else {
                        ctx.fillText(probText, colX + colWidth / 2, textY);
                    }
                    colX += colWidth;
                });

                ctx.globalAlpha = 1.0;
            });
        }

        abbreviateName(name) {
            // Common abbreviations
            const abbrevs = {
                'Burglary': 'Burg',
                'Earthquake': 'Quake',
                'JohnCalls': 'John',
                'MaryCalls': 'Mary',
                'Intelligence': 'Intel',
                'Difficulty': 'Diff',
                'Sprinkler': 'Sprink',
                'WetGrass': 'Wet'
            };
            if (abbrevs[name]) return abbrevs[name];
            // Show full name if short enough
            if (name.length <= 6) return name;
            // For longer names, truncate
            return name.substring(0, 5);
        }

        abbreviateValue(value) {
            // Abbreviate values for display
            if (value.toLowerCase() === 'true') return 'T';
            if (value.toLowerCase() === 'false') return 'F';
            if (value.toLowerCase() === 'high') return 'H';
            if (value.toLowerCase() === 'low') return 'L';
            if (value.toLowerCase() === 'hard') return 'H';
            if (value.toLowerCase() === 'easy') return 'E';
            if (value.toLowerCase() === 'strong') return 'S';
            if (value.toLowerCase() === 'weak') return 'W';
            if (value.length <= 2) return value;
            return value.charAt(0);
        }

        // ============================================
        // Event Handlers
        // ============================================
        getNodeHeight(node) {
            // Base height for posteriors section
            let height = this.baseNodeHeight + (node.values.length - 2) * this.valueRowHeight;

            // Only add CPT table space for nodes with parents
            const parents = this.getParents(node.id);
            if (parents.length > 0) {
                const cpt = this.network.cpts[node.id];
                const numCptRows = Object.keys(cpt).length;
                const tablePadding = 4;
                const tableHeight = (numCptRows + 1) * this.cptRowHeight + tablePadding * 2;
                height += this.cptSectionPadding + tableHeight + 4;
            }

            return height;
        }

        getNodeAtPosition(x, y) {
            for (const node of this.network.nodes) {
                const pos = this.nodePositions.get(node.id);
                if (!pos) continue;

                const nodeHeight = this.getNodeHeight(node);
                const nx = pos.x - this.nodeWidth / 2;
                const ny = pos.y - nodeHeight / 2;

                if (x >= nx && x <= nx + this.nodeWidth &&
                    y >= ny && y <= ny + nodeHeight) {
                    return node;
                }
            }
            return null;
        }

        getRowAtPosition(x, y, node) {
            if (!node || !node._rowBounds) return null;

            for (const row of node._rowBounds) {
                if (x >= row.x && x <= row.x + row.width &&
                    y >= row.y && y <= row.y + row.height) {
                    return row;
                }
            }
            return null;
        }

        getCptCellAtPosition(x, y, node) {
            if (!node || !node._cptCellBounds) return null;

            for (const cell of node._cptCellBounds) {
                if (x >= cell.x && x <= cell.x + cell.width &&
                    y >= cell.y && y <= cell.y + cell.height) {
                    return cell;
                }
            }
            return null;
        }

        getQueryRowAtPosition(x, y, node) {
            if (!node || !node._queryBounds) return null;

            for (const row of node._queryBounds) {
                if (x >= row.x && x <= row.x + row.width &&
                    y >= row.y && y <= row.y + row.height) {
                    return row;
                }
            }
            return null;
        }

        onMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            // Handle panning
            if (this.isPanning) {
                this.panOffset.x = screenX - this.panStart.x;
                this.panOffset.y = screenY - this.panStart.y;
                this.render();
                return;
            }

            // Convert to world coordinates (account for pan)
            const x = screenX - this.panOffset.x;
            const y = screenY - this.panOffset.y;

            const node = this.getNodeAtPosition(x, y);
            const prevHovered = this.hoveredNode;
            const prevHoveredRow = this.hoveredRow;
            const prevHoveredQueryRow = this.hoveredQueryRow;
            const prevHoveredCptCell = this.hoveredCptCell;
            this.hoveredNode = node ? node.id : null;

            // Check for row hover (label), query hover (percentage), and CPT cell hover
            let cursor = 'grab';
            this.hoveredRow = null;
            this.hoveredQueryRow = null;
            this.hoveredCptCell = null;
            if (node) {
                // First check percentage area (query) - it's on the right
                const queryRow = this.getQueryRowAtPosition(x, y, node);
                if (queryRow) {
                    cursor = 'pointer';
                    this.hoveredQueryRow = { nodeId: node.id, valueIndex: queryRow.valueIndex };
                } else {
                    // Check label area (evidence)
                    const row = this.getRowAtPosition(x, y, node);
                    if (row) {
                        cursor = 'pointer';
                        this.hoveredRow = { nodeId: node.id, valueIndex: row.valueIndex };
                    } else {
                        // Check for CPT cell hover
                        const cptCell = this.getCptCellAtPosition(x, y, node);
                        if (cptCell) {
                            cursor = 'pointer';
                            this.hoveredCptCell = {
                                nodeId: cptCell.nodeId,
                                rowKey: cptCell.rowKey,
                                valueIndex: cptCell.valueIndex
                            };
                        } else {
                            cursor = 'pointer';
                        }
                    }
                }
            }
            this.canvas.style.cursor = cursor;

            // Re-render if hover state changed
            const rowChanged = (prevHoveredRow?.nodeId !== this.hoveredRow?.nodeId ||
                               prevHoveredRow?.valueIndex !== this.hoveredRow?.valueIndex);
            const queryRowChanged = (prevHoveredQueryRow?.nodeId !== this.hoveredQueryRow?.nodeId ||
                                    prevHoveredQueryRow?.valueIndex !== this.hoveredQueryRow?.valueIndex);
            const cptCellChanged = (prevHoveredCptCell?.nodeId !== this.hoveredCptCell?.nodeId ||
                                   prevHoveredCptCell?.rowKey !== this.hoveredCptCell?.rowKey ||
                                   prevHoveredCptCell?.valueIndex !== this.hoveredCptCell?.valueIndex);
            if (this.hoveredNode !== prevHovered || rowChanged || queryRowChanged || cptCellChanged) {
                this.render();
            }
        }

        onMouseDown(e) {
            const rect = this.canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            // Convert to world coordinates (account for pan)
            const x = screenX - this.panOffset.x;
            const y = screenY - this.panOffset.y;

            const node = this.getNodeAtPosition(x, y);

            // If clicking on empty space, start panning
            if (!node) {
                this.isPanning = true;
                this.panStart = {
                    x: screenX - this.panOffset.x,
                    y: screenY - this.panOffset.y
                };
                this.canvas.style.cursor = 'grabbing';
                this.selectedNode = null;
                this.render();
                return;
            }

            // Check if clicked on percentage area - show posterior calculation
            const queryRow = this.getQueryRowAtPosition(x, y, node);
            if (queryRow) {
                this.selectedPosterior = {
                    nodeId: node.id,
                    valueIndex: queryRow.valueIndex
                };
                this.selectedCptCell = null; // Clear CPT selection
                this.selectedNode = node.id;
                this.updateCalcPanel();
                this.render();
                this.switchToCalcTab();
                return;
            }

            // Check if clicked on a value label row - toggle evidence
            const row = this.getRowAtPosition(x, y, node);
            if (row) {
                const currentEvidence = this.evidence.get(node.id);
                if (currentEvidence === row.value) {
                    // Clicking same value again clears evidence
                    this.evidence.delete(node.id);
                } else {
                    // Set evidence to this value
                    this.evidence.set(node.id, row.value);
                }
                this.runInference();
                this.render();
                this.updateUI();
                this.selectedNode = node.id;
                return;
            }

            // Check if clicked on a CPT cell - just highlight it (no calc display)
            const cptCell = this.getCptCellAtPosition(x, y, node);
            if (cptCell) {
                this.selectedCptCell = {
                    nodeId: cptCell.nodeId,
                    rowKey: cptCell.rowKey,
                    valueIndex: cptCell.valueIndex
                };
                this.selectedPosterior = null; // Clear posterior selection
                this.selectedNode = node.id;
                this.render();
                return;
            }

            // Select node
            this.selectedNode = node.id;
            this.render();
        }

        onMouseUp(e) {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = 'grab';
            }
        }

        onMouseLeave() {
            this.hoveredNode = null;
            this.hoveredRow = null;
            this.hoveredQueryRow = null;
            this.hoveredCptCell = null;
            this.render();
        }

        // ============================================
        // Inference (Variable Elimination)
        // ============================================
        runInference() {
            // For each non-evidence node, compute P(X | evidence)
            this.network.nodes.forEach(node => {
                if (this.evidence.has(node.id)) {
                    // For evidence nodes, posterior is deterministic
                    const evidenceValue = this.evidence.get(node.id);
                    const posterior = node.values.map(v => v === evidenceValue ? 1.0 : 0.0);
                    this.posteriors.set(node.id, posterior);
                } else {
                    // Compute posterior using variable elimination
                    const posterior = this.computePosterior(node.id);
                    this.posteriors.set(node.id, posterior);
                }
            });

            this.updatePosteriorsPanel();
        }

        computePosterior(queryNodeId) {
            // Simplified variable elimination
            // For each value of the query variable, compute P(query=value, evidence)
            // Then normalize

            const queryNode = this.network.nodes.find(n => n.id === queryNodeId);
            const unnormalized = [];

            for (const queryValue of queryNode.values) {
                // Set temporary evidence
                const tempEvidence = new Map(this.evidence);
                tempEvidence.set(queryNodeId, queryValue);

                // Compute joint probability by summing over hidden variables
                const prob = this.computeJointProbability(tempEvidence);
                unnormalized.push(prob);
            }

            // Normalize
            const sum = unnormalized.reduce((a, b) => a + b, 0);
            if (sum === 0) return unnormalized.map(() => 1 / unnormalized.length);
            return unnormalized.map(p => p / sum);
        }

        computeJointProbability(evidence) {
            // Get all hidden variables (not in evidence)
            const hiddenNodes = this.network.nodes.filter(n => !evidence.has(n.id));

            if (hiddenNodes.length === 0) {
                // All variables are observed, just compute the product of CPTs
                return this.computeProductOfCPTs(evidence);
            }

            // Sum over all combinations of hidden variables
            const combinations = this.generateCombinations(hiddenNodes);
            let totalProb = 0;

            for (const combo of combinations) {
                const fullAssignment = new Map(evidence);
                hiddenNodes.forEach((node, i) => {
                    fullAssignment.set(node.id, combo[i]);
                });
                totalProb += this.computeProductOfCPTs(fullAssignment);
            }

            return totalProb;
        }

        generateCombinations(nodes) {
            if (nodes.length === 0) return [[]];

            const first = nodes[0];
            const rest = nodes.slice(1);
            const restCombos = this.generateCombinations(rest);

            const result = [];
            for (const value of first.values) {
                for (const combo of restCombos) {
                    result.push([value, ...combo]);
                }
            }
            return result;
        }

        computeProductOfCPTs(assignment) {
            let product = 1;

            for (const node of this.network.nodes) {
                const nodeValue = assignment.get(node.id);
                if (nodeValue === undefined) continue;

                const parents = this.getParents(node.id);
                const cpt = this.network.cpts[node.id];

                // Build parent configuration key
                let parentKey = '';
                if (parents.length > 0) {
                    parentKey = parents.map(p => assignment.get(p)).join(',');
                }

                const probs = cpt[parentKey];
                if (!probs) continue;

                const valueIndex = node.values.indexOf(nodeValue);
                if (valueIndex >= 0 && valueIndex < probs.length) {
                    product *= probs[valueIndex];
                }
            }

            return product;
        }

        getParents(nodeId) {
            return this.network.edges
                .filter(e => e.to === nodeId)
                .map(e => e.from);
        }

        // Get all ancestors of a node (parents, grandparents, etc.)
        getAncestors(nodeId) {
            const ancestors = new Set();
            const queue = this.getParents(nodeId);
            while (queue.length > 0) {
                const parentId = queue.shift();
                if (!ancestors.has(parentId)) {
                    ancestors.add(parentId);
                    // Add this parent's parents to the queue
                    const grandparents = this.getParents(parentId);
                    queue.push(...grandparents);
                }
            }
            return ancestors;
        }

        // ============================================
        // UI Updates
        // ============================================
        updateUI() {
            this.updateStats();
            this.updateEvidenceList();
            this.updatePosteriorsPanel();
            this.updateCalcPanel();
        }

        updateStats() {
            const el = document.getElementById('bbn-nodes');
            if (el) {
                el.textContent = this.network.nodes.length + ' nodes';
            }
        }

        updateEvidenceList() {
            const container = document.getElementById('evidence-list');
            if (!container) return;

            if (this.evidence.size === 0) {
                container.innerHTML = '<span class="text-muted">None</span>';
                return;
            }

            let html = '';
            this.evidence.forEach((value, nodeId) => {
                const node = this.network.nodes.find(n => n.id === nodeId);
                // Determine color class based on True/False value
                const isTrue = value.toLowerCase() === 'true';
                const isFalse = value.toLowerCase() === 'false';
                let colorClass = '';
                if (isTrue) {
                    colorClass = 'evidence-true';
                } else if (isFalse) {
                    colorClass = 'evidence-false';
                }
                html += `<span class="evidence-tag-inline ${colorClass}">
                    <strong>${node.name}</strong>=${value}
                    <span class="evidence-remove-inline" data-node="${nodeId}"><i class="fa fa-times-circle"></i></span>
                </span>`;
            });
            container.innerHTML = html;

            // Add remove handlers
            container.querySelectorAll('.evidence-remove-inline').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nodeId = e.currentTarget.dataset.node;
                    this.evidence.delete(nodeId);
                    this.runInference();
                    this.render();
                    this.updateUI();
                });
            });
        }

        updatePosteriorsPanel() {
            // Posteriors are now displayed directly inside nodes
            // This function is kept for compatibility but does nothing
        }

        switchToCalcTab() {
            // No longer needed - calc panel is always visible below the network
            // Scroll to the calc panel instead
            const calcPanel = document.getElementById('calc-panel');
            if (calcPanel) {
                calcPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        updateCalcPanel() {
            const noCalcMsg = document.getElementById('no-calc-selected');
            const calcContent = document.getElementById('calc-content');
            const titleEl = document.getElementById('calc-title');

            // Clear selected sum term when panel updates
            this.selectedSumTerm = null;
            this.previewAssignment = null;

            if (!this.selectedPosterior) {
                if (noCalcMsg) noCalcMsg.style.display = 'block';
                if (calcContent) calcContent.style.display = 'none';
                if (titleEl) titleEl.textContent = 'Inference Calculation';
                return;
            }

            if (noCalcMsg) noCalcMsg.style.display = 'none';
            if (calcContent) calcContent.style.display = 'block';

            const { nodeId, valueIndex } = this.selectedPosterior;
            const node = this.network.nodes.find(n => n.id === nodeId);
            if (!node) {
                // Node not found - clear selected posterior and show no calc message
                this.selectedPosterior = null;
                if (noCalcMsg) noCalcMsg.style.display = 'block';
                if (calcContent) calcContent.style.display = 'none';
                return;
            }
            const queryValue = node.values[valueIndex];
            const posterior = this.posteriors.get(nodeId);
            const posteriorProb = posterior ? posterior[valueIndex] : 0;

            // Generate visual calculation
            const html = this.generateVisualCalc(nodeId, valueIndex);

            if (titleEl) titleEl.textContent = `Computing P(${node.name} = ${queryValue})`;
            if (calcContent) {
                calcContent.innerHTML = html;
                this.attachSumTermListeners(calcContent);
                this.attachNormToggleListeners(calcContent);
            }
        }

        attachNormToggleListeners(container) {
            // Parse assignment helper
            const parseAssignment = (str) => {
                const assignment = new Map();
                if (!str) return assignment;
                str.split(',').forEach(pair => {
                    const [nodeId, value] = pair.split(':');
                    if (nodeId && value) assignment.set(nodeId, value);
                });
                return assignment;
            };

            // Handle symbolic/numeric toggle button
            const toggleBtn = container.querySelector('.calc-view-toggle');
            const formula = container.querySelector('.calc-norm-formula');
            if (toggleBtn && formula) {
                toggleBtn.addEventListener('click', () => {
                    const currentView = toggleBtn.dataset.view || 'symbolic';
                    const newView = currentView === 'symbolic' ? 'numeric' : 'symbolic';

                    toggleBtn.dataset.view = newView;
                    formula.dataset.view = newView;

                    // Toggle all view spans
                    formula.querySelectorAll('.view-symbolic').forEach(el => {
                        el.style.display = newView === 'symbolic' ? 'inline' : 'none';
                    });
                    formula.querySelectorAll('.view-numeric').forEach(el => {
                        el.style.display = newView === 'numeric' ? 'inline' : 'none';
                    });

                    // Update button appearance
                    toggleBtn.classList.toggle('numeric-active', newView === 'numeric');
                });
            }

            // Handle fraction click to expand/collapse
            const fracDisplay = container.querySelector('.calc-frac-display');
            if (fracDisplay) {
                fracDisplay.addEventListener('click', (e) => {
                    // Don't toggle if clicking on term (for hover highlighting)
                    if (e.target.closest('.calc-term')) return;

                    const isExpanded = fracDisplay.dataset.expanded === 'true';
                    fracDisplay.dataset.expanded = !isExpanded;

                    const compressed = fracDisplay.querySelector('.frac-compressed');
                    const expanded = fracDisplay.querySelector('.frac-expanded');
                    const hint = fracDisplay.querySelector('.frac-expand-hint');

                    if (compressed) compressed.style.display = isExpanded ? 'block' : 'none';
                    if (expanded) expanded.style.display = isExpanded ? 'none' : 'block';
                    if (hint) hint.textContent = isExpanded ? 'click to expand' : 'click to collapse';
                });
            }

            // Handle term hover for network highlighting
            const terms = container.querySelectorAll('.calc-term[data-assignment]');
            terms.forEach(term => {
                term.addEventListener('mouseenter', () => {
                    const assignmentStr = term.dataset.assignment;
                    if (assignmentStr) {
                        this.previewAssignment = parseAssignment(assignmentStr);
                        this.render();
                    }
                });

                term.addEventListener('mouseleave', () => {
                    if (!this.selectedSumTerm) {
                        this.previewAssignment = null;
                        this.render();
                    }
                });

                term.addEventListener('click', () => {
                    const assignmentStr = term.dataset.assignment;
                    if (!assignmentStr) return;

                    const wasSelected = term.classList.contains('selected');
                    terms.forEach(t => t.classList.remove('selected'));

                    if (wasSelected) {
                        this.selectedSumTerm = null;
                        this.previewAssignment = null;
                    } else {
                        term.classList.add('selected');
                        const assignment = parseAssignment(assignmentStr);
                        this.selectedSumTerm = { assignment, element: term };
                        this.previewAssignment = assignment;
                    }
                    this.render();
                });
            });
        }

        attachSumTermListeners(container) {
            const sumTerms = container.querySelectorAll('.calc-sum-term[data-assignment]');
            sumTerms.forEach(term => {
                // Parse assignment helper
                const parseAssignment = (str) => {
                    const assignment = new Map();
                    str.split(',').forEach(pair => {
                        const [nodeId, value] = pair.split(':');
                        assignment.set(nodeId, value);
                    });
                    return assignment;
                };

                term.addEventListener('mouseenter', (e) => {
                    const assignmentStr = term.getAttribute('data-assignment');
                    if (!assignmentStr) return;

                    this.previewAssignment = parseAssignment(assignmentStr);
                    this.render();
                });

                term.addEventListener('mouseleave', () => {
                    // Only clear preview if not the selected term
                    if (!this.selectedSumTerm || this.selectedSumTerm.element !== term) {
                        this.previewAssignment = this.selectedSumTerm ? this.selectedSumTerm.assignment : null;
                    }
                    this.render();
                });

                term.addEventListener('click', (e) => {
                    const assignmentStr = term.getAttribute('data-assignment');
                    if (!assignmentStr) return;

                    // Toggle selection: if already selected, deselect
                    if (this.selectedSumTerm && this.selectedSumTerm.element === term) {
                        this.selectedSumTerm.element.classList.remove('selected');
                        this.selectedSumTerm = null;
                        this.previewAssignment = null;
                    } else {
                        // Deselect previous
                        if (this.selectedSumTerm) {
                            this.selectedSumTerm.element.classList.remove('selected');
                        }
                        // Select new
                        const assignment = parseAssignment(assignmentStr);
                        this.selectedSumTerm = { assignment, element: term };
                        this.previewAssignment = assignment;
                        term.classList.add('selected');
                    }
                    this.render();
                });
            });
        }

        generateVisualCalc(nodeId, valueIndex) {
            const node = this.network.nodes.find(n => n.id === nodeId);
            const queryValue = node.values[valueIndex];
            const posterior = this.posteriors.get(nodeId);
            const posteriorProb = posterior ? posterior[valueIndex] : 0;

            let html = '<div class="calc-visual">';

            // 1. Query header row with proper math notation
            html += `<div class="calc-query-row">`;
            html += `<span class="calc-query-label">Computing:</span>`;
            html += `<span class="calc-query-formula math-formula">`;
            html += `<span class="math-italic">P</span>(`;
            html += `<span class="math-var">${node.name}</span>`;
            html += ` = <span class="math-val">${queryValue}</span>`;
            if (this.evidence.size > 0) {
                html += ` <span class="math-given">|</span> <span class="math-var">E</span>`;
            }
            html += `)</span>`;

            // Show evidence tags
            if (this.evidence.size > 0) {
                html += `<div class="calc-evidence-tags">`;
                this.evidence.forEach((value, evidNodeId) => {
                    const evidNode = this.network.nodes.find(n => n.id === evidNodeId);
                    const colorClass = this.getEvidenceColorClass(value);
                    html += `<span class="calc-evidence-tag ${colorClass}">${evidNode.name}=${value}</span>`;
                });
                html += `</div>`;
            }

            html += `<span class="calc-query-result">${(posteriorProb * 100).toFixed(1)}%</span>`;
            html += `</div>`;

            // Compute the joint probabilities
            const unnormalized = [];
            for (const val of node.values) {
                const tempEvidence = new Map(this.evidence);
                tempEvidence.set(nodeId, val);
                const prob = this.computeJointProbability(tempEvidence);
                unnormalized.push(prob);
            }
            const sumProb = unnormalized.reduce((a, b) => a + b, 0);

            // Show normalization directly (removed Step 1 summation breakdown)
            html += this.renderNormalization(node, queryValue, valueIndex, unnormalized, sumProb, posteriorProb);

            html += '</div>';
            return html;
        }

        getEvidenceColorClass(value) {
            const v = value.toLowerCase();
            if (v === 'true') return 'evidence-true';
            if (v === 'false') return 'evidence-false';
            return 'evidence-other';
        }

        getValueColorClass(value) {
            const v = value.toLowerCase();
            if (v === 'true') return 'math-val-true';
            if (v === 'false') return 'math-val-false';
            return '';
        }

        renderFactorChain(assignment, resultProb) {
            const factors = this.getProductFactors(assignment);
            let html = '<div class="calc-factor-chain">';

            // Show the general formula first
            html += `<div class="calc-general-formula">`;
            html += `<span class="math-formula">`;
            html += `<span class="math-italic">P</span>(<span class="math-var">X</span><sub>1</sub>, ..., <span class="math-var">X</span><sub>n</sub>) = `;
            html += `<span class="math-product">∏</span><sub class="math-subscript"><span class="math-var">i</span></sub> `;
            html += `<span class="math-italic">P</span>(<span class="math-var">X</span><sub>i</sub> <span class="math-given">|</span> <span class="math-fn">pa</span>(<span class="math-var">X</span><sub>i</sub>))`;
            html += `</span>`;
            html += `</div>`;

            // Show the specific factors
            html += `<div class="calc-factors-row">`;
            factors.forEach((factor, i) => {
                if (i > 0) {
                    html += `<span class="calc-operator">×</span>`;
                }

                const isFromEvidence = this.evidence.has(
                    this.network.nodes.find(n => n.name === factor.nodeName)?.id
                );

                html += `<div class="calc-factor ${isFromEvidence ? 'from-evidence' : 'from-cpt'}">`;
                html += `<span class="calc-factor-label">${isFromEvidence ? 'Evidence' : 'From CPT'}</span>`;

                // Build the conditional expression with proper math notation
                html += `<span class="calc-factor-expr math-formula">`;
                html += `<span class="math-italic">P</span>(`;
                html += `<span class="math-var">${factor.nodeName}</span>`;
                html += `<span class="math-val-small">=${factor.value}</span>`;
                if (factor.parents.length > 0) {
                    html += `<span class="math-given">|</span>`;
                    html += factor.parents.map(p =>
                        `<span class="math-var">${p.name}</span><span class="math-val-small">=${p.value}</span>`
                    ).join('<span class="math-comma">,</span>');
                }
                html += `)`;
                html += `</span>`;
                html += `<span class="calc-factor-value">${(factor.prob * 100).toFixed(2)}%</span>`;
                html += `</div>`;
            });

            html += `<span class="calc-equals">=</span>`;
            html += `<div class="calc-chain-result">`;
            html += `<span class="calc-chain-result-label">Joint</span>`;
            html += `<span class="calc-chain-result-value">${resultProb.toExponential(3)}</span>`;
            html += `</div>`;
            html += `</div>`;

            html += '</div>';
            return html;
        }

        renderSummation(baseEvidence, hiddenNodes, totalProb) {
            let html = '<div class="calc-summation">';

            // Show the marginalization formula with proper notation
            html += `<div class="calc-general-formula">`;
            html += `<span class="math-formula">`;
            html += `<span class="math-italic">P</span>(<span class="math-var">Q</span>, <span class="math-var">E</span>) = `;
            html += `<span class="math-sum">∑</span>`;
            html += `<sub class="math-subscript">`;
            html += hiddenNodes.map(n => `<span class="math-var">${n.name}</span>`).join(',');
            html += `</sub> `;
            html += `<span class="math-product">∏</span><sub class="math-subscript"><span class="math-var">i</span></sub> `;
            html += `<span class="math-italic">P</span>(<span class="math-var">X</span><sub>i</sub> <span class="math-given">|</span> <span class="math-fn">pa</span>(<span class="math-var">X</span><sub>i</sub>))`;
            html += `</span>`;
            html += `</div>`;

            // Header showing which variables we're summing over
            html += `<div class="calc-summation-header">`;
            html += `<span class="calc-summation-label">Marginalize over hidden variables:</span>`;
            html += `<div class="calc-hidden-vars">`;
            hiddenNodes.forEach(n => {
                html += `<span class="calc-hidden-var math-var">${n.name}</span>`;
            });
            html += `</div>`;
            html += `</div>`;

            // Show individual terms (limit to first few)
            const combinations = this.generateCombinations(hiddenNodes);
            const maxTerms = Math.min(combinations.length, 4);

            html += `<div class="calc-sum-terms">`;
            for (let i = 0; i < maxTerms; i++) {
                const combo = combinations[i];
                const fullAssignment = new Map(baseEvidence);
                hiddenNodes.forEach((node, j) => {
                    fullAssignment.set(node.id, combo[j]);
                });
                const termResult = this.computeProductOfCPTs(fullAssignment);
                const factors = this.getProductFactors(fullAssignment);

                // Build data attribute with the full assignment (evidence + hidden vars)
                const assignmentData = [];
                fullAssignment.forEach((val, nodeId) => {
                    assignmentData.push(`${nodeId}:${val}`);
                });
                const dataAttr = assignmentData.join(',');

                html += `<div class="calc-sum-term" data-assignment="${dataAttr}">`;
                html += `<span class="calc-sum-term-assignment">`;
                html += hiddenNodes.map((n, j) =>
                    `<span class="math-var">${n.name}</span><span class="math-val-small">=</span><span class="math-val-small ${this.getValueColorClass(combo[j])}">${combo[j]}</span>`
                ).join('<span class="math-comma">, </span>');
                html += `</span>`;
                html += `<span class="calc-sum-term-factors">`;
                html += factors.map(f => {
                    const node = this.network.nodes.find(nd => nd.name === f.nodeName);
                    let factorHtml = `<span class="math-factor">`;
                    factorHtml += `<span class="math-italic">P</span><sub class="math-subscript-small">${f.nodeName}</sub>`;
                    factorHtml += `</span>`;
                    return factorHtml;
                }).join('<span class="math-times">·</span>');
                html += ` = ${factors.map(f => f.prob.toFixed(3)).join(' × ')}`;
                html += `</span>`;
                html += `<span class="calc-sum-term-result">= ${termResult.toExponential(3)}</span>`;
                html += `</div>`;
            }

            if (combinations.length > maxTerms) {
                html += `<div class="calc-sum-term calc-more-terms">`;
                html += `<span class="calc-sum-term-assignment">+ ${combinations.length - maxTerms} more combinations...</span>`;
                html += `</div>`;
            }

            html += `</div>`;

            // Total with sigma notation
            html += `<div class="calc-sum-total">`;
            html += `<span class="calc-sum-total-label">`;
            html += `<span class="math-sum">∑</span> = `;
            html += `</span>`;
            html += `<span class="calc-sum-total-value">${totalProb.toExponential(4)}</span>`;
            html += `</div>`;

            html += '</div>';
            return html;
        }

        renderNormalization(node, queryValue, valueIndex, unnormalized, sumProb, posteriorProb) {
            let html = '<div class="calc-normalization">';

            // Get term details with subscripts for each value of the query variable
            const termDetails = this.getNormalizationTermDetails(node, queryValue, valueIndex);

            // Separate numerator and denominator terms
            const numeratorTerms = termDetails.filter(t => t.queryValueIndex === valueIndex);
            const denominatorTerms = termDetails;

            const queryVarAbbrev = this.getVarAbbrev(node.name);
            const queryValAbbrev = this.getValueAbbrevDisplay(queryValue);

            // Show Bayes theorem formula header with toggle button
            html += `<div class="calc-norm-header">`;
            html += `<span class="calc-norm-query math-formula">`;
            html += `<span class="math-italic">Pr</span>(<span class="math-var">${queryVarAbbrev}</span> = <span class="math-val">${queryValAbbrev}</span>`;
            if (this.evidence.size > 0) {
                html += ` <span class="math-given">|</span> `;
                const evidenceTerms = [];
                this.evidence.forEach((value, nodeId) => {
                    const evidNode = this.network.nodes.find(n => n.id === nodeId);
                    evidenceTerms.push(`<span class="math-var">${this.getVarAbbrev(evidNode.name)}</span> = <span class="math-val">${this.getValueAbbrevDisplay(value)}</span>`);
                });
                html += evidenceTerms.join('<span class="math-comma">, </span>');
            }
            html += `)`;
            html += `</span>`;
            html += `<button class="calc-view-toggle" data-view="symbolic" title="Toggle symbolic/numeric view">`;
            html += `<span class="toggle-symbolic">𝑥</span><span class="toggle-numeric">123</span>`;
            html += `</button>`;
            html += `</div>`;

            // Main formula container
            html += `<div class="calc-norm-formula" data-view="symbolic">`;
            html += this.renderFraction(node, queryValue, valueIndex, numeratorTerms, denominatorTerms, unnormalized, sumProb);
            html += `</div>`;

            // Final result row
            const { numerator: simplifiedNum, denominator: simplifiedDen } = this.simplifyFraction(unnormalized[valueIndex], sumProb);
            html += `<div class="calc-norm-result-row">`;
            html += `<span class="calc-eq">=</span>`;
            html += `<span class="calc-frac-inline"><sup>${simplifiedNum}</sup>⁄<sub>${simplifiedDen}</sub></span>`;
            html += `<span class="calc-eq">≈</span>`;
            html += `<span class="calc-final-percent">${(posteriorProb * 100).toFixed(2)}%</span>`;
            html += `</div>`;

            html += '</div>';
            return html;
        }

        renderFraction(node, queryValue, valueIndex, numeratorTerms, denominatorTerms, unnormalized, sumProb) {
            const queryVarAbbrev = this.getVarAbbrev(node.name);
            const queryValAbbrev = this.getValueAbbrevDisplay(queryValue);

            let html = `<div class="calc-frac-display" data-expanded="false">`;

            // === COMPRESSED VIEW (default) ===
            html += `<div class="frac-compressed">`;

            // Compressed Symbolic numerator: P(Q=q, E) or P(Q=q)
            const numCompressedSym = this.evidence.size > 0
                ? `<span class="math-italic">P</span>(<span class="math-var">${queryVarAbbrev}</span>=<span class="math-val">${queryValAbbrev}</span>, <span class="math-var">E</span>)`
                : `<span class="math-italic">P</span>(<span class="math-var">${queryVarAbbrev}</span>=<span class="math-val">${queryValAbbrev}</span>)`;

            // Compressed Symbolic denominator: P(E) or Σ P(Q)
            let denCompressedSym;
            if (this.evidence.size > 0) {
                denCompressedSym = `<span class="math-italic">P</span>(<span class="math-var">E</span>)`;
            } else {
                denCompressedSym = `<span class="math-sum">Σ</span><sub><span class="math-var">${queryVarAbbrev}</span></sub> <span class="math-italic">P</span>(<span class="math-var">${queryVarAbbrev}</span>)`;
            }

            // Compressed Numeric values
            const numProb = unnormalized[valueIndex];
            const numCompressedNum = `<span class="calc-numeric-term">${numProb.toPrecision(4)}</span>`;
            const denCompressedNum = `<span class="calc-numeric-term">${sumProb.toPrecision(4)}</span>`;

            // Numerator (compressed)
            html += `<div class="calc-frac-num">`;
            html += `<span class="view-symbolic">${numCompressedSym}</span>`;
            html += `<span class="view-numeric" style="display:none">${numCompressedNum}</span>`;
            html += `</div>`;

            // Denominator (compressed)
            html += `<div class="calc-frac-den">`;
            html += `<span class="view-symbolic">${denCompressedSym}</span>`;
            html += `<span class="view-numeric" style="display:none">${denCompressedNum}</span>`;
            html += `</div>`;

            html += `</div>`; // end frac-compressed

            // === EXPANDED VIEW (hidden by default) ===
            html += `<div class="frac-expanded" style="display:none">`;

            // Expanded numerator - show individual terms with subscripts
            html += `<div class="calc-frac-num">`;
            html += `<span class="view-symbolic">`;
            html += numeratorTerms.map(term => this.buildSymbolicTerm(term)).join(' · ');
            html += `</span>`;
            html += `<span class="view-numeric" style="display:none">`;
            html += numeratorTerms.map(term => `<span class="calc-term" data-assignment="${term.assignmentData}">${term.numericExpr}</span>`).join(' × ');
            html += `</span>`;
            html += `</div>`;

            // Expanded denominator - show sum of all terms
            html += `<div class="calc-frac-den">`;
            html += `<span class="view-symbolic">`;
            const denTermsGrouped = [];
            const valueGroups = {};
            denominatorTerms.forEach(term => {
                if (!valueGroups[term.queryValueIndex]) {
                    valueGroups[term.queryValueIndex] = [];
                }
                valueGroups[term.queryValueIndex].push(term);
            });
            Object.values(valueGroups).forEach(group => {
                denTermsGrouped.push(group.map(term => this.buildSymbolicTerm(term)).join(' · '));
            });
            html += denTermsGrouped.join(' + ');
            html += `</span>`;
            html += `<span class="view-numeric" style="display:none">`;
            const denNumericGrouped = [];
            Object.values(valueGroups).forEach(group => {
                denNumericGrouped.push(group.map(term => `<span class="calc-term" data-assignment="${term.assignmentData}">${term.numericExpr}</span>`).join(' × '));
            });
            html += denNumericGrouped.join(' + ');
            html += `</span>`;
            html += `</div>`;

            html += `</div>`; // end frac-expanded

            // Click hint
            html += `<div class="frac-expand-hint">click to expand</div>`;

            html += `</div>`;
            return html;
        }

        buildSymbolicTerm(term) {
            // Build a symbolic term like P(B=T|A=T) with subscript
            let html = `<span class="calc-term" data-assignment="${term.assignmentData}">`;
            html += `<span class="term-symbolic">${term.symbolicExpr}</span>`;
            html += `<sub>${term.subscript}</sub>`;
            html += `</span>`;
            return html;
        }

        // Get detailed term info for normalization display with subscripts
        getNormalizationTermDetails(node, queryValue, queryValueIndex) {
            const termDetails = [];

            // For each possible value of the query variable
            for (let vi = 0; vi < node.values.length; vi++) {
                const qVal = node.values[vi];
                const tempEvidence = new Map(this.evidence);
                tempEvidence.set(node.id, qVal);

                // Find hidden ancestor nodes (nodes we need to marginalize over)
                const ancestors = this.getAncestors(node.id);
                const hiddenNodes = this.network.nodes.filter(n =>
                    ancestors.has(n.id) && !tempEvidence.has(n.id)
                );

                if (hiddenNodes.length === 0) {
                    // No hidden variables - single term
                    const prob = this.computeProductOfCPTs(tempEvidence);
                    const subscript = this.buildSubscript(tempEvidence, node.id);
                    const factors = this.getProductFactors(tempEvidence);
                    const { symbolicExpr, numericExpr } = this.buildTermExpressions(factors);
                    // Build assignment data for network highlighting
                    const assignmentData = this.buildAssignmentData(tempEvidence);
                    termDetails.push({
                        queryValueIndex: vi,
                        prob: prob,
                        subscript: subscript,
                        symbolicExpr: symbolicExpr,
                        numericExpr: numericExpr,
                        assignmentData: assignmentData
                    });
                } else {
                    // Marginalize over hidden variables
                    const combinations = this.generateCombinations(hiddenNodes);
                    for (const combo of combinations) {
                        const fullAssignment = new Map(tempEvidence);
                        hiddenNodes.forEach((n, i) => {
                            fullAssignment.set(n.id, combo[i]);
                        });
                        const prob = this.computeProductOfCPTs(fullAssignment);
                        const subscript = this.buildSubscript(fullAssignment, node.id);
                        const factors = this.getProductFactors(fullAssignment);
                        const { symbolicExpr, numericExpr } = this.buildTermExpressions(factors);
                        // Build assignment data for network highlighting
                        const assignmentData = this.buildAssignmentData(fullAssignment);
                        termDetails.push({
                            queryValueIndex: vi,
                            prob: prob,
                            subscript: subscript,
                            symbolicExpr: symbolicExpr,
                            numericExpr: numericExpr,
                            assignmentData: assignmentData
                        });
                    }
                }
            }

            return termDetails;
        }

        // Build symbolic and numeric expressions for a term
        buildTermExpressions(factors) {
            // Build symbolic: P(C=T) · P(R=T|C=T) · ...
            const symbolicParts = factors.map(f => {
                const varAbbrev = this.getVarAbbrev(f.nodeName);
                const valAbbrev = this.getValueAbbrevDisplay(f.value);
                let expr = `<span class="math-italic">P</span>(<span class="math-var">${varAbbrev}</span>=<span class="math-val-small">${valAbbrev}</span>`;
                if (f.parents.length > 0) {
                    const parentParts = f.parents.map(p => {
                        const pVarAbbrev = this.getVarAbbrev(p.name);
                        const pValAbbrev = this.getValueAbbrevDisplay(p.value);
                        return `<span class="math-var">${pVarAbbrev}</span>=<span class="math-val-small">${pValAbbrev}</span>`;
                    });
                    expr += `<span class="math-given">|</span>${parentParts.join(',')}`;
                }
                expr += `)`;
                return expr;
            });
            const symbolicExpr = symbolicParts.join(' <span class="math-dot">·</span> ');

            // Build numeric: 0.5 × 0.8 × ...
            const numericParts = factors.map(f => f.prob.toPrecision(3));
            const numericExpr = numericParts.join(' × ');

            return { symbolicExpr, numericExpr };
        }

        // Build subscript string (e.g., "TTT" or "TFT") from assignment
        buildSubscript(assignment, queryNodeId) {
            // Get all nodes in topological order that are in the assignment
            const orderedNodes = this.getTopologicalOrder();
            const subscriptParts = [];

            for (const nodeId of orderedNodes) {
                if (assignment.has(nodeId)) {
                    const value = assignment.get(nodeId);
                    subscriptParts.push(this.getValueAbbrevLetter(value));
                }
            }

            return subscriptParts.join('');
        }

        // Build assignment data string for network highlighting (nodeId:value,nodeId:value,...)
        buildAssignmentData(assignment) {
            const parts = [];
            assignment.forEach((value, nodeId) => {
                parts.push(`${nodeId}:${value}`);
            });
            return parts.join(',');
        }

        // Get single letter abbreviation for value (T/F/H/L/etc.)
        getValueAbbrevLetter(value) {
            const v = value.toLowerCase();
            if (v === 'true') return 'T';
            if (v === 'false') return 'F';
            if (v === 'high') return 'H';
            if (v === 'low') return 'L';
            if (v === 'hard') return 'H';
            if (v === 'easy') return 'E';
            if (v === 'strong') return 'S';
            if (v === 'weak') return 'W';
            return value.charAt(0).toUpperCase();
        }

        // Get value abbreviation for display (T/F or full value)
        getValueAbbrevDisplay(value) {
            const v = value.toLowerCase();
            if (v === 'true') return 'T';
            if (v === 'false') return 'F';
            return value;
        }

        // Get variable name abbreviation
        getVarAbbrev(name) {
            // Use first letter for common names
            const abbrevs = {
                'Rain': 'R', 'Sprinkler': 'S', 'Cloudy': 'C', 'Wet Grass': 'G',
                'Burglary': 'B', 'Earthquake': 'E', 'Alarm': 'A',
                'John Calls': 'J', 'Mary Calls': 'M',
                'Intelligence': 'I', 'Difficulty': 'D', 'Grade': 'G',
                'SAT': 'S', 'Letter': 'L'
            };
            return abbrevs[name] || name.charAt(0);
        }

        // Get topological order of nodes
        getTopologicalOrder() {
            const order = [];
            const visited = new Set();

            const visit = (nodeId) => {
                if (visited.has(nodeId)) return;
                visited.add(nodeId);
                const parents = this.getParents(nodeId);
                parents.forEach(p => visit(p));
                order.push(nodeId);
            };

            this.network.nodes.forEach(n => visit(n.id));
            return order;
        }

        // Simplify fraction by finding best integer approximation
        simplifyFraction(numerator, denominator) {
            if (denominator === 0) return { numerator: 0, denominator: 1 };

            const ratio = numerator / denominator;

            // Try to find a nice fraction representation
            // Use continued fraction approximation with reasonable denominator limit
            const maxDenom = 10000;
            let bestNum = Math.round(ratio * maxDenom);
            let bestDen = maxDenom;

            // Find GCD to simplify
            const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
            const g = gcd(Math.abs(bestNum), bestDen);
            bestNum = Math.round(bestNum / g);
            bestDen = Math.round(bestDen / g);

            return { numerator: bestNum, denominator: bestDen };
        }

        generateCalcBreakdown(nodeId, valueIndex, parentValues) {
            const node = this.network.nodes.find(n => n.id === nodeId);
            const queryValue = node.values[valueIndex];

            let html = '';

            // Compute unnormalized joint probabilities for each value
            const unnormalized = [];
            const jointDetails = [];
            for (const val of node.values) {
                const tempEvidence = new Map(this.evidence);
                tempEvidence.set(nodeId, val);
                const { prob, factors } = this.computeJointWithFactors(tempEvidence);
                unnormalized.push(prob);
                jointDetails.push({ value: val, prob, factors });
            }

            const sum = unnormalized.reduce((a, b) => a + b, 0);

            // Show the full equation with numbers for the selected value
            const selectedDetail = jointDetails[valueIndex];
            const selectedProb = unnormalized[valueIndex];
            const posteriorProb = sum > 0 ? selectedProb / sum : 1 / node.values.length;

            // Main equation with actual numbers
            html += `<div class="calc-section">`;
            html += `<h5>Posterior Formula</h5>`;
            html += `<div class="calc-formula-block">`;
            html += `<div class="calc-formula">P(${node.name}=${queryValue} | E) = P(${node.name}=${queryValue}, E) / P(E)</div>`;
            html += `<div class="calc-formula calc-with-numbers">= ${selectedProb.toExponential(3)} / ${sum.toExponential(3)}</div>`;
            html += `<div class="calc-formula calc-result">= <strong>${(posteriorProb * 100).toFixed(2)}%</strong></div>`;
            html += `</div>`;
            html += `</div>`;

            // Show joint probability calculation with actual multiplication
            html += `<div class="calc-section">`;
            html += `<h5>Joint P(${node.name}=${queryValue}, E)</h5>`;
            html += this.showJointCalculation(nodeId, queryValue);
            html += `</div>`;

            // Show P(E) calculation
            html += `<div class="calc-section">`;
            html += `<h5>Normalization P(E)</h5>`;
            html += `<div class="calc-formula-block">`;
            const jointTerms = node.values.map((val, i) => `P(${node.name}=${val}, E)`).join(' + ');
            html += `<div class="calc-formula">P(E) = ${jointTerms}</div>`;
            const numericTerms = unnormalized.map(p => p.toExponential(3)).join(' + ');
            html += `<div class="calc-formula calc-with-numbers">= ${numericTerms}</div>`;
            html += `<div class="calc-formula calc-result">= <strong>${sum.toExponential(4)}</strong></div>`;
            html += `</div>`;
            html += `</div>`;

            // Show all posteriors
            html += `<div class="calc-section">`;
            html += `<h5>All Posteriors</h5>`;
            html += `<table class="calc-table">`;
            node.values.forEach((val, i) => {
                const post = sum > 0 ? unnormalized[i] / sum : 1 / node.values.length;
                const highlight = i === valueIndex ? ' class="calc-highlight"' : '';
                html += `<tr${highlight}>`;
                html += `<td>P(${node.name}=${val} | E)</td>`;
                html += `<td>= ${unnormalized[i].toExponential(3)} / ${sum.toExponential(3)}</td>`;
                html += `<td>= <strong>${(post * 100).toFixed(2)}%</strong></td>`;
                html += `</tr>`;
            });
            html += `</table>`;
            html += `</div>`;

            return html;
        }

        generateCalcBreakdownWithEvidence(nodeId, valueIndex, evidence) {
            const node = this.network.nodes.find(n => n.id === nodeId);
            const queryValue = node.values[valueIndex];

            let html = '';

            // Compute unnormalized joint probabilities for each value using the provided evidence
            const unnormalized = [];
            const jointDetails = [];
            for (const val of node.values) {
                const tempEvidence = new Map(evidence);
                tempEvidence.set(nodeId, val);
                const { prob, factors } = this.computeJointWithFactorsCustom(tempEvidence);
                unnormalized.push(prob);
                jointDetails.push({ value: val, prob, factors });
            }

            const sum = unnormalized.reduce((a, b) => a + b, 0);

            // Show the full equation with numbers for the selected value
            const selectedProb = unnormalized[valueIndex];
            const posteriorProb = sum > 0 ? selectedProb / sum : 1 / node.values.length;

            // Main equation with actual numbers
            html += `<div class="calc-section">`;
            html += `<h5>Posterior Formula</h5>`;
            html += `<div class="calc-formula-block">`;
            html += `<div class="calc-formula">P(${node.name}=${queryValue} | E) = P(${node.name}=${queryValue}, E) / P(E)</div>`;
            html += `<div class="calc-formula calc-with-numbers">= ${selectedProb.toExponential(3)} / ${sum.toExponential(3)}</div>`;
            html += `<div class="calc-formula calc-result">= <strong>${(posteriorProb * 100).toFixed(2)}%</strong></div>`;
            html += `</div>`;
            html += `</div>`;

            // Show joint probability calculation with actual multiplication
            html += `<div class="calc-section">`;
            html += `<h5>Joint P(${node.name}=${queryValue}, E)</h5>`;
            html += this.showJointCalculationWithEvidence(nodeId, queryValue, evidence);
            html += `</div>`;

            // Show P(E) calculation
            html += `<div class="calc-section">`;
            html += `<h5>Normalization P(E)</h5>`;
            html += `<div class="calc-formula-block">`;
            const jointTerms = node.values.map((val, i) => `P(${node.name}=${val}, E)`).join(' + ');
            html += `<div class="calc-formula">P(E) = ${jointTerms}</div>`;
            const numericTerms = unnormalized.map(p => p.toExponential(3)).join(' + ');
            html += `<div class="calc-formula calc-with-numbers">= ${numericTerms}</div>`;
            html += `<div class="calc-formula calc-result">= <strong>${sum.toExponential(4)}</strong></div>`;
            html += `</div>`;
            html += `</div>`;

            // Show all posteriors
            html += `<div class="calc-section">`;
            html += `<h5>All Posteriors</h5>`;
            html += `<table class="calc-table">`;
            node.values.forEach((val, i) => {
                const post = sum > 0 ? unnormalized[i] / sum : 1 / node.values.length;
                const highlight = i === valueIndex ? ' class="calc-highlight"' : '';
                html += `<tr${highlight}>`;
                html += `<td>P(${node.name}=${val} | E)</td>`;
                html += `<td>= ${unnormalized[i].toExponential(3)} / ${sum.toExponential(3)}</td>`;
                html += `<td>= <strong>${(post * 100).toFixed(2)}%</strong></td>`;
                html += `</tr>`;
            });
            html += `</table>`;
            html += `</div>`;

            return html;
        }

        computeJointWithFactorsCustom(evidence) {
            const hiddenNodes = this.network.nodes.filter(n => !evidence.has(n.id));

            if (hiddenNodes.length === 0) {
                const factors = this.getProductFactors(evidence);
                let prob = 1;
                factors.forEach(f => prob *= f.prob);
                return { prob, factors };
            }

            // Sum over hidden variables
            const combinations = this.generateCombinations(hiddenNodes);
            let totalProb = 0;
            const allFactors = [];

            for (const combo of combinations) {
                const fullAssignment = new Map(evidence);
                hiddenNodes.forEach((node, i) => {
                    fullAssignment.set(node.id, combo[i]);
                });
                totalProb += this.computeProductOfCPTs(fullAssignment);
            }

            return { prob: totalProb, factors: allFactors };
        }

        showJointCalculationWithEvidence(queryNodeId, queryValue, evidence) {
            const tempEvidence = new Map(evidence);
            tempEvidence.set(queryNodeId, queryValue);

            const hiddenNodes = this.network.nodes.filter(n => !tempEvidence.has(n.id));

            let html = '';

            if (hiddenNodes.length === 0) {
                // No hidden variables - show direct product
                html += `<div class="calc-formula-block">`;
                html += this.showProductEquation(tempEvidence);
                html += `</div>`;
            } else {
                // Show summation over hidden variables
                const combinations = this.generateCombinations(hiddenNodes);
                html += `<div class="calc-note">Summing over hidden: ${hiddenNodes.map(n => n.name).join(', ')}</div>`;

                let totalSum = 0;
                const maxTerms = Math.min(combinations.length, 6);

                html += `<div class="calc-formula-block">`;
                for (let i = 0; i < maxTerms; i++) {
                    const combo = combinations[i];
                    const fullAssignment = new Map(tempEvidence);
                    hiddenNodes.forEach((node, j) => {
                        fullAssignment.set(node.id, combo[j]);
                    });
                    const termResult = this.computeProductOfCPTs(fullAssignment);
                    totalSum += termResult;

                    const assignLabel = hiddenNodes.map((n, j) => `${n.name}=${combo[j]}`).join(', ');
                    const factors = this.getProductFactors(fullAssignment);
                    const factorNums = factors.map(f => f.prob.toFixed(4)).join(' × ');

                    html += `<div class="calc-term">`;
                    html += `<div class="calc-term-label">${assignLabel}:</div>`;
                    html += `<div class="calc-formula calc-with-numbers">${factorNums} = ${termResult.toExponential(4)}</div>`;
                    html += `</div>`;
                }

                if (combinations.length > maxTerms) {
                    html += `<div class="calc-note">... + ${combinations.length - maxTerms} more terms</div>`;
                }

                // Compute actual total
                for (let i = maxTerms; i < combinations.length; i++) {
                    const combo = combinations[i];
                    const fullAssignment = new Map(tempEvidence);
                    hiddenNodes.forEach((node, j) => {
                        fullAssignment.set(node.id, combo[j]);
                    });
                    totalSum += this.computeProductOfCPTs(fullAssignment);
                }

                html += `<div class="calc-formula calc-result">Sum = <strong>${totalSum.toExponential(4)}</strong></div>`;
                html += `</div>`;
            }

            return html;
        }

        showJointCalculation(queryNodeId, queryValue) {
            const tempEvidence = new Map(this.evidence);
            tempEvidence.set(queryNodeId, queryValue);

            const hiddenNodes = this.network.nodes.filter(n => !tempEvidence.has(n.id));

            let html = '';

            if (hiddenNodes.length === 0) {
                // No hidden variables - show direct product
                html += `<div class="calc-formula-block">`;
                html += this.showProductEquation(tempEvidence);
                html += `</div>`;
            } else {
                // Show summation over hidden variables
                const combinations = this.generateCombinations(hiddenNodes);
                html += `<div class="calc-note">Summing over hidden: ${hiddenNodes.map(n => n.name).join(', ')}</div>`;

                let totalSum = 0;
                const maxTerms = Math.min(combinations.length, 6);

                html += `<div class="calc-formula-block">`;
                for (let i = 0; i < maxTerms; i++) {
                    const combo = combinations[i];
                    const fullAssignment = new Map(tempEvidence);
                    hiddenNodes.forEach((node, j) => {
                        fullAssignment.set(node.id, combo[j]);
                    });
                    const termResult = this.computeProductOfCPTs(fullAssignment);
                    totalSum += termResult;

                    const assignLabel = hiddenNodes.map((n, j) => `${n.name}=${combo[j]}`).join(', ');
                    const factors = this.getProductFactors(fullAssignment);
                    const factorNums = factors.map(f => f.prob.toFixed(4)).join(' × ');

                    html += `<div class="calc-term">`;
                    html += `<div class="calc-term-label">${assignLabel}:</div>`;
                    html += `<div class="calc-formula calc-with-numbers">${factorNums} = ${termResult.toExponential(4)}</div>`;
                    html += `</div>`;
                }

                if (combinations.length > maxTerms) {
                    html += `<div class="calc-note">... + ${combinations.length - maxTerms} more terms</div>`;
                }

                // Compute actual total
                for (let i = maxTerms; i < combinations.length; i++) {
                    const combo = combinations[i];
                    const fullAssignment = new Map(tempEvidence);
                    hiddenNodes.forEach((node, j) => {
                        fullAssignment.set(node.id, combo[j]);
                    });
                    totalSum += this.computeProductOfCPTs(fullAssignment);
                }

                html += `<div class="calc-formula calc-result">Sum = <strong>${totalSum.toExponential(4)}</strong></div>`;
                html += `</div>`;
            }

            return html;
        }

        showProductEquation(assignment) {
            const factors = this.getProductFactors(assignment);
            let product = 1;

            let html = '<div class="calc-product">';

            // Show the symbolic equation
            const symbolicParts = factors.map(f => {
                const parentStr = f.parents.length > 0 ?
                    `|${f.parents.map(p => `${p.name}=${p.value}`).join(',')}` : '';
                return `P(${f.nodeName}=${f.value}${parentStr})`;
            });
            html += `<div class="calc-formula">${symbolicParts.join(' × ')}</div>`;

            // Show the numeric equation
            const numericParts = factors.map(f => f.prob.toFixed(4));
            html += `<div class="calc-formula calc-with-numbers">= ${numericParts.join(' × ')}</div>`;

            // Show the result
            factors.forEach(f => product *= f.prob);
            html += `<div class="calc-formula calc-result">= <strong>${product.toExponential(4)}</strong></div>`;

            html += '</div>';
            return html;
        }

        getProductFactors(assignment) {
            const factors = [];

            for (const node of this.network.nodes) {
                const nodeValue = assignment.get(node.id);
                if (nodeValue === undefined) continue;

                const parents = this.getParents(node.id);
                const cpt = this.network.cpts[node.id];

                let parentKey = '';
                const parentInfo = [];
                if (parents.length > 0) {
                    parentKey = parents.map(p => assignment.get(p)).join(',');
                    parents.forEach(p => {
                        const pn = this.network.nodes.find(n => n.id === p);
                        parentInfo.push({ name: pn.name, value: assignment.get(p) });
                    });
                }

                const probs = cpt[parentKey];
                if (!probs) continue;

                const valueIndex = node.values.indexOf(nodeValue);
                if (valueIndex >= 0 && valueIndex < probs.length) {
                    factors.push({
                        nodeName: node.name,
                        value: nodeValue,
                        parents: parentInfo,
                        prob: probs[valueIndex]
                    });
                }
            }

            return factors;
        }

        computeJointWithFactors(evidence) {
            const hiddenNodes = this.network.nodes.filter(n => !evidence.has(n.id));

            if (hiddenNodes.length === 0) {
                const factors = this.getProductFactors(evidence);
                let prob = 1;
                factors.forEach(f => prob *= f.prob);
                return { prob, factors };
            }

            // Sum over hidden variables
            const combinations = this.generateCombinations(hiddenNodes);
            let totalProb = 0;
            const allFactors = [];

            for (const combo of combinations) {
                const fullAssignment = new Map(evidence);
                hiddenNodes.forEach((node, i) => {
                    fullAssignment.set(node.id, combo[i]);
                });
                totalProb += this.computeProductOfCPTs(fullAssignment);
            }

            return { prob: totalProb, factors: allFactors };
        }

        clearEvidence() {
            this.evidence.clear();
            this.selectedCptCell = null;
            this.selectedPosterior = null;
            this.runInference();
            this.render();
            this.updateUI();
            this.updateCalcPanel();
        }

    }

    // ============================================
    // Initialization
    // ============================================
    let visualizer = null;

    function init() {
        visualizer = new BayesianNetworkVisualizer('bbn-canvas');
        window.bbnViz = visualizer; // Expose for testing

        // Network selector
        document.getElementById('network-select').addEventListener('change', (e) => {
            visualizer.loadNetwork(e.target.value);
        });

        // Reset button
        document.getElementById('btn-reset').addEventListener('click', () => {
            visualizer.clearEvidence();
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
    }

    // Wait for DOM and VizLib
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

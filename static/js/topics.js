(function() {
    'use strict';

    var dataEl = document.getElementById('topics-graph-data');
    if (!dataEl) return;

    var graphData = JSON.parse(dataEl.textContent);
    var container = document.getElementById('topics-graph-container');
    if (!container || !graphData.nodes.length) return;

    var isCompact = container.classList.contains('topics-graph--compact');

    // Group color palette
    var groupColors = {
        'Foundations':    { light: EAIColor('blue-mid'), dark: EAIColor('blue', 'dark') },
        'Neural Networks':{ light: EAIColor('red'), dark: EAIColor('red', 'dark') },
        'NLP':           { light: EAIColor('green'), dark: EAIColor('green', 'dark') },
        'Vision':        { light: EAIColor('gold-mid'), dark: EAIColor('gold', 'dark') },
        'Generative AI': { light: EAIColor('purple'), dark: EAIColor('purple', 'dark') },
        'Applied':       { light: EAIColor('blue-mid'), dark: EAIColor('green-mid', 'dark') }
    };
    var defaultColor = { light: EAIColor('axis'), dark: EAIColor('muted', 'dark') };

    function getColor(group) {
        var colors = groupColors[group] || defaultColor;
        var theme = document.documentElement.getAttribute('data-theme');
        return theme === 'gruvbox-dark' ? colors.dark : colors.light;
    }

    // Size mapping
    var sizeScale = isCompact
        ? { 1: 8, 2: 13, 3: 18 }
        : { 1: 12, 2: 20, 3: 28 };

    function nodeRadius(d) {
        return sizeScale[d.size] || sizeScale[1];
    }

    // --- SVG setup ---
    var rect = container.getBoundingClientRect();
    var width = rect.width || 800;
    var height = rect.height || (isCompact ? 400 : 600);

    var svg = d3.select(container).append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', '0 0 ' + width + ' ' + height);

    var g = svg.append('g');

    // Zoom
    var zoom = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', function(event) {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    // Build node/link data (deep copy so D3 can mutate)
    var nodes = graphData.nodes.map(function(n) { return Object.assign({}, n); });
    var links = graphData.links.map(function(l) { return { source: l.source, target: l.target }; });

    // --- Force simulation ---
    var simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(function(d) {
            return 60 + (nodeRadius(d.source) + nodeRadius(d.target));
        }))
        .force('charge', d3.forceManyBody().strength(isCompact ? -120 : -200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide().radius(function(d) { return nodeRadius(d) + 6; }));

    // --- Render links ---
    var linkGroup = g.append('g').attr('class', 'topics-links');
    var linkEls = linkGroup.selectAll('line')
        .data(links)
        .join('line')
        .attr('class', 'topics-link');

    // --- Render nodes ---
    var nodeGroup = g.append('g').attr('class', 'topics-nodes');
    var nodeEls = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'topics-node');

    nodeEls.append('circle')
        .attr('r', function(d) { return nodeRadius(d); })
        .attr('fill', function(d) { return getColor(d.group); })
        .attr('stroke', EAIColor('surface'))
        .attr('stroke-width', 1.5);

    nodeEls.append('text')
        .attr('dy', function(d) { return nodeRadius(d) + 14; })
        .attr('text-anchor', 'middle')
        .attr('class', 'topics-node-label')
        .text(function(d) { return d.name; });

    // --- Click / Expand state ---
    var expandedNode = null;
    var expandedPanel = null;
    var justClickedNode = false;

    // Drag behavior
    var dragStartX = 0;
    var dragStartY = 0;

    var drag = d3.drag()
        .on('start', function(event, d) {
            dragStartX = event.x;
            dragStartY = event.y;
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on('drag', function(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on('end', function(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;

            // If movement was very small, treat as a click
            var dx = event.x - dragStartX;
            var dy = event.y - dragStartY;
            if (dx * dx + dy * dy < 25) {
                justClickedNode = true;
                var el = this;
                setTimeout(function() { justClickedNode = false; }, 50);

                if (expandedNode === d.id) {
                    collapseNode();
                } else {
                    expandNode(d, el);
                }
            }
        });

    nodeEls.call(drag);

    // Background click to collapse (but not if a node was just clicked)
    svg.on('click', function() {
        if (justClickedNode) return;
        collapseNode();
    });

    function expandNode(d, el) {
        collapseNode();
        expandedNode = d.id;

        // Highlight connected nodes
        var connectedIds = new Set([d.id]);
        links.forEach(function(l) {
            var srcId = typeof l.source === 'object' ? l.source.id : l.source;
            var tgtId = typeof l.target === 'object' ? l.target.id : l.target;
            if (srcId === d.id) connectedIds.add(tgtId);
            if (tgtId === d.id) connectedIds.add(srcId);
        });

        nodeEls.classed('topics-node--dimmed', function(n) { return !connectedIds.has(n.id); });
        linkEls.classed('topics-link--dimmed', function(l) {
            var srcId = typeof l.source === 'object' ? l.source.id : l.source;
            var tgtId = typeof l.target === 'object' ? l.target.id : l.target;
            return srcId !== d.id && tgtId !== d.id;
        });

        // Grow circle
        d3.select(el).select('circle')
            .transition().duration(300)
            .attr('r', nodeRadius(d) * 1.6);

        // Build panel content
        var panelHtml = '<div class="topics-expand-panel">';
        panelHtml += '<strong>' + escapeHtml(d.name) + '</strong>';
        if (d.description) {
            panelHtml += '<p>' + escapeHtml(d.description) + '</p>';
        }
        if (d.resources && d.resources.length) {
            panelHtml += '<div class="topics-expand-links">';
            d.resources.forEach(function(url) {
                panelHtml += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Resource <i class="fa fa-external-link"></i></a>';
            });
            panelHtml += '</div>';
        }
        if (d.visualization) {
            panelHtml += '<a class="topics-viz-link" href="' + escapeHtml(d.visualization) + '">View Visualization &rarr;</a>';
        }
        panelHtml += '</div>';

        var panelWidth = isCompact ? 200 : 260;
        var panelHeight = isCompact ? 120 : 160;

        expandedPanel = g.append('foreignObject')
            .attr('class', 'topics-expand-fo')
            .attr('x', d.x + nodeRadius(d) + 10)
            .attr('y', d.y - panelHeight / 2)
            .attr('width', panelWidth)
            .attr('height', panelHeight + 40)
            .html(panelHtml);
    }

    function collapseNode() {
        if (!expandedNode) return;
        expandedNode = null;

        nodeEls.classed('topics-node--dimmed', false);
        linkEls.classed('topics-link--dimmed', false);
        nodeEls.select('circle')
            .transition().duration(300)
            .attr('r', function(d) { return nodeRadius(d); });

        if (expandedPanel) {
            expandedPanel.remove();
            expandedPanel = null;
        }
    }

    // --- Tick ---
    simulation.on('tick', function() {
        linkEls
            .attr('x1', function(d) { return d.source.x; })
            .attr('y1', function(d) { return d.source.y; })
            .attr('x2', function(d) { return d.target.x; })
            .attr('y2', function(d) { return d.target.y; });

        nodeEls.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

        // Move expanded panel if it exists
        if (expandedPanel && expandedNode) {
            var nd = nodes.find(function(n) { return n.id === expandedNode; });
            if (nd) {
                expandedPanel
                    .attr('x', nd.x + nodeRadius(nd) + 10)
                    .attr('y', nd.y - 60);
            }
        }
    });

    // --- Search (full page only) ---
    var searchInput = document.getElementById('topics-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var term = this.value.toLowerCase().trim();
            if (!term) {
                nodeEls.classed('topics-node--dimmed', false);
                linkEls.classed('topics-link--dimmed', false);
                return;
            }

            var matchIds = new Set();
            nodes.forEach(function(n) {
                if (n.name.toLowerCase().indexOf(term) !== -1 || n.group.toLowerCase().indexOf(term) !== -1) {
                    matchIds.add(n.id);
                }
            });

            // Also include directly connected nodes
            var connectedIds = new Set(matchIds);
            links.forEach(function(l) {
                var srcId = typeof l.source === 'object' ? l.source.id : l.source;
                var tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                if (matchIds.has(srcId)) connectedIds.add(tgtId);
                if (matchIds.has(tgtId)) connectedIds.add(srcId);
            });

            nodeEls.classed('topics-node--dimmed', function(n) { return !matchIds.has(n.id); });
            linkEls.classed('topics-link--dimmed', function(l) {
                var srcId = typeof l.source === 'object' ? l.source.id : l.source;
                var tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                return !matchIds.has(srcId) && !matchIds.has(tgtId);
            });
        });
    }

    // --- Theme change handler ---
    document.addEventListener('themechange', function() {
        nodeEls.select('circle')
            .transition().duration(300)
            .attr('fill', function(d) { return getColor(d.group); });
    });

    // --- Resize handler ---
    var resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            var r = container.getBoundingClientRect();
            var w = r.width || 800;
            var h = r.height || (isCompact ? 400 : 600);
            svg.attr('viewBox', '0 0 ' + w + ' ' + h);
            simulation.force('center', d3.forceCenter(w / 2, h / 2));
            simulation.alpha(0.3).restart();
        }, 250);
    });

    // --- Legend (full page only) ---
    var legendContainer = document.getElementById('topics-legend');
    if (legendContainer) {
        graphData.groups.forEach(function(group) {
            var item = document.createElement('span');
            item.className = 'topics-legend-item';
            var swatch = document.createElement('span');
            swatch.className = 'topics-legend-swatch';
            swatch.style.backgroundColor = getColor(group);
            swatch.setAttribute('data-group', group);
            item.appendChild(swatch);
            item.appendChild(document.createTextNode(' ' + group));
            legendContainer.appendChild(item);
        });

        // Update swatches on theme change
        document.addEventListener('themechange', function() {
            var swatches = legendContainer.querySelectorAll('.topics-legend-swatch');
            swatches.forEach(function(sw) {
                sw.style.backgroundColor = getColor(sw.getAttribute('data-group'));
            });
        });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
})();

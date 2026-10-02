/**
 * Dimensionality Reduction Visualizer
 *
 * Interactive visualization of image datasets projected into 2D
 * using PCA, t-SNE, and UMAP algorithms.
 *
 * Supports two datasets:
 * 1. MNIST - 28x28 grayscale handwritten digits (0-9)
 * 2. CIFAR-10 - 32x32 RGB images of 10 object classes
 *
 * For each dataset, supports two data sources:
 * 1. Raw pixels - direct pixel vector to 2D projection
 * 2. CNN embeddings - learned features with training evolution
 */

(function() {
    'use strict';

    // ============================================
    // Constants (using shared ThemeManager for colors)
    // ============================================

    // Get ThemeManager from shared library (loaded via base.njk)
    const getThemeManager = () => window.VizLib?.ThemeManager;

    // Helper to get colors based on current theme
    const getColors = (isDark) => {
        const TM = getThemeManager();
        if (TM) {
            return TM.getColors('categorical');
        }
        // Fallback if VizLib not loaded yet
        return isDark ? [
            EAIColor('class-0', 'dark'), EAIColor('class-1', 'dark'), EAIColor('class-2', 'dark'), EAIColor('class-3', 'dark'), EAIColor('class-4', 'dark'),
            EAIColor('class-5', 'dark'), EAIColor('class-6', 'dark'), EAIColor('class-7', 'dark'), EAIColor('class-8', 'dark'), EAIColor('class-9', 'dark')
        ] : [
            EAIColor('class-0', 'light'), EAIColor('class-1', 'light'), EAIColor('class-2', 'light'), EAIColor('class-3', 'light'), EAIColor('class-4', 'light'),
            EAIColor('class-5', 'light'), EAIColor('class-6', 'light'), EAIColor('class-7', 'light'), EAIColor('class-8', 'light'), EAIColor('class-9', 'light')
        ];
    };

    // Labels use shared ThemeManager when available
    const getLabels = (dataset) => {
        const TM = getThemeManager();
        if (TM) {
            return TM.getLabels(dataset);
        }
        // Fallback
        return dataset === 'cifar10'
            ? ['airplane', 'automobile', 'bird', 'cat', 'deer', 'dog', 'frog', 'horse', 'ship', 'truck']
            : ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    };

    // Data URLs
    // Embeddings and images are split for lazy loading
    // Images are only loaded on first hover to improve initial load time
    const DATA_URLS = {
        mnist: {
            raw: 'static/json/mnist-embeddings.json',
            rawImages: 'static/json/mnist-embeddings-images.json',
            cnn: 'static/json/mnist-training-embeddings.json',
            cnnImages: 'static/json/mnist-training-embeddings-images.json'
        },
        cifar10: {
            raw: 'static/json/cifar10-embeddings.json',
            rawImages: 'static/json/cifar10-embeddings-images.json',
            cnn: 'static/json/cifar10-training-embeddings.json',
            cnnImages: 'static/json/cifar10-training-embeddings-images.json'
        }
    };

    // ============================================
    // Quadtree for efficient point lookup (uses shared VizLib.Quadtree)
    // ============================================

    const getQuadtreeClass = () => window.VizLib.Quadtree;

    // ============================================
    // Data Manager
    // ============================================

    class DataManager {
        constructor() {
            this.currentDataset = 'mnist';  // 'mnist' or 'cifar10'
            this.rawData = { mnist: null, cifar10: null };
            this.cnnData = { mnist: null, cifar10: null };
            // Images are lazy-loaded separately for faster initial load
            this.rawImages = { mnist: null, cifar10: null };
            this.cnnImages = { mnist: null, cifar10: null };
            this.currentSource = 'cnn';  // 'raw' or 'cnn'
            this.currentSnapshotIndex = 0;
            this.currentAlgorithm = 'tsne';
            this.visibleClasses = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            this.highlightedClass = null;
            this._imagesLoading = { raw: {}, cnn: {} };  // Track loading state per dataset
        }

        async loadRawData() {
            const dataset = this.currentDataset;
            if (this.rawData[dataset]) return;
            const url = DATA_URLS[dataset].raw;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load raw data: ${response.statusText}`);
            this.rawData[dataset] = await response.json();
        }

        async loadCNNData() {
            const dataset = this.currentDataset;
            if (this.cnnData[dataset]) return;
            const url = DATA_URLS[dataset].cnn;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load CNN data: ${response.statusText}`);
            this.cnnData[dataset] = await response.json();
        }

        // Lazy load images for the current dataset/source
        async loadImages() {
            const dataset = this.currentDataset;
            const source = this.currentSource;
            const imagesStore = source === 'raw' ? this.rawImages : this.cnnImages;
            const loadingStore = this._imagesLoading[source];

            // Already loaded
            if (imagesStore[dataset]) return imagesStore[dataset];

            // Already loading - wait for it
            if (loadingStore[dataset]) return loadingStore[dataset];

            // Start loading
            const url = source === 'raw' ?
                DATA_URLS[dataset].rawImages :
                DATA_URLS[dataset].cnnImages;

            loadingStore[dataset] = (async () => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to load images: ${response.statusText}`);
                imagesStore[dataset] = await response.json();
                return imagesStore[dataset];
            })();

            return loadingStore[dataset];
        }

        // Get image for a sample (may be undefined if images not loaded yet)
        getImage(sampleIndex) {
            const dataset = this.currentDataset;
            const images = this.currentSource === 'raw' ?
                this.rawImages[dataset] :
                this.cnnImages[dataset];
            return images?.[sampleIndex];
        }

        // Check if images are loaded
        hasImages() {
            const dataset = this.currentDataset;
            const images = this.currentSource === 'raw' ?
                this.rawImages[dataset] :
                this.cnnImages[dataset];
            return images !== null;
        }

        setDataset(dataset) {
            this.currentDataset = dataset;
            this.currentSnapshotIndex = 0;
        }

        setSource(source) {
            this.currentSource = source;
        }

        setSnapshotIndex(index) {
            this.currentSnapshotIndex = index;
        }

        getCurrentSamples() {
            const dataset = this.currentDataset;
            if (this.currentSource === 'raw') {
                const samples = this.rawData[dataset]?.samples || [];
                // Add index for image lookup if not already present
                if (samples.length > 0 && samples[0].idx === undefined) {
                    samples.forEach((s, i) => s.idx = i);
                }
                return samples;
            } else {
                const cnnData = this.cnnData[dataset];
                if (!cnnData) return [];

                const snapshots = cnnData.snapshots || [];
                const snapshot = snapshots[this.currentSnapshotIndex];
                if (!snapshot) return [];

                // New format: samples stored separately, snapshots have only embeddings
                if (cnnData.samples && snapshot.embeddings) {
                    // Cache merged samples to avoid recreating on every call
                    const cacheKey = `${dataset}_${this.currentSnapshotIndex}`;
                    if (this._samplesCache?.key === cacheKey) {
                        return this._samplesCache.samples;
                    }

                    // Merge sample data with snapshot embeddings, include index for image lookup
                    const mergedSamples = cnnData.samples.map((sample, i) => ({
                        ...sample,
                        idx: i,
                        embeddings: snapshot.embeddings[i]
                    }));

                    this._samplesCache = { key: cacheKey, samples: mergedSamples };
                    return mergedSamples;
                }

                // Legacy format: samples embedded in snapshot
                const samples = snapshot.samples || [];
                if (samples.length > 0 && samples[0].idx === undefined) {
                    samples.forEach((s, i) => s.idx = i);
                }
                return samples;
            }
        }

        getCurrentSnapshot() {
            if (this.currentSource !== 'cnn') return null;
            const dataset = this.currentDataset;
            return this.cnnData[dataset]?.snapshots?.[this.currentSnapshotIndex] || null;
        }

        getSnapshotCount() {
            const dataset = this.currentDataset;
            return this.cnnData[dataset]?.snapshots?.length || 0;
        }

        getSnapshotEpochs() {
            const dataset = this.currentDataset;
            return this.cnnData[dataset]?.metadata?.snapshotEpochs || [];
        }

        getTotalEpochs() {
            const dataset = this.currentDataset;
            return this.cnnData[dataset]?.metadata?.epochs || 10;
        }

        getClassLabels() {
            // Use shared ThemeManager when available
            return getLabels(this.currentDataset);
        }

        getColors(isDarkTheme) {
            // Use shared ThemeManager when available
            return getColors(isDarkTheme);
        }

        getImageSize() {
            return this.currentDataset === 'mnist' ? 28 : 32;
        }

        getImageChannels() {
            return this.currentDataset === 'mnist' ? 1 : 3;
        }

        getRawDimensions() {
            return this.currentDataset === 'mnist' ? 784 : 3072;
        }

        getVisibleSamples() {
            return this.getCurrentSamples().filter(s => this.visibleClasses.has(s.label));
        }

        getEmbedding(sample) {
            return sample.embeddings[this.currentAlgorithm];
        }

        setAlgorithm(algorithm) {
            this.currentAlgorithm = algorithm;
        }

        toggleClass(classIdx) {
            if (this.visibleClasses.has(classIdx)) {
                this.visibleClasses.delete(classIdx);
            } else {
                this.visibleClasses.add(classIdx);
            }
        }

        isClassVisible(classIdx) {
            return this.visibleClasses.has(classIdx);
        }

        showAllClasses() {
            this.visibleClasses = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        }

        hideAllClasses() {
            this.visibleClasses.clear();
        }

        setHighlightedClass(classIdx) {
            this.highlightedClass = classIdx;
        }

        clearHighlight() {
            this.highlightedClass = null;
        }
    }

    // ============================================
    // Scatter Plot Renderer (Canvas)
    // ============================================

    class ScatterRenderer {
        constructor(canvas, dataManager) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.data = dataManager;
            this.pointSize = 5;
            this.opacity = 0.7;
            this.showAxes = true;
            this.padding = 50;
            this.quadtree = null;
            this.screenPoints = [];
            this.isDarkTheme = false;

            // Zoom and pan state
            this.zoom = 1.0;
            this.panX = 0;  // Pan offset in normalized coordinates
            this.panY = 0;

            // Setup high-DPI canvas scaling using shared utility
            const setupHiDPICanvas =
                window.VizLib?.CanvasUtils?.setupHiDPICanvas ||
                window.VizLib?.setupHiDPICanvas;
            if (!setupHiDPICanvas) {
                throw new Error('VizLib Canvas setup is not available');
            }
            const { dpr, logicalWidth, logicalHeight } = setupHiDPICanvas(this.canvas);
            this.dpr = dpr;
            this.logicalWidth = logicalWidth;
            this.logicalHeight = logicalHeight;
        }

        resetView() {
            this.zoom = 1.0;
            this.panX = 0;
            this.panY = 0;
        }

        // Convert screen coordinates to normalized data coordinates (0-1 range)
        screenToNormalized(sx, sy) {
            // Use logical dimensions (CSS pixels, not device pixels)
            const width = this.logicalWidth;
            const height = this.logicalHeight;
            const plotWidth = width - 2 * this.padding;
            const plotHeight = height - 2 * this.padding;
            const centerX = width / 2;
            const centerY = height / 2;

            // Reverse the zoom/pan transform
            const nx = ((sx - centerX) / this.zoom + centerX - this.padding) / plotWidth - this.panX + 0.5;
            const ny = ((sy - centerY) / this.zoom + centerY - this.padding) / plotHeight - this.panY + 0.5;
            return [nx, 1 - ny];  // Flip Y back
        }

        updateTheme() {
            this.isDarkTheme = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
        }

        getColor(classIdx) {
            const colors = this.data.getColors(this.isDarkTheme);
            return colors[classIdx];
        }

        render() {
            this.updateTheme();
            const ctx = this.ctx;
            // Use logical dimensions (CSS pixels) for all drawing
            const width = this.logicalWidth;
            const height = this.logicalHeight;
            const dpr = this.dpr;

            // Reset transform and apply DPI scaling for crisp rendering
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Background
            const bgColor = this.isDarkTheme ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light');
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);

            // Get visible samples
            const samples = this.data.getVisibleSamples();
            if (samples.length === 0) {
                this.drawNoDataMessage(ctx, width, height);
                return;
            }

            // Compute bounds for ALL current samples for consistent scaling
            // Use cached bounds if available
            const allSamples = this.data.getCurrentSamples();
            const boundsKey = `${this.data.currentDataset}_${this.data.currentSource}_${this.data.currentSnapshotIndex}_${this.data.currentAlgorithm}`;

            let xMin, xMax, yMin, yMax;
            if (this._boundsCache?.key === boundsKey) {
                ({ xMin, xMax, yMin, yMax } = this._boundsCache);
            } else {
                // Compute bounds efficiently without spread operator
                xMin = Infinity; xMax = -Infinity;
                yMin = Infinity; yMax = -Infinity;
                for (const sample of allSamples) {
                    const [x, y] = this.data.getEmbedding(sample);
                    if (x < xMin) xMin = x;
                    if (x > xMax) xMax = x;
                    if (y < yMin) yMin = y;
                    if (y > yMax) yMax = y;
                }
                this._boundsCache = { key: boundsKey, xMin, xMax, yMin, yMax };
            }

            // Add padding to bounds
            const xRange = xMax - xMin || 1;
            const yRange = yMax - yMin || 1;
            const xPad = xRange * 0.05;
            const yPad = yRange * 0.05;

            // Scale functions with zoom and pan
            const plotWidth = width - 2 * this.padding;
            const plotHeight = height - 2 * this.padding;
            const centerX = width / 2;
            const centerY = height / 2;

            // Base scale: data -> normalized (0-1) -> screen
            const baseScaleX = x => this.padding + (x - (xMin - xPad)) / (xRange + 2 * xPad) * plotWidth;
            const baseScaleY = y => this.padding + (1 - (y - (yMin - yPad)) / (yRange + 2 * yPad)) * plotHeight;

            // Apply zoom (centered on canvas center) and pan
            const scaleX = x => {
                const base = baseScaleX(x);
                const normalized = (base - this.padding) / plotWidth;  // 0-1
                const panned = normalized + this.panX - 0.5;  // Apply pan, center at 0
                return centerX + panned * plotWidth * this.zoom;
            };
            const scaleY = y => {
                const base = baseScaleY(y);
                const normalized = (base - this.padding) / plotHeight;  // 0-1
                const panned = normalized + this.panY - 0.5;  // Apply pan, center at 0
                return centerY + panned * plotHeight * this.zoom;
            };

            // Draw axes
            if (this.showAxes) {
                this.drawAxes(ctx, xMin - xPad, xMax + xPad, yMin - yPad, yMax + yPad, scaleX, scaleY);
            }

            // Build quadtree and prepare screen points
            const QuadtreeClass = getQuadtreeClass();
            this.quadtree = new QuadtreeClass({ x: 0, y: 0, width, height });
            this.screenPoints = [];

            // Calculate screen positions
            for (const sample of samples) {
                const [ex, ey] = this.data.getEmbedding(sample);
                const sx = scaleX(ex);
                const sy = scaleY(ey);
                const screenPoint = { x: sx, y: sy, sample };
                this.screenPoints.push(screenPoint);
                this.quadtree.insert(screenPoint);
            }

            const highlightedClass = this.data.highlightedClass;

            // Batch points by color for faster drawing
            const pointsByColor = new Map();

            for (const sp of this.screenPoints) {
                let opacity;
                if (highlightedClass !== null) {
                    opacity = sp.sample.label === highlightedClass ? 1.0 : 0.15;
                } else {
                    opacity = this.opacity;
                }

                const colorKey = `${sp.sample.label}_${opacity}`;
                if (!pointsByColor.has(colorKey)) {
                    pointsByColor.set(colorKey, {
                        color: this.hexToRgba(this.getColor(sp.sample.label), opacity),
                        points: [],
                        isHighlighted: highlightedClass !== null && sp.sample.label === highlightedClass
                    });
                }
                pointsByColor.get(colorKey).points.push(sp);
            }

            // Draw non-highlighted first, then highlighted on top
            const sortedColors = [...pointsByColor.entries()].sort((a, b) =>
                (a[1].isHighlighted ? 1 : 0) - (b[1].isHighlighted ? 1 : 0)
            );

            for (const [, { color, points }] of sortedColors) {
                ctx.fillStyle = color;
                ctx.beginPath();
                for (const sp of points) {
                    ctx.moveTo(sp.x + this.pointSize, sp.y);
                    ctx.arc(sp.x, sp.y, this.pointSize, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        }

        drawAxes(ctx, xMin, xMax, yMin, yMax, scaleX, scaleY) {
            const axisColor = this.isDarkTheme ? EAIColor('grid', 'dark') : EAIColor('grid', 'light');
            const textColor = this.isDarkTheme ? EAIColor('muted', 'dark') : EAIColor('muted', 'light');
            const width = this.logicalWidth;
            const height = this.logicalHeight;

            ctx.strokeStyle = axisColor;
            ctx.lineWidth = 1;
            ctx.fillStyle = textColor;
            ctx.font = '10px Menlo, Monaco, Consolas, monospace';

            // Draw border
            ctx.beginPath();
            ctx.strokeRect(this.padding, this.padding,
                          width - 2 * this.padding,
                          height - 2 * this.padding);

            // X axis label
            ctx.textAlign = 'center';
            ctx.fillText('Component 1', width / 2, height - 10);

            // Y axis label
            ctx.save();
            ctx.translate(15, height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Component 2', 0, 0);
            ctx.restore();
        }

        drawNoDataMessage(ctx, width, height) {
            const textColor = this.isDarkTheme ? EAIColor('muted', 'dark') : EAIColor('muted', 'light');
            ctx.fillStyle = textColor;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No classes selected. Use the filter to show classes.', width / 2, height / 2);
        }

        hexToRgba(hex, alpha) {
            return window.VizLib.ThemeManager.hexToRgba(hex, alpha);
        }

        findPointAt(x, y) {
            if (!this.quadtree) return null;
            const candidates = this.quadtree.queryRadius(x, y, this.pointSize + 3);
            if (candidates.length === 0) return null;

            let closest = null;
            let minDist = Infinity;
            for (const p of candidates) {
                const dist = Math.hypot(p.x - x, p.y - y);
                if (dist < minDist && dist <= this.pointSize + 3) {
                    minDist = dist;
                    closest = p;
                }
            }
            return closest?.sample || null;
        }
    }

    // ============================================
    // Image Renderer
    // ============================================

    class ImageRenderer {
        // Cache for decoded images
        static imageCache = new Map();

        static renderToCanvas(canvas, imageData, imageSize, channels, scale = 3) {
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Check if image is base64 PNG string or pixel array
            if (typeof imageData === 'string') {
                // Base64 PNG - use cached Image object or create new one
                let img = this.imageCache.get(imageData);
                if (img && img.complete) {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                } else {
                    // Create and cache image
                    img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                    img.src = 'data:image/png;base64,' + imageData;
                    this.imageCache.set(imageData, img);

                    // Limit cache size
                    if (this.imageCache.size > 100) {
                        const firstKey = this.imageCache.keys().next().value;
                        this.imageCache.delete(firstKey);
                    }
                }
            } else {
                // Legacy: pixel array
                const pixelData = ctx.createImageData(imageSize, imageSize);

                if (channels === 1) {
                    // Grayscale (MNIST)
                    for (let i = 0; i < imageData.length; i++) {
                        const val = imageData[i];
                        const idx = i * 4;
                        pixelData.data[idx] = val;
                        pixelData.data[idx + 1] = val;
                        pixelData.data[idx + 2] = val;
                        pixelData.data[idx + 3] = 255;
                    }
                } else {
                    // RGB (CIFAR-10)
                    for (let i = 0; i < imageSize * imageSize; i++) {
                        const idx = i * 4;
                        const pixelIdx = i * 3;
                        pixelData.data[idx] = imageData[pixelIdx];
                        pixelData.data[idx + 1] = imageData[pixelIdx + 1];
                        pixelData.data[idx + 2] = imageData[pixelIdx + 2];
                        pixelData.data[idx + 3] = 255;
                    }
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = imageSize;
                tempCanvas.height = imageSize;
                tempCanvas.getContext('2d').putImageData(pixelData, 0, 0);
                ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
            }
        }
    }

    // ============================================
    // UI Controller
    // ============================================

    class UIController {
        constructor(dataManager, renderer) {
            this.data = dataManager;
            this.renderer = renderer;
            this.tooltip = document.getElementById('digit-tooltip');
            this.tooltipCanvas = document.getElementById('tooltip-canvas');
            this.hoveredSample = null;
            this.isPlaying = false;
            this.playInterval = null;
        }

        init() {
            this.setupDatasetSelector();
            this.setupDataSourceToggle();
            this.setupAlgorithmTabs();
            this.setupClassFilter();
            this.setupDisplayOptions();
            this.setupInfoTabs();
            this.setupCanvasInteraction();
            this.setupComparisonTable();
            this.setupHighlightClear();
            this.setupTrainingTimeline();
            this.buildLegend();
            this.hideLoading();
        }

        hideLoading() {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.style.display = 'none';
        }

        showLoading(message = 'Loading...') {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.querySelector('.loading-text').textContent = message;
                overlay.style.display = 'flex';
            }
        }

        setupDatasetSelector() {
            const btnMNIST = document.getElementById('btn-mnist');
            const btnCIFAR = document.getElementById('btn-cifar10');

            btnMNIST?.addEventListener('click', async () => {
                if (this.data.currentDataset === 'mnist') return;
                btnMNIST.classList.add('active');
                btnCIFAR.classList.remove('active');
                await this.switchDataset('mnist');
            });

            btnCIFAR?.addEventListener('click', async () => {
                if (this.data.currentDataset === 'cifar10') return;
                btnCIFAR.classList.add('active');
                btnMNIST.classList.remove('active');
                await this.switchDataset('cifar10');
            });
        }

        async switchDataset(dataset) {
            this.showLoading(`Loading ${dataset.toUpperCase()} data...`);

            this.data.setDataset(dataset);

            // Load data for current source
            if (this.data.currentSource === 'cnn') {
                await this.data.loadCNNData();
            } else {
                await this.data.loadRawData();
            }

            // Update UI elements
            this.updateDatasetInfo();
            this.rebuildClassFilter();
            this.rebuildLegend();
            this.rebuildEpochMarkers();
            this.updateEpochDisplay();

            this.hideLoading();
            this.renderer.resetView();
            this.renderer.render();
            this.updateMetrics();

            // Images are loaded on-demand when user first hovers (see showTooltip)
        }

        updateDatasetInfo() {
            const dataset = this.data.currentDataset;
            const dims = this.data.getRawDimensions();
            const size = this.data.getImageSize();
            const channels = this.data.getImageChannels();

            // Update info text
            const info = document.getElementById('data-source-info');
            if (info) {
                if (this.data.currentSource === 'raw') {
                    info.innerHTML = `<i class="fa fa-info-circle"></i> ${dims}-dim raw pixel values`;
                } else {
                    info.innerHTML = `<i class="fa fa-info-circle"></i> 128-dim features from trained CNN`;
                }
            }

            // Update tooltip canvas size for different image sizes
            if (this.tooltipCanvas) {
                const scale = dataset === 'mnist' ? 3 : 2.625;  // 84px for both
                this.tooltipCanvas.width = size * scale;
                this.tooltipCanvas.height = size * scale;
            }

            // Update About tab content
            const aboutHeader = document.querySelector('#tab-about h4:first-child');
            if (aboutHeader) {
                const icon = dataset === 'mnist' ? 'fa-images' : 'fa-camera';
                const text = dataset === 'mnist' ? 'What is MNIST?' : 'What is CIFAR-10?';
                aboutHeader.innerHTML = `<i class="fa ${icon}"></i> ${text}`;
            }

            const aboutText = document.querySelector('#tab-about p:first-of-type');
            if (aboutText) {
                if (dataset === 'mnist') {
                    aboutText.innerHTML = `<strong>MNIST</strong> is a dataset of 70,000 handwritten digits (0-9),
                        each represented as a 28x28 grayscale image (784 pixels).`;
                } else {
                    aboutText.innerHTML = `<strong>CIFAR-10</strong> is a dataset of 60,000 color images in 10 classes,
                        each represented as a 32x32 RGB image (3,072 values).`;
                }
            }

            // Update Two Views section
            const twoViewsText = document.querySelector('#tab-about p:nth-of-type(2)');
            if (twoViewsText) {
                if (dataset === 'mnist') {
                    twoViewsText.innerHTML = `<strong>Raw Pixels:</strong> Project the 784-dim pixel values directly.<br>
                        <strong>CNN Embeddings:</strong> Project 128-dim features learned by a neural network.`;
                } else {
                    twoViewsText.innerHTML = `<strong>Raw Pixels:</strong> Project the 3,072-dim pixel values directly.<br>
                        <strong>CNN Embeddings:</strong> Project 128-dim features learned by a neural network.`;
                }
            }
        }

        setupDataSourceToggle() {
            const btnRaw = document.getElementById('btn-raw-pixels');
            const btnCNN = document.getElementById('btn-cnn-embeddings');
            const timeline = document.getElementById('training-timeline');

            btnRaw?.addEventListener('click', async () => {
                btnRaw.classList.add('active');
                btnCNN.classList.remove('active');
                timeline.style.display = 'none';

                const dims = this.data.getRawDimensions();
                document.getElementById('data-source-info').innerHTML =
                    `<i class="fa fa-info-circle"></i> ${dims}-dim raw pixel values`;

                this.showLoading('Loading raw pixel data...');
                await this.data.loadRawData();
                this.data.setSource('raw');
                this.hideLoading();
                this.renderer.resetView();
                this.renderer.render();
                this.updateMetrics();
            });

            btnCNN?.addEventListener('click', async () => {
                btnCNN.classList.add('active');
                btnRaw.classList.remove('active');
                timeline.style.display = 'block';
                document.getElementById('data-source-info').innerHTML =
                    '<i class="fa fa-info-circle"></i> 128-dim features from trained CNN';

                this.showLoading('Loading CNN embeddings...');
                await this.data.loadCNNData();
                this.data.setSource('cnn');
                this.hideLoading();
                this.rebuildEpochMarkers();
                this.updateEpochDisplay();
                this.renderer.resetView();
                this.renderer.render();
                this.updateMetrics();
            });
        }

        setupTrainingTimeline() {
            const slider = document.getElementById('epoch-slider');
            const btnPlay = document.getElementById('btn-play-training');
            const btnPause = document.getElementById('btn-pause-training');

            slider?.addEventListener('input', (e) => {
                this.setSnapshot(parseInt(e.target.value));
            });

            btnPlay?.addEventListener('click', () => {
                this.startPlayback();
            });

            btnPause?.addEventListener('click', () => {
                this.stopPlayback();
            });
        }

        rebuildEpochMarkers() {
            const slider = document.getElementById('epoch-slider');
            const markersContainer = document.getElementById('epoch-markers');
            const epochs = this.data.getSnapshotEpochs();
            const totalEpochs = this.data.getTotalEpochs();

            // Update total epochs display
            const epochDisplay = document.querySelector('.epoch-display');
            if (epochDisplay) {
                const currentEpoch = document.getElementById('current-epoch')?.textContent || '0';
                epochDisplay.innerHTML = `Epoch <strong id="current-epoch">${currentEpoch}</strong> / ${totalEpochs}`;
            }

            if (epochs.length > 0 && slider && markersContainer) {
                slider.max = epochs.length - 1;
                slider.value = this.data.currentSnapshotIndex;

                markersContainer.innerHTML = epochs.map((e, i) =>
                    `<span class="epoch-marker${i === this.data.currentSnapshotIndex ? ' active' : ''}" data-index="${i}">${e}</span>`
                ).join('');

                markersContainer.querySelectorAll('.epoch-marker').forEach(marker => {
                    marker.addEventListener('click', () => {
                        const index = parseInt(marker.dataset.index);
                        slider.value = index;
                        this.setSnapshot(index);
                    });
                });
            }
        }

        setSnapshot(index) {
            this.data.setSnapshotIndex(index);
            this.updateEpochDisplay();
            this.updateEpochMarkers(index);
            this.renderer.render();
            this.updateMetrics();
        }

        updateEpochDisplay() {
            const snapshot = this.data.getCurrentSnapshot();
            if (!snapshot) return;

            document.getElementById('current-epoch').textContent = snapshot.epoch;
            document.getElementById('current-accuracy').textContent =
                snapshot.train_accuracy ? `${snapshot.train_accuracy.toFixed(1)}%` : '-';
        }

        updateEpochMarkers(activeIndex) {
            document.querySelectorAll('.epoch-marker').forEach((marker, i) => {
                marker.classList.toggle('active', i === activeIndex);
            });
        }

        startPlayback() {
            if (this.isPlaying) return;
            this.isPlaying = true;

            document.getElementById('btn-play-training').style.display = 'none';
            document.getElementById('btn-pause-training').style.display = 'inline-block';

            const slider = document.getElementById('epoch-slider');
            const maxIndex = parseInt(slider.max);

            this.playInterval = setInterval(() => {
                let current = parseInt(slider.value);
                current++;
                if (current > maxIndex) {
                    current = 0;
                }
                slider.value = current;
                this.setSnapshot(current);
            }, 1500); // 1.5 second per snapshot
        }

        stopPlayback() {
            this.isPlaying = false;
            if (this.playInterval) {
                clearInterval(this.playInterval);
                this.playInterval = null;
            }

            document.getElementById('btn-play-training').style.display = 'inline-block';
            document.getElementById('btn-pause-training').style.display = 'none';
        }

        setupAlgorithmTabs() {
            document.querySelectorAll('.algorithm-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.algorithm-tabs .btn').forEach(b =>
                        b.classList.remove('active'));
                    btn.classList.add('active');
                    this.data.setAlgorithm(btn.dataset.algorithm);
                    this.updateComparisonTableSelection(btn.dataset.algorithm);
                    this.renderer.resetView();
                    this.renderer.render();
                });
            });
        }

        setupClassFilter() {
            this.rebuildClassFilter();

            document.getElementById('btn-show-all')?.addEventListener('click', () => {
                this.data.showAllClasses();
                document.querySelectorAll('.digit-toggle').forEach(b => b.classList.add('active'));
                this.updateLegendState();
                this.updateMetrics();
                this.renderer.render();
            });

            document.getElementById('btn-hide-all')?.addEventListener('click', () => {
                this.data.hideAllClasses();
                document.querySelectorAll('.digit-toggle').forEach(b => b.classList.remove('active'));
                this.updateLegendState();
                this.updateMetrics();
                this.renderer.render();
            });
        }

        rebuildClassFilter() {
            const container = document.getElementById('digit-filter-grid');
            if (!container) return;

            container.innerHTML = '';
            const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const labels = this.data.getClassLabels();
            const colors = this.data.getColors(isDarkTheme);

            for (let i = 0; i < 10; i++) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-sm digit-toggle active';
                btn.dataset.classIdx = i;

                // Use short labels for CIFAR-10
                const shortLabel = this.data.currentDataset === 'mnist' ? i :
                    labels[i].substring(0, 4);
                btn.textContent = shortLabel;
                btn.title = labels[i];

                btn.style.backgroundColor = colors[i];
                btn.style.borderColor = colors[i];

                btn.addEventListener('click', () => {
                    btn.classList.toggle('active');
                    this.data.toggleClass(i);
                    this.updateLegendState();
                    this.updateMetrics();
                    this.renderer.render();
                });

                container.appendChild(btn);
            }
        }

        setupDisplayOptions() {
            document.getElementById('point-size')?.addEventListener('input', (e) => {
                this.renderer.pointSize = parseInt(e.target.value);
                document.getElementById('size-value').textContent = e.target.value;
                this.renderer.render();
            });

            document.getElementById('point-opacity')?.addEventListener('input', (e) => {
                this.renderer.opacity = parseInt(e.target.value) / 100;
                document.getElementById('opacity-value').textContent = e.target.value + '%';
                this.renderer.render();
            });

            document.getElementById('show-axes')?.addEventListener('change', (e) => {
                this.renderer.showAxes = e.target.checked;
                this.renderer.render();
            });
        }

        setupInfoTabs() {
            document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.info-panel-tabs .btn').forEach(b =>
                        b.classList.remove('active'));
                    btn.classList.add('active');
                    document.querySelectorAll('.info-tab-content').forEach(tab =>
                        tab.classList.remove('active'));
                    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
                });
            });
        }

        setupComparisonTable() {
            document.querySelectorAll('#comparison-table tbody tr').forEach(row => {
                row.addEventListener('click', () => {
                    const algorithm = row.dataset.algorithm;
                    document.querySelectorAll('.algorithm-tabs .btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.algorithm === algorithm);
                    });
                    this.updateComparisonTableSelection(algorithm);
                    this.data.setAlgorithm(algorithm);
                    this.renderer.resetView();
                    this.renderer.render();
                });
            });
        }

        updateComparisonTableSelection(algorithm) {
            document.querySelectorAll('#comparison-table tbody tr').forEach(row => {
                row.classList.toggle('selected-row', row.dataset.algorithm === algorithm);
            });
        }

        setupHighlightClear() {
            document.getElementById('btn-clear-highlight')?.addEventListener('click', () => {
                this.data.clearHighlight();
                this.updateHighlightInfo();
                this.updateMetrics();
                this.renderer.render();
            });
        }

        setupCanvasInteraction() {
            const canvas = this.renderer.canvas;

            // Pan state
            let isPanning = false;
            let panStartX = 0;
            let panStartY = 0;
            let panStartPanX = 0;
            let panStartPanY = 0;
            let dragDistance = 0;

            // Helper to get canvas coordinates from mouse event (in logical/CSS pixels)
            const getCanvasCoords = (e) => {
                const rect = canvas.getBoundingClientRect();
                // Return coordinates in CSS pixels (logical), not device pixels
                return {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                };
            };

            // Zoom with mouse wheel
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();

                const coords = getCanvasCoords(e);
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newZoom = Math.max(0.5, Math.min(10, this.renderer.zoom * zoomFactor));

                // Zoom toward mouse position (use logical dimensions)
                const width = this.renderer.logicalWidth;
                const height = this.renderer.logicalHeight;
                const plotWidth = width - 2 * this.renderer.padding;
                const plotHeight = height - 2 * this.renderer.padding;
                const centerX = width / 2;
                const centerY = height / 2;

                // Convert mouse position to normalized coordinates before zoom
                const mouseNormX = (coords.x - centerX) / (plotWidth * this.renderer.zoom);
                const mouseNormY = (coords.y - centerY) / (plotHeight * this.renderer.zoom);

                // Apply zoom
                this.renderer.zoom = newZoom;

                // Adjust pan to keep mouse position fixed
                const newMouseScreenX = centerX + mouseNormX * plotWidth * newZoom;
                const newMouseScreenY = centerY + mouseNormY * plotHeight * newZoom;
                this.renderer.panX += (coords.x - newMouseScreenX) / (plotWidth * newZoom);
                this.renderer.panY += (coords.y - newMouseScreenY) / (plotHeight * newZoom);

                this.renderer.render();
            }, { passive: false });

            // Pan with mouse drag
            canvas.addEventListener('mousedown', (e) => {
                if (e.button === 0) {  // Left click
                    isPanning = true;
                    panStartX = e.clientX;
                    panStartY = e.clientY;
                    panStartPanX = this.renderer.panX;
                    panStartPanY = this.renderer.panY;
                    dragDistance = 0;
                    canvas.style.cursor = 'grabbing';
                }
            });

            canvas.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    const dx = e.clientX - panStartX;
                    const dy = e.clientY - panStartY;
                    dragDistance = Math.sqrt(dx * dx + dy * dy);

                    // Use logical dimensions for pan calculation
                    const plotWidth = this.renderer.logicalWidth - 2 * this.renderer.padding;
                    const plotHeight = this.renderer.logicalHeight - 2 * this.renderer.padding;

                    // Convert screen delta to pan delta (dx/dy are already in CSS pixels)
                    const panDeltaX = dx / (plotWidth * this.renderer.zoom);
                    const panDeltaY = dy / (plotHeight * this.renderer.zoom);

                    this.renderer.panX = panStartPanX + panDeltaX;
                    this.renderer.panY = panStartPanY + panDeltaY;

                    this.hideTooltip();
                    this.renderer.render();
                    return;
                }

                // Normal hover behavior when not panning
                const coords = getCanvasCoords(e);
                const sample = this.renderer.findPointAt(coords.x, coords.y);

                if (sample !== this.hoveredSample) {
                    this.hoveredSample = sample;
                    if (sample) {
                        this.showTooltip(e.clientX, e.clientY, sample);
                        canvas.style.cursor = 'pointer';
                    } else {
                        this.hideTooltip();
                        canvas.style.cursor = 'grab';
                    }
                    this.updateMetrics();
                } else if (sample) {
                    this.updateTooltipPosition(e.clientX, e.clientY);
                }
            });

            canvas.addEventListener('mouseup', (e) => {
                if (isPanning) {
                    isPanning = false;
                    canvas.style.cursor = 'grab';
                }
            });

            canvas.addEventListener('mouseleave', () => {
                isPanning = false;
                this.hoveredSample = null;
                this.hideTooltip();
                canvas.style.cursor = 'grab';
                this.updateMetrics();
            });

            canvas.addEventListener('click', (e) => {
                // Only handle click if we didn't drag significantly
                if (dragDistance > 5) {
                    dragDistance = 0;
                    return;
                }

                const coords = getCanvasCoords(e);
                const sample = this.renderer.findPointAt(coords.x, coords.y);

                if (sample) {
                    if (this.data.highlightedClass === sample.label) {
                        this.data.clearHighlight();
                    } else {
                        this.data.setHighlightedClass(sample.label);
                    }
                } else {
                    this.data.clearHighlight();
                }

                this.updateHighlightInfo();
                this.updateMetrics();
                this.renderer.render();
            });

            // Double-click to reset view
            canvas.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.renderer.resetView();
                this.renderer.render();
            });

            // Set initial cursor
            canvas.style.cursor = 'grab';
        }

        async showTooltip(clientX, clientY, sample) {
            const imageSize = this.data.getImageSize();
            const channels = this.data.getImageChannels();

            // Get image from lazy-loaded images (by index) or fall back to sample.image
            let imageData = this.data.getImage(sample.idx);

            if (!imageData && !this.data.hasImages()) {
                // Images not loaded yet - trigger lazy load and show placeholder
                this.tooltipCanvas.getContext('2d').fillStyle = EAIColor('grid');
                this.tooltipCanvas.getContext('2d').fillRect(0, 0, this.tooltipCanvas.width, this.tooltipCanvas.height);

                // Load images in background
                this.data.loadImages().then(() => {
                    // Re-render if same sample is still hovered
                    if (this.hoveredSample === sample) {
                        const img = this.data.getImage(sample.idx);
                        if (img) {
                            ImageRenderer.renderToCanvas(this.tooltipCanvas, img, imageSize, channels);
                        }
                    }
                });
            } else if (imageData) {
                ImageRenderer.renderToCanvas(this.tooltipCanvas, imageData, imageSize, channels);
            }

            const labels = this.data.getClassLabels();
            document.getElementById('tooltip-digit-value').textContent = labels[sample.label];

            const [ex, ey] = this.data.getEmbedding(sample);
            document.getElementById('tooltip-coords').textContent =
                `(${ex.toFixed(2)}, ${ey.toFixed(2)})`;

            this.updateTooltipPosition(clientX, clientY);
            this.tooltip.classList.add('visible');
        }

        updateTooltipPosition(clientX, clientY) {
            const tooltipWidth = 120;
            const tooltipHeight = 130;
            const padding = 15;

            let left = clientX + padding;
            let top = clientY + padding;

            if (left + tooltipWidth > window.innerWidth) {
                left = clientX - tooltipWidth - padding;
            }
            if (top + tooltipHeight > window.innerHeight) {
                top = clientY - tooltipHeight - padding;
            }

            this.tooltip.style.left = left + 'px';
            this.tooltip.style.top = top + 'px';
        }

        hideTooltip() {
            this.tooltip.classList.remove('visible');
        }

        buildLegend() {
            this.rebuildLegend();
        }

        rebuildLegend() {
            const container = document.getElementById('digit-legend');
            if (!container) return;

            container.innerHTML = '';
            const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            const labels = this.data.getClassLabels();
            const colors = this.data.getColors(isDarkTheme);

            for (let i = 0; i < 10; i++) {
                const item = document.createElement('span');
                item.className = 'legend-item';
                item.dataset.classIdx = i;

                const shortLabel = this.data.currentDataset === 'mnist' ? i :
                    labels[i].substring(0, 4);
                item.innerHTML = `<span class="legend-color" style="background-color: ${colors[i]}"></span> ${shortLabel}`;
                item.title = labels[i];

                item.addEventListener('click', () => {
                    if (this.data.highlightedClass === i) {
                        this.data.clearHighlight();
                    } else {
                        this.data.setHighlightedClass(i);
                    }
                    this.updateHighlightInfo();
                    this.updateMetrics();
                    this.renderer.render();
                });

                container.appendChild(item);
            }
        }

        updateLegendState() {
            document.querySelectorAll('#digit-legend .legend-item').forEach(item => {
                const classIdx = parseInt(item.dataset.classIdx);
                item.classList.toggle('dimmed', !this.data.isClassVisible(classIdx));
            });
        }

        updateHighlightInfo() {
            const highlightInfo = document.getElementById('highlight-info');
            const highlightValue = document.getElementById('highlight-digit-value');
            const labels = this.data.getClassLabels();

            if (this.data.highlightedClass !== null) {
                highlightValue.textContent = labels[this.data.highlightedClass];
                highlightInfo.classList.add('visible');
            } else {
                highlightInfo.classList.remove('visible');
            }
        }

        updateMetrics() {
            const samples = this.data.getCurrentSamples();
            const labels = this.data.getClassLabels();

            document.getElementById('metric-samples').textContent = samples.length;
            document.getElementById('metric-visible').textContent =
                this.data.getVisibleSamples().length;

            if (this.data.highlightedClass !== null) {
                const count = samples.filter(s => s.label === this.data.highlightedClass).length;
                document.getElementById('metric-highlighted').textContent =
                    `${labels[this.data.highlightedClass]} (${count})`;
            } else {
                document.getElementById('metric-highlighted').textContent = '-';
            }

            document.getElementById('metric-hovered').textContent =
                this.hoveredSample ? `${labels[this.hoveredSample.label]}` : '-';
        }
    }

    // ============================================
    // Main Application
    // ============================================

    class DimReductionApp {
        constructor() {
            this.dataManager = new DataManager();
            this.renderer = null;
            this.ui = null;
        }

        async init() {
            try {
                // Load CNN data by default
                const loadingText = document.querySelector('#loading-overlay .loading-text');
                if (loadingText) loadingText.textContent = 'Loading CNN embeddings...';

                await this.dataManager.loadCNNData();
                this.dataManager.setSource('cnn');

                console.log(`Loaded CNN data: ${this.dataManager.getSnapshotCount()} snapshots`);

                // Initialize renderer
                const canvas = document.getElementById('scatter-canvas');
                this.renderer = new ScatterRenderer(canvas, this.dataManager);

                // Initialize UI
                this.ui = new UIController(this.dataManager, this.renderer);
                this.ui.init();

                // Initial render
                this.renderer.render();
                this.ui.updateMetrics();
                this.ui.updateEpochDisplay();

                // Build epoch markers after data is loaded
                this.ui.rebuildEpochMarkers();

                // Setup theme listener
                this.setupThemeListener();

                // Images are loaded on-demand when user first hovers (see showTooltip)

            } catch (err) {
                console.error('Failed to initialize visualizer:', err);
                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    overlay.querySelector('.loading-text').textContent =
                        'Error loading data. Please refresh the page.';
                    overlay.querySelector('.spinner').style.display = 'none';
                }
            }
        }

        setupThemeListener() {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.attributeName === 'data-theme') {
                        this.renderer.render();
                        const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
                        const colors = this.dataManager.getColors(isDark);

                        document.querySelectorAll('.digit-toggle').forEach(btn => {
                            const classIdx = parseInt(btn.dataset.classIdx);
                            btn.style.backgroundColor = colors[classIdx];
                            btn.style.borderColor = colors[classIdx];
                        });
                        document.querySelectorAll('#digit-legend .legend-item').forEach(item => {
                            const classIdx = parseInt(item.dataset.classIdx);
                            item.querySelector('.legend-color').style.backgroundColor = colors[classIdx];
                        });
                    }
                }
            });

            observer.observe(document.documentElement, { attributes: true });
        }
    }

    // ============================================
    // Initialize on DOM ready
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        window.dimReductionApp = new DimReductionApp();
        window.dimReductionApp.init();
    });

})();

/**
 * Naive Bayes Classifier Visualizer
 *
 * Interactive text classification using Naive Bayes with spam/ham detection.
 * Features Laplace smoothing, word probability tables, prior/posterior
 * visualization, and step-by-step probability display.
 */
(function() {
    'use strict';

    // ============================================
    // Constants & Preset Training Data
    // ============================================
    const CANVAS_HEIGHT = 100;
    let CANVAS_WIDTH = 500;

    const DEFAULT_TRAINING_DATA = [
        // Spam messages
        { text: 'Win a free iPhone now click here', label: 'spam' },
        { text: 'Congratulations you won a million dollars', label: 'spam' },
        { text: 'Free money no credit check required', label: 'spam' },
        { text: 'Buy cheap pills online discount pharmacy', label: 'spam' },
        { text: 'You have been selected for a cash prize', label: 'spam' },
        { text: 'Claim your free reward today limited offer', label: 'spam' },
        { text: 'Make money fast work from home opportunity', label: 'spam' },
        { text: 'Urgent act now to claim your prize winner', label: 'spam' },
        { text: 'Get rich quick guaranteed income easy money', label: 'spam' },
        { text: 'Special promotion buy one get one free deal', label: 'spam' },
        { text: 'Exclusive offer just for you free gift card', label: 'spam' },
        { text: 'Click here to win big cash prize now', label: 'spam' },
        // Ham messages
        { text: 'Hey are you coming to the meeting tomorrow', label: 'ham' },
        { text: 'Can you pick up groceries on your way home', label: 'ham' },
        { text: 'The project deadline has been moved to Friday', label: 'ham' },
        { text: 'Let me know when you are available to talk', label: 'ham' },
        { text: 'Thanks for sending the report it looks good', label: 'ham' },
        { text: 'Are we still on for lunch today at noon', label: 'ham' },
        { text: 'I will be working from home tomorrow morning', label: 'ham' },
        { text: 'Please review the attached document and reply', label: 'ham' },
        { text: 'See you at the conference next week', label: 'ham' },
        { text: 'Happy birthday hope you have a great day', label: 'ham' },
        { text: 'Can we reschedule our appointment to next week', label: 'ham' },
        { text: 'The team meeting is at three this afternoon', label: 'ham' }
    ];

    // ============================================
    // NaiveBayesClassifier Class
    // ============================================
    class NaiveBayesClassifier {
        constructor() {
            this.alpha = 1.0;           // Laplace smoothing parameter
            this.classCounts = {};       // {spam: n, ham: n}
            this.classWordCounts = {};   // {spam: {word: count}, ham: {word: count}}
            this.classTotalWords = {};   // {spam: total, ham: total}
            this.vocabulary = new Set();
            this.totalDocs = 0;
            this.trainingData = [];
        }

        /**
         * Tokenize text into lowercase words, removing punctuation
         */
        tokenize(text) {
            return text.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 0);
        }

        /**
         * Train the classifier on a dataset
         */
        train(data) {
            this.trainingData = [...data];
            this.classCounts = {};
            this.classWordCounts = {};
            this.classTotalWords = {};
            this.vocabulary = new Set();
            this.totalDocs = 0;

            for (const item of data) {
                const label = item.label;
                const words = this.tokenize(item.text);

                // Count documents per class
                this.classCounts[label] = (this.classCounts[label] || 0) + 1;
                this.totalDocs++;

                // Initialize class word counts
                if (!this.classWordCounts[label]) {
                    this.classWordCounts[label] = {};
                    this.classTotalWords[label] = 0;
                }

                // Count words per class
                for (const word of words) {
                    this.vocabulary.add(word);
                    this.classWordCounts[label][word] = (this.classWordCounts[label][word] || 0) + 1;
                    this.classTotalWords[label]++;
                }
            }
        }

        /**
         * Get prior probability P(class)
         */
        getPrior(label) {
            return (this.classCounts[label] || 0) / this.totalDocs;
        }

        /**
         * Get likelihood P(word|class) with Laplace smoothing
         */
        getWordProbability(word, label) {
            const wordCount = (this.classWordCounts[label] && this.classWordCounts[label][word]) || 0;
            const totalWords = this.classTotalWords[label] || 0;
            const vocabSize = this.vocabulary.size;

            return (wordCount + this.alpha) / (totalWords + this.alpha * vocabSize);
        }

        /**
         * Get log-likelihood for a word given class
         */
        getLogWordProbability(word, label) {
            return Math.log(this.getWordProbability(word, label));
        }

        /**
         * Classify a message. Returns detailed breakdown.
         */
        classify(text) {
            const words = this.tokenize(text);
            const classes = Object.keys(this.classCounts);

            if (classes.length === 0 || words.length === 0) {
                return null;
            }

            const logScores = {};
            const wordDetails = [];

            // Compute log P(class) + sum log P(word|class) for each class
            for (const cls of classes) {
                logScores[cls] = Math.log(this.getPrior(cls));

                for (const word of words) {
                    logScores[cls] += this.getLogWordProbability(word, cls);
                }
            }

            // Compute per-word details
            for (const word of words) {
                const pSpam = this.getWordProbability(word, 'spam');
                const pHam = this.getWordProbability(word, 'ham');
                const logLR = Math.log(pSpam) - Math.log(pHam);

                wordDetails.push({
                    word,
                    pSpam,
                    pHam,
                    logLR,
                    inVocab: this.vocabulary.has(word)
                });
            }

            // Convert log-scores to probabilities via log-sum-exp (softmax)
            const maxLog = Math.max(...Object.values(logScores));
            let sumExp = 0;
            const expScores = {};
            for (const cls of classes) {
                expScores[cls] = Math.exp(logScores[cls] - maxLog);
                sumExp += expScores[cls];
            }

            const probabilities = {};
            for (const cls of classes) {
                probabilities[cls] = expScores[cls] / sumExp;
            }

            // Determine predicted class
            let predicted = classes[0];
            for (const cls of classes) {
                if (probabilities[cls] > probabilities[predicted]) {
                    predicted = cls;
                }
            }

            return {
                predicted,
                probabilities,
                logScores,
                wordDetails,
                words,
                priors: {
                    spam: this.getPrior('spam'),
                    ham: this.getPrior('ham')
                }
            };
        }

        /**
         * Get all vocabulary word probabilities for display
         */
        getVocabularyProbabilities() {
            const result = [];
            for (const word of this.vocabulary) {
                const pSpam = this.getWordProbability(word, 'spam');
                const pHam = this.getWordProbability(word, 'ham');
                result.push({
                    word,
                    pSpam,
                    pHam,
                    logLR: Math.log(pSpam) - Math.log(pHam)
                });
            }
            return result;
        }
    }

    // ============================================
    // PriorPosteriorRenderer Class
    // ============================================
    class PriorPosteriorRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
        }

        setup() {
            if (window.VizLib) {
                const result = VizLib.setupHiDPICanvas(this.canvas);
                this.ctx = result.ctx;
                this.dpr = result.dpr;
                CANVAS_WIDTH = result.logicalWidth;
            } else {
                this.ctx = this.canvas.getContext('2d');
            }
        }

        render(priors, posteriors) {
            const ctx = this.ctx;
            if (!ctx) return;

            const dpr = this.dpr;
            const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';

            // Clear
            if (window.VizLib) {
                VizLib.resetCanvasTransform(ctx, dpr);
                const bg = isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light');
                VizLib.clearCanvas(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, bg);
            } else {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            }

            const textColor = isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light');
            const mutedColor = isDark ? EAIColor('muted', 'dark') : EAIColor('muted', 'light');
            const spamColor = isDark ? EAIColor('red', 'dark') : EAIColor('red', 'light');
            const hamColor = isDark ? EAIColor('green', 'dark') : EAIColor('green', 'light');
            const trackColor = isDark ? EAIColor('sunken', 'dark') : EAIColor('sunken', 'light');
            const arrowColor = isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light');

            const barHeight = 18;
            const sectionWidth = (CANVAS_WIDTH - 80) / 2; // space for arrow
            const leftX = 20;
            const rightX = CANVAS_WIDTH - sectionWidth - 20;
            const arrowCenterX = CANVAS_WIDTH / 2;

            // --- Prior section ---
            const priorY = 10;
            ctx.fillStyle = mutedColor;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Prior', leftX + sectionWidth / 2, priorY);

            // Prior spam bar
            const priorBarY = priorY + 18;
            this._drawBar(ctx, leftX, priorBarY, sectionWidth, barHeight, priors.spam, spamColor, trackColor);
            ctx.fillStyle = textColor;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Spam ' + (priors.spam * 100).toFixed(1) + '%', leftX + 4, priorBarY + barHeight / 2);

            // Prior ham bar
            const priorHamY = priorBarY + barHeight + 4;
            this._drawBar(ctx, leftX, priorHamY, sectionWidth, barHeight, priors.ham, hamColor, trackColor);
            ctx.fillStyle = textColor;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Ham ' + (priors.ham * 100).toFixed(1) + '%', leftX + 4, priorHamY + barHeight / 2);

            // --- Arrow ---
            const arrowY = priorBarY + barHeight + 2;
            ctx.strokeStyle = arrowColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(arrowCenterX - 18, arrowY);
            ctx.lineTo(arrowCenterX + 12, arrowY);
            ctx.stroke();
            // Arrowhead
            ctx.beginPath();
            ctx.moveTo(arrowCenterX + 12, arrowY);
            ctx.lineTo(arrowCenterX + 6, arrowY - 4);
            ctx.lineTo(arrowCenterX + 6, arrowY + 4);
            ctx.closePath();
            ctx.fillStyle = arrowColor;
            ctx.fill();

            ctx.fillStyle = mutedColor;
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('words', arrowCenterX, arrowY + 6);

            // --- Posterior section ---
            ctx.fillStyle = mutedColor;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Posterior', rightX + sectionWidth / 2, priorY);

            // Posterior spam bar
            this._drawBar(ctx, rightX, priorBarY, sectionWidth, barHeight, posteriors.spam, spamColor, trackColor);
            ctx.fillStyle = textColor;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Spam ' + (posteriors.spam * 100).toFixed(1) + '%', rightX + 4, priorBarY + barHeight / 2);

            // Posterior ham bar
            this._drawBar(ctx, rightX, priorHamY, sectionWidth, barHeight, posteriors.ham, hamColor, trackColor);
            ctx.fillStyle = textColor;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Ham ' + (posteriors.ham * 100).toFixed(1) + '%', rightX + 4, priorHamY + barHeight / 2);
        }

        _drawBar(ctx, x, y, width, height, value, color, trackColor) {
            // Track
            ctx.fillStyle = trackColor;
            ctx.beginPath();
            ctx.moveTo(x + 3, y);
            ctx.lineTo(x + width - 3, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + 3);
            ctx.lineTo(x + width, y + height - 3);
            ctx.quadraticCurveTo(x + width, y + height, x + width - 3, y + height);
            ctx.lineTo(x + 3, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - 3);
            ctx.lineTo(x, y + 3);
            ctx.quadraticCurveTo(x, y, x + 3, y);
            ctx.fill();

            // Filled portion
            const filledWidth = Math.max(0, width * value);
            if (filledWidth > 0) {
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                const fw = Math.min(filledWidth, width);
                ctx.moveTo(x + 3, y);
                ctx.lineTo(x + fw - (fw >= width ? 3 : 0), y);
                if (fw >= width) {
                    ctx.quadraticCurveTo(x + fw, y, x + fw, y + 3);
                    ctx.lineTo(x + fw, y + height - 3);
                    ctx.quadraticCurveTo(x + fw, y + height, x + fw - 3, y + height);
                } else {
                    ctx.lineTo(x + fw, y);
                    ctx.lineTo(x + fw, y + height);
                }
                ctx.lineTo(x + 3, y + height);
                ctx.quadraticCurveTo(x, y + height, x, y + height - 3);
                ctx.lineTo(x, y + 3);
                ctx.quadraticCurveTo(x, y, x + 3, y);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
        }

        resize() {
            if (window.VizLib) {
                const result = VizLib.setupHiDPICanvas(this.canvas);
                this.ctx = result.ctx;
                this.dpr = result.dpr;
                CANVAS_WIDTH = result.logicalWidth;
            }
        }
    }

    // ============================================
    // NaiveBayesVisualizer (Main Controller)
    // ============================================
    class NaiveBayesVisualizer {
        constructor() {
            this.classifier = new NaiveBayesClassifier();
            this.priorPosteriorRenderer = null;
            this.lastResult = null;
            this.showLogProbs = false;
            this.sortColumn = 'ratio';
            this.sortAscending = false;
        }

        init() {
            if (window.VizLib) {
                this._setup();
            } else {
                window.addEventListener('vizlib-ready', () => this._setup());
            }
        }

        _setup() {
            // Train on default data
            this.classifier.train(DEFAULT_TRAINING_DATA);

            // Setup prior/posterior canvas
            const ppCanvas = document.getElementById('prior-posterior-canvas');
            if (ppCanvas) {
                this.priorPosteriorRenderer = new PriorPosteriorRenderer(ppCanvas);
                this.priorPosteriorRenderer.setup();
            }

            // Bind events
            this._bindEvents();

            // Update metrics

            // Render training data list
            this._renderTrainingData();
            this._renderNbFitPanel();
        }

        _bindEvents() {
            // Classify button
            const classifyBtn = document.getElementById('btn-classify');
            if (classifyBtn) {
                classifyBtn.addEventListener('click', () => this._onClassify());
            }

            // Enter key in textarea
            const input = document.getElementById('message-input');
            if (input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this._onClassify();
                    }
                });
            }

            // Alpha slider
            const alphaSlider = document.getElementById('alpha-slider');
            if (alphaSlider) {
                alphaSlider.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    this.classifier.alpha = val;
                    document.getElementById('alpha-value').textContent = val.toFixed(1);
                    document.getElementById('metric-alpha').textContent = val.toFixed(1);
                    this._renderNbFitPanel();
                    // Re-classify if there is a previous result
                    if (this.lastResult) {
                        this._onClassify();
                    }
                });
            }

            // Log probabilities toggle
            const logToggle = document.getElementById('show-log-probs');
            if (logToggle) {
                logToggle.addEventListener('change', (e) => {
                    this.showLogProbs = e.target.checked;
                    if (this.lastResult) {
                        this._renderWordTable(this.lastResult);
                    }
                });
            }

            // Sortable table headers
            document.querySelectorAll('.word-prob-table .sortable').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.getAttribute('data-sort');
                    if (this.sortColumn === col) {
                        this.sortAscending = !this.sortAscending;
                    } else {
                        this.sortColumn = col;
                        this.sortAscending = col === 'word';
                    }
                    // Update sort indicators
                    document.querySelectorAll('.word-prob-table .sortable').forEach(h => {
                        h.classList.remove('sort-active');
                    });
                    th.classList.add('sort-active');

                    if (this.lastResult) {
                        this._renderWordTable(this.lastResult);
                    }
                });
            });

            // Toggle training data panel
            const toggleBtn = document.getElementById('btn-toggle-training');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    const panel = document.getElementById('training-panel');
                    const icon = document.getElementById('training-toggle-icon');
                    if (panel.style.display === 'none') {
                        panel.style.display = '';
                        icon.className = 'fa fa-chevron-up';
                    } else {
                        panel.style.display = 'none';
                        icon.className = 'fa fa-chevron-down';
                    }
                });
            }

            // Add training example
            const addBtn = document.getElementById('btn-add-training');
            if (addBtn) {
                addBtn.addEventListener('click', () => this._onAddTraining());
            }

            // Enter key in new training text
            const newText = document.getElementById('new-training-text');
            if (newText) {
                newText.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this._onAddTraining();
                    }
                });
            }

            // Reset button
            const resetBtn = document.getElementById('btn-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this._onReset());
            }

            // Resize handler
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    if (this.priorPosteriorRenderer) {
                        this.priorPosteriorRenderer.resize();
                        if (this.lastResult) {
                            this.priorPosteriorRenderer.render(
                                this.lastResult.priors,
                                this.lastResult.probabilities
                            );
                        }
                    }
                }, 100);
            });

            // Theme change
            document.addEventListener('themechange', () => {
                if (this.lastResult && this.priorPosteriorRenderer) {
                    this.priorPosteriorRenderer.render(
                        this.lastResult.priors,
                        this.lastResult.probabilities
                    );
                }
            });

            // Info tab button switching (for btn-group variant)
            document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tabId = btn.getAttribute('data-tab');
                    // Deactivate all
                    btn.closest('.info-panel-tabs').querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Show target tab
                    const panel = btn.closest('.panel');
                    panel.querySelectorAll('.info-tab-content').forEach(t => t.classList.remove('active'));
                    const target = panel.querySelector('#tab-' + tabId);
                    if (target) target.classList.add('active');
                });
            });
        }

        _onClassify() {
            const input = document.getElementById('message-input');
            const text = input ? input.value.trim() : '';

            if (!text) {
                this._updateStatus('Enter a message to classify');
                return;
            }

            const result = this.classifier.classify(text);
            if (!result) {
                this._updateStatus('No training data');
                return;
            }

            this.lastResult = result;

            // Update result display
            this._renderResult(result);

            // Update word table
            this._renderWordTable(result);

            // Update prior/posterior canvas
            const ppSection = document.getElementById('prior-posterior-section');
            if (ppSection) {
                ppSection.style.display = '';
            }
            if (this.priorPosteriorRenderer) {
                this.priorPosteriorRenderer.render(
                    result.priors,
                    result.probabilities
                );
            }

            // Update metrics
            this._updateMetrics(result);

            // Update math tab panels
            this._renderNbFitPanel();
            this._renderNbCalcPanel(result);
        }

        _renderResult(result) {
            const display = document.getElementById('result-display');
            if (display) {
                display.style.display = '';
            }

            // Update badge
            const badge = document.getElementById('result-badge');
            if (badge) {
                badge.className = 'viz-badge result-badge ' + result.predicted;
                badge.textContent = result.predicted === 'spam' ? 'SPAM' : 'HAM';
            }

            // Update probability bars
            const spamProb = result.probabilities.spam || 0;
            const hamProb = result.probabilities.ham || 0;

            const spamBar = document.getElementById('spam-bar');
            const hamBar = document.getElementById('ham-bar');
            const spamProbEl = document.getElementById('spam-prob');
            const hamProbEl = document.getElementById('ham-prob');

            if (spamBar) spamBar.style.width = (spamProb * 100).toFixed(1) + '%';
            if (hamBar) hamBar.style.width = (hamProb * 100).toFixed(1) + '%';

            if (this.showLogProbs) {
                if (spamProbEl) spamProbEl.textContent = 'log: ' + (result.logScores.spam || 0).toFixed(4);
                if (hamProbEl) hamProbEl.textContent = 'log: ' + (result.logScores.ham || 0).toFixed(4);
            } else {
                if (spamProbEl) spamProbEl.textContent = (spamProb * 100).toFixed(1) + '%';
                if (hamProbEl) hamProbEl.textContent = (hamProb * 100).toFixed(1) + '%';
            }
        }

        _renderWordTable(result) {
            const tbody = document.getElementById('word-prob-tbody');
            if (!tbody) return;

            const details = [...result.wordDetails];

            // Sort
            details.sort((a, b) => {
                let valA, valB;
                switch (this.sortColumn) {
                    case 'word': valA = a.word; valB = b.word; break;
                    case 'pSpam': valA = a.pSpam; valB = b.pSpam; break;
                    case 'pHam': valA = a.pHam; valB = b.pHam; break;
                    case 'ratio': valA = a.logLR; valB = b.logLR; break;
                    default: valA = a.logLR; valB = b.logLR;
                }
                if (typeof valA === 'string') {
                    return this.sortAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return this.sortAscending ? valA - valB : valB - valA;
            });

            let html = '';
            for (const d of details) {
                const ratioClass = d.logLR > 0.1 ? 'ratio-positive' :
                                   d.logLR < -0.1 ? 'ratio-negative' : 'ratio-neutral';
                const vocabClass = d.inVocab ? '' : ' word-highlight';
                const ratioSign = d.logLR > 0 ? '+' : '';

                html += '<tr class="' + vocabClass + '">';
                html += '<td>' + this._escapeHtml(d.word) + (d.inVocab ? '' : ' <small title="Not in training vocabulary">(new)</small>') + '</td>';
                html += '<td>' + d.pSpam.toFixed(6) + '</td>';
                html += '<td>' + d.pHam.toFixed(6) + '</td>';
                html += '<td class="' + ratioClass + '">' + ratioSign + d.logLR.toFixed(4) + '</td>';
                html += '</tr>';
            }

            // Log probability breakdown
            if (this.showLogProbs && result) {
                html += '<tr><td colspan="4" class="log-prob-section">';
                html += '<div class="log-prob-header">Log-Probability Breakdown</div>';

                // Spam
                html += '<div class="log-prob-term"><span>log P(Spam)</span><span>' + Math.log(result.priors.spam).toFixed(4) + '</span></div>';
                for (const d of result.wordDetails) {
                    html += '<div class="log-prob-term"><span>+ log P(' + this._escapeHtml(d.word) + '|Spam)</span><span>' + Math.log(d.pSpam).toFixed(4) + '</span></div>';
                }
                html += '<div class="log-prob-term total"><span>Total log P(Spam|msg)</span><span>' + (result.logScores.spam || 0).toFixed(4) + '</span></div>';

                html += '<br>';

                // Ham
                html += '<div class="log-prob-term"><span>log P(Ham)</span><span>' + Math.log(result.priors.ham).toFixed(4) + '</span></div>';
                for (const d of result.wordDetails) {
                    html += '<div class="log-prob-term"><span>+ log P(' + this._escapeHtml(d.word) + '|Ham)</span><span>' + Math.log(d.pHam).toFixed(4) + '</span></div>';
                }
                html += '<div class="log-prob-term total"><span>Total log P(Ham|msg)</span><span>' + (result.logScores.ham || 0).toFixed(4) + '</span></div>';

                html += '</td></tr>';
            }

            tbody.innerHTML = html;

            // Update word count badge
            const badge = document.getElementById('word-count-badge');
            if (badge) {
                badge.textContent = details.length + ' words';
            }
        }

        _renderTrainingData() {
            const list = document.getElementById('training-list');
            if (!list) return;

            let html = '';
            for (let i = 0; i < this.classifier.trainingData.length; i++) {
                const item = this.classifier.trainingData[i];
                html += '<div class="training-item ' + item.label + '">';
                html += '<span class="training-item-label ' + item.label + '">' + item.label + '</span>';
                html += '<span class="training-item-text">' + this._escapeHtml(item.text) + '</span>';
                html += '<span class="training-item-remove" data-index="' + i + '" title="Remove"><i class="fa fa-times"></i></span>';
                html += '</div>';
            }

            list.innerHTML = html;

            // Bind remove buttons
            list.querySelectorAll('.training-item-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                    this._onRemoveTraining(idx);
                });
            });
        }

        _onAddTraining() {
            const textEl = document.getElementById('new-training-text');
            const classEl = document.getElementById('new-training-class');
            const text = textEl ? textEl.value.trim() : '';
            const label = classEl ? classEl.value : 'spam';

            if (!text) return;

            // Add to training data and retrain
            const newData = [...this.classifier.trainingData, { text, label }];
            this.classifier.train(newData);

            // Clear input
            if (textEl) textEl.value = '';

            // Re-render
            this._renderTrainingData();
            this._renderNbFitPanel();
            this._updateStatus('Added training example');

            // Re-classify if there is a previous result
            if (this.lastResult) {
                this._onClassify();
            }
        }

        _onRemoveTraining(index) {
            const data = [...this.classifier.trainingData];
            if (index >= 0 && index < data.length) {
                data.splice(index, 1);
                this.classifier.train(data);
                this._renderTrainingData();
                this._renderNbFitPanel();
                    this._updateStatus('Removed training example');

                if (this.lastResult) {
                    this._onClassify();
                }
            }
        }

        _onReset() {
            this.classifier.train(DEFAULT_TRAINING_DATA);
            this.lastResult = null;

            // Reset UI
            const input = document.getElementById('message-input');
            if (input) input.value = '';

            const display = document.getElementById('result-display');
            if (display) display.style.display = 'none';

            const ppSection = document.getElementById('prior-posterior-section');
            if (ppSection) ppSection.style.display = 'none';

            const badge = document.getElementById('result-badge');
            if (badge) {
                badge.className = 'viz-badge result-badge';
                badge.textContent = 'Ready';
            }

            const tbody = document.getElementById('word-prob-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Classify a message to see word probabilities</td></tr>';
            }

            const wordBadge = document.getElementById('word-count-badge');
            if (wordBadge) wordBadge.textContent = '0 words';

            // Reset slider
            const alphaSlider = document.getElementById('alpha-slider');
            if (alphaSlider) {
                alphaSlider.value = 1;
                this.classifier.alpha = 1.0;
                document.getElementById('alpha-value').textContent = '1.0';
            }

            // Reset log probs toggle
            const logToggle = document.getElementById('show-log-probs');
            if (logToggle) {
                logToggle.checked = false;
                this.showLogProbs = false;
            }

            this._renderTrainingData();
            this._renderNbFitPanel();
            this._renderNbCalcPanel(null);
            this._updateStatus('Reset to defaults');
        }

        _renderNbFitPanel() {
            const el = document.getElementById('nb-fit-panel');
            if (!el) return;
            const cls = this.classifier;
            const classes = Object.keys(cls.classCounts);
            if (classes.length === 0) return;

            let html = '';
            html += '<div class="gnb-calc-title">Training: word frequencies per class</div>';

            for (const label of classes) {
                const count = cls.classCounts[label];
                const prior = cls.getPrior(label);
                const totalWords = cls.classTotalWords[label] || 0;
                const uniqueWords = Object.keys(cls.classWordCounts[label] || {}).length;
                const denom = totalWords + cls.alpha * cls.vocabulary.size;
                const icon = label === 'spam' ? '\u2717' : '\u2713';
                const Label = label.charAt(0).toUpperCase() + label.slice(1);

                html += '<div class="gnb-calc-class-block">';
                html += '<div style="font-weight:700;margin-bottom:4px;color:var(--nb-' + label + '-color)">' + icon + ' ' + Label + ' <span style="font-weight:400;opacity:0.7">(n=' + count + ', prior=' + prior.toFixed(3) + ')</span></div>';
                html += '<table class="gnb-fit-table">';
                html += '<tr><th>Total words</th><th>Unique words</th><th>Denominator</th></tr>';
                html += '<tr>';
                html += '<td>' + totalWords + '</td>';
                html += '<td>' + uniqueWords + '</td>';
                html += '<td>' + totalWords + '+' + cls.alpha + '\u00B7' + cls.vocabulary.size + ' = ' + denom.toFixed(1) + '</td>';
                html += '</tr>';
                html += '</table>';
                html += '</div>';
            }

            html += '<div style="margin-top:8px;font-size:11px;opacity:0.7">';
            html += 'Vocabulary |V| = ' + cls.vocabulary.size;
            html += ' \u00B7 Smoothing \u03B1 = ' + cls.alpha.toFixed(1);
            html += ' \u00B7 Formula: P(w|C) = (count+\u03B1) / (total+\u03B1\u00B7|V|)';
            html += '</div>';

            el.innerHTML = html;
        }

        _renderNbCalcPanel(result) {
            const el = document.getElementById('nb-calc-panel');
            if (!el) return;
            if (!result) {
                el.innerHTML = '<span class="formula-note">Classify a message to see the calculation breakdown.</span>';
                return;
            }

            const cls = this.classifier;
            const classes = ['spam', 'ham'];

            let html = '';
            html += '<div class="gnb-calc-title">log P(Class | msg) \u221D log P(Class) + \u03A3 log P(w\u1D62|Class)</div>';
            html += '<div style="font-size:10px;margin-bottom:8px;opacity:0.5">Computed in log-space to prevent underflow from multiplying many small probabilities.</div>';

            // Show test words as badges
            const wordBadges = result.words.map(w =>
                '<span class="gnb-val-badge gnb-val-test-pt">' + this._escapeHtml(w) + '</span>'
            ).join(' ');
            html += '<div style="font-size:11px;margin-bottom:8px;opacity:0.7">Message: ' + wordBadges + '</div>';

            for (const label of classes) {
                const isSpam = label === 'spam';
                const icon = isSpam ? '\u2717' : '\u2713';
                const Label = label.charAt(0).toUpperCase() + label.slice(1);
                const prior = result.priors[label];
                const valCls = 'gnb-val-badge ' + (isSpam ? 'gnb-val-class-1' : 'gnb-val-class-0');

                html += '<div class="gnb-calc-class-block">';
                html += '<div style="font-weight:700;margin-bottom:4px;color:var(--nb-' + label + '-color)">' + icon + ' ' + Label + '</div>';

                // Prior (show log value)
                html += '<div class="gnb-calc-row"><span>log P(' + Label + ')</span><span class="' + valCls + '">' + Math.log(prior).toFixed(4) + '</span></div>';

                // Per word likelihood
                const totalWords = cls.classTotalWords[label] || 0;
                const V = cls.vocabulary.size;
                const alpha = cls.alpha;
                for (const d of result.wordDetails) {
                    const pWord = isSpam ? d.pSpam : d.pHam;
                    const logPWord = Math.log(pWord);
                    const wordCount = (cls.classWordCounts[label] && cls.classWordCounts[label][d.word]) || 0;
                    const wordBadge = '<span class="gnb-val-badge gnb-val-test-pt">' + this._escapeHtml(d.word) + '</span>';

                    html += '<div class="gnb-calc-row">';
                    html += '<span>+ log P(' + wordBadge + ' | ' + Label + ') <span style="opacity:0.5">(' + wordCount + '+' + alpha + ')/(' + totalWords + '+' + alpha + '\u00B7' + V + ')</span></span>';
                    html += '<span class="' + valCls + '">' + logPWord.toFixed(4) + '</span>';
                    html += '</div>';
                }

                // Total
                html += '<div class="gnb-calc-row gnb-calc-formula-row">';
                html += '<span>log P(' + Label + ' | msg)</span>';
                html += '<span style="font-weight:700">' + (result.logScores[label] || 0).toFixed(4) + '</span>';
                html += '</div>';

                html += '</div>';
            }

            // Normalized result via log-sum-exp
            html += '<div class="gnb-calc-result">';
            html += '<div style="font-size:10px;opacity:0.5;margin-bottom:4px">Normalized via log-sum-exp (softmax):</div>';
            for (const label of classes) {
                const icon = label === 'spam' ? '\u2717' : '\u2713';
                const Label = label.charAt(0).toUpperCase() + label.slice(1);
                const pct = (result.probabilities[label] * 100).toFixed(1);
                const winner = label === result.predicted ? ' \u2190 predicted' : '';
                html += '<div class="gnb-calc-row" style="color:var(--nb-' + label + '-color)"><span>' + icon + ' P(' + Label + ' | msg)</span><span>' + pct + '%' + winner + '</span></div>';
            }
            html += '</div>';

            el.innerHTML = html;
        }

        _updateMetrics(result) {
            const vocabEl = document.getElementById('metric-vocab');
            const spamCountEl = document.getElementById('metric-spam-count');
            const hamCountEl = document.getElementById('metric-ham-count');
            const classEl = document.getElementById('metric-classification');
            const confEl = document.getElementById('metric-confidence');
            const alphaEl = document.getElementById('metric-alpha');

            if (vocabEl) vocabEl.textContent = this.classifier.vocabulary.size;
            if (spamCountEl) spamCountEl.textContent = this.classifier.classCounts.spam || 0;
            if (hamCountEl) hamCountEl.textContent = this.classifier.classCounts.ham || 0;
            if (alphaEl) alphaEl.textContent = this.classifier.alpha.toFixed(1);

            if (result) {
                if (classEl) {
                    classEl.innerHTML = result.predicted === 'spam'
                        ? '<span style="color: var(--nb-spam-color);">Spam</span>'
                        : '<span style="color: var(--nb-ham-color);">Ham</span>';
                }
                if (confEl) {
                    const conf = Math.max(result.probabilities.spam || 0, result.probabilities.ham || 0);
                    confEl.textContent = (conf * 100).toFixed(1) + '%';
                }
            } else {
                if (classEl) classEl.textContent = '-';
                if (confEl) confEl.textContent = '-';
            }
        }

        _updateStatus(text) {
            const el = document.getElementById('metric-status');
            if (el) el.textContent = text;
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // ============================================
    // Distribution Registry (pluggable PDFs)
    // ============================================
    const Distributions = {
        gaussian: {
            name: 'Gaussian',
            paramLabels: ['\u03BC (mean)', '\u03C3 (std)', '\u03C3\u00B2 (var)'],
            fit(values) {
                const n = values.length;
                let sum = 0;
                for (const v of values) sum += v;
                const mu = sum / n;
                let varSum = 0;
                for (const v of values) varSum += (v - mu) ** 2;
                const variance = Math.max(varSum / n, 1e-9);
                return { mu, variance };
            },
            pdf(x, params) {
                const { mu, variance } = params;
                return Math.exp(-((x - mu) ** 2) / (2 * variance)) / Math.sqrt(2 * Math.PI * variance);
            },
            paramValues(params) {
                return [params.mu, Math.sqrt(params.variance), params.variance];
            },
            paramDisplay(params) {
                return '\u03BC=' + params.mu.toFixed(2) + ', \u03C3=' + Math.sqrt(params.variance).toFixed(2);
            }
        },
        kde: {
            name: 'KDE',
            paramLabels: ['h (bandwidth)', 'n (points)'],
            fit(values) {
                const n = values.length;
                let sum = 0;
                for (const v of values) sum += v;
                const mean = sum / n;
                let varSum = 0;
                for (const v of values) varSum += (v - mean) ** 2;
                const std = Math.sqrt(varSum / n);
                // Silverman's rule
                const h = Math.max(1.06 * std * Math.pow(n, -0.2), 1e-6);
                return { h, data: values.slice(), n };
            },
            pdf(x, params) {
                const { h, data, n } = params;
                let sum = 0;
                for (const xi of data) {
                    const u = (x - xi) / h;
                    sum += Math.exp(-0.5 * u * u);
                }
                return sum / (n * h * Math.sqrt(2 * Math.PI));
            },
            paramValues(params) {
                return [params.h, params.n];
            },
            paramDisplay(params) {
                return 'h=' + params.h.toFixed(3) + ', n=' + params.n;
            }
        },
        laplace: {
            name: 'Laplace',
            paramLabels: ['\u03BC (median)', 'b (scale)'],
            fit(values) {
                const sorted = values.slice().sort((a, b) => a - b);
                const n = sorted.length;
                const mu = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
                let madSum = 0;
                for (const v of sorted) madSum += Math.abs(v - mu);
                const b = Math.max(madSum / n, 1e-9);
                return { mu, b };
            },
            pdf(x, params) {
                const { mu, b } = params;
                return Math.exp(-Math.abs(x - mu) / b) / (2 * b);
            },
            paramValues(params) {
                return [params.mu, params.b];
            },
            paramDisplay(params) {
                return '\u03BC=' + params.mu.toFixed(2) + ', b=' + params.b.toFixed(3);
            }
        },
        exponential: {
            name: 'Exponential',
            paramLabels: ['\u03BB (rate)'],
            fit(values) {
                let sum = 0;
                for (const v of values) sum += v;
                const mean = sum / values.length;
                const lambda = 1 / Math.max(mean, 1e-9);
                return { lambda };
            },
            pdf(x, params) {
                if (x < 0) return 1e-10;
                return params.lambda * Math.exp(-params.lambda * x);
            },
            paramValues(params) {
                return [params.lambda];
            },
            paramDisplay(params) {
                return '\u03BB=' + params.lambda.toFixed(3);
            }
        }
    };

    // ============================================
    // Gaussian Naive Bayes Classes
    // ============================================

    /**
     * GaussianNB - Naive Bayes classifier for continuous 2D data
     * Supports pluggable distribution types via the Distributions registry.
     */
    class GaussianNB {
        constructor() {
            this.params = [];   // per-class per-feature params: [[params_f0, params_f1], ...]
            this.priors = [];   // per-class priors
            this.classes = [];
            this.distType = 'gaussian';
        }

        fit(X, y) {
            this.classes = [...new Set(y)].sort();
            this.params = [];
            this.priors = [];
            const n = y.length;
            const dist = Distributions[this.distType];

            for (const cls of this.classes) {
                const indices = [];
                for (let i = 0; i < n; i++) {
                    if (y[i] === cls) indices.push(i);
                }
                this.priors.push(indices.length / n);

                const featureParams = [];
                for (let f = 0; f < 2; f++) {
                    const values = indices.map(idx => X[idx][f]);
                    featureParams.push(dist.fit(values));
                }
                this.params.push(featureParams);
            }
        }

        predict(testPoint) {
            const dist = Distributions[this.distType];
            const pdfs = [];      // per-class: [pdf_x1, pdf_x2]
            const unnormalized = [];
            for (let k = 0; k < this.classes.length; k++) {
                const pdf1 = dist.pdf(testPoint[0], this.params[k][0]);
                const pdf2 = dist.pdf(testPoint[1], this.params[k][1]);
                pdfs.push([pdf1, pdf2]);
                unnormalized.push(this.priors[k] * pdf1 * pdf2);
            }
            const total = unnormalized.reduce((s, v) => s + v, 0);
            const normalized = unnormalized.map(v => v / total);
            let predicted = 0;
            for (let k = 1; k < normalized.length; k++) {
                if (normalized[k] > normalized[predicted]) predicted = k;
            }
            return { pdfs, unnormalized, normalized, predicted };
        }
    }

    /**
     * Subsample a balanced dataset to create class imbalance.
     * ratio is the fraction of samples assigned to class 0 (majority).
     */
    function makeImbalanced(points, n, ratio) {
        const byClass = {};
        for (const p of points) {
            if (!byClass[p.classLabel]) byClass[p.classLabel] = [];
            byClass[p.classLabel].push(p);
        }
        const classes = Object.keys(byClass).sort((a, b) => a - b);
        const n0 = Math.round(n * ratio);
        const n1 = n - n0;
        const result = [];
        const c0 = byClass[classes[0]] || [];
        const c1 = byClass[classes[1]] || [];
        for (let i = 0; i < Math.min(n0, c0.length); i++) result.push(c0[i]);
        for (let i = 0; i < Math.min(n1, c1.length); i++) result.push(c1[i]);
        return result;
    }

    /**
     * Dataset generation helper - converts VizLib generator output to X, y arrays
     */
    function generateDataset(name, n, noiseLevel) {
        const gen = VizLib.DatasetGenerators;
        let points;
        switch (name) {
            case 'moons': points = gen.moons(n, noiseLevel); break;
            case 'circles': points = gen.circles(n, noiseLevel); break;
            case 'blobs': points = gen.blobs(n, 3); break;
            case 'linear': points = gen.linear(n, noiseLevel); break;
            case 'xor': points = gen.xor(n, noiseLevel); break;
            case 'spiral': points = gen.spiral(n, noiseLevel); break;
            case 'blobs4': points = generateBlobs(n, 4, noiseLevel); break;
            case 'blobs5': points = generateBlobs(n, 5, noiseLevel); break;
            case 'imbal-moons': points = makeImbalanced(gen.moons(n * 3, noiseLevel), n, 0.75); break;
            case 'imbal-blobs': points = makeImbalanced(gen.blobs(n * 3, 2), n, 0.8); break;
            case 'imbal-linear': points = makeImbalanced(gen.linear(n * 3, noiseLevel), n, 0.8); break;
            default: points = gen.moons(n, noiseLevel);
        }
        const X = points.map(p => [p.x, p.y]);
        const y = points.map(p => p.classLabel);
        return { X, y };
    }

    /** Generate blobs with arbitrary number of centers */
    function generateBlobs(n, numBlobs, noiseLevel) {
        const points = [];
        const std = 0.05 + noiseLevel * 0.3;
        const nPerBlob = Math.floor(n / numBlobs);
        // Arrange centers in a circle
        const cx = 0.5, cy = 0.5, radius = 0.3;
        const centers = [];
        for (let b = 0; b < numBlobs; b++) {
            const angle = (b / numBlobs) * Math.PI * 2 - Math.PI / 2;
            centers.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
        }
        for (let b = 0; b < numBlobs; b++) {
            for (let i = 0; i < nPerBlob; i++) {
                const x = centers[b].x + (Math.random() - 0.5 + Math.random() - 0.5) * std;
                const y = centers[b].y + (Math.random() - 0.5 + Math.random() - 0.5) * std;
                points.push({ x: Math.max(0.02, Math.min(0.98, x)), y: Math.max(0.02, Math.min(0.98, y)), classLabel: b });
            }
        }
        return points;
    }

    /**
     * Get theme colors for Gaussian NB renderers
     */
    function getGnbColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
        const classColors = isDark
            ? [EAIColor('class-1', 'dark'), EAIColor('class-0', 'dark'), EAIColor('class-2', 'dark'), EAIColor('class-4', 'dark'), EAIColor('class-9', 'dark')]
            : [EAIColor('class-1', 'light'), EAIColor('class-0', 'light'), EAIColor('class-2', 'light'), EAIColor('class-4', 'light'), EAIColor('class-9', 'light')];
        return {
            isDark,
            bg: isDark ? EAIColor('canvas', 'dark') : EAIColor('surface', 'light'),
            text: isDark ? EAIColor('ink-soft', 'dark') : EAIColor('ink-soft', 'light'),
            muted: isDark ? EAIColor('muted', 'dark') : EAIColor('axis', 'light'),
            grid: isDark ? EAIColor('sunken', 'dark') : EAIColor('sunken', 'light'),
            class0: classColors[0],
            class1: classColors[1],
            testPt: isDark ? EAIColor('purple', 'dark') : EAIColor('purple-mid', 'light'),
            class0Light: isDark ? EAIColor('blue', 0.3, 'dark') : EAIColor('blue-mid', 0.3),
            class1Light: isDark ? EAIColor('red', 0.3, 'dark') : EAIColor('red-mid', 0.3),
            classColors,
        };
    }

    // ============================================
    // ScatterRenderer
    // ============================================
    class ScatterRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.width = 0;
            this.height = 0;
            this.mapper = null;
        }

        setup() {
            const result = VizLib.setupHiDPICanvas(this.canvas);
            this.ctx = result.ctx;
            this.dpr = result.dpr;
            this.width = result.logicalWidth;
            this.height = result.logicalHeight;
        }

        render(X, y, testPoint, dataRange, highlightClass) {
            const ctx = this.ctx;
            if (!ctx) return;
            const c = getGnbColors();
            const pad = { top: 10, right: 10, bottom: 24, left: 24 };

            VizLib.resetCanvasTransform(ctx, this.dpr);
            VizLib.clearCanvas(ctx, this.width, this.height, c.bg);

            const plotW = this.width - pad.left - pad.right;
            const plotH = this.height - pad.top - pad.bottom;
            this.mapper = new VizLib.CanvasUtils.CoordinateMapper(
                pad.left, pad.top, plotW, plotH,
                dataRange.xMin, dataRange.xMax, dataRange.yMin, dataRange.yMax
            );

            // Light grid
            ctx.strokeStyle = c.grid;
            ctx.lineWidth = 0.5;
            const nTicks = 5;
            for (let i = 0; i <= nTicks; i++) {
                const frac = i / nTicks;
                const dx = dataRange.xMin + frac * (dataRange.xMax - dataRange.xMin);
                const dy = dataRange.yMin + frac * (dataRange.yMax - dataRange.yMin);
                const px = this.mapper.dataToCanvas(dx, 0);
                const py = this.mapper.dataToCanvas(0, dy);
                ctx.beginPath();
                ctx.moveTo(px.x, pad.top);
                ctx.lineTo(px.x, pad.top + plotH);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(pad.left, py.y);
                ctx.lineTo(pad.left + plotW, py.y);
                ctx.stroke();
            }

            // Axis labels
            ctx.fillStyle = c.muted;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Feature 1', pad.left + plotW / 2, this.height - 12);
            ctx.save();
            ctx.translate(10, pad.top + plotH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Feature 2', 0, 0);
            ctx.restore();

            // Data points
            for (let i = 0; i < X.length; i++) {
                const dimmed = highlightClass !== null && y[i] !== highlightClass;
                ctx.globalAlpha = dimmed ? 0.08 : 0.6;
                const pt = this.mapper.dataToCanvas(X[i][0], X[i][1]);
                const color = c.classColors[y[i]] || c.classColors[0];
                ctx.fillStyle = color;
                ctx.strokeStyle = color;
                drawClassMarker(ctx, pt.x, pt.y, y[i], 3);
            }
            ctx.globalAlpha = 1;

            // Test point dashed lines + question mark
            if (testPoint) {
                const tp = this.mapper.dataToCanvas(testPoint[0], testPoint[1]);

                // Dashed lines from canvas edges to the test point (no gap at labels)
                ctx.strokeStyle = c.testPt;
                ctx.lineWidth = 0.8;
                ctx.setLineDash([3, 3]);
                // Vertical: canvas bottom edge up to test point
                ctx.beginPath();
                ctx.moveTo(tp.x, this.height);
                ctx.lineTo(tp.x, tp.y);
                ctx.stroke();
                // Horizontal: canvas left edge across to test point
                ctx.beginPath();
                ctx.moveTo(0, tp.y);
                ctx.lineTo(tp.x, tp.y);
                ctx.stroke();
                ctx.setLineDash([]);

                drawTestPointMarker(ctx, tp.x, tp.y, c.testPt);
            }
        }

        getDataFromClick(canvasX, canvasY) {
            if (!this.mapper) return null;
            return this.mapper.canvasToData(canvasX, canvasY);
        }
    }

    // ============================================
    // Feature1DistRenderer (bottom, horizontal)
    // ============================================
    class Feature1DistRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.width = 0;
            this.height = 0;
        }

        setup() {
            const result = VizLib.setupHiDPICanvas(this.canvas);
            this.ctx = result.ctx;
            this.dpr = result.dpr;
            this.width = result.logicalWidth;
            this.height = result.logicalHeight;
        }

        render(gnb, testPoint, dataRange, prediction, X, y, highlightClass) {
            const ctx = this.ctx;
            if (!ctx) return;
            const c = getGnbColors();
            // Pad must align with scatter: same left pad
            const pad = { top: 4, right: 10, bottom: 8, left: 24 };

            VizLib.resetCanvasTransform(ctx, this.dpr);
            VizLib.clearCanvas(ctx, this.width, this.height, c.bg);

            const plotW = this.width - pad.left - pad.right;
            const plotH = this.height - pad.top - pad.bottom;

            // Compute max PDF for Y scale
            let maxPdf = 0;
            const nSamples = 150;
            const curves = [];
            for (let k = 0; k < gnb.classes.length; k++) {
                const pts = [];
                for (let i = 0; i <= nSamples; i++) {
                    const x = dataRange.xMin + (i / nSamples) * (dataRange.xMax - dataRange.xMin);
                    const pdf = Distributions[gnb.distType].pdf(x, gnb.params[k][0]);
                    pts.push({ x, pdf });
                    if (pdf > maxPdf) maxPdf = pdf;
                }
                curves.push(pts);
            }
            const pdfMax = maxPdf * 1.2;

            const mapper = new VizLib.CanvasUtils.CoordinateMapper(
                pad.left, pad.top, plotW, plotH,
                dataRange.xMin, dataRange.xMax, 0, pdfMax
            );

            // Rug plot: draw data points along the baseline
            if (X && y) {
                const rugY = pdfMax * 0.04;
                for (let i = 0; i < X.length; i++) {
                    const dimmed = highlightClass !== null && y[i] !== highlightClass;
                    ctx.globalAlpha = dimmed ? 0.08 : 0.6;
                    const pt = mapper.dataToCanvas(X[i][0], rugY);
                    const color = c.classColors[y[i]] || c.classColors[0];
                    ctx.fillStyle = color;
                    ctx.strokeStyle = color;
                    drawClassMarker(ctx, pt.x, pt.y, y[i], 2.5);
                }
                ctx.globalAlpha = 1;
            }

            // Draw curves
            const classColors = c.classColors;
            const badgesF1 = [];
            for (let k = 0; k < curves.length; k++) {
                const dimmed = highlightClass !== null && k !== highlightClass;
                ctx.globalAlpha = dimmed ? 0.1 : 1;
                ctx.strokeStyle = classColors[k];
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let i = 0; i <= nSamples; i++) {
                    const pt = mapper.dataToCanvas(curves[k][i].x, curves[k][i].pdf);
                    if (i === 0) ctx.moveTo(pt.x, pt.y);
                    else ctx.lineTo(pt.x, pt.y);
                }
                ctx.stroke();

                // Star + class-colored dashed line to Y axis
                if (testPoint && prediction) {
                    const pdfVal = prediction.pdfs[k][0];
                    const sp = mapper.dataToCanvas(testPoint[0], pdfVal);
                    const axisX = pad.left;

                    ctx.strokeStyle = classColors[k];
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(sp.x, sp.y);
                    ctx.lineTo(axisX, sp.y);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    badgesF1.push({ text: pdfVal.toFixed(2), y: sp.y, color: classColors[k] });
                    drawSmallTestMarker(ctx, sp.x, sp.y, c.testPt);
                }
                ctx.globalAlpha = 1;
            }

            // Draw PDF badges with overlap resolution
            if (badgesF1.length > 1) {
                badgesF1.sort((a, b) => a.y - b.y);
                for (let pass = 0; pass < 10; pass++) {
                    let moved = false;
                    for (let i = 1; i < badgesF1.length; i++) {
                        const overlap = 15 - (badgesF1[i].y - badgesF1[i - 1].y);
                        if (overlap > 0) {
                            badgesF1[i - 1].y -= overlap / 2;
                            badgesF1[i].y += overlap / 2;
                            moved = true;
                        }
                    }
                    if (!moved) break;
                }
            }
            for (const b of badgesF1) {
                drawBadgeLabel(ctx, b.text, pad.left - 3, b.y, b.color, 'right', 'middle');
            }

            // Vertical line at test point x1 (extend to top of canvas for seamless connection)
            if (testPoint) {
                const tp = mapper.dataToCanvas(testPoint[0], 0);
                ctx.strokeStyle = c.testPt;
                ctx.lineWidth = 0.8;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(tp.x, 0);
                ctx.lineTo(tp.x, pad.top + plotH);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    // ============================================
    // Feature2DistRenderer (left, vertical)
    // ============================================
    class Feature2DistRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = null;
            this.dpr = 1;
            this.width = 0;
            this.height = 0;
        }

        setup() {
            const result = VizLib.setupHiDPICanvas(this.canvas);
            this.ctx = result.ctx;
            this.dpr = result.dpr;
            this.width = result.logicalWidth;
            this.height = result.logicalHeight;
        }

        render(gnb, testPoint, dataRange, prediction, X, y, highlightClass) {
            const ctx = this.ctx;
            if (!ctx) return;
            const c = getGnbColors();
            // Pad: right edge aligns with scatter's left edge
            const pad = { top: 10, right: 4, bottom: 24, left: 8 };

            VizLib.resetCanvasTransform(ctx, this.dpr);
            VizLib.clearCanvas(ctx, this.width, this.height, c.bg);

            const plotW = this.width - pad.left - pad.right;
            const plotH = this.height - pad.top - pad.bottom;

            // Compute max PDF for X scale (horizontal axis is PDF, grows left-to-right)
            let maxPdf = 0;
            const nSamples = 150;
            const curves = [];
            for (let k = 0; k < gnb.classes.length; k++) {
                const pts = [];
                for (let i = 0; i <= nSamples; i++) {
                    const yVal = dataRange.yMin + (i / nSamples) * (dataRange.yMax - dataRange.yMin);
                    const pdf = Distributions[gnb.distType].pdf(yVal, gnb.params[k][1]);
                    pts.push({ y: yVal, pdf });
                    if (pdf > maxPdf) maxPdf = pdf;
                }
                curves.push(pts);
            }
            const pdfMax = maxPdf * 1.2;

            const classColors = c.classColors;

            // Helper: map data y to canvas y (same as scatter)
            const dataToCanvasY = (dy) => {
                return pad.top + plotH - ((dy - dataRange.yMin) / (dataRange.yMax - dataRange.yMin)) * plotH;
            };
            // Helper: map pdf value to canvas x (grows rightward from left edge)
            const pdfToCanvasX = (pdf) => {
                return pad.left + (pdf / pdfMax) * plotW;
            };

            // Rug plot: draw data points along the left edge
            if (X && y) {
                const rugX = pdfToCanvasX(pdfMax * 0.04);
                for (let i = 0; i < X.length; i++) {
                    const dimmed = highlightClass !== null && y[i] !== highlightClass;
                    ctx.globalAlpha = dimmed ? 0.08 : 0.6;
                    const cy = dataToCanvasY(X[i][1]);
                    const color = classColors[y[i]] || classColors[0];
                    ctx.fillStyle = color;
                    ctx.strokeStyle = color;
                    drawClassMarker(ctx, rugX, cy, y[i], 2.5);
                }
                ctx.globalAlpha = 1;
            }

            const badgesF2 = [];
            for (let k = 0; k < curves.length; k++) {
                const dimmed = highlightClass !== null && k !== highlightClass;
                ctx.globalAlpha = dimmed ? 0.1 : 1;
                ctx.strokeStyle = classColors[k];
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let i = 0; i <= nSamples; i++) {
                    const cx = pdfToCanvasX(curves[k][i].pdf);
                    const cy = dataToCanvasY(curves[k][i].y);
                    if (i === 0) ctx.moveTo(cx, cy);
                    else ctx.lineTo(cx, cy);
                }
                ctx.stroke();

                // Star + class-colored dashed line to X axis (bottom)
                if (testPoint && prediction) {
                    const pdfVal = prediction.pdfs[k][1];
                    const sx = pdfToCanvasX(pdfVal);
                    const sy = dataToCanvasY(testPoint[1]);
                    const axisY = pad.top + plotH;

                    ctx.strokeStyle = classColors[k];
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx, axisY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    badgesF2.push({ text: pdfVal.toFixed(2), x: sx, color: classColors[k] });
                    drawSmallTestMarker(ctx, sx, sy, c.testPt);
                }
                ctx.globalAlpha = 1;
            }

            // Draw PDF badges with overlap resolution
            if (badgesF2.length > 1) {
                badgesF2.sort((a, b) => a.x - b.x);
                for (let pass = 0; pass < 10; pass++) {
                    let moved = false;
                    for (let i = 1; i < badgesF2.length; i++) {
                        const overlap = 38 - (badgesF2[i].x - badgesF2[i - 1].x);
                        if (overlap > 0) {
                            badgesF2[i - 1].x -= overlap / 2;
                            badgesF2[i].x += overlap / 2;
                            moved = true;
                        }
                    }
                    if (!moved) break;
                }
            }
            const axisYBadge = pad.top + plotH;
            for (const b of badgesF2) {
                drawBadgeLabel(ctx, b.text, b.x, axisYBadge + 2, b.color, 'center', 'top');
            }

            // Horizontal line at test point y (extend to right edge for seamless connection)
            if (testPoint) {
                const ty = dataToCanvasY(testPoint[1]);
                ctx.strokeStyle = c.testPt;
                ctx.lineWidth = 0.8;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(pad.left, ty);
                ctx.lineTo(this.width, ty);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    /** Class icon helper */
    function classIcon(k) {
        const icons = ['\u25CF', '\u2717', '\u25B3', '\u25C6', '\u25A0'];
        return icons[k] || '\u25CF';
    }

    /** Draw a data point marker for the given class index */
    function drawClassMarker(ctx, x, y, classIdx, size) {
        switch (classIdx) {
            case 0: // Circle
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 1: // X mark
                ctx.lineWidth = size * 0.5;
                ctx.beginPath();
                ctx.moveTo(x - size, y - size);
                ctx.lineTo(x + size, y + size);
                ctx.moveTo(x + size, y - size);
                ctx.lineTo(x - size, y + size);
                ctx.stroke();
                break;
            case 2: // Triangle
                ctx.beginPath();
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size, y + size * 0.7);
                ctx.lineTo(x - size, y + size * 0.7);
                ctx.closePath();
                ctx.fill();
                break;
            case 3: // Diamond
                ctx.beginPath();
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size, y);
                ctx.lineTo(x, y + size);
                ctx.lineTo(x - size, y);
                ctx.closePath();
                ctx.fill();
                break;
            default: // Square
                ctx.fillRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4);
                break;
        }
    }

    /** Draw text inside a colored rounded-rect badge on canvas */
    function drawBadgeLabel(ctx, text, x, y, color, align, baseline) {
        ctx.font = '8px sans-serif';
        const m = ctx.measureText(text);
        const padH = 3, padV = 2, radius = 2;
        const w = m.width + padH * 2;
        const h = 10 + padV * 2;

        // Compute top-left of badge based on alignment
        let bx = x - padH;
        if (align === 'right') bx = x - m.width - padH;
        else if (align === 'center') bx = x - m.width / 2 - padH;

        let by = y - 5 - padV;
        if (baseline === 'top') by = y - padV;
        else if (baseline === 'bottom') by = y - 10 - padV;

        // Background rounded rect
        const r2 = Math.min(radius, w / 2, h / 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.moveTo(bx + r2, by);
        ctx.lineTo(bx + w - r2, by);
        ctx.quadraticCurveTo(bx + w, by, bx + w, by + r2);
        ctx.lineTo(bx + w, by + h - r2);
        ctx.quadraticCurveTo(bx + w, by + h, bx + w - r2, by + h);
        ctx.lineTo(bx + r2, by + h);
        ctx.quadraticCurveTo(bx, by + h, bx, by + h - r2);
        ctx.lineTo(bx, by + r2);
        ctx.quadraticCurveTo(bx, by, bx + r2, by);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Text
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        ctx.fillText(text, x, y);
    }

    /** Draw a purple question mark test point marker */
    function drawTestPointMarker(ctx, cx, cy, color) {
        // Circle background — solid light purple
        const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
        ctx.fillStyle = isDark ? EAIColor('purple') : EAIColor('purple-fill');
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
        // Question mark text
        ctx.fillStyle = color;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy + 1);
    }

    /** Draw a small purple question mark on distribution curves */
    function drawSmallTestMarker(ctx, cx, cy, color) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
        ctx.fillStyle = isDark ? EAIColor('purple') : EAIColor('purple-fill');
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy + 0.5);
    }

    // ============================================
    // CalcPanelRenderer
    // ============================================
    class CalcPanelRenderer {
        render(el, gnb, testPoint, prediction, highlightClass) {
            if (!el) return;
            if (!prediction) {
                el.innerHTML = '<span class="formula-note">Click a point on the scatter plot to see the calculation breakdown.</span>';
                return;
            }

            const qBadge = '<span class="gnb-val-badge gnb-val-test-pt">?</span>';
            const x1Badge = '<span class="gnb-val-badge gnb-val-test-pt">x\u2081=' + testPoint[0].toFixed(2) + '</span>';
            const x2Badge = '<span class="gnb-val-badge gnb-val-test-pt">x\u2082=' + testPoint[1].toFixed(2) + '</span>';

            let html = '';
            html += '<div class="gnb-calc-title">P(Class | ' + qBadge + ') \u221D P(Class) \u00B7 P(x\u2081|Class) \u00B7 P(x\u2082|Class)</div>';

            html += '<div style="font-size:11px;margin-bottom:8px;opacity:0.7">Test point: ' + qBadge + ' = (' + testPoint[0].toFixed(3) + ', ' + testPoint[1].toFixed(3) + ')</div>';

            const dist = Distributions[gnb.distType];
            for (let k = 0; k < gnb.classes.length; k++) {
                const cls = 'gnb-class-' + k;
                const pdf1 = prediction.pdfs[k][0];
                const pdf2 = prediction.pdfs[k][1];
                const prior = gnb.priors[k];
                const paramStr1 = dist.paramDisplay(gnb.params[k][0]);
                const paramStr2 = dist.paramDisplay(gnb.params[k][1]);

                const selected = highlightClass === k ? ' gnb-class-selected' : '';
                const dimmed = highlightClass !== null && highlightClass !== k ? ' gnb-class-dimmed' : '';
                html += '<div class="gnb-calc-class-block gnb-clickable-class' + selected + dimmed + '" data-gnb-class="' + k + '">';
                html += '<div class="' + cls + '" style="font-weight:700;margin-bottom:4px">' + classIcon(k) + ' Class ' + k + '</div>';
                const valCls = 'gnb-val-badge gnb-val-class-' + k;
                const pdf1Badge = '<span class="' + valCls + '">' + pdf1.toExponential(3) + '</span>';
                const pdf2Badge = '<span class="' + valCls + '">' + pdf2.toExponential(3) + '</span>';

                html += '<div class="gnb-calc-row"><span>P(Class ' + k + ')</span><span>' + prior.toFixed(3) + '</span></div>';
                html += '<div class="gnb-calc-row"><span>P(' + x1Badge + ' | ' + paramStr1 + ')</span>' + pdf1Badge + '</div>';
                html += '<div class="gnb-calc-row"><span>P(' + x2Badge + ' | ' + paramStr2 + ')</span>' + pdf2Badge + '</div>';
                html += '<div class="gnb-calc-row gnb-calc-formula-row">';
                html += '<span>P(C' + k + ') \u00B7 P(x\u2081|C' + k + ') \u00B7 P(x\u2082|C' + k + ')</span>';
                html += '</div>';
                html += '<div class="gnb-calc-row gnb-calc-numbers-row">';
                html += '<span>' + prior.toFixed(3) + ' \u00D7 ' + pdf1Badge + ' \u00D7 ' + pdf2Badge + '</span>';
                html += '<span style="font-weight:700">= ' + prediction.unnormalized[k].toExponential(3) + '</span>';
                html += '</div>';
                html += '</div>';
            }

            html += '<div class="gnb-calc-result">';
            for (let k = 0; k < gnb.classes.length; k++) {
                const cls = 'gnb-class-' + k;
                const pct = (prediction.normalized[k] * 100).toFixed(1);
                const winner = k === prediction.predicted ? ' \u2190 predicted' : '';
                html += '<div class="gnb-calc-row ' + cls + '"><span>' + classIcon(k) + ' P(Class ' + k + ' | <span class="gnb-test-pt">?</span>)</span><span>' + pct + '%' + winner + '</span></div>';
            }
            html += '</div>';

            el.innerHTML = html;
        }
    }

    // ============================================
    // GaussianNBController
    // ============================================
    class GaussianNBController {
        constructor() {
            this.gnb = new GaussianNB();
            this.scatterRenderer = null;
            this.dist1Renderer = null;
            this.dist2Renderer = null;
            this.calcRenderer = new CalcPanelRenderer();
            this.X = [];
            this.y = [];
            this.testPoint = null;
            this.dataRange = null;
            this.prediction = null;
            this.dataset = 'moons';
            this.noise = 0.1;
            this.samples = 100;
            this.highlightClass = null; // null = all, or class index to highlight
            this._initialized = false;
        }

        init() {
            // Setup canvases
            const scatterCanvas = document.getElementById('gnb-scatter-canvas');
            const dist1Canvas = document.getElementById('gnb-dist1-canvas');
            const dist2Canvas = document.getElementById('gnb-dist2-canvas');

            if (!scatterCanvas || !dist1Canvas || !dist2Canvas) return;

            this.scatterRenderer = new ScatterRenderer(scatterCanvas);
            this.dist1Renderer = new Feature1DistRenderer(dist1Canvas);
            this.dist2Renderer = new Feature2DistRenderer(dist2Canvas);

            this.scatterRenderer.setup();
            this.dist1Renderer.setup();
            this.dist2Renderer.setup();

            this._regenerate();
            this._bindEvents();
            this._initialized = true;
        }

        _bindEvents() {
            // Scatter click + drag
            const scatterCanvas = document.getElementById('gnb-scatter-canvas');
            if (scatterCanvas) {
                let dragging = false;

                const moveTestPoint = (clientX, clientY) => {
                    const rect = scatterCanvas.getBoundingClientRect();
                    const cx = clientX - rect.left;
                    const cy = clientY - rect.top;
                    const dataPt = this.scatterRenderer.getDataFromClick(cx, cy);
                    if (dataPt) {
                        this.testPoint = [dataPt.x, dataPt.y];
                        this.render();
                    }
                };

                scatterCanvas.addEventListener('mousedown', (e) => {
                    dragging = true;
                    moveTestPoint(e.clientX, e.clientY);
                });
                window.addEventListener('mousemove', (e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    moveTestPoint(e.clientX, e.clientY);
                });
                window.addEventListener('mouseup', () => { dragging = false; });

                // Touch support
                scatterCanvas.addEventListener('touchstart', (e) => {
                    dragging = true;
                    const t = e.touches[0];
                    moveTestPoint(t.clientX, t.clientY);
                    e.preventDefault();
                }, { passive: false });
                window.addEventListener('touchmove', (e) => {
                    if (!dragging) return;
                    const t = e.touches[0];
                    moveTestPoint(t.clientX, t.clientY);
                    e.preventDefault();
                }, { passive: false });
                window.addEventListener('touchend', () => { dragging = false; });

                scatterCanvas.style.cursor = 'crosshair';
            }

            // Dataset dropdown
            const datasetSelect = document.getElementById('gnb-dataset-select');
            if (datasetSelect) {
                datasetSelect.addEventListener('change', (e) => {
                    this.dataset = e.target.value;
                    this._regenerate();
                });
            }

            // Distribution dropdown
            const distSelect = document.getElementById('gnb-dist-select');
            if (distSelect) {
                distSelect.addEventListener('change', (e) => {
                    this.gnb.distType = e.target.value;
                    this.gnb.fit(this.X, this.y);
                    this.render();
                });
            }

            // Noise slider
            const noiseSlider = document.getElementById('gnb-noise-slider');
            if (noiseSlider) {
                noiseSlider.addEventListener('input', (e) => {
                    this.noise = parseFloat(e.target.value);
                    document.getElementById('gnb-noise-value').textContent = this.noise.toFixed(2);
                });
                noiseSlider.addEventListener('change', () => {
                    this._regenerate();
                });
            }

            // Samples slider
            const samplesSlider = document.getElementById('gnb-samples-slider');
            if (samplesSlider) {
                samplesSlider.addEventListener('input', (e) => {
                    this.samples = parseInt(e.target.value);
                    document.getElementById('gnb-samples-value').textContent = this.samples;
                });
                samplesSlider.addEventListener('change', () => {
                    this._regenerate();
                });
            }

            // Regenerate button
            const regenBtn = document.getElementById('gnb-btn-regenerate');
            if (regenBtn) {
                regenBtn.addEventListener('click', () => this._regenerate());
            }

            // Reset button
            const resetBtn = document.getElementById('gnb-btn-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.dataset = 'moons';
                    this.noise = 0.1;
                    this.samples = 100;
                    this.gnb.distType = 'gaussian';
                    const ds = document.getElementById('gnb-dataset-select');
                    if (ds) ds.value = 'moons';
                    const dsel = document.getElementById('gnb-dist-select');
                    if (dsel) dsel.value = 'gaussian';
                    const ns = document.getElementById('gnb-noise-slider');
                    if (ns) { ns.value = 0.1; document.getElementById('gnb-noise-value').textContent = '0.10'; }
                    const ss = document.getElementById('gnb-samples-slider');
                    if (ss) { ss.value = 100; document.getElementById('gnb-samples-value').textContent = '100'; }
                    this._regenerate();
                });
            }

            // Theme change
            document.addEventListener('themechange', () => {
                if (this._initialized) this.render();
            });
        }

        resize() {
            if (!this._initialized) return;
            this.scatterRenderer.setup();
            this.dist1Renderer.setup();
            this.dist2Renderer.setup();
            this.render();
        }

        _regenerate() {
            const data = generateDataset(this.dataset, this.samples, this.noise);
            this.X = data.X;
            this.y = data.y;
            this.gnb.fit(this.X, this.y);

            // Pick a random test point from data
            const idx = Math.floor(Math.random() * this.X.length);
            this.testPoint = [this.X[idx][0], this.X[idx][1]];

            // Compute data range with padding
            let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
            for (const pt of this.X) {
                if (pt[0] < xMin) xMin = pt[0];
                if (pt[0] > xMax) xMax = pt[0];
                if (pt[1] < yMin) yMin = pt[1];
                if (pt[1] > yMax) yMax = pt[1];
            }
            const padX = (xMax - xMin) * 0.1;
            const padY = (yMax - yMin) * 0.1;
            this.dataRange = {
                xMin: xMin - padX, xMax: xMax + padX,
                yMin: yMin - padY, yMax: yMax + padY
            };

            this.highlightClass = null; // Reset highlight on new data
            this.render();
        }

        _renderFitPanel() {
            const el = document.getElementById('gnb-fit-panel');
            if (!el) return;
            const gnb = this.gnb;

            let html = '';
            const dist = Distributions[gnb.distType];
            html += '<div class="gnb-calc-title">Training: fit ' + dist.name + ' parameters per class per feature</div>';

            for (let k = 0; k < gnb.classes.length; k++) {
                const cls = 'gnb-class-' + k;
                const n = this.y.filter(v => v === k).length;
                const prior = gnb.priors[k];

                const selected = this.highlightClass === k ? ' gnb-class-selected' : '';
                const dimmed = this.highlightClass !== null && this.highlightClass !== k ? ' gnb-class-dimmed' : '';
                html += '<div class="gnb-calc-class-block gnb-clickable-class' + selected + dimmed + '" data-gnb-class="' + k + '">';
                html += '<div class="' + cls + '" style="font-weight:700;margin-bottom:4px">' + classIcon(k) + ' Class ' + k + ' <span style="font-weight:400;opacity:0.7">(n=' + n + ', prior=' + prior.toFixed(3) + ')</span></div>';

                html += '<table class="gnb-fit-table">';
                html += '<tr><th></th>';
                for (const label of dist.paramLabels) {
                    html += '<th>' + label + '</th>';
                }
                html += '</tr>';
                for (let f = 0; f < 2; f++) {
                    html += '<tr class="' + cls + '">';
                    html += '<td style="font-weight:600">' + classIcon(k) + ' Feature ' + (f + 1) + '</td>';
                    for (const val of dist.paramValues(gnb.params[k][f])) {
                        html += '<td>' + val.toFixed(4) + '</td>';
                    }
                    html += '</tr>';
                }
                html += '</table>';
                html += '</div>';
            }

            el.innerHTML = html;
        }

        render() {
            if (!this.scatterRenderer) return;
            this.prediction = this.gnb.predict(this.testPoint);
            const hl = this.highlightClass;

            this.scatterRenderer.render(this.X, this.y, this.testPoint, this.dataRange, hl);
            this.dist1Renderer.render(this.gnb, this.testPoint, this.dataRange, this.prediction, this.X, this.y, hl);
            this.dist2Renderer.render(this.gnb, this.testPoint, this.dataRange, this.prediction, this.X, this.y, hl);

            const calcPanel = document.getElementById('gnb-calc-panel');
            this.calcRenderer.render(calcPanel, this.gnb, this.testPoint, this.prediction, hl);

            // Re-render fit panel to update selected/dimmed states
            this._renderFitPanel();

            // Bind click events on class blocks
            this._bindClassBlockClicks();

            // Update test point label in header
            const tpLabel = document.getElementById('gnb-test-point-label');
            if (tpLabel && this.testPoint) {
                tpLabel.innerHTML = '? (' + this.testPoint[0].toFixed(2) + ', ' + this.testPoint[1].toFixed(2) + ')';
            }

            // Update badge with class icon and color
            const badge = document.getElementById('gnb-result-badge');
            if (badge && this.prediction) {
                const cls = this.prediction.predicted;
                const pct = (this.prediction.normalized[cls] * 100).toFixed(1);
                badge.className = 'viz-badge gnb-badge-' + cls;
                badge.textContent = classIcon(cls) + ' Class ' + cls + ' (' + pct + '%)';
            }

            // Update legend dynamically based on number of classes
            const legendEl = document.getElementById('gnb-legend');
            if (legendEl) {
                let legendHtml = '';
                for (let k = 0; k < this.gnb.classes.length; k++) {
                    legendHtml += '<span class="gnb-legend-item"><span class="gnb-legend-swatch class-' + k + '"></span> ' + classIcon(k) + ' Class ' + k + '</span>';
                }
                legendHtml += '<span class="gnb-legend-item"><span class="gnb-legend-swatch test-pt"></span> Test Point (click to move)</span>';
                legendEl.innerHTML = legendHtml;
            }

        }

        _bindClassBlockClicks() {
            const blocks = document.querySelectorAll('.gnb-clickable-class[data-gnb-class]');
            blocks.forEach(block => {
                block.addEventListener('click', (e) => {
                    const clickedClass = parseInt(block.getAttribute('data-gnb-class'));
                    // Toggle: if already selected, deselect (show all)
                    if (this.highlightClass === clickedClass) {
                        this.highlightClass = null;
                    } else {
                        this.highlightClass = clickedClass;
                    }
                    this.render();
                });
            });
        }

    }

    // ============================================
    // Mode Switching
    // ============================================
    let gaussianController = null;

    function switchMode(mode) {
        const textMode = document.getElementById('nb-text-mode');
        const gaussianMode = document.getElementById('nb-gaussian-mode');

        if (!textMode || !gaussianMode) return;

        // Sync all toggle buttons across both headers
        document.querySelectorAll('.nb-mode-toggle .btn').forEach(btn => {
            const isText = btn.id.startsWith('btn-mode-text');
            const isGaussian = btn.id.startsWith('btn-mode-gaussian');
            if (isText) btn.classList.toggle('active', mode === 'text');
            if (isGaussian) btn.classList.toggle('active', mode === 'gaussian');
        });

        // Show/hide mode containers
        textMode.style.display = mode === 'text' ? '' : 'none';
        gaussianMode.style.display = mode === 'gaussian' ? '' : 'none';

        // Toggle info tab content
        document.querySelectorAll('.nb-info-text-mode').forEach(el => {
            el.style.display = mode === 'text' ? '' : 'none';
        });
        document.querySelectorAll('.nb-info-gaussian-mode').forEach(el => {
            el.style.display = mode === 'gaussian' ? '' : 'none';
        });

        // Lazy-init Gaussian controller
        if (mode === 'gaussian' && !gaussianController) {
            gaussianController = new GaussianNBController();
            // Delay init slightly so the container is visible and canvases have dimensions
            requestAnimationFrame(() => {
                gaussianController.init();
            });
        } else if (mode === 'gaussian' && gaussianController && gaussianController._initialized) {
            // Re-setup canvases after being hidden (dimensions may have changed)
            requestAnimationFrame(() => {
                gaussianController.resize();
            });
        }
    }

    // ============================================
    // Initialize on DOM ready
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        const visualizer = new NaiveBayesVisualizer();
        visualizer.init();

        // Mode toggle buttons (both sets)
        document.querySelectorAll('.nb-mode-toggle .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id.startsWith('btn-mode-text')) switchMode('text');
                else if (btn.id.startsWith('btn-mode-gaussian')) switchMode('gaussian');
            });
        });

        // Initialize with continuous (gaussian) mode by default
        switchMode('gaussian');

        // Resize handler for Gaussian mode
        let gnbResizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(gnbResizeTimeout);
            gnbResizeTimeout = setTimeout(() => {
                if (gaussianController && gaussianController._initialized) {
                    gaussianController.resize();
                }
            }, 100);
        });
    });

})();

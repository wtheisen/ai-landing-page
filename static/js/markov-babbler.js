/**
 * Markov Babbler Visualization
 *
 * Builds word-level n-gram Markov chains from text corpora and generates
 * new text one word at a time, with a radial context graph showing
 * candidate next words and their probabilities.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 380;
    const MAX_DISPLAY_CANDIDATES = 12;
    const MIN_ORDER = 1;
    const MAX_ORDER = 4;
    const MIN_WORDS = 10;
    const MAX_WORDS = 100;
    const WORDS_STEP = 10;

    // ============================================
    // Preset Corpora
    // ============================================
    const CORPORA = {
        nursery: [
            'Jack and Jill went up the hill to fetch a pail of water.',
            'Jack fell down and broke his crown and Jill came tumbling after.',
            'Humpty Dumpty sat on a wall. Humpty Dumpty had a great fall.',
            'All the king\'s horses and all the king\'s men could not put Humpty together again.',
            'Mary had a little lamb its fleece was white as snow.',
            'And everywhere that Mary went the lamb was sure to go.',
            'It followed her to school one day which was against the rule.',
            'It made the children laugh and play to see a lamb at school.',
            'Twinkle twinkle little star how I wonder what you are.',
            'Up above the world so high like a diamond in the sky.',
            'Hey diddle diddle the cat and the fiddle the cow jumped over the moon.',
            'The little dog laughed to see such sport and the dish ran away with the spoon.',
            'Little Bo Peep has lost her sheep and doesn\'t know where to find them.',
            'Leave them alone and they\'ll come home bringing their tails behind them.',
            'Baa baa black sheep have you any wool.',
            'Yes sir yes sir three bags full.',
            'One for the master and one for the dame and one for the little boy who lives down the lane.',
            'Jack be nimble Jack be quick Jack jump over the candlestick.',
            'Little Miss Muffet sat on a tuffet eating her curds and whey.',
            'Along came a spider who sat down beside her and frightened Miss Muffet away.',
            'Hickory dickory dock the mouse ran up the clock.',
            'The clock struck one the mouse ran down hickory dickory dock.',
            'Row row row your boat gently down the stream.',
            'Merrily merrily merrily merrily life is but a dream.',
            'Three blind mice three blind mice see how they run.',
            'They all ran after the farmer\'s wife who cut off their tails with a carving knife.',
            'Did you ever see such a thing in your life as three blind mice.',
            'London Bridge is falling down falling down falling down.',
            'London Bridge is falling down my fair lady.',
            'Ring around the rosie a pocket full of posies.',
            'Ashes ashes we all fall down.',
            'Old Mother Hubbard went to the cupboard to give the poor dog a bone.',
            'When she got there the cupboard was bare and so the poor dog had none.'
        ].join(' '),

        shakespeare: [
            'Shall I compare thee to a summer\'s day.',
            'Thou art more lovely and more temperate.',
            'Rough winds do shake the darling buds of May and summer\'s lease hath all too short a date.',
            'Sometime too hot the eye of heaven shines and often is his gold complexion dimmed.',
            'And every fair from fair sometime declines by chance or nature\'s changing course untrimmed.',
            'But thy eternal summer shall not fade nor lose possession of that fair thou owest.',
            'Nor shall death brag thou wanderest in his shade when in eternal lines to time thou growest.',
            'So long as men can breathe or eyes can see so long lives this and this gives life to thee.',
            'When I do count the clock that tells the time and see the brave day sunk in hideous night.',
            'When I behold the violet past prime and sable curls all silvered o\'er with white.',
            'When lofty trees I see barren of leaves which erst from heat did canopy the herd.',
            'And summer\'s green all girded up in sheaves borne on the bier with white and bristly beard.',
            'Then of thy beauty do I question make that thou among the wastes of time must go.',
            'Let me not to the marriage of true minds admit impediments.',
            'Love is not love which alters when it alteration finds or bends with the remover to remove.',
            'It is an ever fixed mark that looks on tempests and is never shaken.',
            'It is the star to every wandering bark whose worth\'s unknown although his height be taken.',
            'Love alters not with his brief hours and weeks but bears it out even to the edge of doom.',
            'If this be error and upon me proved I never writ nor no man ever loved.',
            'My mistress\' eyes are nothing like the sun.',
            'Coral is far more red than her lips red.',
            'If snow be white why then her breasts are dun.',
            'If hairs be wires black wires grow on her head.',
            'I have seen roses damasked red and white but no such roses see I in her cheeks.',
            'And in some perfumes is there more delight than in the breath that from my mistress reeks.',
            'I love to hear her speak yet well I know that music hath a far more pleasing sound.',
            'I grant I never saw a goddess go my mistress when she walks treads on the ground.',
            'And yet by heaven I think my love as rare as any she belied with false compare.'
        ].join(' '),

        tech: [
            'The system initializes the memory buffer and allocates the stack pointer to the base address.',
            'When the process receives a signal it checks the handler table for registered callbacks.',
            'The garbage collector traverses the object graph marking reachable nodes before sweeping unreachable memory.',
            'Each thread maintains its own stack frame while sharing the heap with other threads in the process.',
            'The scheduler assigns time slices to each process based on priority and resource availability.',
            'Cache coherence protocols ensure that all processors see a consistent view of shared memory.',
            'The virtual memory manager maps logical addresses to physical frames using a page table hierarchy.',
            'When a page fault occurs the operating system loads the required page from disk into memory.',
            'The compiler performs lexical analysis parsing and code generation to transform source code into machine instructions.',
            'An abstract syntax tree represents the hierarchical structure of the source code after parsing.',
            'The linker resolves external symbol references and combines object files into a single executable binary.',
            'Database transactions maintain atomicity by writing changes to a log before committing to disk.',
            'The query optimizer selects an execution plan that minimizes disk reads and memory usage.',
            'Network packets traverse multiple routers and switches before reaching their destination address.',
            'The transport layer provides reliable delivery by implementing acknowledgment and retransmission protocols.',
            'Encryption algorithms transform plaintext into ciphertext using a secret key and a mathematical function.',
            'Hash functions map arbitrary length input to fixed length output ensuring uniform distribution.',
            'Load balancers distribute incoming requests across multiple servers to optimize resource utilization and throughput.',
            'Microservices communicate through lightweight protocols exchanging data in structured formats over the network.',
            'Container orchestration platforms manage deployment scaling and networking of distributed applications.'
        ].join(' '),

        stories: [
            'Once upon a time there was a little fox who lived in a deep green forest.',
            'The fox loved to explore the winding paths between the tall old trees.',
            'Every morning the fox would wake up and stretch under the warm sunlight.',
            'One day the fox discovered a hidden path that led to a shimmering lake.',
            'At the lake the fox met a wise old owl perched on a branch.',
            'The owl told the fox about a treasure hidden beyond the mountains.',
            'The fox decided to embark on a great journey to find the treasure.',
            'Along the way the fox crossed rivers climbed hills and walked through meadows.',
            'In a dark cave the fox found a friendly bear who shared stories by the fire.',
            'The bear warned the fox about the tricky bridge that swayed in the wind.',
            'The fox thanked the bear and continued on the path toward the mountains.',
            'At the bridge the fox took a deep breath and walked carefully across.',
            'On the other side the fox found a beautiful valley filled with flowers.',
            'A rabbit hopped out from behind a rock and offered the fox some berries.',
            'The rabbit said that the treasure was not gold but something far more valuable.',
            'The fox climbed the last hill and saw the most magnificent sunrise over the valley.',
            'The fox realized that the treasure was the journey itself and the friends made along the way.',
            'With a happy heart the fox returned home to share the story with everyone in the forest.',
            'And every night the animals of the forest would gather to hear the tale of the brave little fox.',
            'The fox smiled and knew that the greatest adventures were still waiting just beyond the next hill.'
        ].join(' '),

        scifi: [
            'The starship Meridian drifted through the nebula its hull gleaming under alien starlight.',
            'Captain Voss studied the sensor readings as the ship approached the uncharted system.',
            'Three planets orbited the binary star each one showing signs of ancient technology.',
            'The android navigator calculated the trajectory and adjusted the quantum drive parameters.',
            'We detected an anomalous signal coming from the second planet said the communications officer.',
            'The landing party assembled in the cargo bay checking their atmospheric suits and scanning equipment.',
            'On the surface they found crystalline structures that pulsed with an inner blue light.',
            'The structures formed a pattern that matched no known language in the galactic database.',
            'Doctor Chen analyzed the energy signature and concluded it was billions of years old.',
            'Whatever civilization built this was far more advanced than anything we have encountered.',
            'The crystals began to resonate as the team moved deeper into the alien complex.',
            'Holographic displays flickered to life projecting star maps of galaxies beyond our observation range.',
            'The maps showed a network of gates connecting distant corners of the universe.',
            'One gate appeared to be located in our own solar system hidden beneath the surface of the moon.',
            'The android interfaced with the alien system and began downloading the navigation data.',
            'Suddenly the complex began to power up and the ground beneath them trembled.',
            'The team raced back to the shuttle as the crystalline towers rose higher into the sky.',
            'From orbit they watched as the planet transformed into a massive beacon of light.',
            'The signal was a message sent across the cosmos an invitation to join a galactic community.',
            'Captain Voss set a course for home knowing that humanity would never be the same.'
        ].join(' ')
    };

    // ============================================
    // Theme Colors
    // ============================================
    function getThemeColors() {
        const isDark = window.VizLib && VizLib.ThemeManager
            ? VizLib.ThemeManager.isDarkTheme()
            : document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';

        if (isDark) {
            return {
                bg: EAIColor('canvas', 'dark'),
                text: EAIColor('ink-soft', 'dark'),
                textMuted: EAIColor('muted', 'dark'),
                contextBg: EAIColor('blue', 'dark'),
                contextText: EAIColor('canvas', 'dark'),
                contextBorder: EAIColor('blue', 'dark'),
                candidateBg: EAIColor('sunken', 'dark'),
                candidateBorder: EAIColor('grid', 'dark'),
                candidateText: EAIColor('ink-soft', 'dark'),
                selectedBg: EAIColor('gold', 0.35, 'dark'),
                selectedBorder: EAIColor('gold', 'dark'),
                selectedText: EAIColor('ink-soft', 'dark'),
                connectionColor: EAIColor('axis', 'dark'),
                connectionActive: EAIColor('gold', 'dark'),
                probText: EAIColor('muted', 'dark'),
                probHighlight: EAIColor('gold', 'dark'),
                ghostText: EAIColor('grid', 'dark'),
                backoffBg: EAIColor('gold-strong', 0.2, 'dark'),
                backoffBorder: EAIColor('gold-strong', 'dark'),
                deadEndBg: EAIColor('red', 0.25, 'dark'),
                deadEndBorder: EAIColor('red', 'dark')
            };
        }
        return {
            bg: EAIColor('surface'),
            text: EAIColor('ink-soft'),
            textMuted: EAIColor('muted'),
            contextBg: EAIColor('blue'),
            contextText: EAIColor('surface'),
            contextBorder: EAIColor('blue'),
            candidateBg: EAIColor('surface'),
            candidateBorder: EAIColor('grid'),
            candidateText: EAIColor('ink-soft'),
            selectedBg: EAIColor('gold', 0.35),
            selectedBorder: EAIColor('gold'),
            selectedText: EAIColor('ink-soft'),
            connectionColor: EAIColor('axis'),
            connectionActive: EAIColor('gold'),
            probText: EAIColor('muted'),
            probHighlight: EAIColor('gold-strong'),
            ghostText: EAIColor('grid'),
            backoffBg: EAIColor('gold', 0.15),
            backoffBorder: EAIColor('gold'),
            deadEndBg: EAIColor('red-mid', 0.12),
            deadEndBorder: EAIColor('red-mid')
        };
    }

    // ============================================
    // Markov Babbler Engine
    // ============================================
    class MarkovBabblerEngine {
        constructor() {
            this.order = 2;
            this.model = new Map();
            this.starts = [];
            this.corpusWords = [];
            this.vocabulary = new Set();
        }

        tokenize(text) {
            return text.toLowerCase()
                .replace(/[^\w\s'-]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 0);
        }

        buildModel(text, order) {
            this.order = order;
            this.model.clear();
            this.starts = [];
            this.corpusWords = this.tokenize(text);
            this.vocabulary = new Set(this.corpusWords);

            for (let i = 0; i <= this.corpusWords.length - order - 1; i++) {
                const context = this.corpusWords.slice(i, i + order).join(' ');
                const nextWord = this.corpusWords[i + order];

                if (!this.model.has(context)) {
                    this.model.set(context, new Map());
                }
                const wordMap = this.model.get(context);
                wordMap.set(nextWord, (wordMap.get(nextWord) || 0) + 1);
            }

            // Collect starting contexts (beginning of corpus + after sentence-ending punctuation)
            const startSet = new Set();
            // First context is always a start
            if (this.corpusWords.length >= order) {
                startSet.add(this.corpusWords.slice(0, order).join(' '));
            }
            for (let i = 0; i < this.corpusWords.length - order; i++) {
                // Check if previous token ended a sentence (in original text)
                if (i > 0) {
                    const prevRaw = this.corpusWords[i - 1];
                    if (prevRaw.endsWith('.') || prevRaw.endsWith('!') || prevRaw.endsWith('?')) {
                        startSet.add(this.corpusWords.slice(i, i + order).join(' '));
                    }
                }
            }
            this.starts = [...startSet].filter(s => this.model.has(s));
            // Fallback: if no starts found, use all contexts
            if (this.starts.length === 0) {
                this.starts = [...this.model.keys()];
            }
        }

        getCandidates(context) {
            const wordMap = this.model.get(context);
            if (!wordMap) return [];
            const total = [...wordMap.values()].reduce((a, b) => a + b, 0);
            return [...wordMap.entries()]
                .map(([word, count]) => ({ word, count, probability: count / total }))
                .sort((a, b) => b.probability - a.probability);
        }

        sampleNext(context) {
            const candidates = this.getCandidates(context);
            if (candidates.length === 0) return null;
            const r = Math.random();
            let cumulative = 0;
            for (const c of candidates) {
                cumulative += c.probability;
                if (r < cumulative) return c.word;
            }
            return candidates[candidates.length - 1].word;
        }

        /**
         * Try to sample from context; if dead end, back off to shorter context.
         * Returns {word, usedContext, backedOff}
         */
        sampleWithBackoff(contextWords) {
            // Try full context first
            const fullCtx = contextWords.join(' ');
            const fullCandidates = this.getCandidates(fullCtx);
            if (fullCandidates.length > 0) {
                return { word: this.sampleNext(fullCtx), usedContext: fullCtx, backedOff: false };
            }

            // Back off: try progressively shorter contexts
            for (let len = contextWords.length - 1; len >= 1; len--) {
                const shorter = contextWords.slice(contextWords.length - len).join(' ');
                const candidates = this.getCandidates(shorter);
                if (candidates.length > 0) {
                    return { word: this.sampleNext(shorter), usedContext: shorter, backedOff: true };
                }
            }

            // Complete dead end: pick a random start
            const randomCtx = this.starts[Math.floor(Math.random() * this.starts.length)];
            if (randomCtx) {
                const word = this.sampleNext(randomCtx);
                if (word) return { word, usedContext: randomCtx, backedOff: true };
            }

            return null;
        }

        computeEntropy(context) {
            const candidates = this.getCandidates(context);
            if (candidates.length === 0) return 0;
            let H = 0;
            for (const c of candidates) {
                if (c.probability > 0) {
                    H -= c.probability * Math.log2(c.probability);
                }
            }
            return H;
        }

        getRandomStart() {
            if (this.starts.length > 0) {
                return this.starts[Math.floor(Math.random() * this.starts.length)];
            }
            const keys = [...this.model.keys()];
            return keys[Math.floor(Math.random() * keys.length)] || '';
        }

        getStartForSeed(seed) {
            const matching = [...this.model.keys()].filter(k => k.startsWith(seed));
            if (matching.length > 0) {
                return matching[Math.floor(Math.random() * matching.length)];
            }
            return this.getRandomStart();
        }

        getStartingWords() {
            const words = new Set();
            for (const key of this.model.keys()) {
                words.add(key.split(' ')[0]);
            }
            return [...words].sort();
        }
    }

    // ============================================
    // Context Graph Renderer (Canvas)
    // ============================================
    class ContextGraphRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.dpr = 1;
        }

        setupCanvas() {
            if (window.VizLib && VizLib.setupHiDPICanvas) {
                const setup = VizLib.setupHiDPICanvas(this.canvas);
                this.dpr = setup.dpr || 1;
            } else {
                const dpr = window.devicePixelRatio || 1;
                this.canvas.width = CANVAS_WIDTH * dpr;
                this.canvas.height = CANVAS_HEIGHT * dpr;
                this.canvas.style.width = CANVAS_WIDTH + 'px';
                this.canvas.style.height = CANVAS_HEIGHT + 'px';
                this.ctx.scale(dpr, dpr);
                this.dpr = dpr;
            }
        }

        render(contextStr, candidates, selectedWord) {
            const ctx = this.ctx;
            const colors = getThemeColors();

            // Reset transform and clear
            if (window.VizLib && VizLib.resetCanvasTransform) {
                VizLib.resetCanvasTransform(ctx, this.dpr);
                VizLib.clearCanvas(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, colors.bg);
            } else {
                ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
                ctx.fillStyle = colors.bg;
                ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            }

            if (!contextStr) {
                this.drawPlaceholder(colors);
                return;
            }

            const cx = CANVAS_WIDTH / 2;
            const cy = CANVAS_HEIGHT / 2;

            // Limit displayed candidates
            const displayCandidates = candidates.slice(0, MAX_DISPLAY_CANDIDATES);
            const remaining = candidates.length - displayCandidates.length;

            // Compute candidate positions
            const positions = this.computeLayout(cx, cy, displayCandidates);

            // Draw connections first (behind nodes)
            for (let i = 0; i < positions.length; i++) {
                const p = positions[i];
                const isSelected = selectedWord && p.word === selectedWord;
                this.drawConnection(ctx, cx, cy, p.x, p.y, p.probability, isSelected, colors);
            }

            // Draw candidate nodes
            for (let i = 0; i < positions.length; i++) {
                const p = positions[i];
                const isSelected = selectedWord && p.word === selectedWord;
                this.drawCandidateNode(ctx, p.x, p.y, p.word, p.probability, isSelected, colors);
            }

            // Draw "...and N more" if truncated
            if (remaining > 0) {
                this.drawGhostNode(ctx, cx, cy + 165, '...and ' + remaining + ' more', colors);
            }

            // Draw center context node (on top)
            this.drawCenterNode(ctx, cx, cy, contextStr, colors);
        }

        computeLayout(cx, cy, candidates) {
            const count = candidates.length;
            if (count === 0) return [];

            const baseRadius = 130;
            const positions = [];

            for (let i = 0; i < count; i++) {
                // Spread evenly around the circle, starting from top
                const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
                // Higher probability = slightly closer
                const radiusOffset = (1 - candidates[i].probability) * 20;
                const r = baseRadius + radiusOffset;

                positions.push({
                    x: cx + r * Math.cos(angle),
                    y: cy + r * Math.sin(angle),
                    word: candidates[i].word,
                    probability: candidates[i].probability,
                    count: candidates[i].count
                });
            }
            return positions;
        }

        drawCenterNode(ctx, x, y, text, colors) {
            ctx.save();

            ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const tm = ctx.measureText(text);
            const padX = 18;
            const padY = 14;
            const w = tm.width + padX * 2;
            const h = 28 + padY;

            // Shadow
            ctx.shadowColor = 'rgba(0,0,0,0.15)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;

            // Rounded rect
            this.roundRect(ctx, x - w / 2, y - h / 2, w, h, 8);
            ctx.fillStyle = colors.contextBg;
            ctx.fill();
            ctx.shadowColor = 'transparent';

            ctx.strokeStyle = colors.contextBorder;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Text
            ctx.fillStyle = colors.contextText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y);

            ctx.restore();
        }

        drawCandidateNode(ctx, x, y, word, probability, isSelected, colors) {
            ctx.save();

            const fontSize = Math.max(10, Math.min(15, 10 + probability * 25));
            ctx.font = (isSelected ? 'bold ' : '') + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const tm = ctx.measureText(word);
            const padX = 10;
            const padY = 8;
            const w = tm.width + padX * 2;
            const h = fontSize + padY * 2;

            if (isSelected) {
                // Selection glow
                ctx.shadowColor = colors.selectedBorder;
                ctx.shadowBlur = 12;
            }

            // Node background
            this.roundRect(ctx, x - w / 2, y - h / 2, w, h, 5);
            ctx.fillStyle = isSelected ? colors.selectedBg : colors.candidateBg;
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = isSelected ? colors.selectedBorder : colors.candidateBorder;
            ctx.lineWidth = isSelected ? 2.5 : 1;
            ctx.stroke();

            // Word text
            ctx.fillStyle = isSelected ? colors.selectedText : colors.candidateText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(word, x, y);

            ctx.restore();
        }

        drawConnection(ctx, fromX, fromY, toX, toY, probability, isSelected, colors) {
            ctx.save();

            const lineWidth = 1 + probability * 5;
            const alpha = 0.25 + probability * 0.6;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.strokeStyle = isSelected ? colors.connectionActive : colors.connectionColor;
            ctx.lineWidth = lineWidth;
            ctx.globalAlpha = isSelected ? 1 : alpha;
            ctx.stroke();

            // Arrowhead
            const angle = Math.atan2(toY - fromY, toX - fromX);
            const headLen = 8;
            const arrowX = toX - Math.cos(angle) * 20; // Pull back from node center
            const arrowY = toY - Math.sin(angle) * 20;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(arrowX - headLen * Math.cos(angle - 0.35), arrowY - headLen * Math.sin(angle - 0.35));
            ctx.lineTo(arrowX - headLen * Math.cos(angle + 0.35), arrowY - headLen * Math.sin(angle + 0.35));
            ctx.closePath();
            ctx.fillStyle = isSelected ? colors.connectionActive : colors.connectionColor;
            ctx.fill();
            ctx.globalAlpha = 1;

            // Probability label at midpoint
            const midX = (fromX + toX) / 2;
            const midY = (fromY + toY) / 2;
            // Offset label perpendicular to the line
            const perpX = -(toY - fromY);
            const perpY = (toX - fromX);
            const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
            const labelX = midX + (perpX / perpLen) * 10;
            const labelY = midY + (perpY / perpLen) * 10;

            const probStr = (probability * 100).toFixed(0) + '%';
            ctx.font = 'bold 10px Menlo, Monaco, Consolas, monospace';
            const probTm = ctx.measureText(probStr);

            // Background for readability
            ctx.fillStyle = colors.bg;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(labelX - probTm.width / 2 - 2, labelY - 6, probTm.width + 4, 12);
            ctx.globalAlpha = 1;

            ctx.fillStyle = isSelected ? colors.probHighlight : colors.probText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(probStr, labelX, labelY);

            ctx.restore();
        }

        drawGhostNode(ctx, x, y, text, colors) {
            ctx.save();
            ctx.font = 'italic 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = colors.ghostText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y);
            ctx.restore();
        }

        drawPlaceholder(colors) {
            const ctx = this.ctx;
            ctx.save();
            ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = colors.textMuted;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Click "Generate" or "Step" to begin', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
            ctx.restore();
        }

        roundRect(ctx, x, y, w, h, r) {
            if (window.VizLib && VizLib.roundRect) {
                VizLib.roundRect(ctx, x, y, w, h, r);
            } else {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                ctx.lineTo(x + w, y + h - r);
                ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.closePath();
            }
        }
    }

    // ============================================
    // Main Visualizer
    // ============================================
    class MarkovBabblerVisualizer {
        constructor() {
            this.canvas = document.getElementById('babbler-canvas');
            this.renderer = new ContextGraphRenderer(this.canvas);
            this.engine = new MarkovBabblerEngine();

            this.currentContext = null;  // string: "word1 word2"
            this.generatedWords = [];
            this.maxWords = 50;
            this.animSpeed = 5;
            this.isAnimating = false;
            this.animTimer = null;
            this.selectedWord = null;
            this.lastBackedOff = false;

            this.renderer.setupCanvas();
        }

        init() {
            this.bindControls();
            this.loadCorpus('nursery');
        }

        bindControls() {
            // Corpus select
            document.getElementById('corpus-select').addEventListener('change', (e) => {
                const val = e.target.value;
                const customSection = document.getElementById('custom-corpus-section');
                if (val === 'custom') {
                    customSection.style.display = '';
                } else {
                    customSection.style.display = 'none';
                    this.loadCorpus(val);
                }
            });

            // Build custom model button
            document.getElementById('btn-build-custom').addEventListener('click', () => {
                this.loadCorpus('custom');
            });

            // N-gram order stepper
            const orderValue = document.getElementById('ngram-order-value');
            document.getElementById('ngram-order-minus').addEventListener('click', () => {
                const v = Math.max(MIN_ORDER, parseInt(orderValue.value) - 1);
                orderValue.value = v;
                this.rebuildModel();
            });
            document.getElementById('ngram-order-plus').addEventListener('click', () => {
                const v = Math.min(MAX_ORDER, parseInt(orderValue.value) + 1);
                orderValue.value = v;
                this.rebuildModel();
            });

            // Max words stepper
            const maxValue = document.getElementById('max-words-value');
            document.getElementById('max-words-minus').addEventListener('click', () => {
                const v = Math.max(MIN_WORDS, parseInt(maxValue.value) - WORDS_STEP);
                maxValue.value = v;
                this.maxWords = v;
            });
            document.getElementById('max-words-plus').addEventListener('click', () => {
                const v = Math.min(MAX_WORDS, parseInt(maxValue.value) + WORDS_STEP);
                maxValue.value = v;
                this.maxWords = v;
            });

            // Buttons
            document.getElementById('btn-generate').addEventListener('click', () => this.generate());
            document.getElementById('btn-step').addEventListener('click', () => this.stepForward());
            document.getElementById('btn-reset').addEventListener('click', () => this.resetAll());

            // Speed slider
            document.getElementById('speed-slider').addEventListener('input', (e) => {
                this.animSpeed = parseInt(e.target.value);
                document.getElementById('speed-value').textContent = this.animSpeed;
            });

            // Theme change
            if (window.VizLib && VizLib.ThemeManager) {
                VizLib.ThemeManager.onThemeChange(() => this.renderCanvas());
            }
        }

        // ---- Corpus & Model ----

        loadCorpus(key) {
            this.stopAnimation();

            let text;
            if (key === 'custom') {
                text = document.getElementById('custom-corpus-input').value;
                if (!text || text.trim().split(/\s+/).length < 10) {
                    this.setStatus('Need more text (10+ words)');
                    return;
                }
            } else {
                text = CORPORA[key];
            }

            const order = parseInt(document.getElementById('ngram-order-value').value);
            this.engine.buildModel(text, order);
            this.populateSeedSelector();
            this.resetAll();
        }

        rebuildModel() {
            this.stopAnimation();
            const corpusKey = document.getElementById('corpus-select').value;
            this.loadCorpus(corpusKey);
        }

        populateSeedSelector() {
            const select = document.getElementById('seed-select');
            const words = this.engine.getStartingWords();
            select.innerHTML = '<option value="__random__">(Random)</option>';
            for (const w of words.slice(0, 50)) { // cap at 50 options
                const opt = document.createElement('option');
                opt.value = w;
                opt.textContent = w;
                select.appendChild(opt);
            }
        }

        // ---- Generation ----

        generate() {
            this.stopAnimation();
            this.generatedWords = [];
            this.selectedWord = null;
            this.lastBackedOff = false;

            // Pick starting context
            const seedVal = document.getElementById('seed-select').value;
            if (seedVal === '__random__') {
                this.currentContext = this.engine.getRandomStart();
            } else {
                this.currentContext = this.engine.getStartForSeed(seedVal);
            }

            if (!this.currentContext) {
                this.setStatus('No valid context found');
                return;
            }

            // Seed the output with the starting context words
            const contextWords = this.currentContext.split(' ');
            this.generatedWords = [...contextWords];
            this.updateTextDisplay();
            this.renderCanvas();
            this.updateMetrics();
            this.setStatus('Generating...');

            // Start animation
            this.isAnimating = true;
            this.scheduleNextStep();
        }

        stepForward() {
            if (this.generatedWords.length === 0) {
                // Initialize if not started
                const seedVal = document.getElementById('seed-select').value;
                if (seedVal === '__random__') {
                    this.currentContext = this.engine.getRandomStart();
                } else {
                    this.currentContext = this.engine.getStartForSeed(seedVal);
                }
                if (!this.currentContext) {
                    this.setStatus('No valid context found');
                    return;
                }
                this.generatedWords = this.currentContext.split(' ');
                this.updateTextDisplay();
                this.renderCanvas();
                this.updateMetrics();
                return;
            }

            if (this.generatedWords.length >= this.maxWords) {
                this.stopAnimation();
                this.setStatus('Max words reached');
                return;
            }

            const order = this.engine.order;
            const contextWords = this.generatedWords.slice(-order);
            const result = this.engine.sampleWithBackoff(contextWords);

            if (!result) {
                this.stopAnimation();
                this.setStatus('Dead end - no continuations');
                this.selectedWord = null;
                this.renderCanvas();
                return;
            }

            this.selectedWord = result.word;
            this.lastBackedOff = result.backedOff;
            this.generatedWords.push(result.word);

            // Update context to the last `order` words
            this.currentContext = this.generatedWords.slice(-order).join(' ');

            this.updateTextDisplay();
            this.renderCanvas();
            this.updateNgramTable();
            this.updateMetrics();
        }

        scheduleNextStep() {
            if (!this.isAnimating) return;
            const delay = 1200 - (this.animSpeed - 1) * 110;
            this.animTimer = setTimeout(() => {
                this.stepForward();
                if (this.isAnimating && this.generatedWords.length < this.maxWords) {
                    this.scheduleNextStep();
                } else {
                    this.isAnimating = false;
                    if (this.generatedWords.length >= this.maxWords) {
                        this.setStatus('Complete');
                    }
                }
            }, delay);
        }

        stopAnimation() {
            this.isAnimating = false;
            if (this.animTimer) {
                clearTimeout(this.animTimer);
                this.animTimer = null;
            }
        }

        // ---- Display Updates ----

        renderCanvas() {
            const candidates = this.currentContext
                ? this.engine.getCandidates(this.currentContext)
                : [];
            this.renderer.render(this.currentContext, candidates, this.selectedWord);

            // Update context badge
            const badge = document.getElementById('context-badge');
            if (this.currentContext) {
                badge.textContent = '"' + this.currentContext + '"';
            } else {
                badge.textContent = 'ready';
            }
        }

        updateTextDisplay() {
            const container = document.getElementById('generated-text-display');
            const order = this.engine.order;
            const totalWords = this.generatedWords.length;

            let html = '';
            for (let i = 0; i < totalWords; i++) {
                const word = this.generatedWords[i];
                const isLast = i === totalWords - 1 && totalWords > order;
                const isContext = i >= totalWords - order && totalWords > order;

                let classes = 'generated-word';
                if (isLast && this.selectedWord) classes += ' active';
                if (isLast && this.lastBackedOff) classes += ' backoff';
                if (isContext && !isLast) classes += ' context-word';

                html += '<span class="' + classes + '">' + word + '</span> ';
            }
            container.innerHTML = html;

            // Auto-scroll to bottom
            container.scrollTop = container.scrollHeight;

            // Update word count badge
            document.getElementById('word-count-badge').textContent =
                totalWords + ' word' + (totalWords !== 1 ? 's' : '');
        }

        updateNgramTable() {
            const container = document.getElementById('ngram-table-container');
            if (!this.currentContext) {
                container.innerHTML = '<p class="text-muted text-center" style="font-size: 12px;">Generate text to see candidate probabilities.</p>';
                return;
            }

            const candidates = this.engine.getCandidates(this.currentContext);
            if (candidates.length === 0) {
                container.innerHTML = '<p class="text-muted text-center" style="font-size: 12px;">No candidates for current context.</p>';
                return;
            }

            let html = '<table class="ngram-table"><thead><tr>';
            html += '<th>Word</th><th>Count</th><th>P(w|ctx)</th><th>Distribution</th>';
            html += '</tr></thead><tbody>';

            const maxProb = candidates[0].probability;
            const displayCount = Math.min(candidates.length, 15);

            for (let i = 0; i < displayCount; i++) {
                const c = candidates[i];
                const isSelected = this.selectedWord && c.word === this.selectedWord;
                const barWidth = (c.probability / maxProb * 100).toFixed(0);

                html += '<tr' + (isSelected ? ' class="selected-row"' : '') + '>';
                html += '<td class="word-cell">' + c.word + '</td>';
                html += '<td>' + c.count + '</td>';
                html += '<td class="prob-cell">' + (c.probability * 100).toFixed(1) + '%</td>';
                html += '<td class="prob-bar-cell"><div class="prob-bar-wrapper"><div class="prob-bar-fill" style="width:' + barWidth + '%"></div></div></td>';
                html += '</tr>';
            }

            if (candidates.length > displayCount) {
                html += '<tr><td colspan="4" class="text-muted" style="font-size:0.8em; text-align:center;">...and ' + (candidates.length - displayCount) + ' more</td></tr>';
            }

            html += '</tbody></table>';
            container.innerHTML = html;
        }

        updateMetrics() {
            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };

            setText('metric-corpus-size', this.engine.corpusWords.length + ' words');
            setText('metric-vocab', this.engine.vocabulary.size + ' unique');
            setText('metric-order', this.engine.order + ' (' +
                ['', 'bigram', 'trigram', '4-gram', '5-gram'][this.engine.order] + ')');

            if (this.currentContext) {
                setText('metric-context', '"' + this.currentContext + '"');
                const candidates = this.engine.getCandidates(this.currentContext);
                setText('metric-candidates', candidates.length);
                const entropy = this.engine.computeEntropy(this.currentContext);
                setText('metric-entropy', entropy.toFixed(2) + ' bits');
            } else {
                setText('metric-context', '-');
                setText('metric-candidates', '-');
                setText('metric-entropy', '-');
            }

            setText('metric-generated', this.generatedWords.length);
        }

        setStatus(text) {
            const el = document.getElementById('metric-status');
            if (el) el.textContent = text;
        }

        // ---- Reset ----

        resetAll() {
            this.stopAnimation();
            this.generatedWords = [];
            this.currentContext = null;
            this.selectedWord = null;
            this.lastBackedOff = false;

            document.getElementById('generated-text-display').innerHTML =
                '<p class="text-muted text-center" style="font-size: 12px;">Click "Generate" to create text from the Markov model.</p>';
            document.getElementById('word-count-badge').textContent = '0 words';
            document.getElementById('ngram-table-container').innerHTML =
                '<p class="text-muted text-center" style="font-size: 12px;">Generate text to see candidate probabilities.</p>';

            this.renderCanvas();
            this.updateMetrics();
            this.setStatus('Ready');
        }
    }

    // ============================================
    // Initialization
    // ============================================
    function init() {
        const viz = new MarkovBabblerVisualizer();
        viz.init();
    }

    window.addEventListener('vizlib-ready', init);
})();

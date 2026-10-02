/**
 * ThemeManager - Centralized color palette and theme management
 *
 * Provides consistent color schemes across all visualizations with
 * support for light and dark themes.
 *
 * @example
 * // Get categorical colors for classification
 * const colors = ThemeManager.getColors('categorical', 10);
 *
 * // Check current theme
 * if (ThemeManager.isDarkTheme()) {
 *     // Use dark mode colors
 * }
 *
 * // Convert hex to rgba
 * const transparent = ThemeManager.hexToRgba('#ff0000', 0.5);
 */
export class ThemeManager {
    /**
     * Color palettes organized by use case
     */
    static PALETTES = {
        /**
         * Categorical colors for classification visualizations (10 classes)
         * Used in: MNIST digits, CIFAR-10 classes, etc.
         */
        categorical: {
            light: [
                '#cc0000',  // 0 - red (book)
                '#1155cc',  // 1 - blue (book)
                '#38761d',  // 2 - green (book)
                '#674ea7',  // 3 - purple (book)
                '#ff7f00',  // 4 - orange
                '#dcb439',  // 5 - gold (book)
                '#a65628',  // 6 - brown
                '#f781bf',  // 7 - pink
                '#999999',  // 8 - gray
                '#17becf',  // 9 - cyan
                '#2ca02c',  // 10 - green (alt)
                '#1f77b4'   // 11 - blue (alt)
            ],
            dark: [
                '#fb4934',  // 0 - red
                '#83a598',  // 1 - blue
                '#b8bb26',  // 2 - green
                '#d3869b',  // 3 - purple
                '#fe8019',  // 4 - orange
                '#fabd2f',  // 5 - yellow
                '#d65d0e',  // 6 - brown/orange
                '#d65d0e',  // 7 - orange (alt)
                '#928374',  // 8 - gray
                '#8ec07c',  // 9 - cyan/green
                '#689d6a',  // 10 - green (alt)
                '#458588'   // 11 - blue (alt)
            ]
        },

        /**
         * Search algorithm state colors
         * Used in: A* pathfinding, BFS/DFS visualizations
         */
        search: {
            start: '#4CAF50',      // Green - starting point
            goal: '#F44336',       // Red - goal/target
            open: '#2196F3',       // Blue - nodes to explore
            closed: '#9E9E9E',     // Gray - explored nodes
            path: '#FF9800',       // Orange - solution path
            current: '#E91E63',    // Pink - currently examining
            wall: '#424242',       // Dark gray - obstacles
            examining: '#FFC107'   // Amber - being evaluated
        },

        /**
         * Game tree visualization colors
         * Used in: Minimax, Alpha-Beta pruning
         */
        gameTree: {
            maxNode: '#1976d2',       // Blue - MAX player
            minNode: '#d32f2f',       // Red - MIN player
            optimalNode: '#388e3c',   // Green - optimal move
            beyondDepth: '#cccccc',   // Light gray - beyond search depth
            selectedNode: '#ff9800',  // Orange - user selected
            edge: '#999999',          // Gray - normal edges
            optimalEdge: '#388e3c',   // Green - optimal path
            beyondEdge: '#cccccc',    // Light gray - edges beyond depth
            pruned: '#e0e0e0'         // Very light gray - pruned branches
        },

        /**
         * Constraint satisfaction problem colors
         * Used in: Shidoku/Sudoku, CSP visualizations
         */
        csp: {
            fixed: '#1976d2',         // Blue - given clues
            assigned: '#4CAF50',      // Green - assigned by algorithm
            conflict: '#F44336',      // Red - constraint violation
            examining: '#FF9800',     // Orange - currently examining
            pruned: '#9E9E9E',        // Gray - pruned from domain
            domain: '#E3F2FD'         // Light blue - domain background
        }
    };

    /**
     * Label sets for different datasets
     */
    static LABELS = {
        mnist: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        cifar10: ['airplane', 'automobile', 'bird', 'cat', 'deer',
                  'dog', 'frog', 'horse', 'ship', 'truck']
    };

    // Private cache for color conversions
    static _colorCache = new Map();

    /**
     * Check if dark theme is currently active
     * @returns {boolean} True if dark theme is active
     */
    static isDarkTheme() {
        const theme = document.documentElement.getAttribute('data-theme');
        return theme && theme.includes('dark');
    }

    /**
     * Get colors for a palette
     * @param {string} paletteName - Name of the palette ('categorical', 'search', 'gameTree', 'csp')
     * @param {number} [count] - Number of colors to return (for categorical only)
     * @returns {Array|Object} Array of colors (categorical) or object of named colors
     */
    static getColors(paletteName, count = null) {
        const palette = this.PALETTES[paletteName];
        if (!palette) {
            console.warn(`ThemeManager: Unknown palette "${paletteName}"`);
            return [];
        }

        // For categorical palette, return array based on theme
        if (paletteName === 'categorical') {
            const colors = this.isDarkTheme() ? palette.dark : palette.light;
            return count ? colors.slice(0, count) : colors;
        }

        // For other palettes, return the object as-is
        return palette;
    }

    /**
     * Get a single color by index from categorical palette
     * @param {number} index - Color index
     * @returns {string} Hex color string
     */
    static getCategoricalColor(index) {
        const colors = this.getColors('categorical');
        return colors[index % colors.length];
    }

    /**
     * Get labels for a dataset
     * @param {string} dataset - Dataset name ('mnist' or 'cifar10')
     * @returns {Array<string>} Array of label strings
     */
    static getLabels(dataset) {
        return this.LABELS[dataset] || [];
    }

    /**
     * Convert hex color to rgba string with optional caching
     * @param {string} hex - Hex color string (e.g., '#ff0000')
     * @param {number} alpha - Alpha value (0-1)
     * @returns {string} RGBA color string
     */
    static hexToRgba(hex, alpha) {
        const key = `${hex}_${alpha}`;
        if (this._colorCache.has(key)) {
            return this._colorCache.get(key);
        }

        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const result = `rgba(${r}, ${g}, ${b}, ${alpha})`;

        this._colorCache.set(key, result);
        return result;
    }

    /**
     * Lighten a hex color
     * @param {string} hex - Hex color string
     * @param {number} amount - Amount to lighten (0-1)
     * @returns {string} Lightened hex color
     */
    static lighten(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        const newR = Math.min(255, Math.round(r + (255 - r) * amount));
        const newG = Math.min(255, Math.round(g + (255 - g) * amount));
        const newB = Math.min(255, Math.round(b + (255 - b) * amount));

        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    }

    /**
     * Darken a hex color
     * @param {string} hex - Hex color string
     * @param {number} amount - Amount to darken (0-1)
     * @returns {string} Darkened hex color
     */
    static darken(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        const newR = Math.max(0, Math.round(r * (1 - amount)));
        const newG = Math.max(0, Math.round(g * (1 - amount)));
        const newB = Math.max(0, Math.round(b * (1 - amount)));

        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    }

    /**
     * Set up a listener for theme changes
     * @param {Function} callback - Function to call when theme changes
     * @returns {MutationObserver} Observer instance (call disconnect() to stop)
     */
    static onThemeChange(callback) {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'data-theme') {
                    callback(this.isDarkTheme());
                }
            }
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });

        return observer;
    }
}

// Expose as global for backward compatibility
if (typeof window !== 'undefined') {
    window.VizLib = window.VizLib || {};
    window.VizLib.ThemeManager = ThemeManager;
}

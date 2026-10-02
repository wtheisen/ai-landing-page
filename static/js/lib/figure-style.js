/**
 * FigureStyle - the AI2AI textbook's figure look for canvas drawing
 *
 * Reads the --book-* tokens (static/css/visualizations.css) for the current theme, so a canvas
 * and a figure in the book share colours and type. Call it at the top of each render: it follows
 * the theme toggle.
 *
 * @example
 * const fs = VizLib.FigureStyle.get();
 * ctx.fillStyle = fs.blue; ctx.font = fs.font(11, true);
 * VizLib.FigureStyle.arrow(ctx, x1, y1, x2, y2, fs.purple, 2.5);
 */
const NAMES = ['navy', 'gold', 'gold-text', 'blue', 'purple', 'purple-light', 'green', 'red', 'ink', 'muted', 'axis', 'grid'];
const camel = n => n.replace(/-(\w)/g, (_, c) => c.toUpperCase());

export const FigureStyle = {
    get() {
        const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
        const out = { bg: v('--viz-canvas-bg') };
        for (const n of NAMES) out[camel(n)] = v('--book-' + n);
        const sans = v('--book-font') || 'Arial, sans-serif', mono = v('--book-mono') || 'monospace';
        out.font = (px, bold) => (bold ? 'bold ' : '') + px + 'px ' + sans;
        out.mono = (px, bold) => (bold ? 'bold ' : '') + px + 'px ' + mono;
        return out;
    },
    /** A straight arrow with a filled head, as in the book's figures. */
    arrow(ctx, x1, y1, x2, y2, color, width = 2, head = 9) {
        const a = Math.atan2(y2 - y1, x2 - x1), back = head * 0.8;
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - back * Math.cos(a), y2 - back * Math.sin(a)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(a - 0.38), y2 - head * Math.sin(a - 0.38));
        ctx.lineTo(x2 - head * Math.cos(a + 0.38), y2 - head * Math.sin(a + 0.38));
        ctx.closePath(); ctx.fill();
        ctx.restore();
    },
    /** A data point: filled disc with a thin background-coloured rim so overlapping points separate. */
    point(ctx, x, y, r, color, rim) {
        ctx.save();
        ctx.fillStyle = color; ctx.strokeStyle = rim; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); if (rim) ctx.stroke();
        ctx.restore();
    }
};

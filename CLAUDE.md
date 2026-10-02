# CLAUDE.md — Exploring Artificial Intelligence

## 1. Project Overview

**Project:** "Exploring Artificial Intelligence" — interactive AI/ML learning platform
**Author:** William Theisen, University of Notre Dame
**URL:** https://ai.williamtheisen.com
**Repo:** Eleventy static site with 30+ algorithm visualizations, course materials, and curated resources.

**Before any visualization work, read these files:**
- `static/md/claude_visualization_design_principles.md` — pedagogical design philosophy
- `src/visualizations/naive-bayes.njk` — **canonical layout example** (gold standard)
- `static/css/naive-bayes.css` — **canonical CSS example** (dual theme, compact sizing)

**Build & Run:**
```bash
npm run build    # Build to docs/
npm run serve    # Dev server with hot reload
```

---

## 2. Tech Stack

**Static Site Generator:** Eleventy 3.0.0
- Input: `src/` | Output: `docs/` | Includes: `src/_includes/` | Data: `src/_data/`
- Templates: Nunjucks (`.njk`), Markdown (`.md`)
- Config: `.eleventy.js`

**CSS Framework:** Bootstrap 3.3.7 (CDN)
- Use: `panel`, `panel-default`, `panel-heading`, `panel-body`, `btn-group`, `btn-group-sm`, `col-md-*`, `form-control`, `input-sm`, `table`, `table-condensed`, `table-striped`, `badge`
- **NEVER** use Bootstrap 4/5 classes: `card`, `d-flex`, `d-grid`, `btn-outline-*`, `form-check`, `gap-*`, `rounded-*`, etc.

**JavaScript:**
- jQuery 1.11.3 (CDN), Font Awesome 6.x (CDN kit)
- Visualization JS: IIFE pattern in `static/js/{name}.js`
- Shared library: ES6 modules in `static/js/lib/` exposed via `window.VizLib`

**Themes:** Dual-theme via `data-theme` attribute on `<html>`
- `bluegold` (default light) — `static/css/bluegold.css`
- `gruvbox-dark` — `static/css/gruvbox-dark.css`
- Design tokens in `static/css/visualizations.css`

---

## 3. Layout & Design Rules — HIGHEST PRIORITY

### Two-Column Layout. That's It.

```
+------------------------------+---------------------+
|  LEFT: col-md-7              |  RIGHT: col-md-5    |
|                              |                     |
|  Visualization panels        |  infoTabs() macro   |
|  (canvas, tables, inputs)    |  -- single call --  |
|  Can stack multiple panels   |  ALL content in     |
|                              |  tabs               |
+------------------------------+---------------------+
```

### Layout Rules

- Left column = `col-md-7`. Right column = `col-md-5`. No exceptions.
- Right column = ONE `infoTabs()` call. No separate panels outside it.
- Controls, sliders, selects go in a **"Controls"** tab.
- Algorithm explanations go in an **"Algorithm"** tab.
- Live calculations / math breakdowns go in a **"Math"** tab.
- Execution logs go in a **"Log"** tab.
- What it is + why + how-to-use go in an **"About"** tab (first tab, active by default).
- **Minimum 3 tabs.** "About" is mandatory. Choose 2+ from: Algorithm, Math, Controls, Log, Compare.
- Mode toggles / status badges go in the `panel-heading` of the left viz panel (see naive-bayes.njk lines 38-48).
- Left panels use `panel panel-default` > `panel-heading` + `panel-body`.

### Canvas Rules

- Canvas **MUST** fill its panel. No small centered box with surrounding padding.
- Always: `display: block; width: 100%;` on canvas elements.
- Color-coded states: explored, frontier, optimal, pruned, selected, etc.
- Rich data overlays: show values, probabilities, costs directly on canvas elements.
- Hover tooltips/highlights on interactive canvas elements.
- Clickable canvas for direct interaction where appropriate.

### Sizing & Styling

- **Dense/compact:** small font sizes for data/table cells, slightly larger for labels, monospace for all numbers.
- Controls: compact inline rows — label + input on same line, flexbox with small gaps.
- No gratuitous gradients, drop shadows, or over-rounded corners. Flat and functional.
- No wasted whitespace. Professional tool/dashboard feel.
- Use `compact-panel` class for tighter panel-body padding.

### Responsive & Flexible Sizing — CRITICAL

**NEVER hardcode pixel values for widths, heights, positions, or layout dimensions.** This is the #1 source of fragile, broken layouts. Designs MUST scale gracefully across all viewport sizes.

**Rules:**
- **Widths:** Use `%`, `vw`, `fr`, `flex`, `min-width`/`max-width` with relative units. A block should be `width: 90%` or `flex: 1`, NOT `width: 220px`.
- **Heights:** Use `min-height`, `max-height`, `auto`, `fit-content`, or `vh`. NOT `height: 600px`. Let content determine height wherever possible.
- **Spacing/padding/gaps:** Use `em`, `rem`, `%`, or CSS `clamp()`. Small fixed values (2-4px) for cosmetic gaps like heatmap cell spacing are acceptable — structural layout spacing is not.
- **Font sizes:** Use `rem`, `em`, or `clamp()`. Example: `font-size: clamp(0.65rem, 1.2vw, 0.85rem)` instead of `font-size: 11px`.
- **Element sizing (heatmap cells, bar charts, blocks):** Use relative units or `clamp()`. Example: `width: clamp(6px, 1.5vw, 12px)` for heatmap cells.
- **Positioning:** Prefer flexbox/grid flow over absolute positioning. When absolute positioning is necessary, use `%` or `calc()` for offsets, not fixed `px`.
- **Canvas/diagram containers:** Use `width: 100%; aspect-ratio: 4/3;` or similar — never a fixed pixel height.
- **Media queries:** Still fine for breakpoints, but the design should already be flexible BEFORE media queries kick in. Media queries are for refinement, not for making a rigid layout work.

**Acceptable fixed px uses:**
- Borders (`1px solid`, `2px solid`)
- Border-radius (`4px`, `6px`)
- Very small cosmetic gaps in grids (`gap: 1px` between heatmap cells)
- `min-width`/`max-width` as guardrails (e.g., `max-width: 400px` to prevent absurd stretching)

**Test:** If you resize the browser from 320px to 2560px wide, nothing should overflow, collapse, or look broken at any point.

### Interactivity Defaults

- **Default = direct manipulation:** click canvas, adjust params, see results immediately.
- Only add `PlaybackController` when the algorithm genuinely has discrete steps (A*, BFS, CSP solving).
- Most visualizations do **NOT** need play/pause/step. They need: clickable canvas + live params + hover.
- Don't over-focus on animations. Instant updates are usually better.

### Deep Learning Visualizations — "Architecture Diagram First"

For CNN, Transformer, RNN, Backprop, and any DL visualization:
- Main canvas shows the **FULL model architecture** as a block diagram.
- Blocks = layers/components (Conv2D, Attention, Linear, ReLU, etc.).
- Blocks are **clickable/interactive** — clicking expands the block in-place on canvas to show internals (matrix ops, activations, weights). Other blocks shrink/fade.
- Surface-level detail visible BEFORE clicking:
  - Tensor shapes/dimensions at each connection
  - Layer names + types
  - Mini inline visualizations inside blocks (feature map thumbnails, activation bars, mini heatmaps)
  - Data flow arrows with summary values
- The architecture diagram **IS** the visualization — not a sidebar or navigation tool.
- Reference: `src/visualizations/rnn.njk` has the right idea (pipeline diagram on canvas).

### Overrides vs. Design Principles Doc

The `claude_visualization_design_principles.md` file is a useful reference, but these CLAUDE.md rules take precedence:
- Playback is the exception, not the rule.
- Don't force 4-class code structure. Clean IIFE, separate concerns naturally.
- Don't curate sample inputs by difficulty. Core viz first.
- Compare tab only when algorithm has obvious variants. Don't force it.
- Tradeoff controls when natural. Don't invent artificial ones.

---

## 3b. Frontend Design Skill — AUTO-USE

**IMPORTANT:** When building or significantly redesigning any visualization's frontend (new `.njk` template, new CSS, or major visual overhaul), **always invoke the `frontend-design` skill** before writing code. This applies to:

- Creating a new visualization from scratch
- Rebuilding a visualization's rendering approach (e.g., canvas → DOM)
- Redesigning layout, color schemes, or visual structure of an existing visualization
- Any task where the user asks to "build", "design", "create", or "redesign" a UI/page/component

**How to use it:** Call the `frontend-design` skill with context about the visualization's purpose, the project's constraints (Bootstrap 3, dual theme, compact sizing), and what the output should look like. The skill produces high-quality, distinctive frontend code. Adapt its output to this project's conventions (Nunjucks templates, CSS custom properties, vanilla JS IIFE).

**When NOT to use it:** Small tweaks, bug fixes, adding a single control, changing a color token, or non-visual JS logic changes.

---

## 4. Figma Workflow — CORE WORKFLOW SECTION

**The loop is: Code -> Figma -> Code**

### 4a: First-Time Setup

Run once to configure the Figma integration:

1. Use the `figma:create-design-system-rules` skill to generate project-specific rules. **DONE** — see Section 10.
   - Feed it: two-panel layout, Bootstrap 3 patterns, CSS custom properties, compact sizing.
2. Code Connect mappings (linking Figma components to Nunjucks macros) require a Figma Organization/Enterprise plan.
   - **Current plan:** Professional/Free — Code Connect is NOT available.
   - **Workaround:** The component mapping table in Section 6 serves as the manual equivalent.
   - If the plan is upgraded later, use the `figma:code-connect-components` skill to set up automated mappings.

### 4b: The Primary Workflow Loop

**Step 1 — Claude builds a first pass in code:**
- Implement the visualization following ALL design rules from Section 3.
- Correct two-panel layout, proper tabs, compact sizing, full interactivity.
- This should be high-quality code, not a rough prototype.
- Run `npm run serve` to verify it works.

**Step 2 — Capture to Figma with interaction documentation:**
- Use `generate_figma_design` to capture the running implementation.
- **Layer naming limitation:** The Figma capture script (`capture.js`) names layers using `tagName.toUpperCase()` ONLY — it does NOT read `id`, `class`, `aria-label`, or any `data-*` attributes. All `<div>` elements become "DIV", all `<span>` become "SPAN", etc. To get better names:
  - Use semantic HTML tags where possible (`<section>`, `<article>`, `<figure>`, `<nav>`, `<header>`, `<output>`, `<code>`) instead of generic `<div>`/`<span>`.
  - After capture, use Figma's **"Rename layers with AI"** feature (right-click layer > Rename, or Plugins > Rename layers with AI) to auto-name layers based on their visual content.
  - `aria-label` and `id` attributes are still valuable for accessibility and JS wiring — just don't expect them to appear as Figma layer names.
- Capture BOTH themes (bluegold + gruvbox-dark).
- Capture MULTIPLE STATES of interactive elements:
  - Default state (nothing selected)
  - Hover states (element highlighted)
  - Clicked/expanded states (e.g., architecture block expanded)
  - Different tab states (each tab active)
- Use FigJam (`generate_diagram`) to create a flow diagram showing interaction pathways:
  - Which elements are clickable, what happens when clicked
  - Data flow: "user clicks Conv2D block -> block expands -> shows feature map detail"
  - State transitions between views
- **Act as a Figma guide:** The user is learning Figma. Explain Figma concepts in plain language when relevant:
  - Frames, components, variants, auto-layout, prototyping connections
  - How to use the captured states to iterate on layout
  - How to move/resize elements in Figma to adjust the design
  - Suggest what to look at and modify in the Figma file

**Step 3 — User iterates in Figma:**
- User adjusts layout, proportions, interaction flows in Figma.
- Claude helps explain Figma tools/concepts as needed.
- User provides updated Figma URL when ready.

**Step 4 — Claude polishes code from Figma feedback:**
1. `get_design_context` with updated Figma URL to see what changed.
2. `get_screenshot` for visual verification.
3. Analyze differences: what did the user change vs. the first pass?
4. **Suggest any concerns BEFORE implementing:** "You moved controls outside tabs — should I keep them in a Controls tab per project patterns, or follow your Figma layout?"
5. Implement the changes, mapping Figma colors to CSS custom properties.
6. Note all adjustments: "Figma changed panel split to ~60/40 -> updated to col-md-8/col-md-4"

**Step 5 — Capture again and repeat if needed.**

### 4c: Building the Component Library

As components are implemented and captured to Figma:
1. Figma components accumulate naturally via `generate_figma_design` captures.
2. The mapping table in Section 6 tracks which Nunjucks macro corresponds to which Figma element.
3. **If upgraded to Org/Enterprise plan:** use `get_code_connect_suggestions` + `send_code_connect_mappings` to automate the link between Figma components and code files.

Priority mappings:
```
Figma Component          -> Code Component
-----------------------------------------------------------
Info Tabs Panel          -> components/info-tabs.njk (infoTabs macro)
Controls Bar             -> components/controls-bar.njk (controlsBar macro)
Playback Controls        -> components/playback-controls.njk (playbackControls macro)
Algorithm Options        -> components/algorithm-options.njk (algorithmOptions macro)
Metrics Panel            -> components/metrics-panel.njk (metricsPanel macro)
Legend                   -> components/legend.njk (legend macro)
Dataset Selector         -> components/dataset-selector.njk (datasetSelector macro)
Edit Toolbar             -> components/edit-toolbar.njk (editToolbar macro)
Stepper Control          -> components/stepper-control.njk (stepperControl macro)
Speed Control            -> components/speed-control.njk (speedControl macro)
Share Button             -> components/share-button.njk (include, not a macro)
```

### 4d: Figma-First (Alternate Path)

Sometimes you may start in Figma instead of code:
1. `get_design_context` + `get_screenshot` + `get_variable_defs` to read the design.
2. Analyze and **suggest improvements vs. project patterns BEFORE implementing**.
3. Wait for approval, then implement.
4. Capture back to Figma for further iteration.

---

## 5. Design Token Reference

### Light Theme (`:root`)
```css
--viz-bg: #ffffff;           --viz-border: #dee2e6;
--viz-text: #333333;         --viz-text-muted: #6c757d;
--viz-hover-bg: #f8f9fa;     --viz-canvas-bg: #fafafa;
--viz-active-bg: #d4edda;    --viz-active-border: #28a745;
--viz-success-bg: #d4edda;   --viz-success-border: #28a745;
--viz-warning-bg: #fff3cd;   --viz-warning-border: #ffc107;
--viz-danger-bg: #f8d7da;    --viz-danger-border: #dc3545;
--viz-info-bg: #cce5ff;      --viz-info-border: #007bff;
--viz-mono-font: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace;
```

### Dark Theme (`[data-theme="gruvbox-dark"]`)
```css
--gruvbox-bg: #282828;       --gruvbox-bg1: #3c3836;
--gruvbox-bg2: #504945;      --gruvbox-bg-dim: #32302f;
--gruvbox-bg-darkest: #1d2021; --gruvbox-fg: #ebdbb2;
--gruvbox-fg-dim: #d5c4a1;   --gruvbox-gray: #a89984;
--gruvbox-red: #fb4934;      --gruvbox-green: #b8bb26;
--gruvbox-yellow: #fabd2f;   --gruvbox-blue: #83a598;
--gruvbox-purple: #d3869b;   --gruvbox-aqua: #8ec07c;
--gruvbox-orange: #fe8019;
/* Semantic tokens remap to palette (--viz-bg: var(--gruvbox-bg), etc.) */
```

### Categorical Class Colors
```css
/* :root */
--viz-class-0: #e41a1c;  --viz-class-1: #377eb8;  --viz-class-2: #4daf4a;
--viz-class-3: #984ea3;  --viz-class-4: #ff7f00;  --viz-class-5: #c4a000;
--viz-class-6: #a65628;  --viz-class-7: #f781bf;  --viz-class-8: #999999;
--viz-class-9: #17becf;

/* [data-theme="gruvbox-dark"] */
--viz-class-0: #fb4934;  --viz-class-1: #83a598;  --viz-class-2: #b8bb26;
--viz-class-3: #d3869b;  --viz-class-4: #fe8019;  --viz-class-5: #fabd2f;
--viz-class-6: #d65d0e;  --viz-class-7: #d3869b;  --viz-class-8: #928374;
--viz-class-9: #8ec07c;
```

### Shared Palette (use this, not new hex values)
All visualizers take their colours from one palette, the AI2AI textbook's figure style, defined in
`static/css/visualizations.css` with dark-theme counterparts. Five families plus neutrals:

| Family | strong | mid | fill |
|---|---|---|---|
| blue | `--book-blue` | `--book-blue-mid` | `--book-blue-fill` |
| purple | `--book-purple` | `--book-purple-mid` | `--book-purple-fill` |
| green | `--book-green` | `--book-green-mid` | `--book-green-fill` |
| red | `--book-red` | `--book-red-mid` | `--book-red-fill` |
| gold | `--book-gold` (`--book-gold-text`, `--book-gold-strong`) | `--book-gold-mid` | `--book-gold-fill` |

Neutrals: `--book-navy`, `--book-ink`, `--book-ink-soft`, `--book-muted`, `--book-axis`, `--book-grid`,
`--book-sunken`, `--book-surface`, `--book-canvas`. Categorical classes: `--viz-class-0` … `--viz-class-9`.

- **CSS:** `color: var(--book-blue)`; translucent: `rgba(var(--book-blue-rgb), 0.15)` (not `color-mix`: scripts parse these values).
- **Canvas / JS:** `EAIColor('blue')` (current theme), `EAIColor('blue', 0.3)` (rgba), `EAIColor('class-2')`,
  and `EAIColor('blue', 'dark')` / `'light'` to fix the theme. `VizLib.FigureStyle.get()` gives the same colours
  plus `font(px, bold)` and arrow / point helpers.
- A per-visualization token is an alias of a shared one: `--nb-spam-color: var(--book-red);`. With shared
  tokens a separate dark-theme value is rarely needed.

**Rules:** Never hardcode colours (hex or rgb) in CSS or JS. If a visualizer needs a colour the palette lacks,
add it to the shared palette in both themes.

---

## 6. Component Reference

All macros live in `src/_includes/components/`. Import with `{% from "components/{file}" import {macro} %}`.

### 1. infoTabs
```
{% from "components/info-tabs.njk" import infoTabs %}
{{ infoTabs(tabs, variant='btn-group', panelClass='') }}
```
- `tabs`: Array of `{id, icon, label, active?, content}` objects
- `variant`: `'btn-group'` (default) or `'nav-tabs'`
- The RIGHT column's sole occupant. One call only.

### 2. controlsBar
```
{% from "components/controls-bar.njk" import controlsBar %}
{{ controlsBar(groups, resetButton=none, className='') }}
```
- `groups`: Array of control group objects (button-groups, selects, checkboxes, steppers, custom HTML)
- `resetButton`: Optional `{id, label}` for a reset button

### 3. playbackControls
```
{% from "components/playback-controls.njk" import playbackControls %}
{{ playbackControls(buttons, speedSlider=true, speedId='speed-slider', speedMin=1, speedMax=10, speedValue=5, statusId=none, statusText='') }}
```
- `buttons`: Array of `{id, icon, label, class?}` for play/pause/step/reset
- Only use when algorithm has genuine discrete steps.

### 4. algorithmOptions
```
{% from "components/algorithm-options.njk" import algorithmOptions %}
{{ algorithmOptions(title='Algorithm Options', icon='fa-cogs', options=[]) }}
```
- `options`: Array of input configs (sliders, numbers, checkboxes, selects, button-groups)

### 5. metricsPanel
```
{% from "components/metrics-panel.njk" import metricsPanel %}
{{ metricsPanel(title='Classification Result', icon='fa-bar-chart', metrics=[], layout='single', rows=[], extraContent='', noHeader=false) }}
```
- `metrics`: Array of `{icon, label, valueId, defaultValue}` objects
- `layout`: `'single'` or `'grid'` (2x2)

### 6. legend
```
{% from "components/legend.njk" import legend %}
{{ legend(items, className='canvas-legend') }}
```
- `items`: Array of `{type, color?, class?, label}` — types: `'color'`, `'line'`, `'dot'`, `'icon'`

### 7. datasetSelector
```
{% from "components/dataset-selector.njk" import datasetSelector %}
{{ datasetSelector(datasets, infoId='dataset-description', defaultInfo='') }}
```
- `datasets`: Array of `{id, label, description?, active?}` objects

### 8. editToolbar
```
{% from "components/edit-toolbar.njk" import editToolbar %}
{{ editToolbar(modes, classes, clearId='btn-clear-points') }}
```
- `modes`: Array of `{id, icon, label, active?}` for mode buttons (classify/add/delete)
- `classes`: Array of `{id, color}` for class selector dots

### 9. stepperControl
```
{% from "components/stepper-control.njk" import stepperControl %}
{{ stepperControl(id, value, title='') }}
```
- Renders minus/plus buttons with a readonly numeric display.

### 10. speedControl
```
{% from "components/speed-control.njk" import speedControl %}
{{ speedControl(id='speed-slider', min='1', max='10', value='5', showValue=false, icon='fa-tachometer') }}
```
- Tachometer icon with range slider for animation speed.

### 11. share-button (include, not macro)
```
{% include "components/share-button.njk" %}
```
- Renders a URL-copy share button. Place inside `#main-content`.

---

## 7. File Conventions

### New Visualization Checklist
Create these files:
1. `src/visualizations/{name}.njk` — Nunjucks template
2. `static/css/{name}.css` — Visualization-specific styles (dual theme)
3. `static/js/{name}.js` — IIFE visualization logic
4. `static/img/vis_cards/{name}.png` — Card thumbnail (optional but recommended)

### Frontmatter Fields
```yaml
---
layout: base.njk
title: "Algorithm Name Visualizer"
icon: fa-icon-name
navigation:
  - name: "Home"
    link: "index.html"
    icon: "fa-home"
permalink: "{name}.html"
extraScript: "static/js/{name}.js"
tags: visualization
cardTitle: "Algorithm Name"
cardIcon: fa-icon-name
cardDescription: "One-sentence description for the card."
cardTags:
  - Tag1
  - Tag2
cardHaystack: "searchable keywords"
cardOrder: 30
cardImage: static/img/vis_cards/{name}.png
---
```

### Template Structure
```njk
{% from "components/info-tabs.njk" import infoTabs %}
{# import other components as needed #}

<link rel="stylesheet" href="static/css/{name}.css">

<div class="row" id="main-content">
    {% include "components/share-button.njk" %}
    <!-- Left Column -->
    <div class="col-md-7">
        <div class="panel panel-default">
            <div class="panel-heading">
                <div class="panel-heading-content">
                    <!-- title, mode toggles, status badges -->
                </div>
            </div>
            <div class="panel-body">
                <canvas id="{name}-canvas"></canvas>
            </div>
        </div>
    </div>
    <!-- Right Column -->
    <div class="col-md-5">
        {{ infoTabs(tabs=[...]) }}
    </div>
</div>
```

### JavaScript IIFE Pattern
```javascript
(function() {
    'use strict';

    function init() {
        // Setup canvas, event listeners, initial render
    }

    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();
```

---

## 8. VizLib Module Reference

Accessed via `window.VizLib` (loaded automatically for pages with `extraScript` frontmatter).

| Module | Access | Key Exports |
|--------|--------|-------------|
| PlaybackController | `VizLib.PlaybackController` | `play()`, `pause()`, `step()`, `reset()`, `goToStep(n)` |
| ThemeManager | `VizLib.ThemeManager` | Theme-aware color resolution, `onThemeChange()` |
| CanvasUtils | `VizLib.CanvasUtils` | `setupHiDPICanvas()`, `clearCanvas()`, `roundRect()`, `drawLine()`, `drawCircle()`, `getMousePosition()`, `CoordinateMapper`, `hexToRgb()`, `colorLerp()` |
| MathUtils | `VizLib.MathUtils` | `normalize()`, `clamp()`, `euclideanDistance()`, `manhattanDistance()`, `gaussian()`, `lerp()`, `remapRange()` |
| DatasetGenerators | `VizLib.DatasetGenerators` | Generates moons, circles, blobs, linear, XOR, spiral datasets |
| TreeLayoutEngine | `VizLib.TreeLayoutEngine` | Computes tree node positions for SVG/canvas rendering |
| URLStateManager | `VizLib.URLStateManager` | Saves/restores viz state to URL params, share button support |
| Quadtree | `VizLib.Quadtree` | Spatial indexing for O(log n) point lookups in dense plots |
| DomUtils | `VizLib.DomUtils` | `setTextContent()`, `wireStepper()`, `wireSlider()` |

**Wait for readiness:** Always use `VizLib.onReady(fn)` or listen for `'vizlib-ready'` event.

---

## 9. Quality Gates

Before considering a visualization complete:

**Layout & Structure:**
- [ ] Both themes render correctly (toggle and verify)
- [ ] CSS uses only custom properties — no hardcoded colors
- [ ] `col-md-7` / `col-md-5` layout with single `infoTabs()` call
- [ ] Stacks properly on mobile (< 992px)

**Canvas & Interactivity:**
- [ ] Canvas fills its panel (no small centered box)
- [ ] Compact font sizes (11-12px data, 12-13px labels)
- [ ] Controls are inline/compact, not stacked vertically with huge spacing
- [ ] Hover effects on all interactive elements
- [ ] Direct manipulation works (click canvas, adjust params, instant response)

**Build & Capture:**
- [ ] `npm run build` succeeds with no errors
- [ ] After implementation: capture both themes to Figma for iteration

---

## 10. Figma MCP Integration Rules

These rules define how to translate Figma inputs into code for this project. Follow them for every Figma-driven change.

### Required Flow (do not skip)

1. Run `get_design_context` first to fetch the structured representation for the exact node(s).
2. If the response is too large or truncated, run `get_metadata` to get the high-level node map, then re-fetch only the required node(s) with `get_design_context`.
3. Run `get_screenshot` for a visual reference of the node/variant being implemented.
4. Only after you have both `get_design_context` and `get_screenshot`, download any assets needed and start implementation.
5. Translate the output into this project's conventions (Nunjucks + Bootstrap 3 + vanilla JS + CSS custom properties). The Figma MCP output is typically React + Tailwind — treat it as a **representation of design and behavior**, not as final code.
6. Validate against the Figma screenshot for 1:1 look and behavior before marking complete.

### Translation Rules (Figma Output -> This Project)

**Layout mapping:**
- Figma `flex` containers with horizontal layout -> Bootstrap `row` + `col-md-*`
- Figma auto-layout vertical stacking -> `panel panel-default` > `panel-heading` + `panel-body`
- Figma tabs/segmented controls -> `infoTabs()` macro
- Any Tailwind classes in Figma output -> equivalent CSS custom properties or Bootstrap 3 classes

**Color mapping:**
- Map Figma fill colors to the nearest `--viz-*` or `--gruvbox-*` CSS custom property
- If no matching token exists, create a new per-visualization custom property in both `:root` and `[data-theme="gruvbox-dark"]`
- IMPORTANT: Never hardcode hex colors in HTML or CSS. Always use `var(--token-name)`.

**Typography mapping:**
- Figma text sizes -> project's compact scale (11-12px data, 12-13px labels, 14px body)
- Figma monospace text -> `font-family: var(--viz-mono-font)`
- Figma bold/semibold -> `font-weight: 600`

**Component mapping:**
- Reuse existing Nunjucks macros from `src/_includes/components/` (see Section 6)
- Figma button groups -> Bootstrap 3 `btn-group btn-group-sm`
- Figma inputs/selects -> `form-control input-sm`
- Figma tables -> `table table-condensed table-striped`

**Spacing:**
- Figma padding/gaps -> compact values: 4px, 6px, 8px, 10px, 12px, 15px
- Don't use Figma's large spacing values verbatim; compress to match the dense/compact aesthetic

### Asset Handling

- The Figma MCP server provides an assets endpoint for images and SVGs.
- IMPORTANT: If the Figma MCP server returns a localhost source for an image or SVG, use that source directly.
- IMPORTANT: DO NOT import/add new icon packages — all icons use Font Awesome 6.x (already loaded via CDN kit).
- IMPORTANT: DO NOT use or create placeholder images if a localhost source is provided.
- Store downloaded assets in `static/img/` (general) or `static/img/vis_cards/` (card thumbnails).

### Dual Theme Requirement

- Every Figma implementation must work in both `bluegold` (light) and `gruvbox-dark` themes.
- When capturing to Figma, capture BOTH theme variants.
- When implementing from Figma, ensure all colors use CSS custom properties with both `:root` and `[data-theme="gruvbox-dark"]` variants.

### What NOT to Do

- IMPORTANT: Do NOT use React, Vue, or any framework syntax. This project is vanilla JS + Nunjucks.
- IMPORTANT: Do NOT use Tailwind classes. This project uses Bootstrap 3.3.7 + custom CSS.
- IMPORTANT: Do NOT use Bootstrap 4/5 classes (`card`, `d-flex`, `d-grid`, `gap-*`, etc.).
- IMPORTANT: Do NOT add new CSS frameworks, icon libraries, or JS dependencies.
- IMPORTANT: Do NOT create separate panels in the right column. All right-column content goes inside one `infoTabs()` call.

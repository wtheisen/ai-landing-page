const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const markdownItFootnote = require("markdown-it-footnote");

module.exports = function(eleventyConfig) {
  // ===== MARKDOWN CONFIGURATION =====
  const md = markdownIt({
    html: true,
    breaks: false,
    linkify: true
  })
    .use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.headerLink()
    })
    .use(markdownItFootnote);

  eleventyConfig.setLibrary("md", md);

  // ===== CUSTOM FILTERS =====

  // Slugify function - convert string to URL-safe slug
  eleventyConfig.addFilter("slugify", function(s) {
    if (!s) return '';
    return s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  });

  // Sort array by key
  eleventyConfig.addFilter("sortByKey", function(arr, key, reverse = false) {
    if (!arr || !Array.isArray(arr)) return [];
    const sorted = [...arr].sort((a, b) => {
      const aVal = a[key] || '';
      const bVal = b[key] || '';
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });
    return reverse ? sorted.reverse() : sorted;
  });

  // Group resources by year
  eleventyConfig.addFilter("groupByYear", function(arr) {
    if (!arr || !Array.isArray(arr)) return {};
    const groups = {};
    for (const item of arr) {
      const year = item.date_added_year || 'Other';
      if (!groups[year]) groups[year] = [];
      groups[year].push(item);
    }
    return groups;
  });

  // Get sorted year keys (numeric descending, then 'Other')
  eleventyConfig.addFilter("sortedYearKeys", function(groupedObj) {
    if (!groupedObj || typeof groupedObj !== 'object') return [];
    const keys = Object.keys(groupedObj);
    const numericYears = keys.filter(k => k !== 'Other').sort((a, b) => parseInt(b) - parseInt(a));
    if (keys.includes('Other')) {
      numericYears.push('Other');
    }
    return numericYears;
  });

  // Filter resources by export_id pattern (contains or starts with)
  eleventyConfig.addFilter("filterByExportId", function(resourcesMap, pattern) {
    if (!resourcesMap || typeof resourcesMap !== 'object') return [];
    const results = [];
    for (const [id, entries] of Object.entries(resourcesMap)) {
      if (id.includes(pattern) || id.startsWith(pattern)) {
        results.push(...entries);
      }
    }
    return results;
  });

  // Filter for library resources (lib-* or contains 'library')
  eleventyConfig.addFilter("filterLibrary", function(resourcesMap) {
    if (!resourcesMap || typeof resourcesMap !== 'object') return [];
    const results = [];
    for (const [id, entries] of Object.entries(resourcesMap)) {
      if (id.startsWith('lib-') || id.includes('library')) {
        results.push(...entries);
      }
    }
    return results;
  });

  // Filter for learning resources (contains 'learning')
  eleventyConfig.addFilter("filterLearning", function(resourcesMap) {
    if (!resourcesMap || typeof resourcesMap !== 'object') return [];
    const results = [];
    for (const [id, entries] of Object.entries(resourcesMap)) {
      if (id.includes('learning')) {
        results.push(...entries);
      }
    }
    return results;
  });

  // Convert musings collection items into learning-card-compatible objects
  eleventyConfig.addFilter("musingsAsLearning", function(musings) {
    if (!musings || !Array.isArray(musings)) return [];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return musings.map(item => {
      const d = item.data.date ? new Date(item.data.date) : null;
      const entry = {
        name: item.data.title || 'Untitled',
        type: 'essay',
        link: item.url,
        author: item.data.author || '',
        notes: item.data.summary || '',
        figure: item.data.figure || '',
        languages: item.data.languages || []
      };
      if (d && !isNaN(d)) {
        entry.date_added_display = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
        entry.date_added_sort_key = d.toISOString().slice(0, 10);
        entry.date_added_year = d.getFullYear().toString();
      }
      return entry;
    });
  });

  // Current year filter
  eleventyConfig.addFilter("currentYear", function() {
    return new Date().getFullYear();
  });

  // Slice filter for arrays
  eleventyConfig.addFilter("slice", function(arr, start, end) {
    if (!arr || !Array.isArray(arr)) return [];
    return arr.slice(start, end);
  });

  // Length filter
  eleventyConfig.addFilter("len", function(arr) {
    if (!arr) return 0;
    if (Array.isArray(arr)) return arr.length;
    if (typeof arr === 'object') return Object.keys(arr).length;
    return 0;
  });

  // Parse JSON string filter (for tweet media field)
  eleventyConfig.addFilter("parseJson", function(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  });

  // Truncate to first N words
  eleventyConfig.addFilter("truncateWords", function(str, count) {
    if (!str) return '';
    const words = str.trim().split(/\s+/);
    if (words.length <= count) return str;
    return words.slice(0, count).join(' ') + '...';
  });

  // Strip URLs from text
  eleventyConfig.addFilter("stripUrls", function(str) {
    if (!str) return '';
    return str.replace(/https?:\/\/[^\s]+/g, '').trim();
  });

  // Type icon mapping
  const TYPE_ICONS = {
    'book': 'fa-solid fa-book',
    'video': 'fa-solid fa-video-camera',
    'notebook': 'fa-brands fa-python',
    'slides': 'fa-solid fa-person-chalkboard',
    'podcast': 'fa-solid fa-podcast',
    'blogpost': 'fa-solid fa-share-alt',
    'tweet': 'fa-brands fa-square-x-twitter',
    'paper': 'fa-solid fa-file-pdf',
    'essay': 'fa-solid fa-pen-nib'
  };

  eleventyConfig.addFilter("typeIcon", function(type) {
    if (!type) return 'fa-solid fa-paperclip';
    return TYPE_ICONS[type.toLowerCase()] || 'fa-solid fa-paperclip';
  });

  // Date formatting filter for musings
  eleventyConfig.addFilter("date", function(dateVal, format) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d)) return String(dateVal);
    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    const pad = n => String(n).padStart(2, '0');
    if (format === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (format === 'LLLL d, yyyy') return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  // ===== COLLECTIONS =====
  // Visualization collection - auto-discovers all pages tagged "visualization"
  eleventyConfig.addCollection("visualizations", function(collectionApi) {
    return collectionApi.getFilteredByTag("visualization")
      .sort((a, b) => (a.data.cardOrder || 99) - (b.data.cardOrder || 99));
  });

  // Musings collection - auto-discovers all pages tagged "musing", sorted newest-first
  // Posts tagged "draft" are excluded from the listing
  eleventyConfig.addCollection("musings", function(collectionApi) {
    return collectionApi.getFilteredByTag("musing")
      .filter(item => !(item.data.tags || []).includes("draft"))
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
  });

  // ===== SHORTCODES =====
  // Markdown rendering shortcode
  eleventyConfig.addPairedShortcode("markdown", function(content) {
    return md.render(content);
  });

  // ===== PASSTHROUGH COPY =====
  // Copy static assets
  eleventyConfig.addPassthroughCopy({ "static": "static" });
  eleventyConfig.addPassthroughCopy({ "static/ico/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "CNAME": "CNAME" });
  // unlisted previews of the AI2AI book chapters (exported by the Book Editor)
  eleventyConfig.addPassthroughCopy({ "book": "book" });

  // ===== WATCH TARGETS =====
  eleventyConfig.addWatchTarget("./src/");
  eleventyConfig.addWatchTarget("./static/");

  // ===== CONFIGURATION =====
  return {
    dir: {
      input: "src",
      output: "docs",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    passthroughFileCopy: true
  };
};

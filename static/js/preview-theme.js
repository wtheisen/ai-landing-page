(function () {
    'use strict';

    document.querySelectorAll('iframe[src]').forEach(function (frame, index) {
        var url;
        try { url = new URL(frame.getAttribute('src'), document.baseURI); } catch (err) { return; }
        // Only Google document viewers need a filter; local notebooks and visualizations
        // already render their own themes, and videos must retain their original colors.
        if (!['docs.google.com', 'drive.google.com'].includes(url.hostname) ||
            !/\/(preview|embed|pubhtml|pub)(\/|$)/.test(url.pathname)) return;

        var storageKey = 'preview-original-colors:' + url.origin + url.pathname;
        var original = false;
        try { original = localStorage.getItem(storageKey) === 'true'; } catch (err) {}
        frame.classList.add('google-document-preview');
        if (!frame.id) frame.id = 'google-document-preview-' + index;
        if (!frame.title) frame.title = 'Google document preview';

        var controls = document.createElement('div');
        controls.className = 'preview-theme-controls';
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-default btn-sm';
        button.textContent = 'Show original colors';
        button.setAttribute('aria-controls', frame.id);
        var note = document.createElement('span');
        note.className = 'preview-theme-note';
        controls.appendChild(button);
        controls.appendChild(note);
        // Bootstrap positions responsive iframes absolutely. Keep controls outside
        // that container so they remain visible and do not overlap the document.
        var container = frame.closest('.embed-responsive') || frame;
        container.parentNode.insertBefore(controls, container);

        function refresh() {
            var dark = document.documentElement.getAttribute('data-theme') === 'gruvbox-dark';
            controls.hidden = !dark;
            frame.classList.toggle('preview-original-colors', original);
            button.setAttribute('aria-pressed', String(original));
            note.textContent = original ? 'Original document colors.' :
                'Dark preview changes image and chart colors too.';
        }
        button.addEventListener('click', function () {
            original = !original;
            try {
                if (original) localStorage.setItem(storageKey, 'true');
                else localStorage.removeItem(storageKey);
            } catch (err) {}
            refresh();
        });
        document.addEventListener('themechange', refresh);
        window.addEventListener('storage', function (event) {
            if (event.key === storageKey || event.key === null) {
                original = event.key === storageKey && event.newValue === 'true';
                refresh();
            }
        });
        refresh();
    });
})();

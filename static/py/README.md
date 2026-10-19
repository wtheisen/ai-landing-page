# Browser PyTorch for the AI2AI book

`torch-ai2ai-<sha>.tar.gz` is the `torch` package from
[wtheisen/torch-pyodide](https://github.com/wtheisen/torch-pyodide), branch `ai2ai`, at commit `<sha>`
(`cd python && tar --exclude=__pycache__ -czf torch-ai2ai-<sha>.tar.gz torch`).
It runs on numpy (no WebGPU needed). The book's runnable code blocks unpack it into Pyodide
when a block imports torch (`eaiRunCode` in the Book Editor's `app/book.js`).
Keep old tarballs: published chapters point at the sha they were built with.

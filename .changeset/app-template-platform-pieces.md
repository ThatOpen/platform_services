---
"@thatopen/services": minor
---

The app template is made of the platform's own pieces, as the Hub and the Coordinator: the project's documents (`top-documents-panel reads-project`) and the document viewer (`top-file-viewer`), with a 3D viewer ready for streamed models and the colours softened by default; Properties in place of Objects; the library's accent and background. It is built on three's WebGPU build (`src/webgpu/`; `thatopen serve` and the vite build follow it). IFC files are converted by the platform on upload, not in the browser. The published bundle carries no source map: with it, `npm run build` and `thatopen publish` ran out of Node's memory on a new app.

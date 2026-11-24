// Production build config — builds dist/bundle.js as IIFE.
// For local development, use: npm run dev (runs thatopen serve with esbuild).
// Do NOT run "vite" or "vite build --watch" directly for dev.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// When `.thatopen` marks the project as beta, alias the public engine imports
// to their `@thatopen-platform/*-beta` packages at build time, so the source
// can use the stable import names in both stable and beta modes.
function getBetaAliases() {
  if (!existsSync('.thatopen')) return {};
  try {
    const config = JSON.parse(readFileSync('.thatopen', 'utf-8'));
    if (!config.beta) return {};
    return {
      '@thatopen/components': '@thatopen-platform/components-beta',
      '@thatopen/components-front': '@thatopen-platform/components-front-beta',
      '@thatopen/fragments': '@thatopen-platform/fragments-beta',
    };
  } catch {
    return {};
  }
}

// Some three.js example loaders (e.g. TTFLoader) import their deps from a
// jsdelivr `/+esm` CDN URL. A bundler can't put a URL import in an IIFE — it
// degrades to a runtime `require("https://…")` that throws — so rewrite any such
// URL back to the bare package name and let it resolve from node_modules.
const CDN_ESM = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?\/\+esm$/;

// On WebGPU, as the platform's apps and as `thatopen serve` builds it: three's WebGPU build answers `three`, and its
// WebGL-only addons (fat lines, postprocessing passes) go to the stand-ins in `src/webgpu/`.
const webgpuAliases = existsSync('src/webgpu/webgpu-lines.mjs')
  ? [
      { find: /^three(\/webgpu)?$/, replacement: resolve(__dirname, 'node_modules/three/build/three.webgpu.js') },
      {
        find: /^three\/(examples\/jsm|addons)\/lines\/(Line2|LineSegments2|LineMaterial|Wireframe)\.js$/,
        replacement: resolve(__dirname, 'src/webgpu/webgpu-lines.mjs'),
      },
      { find: /^three\/(examples\/jsm|addons)\/postprocessing\/.*$/, replacement: resolve(__dirname, 'src/webgpu/webgl-addons-stub.mjs') },
    ]
  : [];

// web-ifc without its IFC reader, as `thatopen serve` builds it: the platform converts IFC files on upload, and this app only
// uses web-ifc's constants (`src/webgpu/web-ifc-light.mjs` writes them from the web-ifc installed).
const LIGHT_WEB_IFC = '\0web-ifc-light';
const webIfcLight = existsSync('src/webgpu/web-ifc-light.mjs')
  ? [{
      // (The plugin's name kept in a constant: `thatopen serve` takes the first quoted name in this file as the app's.)
      name: LIGHT_WEB_IFC.slice(1),
      enforce: 'pre',
      resolveId: (source) => (source === 'web-ifc' ? LIGHT_WEB_IFC : null),
      async load(id) {
        if (id !== LIGHT_WEB_IFC) return null;
        const { lightWebIfc } = await import('./src/webgpu/web-ifc-light.mjs');
        return lightWebIfc(process.cwd());
      },
    }]
  : [];

export default defineConfig({
  plugins: webIfcLight,
  resolve: {
    alias: [
      ...webgpuAliases,
      { find: CDN_ESM, replacement: '$1' },
      ...Object.entries(getBetaAliases()).map(([find, replacement]) => ({
        find,
        replacement,
      })),
    ],
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'ThatOpenApp',
      formats: ['iife'],
      fileName: () => 'bundle.js',
    },
    outDir: 'dist',
    // No source map in the published bundle: with it, building a 19 MB app took ~4.5 GB and ran out of Node's memory, so
    // `npm run build` and `thatopen publish` failed on a new app (24-11). `thatopen serve` keeps its maps for development.
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'bundle.js',
      },
    },
  },
});

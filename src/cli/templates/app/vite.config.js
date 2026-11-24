// Production build config — builds dist/bundle.js as IIFE.
// For local development, use: npm run dev (runs thatopen serve with esbuild).
// Do NOT run "vite" or "vite build --watch" directly for dev.
import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
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

// What draws with WebGL only (`src/webgl/`: the `.3tz` viewer) is built on its own copy of three's plain build, with all it
// imports, as `thatopen serve` builds it: never shared with the app's three, which is the WebGPU build.
const WEBGL_ROOT = resolve(__dirname, 'src/webgl');
const WEBGL = '\0webgl:';
// (Its name kept in a constant: `thatopen serve` takes the first quoted name in this file as the app's global name.)
const WEBGL_PLUGIN = 'webgl-on-its-own-three';
const webglOnItsOwnThree = {
  name: WEBGL_PLUGIN,
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || options?.custom?.webglInner) return null;
    const fromWebgl = importer.startsWith(WEBGL);
    const from = fromWebgl ? importer.slice(WEBGL.length) : importer;
    if (!fromWebgl && !(source.startsWith('.') && resolve(dirname(from), source).startsWith(WEBGL_ROOT))) return null;
    if (source === 'three' || source === 'three/webgpu') return WEBGL + resolve(__dirname, 'node_modules/three/build/three.module.js');
    const resolved = await this.resolve(source, from, { skipSelf: true, custom: { webglInner: true } });
    if (!resolved || resolved.external) return null;
    return fromWebgl || resolved.id.startsWith(WEBGL_ROOT) ? WEBGL + resolved.id : null;
  },
  async load(id) {
    if (!id.startsWith(WEBGL)) return null;
    const file = id.slice(WEBGL.length).split('?')[0];
    const code = readFileSync(file, 'utf8');
    if (!/\.tsx?$/.test(file)) return code;
    const { transform } = await import('esbuild');
    return (await transform(code, { loader: 'ts', sourcefile: file })).code;
  },
};

export default defineConfig({
  plugins: existsSync(WEBGL_ROOT) ? [webglOnItsOwnThree] : [],
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

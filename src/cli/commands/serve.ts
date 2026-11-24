import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readLocalConfig } from '../lib/config';
import { BETA_ALIASES } from '../lib/beta';

export const serveCommand = new Command('serve')
  .description(
    'Build in watch mode and serve the IIFE bundle for local development',
  )
  .option('--port <port>', 'Port for the bundle server', '4000')
  .option(
    '--no-reload',
    'Rebuild on save but do not reload the open app; reload it yourself when you want the new bundle',
  )
  .action(async (opts: { port: string; reload: boolean }) => {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error(
        'No package.json found. Run this from a ThatOpen app project.',
      );
      process.exit(1);
    }

    const isBeta = readLocalConfig(cwd)?.beta === true;

    // Resolve the project's vite config to determine the IIFE global name
    const globalName = detectGlobalName(cwd);

    const bundlePath = join(cwd, 'dist', 'bundle.js');
    const mapPath = join(cwd, 'dist', 'bundle.js.map');
    const port = parseInt(opts.port);

    // SSE clients for live reload
    const sseClients: Set<ServerResponse> = new Set();

    function notifyClients() {
      // With --no-reload the bundle is rebuilt and waits: an app that is in
      // the middle of something (a long automated run) is not torn down by
      // a save somewhere in its sources.
      if (!opts.reload) return;
      for (const client of sseClients) {
        client.write('data: reload\n\n');
      }
    }

    // Import esbuild from the user's node_modules (it's a Vite dependency)
    let esbuild: typeof import('esbuild');
    try {
      esbuild = await import('esbuild');
    } catch {
      console.error(
        'Could not find esbuild. Make sure you have run `npm install`.',
      );
      process.exit(1);
    }

    // esbuild incremental watch mode
    const ctx = await esbuild.context({
      entryPoints: [join(cwd, 'src', 'main.ts')],
      bundle: true,
      format: 'iife',
      globalName,
      outfile: bundlePath,
      sourcemap: true,
      logLevel: 'info',
      alias: isBeta ? BETA_ALIASES : undefined,
      logOverride: {
        // IIFE format leaves import.meta empty. The only consumer of import.meta
        // in our ecosystem today is @thatopen/fragments' worker URL fallback,
        // which is never executed because ViewportsManager (and any other
        // FragmentsManager.init caller) always passes an explicit worker URL via
        // FragmentsManager.getWorker(). Silencing avoids noise on every build.
        'empty-import-meta': 'silent',
        // The HTML-entities table bundled by @nodable/entities (transitively
        // via fast-xml-parser) has a duplicate `euro: '€'` entry. Inlined into
        // both @thatopen/components and @thatopen/components-front, so every
        // platform app build hits two of these. Cosmetic, no runtime impact.
        'duplicate-object-key': 'silent',
      },
      loader: {
        // Image asset imports (`import iconUrl from "./icon.svg"`). Each is
        // inlined as a data URL into the IIFE so the bundle stays a single
        // self-contained file — no need for the dev server to serve loose
        // assets alongside bundle.js.
        '.svg': 'dataurl',
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.jpeg': 'dataurl',
        '.gif': 'dataurl',
        '.webp': 'dataurl',
      },
      plugins: [
        {
          // Some three.js example loaders (e.g. TTFLoader) import their deps from
          // a jsdelivr `/+esm` CDN URL. esbuild can't put a URL import in an IIFE
          // — it degrades to a runtime `require("https://…")` that throws — so
          // rewrite any such URL back to the bare package name and resolve it
          // from the project's node_modules.
          name: 'cdn-esm-to-local',
          setup(build) {
            const CDN_ESM =
              /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?\/\+esm$/;
            build.onResolve(
              { filter: /^https:\/\/cdn\.jsdelivr\.net\/npm\// },
              async (args) => {
                const match = args.path.match(CDN_ESM);
                if (!match) return null;
                const resolved = await build.resolve(match[1], {
                  kind: args.kind,
                  resolveDir: args.resolveDir,
                });
                if (resolved.errors.length > 0) {
                  return { errors: resolved.errors };
                }
                return {
                  path: resolved.path,
                  external: resolved.external,
                  sideEffects: resolved.sideEffects,
                };
              },
            );
          },
        },
        {
          // The beta components packages point their `main` at `dist`. When
          // they resolve to local repos (linked for development), bundling the
          // dist is a trap: the dist itself contains a self-import of the
          // package by name, which rollup answered with the PREVIOUS dist at
          // build time — so the bundle carries two copies of every module and
          // their singleton state splits silently. Consuming `src/index.ts`
          // instead collapses every path (entry, self-import, cross-package)
          // onto one physical module. Only when a `src` entry exists next to
          // the resolved `dist`, so published packages are untouched.
          name: 'beta-components-from-source',
          setup(build) {
            if (!isBeta) return;
            const PKG =
              /^(@thatopen\/components(-front)?|@thatopen-platform\/components(-front)?-beta)$/;
            build.onResolve({ filter: PKG }, async (args) => {
              if (args.pluginData === 'beta-src') return null;
              const resolved = await build.resolve(args.path, {
                kind: args.kind,
                resolveDir: cwd,
                pluginData: 'beta-src',
              });
              if (resolved.errors.length > 0) return null;
              const srcEntry = resolved.path.replace(
                /([\\/])dist[\\/][^\\/]+$/,
                '$1src$1index.ts',
              );
              if (srcEntry === resolved.path || !existsSync(srcEntry)) {
                return { path: resolved.path, sideEffects: resolved.sideEffects };
              }
              return { path: srcEntry };
            });
          },
        },
        {
          // 🔴 web-ifc WITHOUT ITS IFC READER, FOR AN APP THAT NEVER CONVERTS AN IFC (24-11: the platform converts them on
          // upload). An app that carries `src/webgpu/web-ifc-light.mjs` (the app template does) gets, for `web-ifc`, the module
          // it writes from the web-ifc installed: its constants, and stand-ins for the reader (57 KB in place of 5.8 MB).
          name: 'web-ifc-light',
          async setup(build) {
            const writer = join(cwd, 'src', 'webgpu', 'web-ifc-light.mjs');
            if (!existsSync(writer)) return;
            const { pathToFileURL } = await import('node:url');
            const { lightWebIfc } = (await import(pathToFileURL(writer).href)) as { lightWebIfc: (cwd: string) => string };
            const source = lightWebIfc(cwd);
            build.onResolve({ filter: /^web-ifc$/ }, () => ({ path: 'web-ifc', namespace: 'web-ifc-light' }));
            build.onLoad({ filter: /.*/, namespace: 'web-ifc-light' }, () => ({ contents: source, loader: 'js' }));
          },
        },
        {
          // 🔴 WHAT DRAWS WITH WEBGL ONLY, ON ITS OWN COPY OF three (24-11: the app template's `.3tz` viewer draws with a
          // library that has no WebGPU, in a renderer of its own, while the app is on three's WebGPU build). Everything under
          // `src/webgl/` is built with three's plain build, and so is all it imports (its libraries and their addons): a
          // copy of its own, never shared with the app's, so neither sees the other's. The rest of the app is untouched.
          name: 'webgl-on-its-own-three',
          setup(build) {
            const root = join(cwd, 'src', 'webgl');
            if (!existsSync(root)) return;
            const plainThree = join(cwd, 'node_modules', 'three', 'build', 'three.module.js');
            const inside = (path: string) => path.startsWith(root + '\\') || path.startsWith(root + '/');
            build.onResolve({ filter: /.*/ }, async (args) => {
              if (args.pluginData === 'webgl-inner') return null;
              const fromWebgl = args.namespace === 'webgl';
              if (!fromWebgl && !(args.resolveDir && inside(join(args.resolveDir, args.path)))) return null;
              if (args.path === 'three' || args.path === 'three/webgpu') return { path: plainThree, namespace: 'webgl' };
              const resolved = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: 'webgl-inner' });
              if (resolved.errors.length > 0 || resolved.external) return null;
              // (The app's own engine, reached by a type: not drawn here, left to the app.)
              if (fromWebgl || inside(resolved.path)) return { path: resolved.path, namespace: 'webgl' };
              return null;
            });
            build.onLoad({ filter: /.*/, namespace: 'webgl' }, async (args) => {
              const { readFile } = await import('node:fs/promises');
              const { dirname, extname } = await import('node:path');
              const ext = extname(args.path).slice(1);
              const loader = (['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'css'].includes(ext) ? (ext === 'mjs' || ext === 'cjs' ? 'js' : ext) : 'js') as 'ts';
              return { contents: await readFile(args.path, 'utf8'), loader, resolveDir: dirname(args.path) };
            });
          },
        },
        {
          // 🔴 ON WEBGPU, AS THE PLATFORM'S APPS (Antonio 24-11: «la plantilla debería funcionar siempre con webgpu, misma
          // configuración que el coordinator»). An app that carries the WebGPU stand-ins (`src/webgpu/`, the app template
          // does) is built on three's WebGPU build: the engine sees `WebGPURenderer` in `three` and draws with it (WebGL2
          // only where the browser has no WebGPU), and its WebGL-only addons (fat lines, postprocessing passes) go to the
          // stand-ins. Before `dedupe-three`, which would answer `three` with the plain build.
          name: 'three-on-webgpu',
          setup(build) {
            const standIns = join(cwd, 'src', 'webgpu');
            const lines = join(standIns, 'webgpu-lines.mjs');
            const addons = join(standIns, 'webgl-addons-stub.mjs');
            if (!existsSync(lines) || !existsSync(addons)) return;
            build.onResolve({ filter: /^three(\/webgpu)?$/ }, async (args) => {
              // (Its own resolution, and `dedupe-three`'s, are not asked again: they would come back here for ever.)
              if (args.pluginData === 'three-on-webgpu' || args.pluginData === 'dedupe-three') return null;
              const resolved = await build.resolve('three/webgpu', { kind: args.kind, resolveDir: cwd, pluginData: 'three-on-webgpu' });
              return resolved.errors.length > 0 ? null : { path: resolved.path, sideEffects: resolved.sideEffects };
            });
            build.onResolve({ filter: /^three\/(examples\/jsm|addons)\/lines\/(Line2|LineSegments2|LineMaterial|Wireframe)\.js$/ }, () => ({ path: lines }));
            build.onResolve({ filter: /^three\/(examples\/jsm|addons)\/postprocessing\/.*$/ }, () => ({ path: addons }));
          },
        },
        {
          // With published packages every `import "three"` lands in the app's
          // single copy, because npm hoists one three to the app root. When the
          // beta packages resolve to local repos instead (linked for
          // development), each repo carries its own nested three, esbuild
          // bundles one instance per repo, and three objects from one instance
          // are silently invisible to the renderer of another. Re-resolving
          // every `three` import from the app root restores the published
          // behavior: one three, the app's.
          name: 'dedupe-three',
          setup(build) {
            build.onResolve({ filter: /^three(\/.+)?$/ }, async (args) => {
              if (args.pluginData === 'dedupe-three') return null;
              const resolved = await build.resolve(args.path, {
                kind: args.kind,
                resolveDir: cwd,
                pluginData: 'dedupe-three',
              });
              if (resolved.errors.length > 0) return null;
              return {
                path: resolved.path,
                external: resolved.external,
                sideEffects: resolved.sideEffects,
              };
            });
          },
        },
        {
          name: 'reload',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                notifyClients();
              }
            });
          },
        },
      ],
    });

    await ctx.watch();

    // HTTP server to serve the bundle
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // SSE endpoint for live reload
      if (req.url === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // Bundle JS
      if (req.url === '/bundle.js' || req.url === '/') {
        if (!existsSync(bundlePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Bundle not built yet...');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-store',
        });
        res.end(readFileSync(bundlePath, 'utf-8'));
        return;
      }

      // Source map
      if (req.url === '/bundle.js.map') {
        if (!existsSync(mapPath)) {
          res.writeHead(404);
          res.end('Source map not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(readFileSync(mapPath, 'utf-8'));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(port, () => {
      console.log(`Bundle server running at http://localhost:${port}${isBeta ? ' (beta mode)' : ''}`);
      console.log('');
      console.log(
        'Open your project on the platform and click the debug button.',
      );
      console.log(
        opts.reload
          ? 'Live reload is enabled — save a file to rebuild automatically.'
          : 'Live reload is off — saving rebuilds the bundle; reload the app to load it.',
      );
      console.log('');
    });

    // Cleanup
    process.on('SIGINT', async () => {
      await ctx.dispose();
      server.close();
      process.exit(0);
    });
  });

/**
 * Peek at the project's vite.config to detect the IIFE global name.
 * Falls back to 'ThatOpenApp' if not found.
 */
function detectGlobalName(cwd: string): string {
  for (const filename of ['vite.config.js', 'vite.config.ts', 'vite.config.mts']) {
    const configPath = join(cwd, filename);
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const match = content.match(/name:\s*['"]([^'"]+)['"]/);
      if (match) return match[1];
    }
  }
  return 'ThatOpenApp';
}

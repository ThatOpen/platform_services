import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    // Shipped to npm on purpose: integrators debug against the installed
    // package, and a stack that ends in minified soup costs everyone a
    // round-trip through us.
    sourcemap: true,
    lib: { entry: resolve(__dirname, 'src/index.ts'), formats: ['cjs', 'es'] },
    rollupOptions: {
      // Optional peers, resolved from the CONSUMER's node_modules at the
      // moment an operation is built — bundling them here would ship the
      // whole fragments schema to every app that never authors one.
      external: [
        'flatbuffers',
        '@thatopen/fragments',
        // three's examples (fat lines, controls…) are the app's, like three: bundled here they are the WebGL ones,
        // and an app on the public engine 3.6, which runs three's WebGPU build, failed setting up on them
        // (`UniformsLib.line` of an undefined UniformsLib). Left external, the app resolves them, WebGPU or not.
        /^three\//,
      ],
      output: {
        assetFileNames: 'assets/[name][extname]',
        entryFileNames: '[name].[format].js',
      },
    },
  },

  resolve: { alias: { src: resolve('src/') } },
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src'],
      copyDtsFiles: true,
    }),
  ],
});

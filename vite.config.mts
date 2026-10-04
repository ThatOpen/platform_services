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

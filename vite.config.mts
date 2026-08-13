import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
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
      // The vendored backend DTOs are re-exported from src/types/notifications,
      // so their declarations have to be emitted too. Without this the
      // published .d.ts points at ../../vendor/... and resolves to nothing on
      // a consumer's machine.
      include: ['src', 'vendor/backend-api/src/common/dto'],
      copyDtsFiles: true,
    }),
  ],
});

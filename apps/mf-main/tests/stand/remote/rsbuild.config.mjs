import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

const base = '/fixtures/stand_notes';

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'stand_notes',
      filename: 'remoteEntry.js',
      manifest: { fileName: 'importmap.json' },
      exposes: {
        '.': './tests/stand/remote/Note.tsx',
        './Widget': './tests/stand/remote/Note.tsx',
        './MissingDefault': './tests/stand/remote/MissingDefault.ts',
        './BrokenNote': './tests/stand/remote/BrokenNote.tsx',
      },
      shared: { react: { singleton: true, requiredVersion: false, import: false } },
      dts: false,
    }),
  ],
  source: { entry: { index: './src/index.ts' } },
  tools: { htmlPlugin: false },
  dev: { assetPrefix: `${base}/`, hmr: false, liveReload: false, lazyCompilation: false },
  server: {
    base,
    middlewareMode: true,
    publicDir: false,
    printUrls: false,
    cors: { origin: /^http:\/\/127\.0\.0\.1:\d+$/ },
  },
  output: { assetPrefix: `${base}/`, distPath: { root: 'dist/stand-remote' } },
});

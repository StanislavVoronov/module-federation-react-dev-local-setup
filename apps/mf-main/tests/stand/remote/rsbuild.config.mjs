import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

function createRemoteConfig(name, exposes) {
  const base = `/fixtures/${name}`;
  return defineConfig({
    plugins: [
      pluginReact(),
      pluginModuleFederation({
        name,
        filename: 'remoteEntry.js',
        manifest: { fileName: 'importmap.json' },
        exposes,
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
    output: { assetPrefix: `${base}/`, distPath: { root: `dist/${name}` } },
  });

}

export const remoteConfigs = [
  {
    id: 'stand_notes',
    exposes: {
      '.': './tests/stand/remote/Note.tsx',
      './Widget': './tests/stand/remote/Note.tsx',
      './MissingDefault': './tests/stand/remote/MissingDefault.ts',
      './BrokenNote': './tests/stand/remote/BrokenNote.tsx',
    },
  },
  ...[
    ['stand_counter', 'Counter', 'Counter'],
    ['stand_tasks', 'Tasks', 'Tasks'],
    ['stand_calculator', 'Calculator', 'Calculator'],
    ['stand_preferences', 'Preferences', 'Preferences'],
    ['stand_registration_error', 'RegistrationError', 'Note'],
    ['stand_load_error', 'LoadError', 'Note'],
    ['stand_placeholder', 'Placeholder', 'Note'],
  ].map(([id, componentName, file]) => ({
    id,
    exposes: { [`./${componentName}`]: `./tests/stand/remote/${file}.tsx` },
  })),
].map(({ id, exposes }) => ({ id, config: createRemoteConfig(id, exposes) }));

import { fileURLToPath } from 'node:url';
import { createRsbuild, defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import remoteConfig from './remote/rsbuild.config.mjs';

const remoteBase = '/fixtures/stand_notes/';
let remoteServer;

export default defineConfig({
  plugins: [
    pluginReact(),
    {
      name: 'stand-remote-server',
      setup(api) {
        api.onCloseDevServer(async () => { await remoteServer?.close(); });
      },
    },
  ],
  source: { entry: { index: './tests/stand/main.tsx' } },
  html: { title: 'Стенд DynamicModule' },
  server: {
    host: '127.0.0.1',
    port: 7010,
    publicDir: false,
    async setup({ action, server }) {
      if (action !== 'dev') return;

      const cwd = fileURLToPath(new URL('../../', import.meta.url));
      const remote = await createRsbuild({ cwd, config: remoteConfig });
      remoteServer = await remote.createDevServer({ getPortSilently: true });

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(remoteBase)) return next();

        const file = url.pathname.slice(remoteBase.length);
        if (file === 'importmap.json' || file === 'custom-manifest.json') {
          if (url.searchParams.get('hostId') !== 'dynamic_module_test' || url.searchParams.get('remoteId') !== 'stand_notes') {
            res.statusCode = 400;
            res.end('Expected hostId and remoteId in the manifest URL');
            return;
          }
          req.url = `${remoteBase}importmap.json${url.search}`;
        }

        remoteServer.middlewares(req, res, next);
      });
    },
  },
});

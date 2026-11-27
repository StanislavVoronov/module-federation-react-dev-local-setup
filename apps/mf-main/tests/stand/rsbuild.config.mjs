import { fileURLToPath } from 'node:url';
import { createRsbuild, defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { remoteConfigs } from './remote/rsbuild.config.mjs';

const remoteServers = [];

export default defineConfig({
  plugins: [
    pluginReact(),
    {
      name: 'stand-remote-server',
      setup(api) {
        api.onCloseDevServer(async () => { await Promise.all(remoteServers.map((remote) => remote.close())); });
      },
    },
  ],
  source: {
    entry: { index: './tests/stand/main.tsx' },
    define: {
      'import.meta.env.PUBLIC_FRONT_MODULE_ID': JSON.stringify('dynamic_module_test'),
      'import.meta.env.PUBLIC_FRONT_MODULE_NAME': JSON.stringify('Стенд'),
    },
  },
  html: { title: 'Стенд DynamicModule' },
  server: {
    host: '127.0.0.1',
    port: 7010,
    publicDir: false,
    async setup({ action, server }) {
      if (action !== 'dev') return;

      const cwd = fileURLToPath(new URL('../../', import.meta.url));
      for (const { id, config } of remoteConfigs) {
        const remoteBase = `/fixtures/${id}/`;
        const remote = await createRsbuild({ cwd, config });
        const remoteServer = await remote.createDevServer({ getPortSilently: true });
        remoteServers.push(remoteServer);

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const alternateBase = '/fixtures/stand_notes_alt/';
          const requestBase = id === 'stand_notes' && url.pathname.startsWith(alternateBase) ? alternateBase : remoteBase;
          if (!url.pathname.startsWith(requestBase)) return next();

          const file = url.pathname.slice(requestBase.length);
          if (file === 'importmap.json' || file === 'custom-manifest.json') {
            if (url.searchParams.get('hostId') !== 'dynamic_module_test' || url.searchParams.get('remoteId') !== id) {
              res.statusCode = 400;
              res.end('Expected hostId and remoteId in the manifest URL');
              return;
            }
            req.url = `${remoteBase}importmap.json${url.search}`;
          }

          if (id === 'stand_load_error' && file === 'remoteEntry.js' && url.searchParams.get('failLoad') === '1') {
            res.statusCode = 503;
            res.setHeader('Cache-Control', 'no-store');
            res.end('Тестовая ошибка загрузки JavaScript');
            return;
          }

          remoteServer.middlewares(req, res, next);
        });
      }
    },
  },
});

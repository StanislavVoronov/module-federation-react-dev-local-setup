import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

const PORT = 5002;

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'mf_host',
      // Оболочка объявляет все контейнеры страницы, хотя статических импортов
      // вида `mf_remote/App` в коде нет: mf-main регистрирует их рантаймом
      // через registerRemotes/loadRemote. Декларация нужна ради HMR — без неё
      // контейнер непрозрачен для компиляции, апдейт из remote доезжает и
      // модуль переисполняется, но перерисовать его в дереве уже некому, и
      // правка перестаёт быть видна без перезагрузки. Проверено A/B на
      // mf_remote и mf_remote_1: убрать отсюда — HMR у обоих отваливается.
      remotes: {
        mf_main: 'mf_main@/mf-main/mf-manifest.json',
        mf_remote: 'mf_remote@/mf-remote/mf-manifest.json',
        mf_remote_1: 'mf_remote_1@/mf-remote-1/mf-manifest.json',
        mf_remote_2: 'mf_remote_2@/mf-remote-2/mf-manifest.json',
      },
      // React root живёт в host, поэтому host становится владельцем
      // singleton'а для React и ReactDOM.
      shared: {
        react: { singleton: true, requiredVersion: false },
        'react/': { singleton: true, requiredVersion: false },
        'react-dom': { singleton: true, requiredVersion: false },
        'react-dom/': { singleton: true, requiredVersion: false },
        'react-router': { singleton: true, requiredVersion: false },
        'react-router-dom': { singleton: true, requiredVersion: false },
      },
      dts: false,
    }),
  ],

  // index.html генерирует сам Rsbuild (дефолтный шаблон уже содержит #root).
  html: {
    title: 'mf-host',
  },

  server: {
    port: PORT,
    strictPort: true,
    // Единственное место, где живут реальные адреса remote. В коде только
    // относительные пути, поэтому сборка ни к чему не привязана.
    // ws: true — через этот же прокси идут HMR-сокеты remote.
    // Пути не переписываем: remote сами живут под своим server.base.
    proxy: {
      // Нужен не bootstrap host, а приложению mf-main после рендера.
      '/api/': { target: 'http://localhost:5003', changeOrigin: true },
      '/mf-main/': { target: 'http://localhost:5006', ws: true },
      '/mf-remote/': { target: 'http://localhost:5001', ws: true },
      '/mf-remote-1/': { target: 'http://localhost:5004', ws: true },
      '/mf-remote-2/': { target: 'http://localhost:5005', ws: true },
    },
  },

  output: {
    // Сборку раздаёт mf-bus с корня.
    assetPrefix: '/',
  },
});

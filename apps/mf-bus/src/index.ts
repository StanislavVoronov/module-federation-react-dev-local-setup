import { loadRemote } from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';

type AppModule = { default: ComponentType };

const MAIN_REMOTE = 'mf_main';

async function start() {
  const { render } = await import('./render');

  const main = await loadRemote<AppModule>(MAIN_REMOTE);

  if (!main) {
    throw new Error(`${MAIN_REMOTE} не найден`);
  }

  const container = document.getElementById('root');

  if (!container) {
    throw new Error('mf-bus: #root не найден в разметке страницы');
  }

  render(container, main.default);
}

start().catch((error) => {
  console.error('mf-bus: не удалось запустить mf-main', error);

  const container = document.getElementById('root');

  if (container) {
    container.textContent = `mf-main недоступен: ${String(error)}`;
  }
});

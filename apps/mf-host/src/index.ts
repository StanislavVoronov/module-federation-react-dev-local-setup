import {
  loadRemote,
  registerRemotes,
} from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';

type RemoteComponentModule = {
  default: ComponentType;
};

async function mountMain(): Promise<void> {
  registerRemotes([
    { name: 'mf_main', entry: '/mf-main/mf-manifest.json' },
  ]);

  // Сначала загружаем владельца React root и router context. После этого
  // mf_main получит те же singleton-экземпляры из share scope.
  const { render } = await import('./render');
  const main = await loadRemote<RemoteComponentModule>('mf_main');

  if (!main) {
    throw new Error('mf_main не найден');
  }

  render(main.default);
}

function renderStartupError(error: unknown): void {
  console.error('mf-host: не удалось запустить mf-main', error);

  const container = document.getElementById('root');

  if (container) {
    container.textContent = `mf-main недоступен: ${String(error)}`;
  }
}

void mountMain().catch(renderStartupError);

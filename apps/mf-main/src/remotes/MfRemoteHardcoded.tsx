import { loadRemote } from '@module-federation/enhanced/runtime';
import { lazy } from 'react';
import type { ComponentType } from 'react';
import { DefaultRemoteError, RemoteBoundary } from './DynamicModule';

const MfRemoteApp = lazy(async () => {
  const loaded = await loadRemote<{ default: ComponentType }>(
    'mf_remote/App',
  );

  if (!loaded) {
    throw new Error('mf_remote/App не найден');
  }

  return loaded;
});

export function MfRemoteHardcoded() {
  return (
    <RemoteBoundary
      host={{ id: 'mf_main', name: 'mf-host' }}
      remote={{
        id: 'mf_remote',
        name: 'test',
        enabled: true,
        path: '/mf-remote',
        manifest: 'mf-manifest.json',
        component: 'App',
      }}
      loading={<p className="host__status">Загружаю test…</p>}
      fallback={DefaultRemoteError}
      component={MfRemoteApp}
    >
      {(Module) => <Module />}
    </RemoteBoundary>
  );
}

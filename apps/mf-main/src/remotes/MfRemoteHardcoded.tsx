import { loadRemote } from '@module-federation/enhanced/runtime';
import { lazy, Suspense } from 'react';
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
      name="test"
      fallback={(error) => <DefaultRemoteError remote={{ name: 'test' }} error={error} />}
    >
      <Suspense fallback={<p className="host__status">Загружаю test…</p>}>
        <MfRemoteApp />
      </Suspense>
    </RemoteBoundary>
  );
}

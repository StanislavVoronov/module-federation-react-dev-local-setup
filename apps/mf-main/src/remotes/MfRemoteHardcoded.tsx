import { DefaultRemoteError, DynamicModule } from './DynamicModule';

export function MfRemoteHardcoded() {
  return (
    <DynamicModule
      host={{ id: 'mf_main', name: 'mf-host' }}
      remote={{
        id: 'mf_remote',
        name: 'test',
        enabled: true,
        path: '/mf-remote',
        manifest: 'mf-manifest.json',
        component: 'App',
      }}
      fallbacks={{
        error: DefaultRemoteError,
        loading: <p className="host__status">Загружаю test…</p>,
      }}
    />
  );
}

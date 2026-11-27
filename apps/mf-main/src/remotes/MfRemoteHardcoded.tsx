import { DefaultRemoteError, DynamicModule } from './DynamicModule';

export function MfRemoteHardcoded() {
  return (
    <DynamicModule
      config={{
        id: 'mf_remote',
        name: 'test',
        enabled: true,
        publicPath: '/mf-remote',
        manifest: 'mf-manifest.json',
        componentName: 'App',
      }}
      fallbacks={{
        error: DefaultRemoteError,
        loading: <p className="host__status">Загружаю test…</p>,
      }}
    />
  );
}

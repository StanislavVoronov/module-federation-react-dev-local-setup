import { DefaultRemoteError, DynamicModule } from './DynamicModule';

export function MfRemoteHardcoded() {
  return (
    <DynamicModule
      source={{
        hostId: import.meta.env.PUBLIC_FRONT_MODULE_ID,
        hostName: import.meta.env.PUBLIC_FRONT_MODULE_NAME,
        remoteId: 'mf_remote',
        remoteName: 'test',
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

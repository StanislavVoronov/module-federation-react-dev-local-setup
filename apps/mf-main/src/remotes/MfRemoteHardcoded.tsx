import { DefaultRemoteError, DynamicModule } from './DynamicModule';

export function MfRemoteHardcoded() {
  return (
    <DynamicModule
      host={{ id: import.meta.env.PUBLIC_FRONT_MODULE_ID, name: import.meta.env.PUBLIC_FRONT_MODULE_NAME }}
      publicPath="/mf-remote"
      manifest="mf-manifest.json"
      component="App"
      fallbacks={{
        error: DefaultRemoteError,
        loading: <p className="host__status">Загружаю test…</p>,
      }}
    />
  );
}

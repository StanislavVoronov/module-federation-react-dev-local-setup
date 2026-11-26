import { DefaultRemoteError, DynamicModule } from './DynamicModule';

export function MfRemoteHardcoded() {
  return (
    <DynamicModule
      id="mf_remote"
      name="test"
      enabled
      path="/mf-remote"
      manifest="mf-manifest.json"
      componentName="App"
      fallbacks={{
        error: DefaultRemoteError,
        loading: <p className="host__status">Загружаю test…</p>,
      }}
    />
  );
}

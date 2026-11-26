import type { ComponentType } from 'react';
import { DynamicModule, type DynamicModuleFallbackContext } from '../src/remotes/DynamicModule';

const props = {
  host: { id: 'mf_main', name: 'mf-main' },
  remote: {
    id: 'mf_remote_1',
    name: 'mf-remote-1',
    enabled: true,
    path: '/mf-remote-1',
  },
  fallbacks: { error: null },
};

type Widget = ComponentType<{ initialCount: number }>;
const UserInfo = () => <p>User info</p>;

<DynamicModule {...props} />;

<DynamicModule {...props} onLoad={(result) => {
  if (result.status === 'success') {
    // @ts-expect-error Reporting a successful load does not expose the module.
    void result.module;
  }
}} />;

// @ts-expect-error A fallback must be supplied for errors.
<DynamicModule host={props.host} remote={props.remote} />;

// @ts-expect-error Loading does not replace the required error fallback.
<DynamicModule {...props} fallbacks={{ loading: UserInfo }} />;

// @ts-expect-error Use null to explicitly hide error content.
<DynamicModule {...props} fallbacks={{ error: undefined }} />;

<DynamicModule
  {...props}
  fallbacks={{ placeholder: UserInfo, loading: UserInfo, error: <UserInfo /> }}
/>;

function ContextualUserInfo({ module, user }: { module: DynamicModuleFallbackContext; user: string }) {
  return <p>{user}: {module.remote.name}</p>;
}

function ErrorModal({ error, onRepeat, failTries }: { error: unknown; onRepeat: () => void; failTries: number }) {
  return <button type="button" onClick={onRepeat}>{String(error)} ({failTries})</button>;
}

<DynamicModule {...props} fallbacks={{ error: ErrorModal }} />;

<DynamicModule
  {...props}
  fallbacks={{
    placeholder: (context) => <ContextualUserInfo module={context} user="1" />,
    loading: ({ host }) => <p>{host.name}</p>,
    error: ({ remote, error, onRepeat, failTries }) => (
      <button type="button" onClick={onRepeat}>{remote.name}: {String(error)} ({failTries})</button>
    ),
  }}
/>;

<DynamicModule
  {...props}
  remote={{ ...props.remote, component: './Widget', manifest: 'mf-manifest.json' }}
/>;

<DynamicModule<Widget> {...props}>
  {(Module) => <Module initialCount={2} />}
</DynamicModule>;

// @ts-expect-error Passing a generic requires a render function.
<DynamicModule<Widget> {...props} />;

// @ts-expect-error The rule also applies to components without props.
<DynamicModule<ComponentType> {...props} />;

<DynamicModule<Widget> {...props}>
  {/* @ts-expect-error Required props of the remote component are preserved. */}
  {(Module) => <Module />}
</DynamicModule>;

import { DynamicModule, type DynamicModuleFallbackContext } from '../src/remotes/DynamicModule';

const config = {
  id: 'mf_remote_1',
  name: 'mf-remote-1',
  enabled: true,
  publicPath: '/mf-remote-1',
};
const props = { config, fallbacks: { error: null } };
type WidgetContext = { initialCount: number; onChange: (count: number) => void };
const UserInfo = () => <p>User info</p>;

<DynamicModule {...props} />;
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2, onChange: (count) => count.toFixed() }} />;
<DynamicModule<{ title?: string }> {...props} />;
<DynamicModule<{ title?: string }> {...props} context={{ title: 'Title' }} />;
// Context may also be inferred.
<DynamicModule {...props} context={{ userId: '42', onClose: () => {} }} />;

// @ts-expect-error Required context cannot be omitted.
<DynamicModule<WidgetContext> {...props} />;
// @ts-expect-error Required handler is missing.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2 }} />;
// @ts-expect-error Incorrect value type.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: '2', onChange: () => {} }} />;
// @ts-expect-error Incorrect handler argument type.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2, onChange: (value: string) => {} }} />;
// @ts-expect-error Unexpected context property.
<DynamicModule<{ userId: string }> {...props} context={{ userId: '42', extra: true }} />;

<DynamicModule<WidgetContext> {...props}>
  {(Module) => <Module initialCount={2} onChange={() => {}} />}
</DynamicModule>;
<DynamicModule<WidgetContext> {...props}>
  {/* @ts-expect-error Required props remain checked in custom rendering. */}
  {(Module) => <Module />}
</DynamicModule>;
// @ts-expect-error Choose context or children, not both.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2, onChange: () => {} }} children={() => null} />;

// @ts-expect-error Error fallback is required.
<DynamicModule config={config} />;
// @ts-expect-error Loading does not replace error fallback.
<DynamicModule {...props} fallbacks={{ loading: UserInfo }} />;
// @ts-expect-error Use null to hide error content.
<DynamicModule {...props} fallbacks={{ error: undefined }} />;

function ContextualUserInfo({ module }: { module: DynamicModuleFallbackContext }) {
  return <p>{module.name}</p>;
}
function ErrorModal({ error, onRepeat, failTries, isLoading }: {
  error: unknown; onRepeat: () => void; failTries: number; isLoading: boolean;
}) {
  return <button onClick={onRepeat} disabled={isLoading}>{String(error)} ({failTries})</button>;
}
<DynamicModule {...props} fallbacks={{ error: ErrorModal, loading: UserInfo, placeholder: <UserInfo /> }} />;
<DynamicModule {...props} fallbacks={{
  placeholder: (context) => <ContextualUserInfo module={context} />,
  loading: ({ name }) => <p>{name}</p>,
  error: ({ name, error, onRepeat }) => <button onClick={onRepeat}>{name}: {String(error)}</button>,
}} />;
<DynamicModule {...props} config={{ ...config, componentName: './Widget', manifest: 'mf-manifest.json', supportUrl: '/help' }} />;
// @ts-expect-error supportTitle is not supported.
<DynamicModule {...props} config={{ ...config, supportTitle: 'Help' }} />;
// @ts-expect-error Config fields are no longer top-level props.
<DynamicModule {...props} publicPath="/other" />;
// @ts-expect-error Host identity comes from the build environment.
<DynamicModule {...props} host={{ id: 'custom', name: 'Custom' }} />;

<DynamicModule {...props} onLoad={(result) => {
  if (result.status === 'success') {
    // @ts-expect-error Successful notification does not expose the module.
    void result.module;
  }
}} />;

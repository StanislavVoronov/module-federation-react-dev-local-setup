import { DynamicModule, type DynamicModuleFallbackContext } from '../src/remotes/DynamicModule';

const options = { host: { id: 'mf_main', name: 'mf-main' }, publicPath: '/mf-remote-1' };
const props = { ...options, fallbacks: { error: null } };
type WidgetContext = { initialCount: number; onChange: (count: number) => void };
const UserInfo = () => <p>User info</p>;

<DynamicModule {...props} />;
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2, onChange: (count) => count.toFixed() }} />;
<DynamicModule<{ title?: string }> {...props} />;
<DynamicModule<{ title?: string }> {...props} context={{ title: 'Title' }} />;
// @ts-expect-error Passing context requires an explicit generic.
<DynamicModule {...props} context={{ userId: '42', onClose: () => {} }} />;

// Context is optional even when a generic has required fields.
<DynamicModule<WidgetContext> {...props} />;
// @ts-expect-error Required handler is missing.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2 }} />;
// @ts-expect-error Incorrect value type.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: '2', onChange: () => {} }} />;
// @ts-expect-error Incorrect handler argument type.
<DynamicModule<WidgetContext> {...props} context={{ initialCount: 2, onChange: (value: string) => {} }} />;
// @ts-expect-error Unexpected context property.
<DynamicModule<{ userId: string }> {...props} context={{ userId: '42', extra: true }} />;

// @ts-expect-error Render functions are no longer supported.
<DynamicModule<WidgetContext> {...props} children={() => null} />;
// @ts-expect-error JSX children are no longer supported.
<DynamicModule {...props}><span>Child</span></DynamicModule>;

// @ts-expect-error Error fallback is required.
<DynamicModule {...options} />;
// @ts-expect-error Loading does not replace error fallback.
<DynamicModule {...props} fallbacks={{ loading: UserInfo }} />;
// @ts-expect-error Use null to hide error content.
<DynamicModule {...props} fallbacks={{ error: undefined }} />;

function ContextualUserInfo({ module }: { module: DynamicModuleFallbackContext }) {
  return <p>{'User info'}</p>;
}
function ErrorModal({ error, onRepeat, failTries, isLoading }: {
  error: unknown; onRepeat: () => void; failTries: number; isLoading: boolean;
}) {
  return <button onClick={onRepeat} disabled={isLoading}>{String(error)} ({failTries})</button>;
}
<DynamicModule {...props} fallbacks={{ error: ErrorModal, loading: UserInfo, placeholder: <UserInfo /> }} />;
<DynamicModule {...props} fallbacks={{
  placeholder: (context) => <ContextualUserInfo module={context} />,
  loading: () => <p>Загрузка</p>,
  error: ({ error, onRepeat }) => <button onClick={onRepeat}>{String(error)}</button>,
}} />;
<DynamicModule {...props} component="./Widget" manifest="mf-manifest.json" />;
<DynamicModule {...props} enabled={false} />;
// @ts-expect-error source is no longer supported.
<DynamicModule {...props} source={options} />;
// @ts-expect-error Remote identity comes from the manifest.
<DynamicModule {...props} id="remote" />;
// @ts-expect-error Remote display name is no longer supported.
<DynamicModule {...props} name="Remote" />;
// @ts-expect-error Host id is required.
<DynamicModule {...props} host={{ name: 'Host' }} />;

<DynamicModule {...props} onLoad={(result) => {
  if (result.status === 'success') {
    // @ts-expect-error Successful notification does not expose the module.
    void result.module;
  }
}} />;

const unknownContext: unknown = { userId: '42' };
// @ts-expect-error An unknown value must not bypass the explicit generic requirement.
<DynamicModule {...props} context={unknownContext} />;
<DynamicModule<unknown> {...props} />;
<DynamicModule<WidgetContext> {...props} context={undefined} />;

interface ProfileContext {
  userId: string;
  onClose: () => void;
}
const profileContext: ProfileContext = { userId: '42', onClose: () => {} };
<DynamicModule<ProfileContext> {...props} context={profileContext} />;
<DynamicModule<ProfileContext> {...props} />;
// @ts-expect-error A typed variable must not infer the generic automatically.
<DynamicModule {...props} context={profileContext} />;
// @ts-expect-error Spreading props must not infer the generic automatically.
<DynamicModule {...props} {...{ context: profileContext }} />;
// @ts-expect-error Even an empty context requires an explicit generic.
<DynamicModule {...props} context={{}} />;
// @ts-expect-error A handler-only context requires an explicit generic.
<DynamicModule {...props} context={{ onClose: () => {} }} />;

<DynamicModule<ProfileContext> {...props} context={profileContext} fallbacks={{
  loading: ({ userId, onClose }) => <button onClick={onClose}>{userId?.toUpperCase()}</button>,
  placeholder: ({ userId }) => <p>{userId}</p>,
  error: ({ userId, error, onClose, onRepeat }) => <button onClick={onClose ?? onRepeat}>{userId}: {String(error)}</button>,
}} />;
<DynamicModule<ProfileContext> {...props} fallbacks={{ error: null, loading: ({ userId }) => {
  // @ts-expect-error context is optional, so userId may be absent in a fallback.
  return userId.toUpperCase();
} }} />;

<DynamicModule<ProfileContext> {...props} context={profileContext} fallbacks={{
  loading: ({ userId }) => <p>{userId}</p>,
  error: ({ error }) => <p>{String(error)}</p>,
  placeholder: (fallbackProps) => {
    // @ts-expect-error Configuration fields must not be flattened into fallback props.
    void fallbackProps.publicPath;
    return <p>{fallbackProps.userId}</p>;
  },
}} />;

// @ts-expect-error Support fields are not supported.
<DynamicModule {...props} supportUrl="/help" />;

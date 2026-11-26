import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import { Component, lazy, Suspense } from 'react';
import type {
  ComponentType,
  ErrorInfo,
  JSXElementConstructor,
  LazyExoticComponent,
  ReactNode,
} from 'react';

type RemoteComponent = JSXElementConstructor<never>;
type Support = { url: string; title: string };

export type DynamicModuleFallbackContext = {
  host: { id: string; name: string };
  remote: {
    /** Federation container name. */
    id: string;
    name: string;
    enabled: boolean;
    /** Manifest file relative to the remote path. Defaults to `importmap.json`. */
    manifest?: string;
    /** Public base path without a query, for example `/mf-remote-1`. */
    path: string;
    /** Key in `exposes`. Omit to load the root expose. */
    component?: string;
  };
};

type ErrorFallbackContext = DynamicModuleFallbackContext & {
  error: unknown;
  onRepeat: () => void;
  failTries: number;
  loading: boolean;
  attempts: number;
  support?: Support;
};
type Fallback<T extends object> = ReactNode | ((context: T) => ReactNode);
type LoadResult = { status: 'success' } | { status: 'error'; error: unknown };

type BaseProps = DynamicModuleFallbackContext & {
  support?: Support;
  /** Reports the outcome of a fresh load attempt. */
  onLoad?: (result: LoadResult) => void;
  fallbacks: {
    error: Exclude<Fallback<ErrorFallbackContext>, undefined>;
    placeholder?: Fallback<DynamicModuleFallbackContext>;
    loading?: Fallback<DynamicModuleFallbackContext>;
  };
};

type RenderProps<T extends RemoteComponent> = {
  children?: (Module: T) => ReactNode;
};

type ModuleComponent = ComponentType | LazyExoticComponent<ComponentType>;
type RemoteModule = { default: ComponentType };

const DEFAULT_MANIFEST = 'importmap.json';
const moduleCache = new Map<string, RemoteModule>();

function renderFallback<T extends object>(Fallback: Fallback<T>, context: T): ReactNode {
  return typeof Fallback === 'function' ? <Fallback {...context} /> : Fallback ?? null;
}

function getModuleId({ id, component }: BaseProps['remote']): string {
  const expose = component?.replace(/^\.\//, '');
  return !expose || expose === '.' ? id : `${id}/${expose}`;
}

async function fetchRemoteComponent(
  host: BaseProps['host'],
  remote: BaseProps['remote'],
  onLoad?: BaseProps['onLoad'],
): Promise<RemoteModule> {
  const moduleId = getModuleId(remote);
  const { id, manifest = DEFAULT_MANIFEST, path } = remote;

  try {
    const params = new URLSearchParams({ hostId: host.id, remoteId: id });
    const manifestPath = `${path}/${manifest}`;
    const entry = `${manifestPath}?${params}`;
    registerRemotes([{ name: id, entry }]);
  } catch (cause) {
    const error = new Error(`Не удалось зарегистрировать ${id}: ${String(cause)}`, { cause });
    onLoad?.({ status: 'error', error });

    throw error;
  }

  try {
    const loaded = await loadRemote<RemoteModule>(moduleId);

    if (!loaded?.default) throw new Error('default export не найден');

    onLoad?.({ status: 'success' });

    return loaded;
  } catch (cause) {
    const error = new Error(`Не удалось загрузить ${moduleId}: ${String(cause)}`, { cause });

    onLoad?.({ status: 'error', error });

    throw error;
  }
}

function loadModule({ host, remote, onLoad }: BoundaryProps) {
  const moduleId = getModuleId(remote);

  const cached = moduleCache.get(moduleId);

  if (cached) {
    return cached.default;
  }

  const Component = lazy(async () => {
    const pending = moduleCache.get(moduleId);

    if (pending) return pending;

    const request = await fetchRemoteComponent(host, remote, onLoad);

    moduleCache.set(moduleId, request);

    return request;
  });

  return Component;
}

export function DynamicModule(
  props: BaseProps & RenderProps<ComponentType>,
): ReactNode;
export function DynamicModule<T extends RemoteComponent>(
  props: BaseProps & RenderProps<T> & { children: (Module: T) => ReactNode },
): ReactNode;
export function DynamicModule<T extends RemoteComponent>({
  host,
  remote,
  support,
  fallbacks,
  onLoad,
  children,
}: BaseProps & RenderProps<T>): ReactNode {
  if (!remote.enabled) {
    const context = { host, remote };

    return (
      <Suspense fallback={renderFallback(fallbacks.loading, context)}>
        {renderFallback(fallbacks.placeholder, context)}
      </Suspense>
    );
  }

  return (
    <RemoteBoundary
      key={getModuleId(remote)}
      host={host}
      remote={remote}
      onLoad={onLoad}
      support={support}
      loading={fallbacks.loading}
      fallback={fallbacks.error}
    >
      {(Module) => typeof children === 'function' ? children(Module as unknown as T) : <Module />}
    </RemoteBoundary>
  );
}

type BoundaryProps = DynamicModuleFallbackContext & {
  onLoad?: BaseProps['onLoad'];
  support?: Support;
  loading?: BaseProps['fallbacks']['loading'];
  fallback: BaseProps['fallbacks']['error'];
  component?: ModuleComponent;
  children: (Module: ModuleComponent) => ReactNode;
};

type BoundaryState = {
  error: unknown;
  failTries: number;
  status: 'ready' | 'error' | 'retrying';
  attempts: number;
};

export class RemoteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {
    error: null,
    failTries: 0,
    status: 'ready',
    attempts: 1,
  };

  static getDerivedStateFromError(error: unknown): Pick<BoundaryState, 'error' | 'status'> {
    return { error, status: 'error' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState(({ failTries, attempts }) => failTries === attempts
      ? null
      : { failTries: failTries + 1 });

    const { host, remote } = this.props;
    console.error(`${host.name}: не удалось загрузить ${remote.name}`, error, info);
  }

  onRepeat = async () => {
    const { host, remote, onLoad } = this.props;

    this.setState(({ attempts }) => ({
      status: 'retrying',
      attempts: attempts + 1,
    }));

    const moduleId = getModuleId(remote);
    moduleCache.delete(moduleId);

    try {
      const loaded = await fetchRemoteComponent(host, remote, onLoad);
      moduleCache.set(moduleId, loaded);
      this.setState({ error: null, status: 'ready' });
    } catch (error) {
      this.setState(({ failTries }) => ({
        error,
        status: 'error',
        failTries: failTries + 1,
      }));
    }
  };

  render() {
    const { error, failTries, status, attempts } = this.state;
    const { host, remote, loading, component, children, fallback, support } = this.props;
    const context = { host, remote };

    const Module = loadModule(this.props);

    return (
      <Suspense fallback={renderFallback(loading, context)}>
        {typeof children === 'function'
          ? children(Module)
          : <Module />
        }
      </Suspense>
    );
  }
}

export function DefaultRemoteError({
  remote: { name },
  error,
  support,
}: { remote: { name: string }; error: unknown; support?: Support }) {
  return (
    <div className="host__error">
      <strong>{name} недоступен.</strong>
      <p>
        {support ? <a href={support.url}>{support.title}</a> : (
          <>Подними его dev-сервер: <code>npm run dev</code> в папке {name}</>
        )}
      </p>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

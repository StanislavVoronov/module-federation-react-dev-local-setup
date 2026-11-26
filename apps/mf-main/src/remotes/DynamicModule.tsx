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

type ModuleComponent = LazyExoticComponent<ComponentType>;
type RemoteModule = { default: ComponentType };

const DEFAULT_MANIFEST = 'importmap.json';
const NO_ERROR = Symbol('no error');
const moduleCache = new Map<string, Promise<RemoteModule>>();

function renderFallback<T extends object>(fallback: Fallback<T>, context: T): ReactNode {
  return typeof fallback === 'function' ? fallback(context) : fallback ?? null;
}

function getModuleId({ id, component }: BaseProps['remote']): string {
  const expose = component?.replace(/^\.\//, '');
  return !expose || expose === '.' ? id : `${id}/${expose}`;
}

function fetchRemoteComponent(
  host: BaseProps['host'],
  remote: BaseProps['remote'],
  onLoad?: BaseProps['onLoad'],
): Promise<RemoteModule> {
  const moduleId = getModuleId(remote);

  const request = (async () => {
    const { id, manifest = DEFAULT_MANIFEST, path } = remote;
    try {
      const params = new URLSearchParams({ hostId: host.id, remoteId: id });
      const manifestPath = `${path.replace(/\/+$/, '')}/${manifest.replace(/^\/+/, '')}`;
      const entry = `${manifestPath}?${params}`;
      registerRemotes([{ name: id, entry }]);
    } catch (cause) {
      const error = new Error(`Не удалось зарегистрировать ${id}: ${String(cause)}`, { cause });
      onLoad?.({ status: 'error', error });
      throw error;
    }

    let module: RemoteModule;
    try {
      const loaded = await loadRemote<RemoteModule>(moduleId);
      if (!loaded?.default) throw new Error('default export не найден');
      module = loaded;
    } catch (cause) {
      const error = new Error(`Не удалось загрузить ${moduleId}: ${String(cause)}`, { cause });
      onLoad?.({ status: 'error', error });
      throw error;
    }

    onLoad?.({ status: 'success' });
    return module;
  })();
  moduleCache.set(moduleId, request);
  void request.catch(() => { moduleCache.delete(moduleId); });
  return request;
}

function loadModule({ host, remote, onLoad }: LoadedBoundaryProps) {
  const moduleId = getModuleId(remote);

  const cached = moduleCache.get(moduleId);

  if (cached) {
    return cached
  }

  const Component = lazy(() => {
    return fetchRemoteComponent(host, remote, onLoad);
  });

  moduleCache.set(moduleId, Component as unknown as Promise<RemoteModule>)

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
  if (!remote.enabled) return renderFallback(fallbacks.placeholder, { host, remote });

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

type LoadedBoundaryProps = DynamicModuleFallbackContext & {
  onLoad?: BaseProps['onLoad'];
  support?: Support;
  loading?: BaseProps['fallbacks']['loading'];
  fallback: BaseProps['fallbacks']['error'];
  children: (Module: ModuleComponent) => ReactNode;
};

type BoundaryProps = LoadedBoundaryProps | {
  remote?: undefined;
  name: string;
  hostName?: string;
  fallback: (error: unknown, onRepeat: () => void, failTries: number) => ReactNode;
  children: ReactNode;
};

type BoundaryState = {
  error: unknown;
  failTries: number;
  failureCounted: boolean;
  component?: ModuleComponent;
  retryRequest?: Promise<RemoteModule>;
};

function RemoteContent({ component, children }: {
  component: ModuleComponent;
  children: LoadedBoundaryProps['children'];
}) {
  return children(component);
}

export class RemoteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {
    error: NO_ERROR,
    failTries: 0,
    failureCounted: false,
    component: this.props.remote ? loadModule(this.props) : undefined,
  };

  static getDerivedStateFromError(error: unknown): Pick<BoundaryState, 'error'> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState(({ failTries, failureCounted }) => failureCounted
      ? null
      : { failTries: failTries + 1, failureCounted: true });

    const props = this.props;
    const hostName = props.remote ? props.host.name : props.hostName ?? 'mf-host';
    const name = props.remote ? props.remote.name : props.name;
    console.error(`${hostName}: не удалось загрузить ${name}`, error, info);
  }

  onRepeat = async () => {
    const props = this.props;
    if (!props.remote || this.state.error === NO_ERROR) return;

    let request: Promise<RemoteModule> | undefined;
    try {
      request = moduleCache.get(getModuleId(props.remote));
      if (!request) request = fetchRemoteComponent(props.host, props.remote, props.onLoad);
      const component = loadModule(props);
      this.setState(({ retryRequest }) => retryRequest === request ? null : {
        error: NO_ERROR,
        failureCounted: false,
        component,
        retryRequest: request,
      });

      await request;
      this.setState(({ retryRequest }) => retryRequest === request ? { retryRequest: undefined } : null);
    } catch (error) {
      this.setState(({ retryRequest, failTries, failureCounted }) => request && retryRequest !== request
        ? null
        : {
          error,
          failTries: request && failureCounted ? failTries : failTries + 1,
          failureCounted: true,
          retryRequest: undefined,
        });
    }
  };

  render() {
    const { error, component: Component, failTries } = this.state;
    const props = this.props;
    if (!props.remote) {
      return error === NO_ERROR ? props.children : props.fallback(error, this.onRepeat, failTries);
    }

    const { host, remote, loading, children, fallback, support } = props;
    const context = { host, remote };
    if (error !== NO_ERROR) {
      return renderFallback(fallback, { ...context, error, onRepeat: this.onRepeat, failTries, support });
    }
    if (!Component) return null;

    return (
      <Suspense fallback={renderFallback(loading, context)}>
        <RemoteContent component={Component}>{children}</RemoteContent>
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

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

export type DynamicModuleFallbackContext = {
  host: { id: string; name: string };
  /** Federation container name. */
  id: string;
  name: string;
  supportUrl?: string;
  enabled: boolean;
  /** Manifest file relative to the remote path. Defaults to `importmap.json`. */
  manifest?: string;
  /** Public base path without a query, for example `/mf-remote-1`. */
  path: string;
  /** Key in `exposes`. Omit to load the root expose. */
  componentName?: string;
};

type ErrorFallbackContext = DynamicModuleFallbackContext & {
  error: unknown;
  onRepeat: () => void;
  failTries: number;
  isLoading: boolean;
};
type Fallback<T extends object> = ReactNode | ((context: T) => ReactNode);
type LoadResult = { status: 'success' } | { status: 'error'; error: unknown };

type BaseProps = Omit<DynamicModuleFallbackContext, 'host'> & {
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

const host = {
  id: import.meta.env.PUBLIC_FRONT_MODULE_ID,
  name: import.meta.env.PUBLIC_FRONT_MODULE_NAME,
};

const DEFAULT_MANIFEST = 'importmap.json';
const moduleCache = new Map<string, { default: ModuleComponent }>();

function renderFallback<T extends object>(Fallback: Fallback<T>, context: T): ReactNode {
  return typeof Fallback === 'function' ? <Fallback {...context} /> : Fallback ?? null;
}

function getModuleId({ id, componentName }: Pick<BaseProps, 'id' | 'componentName'>): string {
  const expose = componentName?.replace(/^\.\//, '');
  return !expose || expose === '.' ? id : `${id}/${expose}`;
}

async function fetchRemoteComponent({
  id,
  path,
  manifest = DEFAULT_MANIFEST,
  componentName,
  onLoad,
  force = false,
}: Pick<BaseProps, 'id' | 'path' | 'manifest' | 'componentName' | 'onLoad'> & { force?: boolean }): Promise<RemoteModule> {
  const moduleId = getModuleId({ id, componentName });

  try {
    const params = new URLSearchParams({ hostId: host.id, remoteId: id });
    const manifestPath = `${path}/${manifest}`;
    const entry = `${manifestPath}?${params}`;
    registerRemotes([{ name: id, entry }], { force });
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

function loadModule(props: BoundaryProps) {
  const moduleId = getModuleId(props);

  const cached = moduleCache.get(moduleId);

  if (cached) {
    return cached.default;
  }

  const Component = lazy(async () => {
    const request = await fetchRemoteComponent(props);

    moduleCache.set(moduleId, request);

    return request;
  });

  moduleCache.set(moduleId, { default: Component });
  return Component;
}

export function DynamicModule(
  props: BaseProps & RenderProps<ComponentType>,
): ReactNode;
export function DynamicModule<T extends RemoteComponent>(
  props: BaseProps & RenderProps<T> & { children: (Module: T) => ReactNode },
): ReactNode;
export function DynamicModule<T extends RemoteComponent>({
  fallbacks,
  onLoad,
  children,
  ...module
}: BaseProps & RenderProps<T>): ReactNode {
  if (!module.enabled) {
    const context = { host, ...module };

    return (
      <Suspense fallback={renderFallback(fallbacks.loading, context)}>
        {renderFallback(fallbacks.placeholder, context)}
      </Suspense>
    );
  }

  return (
    <RemoteBoundary
      key={getModuleId(module)}
      {...module}
      onLoad={onLoad}
      fallbacks={fallbacks}
    >
      {(Module) => typeof children === 'function' ? children(Module as unknown as T) : <Module />}
    </RemoteBoundary>
  );
}

type BoundaryProps = BaseProps & {
  children: (Module: ModuleComponent) => ReactNode;
};

type BoundaryState = {
  error: unknown;
  failTries: number;
  isLoading: boolean;
};

export class RemoteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {
    error: null,
    failTries: 0,
    isLoading: false,
  };

  static getDerivedStateFromError(error: unknown): Pick<BoundaryState, 'error'> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState(({ failTries }) => ({ failTries: failTries + 1 }));

    const { name } = this.props;
    console.error(`${host.name}: не удалось загрузить ${name}`, error, info);
  }

  onRepeat = async () => {
    this.setState({ isLoading: true });

    const moduleId = getModuleId(this.props);
    moduleCache.delete(moduleId);

    try {
      const loaded = await fetchRemoteComponent({ ...this.props, force: true });
      moduleCache.set(moduleId, loaded);
      this.setState({ error: null, isLoading: false });
    } catch (error) {
      this.setState(({ failTries }) => ({
        error,
        isLoading: false,
        failTries: failTries + 1,
      }));
    }
  };

  render() {
    const { error, failTries, isLoading } = this.state;
    const { fallbacks, children, onLoad, ...module } = this.props;
    const context = { host, ...module };
    const loading = renderFallback(fallbacks.loading, context);

    if (error !== null) {
      return (
        <Suspense fallback={loading}>
          {renderFallback(fallbacks.error, {
            ...context,
            error,
            onRepeat: this.onRepeat,
            failTries,
            isLoading,
          })}
        </Suspense>
      );
    }

    const Module = loadModule(this.props);

    return (
      <Suspense fallback={loading}>
        {typeof children === 'function' ? children(Module) : <Module />}
      </Suspense>
    );
  }
}

export function DefaultRemoteError({
  name,
  supportUrl,
  error,
}: Pick<BaseProps, 'name' | 'supportUrl'> & { error: unknown }) {
  return (
    <div className="host__error">
      <strong>{name} недоступен.</strong>
      <p>
        {supportUrl ? <a href={supportUrl}>{supportUrl}</a> : (
          <>Подними его dev-сервер: <code>npm run dev</code> в папке {name}</>
        )}
      </p>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

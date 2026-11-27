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
  /** Federation container name. */
  id: string;
  name: string;
  supportUrl?: string;
  enabled: boolean;
  /** Manifest file relative to the remote path. Defaults to `importmap.json`. */
  manifest?: string;
  /** Public base path without a query, for example `/mf-remote-1`. */
  publicPath: string;
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

type BaseProps = DynamicModuleFallbackContext & {
  /** Reports the outcome of a fresh load attempt. */
  onLoad?: (result: LoadResult) => void | Promise<void>;
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

const registeredPublicPaths = new Map<string, string>();

const DEFAULT_MANIFEST = 'importmap.json';
const moduleCache = new Map<string, { default: ModuleComponent; request?: Promise<RemoteModule> }>();

function renderFallback<T extends object>(Fallback: Fallback<T>, context: T): ReactNode {
  return typeof Fallback === 'function' ? <Fallback {...context} /> : Fallback ?? null;
}

function getModuleId({ id, componentName }: Pick<BaseProps, 'id' | 'componentName'>): string {
  const expose = componentName?.replace(/^\.\//, '');
  return !expose || expose === '.' ? id : `${id}/${expose}`;
}

function getCacheKey(props: Pick<BaseProps, 'id' | 'componentName' | 'publicPath'>): string {
  return `${props.publicPath}/${getModuleId(props)}`;
}

async function notifyLoad(onLoad: BaseProps['onLoad'], result: LoadResult): Promise<void> {
  try {
    await onLoad?.(result);
  } catch (error) {
    console.error('Ошибка в onLoad DynamicModule', error);
  }
}

function fetchRemoteComponent({
  id,
  publicPath,
  manifest = DEFAULT_MANIFEST,
  componentName,
  onLoad,
  force = false,
}: Pick<BaseProps, 'id' | 'publicPath' | 'manifest' | 'componentName' | 'onLoad'> & { force?: boolean }): Promise<RemoteModule> {
  const moduleId = getModuleId({ id, componentName });

  const cached = moduleCache.get(getCacheKey({ id, componentName, publicPath }));
  if (cached?.request) return cached.request;

  const request = Promise.resolve().then(async () => {
    try {
      const params = new URLSearchParams({ hostId: host.id, remoteId: id });
      const manifestPath = `${publicPath}/${manifest}`;
      const entry = `${manifestPath}?${params}`;
      const previousPath = registeredPublicPaths.get(id);
      registerRemotes([{ name: id, entry }], {
        force: force || (previousPath !== undefined && previousPath !== publicPath),
      });
      registeredPublicPaths.set(id, publicPath);
    } catch (cause) {
      const error = new Error(`Не удалось зарегистрировать ${id}: ${String(cause)}`, { cause });
      void notifyLoad(onLoad, { status: 'error', error });

      throw error;
    }

    try {
      const loaded = await loadRemote<RemoteModule>(moduleId);

      if (!loaded?.default) throw new Error('default export не найден');

      void notifyLoad(onLoad, { status: 'success' });

      return loaded;
    } catch (cause) {
      const error = new Error(`Не удалось загрузить ${moduleId}: ${String(cause)}`, { cause });

      void notifyLoad(onLoad, { status: 'error', error });

      throw error;
    }
  }).finally(() => {
    if (cached) delete cached.request;
  });

  if (cached) cached.request = request;
  return request;
}

function loadModule(props: BoundaryProps) {
  const cacheKey = getCacheKey(props);

  const cached = moduleCache.get(cacheKey);

  if (cached) {
    return cached.default;
  }

  const Component = lazy(() => fetchRemoteComponent(props));

  moduleCache.set(cacheKey, { default: Component });
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

    return (
      <Suspense fallback={renderFallback(fallbacks.loading, module)}>
        {renderFallback(fallbacks.placeholder, module)}
      </Suspense>
    );
  }

  return (
    <RemoteBoundary
      key={getCacheKey(module)}
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

  onRepeat = async (): Promise<void> => {
    if (this.state.isLoading) return;

    this.setState({ isLoading: true });
    const cacheKey = getCacheKey(this.props);

    try {
      const loaded = await fetchRemoteComponent({ ...this.props, force: true });
      moduleCache.set(cacheKey, loaded);
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
    const loading = renderFallback(fallbacks.loading, module);

    if (error !== null) {
      return (
        <Suspense fallback={loading}>
          {renderFallback(fallbacks.error, {
            ...module,
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

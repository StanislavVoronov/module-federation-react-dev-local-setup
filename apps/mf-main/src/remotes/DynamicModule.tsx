import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import { Component, lazy, Suspense } from 'react';
import type {
  ComponentType,
  ErrorInfo,
  ExoticComponent,
  LazyExoticComponent,
  ReactNode,
} from 'react';

export type DynamicModuleSource = {
  /** Federation container name. */
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  enabled?: boolean;
  /** Manifest file relative to the remote path. Defaults to `importmap.json`. */
  manifest?: string;
  /** Public base path without a query, for example `/mf-remote-1`. */
  publicPath: string;
  /** Key in `exposes`. Omit to load the root expose. */
  componentName?: string;
};

export type DynamicModuleFallbackContext<T = unknown> =
  { source: DynamicModuleSource } & Omit<Partial<T>, 'source'>;

type ErrorFallbackContext<T = unknown> = Omit<DynamicModuleFallbackContext<T>, 'error' | 'onRepeat' | 'failTries' | 'isLoading'> & {
  error: unknown;
  onRepeat: () => void;
  failTries: number;
  isLoading: boolean;
};
type Fallback<T extends Record<string, unknown>> = ReactNode | ((context: T) => ReactNode) | ExoticComponent<T>;
type LoadResult = { status: 'success' } | { status: 'error'; error: unknown };

type BaseProps<T = unknown> = DynamicModuleSource & {
  /** Reports the outcome of a fresh load attempt. */
  onLoad?: (result: LoadResult) => void | Promise<void>;
  fallbacks: {
    error: Exclude<Fallback<ErrorFallbackContext<T>>, undefined>;
    placeholder?: Fallback<DynamicModuleFallbackContext<T>>;
    loading?: Fallback<DynamicModuleFallbackContext<T>>;
  };
};

export type DynamicModuleProps<T = unknown> = Pick<BaseProps<NoInfer<T>>, 'fallbacks' | 'onLoad'> & {
  children?: never;
  source: DynamicModuleSource;
  context?: unknown extends T ? never : NoInfer<T>;
};

type ModuleComponent = ComponentType | LazyExoticComponent<ComponentType>;
type RemoteModule = { default: ComponentType };

const registeredPublicPaths = new Map<string, string>();

const DEFAULT_MANIFEST = 'importmap.json';
const EMPTY_CONTEXT: Record<string, unknown> = {};
const moduleCache = new Map<string, { default: ModuleComponent; request?: Promise<RemoteModule> }>();

function renderFallback<T extends Record<string, unknown>>(Fallback: Fallback<T>, context: T): ReactNode {
  if (typeof Fallback === 'function' || (
    Fallback && typeof Fallback === 'object' && '$$typeof' in Fallback &&
    (Fallback.$$typeof === Symbol.for('react.memo') || Fallback.$$typeof === Symbol.for('react.lazy') || Fallback.$$typeof === Symbol.for('react.forward_ref'))
  )) {
    const Component = Fallback as ComponentType<T>;
    return <Component {...context} />;
  }
  return (Fallback as ReactNode) ?? null;
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

type LoadOptions = { source: DynamicModuleSource } & Pick<BaseProps, 'onLoad'>;

function fetchRemoteComponent({
  source,
  onLoad,
  force = false,
}: LoadOptions & { force?: boolean }): Promise<RemoteModule> {
  const { hostId, id, publicPath, manifest = DEFAULT_MANIFEST } = source;
  const moduleId = getModuleId(source);

  const cached = moduleCache.get(getCacheKey(source));
  if (cached?.request) return cached.request;

  const request = Promise.resolve().then(async () => {
    try {
      const params = new URLSearchParams({ hostId, remoteId: id });
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

function loadModule({ source, onLoad }: LoadOptions) {
  const cacheKey = getCacheKey(source);

  const cached = moduleCache.get(cacheKey);

  if (cached) {
    return cached.default;
  }

  const Component = lazy(() => fetchRemoteComponent({ source, onLoad }));

  moduleCache.set(cacheKey, { default: Component });
  return Component;
}

export function DynamicModule<T = unknown>({
  source,
  context,
  fallbacks,
  onLoad,
}: DynamicModuleProps<T>): ReactNode {
  const moduleContext = (context ?? EMPTY_CONTEXT) as Record<string, unknown>;
  if (source.enabled === false) {
    const fallbackContext = { ...moduleContext, source } as DynamicModuleFallbackContext<T>;
    return (
      <Suspense fallback={renderFallback(fallbacks.loading, fallbackContext)}>
        {renderFallback(fallbacks.placeholder, fallbackContext)}
      </Suspense>
    );
  }

  return (
    <RemoteBoundary<T>
      key={getCacheKey(source)}
      source={source}
      context={context}
      onLoad={onLoad}
      fallbacks={fallbacks}
    />
  );
}

type BoundaryProps<T = unknown> = Pick<BaseProps<T>, 'fallbacks' | 'onLoad'> & {
  source: DynamicModuleSource;
  context?: T;
};

type BoundaryState = {
  error: unknown;
  failTries: number;
  isLoading: boolean;
};

export class RemoteBoundary<T = unknown> extends Component<BoundaryProps<T>, BoundaryState> {
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

    const { hostName, name } = this.props.source;
    console.error(`${hostName}: не удалось загрузить ${name}`, error, info);
  }

  onRepeat = async (): Promise<void> => {
    if (this.state.isLoading) return;

    this.setState({ isLoading: true });
    const cacheKey = getCacheKey(this.props.source);

    try {
      const loaded = await fetchRemoteComponent({ source: this.props.source, onLoad: this.props.onLoad, force: true });
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
    const { fallbacks, onLoad, context, source } = this.props;
    const moduleContext = (context ?? EMPTY_CONTEXT) as Record<string, unknown>;
    const fallbackContext = { ...moduleContext, source } as DynamicModuleFallbackContext<T>;
    const loading = renderFallback(fallbacks.loading, fallbackContext);

    if (error !== null) {
      return (
        <Suspense fallback={loading}>
          {renderFallback(fallbacks.error, {
            ...fallbackContext,
            error,
            onRepeat: this.onRepeat,
            failTries,
            isLoading,
          })}
        </Suspense>
      );
    }

    const Module = loadModule({ source, onLoad });

    return (
      <Suspense fallback={loading}>
        <Module {...moduleContext} />
      </Suspense>
    );
  }
}

export function DefaultRemoteError({
  source: { name },
  error,
}: { source: DynamicModuleSource; error: unknown }) {
  return (
    <div className="host__error">
      <strong>{name} недоступен.</strong>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

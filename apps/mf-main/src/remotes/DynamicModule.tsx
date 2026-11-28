import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import { generateSnapshotFromManifest, getResourceUrl } from '@module-federation/sdk';
import type { Manifest } from '@module-federation/sdk';
import { Component, lazy, Suspense } from 'react';
import type {
  ComponentType,
  ErrorInfo,
  ExoticComponent,
  LazyExoticComponent,
  ReactNode,
} from 'react';

type ModuleOptions = {
  host: { id: string; name: string };
  enabled?: boolean;
  /** Manifest file relative to publicPath. Defaults to `importmap.json`. */
  manifest?: string;
  /** Public base path without a query, for example `/mf-remote-1`. */
  publicPath: string;
  /** Key in `exposes`. Omit to load the root expose. */
  component?: string;
};

export type DynamicModuleFallbackContext<T = unknown> = Partial<T>;

type ErrorFallbackContext<T = unknown> = Omit<DynamicModuleFallbackContext<T>, 'error' | 'onRepeat' | 'failTries' | 'isLoading'> & {
  error: unknown;
  onRepeat: () => void;
  failTries: number;
  isLoading: boolean;
};
type Fallback<T extends Record<string, unknown>> = ReactNode | ((context: T) => ReactNode) | ExoticComponent<T>;
type LoadResult = { status: 'success' } | { status: 'error'; error: unknown };

type BaseProps<T = unknown> = ModuleOptions & {
  /** Reports the outcome of a fresh load attempt. */
  onLoad?: (result: LoadResult) => void | Promise<void>;
  fallbacks: {
    error: Exclude<Fallback<ErrorFallbackContext<T>>, undefined>;
    placeholder?: Fallback<DynamicModuleFallbackContext<T>>;
    loading?: Fallback<DynamicModuleFallbackContext<T>>;
  };
};

export type DynamicModuleProps<T = unknown> = BaseProps<NoInfer<T>> & {
  children?: never;
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

function getModuleId(name: string, component?: string): string {
  const expose = component?.replace(/^\.\//, '');
  return !expose || expose === '.' ? name : `${name}/${expose}`;
}

function getCacheKey({ publicPath, component }: Pick<ModuleOptions, 'component' | 'publicPath'>): string {
  return getModuleId(publicPath, component);
}

async function notifyLoad(onLoad: BaseProps['onLoad'], result: LoadResult): Promise<void> {
  try {
    await onLoad?.(result);
  } catch (error) {
    console.error('Ошибка в onLoad DynamicModule', error);
  }
}

type LoadOptions = ModuleOptions & Pick<BaseProps, 'onLoad'>;

function fetchRemoteComponent({
  host,
  publicPath,
  component,
  manifest = DEFAULT_MANIFEST,
  onLoad,
  force = false,
}: LoadOptions & { force?: boolean }): Promise<RemoteModule> {
  const cached = moduleCache.get(getCacheKey({ publicPath, component }));
  if (cached?.request) return cached.request;

  const request = Promise.resolve().then(async () => {
    const params = new URLSearchParams({ hostId: host.id });
    const manifestUrl = `${publicPath}/${manifest}?${params}`;
    let remoteManifest: Manifest;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Таймаут загрузки манифеста: 30 секунд')), 30_000);
    try {
      const response = await fetch(manifestUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      remoteManifest = await response.json();
      if (!remoteManifest?.id || !remoteManifest.name) {
        throw new Error('manifest.id и manifest.name должны быть заданы');
      }
    } catch (cause) {
      const error = new Error(`Не удалось загрузить манифест ${manifestUrl}: ${String(cause)}`, { cause });
      void notifyLoad(onLoad, { status: 'error', error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const moduleId = getModuleId(remoteManifest.name, component);
    try {
      const snapshot = generateSnapshotFromManifest(remoteManifest, { version: manifestUrl });
      const entry = getResourceUrl(snapshot, snapshot.remoteEntry);
      const previousPath = registeredPublicPaths.get(remoteManifest.name);
      registerRemotes([{
        name: remoteManifest.name,
        entry,
        type: snapshot.remoteEntryType,
        entryGlobalName: snapshot.globalName,
      }], {
        force: force || (previousPath !== undefined && previousPath !== publicPath),
      });
      registeredPublicPaths.set(remoteManifest.name, publicPath);
    } catch (cause) {
      const error = new Error(`Не удалось зарегистрировать ${remoteManifest.name}: ${String(cause)}`, { cause });
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

function loadModule(options: LoadOptions) {
  const cacheKey = getCacheKey(options);
  const cached = moduleCache.get(cacheKey);
  if (cached) return cached.default;

  const Component = lazy(() => fetchRemoteComponent(options));
  moduleCache.set(cacheKey, { default: Component });
  return Component;
}

export function DynamicModule<T = unknown>({
  context,
  fallbacks,
  ...options
}: DynamicModuleProps<T>): ReactNode {
  const moduleContext = (context ?? EMPTY_CONTEXT) as Record<string, unknown>;
  if (options.enabled === false) {
    const fallbackContext = moduleContext as DynamicModuleFallbackContext<T>;
    return (
      <Suspense fallback={renderFallback(fallbacks.loading, fallbackContext)}>
        {renderFallback(fallbacks.placeholder, fallbackContext)}
      </Suspense>
    );
  }

  return (
    <RemoteBoundary<T>
      key={getCacheKey(options)}
      {...options}
      context={context}
      fallbacks={fallbacks}
    />
  );
}

type BoundaryProps<T = unknown> = BaseProps<T> & {
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

    const { host, publicPath } = this.props;
    console.error(`${host.name}: не удалось загрузить ${publicPath}`, error, info);
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
    const { fallbacks, context } = this.props;
    const moduleContext = (context ?? EMPTY_CONTEXT) as Record<string, unknown>;
    const fallbackContext = moduleContext as DynamicModuleFallbackContext<T>;
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

    const Module = loadModule(this.props);

    return (
      <Suspense fallback={loading}>
        <Module {...moduleContext} />
      </Suspense>
    );
  }
}

export function DefaultRemoteError({
  error,
}: { error: unknown }) {
  return (
    <div className="host__error">
      <strong>Модуль недоступен.</strong>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

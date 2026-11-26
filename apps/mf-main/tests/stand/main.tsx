import { init } from '@module-federation/enhanced/runtime';
import * as React from 'react';
import { lazy, useState } from 'react';
import type { ComponentType, ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicModule, RemoteBoundary } from '../../src/remotes/DynamicModule';
import type { DynamicModuleFallbackContext } from '../../src/remotes/DynamicModule';
import '../../src/index.css';

type Scenario = Omit<DynamicModuleFallbackContext['remote'], 'id' | 'path' | 'enabled'> & { enabled?: boolean };

const cases = {
  default: { name: 'Root expose и кеш' },
  named: { name: 'Named expose и children', manifest: 'custom-manifest.json', component: './Widget' },
  disabled: { name: 'Выключенный remote', enabled: false },
  'slow-placeholder': { name: 'Медленный placeholder', enabled: false },
  slow: { name: 'Медленный remote' },
  silent: { name: 'Без loading' },
  register: { name: 'Ошибка регистрации' },
  'slow-error': { name: 'Медленный error fallback' },
  missing: { name: 'Нет default export', component: './MissingDefault' },
  retry: { name: 'Ошибка загрузки и повтор' },
  'render-error': { name: 'Ошибка рендера', component: './BrokenNote' },
  preset: { name: 'Готовый компонент', component: './Widget' },
} satisfies Record<string, Scenario>;

type Case = keyof typeof cases;
type StandProps = ComponentProps<typeof RemoteBoundary>;
type EventStatus = Parameters<NonNullable<StandProps['onLoad']>>[0]['status'];

function getCase(): Case {
  const key = new URLSearchParams(location.search).get('case');
  return key && Object.hasOwn(cases, key) ? key as Case : 'default';
}

const host = { id: 'dynamic_module_test', name: 'Стенд' };
const remoteId = 'stand_notes';
const scenario = getCase();
let initialRetryFailed = false;
let keepRetryFailure = false;
let releaseRequest: (() => void) | undefined;
const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });

init({
  name: host.id,
  remotes: [],
  shared: { react: { version: React.version, lib: () => React, shareConfig: { singleton: true, requiredVersion: false } } },
  plugins: [{
    name: 'dynamic-module-fixtures',
    beforeRegisterRemote(args) {
      if (args.remote.name === remoteId && (scenario === 'register' || scenario === 'slow-error')) {
        throw new Error('Регистрация отклонена стендом');
      }
      return args;
    },
    async beforeRequest(args) {
      if (args.id !== remoteId) return args;
      if (scenario === 'retry' && (!initialRetryFailed || keepRetryFailure)) {
        initialRetryFailed = true;
        throw new Error('Remote недоступен');
      }
      if (scenario === 'slow' || scenario === 'silent') await requestGate;
      return args;
    },
  }],
});

function Placeholder({ remote }: DynamicModuleFallbackContext) {
  return <p>{remote.name} выключен</p>;
}

function ErrorFallback({ error, failTries, isLoading, onRepeat, support }: {
  error: unknown;
  failTries: number;
  isLoading: boolean;
  onRepeat: () => void;
  support?: StandProps['support'];
}) {
  return (
    <div className="host__error" role="alert">
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
      <p>Неудачных попыток: {failTries}</p>
      {support && <a href={support.url}>{support.title}</a>}
      <button className="host__retry" type="button" onClick={onRepeat} disabled={isLoading}>
        {isLoading ? 'Повторная загрузка…' : 'Повторить'}
      </button>
    </div>
  );
}

const SlowPlaceholder = lazy(async () => {
  await requestGate;
  return { default: Placeholder };
});

const SlowError = lazy(async () => {
  await requestGate;
  return { default: ErrorFallback };
});

function Stand() {
  const { enabled = true, ...options }: Scenario = cases[scenario];
  const [mount, setMount] = useState(0);
  const [events, setEvents] = useState<EventStatus[]>([]);
  const remote = { id: remoteId, enabled, path: `/fixtures/${remoteId}`, ...options };
  const props: Omit<StandProps, 'children'> = {
    host,
    remote,
    fallbacks: {
      error: scenario === 'slow-error' ? (props) => <SlowError {...props} /> : ErrorFallback,
      loading: scenario === 'silent' ? undefined : ({ remote }) => <p role="status">Загружаю {remote.name}…</p>,
      placeholder: scenario === 'slow-placeholder' ? <SlowPlaceholder host={host} remote={remote} /> : Placeholder,
    },
    support: { url: '#support', title: 'Поддержка' },
    onLoad: ({ status }) => setEvents((previous) => [...previous, status]),
  };

  return (
    <main className="host">
      <h1>Стенд DynamicModule</h1>
      <label>
        Сценарий{' '}
        <select value={scenario} onChange={(event) => { location.search = `?case=${event.target.value}`; }}>
          {Object.entries(cases).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}
        </select>
      </label>
      <div className="host__nav">
        <button type="button" onClick={() => setMount((value) => value + 1)}>Перемонтировать модуль</button>
        {scenario === 'retry' && (
          <label>
            <input type="checkbox" onChange={(event) => { keepRetryFailure = event.target.checked; }} />
            Сохранять сбой
          </label>
        )}
        {['slow', 'silent', 'slow-placeholder', 'slow-error'].includes(scenario) && (
          <button type="button" onClick={releaseRequest}>Продолжить загрузку</button>
        )}
      </div>
      <h2>Модуль</h2>
      <section data-testid="module" aria-label="Результат">
        {scenario === 'named' ? (
          <DynamicModule<ComponentType<{ title: string }>> key={mount} {...props}>
            {(Module) => <Module title="Черновик заметки" />}
          </DynamicModule>
        ) : (
          <DynamicModule key={mount} {...props} />
        )}
      </section>
      <h2>Вызовы onLoad</h2>
      <ol data-testid="load-events">
        {events.map((status, index) => <li key={index}>{status}</li>)}
      </ol>
      <p id="support">Поддержка стенда</p>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Stand />);

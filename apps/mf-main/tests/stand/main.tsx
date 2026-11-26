import { init } from '@module-federation/enhanced/runtime';
import * as React from 'react';
import { lazy, useState } from 'react';
import type { ComponentType, ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicModule, RemoteBoundary } from '../../src/remotes/DynamicModule';
import type { DynamicModuleFallbackContext } from '../../src/remotes/DynamicModule';
import '../../src/index.css';

type Scenario = Omit<DynamicModuleFallbackContext, 'id' | 'publicPath' | 'enabled'> & { enabled?: boolean };

const cases = {
  tabs: { name: 'Пять модулей во вкладках' },
  default: { name: 'Root expose и кеш' },
  rerender: { name: 'Сохранение состояния при ререндере' },
  named: { name: 'Named expose и children', manifest: 'custom-manifest.json', componentName: './Widget' },
  disabled: { name: 'Выключенный remote', enabled: false },
  'slow-placeholder': { name: 'Медленный placeholder', enabled: false },
  slow: { name: 'Медленный remote' },
  silent: { name: 'Без loading' },
  register: { name: 'Ошибка регистрации' },
  'slow-error': { name: 'Медленный error fallback' },
  missing: { name: 'Нет default export', componentName: './MissingDefault' },
  retry: { name: 'Ошибка загрузки и повтор' },
  'retry-delayed': { name: 'Ошибка → повтор → успех через 5 секунд' },
  'render-error': { name: 'Ошибка рендера', componentName: './BrokenNote' },
  preset: { name: 'Готовый компонент', componentName: './Widget' },
} satisfies Record<string, Scenario>;

type Case = keyof typeof cases;
type StandProps = ComponentProps<typeof RemoteBoundary>;
type EventStatus = Parameters<NonNullable<StandProps['onLoad']>>[0]['status'];

function getCase(): Case {
  const key = new URLSearchParams(location.search).get('case');
  return key && Object.hasOwn(cases, key) ? key as Case : 'tabs';
}

const host = { id: import.meta.env.PUBLIC_FRONT_MODULE_ID, name: import.meta.env.PUBLIC_FRONT_MODULE_NAME };
const remoteId = 'stand_notes';
const scenario = getCase();
let initialRetryFailed = false;
let registrationFailed = false;
let remoteLoadFailed = false;
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
      if (args.remote.name === 'stand_registration_error' && !registrationFailed) {
        registrationFailed = true;
        throw new Error('Тестовая ошибка регистрации');
      }
      if (args.remote.name === remoteId && (scenario === 'register' || scenario === 'slow-error')) {
        throw new Error('Регистрация отклонена стендом');
      }
      return args;
    },
    createScript({ url }) {
      const address = new URL(url, location.origin);
      if (address.pathname === '/fixtures/stand_load_error/remoteEntry.js' && !remoteLoadFailed) {
        remoteLoadFailed = true;
        address.searchParams.set('failLoad', '1');
        const script = document.createElement('script');
        script.src = address.href;
        return script;
      }
    },
    async beforeRequest(args) {
      const tabDelays: Record<string, number> = {
        ['stand_tasks/Tasks']: 2000,
        ['stand_calculator/Calculator']: 3000,
        ['stand_preferences/Preferences']: 4000,
      };
      if (scenario === 'tabs' && tabDelays[args.id]) {
        await new Promise((resolve) => setTimeout(resolve, tabDelays[args.id]));
      }
      if (args.id !== remoteId) return args;
      if ((scenario === 'retry' || scenario === 'retry-delayed') && (!initialRetryFailed || keepRetryFailure)) {
        initialRetryFailed = true;
        throw new Error('Remote недоступен');
      }
      if (scenario === 'retry-delayed') await new Promise((resolve) => setTimeout(resolve, 5000));
      if (scenario === 'slow' || scenario === 'silent') await requestGate;
      return args;
    },
  }],
});

function Placeholder({ name }: DynamicModuleFallbackContext) {
  return <p>{name} выключен</p>;
}

function ErrorFallback({ error, failTries, isLoading, onRepeat, supportUrl }: {
  error: unknown;
  failTries: number;
  isLoading: boolean;
  onRepeat: () => void;
  supportUrl?: string;
}) {
  return (
    <div className="host__error" role="alert">
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
      <p>Неудачных попыток: {failTries}</p>
      {isLoading && <p role="status">Загружаю модуль повторно…</p>}
      {supportUrl && <a href={supportUrl}>{supportUrl}</a>}
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
  const [renderCount, setRenderCount] = useState(0);
  const [events, setEvents] = useState<EventStatus[]>([]);
  const [tab, setTab] = useState('Widget');
  const [placeholderEnabled, setPlaceholderEnabled] = useState(false);
  const tabs = [
    { id: 'stand_notes', componentName: 'Widget', name: 'Заметка' },
    { id: 'stand_counter', componentName: 'Counter', name: 'Счётчик' },
    { id: 'stand_tasks', componentName: 'Tasks', name: 'Задачи' },
    { id: 'stand_calculator', componentName: 'Calculator', name: 'Калькулятор' },
    { id: 'stand_preferences', componentName: 'Preferences', name: 'Настройки' },
    { id: 'stand_registration_error', componentName: 'RegistrationError', name: 'Ошибка регистрации' },
    { id: 'stand_load_error', componentName: 'LoadError', name: 'Ошибка загрузки remote' },
    { id: 'stand_placeholder', componentName: 'Placeholder', name: 'Placeholder' },
  ];
  const activeTab = tabs.find((item) => item.componentName === tab)!;
  const config = { supportUrl: '#support', id: remoteId, enabled, publicPath: `/fixtures/${remoteId}`, ...options };
  const props: Omit<StandProps, 'children'> = {
    ...config,
    fallbacks: {
      error: scenario === 'slow-error' ? (props) => <SlowError {...props} /> : ErrorFallback,
      loading: scenario === 'silent' ? undefined : ({ name }) => <p role="status">Загружаю {name}…</p>,
      placeholder: scenario === 'slow-placeholder' ? <SlowPlaceholder {...config} /> : Placeholder,
    },
    onLoad: scenario === 'rerender' ? undefined : ({ status }) => setEvents((previous) => [...previous, status]),
  };

  return (
    <main className="host" data-load-events={JSON.stringify(events)}>
      <h1>Стенд DynamicModule</h1>
      <div className="host__nav">
        <button type="button" onClick={() => setMount((value) => value + 1)}>Перемонтировать модуль</button>
        {scenario === 'rerender' && (
          <button type="button" onClick={() => setRenderCount((value) => value + 1)}>Обновить родителя ({renderCount})</button>
        )}
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
      {scenario === 'tabs' && (
        <div className="host__nav" role="tablist" aria-label="Модули">
          {tabs.map((item) => (
            <button key={item.componentName} role="tab" id={`tab-${item.componentName}`} aria-controls="module-panel" aria-selected={tab === item.componentName}
              className={`host__nav-link${tab === item.componentName ? ' host__nav-link--active' : ''}`}
              onClick={() => setTab(item.componentName)}>{item.name}</button>
          ))}
        </div>
      )}
      <section data-testid="module" aria-label="Результат">
        {scenario === 'tabs' ? (
          <div role="tabpanel" id="module-panel" aria-labelledby={`tab-${tab}`} style={{ marginTop: 16 }}>
            {tab === 'Placeholder' && (
              <p><button onClick={() => setPlaceholderEnabled((value) => !value)}>
                {placeholderEnabled ? 'Выключить модуль' : 'Включить модуль'}
              </button></p>
            )}
            <DynamicModule key={mount} {...props}
              {...activeTab}
              publicPath={`/fixtures/${activeTab.id}`}
              enabled={tab !== 'Placeholder' || placeholderEnabled}
            />
          </div>
        ) : scenario === 'named' ? (
          <DynamicModule<ComponentType<{ title: string }>> key={mount} {...props}>
            {(Module) => <Module title="Черновик заметки" />}
          </DynamicModule>
        ) : (
          <DynamicModule key={mount} {...props} />
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Stand />);

import { init } from '@module-federation/enhanced/runtime';
import * as React from 'react';
import { lazy, memo, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicModule } from '../../src/remotes/DynamicModule';
import type { DynamicModuleSource, DynamicModuleFallbackContext, DynamicModuleProps } from '../../src/remotes/DynamicModule';
import '../../src/index.css';

type Scenario = Omit<DynamicModuleSource, 'hostId' | 'hostName' | 'id' | 'publicPath' | 'enabled'> & { enabled?: boolean };

const cases = {
  tabs: { name: 'Пять модулей во вкладках' },
  default: { name: 'Root expose и кеш' },
  rerender: { name: 'Сохранение состояния при ререндере' },
  'public-path': { name: 'Смена publicPath' },
  'onload-error': { name: 'Ошибка обработчика onLoad' },
  'fallback-context': { name: 'Контекст fallback-компонентов' },
  context: { name: 'Контекст и обработчики' },
  named: { name: 'Named expose и context', manifest: 'custom-manifest.json', componentName: './Widget' },
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
type StandProps = DynamicModuleProps;
type EventStatus = Parameters<NonNullable<StandProps['onLoad']>>[0]['status'];

function getCase(): Case {
  const key = new URLSearchParams(location.search).get('case');
  return key && Object.hasOwn(cases, key) ? key as Case : 'tabs';
}

const host = { id: import.meta.env.PUBLIC_FRONT_MODULE_ID, name: import.meta.env.PUBLIC_FRONT_MODULE_NAME };
const id = 'stand_notes';
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
      if (args.remote.name === id && (scenario === 'register' || scenario === 'slow-error')) {
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
      if (args.id !== id) return args;
      if ((scenario === 'retry' || scenario === 'retry-delayed') && (!initialRetryFailed || keepRetryFailure)) {
        initialRetryFailed = true;
        throw new Error('Remote недоступен');
      }
      if (scenario === 'retry-delayed') await new Promise((resolve) => setTimeout(resolve, 5000));
      if (scenario === 'slow' || scenario === 'silent' || scenario === 'fallback-context') await requestGate;
      return args;
    },
  }],
});

function Placeholder({ source: { name } }: DynamicModuleFallbackContext) {
  return <p>{name} выключен</p>;
}

function ErrorFallback({ error, failTries, isLoading, onRepeat }: {
  error: unknown;
  failTries: number;
  isLoading: boolean;
  onRepeat: () => void;
  source: DynamicModuleSource;
}) {
  return (
    <div className="host__error" role="alert">
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
      <p>Неудачных попыток: {failTries}</p>
      {isLoading && <p role="status">Загружаю модуль повторно…</p>}
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

type ProbeContext = { label: string; onAction: () => void };
const fallbackRenders: Record<string, number> = {};
const FallbackProbe = memo(function FallbackProbe(props: DynamicModuleFallbackContext<ProbeContext> & { failTries?: number }) {
  const { source: { name }, label, onAction, failTries } = props;
  fallbackRenders[name] = (fallbackRenders[name] ?? 0) + 1;
  return (
    <section aria-label={name} data-props={Object.keys(props).sort().join(",")}>
      <span data-testid={`${name}-label`}>{label}</span>
      <output data-testid={`${name}-renders`}>{fallbackRenders[name]}</output>
      <output data-testid={`${name}-failures`}>{failTries}</output>
      <button onClick={onAction}>Действие</button>
    </section>
  );
});

const fallbackProbeSources: DynamicModuleSource[] = ['loading', 'error', 'placeholder'].map((name) => ({
  hostId: host.id, hostName: host.name, id, name, publicPath: `/fixtures/${id}`, enabled: name !== 'placeholder', componentName: name === 'error' ? 'MissingDefault' : undefined,
}));

function FallbackContextStand() {
  const [parentRender, setParentRender] = useState(0);
  const [label, setLabel] = useState('Первое значение');
  const [handlerVersion, setHandlerVersion] = useState(0);
  const [lastAction, setLastAction] = useState('');
  const onAction = useCallback(() => setLastAction(String(handlerVersion)), [handlerVersion]);
  return (
    <main>
      <button onClick={() => setParentRender((value) => value + 1)}>Ререндер родителя</button>
      <output data-testid="parent-render">{parentRender}</output>
      <button onClick={() => setLabel('Новое значение')}>Изменить контекст</button>
      <button onClick={() => setHandlerVersion((value) => value + 1)}>Изменить обработчик</button>
      <output data-testid="last-action">{lastAction}</output>
      {fallbackProbeSources.map((source) => (
        <DynamicModule<ProbeContext>
          key={source.name}
          source={source}
          context={{ label, onAction }}
          fallbacks={{ loading: FallbackProbe, error: FallbackProbe, placeholder: FallbackProbe }}
        />
      ))}
    </main>
  );
}

function Stand() {
  const { enabled = true, ...options }: Scenario = cases[scenario];
  const [mount, setMount] = useState(0);
  const [publicPath, setPublicPath] = useState(`/fixtures/${id}`);
  const [renderCount, setRenderCount] = useState(0);
  const [events, setEvents] = useState<EventStatus[]>([]);
  const [messages, setMessages] = useState(['', '']);
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
  const source = { hostId: host.id, hostName: host.name, id, enabled, publicPath, ...options };
  const props: StandProps = {
    source,
    fallbacks: {
      error: scenario === 'slow-error' ? (props) => <SlowError {...props} /> : ErrorFallback,
      loading: scenario === 'silent' ? undefined : ({ source }) => <p role="status">Загружаю {source.name}…</p>,
      placeholder: scenario === 'slow-placeholder' ? <SlowPlaceholder source={source} /> : Placeholder,
    },
    onLoad: scenario === 'rerender' ? undefined : ({ status }) => {
      setEvents((previous) => [...previous, status]);
      if (scenario === 'onload-error') throw new Error('Ошибка обработчика onLoad');
    },
  };

  return (
    <main className="host" data-load-events={JSON.stringify(events)}>
      <h1>Стенд DynamicModule</h1>
      <div className="host__nav">
        <button type="button" onClick={() => setMount((value) => value + 1)}>Перемонтировать модуль</button>
        {scenario === 'public-path' && (
          <>
            <button onClick={() => setPublicPath('/fixtures/stand_notes_alt')}>Другой адрес</button>
            <button onClick={() => setPublicPath('/fixtures/unavailable')}>Недоступный адрес</button>
            <button onClick={() => setPublicPath(`/fixtures/${id}`)}>Исходный адрес</button>
          </>
        )}
        {(scenario === 'rerender' || scenario === 'context') && (
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
              source={{ ...source, ...activeTab, publicPath: `/fixtures/${activeTab.id}`, enabled: tab !== 'Placeholder' || placeholderEnabled }}
            />
          </div>
        ) : scenario === 'context' ? (
          <>
            {[0, 1].map((index) => (
              <section key={index} data-testid={`context-${index}`}>
                <DynamicModule<{ title: string; onChange: (value: string) => void }>
                  {...props}
                  context={{
                    title: `Заметка ${index + 1}, версия ${renderCount}`,
                    onChange: (value) => setMessages((previous) => previous.map((message, item) => item === index ? `${renderCount}:${value}` : message)),
                  }}
                />
                <output data-testid={`message-${index}`}>{messages[index]}</output>
              </section>
            ))}
          </>
        ) : scenario === 'named' ? (
          <DynamicModule<{ title: string }> key={mount} {...props} context={{ title: 'Черновик заметки' }} />
        ) : (
          <DynamicModule key={mount} {...props} />
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(scenario === 'fallback-context' ? <FallbackContextStand /> : <Stand />);

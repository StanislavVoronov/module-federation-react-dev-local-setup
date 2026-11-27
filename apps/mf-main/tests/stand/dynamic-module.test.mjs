import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRsbuild, loadConfig } from '@rsbuild/core';
import { chromium } from 'playwright';

let server;
let browser;
let context;
let page;
let origin;

before(async () => {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const config = await loadConfig({ cwd, path: 'tests/stand/rsbuild.config.mjs' });
  assert.ok(config.filePath, 'конфигурация стенда существует');
  const rsbuild = await createRsbuild({
    cwd,
    config: { ...config.content, server: { ...config.content.server, port: 0, printUrls: false } },
  });
  server = await rsbuild.startDevServer();
  const address = server.server.httpServer.address();
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
});

after(async () => {
  await browser?.close();
  await server?.server.close();
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(5000);
});

afterEach(async () => {
  await context?.close();
});

function open(scenario) {
  return page.goto(`${origin}/?case=${scenario}`);
}

function events() {
  return page.locator('main').evaluate((element) => JSON.parse(element.dataset.loadEvents));
}

test('загружает root expose по importmap.json и использует кеш после перемонтирования', async () => {
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/fixtures/')) requests.push(`${url.pathname}${url.search}`);
  });

  await open('default');
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.deepEqual(await events(), ['success']);
  assert.ok(requests.includes('/fixtures/stand_notes/importmap.json?hostId=dynamic_module_test&remoteId=stand_notes'));
  const requestCount = requests.length;

  await page.getByRole('button', { name: 'Перемонтировать модуль' }).click();
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.equal(requests.length, requestCount);
  assert.deepEqual(await events(), ['success']);
});

test('передаёт типизированный context в named expose из указанного манифеста', async () => {
  const request = page.waitForRequest((item) => new URL(item.url()).pathname === '/fixtures/stand_notes/custom-manifest.json');
  await open('named');
  await request;
  await page.getByRole('heading', { name: 'Черновик заметки' }).waitFor();
  assert.deepEqual(await events(), ['success']);
});

test('remote показывает цветную карточку с текстом и принимает ввод заметки', async () => {
  const scripts = [];
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    if (response.ok() && pathname.startsWith('/fixtures/') && pathname.endsWith('.js')) {
      scripts.push(pathname);
    }
  });
  await open('default');
  const card = page.getByRole('region', { name: 'Заметка', exact: true });
  await card.waitFor();
  await card.getByText('Запишите короткую мысль или идею.').waitFor();
  assert.equal(await card.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(245, 243, 255)');

  const input = card.getByRole('textbox', { name: 'Текст заметки' });
  await input.fill('Проверить загрузку');
  assert.equal(await input.inputValue(), 'Проверить загрузку');
  assert.ok(scripts.some((url) => url.endsWith('/remoteEntry.js')), `Контейнер отсутствует: ${scripts}`);
  assert.ok(scripts.some((url) => url.includes('__federation_expose_')), `Чанк компонента отсутствует: ${scripts}`);
});

test('выключенный remote показывает placeholder и не вызывает onLoad', async () => {
  const requests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/fixtures/')) requests.push(request.url());
  });
  await open('disabled');
  await page.getByText('Выключенный remote выключен', { exact: true }).waitFor();
  assert.deepEqual(requests, []);
  assert.deepEqual(await events(), []);
});

test('показывает loading до получения модуля', async () => {
  await open('slow');
  await page.getByText('Загружаю Медленный remote…').waitFor();
  assert.deepEqual(await events(), []);
  await page.getByRole('button', { name: 'Продолжить загрузку' }).click();
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.deepEqual(await events(), ['success']);
});

test('без loading показывает пустую область до получения модуля', async () => {
  await open('silent');
  assert.equal(await page.getByTestId('module').textContent(), '');
  assert.deepEqual(await events(), []);
  await page.getByRole('button', { name: 'Продолжить загрузку' }).click();
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
});

test('ленивый placeholder работает внутри Suspense', async () => {
  await open('slow-placeholder');
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'Продолжить загрузку' }).click();
  await page.getByText('Медленный placeholder выключен', { exact: true }).waitFor();
  assert.deepEqual(await events(), []);
});

test('ленивый error fallback работает внутри Suspense', async () => {
  await open('slow-error');
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'Продолжить загрузку' }).click();
  await page.getByText(/Не удалось зарегистрировать stand_notes/).waitFor();
  assert.deepEqual(await events(), ['error']);
});

test('отдельно сообщает об ошибке регистрации', async () => {
  await open('register');
  await page.getByText(/Не удалось зарегистрировать stand_notes/).waitFor();
  assert.deepEqual(await events(), ['error']);
  assert.equal(await page.getByRole('link').count(), 0);
});

test('отсутствующий default export показывает ошибку загрузки', async () => {
  await open('missing');
  await page.getByText(/default export не найден/).waitFor();
  assert.deepEqual(await events(), ['error']);
});

test('повтор загружает remoteEntry заново после сетевой ошибки', async () => {
  let requests = 0;
  await page.route('**/fixtures/stand_notes/**/remoteEntry.js', (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, body: 'Remote unavailable' });
    return route.continue();
  });

  await open('default');
  await page.getByText('Неудачных попыток: 1').waitFor();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.equal(requests, 2);
  assert.deepEqual(await events(), ['error', 'success']);
});

test('сценарий повтора восстанавливает модуль одним нажатием', async () => {
  await open('retry');
  await page.getByText('Неудачных попыток: 1').waitFor();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.deepEqual(await events(), ['error', 'success']);
});

test('retry считает только сбои и показывает isLoading во время успешного повтора', async () => {
  let releaseRequest;
  const holdRequest = new Promise((resolve) => { releaseRequest = resolve; });
  await page.route('**/fixtures/stand_notes/**/remoteEntry.js', async (route) => {
    await holdRequest;
    await route.continue();
  });

  await open('retry');
  const retry = page.getByRole('button', { name: 'Повторить' });
  const keepFailure = page.getByRole('checkbox', { name: 'Сохранять сбой' });
  await page.getByText('Неудачных попыток: 1').waitFor();
  await keepFailure.check();
  await retry.click();
  await page.getByText('Неудачных попыток: 2').waitFor();
  assert.deepEqual(await events(), ['error', 'error']);

  await keepFailure.uncheck();
  try {
    await retry.click();
    const loading = page.getByRole('button', { name: 'Повторная загрузка…' });
    await loading.waitFor();
    assert.ok(await loading.isDisabled());
    await page.getByText('Неудачных попыток: 2').waitFor();
  } finally {
    releaseRequest();
  }
  await page.getByRole('heading', { name: 'Заметка', exact: true }).waitFor();
  assert.deepEqual(await events(), ['error', 'error', 'success']);
});

test('ошибка рендера throw null попадает в error fallback', async () => {
  const scripts = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/fixtures/') && url.pathname.endsWith('.js')) scripts.push(url.pathname);
  });
  await open('render-error');
  await page.getByText('null', { exact: true }).waitFor();
  await page.getByText('Неудачных попыток: 1').waitFor();
  assert.deepEqual(await events(), ['success']);
  assert.ok(scripts.some((url) => url.includes('BrokenNote')), JSON.stringify(scripts));
  const count = scripts.length;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByText('Неудачных попыток: 2').waitFor();
  assert.ok(scripts.length > count, JSON.stringify(scripts));
});

test('повтор пять секунд показывает loading внутри ошибки и завершается успехом', async () => {
  await open('retry-delayed');
  await page.getByText('Неудачных попыток: 1').waitFor();
  const alert = page.getByRole('alert');
  const error = await alert.locator('pre').textContent();
  const started = Date.now();
  await alert.getByRole('button', { name: 'Повторить', exact: true }).click();
  await alert.getByRole('status').waitFor();
  assert.equal(await alert.locator('pre').textContent(), error);
  assert.ok(await alert.getByRole('button').isDisabled());
  assert.deepEqual(await events(), ['error']);
  await page.waitForTimeout(4000);
  assert.ok(await alert.getByRole('status').isVisible());
  await page.getByRole('textbox', { name: 'Текст заметки' }).waitFor({ timeout: 5000 });
  assert.ok(Date.now() - started >= 5000);
  assert.equal(await alert.count(), 0);
  assert.deepEqual(await events(), ['error', 'success']);
});

test('пять вкладок загружают отдельные MF-контейнеры с рабочими элементами управления', async () => {
  const chunks = [];
  const manifests = [];
  const entries = [];
  const requestedModules = new Set();
  page.on('request', (request) => {
    const match = new URL(request.url()).pathname.match(/^\/fixtures\/([^/]+)\//);
    if (match) requestedModules.add(match[1]);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.ok() && url.pathname.endsWith('/importmap.json')) manifests.push(url);
    if (response.ok() && url.pathname.endsWith('/remoteEntry.js')) entries.push(url.pathname);
    if (response.ok() && response.url().includes('__federation_expose_') && response.url().endsWith('.js')) chunks.push(response.url());
  });
  await open('tabs');
  await page.getByRole('textbox', { name: 'Текст заметки' }).fill('Заметка');
  assert.deepEqual([...requestedModules], ['stand_notes']);
  await page.getByRole('tab', { name: 'Счётчик', exact: true }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  assert.equal(await page.getByLabel('Значение счётчика').textContent(), '1');
  assert.deepEqual([...requestedModules], ['stand_notes', 'stand_counter']);
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page.getByLabel('Новая задача').fill('Проверить remote');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Проверить remote' }).check();
  await page.getByText('Выполнено 1 из 1').waitFor();
  assert.deepEqual([...requestedModules], ['stand_notes', 'stand_counter', 'stand_tasks']);
  await page.getByRole('tab', { name: 'Калькулятор', exact: true }).click();
  await page.getByLabel('Цена, ₽').fill('200');
  await page.getByLabel('Скидка, %').fill('25');
  assert.equal(await page.getByLabel('К оплате', { exact: true }).textContent(), '150.00 ₽');
  assert.deepEqual([...requestedModules], ['stand_notes', 'stand_counter', 'stand_tasks', 'stand_calculator']);
  await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Ваше имя').fill('Анна');
  await page.getByRole('button', { name: 'Применить' }).click();
  await page.getByText(/Анна, настройки применены/).waitFor();
  for (const expose of ['Widget', 'Counter', 'Tasks', 'Calculator', 'Preferences']) {
    assert.ok(chunks.some((url) => url.includes(`__federation_expose_${expose}`)), expose);
  }
  const ids = ['stand_notes', 'stand_counter', 'stand_tasks', 'stand_calculator', 'stand_preferences'];
  assert.equal(manifests.length, ids.length);
  for (const id of ids) {
    assert.ok(manifests.some((url) => url.pathname === `/fixtures/${id}/importmap.json`
      && url.searchParams.get('remoteId') === id
      && url.searchParams.get('hostId') === 'dynamic_module_test'), id);
    assert.ok(entries.includes(`/fixtures/${id}/remoteEntry.js`), id);
  }
  const count = chunks.length;
  await page.getByRole('tab', { name: 'Заметка', exact: true }).click();
  await page.getByLabel('Текст заметки').waitFor();
  assert.equal(chunks.length, count);
  assert.equal(manifests.length, ids.length);
  assert.equal(entries.length, ids.length);
});

test('готовый компонент загружается через Module Federation и принимает ввод', async () => {
  const scripts = [];
  page.on('response', (response) => {
    if (response.ok() && response.url().includes('/fixtures/') && response.url().endsWith('.js')) {
      scripts.push(response.url());
    }
  });
  await open('preset');
  const input = page.getByRole('textbox', { name: 'Текст заметки' });
  await input.fill('Готовый remote');
  assert.equal(await input.inputValue(), 'Готовый remote');
  assert.deepEqual(await events(), ['success']);
  assert.ok(scripts.some((url) => url.endsWith('/remoteEntry.js')));
  assert.ok(scripts.some((url) => url.includes('__federation_expose_Widget')));
});

test('повторный переход к медленной вкладке использует кеш без loading', async () => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/fixtures/')) requests.push(request.url());
  });
  await open('tabs');
  await page.getByLabel('Текст заметки').waitFor();
  const started = Date.now();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page.getByRole('status').waitFor();
  await page.getByLabel('Новая задача').waitFor();
  assert.ok(Date.now() - started >= 2000);
  await page.getByRole('tab', { name: 'Заметка', exact: true }).click();
  await page.getByLabel('Текст заметки').waitFor();
  const requestCount = requests.length;
  const reports = await events();
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="module"]');
    window.loadingFlashed = false;
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (node instanceof Element && (node.matches('[role="status"]') || node.querySelector('[role="status"]'))) {
            window.loadingFlashed = true;
          }
        }
      }
    });
    observer.observe(panel, { childList: true, subtree: true });
  });
  const returning = Date.now();
  await page.getByRole('tab', { name: 'Задачи', exact: true }).click();
  await page.getByLabel('Новая задача').waitFor({ timeout: 1000 });
  assert.ok(Date.now() - returning < 1500);
  assert.equal(await page.evaluate(() => window.loadingFlashed), false);
  assert.equal(requests.length, requestCount);
  assert.deepEqual(await events(), reports);
});

test('вкладка placeholder не загружает выключенный модуль и позволяет включить его', async () => {
  await open('tabs');
  await page.getByLabel('Текст заметки').waitFor();
  const reports = await events();
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/fixtures/')) requests.push(request.url());
  });
  await page.getByRole('tab', { name: 'Placeholder', exact: true }).click();
  await page.getByText('Placeholder выключен', { exact: true }).waitFor();
  assert.deepEqual(await events(), reports);
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Включить модуль' }).click();
  await page.getByLabel('Текст заметки').fill('Модуль включён');
  assert.equal((await events()).length, reports.length + 1);
  await page.getByRole('button', { name: 'Выключить модуль' }).click();
  await page.getByText('Placeholder выключен', { exact: true }).waitFor();
});

for (const { tab, id, message } of [
  { tab: 'Ошибка регистрации', id: 'stand_registration_error', message: /Не удалось зарегистрировать stand_registration_error/ },
  { tab: 'Ошибка загрузки remote', id: 'stand_load_error', message: /Не удалось загрузить stand_load_error/ },
]) {
  test(`${tab}: показывает ошибку и восстанавливается после повтора`, async () => {
    const manifests = [];
    const scripts = [];
    page.on('response', (response) => {
      if (response.url().includes(`/fixtures/${id}/importmap.json?`)) manifests.push(response.status());
      if (new URL(response.url()).pathname === `/fixtures/${id}/remoteEntry.js`) scripts.push(response.status());
    });
    await open('tabs');
    await page.getByLabel('Текст заметки').waitFor();
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const alert = page.getByRole('alert');
    await alert.getByText(message).waitFor();
    await alert.getByText('Неудачных попыток: 1', { exact: true }).waitFor();
    assert.deepEqual(await events(), ['success', 'error']);
    assert.deepEqual(manifests, id === 'stand_load_error' ? [200] : []);
    assert.deepEqual(scripts, id === 'stand_load_error' ? [503] : []);
    await alert.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByLabel('Текст заметки').fill('Загрузка восстановлена');
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(await events(), ['success', 'error', 'success']);
    assert.ok(manifests.length >= 1 && manifests.every((status) => status === 200));
    assert.deepEqual(scripts, id === 'stand_load_error' ? [503, 200] : [200]);
  });
}

test('ререндер родителя сохраняет состояние загруженного модуля', async () => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/fixtures/')) requests.push(request.url());
  });
  await open('rerender');
  const input = page.getByLabel('Текст заметки');
  await input.fill('Сохранить введённый текст');
  const count = requests.length;
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: /Обновить родителя/ }).click();
    assert.equal(await input.inputValue(), 'Сохранить введённый текст');
  }
  assert.equal(requests.length, count);
  assert.deepEqual(await events(), []);
});

test('ошибка onLoad не скрывает успешно загруженный модуль', async () => {
  await open('onload-error');
  await page.getByLabel('Текст заметки').fill('Модуль работает');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(await events(), ['success']);
});

test('смена publicPath запрашивает новый манифест и сбрасывает прежнюю ошибку', async () => {
  const manifests = [];
  page.on('request', (request) => {
    if (request.url().includes('importmap.json?')) manifests.push(new URL(request.url()).pathname);
  });
  await page.route('**/fixtures/unavailable/importmap.json?*', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await open('public-path');
  await page.getByLabel('Текст заметки').waitFor();
  await page.getByRole('button', { name: 'Другой адрес', exact: true }).click();
  await page.getByLabel('Текст заметки').waitFor();
  assert.ok(manifests.includes('/fixtures/stand_notes_alt/importmap.json'));
  assert.deepEqual(await events(), ['success', 'success']);
  await page.getByRole('button', { name: 'Недоступный адрес', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Исходный адрес', exact: true }).click();
  await page.getByLabel('Текст заметки').fill('Снова работает');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(await events(), ['success', 'success', 'error']);
});

test('context передаёт данные и актуальные обработчики каждому экземпляру без перезагрузки', async () => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/fixtures/')) requests.push(request.url());
  });
  await open('context');
  const first = page.getByTestId('context-0').getByLabel('Текст заметки');
  const second = page.getByTestId('context-1').getByLabel('Текст заметки');
  await first.fill('Первая');
  await second.fill('Вторая');
  assert.equal(await page.getByTestId('message-0').textContent(), '0:Первая');
  assert.equal(await page.getByTestId('message-1').textContent(), '0:Вторая');
  const count = requests.length;
  await page.getByRole('button', { name: /Обновить родителя/ }).click();
  await page.getByRole('heading', { name: 'Заметка 1, версия 1', exact: true }).waitFor();
  assert.equal(await first.inputValue(), 'Первая');
  assert.equal(await second.inputValue(), 'Вторая');
  await first.fill('Обновлена');
  assert.equal(await page.getByTestId('message-0').textContent(), '1:Обновлена');
  assert.equal(await page.getByTestId('message-1').textContent(), '0:Вторая');
  assert.equal(requests.length, count);
  assert.deepEqual(await events(), ['success']);
});

test('fallbacks получают context без лишних ререндеров memo-компонентов', async () => {
  await open('fallback-context');
  await page.getByTestId('error-failures').filter({ hasText: /^1$/ }).waitFor();
  const names = ['loading', 'error', 'placeholder'];
  for (const name of names) {
    assert.equal(await page.getByTestId(`${name}-label`).textContent(), 'Первое значение');
    const keys = (await page.getByRole('region', { name, exact: true }).getAttribute('data-props')).split(',');
    assert.deepEqual(keys, (name === 'error'
      ? ['source', 'label', 'onAction', 'error', 'failTries', 'isLoading', 'onRepeat']
      : ['source', 'label', 'onAction']).sort());
  }
  const renders = await Promise.all(names.map((name) => page.getByTestId(`${name}-renders`).textContent()));
  await page.getByRole('button', { name: 'Ререндер родителя', exact: true }).click();
  assert.equal(await page.getByTestId('parent-render').textContent(), '1');
  assert.deepEqual(await Promise.all(names.map((name) => page.getByTestId(`${name}-renders`).textContent())), renders);
  await page.getByRole('button', { name: 'Изменить контекст', exact: true }).click();
  for (const name of names) {
    assert.equal(await page.getByTestId(`${name}-label`).textContent(), 'Новое значение');
  }
  await page.getByRole('button', { name: 'Изменить обработчик', exact: true }).click();
  for (const name of names) {
    await page.getByRole('region', { name, exact: true }).getByRole('button', { name: 'Действие' }).click();
    assert.equal(await page.getByTestId('last-action').textContent(), '1');
  }
});

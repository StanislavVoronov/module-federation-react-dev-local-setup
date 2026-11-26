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
  return page.getByTestId('load-events').locator('li').allTextContents();
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

test('передаёт типизированному children named expose из указанного манифеста', async () => {
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

test('отдельно сообщает об ошибке регистрации и показывает ссылку поддержки', async () => {
  await open('register');
  await page.getByText(/Не удалось зарегистрировать stand_notes/).waitFor();
  assert.deepEqual(await events(), ['error']);
  assert.equal(await page.getByRole('link', { name: 'Поддержка' }).getAttribute('href'), '#support');
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

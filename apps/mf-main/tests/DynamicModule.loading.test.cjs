const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

function manifest(name = 'remote') {
  return {
    id: name,
    name,
    metaData: { globalName: name, publicPath: 'auto', remoteEntry: { path: '', name: 'remoteEntry.js', type: 'global' }, buildInfo: { buildVersion: '1' } },
    exposes: [], shared: [], remotes: [],
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(options = {}) {
  const source = readFileSync(`${__dirname}/../src/remotes/DynamicModule.tsx`, 'utf8')
    .replaceAll('import.meta.env.PUBLIC_FRONT_MODULE_ID', "'test'")
    .replaceAll('import.meta.env.PUBLIC_FRONT_MODULE_NAME', "'Test'")
    + '\nexport { loadModule, fetchRemoteComponent };';
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pending = [];
  let registrations = 0;
  const registered = [];
  const requests = [];
  const loads = [];
  const timers = new Set();
  const runtime = {
    registerRemotes(remotes, options) { registrations++; registered.push({ remotes, options }); if (setupOptions.registerError) throw setupOptions.registerError; },
    loadRemote(id) { loads.push(id); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const setupOptions = options;
  const exports = {};
  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    if (options.fetch) return options.fetch(url, init);
    return { ok: true, json: async () => options.manifest ?? manifest() };
  };
  const setTimer = (callback, delay) => { const timer = { callback, delay }; timers.add(timer); return timer; };
  new Function('require', 'exports', 'fetch', 'setTimeout', 'clearTimeout', code)(
    (id) => id === '@module-federation/enhanced/runtime' ? runtime : require(id), exports, fetch,
    setTimer, (timer) => timers.delete(timer),
  );
  function boundary(id = 'remote') {
    const props = { host: { id: 'test', name: 'Test' }, publicPath: `/${id}`, enabled: true, fallbacks: { error: null } };
    exports.loadModule(props);
    const instance = new exports.RemoteBoundary(props);
    instance.state.error = new Error('initial failure');
    // Apply queued state updates explicitly to simulate a committed React update.
    const updates = [];
    instance.setState = (update) => updates.push(update);
    return { instance, flush() {
      for (const update of updates.splice(0)) Object.assign(instance.state, typeof update === 'function' ? update(instance.state) : update);
    } };
  }
  return { boundary, pending, registered, requests, loads, timers, ...exports, registrations: () => registrations };
}

for (const fail of [false, true]) {
  test(`parallel retries share one load (${fail ? 'failure' : 'success'})`, async () => {
    const fixture = setup();
    const first = fixture.boundary();
    const second = fixture.boundary();
    const attempts = [first.instance.onRepeat(), second.instance.onRepeat()];
    first.flush();
    assert.equal(first.instance.state.isLoading, true);
    await first.instance.onRepeat();
    await flush();
    assert.equal(fixture.registrations(), 1);
    assert.equal(fixture.registered[0].options.force, true);
    assert.equal(fixture.pending.length, 1);
    if (fail) fixture.pending[0].reject(new Error('network failure'));
    else fixture.pending[0].resolve({ default: () => null });
    await Promise.all(attempts);
    for (const item of [first, second]) {
      item.flush();
      assert.equal(item.instance.state.isLoading, false);
      assert.equal(item.instance.state.failTries, fail ? 1 : 0);
      assert.equal(item.instance.state.error === null, !fail);
    }
    const next = first.instance.onRepeat();
    await flush();
    assert.equal(fixture.pending.length, 2);
    fixture.pending[1].resolve({ default: () => null });
    await next;
  });
}

test('different modules load independently', async () => {
  const fixture = setup();
  const first = fixture.boundary('first');
  const second = fixture.boundary('second');
  const attempts = [first.instance.onRepeat(), second.instance.onRepeat()];
  await flush();
  assert.equal(fixture.pending.length, 2);
  fixture.pending.forEach((request) => request.resolve({ default: () => null }));
  await Promise.all(attempts);
});

for (const asynchronous of [false, true]) {
  for (const fail of [false, true]) {
    test(`onLoad failure does not change load result (async=${asynchronous}, failure=${fail})`, async () => {
      const fixture = setup();
      const outcomes = [];
      const callback = (result) => {
        outcomes.push(result.status);
        if (asynchronous) return Promise.reject(new Error('callback failure'));
        throw new Error('callback failure');
      };
      const props = { host: { id: 'test', name: 'Test' }, publicPath: '/remote', onLoad: callback };
      fixture.loadModule(props);
      const request = fixture.fetchRemoteComponent(props);
      await flush();
      if (fail) {
        fixture.pending[0].reject(new Error('network failure'));
        await assert.rejects(request, /network failure/);
      } else {
        const loaded = { default: () => null };
        fixture.pending[0].resolve(loaded);
        assert.equal(await request, loaded);
      }
      assert.deepEqual(outcomes, [fail ? 'error' : 'success']);
    });
  }
}

test('publicPath change creates separate components and requests registration without force', async () => {
  const fixture = setup();
  const props = { host: { id: 'test', name: 'Test' }, publicPath: '/first', enabled: true, fallbacks: { error: null } };
  const first = fixture.loadModule(props);
  const initial = fixture.fetchRemoteComponent(props);
  await flush();
  const nextProps = { ...props, publicPath: '/second' };
  const second = fixture.loadModule(nextProps);
  assert.notEqual(first, second);
  assert.equal(fixture.loadModule({ ...nextProps, manifest: 'another.json' }), second);
  const next = fixture.fetchRemoteComponent(nextProps);
  await flush();
  assert.equal(fixture.pending.length, 2);
  assert.equal(fixture.registered[1].options.force, false);
  assert.equal(fixture.registered[1].remotes[0].entry, '/second/remoteEntry.js');
  fixture.pending[1].resolve({ default: () => null });
  await next;
  fixture.pending[0].resolve({ default: () => null });
  await initial;
  assert.equal(fixture.loadModule(nextProps), second);
  assert.equal(fixture.loadModule(props), first);
});

test('fetches manifest before registration and loads its name with the requested expose', async () => {
  const fixture = setup({ manifest: manifest('another_remote') });
  const options = { host: { id: 'another_host', name: 'Host' }, publicPath: '/module', component: './Widget' };
  fixture.loadModule(options);
  const request = fixture.fetchRemoteComponent(options);
  assert.equal(fixture.registrations(), 0);
  await flush();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, '/module/importmap.json?hostId=another_host');
  assert.equal(fixture.registered[0].remotes[0].name, 'another_remote');
  assert.equal(fixture.registered[0].remotes[0].entry, '/module/remoteEntry.js');
  assert.deepEqual(fixture.loads, ['another_remote/Widget']);
  assert.equal(fixture.timers.size, 0);
  fixture.pending[0].resolve({ default: () => null });
  await request;
});

for (const [label, fetch] of [
  ['HTTP error', async () => ({ ok: false, status: 503 })],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } })],
  ['missing name', async () => ({ ok: true, json: async () => ({ ...manifest(), name: '' }) })],
  ['missing id', async () => ({ ok: true, json: async () => ({ ...manifest(), id: '' }) })],
  ['network error', async () => { throw new Error('Offline'); }],
]) {
  test(`manifest failure: ${label}`, async () => {
    const fixture = setup({ fetch });
    const outcomes = [];
    const options = { host: { id: 'host', name: 'Host' }, publicPath: '/remote', onLoad: (result) => outcomes.push(result) };
    fixture.loadModule(options);
    await assert.rejects(fixture.fetchRemoteComponent(options), /Не удалось загрузить манифест/);
    assert.equal(fixture.registrations(), 0);
    assert.equal(fixture.pending.length, 0);
    assert.equal(fixture.timers.size, 0);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, 'error');
  });
}

for (const body of [false, true]) {
  test(`30 second timeout aborts ${body ? 'JSON body' : 'manifest request'} and retry succeeds`, async () => {
    let fail = true;
    const fixture = setup({ fetch: async (_url, { signal }) => {
      if (!fail) return { ok: true, json: async () => manifest() };
      const wait = () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return body ? { ok: true, json: wait } : wait();
    } });
    const boundary = fixture.boundary();
    const first = boundary.instance.onRepeat();
    await flush();
    const [timer] = fixture.timers;
    assert.equal(timer.delay, 30_000);
    timer.callback();
    await first;
    boundary.flush();
    assert.match(boundary.instance.state.error.message, /30 секунд/);
    assert.equal(boundary.instance.state.failTries, 1);
    assert.equal(boundary.instance.state.isLoading, false);
    assert.equal(fixture.requests[0].signal.aborted, true);
    assert.equal(fixture.registrations(), 0);
    fail = false;
    const second = boundary.instance.onRepeat();
    await flush();
    fixture.pending[0].resolve({ default: () => null });
    await second;
    boundary.flush();
    assert.equal(boundary.instance.state.error, null);
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.timers.size, 0);
  });
}

test('registration failure is reported separately after manifest fetch', async () => {
  const fixture = setup({ registerError: new Error('Registration denied') });
  const boundary = fixture.boundary();
  await boundary.instance.onRepeat();
  boundary.flush();
  assert.match(boundary.instance.state.error.message, /Не удалось зарегистрировать remote/);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.loads.length, 0);
});

test('cache keeps stable components and separates exposes', () => {
  const fixture = setup();
  const options = { host: { id: 'host', name: 'Host' }, publicPath: '/remote' };
  const root = fixture.loadModule(options);
  assert.equal(fixture.loadModule({ ...options, component: '.' }), root);
  const named = fixture.loadModule({ ...options, component: './Widget' });
  assert.notEqual(named, root);
  assert.equal(fixture.loadModule({ ...options, component: 'Widget' }), named);
  assert.equal(fixture.requests.length, 0);
});

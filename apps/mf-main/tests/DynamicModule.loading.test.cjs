const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

function setup() {
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
  const runtime = {
    registerRemotes(remotes, options) { registrations++; registered.push({ remotes, options }); },
    loadRemote() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const exports = {};
  new Function('require', 'exports', code)((id) => id === '@module-federation/enhanced/runtime' ? runtime : require(id), exports);
  function boundary(id = 'remote') {
    const props = { hostId: 'test', hostName: 'Test', remoteId: id, remoteName: id, publicPath: `/${id}`, enabled: true, fallbacks: { error: null } };
    exports.loadModule({ source: props });
    const instance = new exports.RemoteBoundary({ source: props, fallbacks: props.fallbacks });
    instance.state.error = new Error('initial failure');
    // Apply queued state updates explicitly to simulate a committed React update.
    const updates = [];
    instance.setState = (update) => updates.push(update);
    return { instance, flush() {
      for (const update of updates.splice(0)) Object.assign(instance.state, typeof update === 'function' ? update(instance.state) : update);
    } };
  }
  return { boundary, pending, registered, ...exports, registrations: () => registrations };
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
    await Promise.resolve();
    assert.equal(fixture.registrations(), 1);
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
    await Promise.resolve();
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
  await Promise.resolve();
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
      const props = { hostId: 'test', hostName: 'Test', remoteId: 'remote', remoteName: 'Remote', publicPath: '/remote', onLoad: callback };
      fixture.loadModule({ source: props, onLoad: props.onLoad });
      const request = fixture.fetchRemoteComponent({ source: props, onLoad: props.onLoad });
      await Promise.resolve();
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

test('publicPath change creates separate components and registers the new address', async () => {
  const fixture = setup();
  const props = { hostId: 'test', hostName: 'Test', remoteId: 'remote', remoteName: 'Remote', publicPath: '/first', enabled: true, fallbacks: { error: null } };
  const first = fixture.loadModule({ source: props, onLoad: props.onLoad });
  const initial = fixture.fetchRemoteComponent({ source: props, onLoad: props.onLoad });
  await Promise.resolve();
  const nextProps = { ...props, publicPath: '/second' };
  const second = fixture.loadModule({ source: nextProps });
  assert.notEqual(first, second);
  assert.equal(fixture.loadModule({ source: { ...nextProps, manifest: 'another.json' } }), second);
  const next = fixture.fetchRemoteComponent({ source: nextProps });
  await Promise.resolve();
  assert.equal(fixture.pending.length, 2);
  assert.equal(fixture.registered[1].options.force, true);
  assert.equal(fixture.registered[1].remotes[0].entry, '/second/importmap.json?hostId=test&remoteId=remote');
  fixture.pending[1].resolve({ default: () => null });
  await next;
  fixture.pending[0].resolve({ default: () => null });
  await initial;
  assert.equal(fixture.loadModule({ source: nextProps }), second);
  assert.equal(fixture.loadModule({ source: props, onLoad: props.onLoad }), first);
});

test('manifest URL uses hostId and remoteId from source', async () => {
  const fixture = setup();
  const source = { hostId: 'another_host', hostName: 'Host label', remoteId: 'another_remote', remoteName: 'Remote label', enabled: true, publicPath: '/module' };
  fixture.loadModule({ source });
  const request = fixture.fetchRemoteComponent({ source });
  await Promise.resolve();
  assert.equal(fixture.registered[0].remotes[0].name, 'another_remote');
  assert.equal(fixture.registered[0].remotes[0].entry, '/module/importmap.json?hostId=another_host&remoteId=another_remote');
  fixture.pending[0].resolve({ default: () => null });
  await request;
});

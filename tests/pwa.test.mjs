import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const origin = 'https://planner.test';
const worker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'));
const assets = JSON.parse(worker.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);

function harness({ broken, mixed, networkOffline = false } = {}) {
  const handlers = new Map(), stores = new Map();
  let networkCalls = 0;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return { put: async (url, response) => data.set(String(url), response.clone()),
        match: async (url) => data.get(String(url))?.clone() };
    },
  };
  vm.runInNewContext(worker, {
    self: { location: { origin }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches, crypto: webcrypto, URL, Response, Uint8Array,
    fetch: async (url) => {
      networkCalls++;
      if (networkOffline) throw new TypeError('offline');
      const pathname = new URL(url).pathname;
      if (pathname === broken) return new Response('missing', { status: 404 });
      const bytes = pathname === mixed ? Buffer.from('different release') : await readFile(new URL('../dist' + pathname, import.meta.url));
      return new Response(bytes);
    },
  });
  return {
    stores, calls: () => networkCalls,
    offline: () => { networkOffline = true; },
    lifecycle: (name) => { let promise; handlers.get(name)({ waitUntil: (value) => { promise = value; } }); return promise; },
    response: (path, mode = 'cors', method = 'GET') => {
      let promise; handlers.get('fetch')({ request: { url: origin + path, mode, method }, respondWith: (value) => { promise = value; } });
      return promise;
    },
  };
}

test('PWAのIDと開始URL・scopeは安定したルート、standalone・PNGアイコンを持つ', async () => {
  assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.lang, 'ja');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL('../dist' + icon.src, import.meta.url));
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});
test('配信ファイルの変更がSWに反映されていなければ公開前に検出する', () => {
  execFileSync(process.execPath, ['scripts/build-pwa.mjs', '--check'], { cwd: new URL('../',import.meta.url) });
});
test('初回にアプリ一式を保存し、全ファイルと開始URLをオフライン配信する', async () => {
  const app = harness(); await app.lifecycle('install'); await app.lifecycle('activate'); app.offline();
  const calls = app.calls();
  for (const { path } of assets) {
    const response = await app.response(path);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL('../dist'+path,import.meta.url)));
  }
  assert.match(await (await app.response('/?launch=home', 'navigate')).text(), /休憩時間算出アプリ/);
  assert.equal(app.calls(), calls);
});
test('取得失敗と旧新混在で更新を中止し、旧キャッシュを残す', async () => {
  for (const options of [{ broken: '/app.js' }, { mixed: '/calculation.js' }]) {
    const app = harness(options); app.stores.set('kyukei-app-shell-old', new Map([['saved', 'old']]));
    await assert.rejects(app.lifecycle('install'));
    assert.deepEqual([...app.stores.keys()], ['kyukei-app-shell-old']);
  }
});
test('ホストがHTMLを書き換えても、リリースに含まれるHTMLを保存する', async () => {
  const app = harness({ mixed: '/index.html' }); await app.lifecycle('install');
  const html = await (await app.response('/', 'navigate')).text();
  assert.equal(html, await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
});
test('新しい版の有効化時だけ旧アプリキャッシュを消し、無関係なキャッシュは維持', async () => {
  const app = harness(); app.stores.set('kyukei-app-shell-old',new Map()); app.stores.set('other-site-cache',new Map());
  await app.lifecycle('install'); assert.ok(app.stores.has('kyukei-app-shell-old'));
  await app.lifecycle('activate'); assert.equal(app.stores.has('kyukei-app-shell-old'),false);
  assert.ok(app.stores.has('other-site-cache'));
});
test('キャッシュ欠損を新版ネットワークで補わず、保存データや所有権ファイルを操作しない', async () => {
  const app = harness();
  assert.equal((await app.response('/app.js')).status, 503); assert.equal(app.calls(), 0);
  assert.equal(app.response('/.well-known/assetlinks.json'), undefined);
  assert.equal(app.response('/app.js','cors','POST'),undefined);
  assert.doesNotMatch(worker, /self\.skipWaiting\(|clients\.claim\(|localStorage\.|indexedDB\./);
});

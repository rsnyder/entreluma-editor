// tests/unit/context.test.js  (WP-3.2)
//
// Unit tests for editor/context.js — the skrender context builder + repo
// cache (docs/editor-plan.md §1.2, docs/editor-spec.md FR-PRE.2/FR-PRE.4).
//
// Hermeticity: `globalThis.fetch` is stubbed per test (saved/restored), so no
// test ever touches api.github.com, raw.githubusercontent.com, or the Chirpy
// CDN. editor/github.js is exercised THROUGH its real implementation (its
// fetch is the same stubbed global), which keeps the bound-mode tests honest
// about the wire protocol (If-None-Match headers, 304/404 handling).
//
// Cache isolation: the repoCache lives in the shared "entreluma-editor"
// IndexedDB, which persists across tests within one page load. Bound-mode
// tests therefore use a UNIQUE owner per test (o-fresh, o-stale, …) so keys
// never collide. Unbound-mode keys are fixed ('unbound/entreluma/
// main/…'), so those tests clear the 'unbound/' key prefix first via a
// direct idb connection (same pattern store.test.js documents; initStore()
// runs first so the direct connection never races the schema upgrade).

import { openDB } from 'idb';
import { describe, it, assert } from './runner.js';
import { buildContext as realBuildContext } from '../../editor/context.js';
import { initStore, repoCache } from '../../editor/store.js';

// Legacy cache-chain tests deliberately use mutable refs; revision behavior is
// covered separately below with the real resolver.
const buildContext = args => realBuildContext({...args, resolveRevision: async b => ({ref: b.branch})});
const BUNDLE = new URL('../../editor/framework/', import.meta.url).href;
const DB_NAME = 'entreluma-editor';
const DB_VERSION = 2;

const FRESHNESS_MS = 5 * 60 * 1000; // mirror of context.js's constant
const STALE_AGE_MS = FRESHNESS_MS + 60 * 1000; // comfortably stale
const CHIRPY_CDN = 'https://cdn.jsdelivr.net/gh/cotes2020/jekyll-theme-chirpy@';
const RAW_STARTER = 'https://raw.githubusercontent.com/rsnyder/entreluma/main/';

// ── test helpers ────────────────────────────────────────────────────────

/** Minimal Response-alike (same shape github.test.js uses). */
function fakeResponse({ status, headers = {}, body = '' } = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (lower.has(String(k).toLowerCase()) ? lower.get(String(k).toLowerCase()) : null) },
    async json() { return text ? JSON.parse(text) : null; },
    async text() { return text; },
    clone() { return fakeResponse({ status, headers, body: text }); },
  };
}

/** UTF-8-safe base64 (to build GitHub Contents API payloads). */
function b64encodeUtf8(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

/** A 200 GitHub Contents API response carrying `content`. */
function apiFileResponse(content, { etag = 'W/"etag"' } = {}) {
  return fakeResponse({
    status: 200,
    headers: { etag },
    body: { content: b64encodeUtf8(content), encoding: 'base64', sha: 'sha1' },
  });
}

/** Runs `fn` with globalThis.fetch replaced by `stub`, always restoring. */
async function withStubFetch(stub, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return stub(String(url), opts, calls);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Seeds fresh cache entries for the three files buildContext itself resolves
 * (_config.yml, locales, origin), so bound-mode tests can call buildContext
 * with ZERO network noise and focus their stubs on the path under test.
 */
async function seedContextBasics({ owner, repo = 'r', branch = 'main', at = Date.now(), configYaml = 'title: seeded' }) {
  const rows = [
    ['_config.yml', configYaml],
    ['Gemfile.lock', '    jekyll-theme-chirpy (7.6.0)'],
    ['_data/locales/en.yml', 'post: {seeded: true}'],
    ['_data/origin/cors.yml', 'seeded: true'],
  ];
  for (const [path, content] of rows) {
    await repoCache.put(
      repoCache.makeKey({ owner, repo, ref: branch, path }),
      { etag: 'W/"seed"', content, fetchedAt: at, source: 'github' },
    );
  }
}

/** Deletes every repoCache row whose key starts with `prefix`. */
async function clearRepoCachePrefix(prefix) {
  await initStore(); // make sure the schema exists before a direct connection
  const db = await openDB(DB_NAME, DB_VERSION);
  const tx = db.transaction('repoCache', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (String(cursor.key).startsWith(prefix)) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  db.close();
}

// ── context shape ────────────────────────────────────────────────────────

describe('context: produced shape (skrender contract + additive fields)', () => {
  it('matches Jekyll duplicate configuration keys without dropping the site URL or theme', async () => {
    const owner='o-duplicate-config';
    await seedContextBasics({owner,configYaml:'url: https://lab.plant-humanities.org\ntheme: jekyll-theme-chirpy\navatar: /old.png\navatar: /new.png\n'});
    await withStubFetch(()=>{throw new TypeError('unexpected network');},async()=>{
      const ctx=await buildContext({binding:{owner,repo:'r',branch:'main'}});
      assert.equal(ctx.assetOrigin,'https://lab.plant-humanities.org');
      assert.equal(ctx.config.theme,'jekyll-theme-chirpy');
      assert.equal(ctx.config.avatar,'/new.png');
      assert.equal(ctx.themeAssetOrigin,undefined);
    });
  });

  it('bound context carries every contracted field, the WP-1.2 deltas, and diagnostics', async () => {
    const owner = 'o-shape';
    await seedContextBasics({ owner, configYaml: 'url: https://ex.io\nbaseurl: /b\ntitle: Shape' });
    await withStubFetch(
      () => { throw new TypeError('unexpected network'); },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.equal(calls.length, 0, 'fully seeded context should build with zero network');
        assert.equal(typeof ctx.config, 'object');
        assert.equal(ctx.config.title, 'Shape');
        assert.equal(ctx.assetOrigin, 'https://ex.io');
        assert.equal(ctx.baseurl, '/b');
        assert.equal(ctx.themeAssetOrigin, undefined, 'configured sites retain their own theme');
        assert.equal(ctx.rawContentBase, 'https://raw.githubusercontent.com/o-shape/r/main/');
        assert.equal(typeof ctx.resolveFile, 'function');
        assert.ok(ctx.layouts instanceof Map && ctx.layouts.size === 0);
        assert.ok(ctx.includes instanceof Map && ctx.includes.size === 0);
        assert.ok(Array.isArray(ctx.diagnostics), 'additive diagnostics array present');
        assert.ok('origin' in ctx, 'origin present when _data/origin/cors.yml resolves');
        assert.deepEqual(ctx.origin, { cors: { seeded: true } });
        assert.deepEqual(ctx.locales, { en: { post: { seeded: true } } });
      }
    );
  });
});

// ── resolveFile chain: cache states ──────────────────────────────────────

describe('context: resolveFile cache chain', () => {
  it('falls back to bundled viewer includes when a bound repository lacks Entreluma', async () => {
    const owner = 'o-no-viewers';
    await seedContextBasics({ owner });
    await withStubFetch(url => {
      if (url.endsWith('/editor/framework/_includes/embed/image.html')) return fakeResponse({status:200,body:'BUNDLED IMAGE'});
      return fakeResponse({status:404});
    }, async () => {
      const ctx = await buildContext({binding:{owner,repo:'r',branch:'main'}});
      assert.equal(await ctx.resolveFile('_includes/embed/image.html'), 'BUNDLED IMAGE');
      assert.equal(await ctx.resolveFile('_includes/private.html'), null);
      assert.ok(ctx.diagnostics.some(d=>d.message.includes('Install Entreluma')));
    });
  });

  it('uses a theme fallback for a repository with no site URL without moving its content', async () => {
    const owner = 'o-no-site';
    await seedContextBasics({ owner });
    await withStubFetch(() => { throw new TypeError('unexpected network'); }, async () => {
      const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
      assert.equal(ctx.themeAssetOrigin, 'https://entreluma.org');
      assert.equal(ctx.rawContentBase, 'https://raw.githubusercontent.com/o-no-site/r/main/');
      assert.equal(ctx.config.github.username, 'o-no-site');
      assert.equal(ctx.config.github.repository, 'r');
      assert.ok(ctx.diagnostics.some(d => d.message.includes('standard Entreluma viewers and theme')));
    });
  });

  it('cache hit (fresh) serves from repoCache with no network call', async () => {
    const owner = 'o-fresh';
    await seedContextBasics({ owner });
    await repoCache.put(
      repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_posts/a.md' }),
      { etag: 'W/"a1"', content: 'FRESH CONTENT', fetchedAt: Date.now(), source: 'github' },
    );
    await withStubFetch(
      () => { throw new TypeError('unexpected network'); },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        const text = await ctx.resolveFile('_posts/a.md');
        assert.equal(text, 'FRESH CONTENT');
        assert.equal(calls.length, 0, 'fresh hit must not touch the network');
      }
    );
  });

  it('cache hit (stale) revalidates with If-None-Match; 304 serves cache and refreshes fetchedAt', async () => {
    const owner = 'o-stale';
    const staleAt = Date.now() - STALE_AGE_MS;
    const key = repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_posts/s.md' });
    await seedContextBasics({ owner });
    await repoCache.put(key, { etag: 'W/"e9"', content: 'STALE-BUT-VALID', fetchedAt: staleAt, source: 'github' });
    await withStubFetch(
      (url, opts) => {
        assert.ok(url.startsWith('https://api.github.com/repos/o-stale/r/contents/_posts/s.md'),
          `revalidation should hit the Contents API, got ${url}`);
        assert.equal(opts.headers['If-None-Match'], 'W/"e9"', 'must send the cached ETag');
        return fakeResponse({ status: 304 });
      },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        const text = await ctx.resolveFile('_posts/s.md');
        assert.equal(text, 'STALE-BUT-VALID');
        assert.equal(calls.length, 1, 'exactly one revalidation request');
        const row = await repoCache.get(key);
        assert.ok(row.fetchedAt > staleAt, '304 must refresh fetchedAt');
        assert.equal(row.content, 'STALE-BUT-VALID', 'content untouched by 304');
      }
    );
  });

  it('cache miss fetches from GitHub and stores content+etag in repoCache', async () => {
    const owner = 'o-miss';
    const key = repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_posts/new.md' });
    await seedContextBasics({ owner });
    await withStubFetch(
      (url) => {
        assert.ok(url.includes('api.github.com/repos/o-miss/r/contents/_posts/new.md'));
        return apiFileResponse('BRAND NEW', { etag: 'W/"n1"' });
      },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        const text = await ctx.resolveFile('_posts/new.md');
        assert.equal(text, 'BRAND NEW');
        assert.equal(calls.length, 1);
        const row = await repoCache.get(key);
        assert.equal(row.content, 'BRAND NEW');
        assert.equal(row.etag, 'W/"n1"');
        assert.equal(row.source, 'github');
      }
    );
  });

  it('a miss everywhere (repo 404 + gem 404) is cached as a negative entry and never refetched while fresh', async () => {
    const owner = 'o-neg';
    const key = repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_includes/nope.html' });
    await seedContextBasics({ owner });
    await withStubFetch(
      (url) => {
        if (url.includes('api.github.com')) return fakeResponse({ status: 404, body: { message: 'Not Found' } });
        if (url.startsWith(CHIRPY_CDN)) return fakeResponse({ status: 404 });
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.equal(await ctx.resolveFile('_includes/nope.html'), null);
        assert.equal(calls.length, 2, 'one repo probe + one gem probe');
        const row = await repoCache.get(key);
        assert.ok(row, 'negative entry must be cached');
        assert.equal(row.content, null);

        // A brand-new context (fresh per-render memo) must serve the negative
        // entry from cache — zero additional requests.
        const ctx2 = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.equal(await ctx2.resolveFile('_includes/nope.html'), null);
        assert.equal(calls.length, 2, 'negative entry served from cache, no refetch');
      }
    );
  });

  it('a repo 404 falls back to the Chirpy gem CDN and caches the gem copy', async () => {
    const owner = 'o-gemfall';
    await seedContextBasics({ owner });
    await withStubFetch(
      (url) => {
        if (url.includes('api.github.com')) return fakeResponse({ status: 404, body: { message: 'Not Found' } });
        if (url.startsWith(CHIRPY_CDN)) {
          // Asserts the SHAPE — pinned to some exact version tag — not the
          // number. The number is enforced against Gemfile.lock by
          // tools/check_consistency.py; hardcoding it here too just meant a
          // Chirpy upgrade broke this test for no signal.
          assert.ok(/jekyll-theme-chirpy@v\d+\.\d+\.\d+\/_includes\/refactor-content\.html/.test(url),
            `gem URL must pin CHIRPY_VERSION to an exact tag, got ${url}`);
          return fakeResponse({ status: 200, body: 'GEM INCLUDE BODY' });
        }
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async () => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.equal(await ctx.resolveFile('_includes/refactor-content.html'), 'GEM INCLUDE BODY');
        const row = await repoCache.get(
          repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_includes/refactor-content.html' })
        );
        assert.equal(row.content, 'GEM INCLUDE BODY');
        assert.equal(row.source, 'gem');
      }
    );
  });

  it('publication layouts override inherited theme layouts', async () => {
    const owner = 'o-gemseed';
    await seedContextBasics({owner,configYaml:'url: https://publication.example'});
    await withStubFetch(url => {
      assert.ok(url.includes('api.github.com'), 'publication must be checked first');
      return apiFileResponse('<html>PUBLICATION LAYOUT</html>');
    }, async calls => {
      const ctx = await buildContext({binding: {owner, repo: 'r', branch: 'main'}});
      assert.equal(await ctx.resolveFile('_layouts/default.html'), '<html>PUBLICATION LAYOUT</html>');
      assert.equal(calls.length, 1);
      assert.equal(ctx.frameworkAssetOrigin, undefined);
    });
  });

  it('per-render memoization: repeated resolveFile of one path costs one cache/network pass', async () => {
    const owner = 'o-memo';
    await seedContextBasics({ owner });
    await withStubFetch(
      () => apiFileResponse('MEMOIZED'),
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        // Fire concurrently — a non-memoized resolver would fetch twice.
        const [a, b] = await Promise.all([
          ctx.resolveFile('_posts/memo.md'),
          ctx.resolveFile('_posts/memo.md'),
        ]);
        assert.equal(a, 'MEMOIZED');
        assert.equal(b, 'MEMOIZED');
        assert.equal(calls.length, 1, 'memoized wrapper must dedupe concurrent lookups');
      }
    );
  });
});

// ── offline behaviour ─────────────────────────────────────────────────────

describe('context: offline / network failure (FR-PRE.5)', () => {
  it('serves the stale cached entry when offline and pushes a stale-cache diagnostic', async () => {
    const owner = 'o-offstale';
    const staleAt = Date.now() - STALE_AGE_MS;
    await seedContextBasics({ owner });
    await repoCache.put(
      repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_posts/o.md' }),
      { etag: 'W/"o1"', content: 'LAST KNOWN GOOD', fetchedAt: staleAt, source: 'github' },
    );
    await withStubFetch(
      () => { throw new TypeError('Failed to fetch'); },
      async () => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        const text = await ctx.resolveFile('_posts/o.md');
        assert.equal(text, 'LAST KNOWN GOOD', 'stale cache must be served offline');
        const diag = ctx.diagnostics.find((d) => d.message.startsWith('offline: serving stale cache from'));
        assert.ok(diag, `expected a stale-cache diagnostic, got ${JSON.stringify(ctx.diagnostics)}`);
        assert.equal(diag.level, 'warn');
        assert.equal(diag.stage, 'fetch');
      }
    );
  });

  it('returns null when offline and cold, surfacing "context incomplete" via diagnostics', async () => {
    const owner = 'o-offcold';
    await seedContextBasics({ owner });
    await withStubFetch(
      () => { throw new TypeError('Failed to fetch'); },
      async () => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        const text = await ctx.resolveFile('_posts/never-seen.md');
        assert.equal(text, null, 'cold offline miss must resolve to null, never throw');
        assert.ok(
          ctx.diagnostics.some((d) => d.level === 'warn' && d.message.startsWith('offline: context incomplete')),
          `expected an incomplete-context diagnostic, got ${JSON.stringify(ctx.diagnostics)}`
        );
      }
    );
  });

  it('buildContext itself survives a fully offline cold start (config {} + warning, no throw)', async () => {
    await clearRepoCachePrefix('unbound/');
    await withStubFetch(
      () => { throw new TypeError('Failed to fetch'); },
      async () => {
        const ctx = await buildContext({ binding: null });
        assert.deepEqual(ctx.config, {github: {username: 'rsnyder', repository: 'entreluma'}}, 'offline config retains template identity');
        assert.equal(ctx.locales, null);
        assert.ok(!('origin' in ctx), 'origin omitted when unresolvable');
        assert.ok(ctx.diagnostics.length > 0, 'offline warnings pre-populated by buildContext');
      }
    );
  });
});

// ── unbound mode ──────────────────────────────────────────────────────────

describe('context: unbound mode (binding=null, FR-PRE.4)', () => {
  it('serves starter files from raw.githubusercontent and gem files from the Chirpy CDN', async () => {
    await clearRepoCachePrefix('unbound/');
    await withStubFetch(
      (url) => {
        if (url === `${BUNDLE}_config.yml`) {
          return fakeResponse({
            status: 200,
            headers: { etag: 'W/"cfg"' },
            body: 'url: https://rsnyder.github.io\nbaseurl: /entreluma\nlang: en\ntitle: Entreluma',
          });
        }
        if (url === `${BUNDLE}_includes/embed/image.html`) {
          return fakeResponse({ status: 200, body: 'IMAGE EMBED SOURCE' });
        }
        if (url.startsWith(CHIRPY_CDN)) {
          if (url.endsWith('/_data/locales/en.yml')) return fakeResponse({ status: 200, body: 'post: {written_by: By}' });
          if (url.endsWith('/_data/origin/cors.yml')) return fakeResponse({ status: 200, body: 'cors: true' });
          if (url.endsWith('/_layouts/default.html')) return fakeResponse({ status: 200, body: 'GEM DEFAULT LAYOUT' });
          return fakeResponse({ status: 404 });
        }
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async () => {
        const ctx = await buildContext({ binding: null });
        assert.equal(ctx.assetOrigin, 'https://rsnyder.github.io', 'assetOrigin derived from fetched _config.yml');
        assert.equal(ctx.baseurl, '/entreluma', 'baseurl derived from fetched _config.yml');
        assert.equal(ctx.rawContentBase, RAW_STARTER, 'unbound rawContentBase is the starter raw base');
        assert.deepEqual(ctx.locales, { en: { post: { written_by: 'By' } } });
        assert.deepEqual(ctx.origin, { cors: { cors: true } });
        assert.equal(await ctx.resolveFile('_includes/embed/image.html'), 'IMAGE EMBED SOURCE');
        assert.equal(await ctx.resolveFile('_layouts/default.html'), 'GEM DEFAULT LAYOUT');
      }
    );
  });

  it('HERMETIC: unbound buildContext + one resolveFile performs zero api.github.com requests', async () => {
    await clearRepoCachePrefix('unbound/');
    await withStubFetch(
      (url) => {
        if (url.startsWith(BUNDLE)) return fakeResponse({ status: 200, body: 'raw body' });
        if (url.startsWith(CHIRPY_CDN)) return fakeResponse({ status: 200, body: 'gem body' });
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async (calls) => {
        const ctx = await buildContext({ binding: null });
        await ctx.resolveFile('_includes/embed/youtube.html');
        assert.ok(calls.length > 0, 'sanity: something was fetched');
        const githubCalls = calls.filter((c) => c.url.includes('api.github.com'));
        assert.equal(githubCalls.length, 0,
          `unbound mode must never hit api.github.com; saw: ${githubCalls.map((c) => c.url).join(', ')}`);
      }
    );
  });

  it('caches unbound entries under the "unbound" pseudo-binding key', async () => {
    await clearRepoCachePrefix('unbound/');
    await withStubFetch(
      (url) => {
        if (url.startsWith(BUNDLE)) return fakeResponse({ status: 200, body: 'starter file' });
        if (url.startsWith(CHIRPY_CDN)) return fakeResponse({ status: 200, body: 'gem file' });
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async () => {
        const ctx = await buildContext({ binding: null });
        await ctx.resolveFile('_tabs/about.md');
        const row = await repoCache.get(
          repoCache.makeKey({ owner: 'unbound', repo: 'entreluma', ref: 'preview-bundle-2026-09-10', path: '_tabs/about.md' })
        );
        assert.ok(row, 'entry must live under the unbound pseudo-binding namespace');
        assert.equal(row.content, 'starter file');
      }
    );
  });
});

// ── config / locales / origin parsing ─────────────────────────────────────

describe('context: config / locales / origin parsing', () => {
  it('parses _config.yml, _data/locales/<lang>.yml, and _data/origin/cors.yml (bound)', async () => {
    const owner = 'o-parse';
    await withStubFetch(
      (url) => {
        if (url.includes('api.github.com') && url.includes('_config.yml')) {
          return apiFileResponse('url: https://ex.io\nbaseurl: /b\nlang: en\ntitle: Parsed\ndefaults:\n  - scope: {type: posts}\n    values: {layout: post}');
        }
        if (url.startsWith(CHIRPY_CDN)) {
          if (url.endsWith('/_data/locales/en.yml')) return fakeResponse({ status: 200, body: 'post:\n  written_by: By\n  updated: Updated' });
          if (url.endsWith('/_data/origin/cors.yml')) return fakeResponse({ status: 200, body: 'webfonts: https://fonts.example/css' });
          return fakeResponse({ status: 404 });
        }
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async () => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.equal(ctx.config.title, 'Parsed');
        assert.equal(ctx.config.defaults[0].values.layout, 'post');
        assert.equal(ctx.assetOrigin, 'https://ex.io');
        assert.equal(ctx.baseurl, '/b');
        assert.equal(ctx.locales.en.post.written_by, 'By');
        assert.deepEqual(ctx.origin, { cors: { webfonts: 'https://fonts.example/css' } });
      }
    );
  });

  it('falls back to _data/locales/en.yml when config.lang has no locale file', async () => {
    const owner = 'o-lang';
    await withStubFetch(
      (url) => {
        if (url.includes('api.github.com')) {
          if (url.includes('_config.yml')) return apiFileResponse('lang: fr\ntitle: French');
          if (url.includes('_data/locales/fr.yml')) return fakeResponse({ status: 404, body: { message: 'Not Found' } });
          return fakeResponse({ status: 404, body: { message: 'Not Found' } });
        }
        if (url.startsWith(CHIRPY_CDN)) {
          if (url.endsWith('/_data/locales/fr.yml')) return fakeResponse({ status: 404 });
          if (url.endsWith('/_data/locales/en.yml')) return fakeResponse({ status: 200, body: 'post: {written_by: By}' });
          if (url.endsWith('/_data/origin/cors.yml')) return fakeResponse({ status: 200, body: 'x: y' });
          return fakeResponse({ status: 404 });
        }
        if (url.includes('api.github.com') || url.startsWith(BUNDLE)) return fakeResponse({status:404});
        throw new TypeError(`unrouted: ${url}`);
      },
      async () => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'main' } });
        assert.deepEqual(ctx.locales, { en: { post: { written_by: 'By' } } }, 'en fallback locales (keyed under en, the language actually loaded)');
      }
    );
  });
});

// ── branch awareness ──────────────────────────────────────────────────────

describe('context: makeKey branch-awareness', () => {
  it('the same path on different branches yields distinct cache entries', async () => {
    const owner = 'o-branch';
    // Seed the basics for BOTH branches plus a 'main' copy of the post.
    await seedContextBasics({ owner, branch: 'main' });
    await seedContextBasics({ owner, branch: 'dev' });
    const mainKey = repoCache.makeKey({ owner, repo: 'r', ref: 'main', path: '_posts/p.md' });
    const devKey = repoCache.makeKey({ owner, repo: 'r', ref: 'dev', path: '_posts/p.md' });
    assert.ok(mainKey !== devKey, 'makeKey must incorporate the branch');
    await repoCache.put(mainKey, { etag: 'W/"m"', content: 'MAIN COPY', fetchedAt: Date.now(), source: 'github' });

    await withStubFetch(
      (url) => {
        assert.ok(url.includes('ref=dev'), `dev-branch context must fetch ref=dev, got ${url}`);
        return apiFileResponse('DEV COPY', { etag: 'W/"d"' });
      },
      async (calls) => {
        const ctx = await buildContext({ binding: { owner, repo: 'r', branch: 'dev' } });
        const text = await ctx.resolveFile('_posts/p.md');
        assert.equal(text, 'DEV COPY', 'dev branch must not be served the main-branch cache entry');
        assert.equal(calls.length, 1);
        const mainRow = await repoCache.get(mainKey);
        const devRow = await repoCache.get(devKey);
        assert.equal(mainRow.content, 'MAIN COPY', 'main entry untouched');
        assert.equal(devRow.content, 'DEV COPY', 'dev entry cached separately');
      }
    );
  });
});


describe('context: immutable publication revisions', () => {
  it('pins every file, caches warm renders and isolates a refreshed branch revision', async () => {
    const owner = 'o-revision-pinned';
    const binding = {owner, repo: 'r', branch: 'main'};
    let sha = 'a'.repeat(40);
    await withStubFetch(url => {
      if (url.includes('/commits/')) return fakeResponse({status:200, body:{sha}});
      assert.ok(url.includes(`ref=${sha}`), `all files must use the commit: ${url}`);
      if (url.includes('_config.yml')) return apiFileResponse('url: https://publication.example\ntheme: jekyll-theme-chirpy');
      if (url.includes('Gemfile.lock')) return apiFileResponse('    jekyll-theme-chirpy (7.5.0)');
      if (url.includes('missing')) return fakeResponse({status:404});
      return apiFileResponse(sha);
    }, async calls => {
      const first = await realBuildContext({binding});
      assert.equal(first.publicationRevision, sha);
      assert.equal(await first.resolveFile('_layouts/default.html'), sha);
      assert.equal(await first.resolveFile('missing.txt'), null);
      const count = calls.length;
      const warm = await realBuildContext({binding});
      assert.equal(await warm.resolveFile('_layouts/default.html'), sha);
      assert.equal(await warm.resolveFile('missing.txt'), null);
      assert.equal(calls.length, count, 'warm render including negative cache requires no network');
      sha = 'b'.repeat(40);
      const updated = await realBuildContext({binding, refresh:true});
      assert.equal(updated.publicationRevision, sha);
      assert.equal(await updated.resolveFile('_layouts/default.html'), sha);
      assert.equal(first.publicationRevision, 'a'.repeat(40));
    });
  });

  it('inherits the locked theme only after checking publication overrides', async () => {
    const binding = {owner:'o-locked-theme',repo:'r',branch:'c'.repeat(40)};
    await withStubFetch(url => {
      if (url.includes('_config.yml')) return apiFileResponse('url: https://pub.example\ntheme: jekyll-theme-chirpy');
      if (url.includes('Gemfile.lock')) return apiFileResponse('    jekyll-theme-chirpy (7.5.0)');
      if (url.startsWith(CHIRPY_CDN)) {
        assert.ok(url.includes('@v7.5.0/'));
        return fakeResponse({status:200,body:'LOCKED THEME'});
      }
      return fakeResponse({status:404});
    }, async calls => {
      const ctx = await realBuildContext({binding});
      assert.equal(await ctx.resolveFile('_includes/head.html'), 'LOCKED THEME');
      const probes = calls.filter(c=>c.url.includes('_includes/head.html'));
      assert.ok(probes[0].url.includes('api.github.com'));
      assert.ok(probes[1].url.includes('@v7.5.0/'));
    });
  });

  it('offline refresh retains the last coherent commit and reports it', async () => {
    const binding = {owner:'o-offline-revision',repo:'r',branch:'main'};
    const sha = 'd'.repeat(40);
    await repoCache.put(repoCache.makeKey({...binding,ref:'main',path:'@preview-revision'}), {content:sha,fetchedAt:0,source:'revision'});
    await seedContextBasics({...binding,branch:sha,at:0});
    await withStubFetch(()=>{throw new TypeError('offline');}, async () => {
      const ctx = await realBuildContext({binding,refresh:true});
      assert.equal(ctx.publicationRevision,sha);
      assert.equal(ctx.config.title,'seeded');
      assert.equal(ctx.frameworkAssetOrigin,'https://entreluma.org');
      assert.equal(ctx.mediaAssetBase,`https://raw.githubusercontent.com/${binding.owner}/r/${sha}/`);
      assert.ok(ctx.diagnostics.some(d=>d.level==='warn' && d.message.includes('cached revision')));
    });
  });
});

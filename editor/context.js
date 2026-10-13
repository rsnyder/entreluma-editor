/** Publication-first preview context. Repository reads are pinned to one commit.
 * Missing templates inherit from the publication's remote theme or locked Chirpy
 * version. Unbound drafts use the versioned framework bundled with the editor.
 * Diagnostics and provenance remain live throughout lazy template resolution.
 */
import { repoCache } from './store.js';
import * as github from './github.js';
import { load as yamlLoad } from 'js-yaml';
import {resolvePreviewRevision} from './preview-revision.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Cache entries younger than this are served without revalidation. */
const FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes

/** This starter's canonical repo — the unbound-mode content source. */
const STARTER = { owner: 'rsnyder', repo: 'entreluma', branch: 'main' };

/** Pseudo-binding used to namespace unbound-mode repoCache keys. */
const UNBOUND = { owner: 'unbound', repo: 'entreluma', branch: 'preview-bundle-2026-09-10' };

/** Chirpy gem version on jsDelivr — mirror of preview/index.html:CHIRPY_VERSION. */
const CHIRPY_VERSION = 'v7.6.0';
const GEM_BASE = `https://cdn.jsdelivr.net/gh/cotes2020/jekyll-theme-chirpy@${CHIRPY_VERSION}/`;

// ── Small helpers ────────────────────────────────────────────────────────────

/** Percent-encode a repo-relative path, preserving '/' as a segment separator. */
function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

/** Parse YAML text into an object; never throws (returns {} on error). */
function parseYaml(text, options = {}) {
  if (!text) return {};
  try {
    return yamlLoad(text, options) || {};
  } catch {
    return {};
  }
}

function fmtDate(ms) {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

/**
 * skrender's createResolveFileCache, obtained lazily. skrender.js runs
 * `window.markdownit(...)` at module top-level, so importing it eagerly would
 * force the render globals to exist wherever context.js is imported (including
 * the buildless unit-test page and scaffold's import-smoke test). We therefore
 * import it only when a context is actually built, and fall back to an inline
 * identical implementation if the import fails (globals not yet loaded) — the
 * memoization semantics are what matter, and they are preserved either way.
 * The resolved wrapper is memoized across calls.
 */
let _cachedWrap = null;
async function getResolveFileCacheWrapper() {
  if (_cachedWrap) return _cachedWrap;
  // ONLY attempt the import when skrender's evaluation preconditions hold:
  // its module top-level calls window.markdownit(...). Importing before the
  // classic globals are loaded doesn't just fail — the THROWING evaluation is
  // permanently cached in the realm's module map (module poisoning), so every
  // later import of skrender rethrows even after the globals arrive. That
  // would break the preview for the whole session on any call-order slip.
  const globalsReady = typeof window !== 'undefined'
    && typeof window.markdownit === 'function'
    && !!window.liquidjs && !!window.jsyaml;
  if (globalsReady) {
    try {
      const mod = await import('../assets/js/skrender.js');
      if (typeof mod.createResolveFileCache === 'function') {
        _cachedWrap = mod.createResolveFileCache;
        return _cachedWrap;
      }
    } catch {
      // unexpected import failure — use the local copy below.
    }
  }
  // Local copy this call; don't memoize it as final — globals may be loaded
  // by preview.js before the next buildContext, letting skrender's own
  // implementation take over then.
  return localCreateResolveFileCache;
}

/** Inline copy of skrender's createResolveFileCache (per-session memoization). */
function localCreateResolveFileCache(resolveFile) {
  const cache = new Map();
  return function cachedResolveFile(repoRelPath) {
    if (cache.has(repoRelPath)) return cache.get(repoRelPath);
    const p = Promise.resolve()
      .then(() => resolveFile(repoRelPath))
      .then((v) => (v == null ? null : v))
      .catch(() => null);
    cache.set(repoRelPath, p);
    return p;
  };
}

// ── Network fetchers (impure edges) ──────────────────────────────────────────

/**
 * Fetch a gem file from the Chirpy CDN (jsDelivr). Immutable per version, so no
 * conditional request is needed.
 * @returns {Promise<string|null>}
 */
async function fetchGem(path, base = GEM_BASE) {
  const resp = await globalThis.fetch(`${base}${encodePath(path)}`);
  if (resp.ok) return await resp.text();
  if (resp.status === 404) return null;
  throw new Error(`Theme fetch failed (${resp.status}).`);
}

// ── The resolveFile chain ────────────────────────────────────────────────────

/**
 * Build the raw (pre-memoization) resolveFile.
 *
 * @param {object} args
 * @param {boolean} args.bound        — true: probe GitHub; false: probe raw.
 * @param {{owner,repo,branch}} args.fetchCoords — coordinates for the fetch URLs
 *   (bound: the bound repo; unbound: the STARTER repo).
 * @param {{owner,repo,branch}} args.keyBinding  — coordinates for the repoCache
 *   key (bound: same as fetchCoords; unbound: the UNBOUND pseudo-binding).
 * @param {(level,message)=>void} args.pushDiag  — sink for offline/stale diagnostics.
 * @returns {(path:string)=>Promise<string|null>} never throws.
 */
function makeRawResolve({ bound, fetchCoords, keyBinding, pushDiag, theme, provenance }) {
  const { owner, repo, branch } = fetchCoords;

  async function putCache(key, value) {
    try {
      await repoCache.put(key, value);
    } catch {
      /* IndexedDB unavailable — non-fatal; the network layer still works. */
    }
  }

  async function resolveFromGem({ path, key, now }) {
    if (!theme.base || !/^_(layouts|includes|data)\//.test(path)) {
      await putCache(key, {content: null, fetchedAt: now, source: 'negative', themeBase: theme.base});
      return null;
    }
    const text = await fetchGem(path, theme.base);
    provenance.set(path, {source: text == null ? 'missing' : 'theme', revision: theme.base});
    if (text == null) {
      // Absent everywhere — negative-cache so nested probing doesn't refetch.
      await putCache(key, { etag: '', content: null, fetchedAt: now, source: 'negative', themeBase: theme.base });
      return null;
    }
    await putCache(key, { etag: '', content: text, fetchedAt: now, source: 'gem', themeBase: theme.base });
    return text;
  }

  async function resolveFromNetwork({ path, key, cached, now }) {
    if (bound) {
      const etag = cached && cached.source === 'github' ? cached.etag : undefined;
      const res = await github.getFile({ owner, repo, ref: branch, path, etag });
      if (res === 'not-modified') {
        await putCache(key, { ...cached, fetchedAt: now });
        return cached.content;
      }
      if (res === null) {
        // Not in the repo — mirror the shell's repo→CDN fallback.
        return resolveFromGem({ path, key, now });
      }
      provenance.set(path, {source: 'publication', revision: branch});
      await putCache(key, { etag: res.etag || '', content: res.content, fetchedAt: now, source: 'github' });
      return res.content;
    }

    // An unbound draft uses the versioned framework shipped with this editor.
    const response = await fetch(new URL(`./framework/${path}`, import.meta.url));
    if (!response.ok && response.status !== 404) throw new Error('Bundled framework unavailable.');
    const content = response.ok ? await response.text() : null;
    if (content == null) return resolveFromGem({path, key, now});
    provenance.set(path, {source: 'bundled-framework'});
    await putCache(key, {etag: '', content, fetchedAt: now, source: 'bundle'});
    return content;
  }

  return async function rawResolve(path) {
    const key = repoCache.makeKey({
      owner: keyBinding.owner,
      repo: keyBinding.repo,
      ref: keyBinding.branch,
      path,
    });

    let cached = null;
    try {
      cached = await repoCache.get(key);
    } catch {
      cached = null;
    }

    const now = Date.now();
    const matchesTheme = !['gem', 'negative'].includes(cached?.source) || cached.themeBase === theme.base;
    const immutable = /^[a-f0-9]{40}$/.test(fetchCoords.branch) && ['github', 'negative', 'gem'].includes(cached?.source);
    if (cached && matchesTheme && (immutable || now - cached.fetchedAt < FRESHNESS_MS)) {
      // Fresh — serve without revalidation (content may be null for a negative).
      provenance.set(path, {source: cached.source, revision: fetchCoords.branch, cached: true});
      return cached.content ?? null;
    }

    try {
      return await resolveFromNetwork({ path, key, cached, now });
    } catch {
      // Any connectivity/auth/rate-limit failure (GitHubError or a raw/CDN
      // fetch throw): prefer stale cache, else surface an incomplete-context
      // warning. resolveFile must never throw.
      if (cached && matchesTheme && cached.content != null) {
        pushDiag('warn', `offline: serving stale cache from ${fmtDate(cached.fetchedAt)} (${path})`);
        return cached.content;
      }
      pushDiag('warn', `offline: context incomplete — ${path} unavailable`);
      return null;
    }
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a skrender context for the editor's preview pane.
 *
 * @param {{ binding: { owner: string, repo: string, branch?: string } | null }} args
 *   binding: the repo the document is bound to, or null for unbound drafts.
 * @returns {Promise<object>} the skrender context (shape documented above).
 */
export async function buildContext({ binding, refresh = false, resolveRevision = resolvePreviewRevision } = {}) {
  const diagnostics = [];
  const pushDiag = (level, message) => {
    if (!diagnostics.some((d) => d.message === message)) {
      diagnostics.push({ level, stage: 'fetch', message });
    }
  };

  const bound = !!(binding && binding.owner && binding.repo);

  // fetchCoords drive the network URLs; keyBinding namespaces the repoCache.
  // Bound: both are the bound repo. Unbound: fetch the STARTER's real repo but
  // cache under the UNBOUND pseudo-binding so entries can't collide with a real
  // binding to rsnyder/entreluma@main.
  let fetchCoords = bound
    ? { owner: binding.owner, repo: binding.repo, branch: binding.branch || 'main' }
    : { owner: STARTER.owner, repo: STARTER.repo, branch: STARTER.branch };
  let revision = null;
  if (bound) {
    revision = await resolveRevision(fetchCoords, {refresh});
    fetchCoords = {...fetchCoords, branch: revision.ref};
    pushDiag(revision.stale ? 'warn' : 'info', `Publication templates: ${fetchCoords.owner}/${fetchCoords.repo}@${revision.ref.slice(0, 12)}${revision.stale ? ' (cached revision; refresh when online)' : ''}.`);
  } else pushDiag('info', 'Standard Entreluma preview: bundled templates and the standard published Entreluma runtime.');
  if (bound) pushDiag('info', 'Browser preview: styles and viewer scripts come from the deployed publication; repository images come from the bound source revision.');
  const keyBinding = bound ? fetchCoords : UNBOUND;
  const theme = {base: null};
  const provenance = new Map();

  const rawResolve = makeRawResolve({ bound, fetchCoords, keyBinding, pushDiag, theme, provenance });

  const wrap = await getResolveFileCacheWrapper();
  const resolveFile = wrap(async path => {
    const text = await rawResolve(path);
    if (text != null || !/^_includes\/(?:embed\/[\w-]+\.html|media-url\.html)$/.test(path)) return text;
    // Missing viewer includes have an explicitly reported bundled fallback.
    const bundled = await fetch(new URL(`./framework/${path}`, import.meta.url));
    let fallback = bundled.ok ? await bundled.text() : null;
    provenance.set(path, {source: 'bundled-fallback'});
    if (fallback != null) pushDiag('warn', 'Using the standard Entreluma viewer template. Install Entreluma in this repository before publishing viewer tags.');
    return fallback;
  });

  // ── config ────────────────────────────────────────────────────────────────
  const configText = await resolveFile('_config.yml');
  // Jekyll/Psych accepts repeated configuration keys with the last value
  // winning. js-yaml otherwise rejects the entire file (losing url/theme).
  const parsedConfig = parseYaml(configText, { json: true });
  const config = parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig) ? parsedConfig : {};
  // Match the Pages workflow: template identity fields are deliberately blank.
  config.github = { ...config.github, username: fetchCoords.owner, repository: fetchCoords.repo };
  if (bound) {
    const lock = await resolveFile('Gemfile.lock');
    const version = /(?:^|\n)\s+jekyll-theme-chirpy \(([0-9.]+)\)/.exec(lock || '')?.[1];
    const remote = typeof config.remote_theme === 'string' && /^([\w.-]+)\/([\w.-]+)(?:@([\w./-]+))?$/.exec(config.remote_theme);
    if (config.remote_theme && !remote) {
      pushDiag('warn', 'The publication remote_theme declaration is unsupported; inherited templates may be missing.');
    } else if (remote) {
      try {
        const remoteRevision = await resolveRevision({owner: remote[1], repo: remote[2], branch: remote[3] || 'HEAD'}, {refresh});
        theme.base = `https://raw.githubusercontent.com/${remote[1]}/${remote[2]}/${remoteRevision.ref}/`;
      } catch {pushDiag('warn', 'The publication remote theme could not be resolved; inherited templates may be missing.');}
    } else if (!config.theme || config.theme === 'jekyll-theme-chirpy') {
      theme.base = `https://cdn.jsdelivr.net/gh/cotes2020/jekyll-theme-chirpy@v${version || CHIRPY_VERSION.slice(1)}/`;
      if (!version) pushDiag('warn', `No locked Chirpy version was found; inherited templates use ${CHIRPY_VERSION}.`);
    } else pushDiag('warn', `Theme ${config.theme} is not supported by the browser preview; publication overrides remain available.`);
  } else theme.base = GEM_BASE;


  // ── locales (lang from config, default 'en') ────────────────────────────────
  const lang = (config && config.lang) || 'en';
  let [localesText, originText] = await Promise.all([resolveFile(`_data/locales/${lang}.yml`), resolveFile('_data/origin/cors.yml')]);
  let localesLang = lang;
  if (!localesText && lang !== 'en') {
    localesText = await resolveFile('_data/locales/en.yml');
    localesLang = 'en';
  }
  // KEYED BY LANGUAGE: templates index site.data.locales[lang].<path> — a
  // flat (unkeyed) object made every locale string render empty in previews
  // ("2 min read" lost its unit, tooltips lost their labels, …).
  const locales = localesText ? { [localesLang]: parseYaml(localesText) } : null;

  // ── origin (Chirpy head.html reads site.data.origin[type]) ──────────────────
  const origin = originText ? { cors: parseYaml(originText) } : undefined;
  if (origin && config.assets?.self_host?.enabled) {
    const basicText = await resolveFile('_data/origin/basic.yml');
    if (basicText) origin.basic = parseYaml(basicText);
  }

  // ── URL bases ───────────────────────────────────────────────────────────────
  const assetOrigin = (config && config.url) ||
    (typeof location !== 'undefined' ? location.origin : '');
  const baseurl = (config && config.baseurl) || '';
  // Bound: the bound repo's raw base. Unbound: the starter's raw base.
  const rawContentBase =
    `https://raw.githubusercontent.com/${fetchCoords.owner}/${fetchCoords.repo}/${fetchCoords.branch}/`;

  const context = {
    config,
    publicationRevision: revision?.ref || null,
    provenance,
    publication: bound,
    locales,
    assetOrigin,
    baseurl,
    rawContentBase,
    // Workflows can supply the deployed URL only at build time.
    mediaAssetBase: bound ? rawContentBase : undefined,
    resolveFile,
    layouts: new Map(), // empty pre-seed: layouts fall through to resolveFile
    includes: new Map(), // empty pre-seed: includes fall through to resolveFile
    diagnostics,
    // Bound publications retain their deployed viewers, scripts and styles.
    frameworkAssetOrigin: bound && config?.url ? undefined : 'https://entreluma.org',
    // A repository without a configured public site has no compiled theme on
    // the editor host. Borrow only the theme assets, never its content URLs.
    themeAssetOrigin: config?.url ? undefined : 'https://entreluma.org',
  };
  if (context.themeAssetOrigin) {
    pushDiag('warn', 'This repository has no public site URL configured. Preview uses repository images and standard Entreluma viewers and theme; published appearance or behavior may differ.');
  }
  // Match the preview shell: only expose `origin` when the data file was found
  // (skrender omits origin-driven <link> tags when context.origin is undefined).
  if (origin !== undefined) context.origin = origin;

  return context;
}

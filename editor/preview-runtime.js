/** Capability declaration served by the deployed publication (not its source
 * branch). A stale deployment must never be assumed to support local bytes.
 * No credentials are sent; unavailable/CORS-blocked declarations mean fallback.
 */
const cache = new Map();
const TTL = 5 * 60 * 1000;
export async function publicationRuntime(context, {refresh = false} = {}) {
  if (!context?.publication || !context.config?.url) return null;
  let base;
  try {
    base = new URL(String(context.assetOrigin).replace(/\/$/, '') + '/' + String(context.baseurl || '').replace(/^\/|\/$/g, '') + '/');
    base.pathname = base.pathname.replace(/\/+/g, '/');
    if (!['https:', 'http:'].includes(base.protocol)) return null;
  } catch { return null; }
  const key = base.href;
  const previous = cache.get(key);
  if (!refresh && previous && Date.now() - previous.at < TTL) return previous.value;
  const value = (async () => {
    try {
      const response = await fetch(new URL('assets/entreluma-preview.json', base), {
        credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 4096) return null;
      const data = JSON.parse(text);
      if (data.schemaVersion !== 1 || data.host !== 1) return null;
      return {base: key, localImage: data.localImage === 1, localMap: data.localMap === 1};
    } catch { return null; }
  })();
  cache.set(key, {at: Date.now(), value});
  return value;
}

/** Declarations apply only to the publication's standard runtime paths. */
export function supportsLocalViewer(runtime, url, kind) {
  if (!runtime || !runtime[kind === 'image' ? 'localImage' : 'localMap']) return false;
  const expected = new URL(`assets/components/${kind}.html`, runtime.base);
  return url.origin === expected.origin && url.pathname.replace(/\.html$/, '') === expected.pathname.replace(/\.html$/, '');
}

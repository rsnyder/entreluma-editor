/** Fetch only visible OSM tiles outside the opaque preview sandbox.
 * Browser caching and an origin-only Referer identify the actual editor site.
 * No editor credentials, document URLs, or arbitrary fetch capability cross it.
 */
export function attachMapTiles(frame, host = window) {
  const pending = new Map();
  const controllers = new Set();
  let active = true;
  function belongsToPreview(source) {
    try {
      for (let depth = 0; source && depth < 8; depth++) {
        if (source === frame.contentWindow) return true;
        if (source === source.parent) break;
        source = source.parent;
      }
    } catch {}
    return false;
  }
  async function receive(event) {
    const data = event.data;
    if (!active || data?.kind !== 'entreluma-osm-tile' || !belongsToPreview(event.source)) return;
    const { z, x, y, id } = data;
    if (typeof id !== 'string' || id.length > 100 || ![z,x,y].every(Number.isInteger) ||
        z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return;
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const reply = payload => {
      if (active && belongsToPreview(event.source)) event.source.postMessage({kind:'entreluma-osm-tile-result', id, ...payload}, '*');
    };
    try {
      if (!pending.has(url)) {
        if (pending.size >= 64) throw new Error('Too many map tiles requested.');
        const controller = new AbortController(); controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 15000);
        const request = fetch(url, {credentials:'omit', referrerPolicy:'strict-origin', signal:controller.signal})
          .then(async response => {
            if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Map tile unavailable.');
            const blob = await response.blob();
            if (blob.size > 2 * 1024 * 1024) throw new Error('Map tile too large.');
            return blob;
          }).finally(() => {clearTimeout(timer); controllers.delete(controller); pending.delete(url);});
        pending.set(url, request);
      }
      reply({blob:await pending.get(url)});
    } catch { reply({error:'Map tile unavailable.'}); }
  }
  host.addEventListener('message', receive);
  return () => {active=false; host.removeEventListener('message', receive); for (const c of controllers) c.abort(); pending.clear();};
}

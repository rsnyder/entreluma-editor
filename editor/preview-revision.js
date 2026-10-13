import {repoCache} from './store.js';
import {getPreviewRevision} from './github.js';
const TTL = 5 * 60 * 1000;
const pending = new Map();
/** Cache a branch head separately from immutable file contents. Offline uses
 * the last known commit, never a mixture of files read from a moving branch. */
export async function resolvePreviewRevision(binding, {refresh = false} = {}) {
  if (/^[a-f0-9]{40}$/.test(binding.branch || '')) return {ref: binding.branch};
  const key = repoCache.makeKey({...binding, ref: binding.branch || 'main', path: '@preview-revision'});
  const cached = await repoCache.get(key).catch(() => null);
  if (!refresh && cached && /^[a-f0-9]{40}$/.test(cached.content) && Date.now() - cached.fetchedAt < TTL) return {ref: cached.content};
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const {sha} = await getPreviewRevision(binding);
      if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid repository revision.');
      await repoCache.put(key, {content: sha, fetchedAt: Date.now(), source: 'revision'}).catch(() => {});
      return {ref: sha};
    } catch (error) {
      if (cached && /^[a-f0-9]{40}$/.test(cached.content)) return {ref: cached.content, stale: true};
      throw new Error('Could not resolve the publication revision. Check your connection and repository access, then retry the preview.');
    } finally {pending.delete(key);}
  })();
  pending.set(key, request);
  return request;
}

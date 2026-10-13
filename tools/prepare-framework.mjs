/** Materialize the versioned starter dependency for builds and integration tests. */
import { cp, readdir, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const fixture = new URL('../tests/fixtures/starter/', import.meta.url);
for (const entry of await readdir(fixture)) {
  if (entry === 'SOURCE.json') continue;
  await cp(new URL(entry, fixture), new URL(entry, root), { recursive: true });
}
// Test fixtures are inputs, not a second set of Jekyll posts.
const configPath = new URL('_config.yml', root);
await writeFile(configPath, (await readFile(configPath, 'utf8')).replace('exclude:\n', 'exclude:\n  - tests\n'));
console.log('Prepared pinned Entreluma framework fixture.');

// The same public template bundle is served in development and deployments.
const bundle = new URL('editor/framework/', root);
await rm(bundle, {recursive: true, force: true});
await mkdir(bundle, {recursive: true});
for (const path of ['_includes', '_layouts', '_data', '_config.yml']) {
  await cp(new URL(path, fixture), new URL(path, bundle), {recursive: true});
}

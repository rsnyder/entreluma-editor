import '../../../tools/prepare-framework.mjs';
/** Copy only public application assets; never publish the repository root. */
import { cp, mkdir, rm } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const output = new URL('../.editor-assets/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../public/', import.meta.url), output, { recursive: true });
for (const path of ['editor', 'assets/js', 'assets/components', 'assets/css', 'assets/img']) {
  await cp(new URL(path, root), new URL(path, output), { recursive: true });
}
console.log('Built editor staging assets.');

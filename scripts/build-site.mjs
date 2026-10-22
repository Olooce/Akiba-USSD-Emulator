import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public');
const ENTRIES = ['index.html', 'styles', 'assets', 'dist'];

await rm(OUT, { recursive: true, force: true });
for (const entry of ENTRIES) {
  await cp(join(ROOT, entry), join(OUT, entry), { recursive: true });
}
console.log(`Static site written to ${OUT}`);

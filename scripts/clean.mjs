import { rm } from 'node:fs/promises';
// Do not ship stale files left over from an earlier build.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });

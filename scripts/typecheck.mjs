// Runs the TypeScript check. A local browser run leaves files in .next/dev/types that describe the routes at that
// moment; once routes change they fail the check for reasons unrelated to the code, so they are cleared first.
// `npm run build` makes its own fresh copies afterwards.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

for (const stale of ['.next/dev/types', '.next/dev/dev/types']) rmSync(stale, { recursive: true, force: true });

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '--noEmit', '--incremental', 'false'], { stdio: 'inherit' });
process.exit(result.status ?? 1);

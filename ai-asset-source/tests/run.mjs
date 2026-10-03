import { build } from 'esbuild';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(path.join(root, 'node_modules', '.asset-tests-'));
try {
  const files = (await readdir(path.join(root, 'tests'))).filter((name) =>
    /\.test\.tsx?$/.test(name),
  );
  await build({
    entryPoints: files.map((name) => path.join(root, 'tests', name)),
    outdir: output,
    bundle: true,
    platform: 'node',
    jsx: 'automatic',
    format: 'esm',
    packages: 'external',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'mock-datocms-frame',
        setup(builder) {
          builder.onResolve({ filter: /^datocms-react-ui$/ }, () => ({
            path: path.join(root, 'tests', 'uiMocks.tsx'),
          }));
        },
      },
    ],
  });
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      ...files.map((name) => path.join(output, name.replace(/\.tsx?$/, '.js'))),
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}

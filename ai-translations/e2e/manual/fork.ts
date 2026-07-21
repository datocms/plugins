/**
 * fork.ts — `npm run test:e2e:manual [vendor]`
 * -------------------------------------------
 * Forks a throwaway environment from `main` for MANUAL testing, pins the plugin
 * in it to one provider, and opens your default browser at it.
 *
 * Same machinery the Playwright suite uses (`forkAll`, `configureEnvForProvider`),
 * with two deliberate differences: the environment is named `manual-e2e-*` so the
 * suite's stale sweep can never reap it, and nothing tears it down — that is what
 * `npm run test:e2e:manual:cleanup` is for.
 *
 * The plugin is installed as a dev-URL plugin (http://localhost:5173), so its
 * iframe is blank unless Vite is serving. We reuse a running Vite if there is one
 * and otherwise start it, mirroring Playwright's `reuseExistingServer: true`.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { PROVIDERS, type ProviderSpec } from '../tests/fixtures/providers';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../tests/setup/constants';
import { requireEnv } from '../tests/setup/env';
import { forkAll } from '../tests/setup/fork-environments';
import { phase } from '../tests/setup/log';
import {
  configureEnvForProvider,
  resolvePluginId,
} from '../tests/setup/plugin-params';
import { manualEnvName } from './manual-env';

const TAG = 'manual';
const DEV_SERVER_URL = 'http://localhost:5173';

/** True when something is already serving the plugin's dev URL. */
const isViteRunning = async (): Promise<boolean> => {
  try {
    await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
};

/** Poll the dev URL until it answers, bounded by `TIMEOUTS.one_min`. */
const waitForVite = async (): Promise<void> => {
  const deadline = Date.now() + TIMEOUTS.one_min;
  while (Date.now() < deadline) {
    if (await isViteRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite never came up on ${DEV_SERVER_URL} (waited 60s).`);
};

/** Spawn `npm run dev` in the foreground, inheriting stdio so its log is visible. */
const startVite = (): ChildProcess => {
  const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
  return child;
};

/** Open `url` in the OS default browser, detached so it never blocks this process. */
const openBrowser = (url: string): void => {
  const isWindows = process.platform === 'win32';
  const command = isWindows
    ? 'start'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  // `start` is a shell builtin and treats its first quoted arg as the window title.
  const args = isWindows ? ['', url] : [url];
  spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    shell: isWindows,
  }).unref();
};

/**
 * Pick the provider lane to pin the sandbox to: the requested vendor, or the
 * first one whose API key is present in `.env.testing`.
 */
const resolveLane = (requested?: string): ProviderSpec => {
  if (PROVIDERS.length === 0) {
    throw new Error(
      'No provider API keys found in .env.testing — set at least one of ' +
        'OPENAI, GEMINI, DEEPL, CLAUDE.',
    );
  }
  if (!requested) return PROVIDERS[0];

  const spec = PROVIDERS.find((p) => p.vendor === requested);
  if (!spec) {
    throw new Error(
      `No API key in .env.testing for vendor "${requested}". ` +
        `Lanes you have keys for: ${PROVIDERS.map((p) => p.vendor).join(', ')}.`,
    );
  }
  return spec;
};

const main = async (): Promise<void> => {
  requireEnv();
  const spec = resolveLane(process.argv[2]?.trim());
  const envName = manualEnvName();

  // Vite first: if it can't start, we bail BEFORE forking and leave no orphan env.
  let vite: ChildProcess | undefined;
  if (await isViteRunning()) {
    phase(`vite already serving ${DEV_SERVER_URL} — reusing it`, TAG);
  } else {
    phase('vite is not running — starting `npm run dev`…', TAG);
    vite = startVite();
    await waitForVite();
    phase(`${DEV_SERVER_URL} ready ✓`, TAG);
  }

  const pluginId = await resolvePluginId();

  try {
    await forkAll([envName]);
    await configureEnvForProvider(envName, spec);
  } catch (error) {
    throw new Error(
      `Setup failed after the fork was requested. Environment "${envName}" may ` +
        `exist — run \`npm run test:e2e:manual:cleanup\` to reclaim it.\n` +
        `Cause: ${(error as Error).message}`,
    );
  }

  const base = `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${envName}`;
  const editorUrl = `${base}/editor`;
  const settingsUrl = `${base}/configuration/plugins/${pluginId}/edit`;

  openBrowser(editorUrl);

  phase(`sandbox ready — pinned to ${spec.vendor}`, TAG);
  console.log(`\n  content   ${editorUrl}`);
  console.log(`  settings  ${settingsUrl}`);
  console.log(`\n  environment: ${envName}`);
  console.log('  destroy it with: npm run test:e2e:manual:cleanup\n');

  if (vite) {
    console.log('vite is running in this terminal — Ctrl-C to stop it.');
    console.log('(the environment survives Ctrl-C; only cleanup destroys it)\n');
    return; // the child process keeps this one alive
  }
  // Nothing left to hold the loop open, but undici's keep-alive sockets would
  // stall the exit for a few seconds. We are done — leave now.
  process.exit(0);
};

main().catch((error: Error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
});

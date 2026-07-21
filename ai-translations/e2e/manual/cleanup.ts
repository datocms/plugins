/**
 * cleanup.ts — `npm run test:e2e:manual:cleanup`
 * ---------------------------------------------
 * Interactive teardown for the sandboxes `fork.ts` creates.
 *
 * Lists every `manual-e2e-*` environment regardless of age (they are exempt from
 * the suite's stale sweep by design, so this is the only thing that reclaims
 * them), prints each with its age, and destroys them all on an explicit `y`.
 *
 * The printed list IS the safeguard: it is the last thing between a broadened
 * `isManualEnv` and someone's live `e2e-<vendor>-*` suite lane. Never destroy
 * without showing the list first.
 */

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { cmaClient } from '../tests/setup/cma';
import { requireEnv } from '../tests/setup/env';
import { destroyEnv } from '../tests/setup/fork-environments';
import { isManualEnv } from './manual-env';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Coarse relative age, e.g. `3h ago` / `2d ago`, for the confirmation list. */
const ageLabel = (createdAt: string | undefined): string => {
  const created = Date.parse(createdAt ?? '');
  if (!Number.isFinite(created)) return 'age unknown';

  const elapsed = Date.now() - created;
  if (elapsed < MS_PER_HOUR) return `${Math.round(elapsed / 60_000)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.round(elapsed / MS_PER_HOUR)}h ago`;
  return `${Math.round(elapsed / MS_PER_DAY)}d ago`;
};

const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
};

const main = async (): Promise<void> => {
  requireEnv();

  const environments = (await cmaClient().environments.list()).filter((env) =>
    isManualEnv(env.id),
  );

  if (environments.length === 0) {
    console.log('\nNo manual-e2e-* environments found — nothing to clean up.\n');
    return;
  }

  console.log(`\nFound ${environments.length} manual environment(s):\n`);
  for (const env of environments) {
    console.log(`  ${env.id}  (created ${ageLabel(env.meta.created_at)})`);
  }

  const proceed = await confirm(
    `\nDestroy all ${environments.length}? [y/N] `,
  );
  if (!proceed) {
    console.log('\nAborted — nothing was destroyed.\n');
    return;
  }

  console.log('');
  const failures: string[] = [];
  for (const env of environments) {
    try {
      await destroyEnv(env.id);
      console.log(`  ✓ destroyed ${env.id}`);
    } catch (error) {
      failures.push(`${env.id}: ${(error as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ could not destroy:\n  ${failures.join('\n  ')}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone — ${environments.length} environment(s) destroyed.\n`);
};

main().catch((error: Error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
});

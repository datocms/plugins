import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { ProviderCall } from './providerTap';

/** USD per million tokens. Add a model here before a live test may use it. */
const PRICES: Record<
  string,
  { input: number; output: number; longInput?: number; longOutput?: number }
> = {
  // $0.50 / $2.50 above 100K prompt tokens.
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    longInput: 0.5,
    longOutput: 2.5,
  },
};

/** Stops every live run once a provider key's recorded spend reaches this. */
export const SPEND_CAP_USD = Number(process.env.E2E_SPEND_CAP_USD ?? 10);

const LEDGER = new URL('../.spend.jsonl', import.meta.url);

/** Estimated cost of one call: cache writes at 1.25× input, cache reads at 0.1×. */
export function callCost(call: ProviderCall): number {
  const price = PRICES[call.model];
  if (!price) throw new Error(`No price for ${call.model} in e2e/lib/spend.ts`);
  const prompt =
    call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens;
  const isLong = prompt > 100_000 && price.longInput !== undefined;
  const input = isLong ? (price.longInput ?? price.input) : price.input;
  const output = isLong ? (price.longOutput ?? price.output) : price.output;
  return (
    (call.inputTokens * input +
      call.cacheWriteTokens * input * 1.25 +
      call.cacheReadTokens * input * 0.1 +
      call.outputTokens * output) /
    1_000_000
  );
}

/** Total recorded spend per provider, across all runs on this machine. */
export function recordedSpend(): Record<ProviderCall['provider'], number> {
  const totals = { anthropic: 0, openai: 0 };
  if (!existsSync(LEDGER)) return totals;
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line) continue;
    const entry = JSON.parse(line) as {
      provider: ProviderCall['provider'];
      usd: number;
    };
    totals[entry.provider] += entry.usd;
  }
  return totals;
}

/** Throws before a run when the provider's ledger already reached the cap. */
export function assertUnderCap(provider: ProviderCall['provider']): void {
  const spent = recordedSpend()[provider];
  if (spent >= SPEND_CAP_USD)
    throw new Error(
      `Live-test spend for ${provider} is $${spent.toFixed(2)}, at or above the $${SPEND_CAP_USD} cap (E2E_SPEND_CAP_USD).`,
    );
}

/** Appends one line per call to the git-ignored ledger and returns the run's cost. */
export function recordCalls(
  label: string,
  calls: readonly ProviderCall[],
): number {
  let total = 0;
  for (const call of calls) {
    const usd = callCost(call);
    total += usd;
    appendFileSync(
      LEDGER,
      `${JSON.stringify({ at: new Date().toISOString(), label, ...call, usd })}\n`,
    );
  }
  return total;
}

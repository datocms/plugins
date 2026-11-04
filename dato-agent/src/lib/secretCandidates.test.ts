import { generateId } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { findSecretCandidates, redactValues } from './secretCandidates';

// Fake, random-looking values; none is a real credential.
const PASTED_KEY = 'xK9mQ2vL7pR4tZ8wN3bY6cF1hJ5dS0gA';
const OTHER_TOKEN = 'aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY';

const serialize = (value: unknown) => JSON.stringify(value, null, 2);

describe('findSecretCandidates', () => {
  it('flags long random-looking tokens anywhere, with a safe preview and path', () => {
    const candidates = findSecretCandidates(
      serialize({
        conversation: [{ text: `here is my key ${PASTED_KEY} please use it` }],
        turn: {
          events: [
            { output: `token=${OTHER_TOKEN}` },
            { output: `again ${PASTED_KEY}` },
          ],
        },
      }),
    );

    expect(candidates.map((candidate) => candidate.value).sort()).toEqual(
      [PASTED_KEY, OTHER_TOKEN].sort(),
    );
    const pasted = candidates.find(
      (candidate) => candidate.value === PASTED_KEY,
    );
    expect(pasted).toMatchObject({
      preview: `…${PASTED_KEY.slice(-4)} · ${PASTED_KEY.length} chars`,
      path: 'conversation[0].text',
      occurrences: 2,
    });
    expect(pasted?.preview).not.toContain(PASTED_KEY.slice(0, 8));
  });

  it('skips DatoCMS IDs, identifier keys, words, paths and URLs', () => {
    const recordId = generateId();
    const candidates = findSecretCandidates(
      serialize({
        mention: `see record ${recordId}`,
        script:
          'script://dato-agent/238763/primary/conversation%3A2ae6507d-2d04-4751-a5f3-7b809c9cfe92/x.ts',
        siteId: PASTED_KEY,
        itemIds: [OTHER_TOKEN],
        currentRecord: { id: PASTED_KEY },
        prose: 'Internationalization considerations notwithstanding everything',
        stack: 'at runTurn (dato-agent/src/lib/agentRuntime.ts:4873:21)',
        url: 'https://site-api.datocms.com/items?filter[type]=article&page[limit]=100',
        timestamp: '2026-11-03T22:05:03.968Z',
        siteName: 'claude-prtest-recordbin-2026-11-03',
        hostContexts: [{ fingerprint: 'a1b2c3d4e5f6a7b8c9d0-12d' }],
      }),
    );

    expect(candidates).toEqual([]);
  });

  it('still flags secrets under keys that merely end in "id"-like words', () => {
    const candidates = findSecretCandidates(
      serialize({ valid: PASTED_KEY, paid: OTHER_TOKEN }),
    );
    expect(candidates).toHaveLength(2);
  });
});

describe('redactValues', () => {
  it('replaces every occurrence of the chosen values only', () => {
    const serialized = serialize({
      a: PASTED_KEY,
      b: `x ${PASTED_KEY}`,
      c: OTHER_TOKEN,
    });
    const redacted = redactValues(serialized, [PASTED_KEY]);

    expect(redacted).not.toContain(PASTED_KEY);
    expect(redacted).toContain(OTHER_TOKEN);
    expect(redactValues(serialized, [])).toBe(serialized);
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultPrompt,
  legacyDefaultPrompts,
  upgradeLegacyDefaultPrompt,
} from './DefaultPrompt';

describe('upgradeLegacyDefaultPrompt', () => {
  it('replaces the previous default with the current one', () => {
    expect(upgradeLegacyDefaultPrompt(legacyDefaultPrompts[0])).toBe(
      defaultPrompt,
    );
    expect(defaultPrompt).toContain('{glossary}');
  });

  it('keeps customised prompts', () => {
    const custom = `${legacyDefaultPrompts[0]}\nBe formal.`;
    expect(upgradeLegacyDefaultPrompt(custom)).toBe(custom);
    expect(upgradeLegacyDefaultPrompt(defaultPrompt)).toBe(defaultPrompt);
  });

  it('differs from the current default only by the glossary slot', () => {
    expect(defaultPrompt.replace('{glossary}\n\n', '')).toBe(
      legacyDefaultPrompts[0],
    );
  });
});

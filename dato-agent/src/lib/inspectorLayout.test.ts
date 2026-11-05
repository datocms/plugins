import { describe, expect, it } from 'vitest';
import { inspectorRecordPaneWidth } from './inspectorLayout';

describe('inspectorRecordPaneWidth', () => {
  it.each([
    [1710, 1410],
    [1440, 1140],
    [1280, 980],
  ])(
    'starts the agent at 300px beside a %ipx browser',
    (browserWidth, expected) => {
      expect(inspectorRecordPaneWidth(browserWidth)).toBe(expected);
    },
  );

  it('preserves the CMS minimum record width on a narrow browser', () => {
    expect(inspectorRecordPaneWidth(800)).toBe(550);
  });

  it('uses a desktop fallback when browser sizing is unavailable', () => {
    expect(inspectorRecordPaneWidth(undefined)).toBe(1140);
    expect(inspectorRecordPaneWidth(Number.NaN)).toBe(1140);
  });
});

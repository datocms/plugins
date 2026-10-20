import { describe, expect, it } from 'vitest';
import { inspectorRecordPaneWidth } from './inspectorLayout';

describe('inspectorRecordPaneWidth', () => {
  it.each([
    [1710, 770],
    [1440, 648],
    [1280, 576],
  ])(
    'gives the record pane about 45% of a %ipx browser',
    (browserWidth, expected) => {
      expect(inspectorRecordPaneWidth(browserWidth)).toBe(expected);
    },
  );

  it('keeps the CMS minimum record width when 45% would be narrower', () => {
    expect(inspectorRecordPaneWidth(1200)).toBe(550);
  });

  it('keeps the record pane at its minimum on a narrow browser', () => {
    expect(inspectorRecordPaneWidth(800)).toBe(550);
    expect(inspectorRecordPaneWidth(1110)).toBe(550);
  });

  it('uses a desktop fallback when browser sizing is unavailable', () => {
    expect(inspectorRecordPaneWidth(undefined)).toBe(648);
    expect(inspectorRecordPaneWidth(Number.NaN)).toBe(648);
  });
});

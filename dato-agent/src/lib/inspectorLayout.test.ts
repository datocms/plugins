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

  it('keeps the chat usable when 45% would leave the record too narrow', () => {
    expect(inspectorRecordPaneWidth(1200)).toBe(560);
  });

  it('splits a narrow browser evenly', () => {
    expect(inspectorRecordPaneWidth(800)).toBe(400);
  });

  it('uses a desktop fallback when browser sizing is unavailable', () => {
    expect(inspectorRecordPaneWidth(undefined)).toBe(648);
    expect(inspectorRecordPaneWidth(Number.NaN)).toBe(648);
  });
});

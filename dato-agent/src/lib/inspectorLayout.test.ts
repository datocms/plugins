import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectorRecordPaneWidth,
  readAgentPaneWidth,
  useRememberedAgentPaneWidth,
} from './inspectorLayout';

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

describe('remembered Agent tab width', () => {
  const resizeTo = ({ inner, outer }: { inner: number; outer: number }) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: inner,
    });
    Object.defineProperty(window, 'outerWidth', {
      configurable: true,
      value: outer,
    });
    window.dispatchEvent(new Event('resize'));
  };

  afterEach(() => localStorage.clear());

  it('leaves the remembered width to the chat when the tab opens', () => {
    expect(inspectorRecordPaneWidth(1440, 500)).toBe(940);
  });

  it('remembers the latest width for every project in this browser', () => {
    resizeTo({ inner: 300, outer: 1440 });
    const { unmount } = renderHook(() => useRememberedAgentPaneWidth());

    resizeTo({ inner: 520, outer: 1440 });
    expect(readAgentPaneWidth()).toBe(520);

    // Some browsers report the iframe's own size as outerWidth during a drag.
    resizeTo({ inner: 610, outer: 610 });
    expect(readAgentPaneWidth()).toBe(610);
    unmount();
  });

  it('does not remember a width too narrow to use', () => {
    resizeTo({ inner: 300, outer: 1440 });
    const { unmount } = renderHook(() => useRememberedAgentPaneWidth());
    resizeTo({ inner: 180, outer: 1440 });
    expect(readAgentPaneWidth()).toBeUndefined();
    unmount();
  });
});

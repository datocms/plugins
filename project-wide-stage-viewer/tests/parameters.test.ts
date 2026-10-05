import { describe, expect, it } from 'vitest';
import {
  buildPageId,
  parseStagePageId,
  readMenuItems,
  serializeMenuItems,
  sidebarLabels,
} from '../src/lib/parameters';

describe('readMenuItems', () => {
  it('reads saved entries and rebuilds their page IDs', () => {
    const items = readMenuItems({
      menuItems: [
        {
          id: 'stale',
          workflowId: 'wf1',
          workflowName: 'Editorial',
          stageId: 'review',
          stageName: 'In review',
          label: '  Reviews  ',
        },
      ],
    });

    expect(items).toEqual([
      {
        id: 'wf.wf1.st.review',
        workflowId: 'wf1',
        workflowName: 'Editorial',
        stageId: 'review',
        stageName: 'In review',
        label: 'Reviews',
        icon: undefined,
      },
    ]);
  });

  it('drops malformed entries and duplicates', () => {
    const items = readMenuItems({
      menuItems: [
        null,
        { workflowId: 'wf1' },
        { workflowId: 'wf1', stageId: 'review' },
        { workflowId: 'wf1', stageId: 'review', label: 'Again' },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].stageName).toBe('review');
  });

  it('returns no entries for missing or unexpected parameters', () => {
    expect(readMenuItems(undefined)).toEqual([]);
    expect(readMenuItems({ menuItems: 'nope' })).toEqual([]);
  });

  it('renames the Font Awesome 5 icons the old settings offered', () => {
    const [item] = readMenuItems({
      menuItems: [{ workflowId: 'wf', stageId: 'st', icon: 'check-circle' }],
    });
    expect(item.icon).toBe('circle-check');
  });
});

describe('page IDs', () => {
  it('round-trips through parseStagePageId', () => {
    expect(parseStagePageId(buildPageId('Z0em-d_Mr', 'in_review'))).toEqual({
      workflowId: 'Z0em-d_Mr',
      stageId: 'in_review',
    });
    expect(parseStagePageId('something-else')).toBeNull();
  });

  it('has no colons, which the sidebar would read as route parameters', () => {
    expect(buildPageId('wf1', 'review')).not.toContain(':');
  });

  it('still opens links saved with the colon format', () => {
    expect(parseStagePageId('wf.wf1.st.review')).toEqual({
      workflowId: 'wf1',
      stageId: 'review',
    });
  });
});

describe('serializeMenuItems', () => {
  it('omits empty labels and icons', () => {
    expect(
      serializeMenuItems([
        {
          id: 'wf.a.st.b',
          workflowId: 'a',
          workflowName: 'A',
          stageId: 'b',
          stageName: 'B',
          label: ' ',
          icon: undefined,
        },
      ]),
    ).toEqual({
      menuItems: [
        {
          id: 'wf.a.st.b',
          workflowId: 'a',
          workflowName: 'A',
          stageId: 'b',
          stageName: 'B',
        },
      ],
    });
  });
});

describe('sidebarLabels', () => {
  const item = (workflowName: string, stageName: string, label?: string) => ({
    id: `wf.${workflowName}.st.${stageName}`,
    workflowId: workflowName,
    workflowName,
    stageId: stageName,
    stageName,
    label,
  });

  it('uses the custom label, then the stage name', () => {
    expect(
      sidebarLabels([item('Editorial', 'Review', 'Needs review')]),
    ).toEqual(['Needs review']);
    expect(sidebarLabels([item('Editorial', 'Review')])).toEqual(['Review']);
  });

  it('adds the workflow name when two stages share a name', () => {
    expect(
      sidebarLabels([item('Editorial', 'Review'), item('Legal', 'Review')]),
    ).toEqual(['Review (Editorial)', 'Review (Legal)']);
  });

  it('keeps labels unique even when everything matches', () => {
    expect(
      sidebarLabels([item('A', 'One', 'Same'), item('A', 'Two', 'Same')]),
    ).toEqual(['Same (A)', 'Same (A) 2']);
  });
});

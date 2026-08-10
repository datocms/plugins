import { describe, expect, it } from 'vitest';
import type { CommentSegment, LocalFileMention } from '../types/mentions';
import {
  segmentsToStoredSegments,
  segmentsToTipTapDoc,
  tipTapDocToFullSegments,
  tipTapDocToSegments,
} from './tipTapSerializer';

const localFile: LocalFileMention = {
  type: 'file',
  id: 'local-file-1',
  filename: 'brief.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  lastModified: 1_786_000_000_000,
};

describe('local file TipTap serialization', () => {
  it('round-trips metadata through full and stored mention forms', () => {
    const segments: CommentSegment[] = [
      { type: 'text', content: 'Read ' },
      { type: 'mention', mention: localFile },
    ];
    const doc = segmentsToTipTapDoc(segments);

    expect(doc.content?.[0]?.content?.[1]).toEqual({
      type: 'fileMention',
      attrs: localFile,
    });
    expect(tipTapDocToFullSegments(doc)).toEqual(segments);
    expect(tipTapDocToSegments(doc)).toEqual(segments);
    expect(segmentsToStoredSegments(segments)).toEqual(segments);
  });
});

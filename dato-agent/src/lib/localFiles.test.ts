import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSessionLocalFiles,
  getSessionLocalFile,
  MAX_SESSION_LOCAL_FILES,
  registerLocalFile,
} from './localFiles';

afterEach(clearSessionLocalFiles);

describe('session local file registry', () => {
  it('keeps the registry bounded and retains recently used files', () => {
    const oldest = registerLocalFile(new File(['oldest'], 'oldest.txt'));
    const recentlyUsed = registerLocalFile(
      new File(['recent'], 'recently-used.txt'),
    );

    for (let index = 0; index < MAX_SESSION_LOCAL_FILES - 2; index += 1) {
      registerLocalFile(new File([String(index)], `file-${index}.txt`));
    }
    expect(getSessionLocalFile(recentlyUsed.id)).toBeDefined();

    const newest = registerLocalFile(new File(['newest'], 'newest.txt'));

    expect(getSessionLocalFile(oldest.id)).toBeUndefined();
    expect(getSessionLocalFile(recentlyUsed.id)).toBeDefined();
    expect(getSessionLocalFile(newest.id)).toBeDefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openModelPage,
  openUsersPage,
} from '@utils/navigationHelpers';

const openSpy = vi.fn();

describe('navigation helpers', () => {
  beforeEach(() => {
    openSpy.mockReset();
    vi.stubGlobal('window', { open: openSpy });
  });

  it('does not open user pages when the internal domain is missing', () => {
    openUsersPage(
      {
        site: { attributes: { internal_domain: null } },
      },
      'user'
    );

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('does not open model pages when the internal domain is missing', () => {
    openModelPage(
      {
        site: { attributes: { internal_domain: null } },
      },
      'model-1',
      false
    );

    expect(openSpy).not.toHaveBeenCalled();
  });
});

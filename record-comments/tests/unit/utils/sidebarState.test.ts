import {
  getSidebarView,
  isLoadSettled,
  type SidebarViewInput,
} from '@utils/sidebarState';
import { describe, expect, it } from 'vitest';

function input(overrides: Partial<SidebarViewInput> = {}): SidebarViewInput {
  return {
    realTimeEnabled: false,
    status: 'connected',
    isLoading: false,
    hasError: false,
    hasLoadedOnce: true,
    isAutoReconnecting: false,
    pendingCount: 0,
    isRetrying: false,
    retryCount: 0,
    ...overrides,
  };
}

describe('isLoadSettled', () => {
  it('waits for the CMA fetch, or for the connection and the first data in real time', () => {
    expect(isLoadSettled(input({ isLoading: true }))).toBe(false);
    expect(isLoadSettled(input())).toBe(true);
    expect(
      isLoadSettled(input({ realTimeEnabled: true, status: 'connecting' })),
    ).toBe(false);
    expect(
      isLoadSettled(
        input({ realTimeEnabled: true, status: 'connected', isLoading: true }),
      ),
    ).toBe(false);
    expect(isLoadSettled(input({ realTimeEnabled: true }))).toBe(true);
  });

  it('never counts a failed load as loaded', () => {
    expect(isLoadSettled(input({ hasError: true }))).toBe(false);
  });
});

describe('getSidebarView', () => {
  it('shows the loading state only before the first load', () => {
    expect(
      getSidebarView(input({ hasLoadedOnce: false, isLoading: true })).phase,
    ).toBe('loading');

    // A refetch after a save keeps the comments, with the header spinner
    const reload = getSidebarView(input({ isLoading: true }));
    expect(reload.phase).toBe('ready');
    expect(reload.busy).toBe(true);

    // A reconnection of real time keeps them too, and says so
    const reconnect = getSidebarView(
      input({ realTimeEnabled: true, status: 'connecting' }),
    );
    expect(reconnect.phase).toBe('ready');
    expect(reconnect.busy).toBe(true);
    expect(reconnect.activity).toBe('Connecting…');
  });

  it('fails the area before the first load, and keeps the comments after it', () => {
    expect(
      getSidebarView(input({ hasLoadedOnce: false, hasError: true })).phase,
    ).toBe('failed');

    const later = getSidebarView(input({ hasError: true }));
    expect(later.phase).toBe('ready');
    expect(later.syncProblem).toBe(true);
  });

  it('tells about an error even while the connection retries by itself', () => {
    // A fatal channel error (a token that is not valid any more) closes the
    // connection, and the hook keeps reconnecting: the problem shows anyway
    const failing = getSidebarView(
      input({
        realTimeEnabled: true,
        status: 'closed',
        hasError: true,
        isAutoReconnecting: true,
      }),
    );
    expect(failing.syncProblem).toBe(true);
    expect(failing.busy).toBe(true);
    expect(failing.activity).toBe('Reconnecting…');

    // A connection that closed with no error and reconnects by itself is
    // only background work
    const reconnecting = getSidebarView(
      input({
        realTimeEnabled: true,
        status: 'closed',
        isAutoReconnecting: true,
      }),
    );
    expect(reconnecting.syncProblem).toBe(false);
    expect(reconnecting.activity).toBe('Reconnecting…');

    const closed = getSidebarView(
      input({ realTimeEnabled: true, status: 'closed' }),
    );
    expect(closed.syncProblem).toBe(true);
    expect(closed.busy).toBe(false);
  });

  it('names the save in progress, and why and how often it retries', () => {
    const saving = getSidebarView(input({ pendingCount: 1 }));
    expect(saving.activity).toBe('Saving…');
    expect(saving.announcement).toBe('Saving…');

    const retryMessage = 'Someone else saved the comments at the same time.';
    const firstRetry = getSidebarView(
      input({ pendingCount: 1, isRetrying: true, retryCount: 1, retryMessage }),
    );
    expect(firstRetry.activity).toBe('Retrying…');
    expect(firstRetry.announcement).toBe(`${retryMessage} Retrying…`);

    // The subtitle stays short, thus the title of a narrow sidebar keeps its
    // room; screen readers also hear the reason
    const laterRetry = getSidebarView(
      input({
        pendingCount: 1,
        isRetrying: true,
        retryCount: 1204,
        retryMessage,
        locale: 'en',
      }),
    );
    expect(laterRetry.activity).toBe('Retrying, attempt 1,204');
    expect(laterRetry.announcement).toBe(
      `${retryMessage} Retrying, attempt 1,204`,
    );

    const idle = getSidebarView(input());
    expect(idle.activity).toBeNull();
    expect(idle.announcement).toBeNull();
  });
});

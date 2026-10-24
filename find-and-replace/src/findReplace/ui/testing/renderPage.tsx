import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import type { BootView, FindReplaceSnapshot } from '../../contract';
import { FindReplaceApp } from '../FindReplaceApp';
import { createFakeController, type FakeController } from './fakeController';
import { type StateId, stateBoot } from './fixtures';
import { createMockCtx, type MockCtx } from './mockCtx';

// The page tests import the mock ctx from here too.
export { createMockCtx, type MockCtx };

type RenderOptions = {
  mock?: MockCtx;
  strict?: boolean;
};

export function renderBoot(boot: BootView, options: RenderOptions = {}) {
  const mock = options.mock ?? createMockCtx();
  const element = <FindReplaceApp ctx={mock.ctx} boot={boot} />;
  const view = render(
    options.strict ? <StrictMode>{element}</StrictMode> : element,
  );
  return { ...view, mock };
}

/** Renders the page for a state fixture (S1–S28) with a fake controller. */
export function renderState(id: StateId, options: RenderOptions = {}) {
  const retry = vi.fn();
  const { boot, controller } = stateBoot(id, retry);
  return { ...renderBoot(boot, options), controller, retry };
}

/** Renders the ready page for any snapshot. */
export function renderSnapshot(
  snapshot: FindReplaceSnapshot,
  options: RenderOptions = {},
): ReturnType<typeof renderBoot> & { controller: FakeController } {
  const controller = createFakeController(snapshot);
  return {
    ...renderBoot({ status: 'ready', controller }, options),
    controller,
  };
}

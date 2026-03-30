import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type RenderResult = {
  container: HTMLDivElement;
  rerender: (nextNode: ReactNode) => void;
  unmount: () => void;
};

export function render(node: ReactNode): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    rerender(nextNode) {
      act(() => {
        root.render(nextNode);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

type HookResult<T> = {
  current: T | null;
};

export function renderHook<T>(
  useHook: () => T
): {
  result: HookResult<T>;
  rerender: () => void;
  unmount: () => void;
} {
  const result: HookResult<T> = { current: null };
  let root: Root | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function HookHarness() {
    result.current = useHook();
    return null;
  }

  root = createRoot(container);

  const renderHarness = () => {
    if (!root) return;

    act(() => {
      root.render(<HookHarness />);
    });
  };

  renderHarness();

  return {
    result,
    rerender() {
      renderHarness();
    },
    unmount() {
      if (!root) return;

      act(() => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
}

export async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

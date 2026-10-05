import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/utils/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

function Screen({ ctx }: { ctx: { label: string } }) {
  return <p>{ctx.label}</p>;
}

describe('mount', () => {
  it('renders only the latest call, whatever order the chunks load in', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    let loadStaleChunk: (module: { default: typeof Screen }) => void = () => {};
    const staleChunk = new Promise<{ default: typeof Screen }>((resolve) => {
      loadStaleChunk = resolve;
    });

    mount(staleChunk, { label: 'stale' });
    mount(Promise.resolve({ default: Screen }), { label: 'latest' });
    await waitFor(() => expect(root).toHaveTextContent('latest'));

    loadStaleChunk({ default: Screen });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(root).toHaveTextContent('latest');
  });

  it('says so instead of staying blank when a chunk fails before anything rendered', async () => {
    vi.resetModules();
    const fresh = await import('../src/utils/mount');
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    fresh.mount(
      Promise.reject(
        new TypeError('Failed to fetch dynamically imported module'),
      ),
      { label: 'never' },
    );

    await waitFor(() =>
      expect(root).toHaveTextContent(fresh.LOAD_ERROR_MESSAGE),
    );
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it('keeps the last good screen when a later chunk fails', async () => {
    vi.resetModules();
    const fresh = await import('../src/utils/mount');
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fresh.mount(Promise.resolve({ default: Screen }), { label: 'good' });
    await waitFor(() => expect(root).toHaveTextContent('good'));

    fresh.mount(Promise.reject(new Error('offline')), { label: 'bad' });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(root).toHaveTextContent('good');
    expect(root).not.toHaveTextContent(fresh.LOAD_ERROR_MESSAGE);
  });
});

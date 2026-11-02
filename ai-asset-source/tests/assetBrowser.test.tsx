import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AssetBrowser from '../src/entrypoints/AssetBrowser';
import { MediaCard, setTestContext } from './uiMocks';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
let renderer: ReactTestRenderer;
let pending: Array<{
  signal: AbortSignal;
  resolve: (response: Response) => void;
}>;
let selections: unknown[];
let toasts: Array<{ type: string; message: string }>;

beforeEach(() => {
  pending = [];
  selections = [];
  toasts = [];
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: globalThis,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  mock.method(console, 'info', () => {});
  mock.method(
    globalThis,
    'fetch',
    (_input: unknown, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        assert.ok(init.signal);
        pending.push({ signal: init.signal, resolve });
      }),
  );
  setTestContext({
    plugin: {
      attributes: {
        parameters: {
          defaultProvider: 'openai',
          providers: {
            openai: {
              apiKey: 'mock-key',
              defaultModel: 'gpt-image-1',
              defaultOutputFormat: 'png',
            },
          },
        },
      },
    },
    site: { attributes: { locales: ['en', 'pt'] } },
    updateHeight() {},
    select(upload: unknown) {
      selections.push(upload);
    },
    async customToast(toast: { type: string; message: string }) {
      toasts.push(toast);
      return null;
    },
  } as unknown as RenderAssetSourceCtx);
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  mock.restoreAll();
});

async function renderPrompt() {
  await act(async () => {
    renderer = create(<AssetBrowser />);
  });
  await act(async () => {
    renderer.root
      .findByType('textarea')
      .props.onChange({ target: { value: 'Mock image prompt' } });
  });
}

function complete(index = 0) {
  pending[index].resolve(
    new Response(
      JSON.stringify({ data: [{ b64_json: png }], output_format: 'png' }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
}

test('an empty prompt shows its error on the field and starts no request', async () => {
  await act(async () => {
    renderer = create(<AssetBrowser />);
  });
  await act(async () => {
    await renderer.root.findByType('form').props.onSubmit();
  });
  assert.equal(pending.length, 0);
  assert.ok(
    JSON.stringify(renderer.toJSON()).includes('Describe the image first'),
  );
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('double submission before React rerender starts only one billable request', async () => {
  await renderPrompt();
  let first: Promise<void> = Promise.resolve();
  let second: Promise<void> = Promise.resolve();
  await act(async () => {
    const submit = renderer.root.findByType('form').props.onSubmit;
    first = submit();
    second = submit();
  });
  assert.equal(pending.length, 1);
  await act(async () => {
    complete();
    await Promise.all([first, second]);
  });
  assert.equal(renderer.root.findAllByType('img').length, 1);
});

test('unmount cancels the provider and a late response cannot change state', async () => {
  await renderPrompt();
  let operation: Promise<void> = Promise.resolve();
  await act(async () => {
    operation = renderer.root.findByType('form').props.onSubmit();
  });
  assert.equal(pending.length, 1);
  await act(async () => {
    renderer.unmount();
  });
  await operation;
  assert.equal(pending[0].signal.aborted, true);
  complete();
  await Promise.resolve();
});

test('cancel settles despite a provider ignoring the signal and unlocks the next request', async () => {
  await renderPrompt();
  let first: Promise<void> = Promise.resolve();
  await act(async () => {
    first = renderer.root.findByType('form').props.onSubmit();
  });
  await act(async () => {
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.includes('Cancel'))
      ?.props.onClick();
    await first;
  });
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].type, 'warning');
  let second: Promise<void> = Promise.resolve();
  await act(async () => {
    second = renderer.root.findByType('form').props.onSubmit();
  });
  assert.equal(pending.length, 2);
  await act(async () => {
    complete(1);
    await second;
  });
  await act(async () => {
    complete(0);
    await Promise.resolve();
  });
  assert.equal(renderer.root.findAllByType('img').length, 1);
});

test('preview failure removes a selected image before import', async () => {
  await renderPrompt();
  let operation: Promise<void> = Promise.resolve();
  await act(async () => {
    operation = renderer.root.findByType('form').props.onSubmit();
  });
  await act(async () => {
    complete();
    await operation;
  });
  const image = renderer.root.findByType('img');
  const uploadDisabled = () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.includes('Add to the Media Area'))
      ?.props.disabled;
  assert.equal(uploadDisabled(), true);
  await act(async () => {
    renderer.root.findByType(MediaCard).props.selection.onSelect();
  });
  assert.equal(uploadDisabled(), false);
  await act(async () => {
    image.props.onError();
  });
  // The image leaves the grid, and nothing is left to add
  assert.equal(renderer.root.findAllByType('img').length, 0);
  assert.equal(uploadDisabled(), undefined);
  assert.equal(selections.length, 0);
});

test('repeated upload callback hands each image off only once', async () => {
  await renderPrompt();
  let operation: Promise<void> = Promise.resolve();
  await act(async () => {
    operation = renderer.root.findByType('form').props.onSubmit();
  });
  await act(async () => {
    complete();
    await operation;
  });
  await act(async () => {
    renderer.root.findByType(MediaCard).props.selection.onSelect();
  });
  const upload = renderer.root
    .findAllByType('button')
    .find((button) => button.children.includes('Add to the Media Area'));
  assert.ok(upload);
  await act(async () => {
    upload.props.onClick();
    upload.props.onClick();
  });
  assert.equal(selections.length, 1);
});

test('the ten-minute deadline aborts a stalled generation without repeating it', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: 0,
  });
  mock.method(console, 'warn', () => {});
  await renderPrompt();
  let operation: Promise<void> = Promise.resolve();
  await act(async () => {
    operation = renderer.root.findByType('form').props.onSubmit();
  });
  await act(async () => {
    context.mock.timers.tick(600_000);
    await operation;
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].signal.aborted, true);
  assert.ok(
    renderer.root
      .findAllByProps({ role: 'alert' })
      .some((node) => node.children.join('').includes('was stopped')),
  );
});

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropFocus } from '../../../test/dropFocus';
import { renderWithCanvas } from '../../../test/renderWithCanvas';
import type { DeepLFormalitySetting } from '../../../utils/translation/DeepLSettings';
import DeepLConfig from './DeepLConfig';

type Saved = {
  deeplApiKey?: string;
  deeplUseFree?: boolean;
  deeplGlossaryId?: string;
  deeplGlossaryPairs?: string;
};

const GLOSSARIES = [
  {
    glossary_id: 'g-1',
    name: 'Marketing',
    ready: true,
    source_lang: 'en',
    target_lang: 'it',
    entry_count: 12,
  },
];

/** The settings state of the config screen, around the DeepL settings. */
function Harness({
  saved,
  notice = vi.fn(),
}: {
  saved: Saved;
  notice?: (message: string) => unknown;
}) {
  const [deeplApiKey, setDeeplApiKey] = useState(saved.deeplApiKey ?? '');
  const [deeplUseFree, setDeeplUseFree] = useState(saved.deeplUseFree ?? false);
  const [deeplFormality, setDeeplFormality] =
    useState<DeepLFormalitySetting>('default');
  const [preserve, setPreserve] = useState(true);
  const [ignoreTags, setIgnoreTags] = useState('notranslate,ph');
  const [nonSplittingTags, setNonSplittingTags] = useState('');
  const [splittingTags, setSplittingTags] = useState('');
  const [glossaryId, setGlossaryId] = useState(saved.deeplGlossaryId ?? '');
  const [glossaryPairs, setGlossaryPairs] = useState(
    saved.deeplGlossaryPairs ?? '',
  );

  return (
    <DeepLConfig
      deeplApiKey={deeplApiKey}
      setDeeplApiKey={setDeeplApiKey}
      deeplUseFree={deeplUseFree}
      setDeeplUseFree={setDeeplUseFree}
      deeplFormality={deeplFormality}
      setDeeplFormality={setDeeplFormality}
      deeplPreserveFormatting={preserve}
      setDeeplPreserveFormatting={setPreserve}
      deeplIgnoreTags={ignoreTags}
      setDeeplIgnoreTags={setIgnoreTags}
      deeplNonSplittingTags={nonSplittingTags}
      setDeeplNonSplittingTags={setNonSplittingTags}
      deeplSplittingTags={splittingTags}
      setDeeplSplittingTags={setSplittingTags}
      deeplGlossaryId={glossaryId}
      setDeeplGlossaryId={setGlossaryId}
      deeplGlossaryPairs={glossaryPairs}
      setDeeplGlossaryPairs={setGlossaryPairs}
      siteLocales={['en', 'it']}
      openConfirm={vi.fn()}
      notice={notice}
    />
  );
}

/** DeepL through the CORS proxy: the glossary list and the test request. */
function stubDeepL(translateBody: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes(encodeURIComponent('/v2/glossaries'))
      ? { glossaries: GLOSSARIES }
      : translateBody;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Waits until every request has answered and the glossary list has settled,
 * so the state updates of the glossary hook land inside act.
 */
async function requestsSettled(fetchMock: ReturnType<typeof stubDeepL>) {
  await waitFor(() =>
    expect(
      fetchMock.mock.settledResults.every(
        (result) => result.type !== 'incomplete',
      ),
    ).toBe(true),
  );
  // The hook reads the body, then sets its state
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function apiKeyInput() {
  return screen.getByRole('textbox', { name: /^API key/ });
}

function testButton() {
  return screen.getByRole('button', { name: 'Test API key' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeepLConfig', () => {
  it('turns on the Free endpoint for a key ending in :fx, and says why', async () => {
    const fetchMock = stubDeepL({});
    renderWithCanvas(<Harness saved={{}} />);

    const freeSwitch = screen.getByRole('checkbox', {
      name: /^Use DeepL Free endpoint/,
    }) as HTMLInputElement;
    expect(freeSwitch.checked).toBe(false);

    fireEvent.change(apiKeyInput(), { target: { value: 'secret:fx' } });

    expect(freeSwitch.checked).toBe(true);
    expect(
      screen.getByText(
        'Turned on because the key ends in :fx, like the keys of the Free plan.',
      ),
    ).toBeInTheDocument();
    await requestsSettled(fetchMock);
  });

  it('explains why the key cannot be tested without a key', async () => {
    const fetchMock = stubDeepL({});
    renderWithCanvas(<Harness saved={{}} />);

    const button = testButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    act(() => button.focus());

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Enter a DeepL API key first.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells a working key with a toast', async () => {
    const fetchMock = stubDeepL({ translations: [{ text: 'Hallo Welt' }] });
    const notice = vi.fn();
    renderWithCanvas(
      <Harness saved={{ deeplApiKey: 'secret' }} notice={notice} />,
    );

    fireEvent.click(testButton());

    // A passed test is a finished action: a toast, not a callout.
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'API key OK. DeepL responded: Hallo Welt',
      ),
    );
    expect(screen.queryByText(/API key OK/)).not.toBeInTheDocument();
    const translateCall = fetchMock.mock.calls.find(([url]) =>
      url.includes(encodeURIComponent('https://api.deepl.com/v2/translate')),
    );
    expect(translateCall).toBeDefined();
  });

  it('gives the focus back to the button once the test ends', async () => {
    const fetchMock = stubDeepL({ translations: [{ text: 'Hallo Welt' }] });
    const notice = vi.fn();
    renderWithCanvas(
      <Harness saved={{ deeplApiKey: 'secret' }} notice={notice} />,
    );

    act(() => testButton().focus());
    fireEvent.click(testButton());
    expect(testButton()).toHaveAttribute('aria-busy', 'true');
    dropFocus();

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(testButton()).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(testButton());
    await requestsSettled(fetchMock);
  });

  it('shows a rejected key as the error of the field, until the key changes', async () => {
    const fetchMock = stubDeepL({ message: 'Forbidden' });
    renderWithCanvas(<Harness saved={{ deeplApiKey: 'secret' }} />);

    fireEvent.click(testButton());

    await waitFor(() =>
      expect(apiKeyInput().getAttribute('aria-invalid')).toBe('true'),
    );
    expect(
      screen.getByText(
        "DeepL rejected the API key. Check that it's the right key.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(apiKeyInput(), { target: { value: 'other' } });

    expect(apiKeyInput().getAttribute('aria-invalid')).not.toBe('true');
    expect(
      screen.queryByText(
        "DeepL rejected the API key. Check that it's the right key.",
      ),
    ).not.toBeInTheDocument();
    await requestsSettled(fetchMock);
  });

  it('keeps the tag handling and the glossaries closed at first', async () => {
    const fetchMock = stubDeepL({});
    renderWithCanvas(<Harness saved={{ deeplApiKey: 'secret' }} />);

    expect(screen.queryByRole('textbox', { name: /^Ignored tags/ })).toBeNull();
    expect(screen.queryByText('Default glossary')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Tag handling/ }));

    expect(
      (
        screen.getByRole('textbox', {
          name: /^Ignored tags/,
        }) as HTMLInputElement
      ).value,
    ).toBe('notranslate,ph');
    // An emptied list is saved empty and sends no tags: the hint names the
    // default, and no placeholder can pass for it.
    const ignored = screen.getByRole('textbox', { name: /^Ignored tags/ });
    expect(ignored).not.toHaveAttribute('placeholder');
    expect(ignored).toHaveAccessibleDescription(/Default: notranslate, ph\.$/);
    await requestsSettled(fetchMock);
  });

  it('shows a failed glossary load once, on the default glossary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Forbidden' }), {
            status: 403,
          }),
      ),
    );
    renderWithCanvas(<Harness saved={{ deeplApiKey: 'secret' }} />);

    fireEvent.click(screen.getByRole('button', { name: /Glossaries/ }));

    expect(
      await screen.findAllByText('Could not load glossaries: Forbidden'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('combobox', { name: /^Default glossary/ }),
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('opens the glossaries when the saved default glossary is not in the account', async () => {
    stubDeepL({});
    renderWithCanvas(
      <Harness saved={{ deeplApiKey: 'secret', deeplGlossaryId: 'g-404' }} />,
    );

    expect(
      await screen.findByText("This glossary isn't in your DeepL account."),
    ).toBeInTheDocument();
    // The saved ID still shows, as it is
    expect(screen.getByText('g-404')).toBeInTheDocument();
  });
});

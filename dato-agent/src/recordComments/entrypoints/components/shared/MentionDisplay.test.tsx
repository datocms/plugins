import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionLocalFiles,
  registerLocalFile,
} from '../../../../lib/localFiles';
import { renderInCanvas, setFakeRecordTitles } from '../../../../test/canvas';
import type { Mention } from '../../types/mentions';
import { MentionDisplay } from './MentionDisplay';

// The host presents the record of the references with this title
beforeEach(() => setFakeRecordTitles({ 'record-1': 'Homepage' }));

afterEach(() => {
  cleanup();
  clearSessionLocalFiles();
});

const mentions = {
  user: {
    type: 'user',
    id: 'user-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatarUrl: null,
  },
  field: {
    type: 'field',
    apiKey: 'seo_title',
    label: 'SEO title',
    localized: true,
    fieldPath: 'seo_title',
    locale: 'it',
    fieldType: 'structured_text',
  },
  asset: {
    type: 'asset',
    id: 'upload-1',
    filename: 'brand-guidelines.pdf',
    url: 'https://www.datocms-assets.com/brand-guidelines.pdf',
    thumbnailUrl: null,
    mimeType: 'application/pdf',
  },
  file: {
    type: 'file',
    id: 'local-file-1',
    filename: 'research-notes.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    lastModified: 1_786_000_000_000,
  },
  record: {
    type: 'record',
    id: 'record-1',
    title: 'Homepage',
    modelId: 'page-model',
    modelApiKey: 'page',
    modelName: 'Page',
    modelEmoji: '📄',
    thumbnailUrl: null,
  },
  model: {
    type: 'model',
    id: 'article-model',
    apiKey: 'article',
    name: 'Article',
    isBlockModel: false,
  },
} as const satisfies Record<string, Mention>;

const heroImage = {
  ...mentions.asset,
  filename: 'homepage-hero.jpg',
  mimeType: 'image/jpeg',
  thumbnailUrl:
    'https://www.datocms-assets.com/homepage-hero.jpg?w=300&fit=max',
} as const satisfies Mention;

/**
 * The hint opens on keyboard focus, in a tooltip at the end of the body (out
 * of the message), and describes its trigger.
 */
function expectHint(
  container: HTMLElement,
  trigger: HTMLElement,
  text: string,
) {
  fireEvent.focus(trigger);
  const tooltip = screen.getByRole('tooltip');

  expect(tooltip).toHaveTextContent(text);
  expect(container).not.toContainElement(tooltip);
  expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
}

describe('MentionDisplay', () => {
  it.each([
    ['user', mentions.user, 'Ada Lovelace', 'ada@example.com'],
    ['field', mentions.field, '#SEO title · Italian', 'Structured text'],
    ['asset', mentions.asset, 'brand-gu….pdf', 'brand-guidelines.pdf'],
    ['file', mentions.file, 'research….pdf', 'research-notes.pdf'],
    ['record', mentions.record, 'Homepage', 'Page'],
    ['model', mentions.model, 'Article', 'Model: article'],
  ] as const)(
    'renders the %s reference as a pill that opens it, with its hint',
    async (_, mention, name, hint) => {
      const onClick = vi.fn();
      const { container } = renderInCanvas(
        <MentionDisplay mention={mention} onClick={onClick} />,
      );
      const pill = await screen.findByRole('button', { name });

      expectHint(container, pill, hint);
      fireEvent.click(pill);

      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['content model', mentions.model, 'Model: article'],
    [
      'block model',
      {
        ...mentions.model,
        id: 'hero-model',
        apiKey: 'hero',
        name: 'Hero',
        isBlockModel: true,
      },
      'Block: hero',
    ],
  ] as const)('gives the exact %s hint', (_, mention, text) => {
    const { container } = renderInCanvas(
      <MentionDisplay mention={mention} onClick={vi.fn()} />,
    );

    expectHint(container, screen.getByRole('button'), text);
  });

  it('shows a model emoji in place of the model glyph', () => {
    renderInCanvas(
      <MentionDisplay
        mention={{ ...mentions.model, name: '📰 Article' }}
        onClick={vi.fn()}
      />,
    );
    const pill = screen.getByRole('button', { name: 'Article' });

    expect(within(pill).getByText('📰')).toHaveAttribute('aria-hidden', 'true');
    expect(pill.querySelector('svg')).toBeNull();
  });

  it('uses the current project-user name and the owner hint', () => {
    const { container, rerender } = renderInCanvas(
      <MentionDisplay
        mention={mentions.user}
        onClick={vi.fn()}
        projectUsers={[
          {
            id: mentions.user.id,
            email: mentions.user.email,
            name: 'Ada Byron',
            avatarUrl: null,
          },
        ]}
      />,
    );
    const renamedUser = screen.getByRole('button', { name: 'Ada Byron' });

    expectHint(container, renamedUser, 'ada@example.com');

    const onClick = vi.fn();
    rerender(
      <MentionDisplay
        isClickable={false}
        isProjectOwner
        mention={mentions.user}
        onClick={onClick}
      />,
    );

    // The owner can't be opened: a static pill that still gives its hint
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const owner = screen.getByText('Ada Lovelace');
    const ownerPill = owner.closest('.Pill') as HTMLElement;
    expect(ownerPill).toHaveAttribute('tabindex', '0');
    expectHint(container, ownerPill, 'Project owner');
    fireEvent.click(owner);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows the avatar of a mentioned user', () => {
    renderInCanvas(
      <MentionDisplay
        mention={{
          ...mentions.user,
          avatarUrl: 'https://www.gravatar.com/avatar/ada',
        }}
        onClick={vi.fn()}
      />,
    );
    const pill = screen.getByRole('button', { name: 'Ada Lovelace' });

    expect(pill.querySelector('img')).toHaveAttribute(
      'src',
      'https://www.gravatar.com/avatar/ada',
    );
  });

  it('shows a record as the host presents it, and preserves click behavior', async () => {
    const onClick = vi.fn();
    const { ctx } = renderInCanvas(
      <MentionDisplay
        mention={{ ...mentions.record, title: 'A stale title' }}
        onClick={onClick}
      />,
    );
    // The title is the one of the host, not the one of the mention
    const pill = await screen.findByRole('button', { name: 'Homepage' });

    expect(ctx.loadItemPresentationInfo).toHaveBeenCalled();
    expect(screen.queryByText('A stale title')).not.toBeInTheDocument();

    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps the currently open record inert, with a clear hint', async () => {
    const onClick = vi.fn();
    const { container } = renderInCanvas(
      <MentionDisplay
        currentRecordId={mentions.record.id}
        mention={mentions.record}
        onClick={onClick}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const title = await screen.findByText('Homepage');
    expectHint(
      container,
      title.closest('.Pill') as HTMLElement,
      'Current record',
    );
    fireEvent.click(title);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a visual asset as a card of the Media Area that opens it', () => {
    const onClick = vi.fn();
    const { container } = renderInCanvas(
      <MentionDisplay mention={heroImage} onClick={onClick} />,
    );
    // The card's button covers the preview and is named by the caption
    const card = screen.getByRole('button', { name: 'homepage-hero.jpg' });

    // The preview of the Media Area, which loads the asset from its ID
    expect(container.querySelector('.UploadPreview')).toBeInTheDocument();
    expect(screen.getByText('homepage-hero.jpg')).toBeVisible();
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows a visual asset as a static card when it cannot open', () => {
    const { container } = renderInCanvas(
      <MentionDisplay
        isClickable={false}
        mention={heroImage}
        onClick={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('.UploadPreview')).toBeInTheDocument();
    expect(screen.getByText('homepage-hero.jpg')).toBeVisible();
  });

  it('previews an image file from the computer while its bytes are in the session', () => {
    // jsdom has no object URLs
    const revokeObjectURL = vi.fn();
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:sketch'),
      revokeObjectURL,
    });
    const mention = registerLocalFile(
      new File(['png'], 'sketch.png', { type: 'image/png' }),
    );

    const { container, unmount } = renderInCanvas(
      <MentionDisplay mention={mention} onClick={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'sketch.png' })).toBeVisible();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'blob:sketch',
    );

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sketch');
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it.each([
    ['user', mentions.user, 'Ada Lovelace'],
    ['field', mentions.field, '#SEO title · Italian'],
    ['asset', mentions.asset, 'brand-gu….pdf'],
    ['file', mentions.file, 'research….pdf'],
    ['record', mentions.record, 'Homepage'],
    ['model', mentions.model, 'Article'],
  ] as const)(
    'does not invoke a %s reference that cannot open',
    async (_, mention, text) => {
      const onClick = vi.fn();
      renderInCanvas(
        <MentionDisplay
          isClickable={false}
          mention={mention}
          onClick={onClick}
        />,
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      fireEvent.click(await screen.findByText(text));
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  describe('in the composer', () => {
    it('is a static pill in a button that opens it but is not a tab stop', () => {
      const onClick = vi.fn();
      const { container } = renderInCanvas(
        <MentionDisplay
          inComposer
          mention={mentions.field}
          onClick={onClick}
        />,
      );
      const chip = screen.getByRole('button', { name: '#SEO title · Italian' });

      expect(chip).toHaveAttribute('tabindex', '-1');
      expect(within(chip).getByText('#SEO title · Italian')).toBeVisible();
      expectHint(container, chip, 'Structured text');

      fireEvent.click(chip);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('shows a visual asset as a pill with its preview, never as a card', () => {
      renderInCanvas(
        <MentionDisplay inComposer mention={heroImage} onClick={vi.fn()} />,
      );
      const chip = screen.getByRole('button', { name: 'homepage….jpg' });

      expect(chip).toHaveAttribute('tabindex', '-1');
      expect(chip.querySelector('.UploadPreview')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('keeps the current record inert', async () => {
      const onClick = vi.fn();
      renderInCanvas(
        <MentionDisplay
          currentRecordId={mentions.record.id}
          inComposer
          mention={mentions.record}
          onClick={onClick}
        />,
      );
      const chip = await screen.findByRole('button', { name: 'Homepage' });

      expect(chip).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(chip);
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});

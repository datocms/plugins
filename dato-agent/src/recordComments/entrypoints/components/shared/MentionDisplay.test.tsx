import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mention } from '../../types/mentions';
import { MentionDisplay } from './MentionDisplay';

vi.mock('datocms-react-ui', async () => {
  const { createPortal } = await import('react-dom');
  const PassThrough = ({ children }: { children?: ReactNode }) => children;

  return {
    Tooltip: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: ({ children }: { children?: ReactNode }) =>
      createPortal(
        <div data-testid="tooltip-portal" role="tooltip">
          {children}
        </div>,
        document.body,
      ),
  };
});

afterEach(cleanup);

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

function expectPortaledTooltip(
  container: HTMLElement,
  button: HTMLElement,
  text: string,
) {
  const portal = screen.getByTestId('tooltip-portal');
  const tooltipContent = within(portal).getByText(text);

  expect(container).not.toContainElement(portal);
  expect(button).toHaveAttribute('aria-describedby', tooltipContent.id);
  expect(tooltipContent).toHaveTextContent(text);
}

describe('MentionDisplay', () => {
  it.each([
    ['user', mentions.user, 'ada@example.com'],
    ['field', mentions.field, 'Structured text'],
    ['asset', mentions.asset, 'brand-guidelines.pdf'],
    ['file', mentions.file, 'research-notes.pdf'],
    ['record', mentions.record, 'Page'],
    ['model', mentions.model, 'Model: article'],
  ] as const)(
    'renders the %s reference with a portaled tooltip and click behavior',
    (type, mention, tooltipText) => {
      const onClick = vi.fn();
      const accessibleLabel = `Open ${type}`;
      const { container } = render(
        <MentionDisplay
          accessibleLabel={accessibleLabel}
          mention={mention}
          onClick={onClick}
        />,
      );
      const button = screen.getByRole('button', { name: accessibleLabel });

      expectPortaledTooltip(container, button, tooltipText);
      fireEvent.click(button);

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
  ] as const)('renders the exact %s tooltip content', (_, mention, text) => {
    const { container } = render(
      <MentionDisplay accessibleLabel="Open model" mention={mention} />,
    );
    const button = screen.getByRole('button', { name: 'Open model' });

    expectPortaledTooltip(container, button, text);
  });

  it('uses the current project-user name and owner tooltip semantics', () => {
    const { container, rerender } = render(
      <MentionDisplay
        mention={mentions.user}
        projectUsers={[
          {
            id: mentions.user.id,
            email: mentions.user.email,
            name: 'Ada Byron',
            avatarUrl: null,
          },
        ]}
        tooltipId="regular-user-tooltip"
      />,
    );
    const renamedUser = screen.getByRole('button', { name: '@Ada Byron' });

    expectPortaledTooltip(container, renamedUser, 'ada@example.com');

    rerender(
      <MentionDisplay
        accessibleLabel="Project owner"
        isClickable={false}
        isProjectOwner
        mention={mentions.user}
        tooltipId="owner-tooltip"
      />,
    );
    const owner = screen.getByRole('button', { name: 'Project owner' });

    expect(owner).toBeDisabled();
    expectPortaledTooltip(container, owner, 'Project Owner');
  });

  it('renders a record title and thumbnail and preserves click behavior', () => {
    const onClick = vi.fn();
    const thumbnailUrl =
      'https://www.datocms-assets.com/homepage.jpg?w=48&fit=max';
    render(
      <MentionDisplay
        accessibleLabel="Open Homepage"
        mention={{
          ...mentions.record,
          title: '🏠 Homepage',
          thumbnailUrl,
        }}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button', { name: 'Open Homepage' });
    const thumbnail = within(button).getByRole('img', {
      name: 'Thumbnail for Homepage',
    });

    expect(within(button).getByText('Homepage')).toBeVisible();
    expect(within(button).queryByText('🏠')).not.toBeInTheDocument();
    expect(thumbnail).toHaveAttribute('src', thumbnailUrl);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a visual asset thumbnail and falls back to a portaled filename tooltip on image failure', () => {
    const onClick = vi.fn();
    const filename = 'homepage-hero.jpg';
    const thumbnailUrl =
      'https://www.datocms-assets.com/homepage-hero.jpg?w=300&fit=max';
    const { container } = render(
      <MentionDisplay
        accessibleLabel="Open homepage hero"
        mention={{
          ...mentions.asset,
          filename,
          mimeType: 'image/jpeg',
          thumbnailUrl,
        }}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Open homepage hero',
    });
    const thumbnail = within(button).getByRole('img', { name: filename });

    expect(thumbnail).toHaveAttribute('src', thumbnailUrl);
    expect(within(button).getByText(filename)).toBeVisible();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();

    fireEvent.error(thumbnail);

    const fallback = screen.getByRole('button', {
      name: 'Open homepage hero',
    });
    expect(within(fallback).getByText('homepage….jpg')).toBeVisible();
    expect(
      screen.queryByRole('img', { name: filename }),
    ).not.toBeInTheDocument();
    expectPortaledTooltip(container, fallback, filename);
  });

  it.each(Object.entries(mentions))(
    'does not invoke disabled %s references',
    (type, mention) => {
      const onClick = vi.fn();
      render(
        <MentionDisplay
          accessibleLabel={`Open disabled ${type}`}
          isClickable={false}
          mention={mention}
          onClick={onClick}
        />,
      );
      const button = screen.getByRole('button', {
        name: `Open disabled ${type}`,
      });

      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    },
  );
});

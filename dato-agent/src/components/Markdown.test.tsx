import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import { Markdown } from './Markdown';

afterEach(cleanup);

describe('Markdown', () => {
  it('opens safe links outside the plugin frame', () => {
    renderInCanvas(
      <Markdown content="[DatoCMS](https://www.datocms.com/docs/content-management-api)" />,
    );

    const link = screen.getByRole('link', { name: 'DatoCMS' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.datocms.com/docs/content-management-api',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not turn unsafe link schemes into navigation', () => {
    renderInCanvas(<Markdown content="[Unsafe](javascript:alert('no'))" />);

    expect(
      screen.queryByRole('link', { name: 'Unsafe' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe')).toBeVisible();
  });

  it('exposes remote images as safe links instead of loading them', () => {
    renderInCanvas(
      <Markdown content="![Project diagram](https://cdn.example.com/project.png)" />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: 'Open image: Project diagram',
    });
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/project.png');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not load or link non-web image sources', () => {
    renderInCanvas(
      <Markdown content="![Inline secret](data:image/png;base64,AAAA)" />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Inline secret/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Inline secret')).toBeVisible();
  });

  it('renders HTML in the response as nothing, never as markup', () => {
    const { container } = renderInCanvas(
      <Markdown
        content={'Before <b>bold</b> <img src=x onerror="alert(1)">'}
      />,
    );

    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Before/)).toBeVisible();
  });

  it('shows the headings of a response as bold text, not as headings', () => {
    const { container } = renderInCanvas(
      <Markdown
        content={'# Summary\n\n## Records\n\n### Fields\n\n###### Notes'}
      />,
    );

    // The frame of the agent is no page or dialog: no headings in it
    expect(screen.queryAllByRole('heading')).toEqual([]);
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    for (const text of ['Summary', 'Records', 'Fields', 'Notes']) {
      expect(screen.getByText(text)).toBeVisible();
    }
    // The first level is larger than the others
    expect(screen.getByText('Summary').className).not.toBe(
      screen.getByText('Records').className,
    );
    expect(screen.getByText('Records').className).toBe(
      screen.getByText('Notes').className,
    );
  });

  it('starts the headings of a response at the first level, whatever their depth', () => {
    renderInCanvas(
      <Markdown
        content={'### Details\n\nText.\n\n#### Fields\n\n> ##### Note'}
      />,
    );

    expect(screen.queryAllByRole('heading')).toEqual([]);
    // "###" is the shallowest depth: the first level, which is larger
    expect(screen.getByText('Details').className).not.toBe(
      screen.getByText('Fields').className,
    );
    expect(screen.getByText('Fields').className).toBe(
      screen.getByText('Note').className,
    );
  });

  it('shows a block of code as a snippet that copies its code', () => {
    renderInCanvas(
      <Markdown
        content={
          'Run this:\n\n```graphql\nquery {\n  allArticles { id }\n}\n```\n\nThen `title` changes.'
        }
      />,
    );

    // The region is named after the language of the fence
    const snippet = screen.getByRole('region', { name: 'GraphQL code' });
    expect(snippet).toHaveTextContent('query {');
    expect(snippet.textContent).toBe('query {\n  allArticles { id }\n}');
    expect(
      within(snippet.parentElement as HTMLElement).getByRole('button'),
    ).toBeInTheDocument();
    expect(screen.getByText('title').tagName).toBe('CODE');
  });

  it('gives each block of code of a response a name of its own', () => {
    renderInCanvas(
      <Markdown
        content={
          '```ts\nconst a = 1;\n```\n\n```\nplain\n```\n\n```json\n{}\n```'
        }
      />,
    );

    expect(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual([
      'TypeScript code, block 1',
      'Code block 2',
      'JSON code, block 3',
    ]);
  });

  it('names a single block without a language "Code"', () => {
    renderInCanvas(<Markdown content={'```\nplain\n```'} />);

    expect(screen.getByRole('region', { name: 'Code' })).toHaveTextContent(
      'plain',
    );
  });

  it('keeps lists and tables of GitHub Markdown', () => {
    renderInCanvas(
      <Markdown
        content={
          '- First\n- Second\n\n| Model | Records |\n| --- | --- |\n| Article | 12 |'
        }
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Records' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Article' })).toBeInTheDocument();
  });
});

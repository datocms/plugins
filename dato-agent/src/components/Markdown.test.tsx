import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

afterEach(cleanup);

describe('Markdown', () => {
  it('opens safe links outside the plugin frame', () => {
    render(
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
    render(<Markdown content="[Unsafe](javascript:alert('no'))" />);

    expect(
      screen.queryByRole('link', { name: 'Unsafe' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe')).toBeVisible();
  });

  it('exposes remote images as safe links instead of loading them', () => {
    render(
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
    render(<Markdown content="![Inline secret](data:image/png;base64,AAAA)" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Inline secret/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Inline secret')).toBeVisible();
  });
});

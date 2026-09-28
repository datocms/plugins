import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink, isOpenableUrl } from './ExternalLink';

describe('ExternalLink', () => {
  it('opens absolute http(s) URLs in a new tab', () => {
    render(<ExternalLink url="https://example.com/pricing#team" />);
    const link = screen.getByRole('link', {
      name: 'https://example.com/pricing#team (opens in a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://example.com/pricing#team');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps anything else as plain text', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'mailto:team@example.com',
      '/relative/path',
      'http://[bad',
    ])
      expect(isOpenableUrl(url)).toBe(false);
    render(<ExternalLink url="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Environment } from '../utils/assetEnvironmentOperations';
import { EnvironmentList } from './EnvironmentList';

function environment(index: number): Environment {
  return {
    id: `environment-${index}`,
    type: 'environment',
    meta: {
      status: 'ready',
      read_only_mode: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_data_change_at: '2026-01-01T00:00:00.000Z',
      primary: index === 0,
      forked_from: null,
    },
  };
}

function fixtures(count: number) {
  return Array.from({ length: count }, (_, index) => environment(index));
}

const props = {
  currentEnv: 'current-environment',
  uploadId: 'upload-00009999',
  projectDomain: 'synthetic.admin.datocms.com',
};

afterEach(cleanup);

describe('environment list rendering', () => {
  it('preserves the complete ordinary list and existing links up to 100 environments', () => {
    const view = render(
      <EnvironmentList environments={fixtures(100)} {...props} />,
    );

    expect(view.container.querySelectorAll('li')).toHaveLength(100);
    expect(view.container.querySelector('[role="region"]')).toBeNull();
    expect(
      screen.getByText('environment-0').getAttribute('href'),
    ).toBe('https://synthetic.admin.datocms.com/media/assets/upload-00009999');
    expect(screen.getByText('(primary)')).toBeTruthy();
    expect(
      screen.getByText('environment-99').getAttribute('href'),
    ).toBe(
      'https://synthetic.admin.datocms.com/environments/environment-99/media/assets/upload-00009999',
    );
    expect(
      screen.getByText('environment-99').getAttribute('target'),
    ).toBe('_top');
  });

  it.each([101, 1_200])(
    'bounds rendered rows for %i environments and makes the final copy accessible by scrolling',
    (count) => {
      const view = render(
        <EnvironmentList environments={fixtures(count)} {...props} />,
      );
      const region = screen.getByRole('region', {
        name: 'Other environments containing this asset',
        hidden: true,
      });

      expect(region.getAttribute('tabindex')).toBe('0');
      expect(view.container.querySelectorAll('li').length).toBeLessThanOrEqual(20);
      expect(screen.getByText('environment-0').tagName).toBe('A');
      expect(screen.queryByText(`environment-${count - 1}`)).toBeNull();
      fireEvent.scroll(region, { target: { scrollTop: count * 28 } });

      expect(view.container.querySelectorAll('li').length).toBeLessThanOrEqual(20);
      expect(
        screen.getByText(`environment-${count - 1}`).getAttribute('href'),
      ).toBe(
        `https://synthetic.admin.datocms.com/environments/environment-${count - 1}/media/assets/upload-00009999`,
      );
      expect(screen.queryByText('environment-0')).toBeNull();
      expect(
        Number(view.container.querySelector('ol')?.getAttribute('start')),
      ).toBeGreaterThan(1);
    },
  );

  it('keeps the final remaining environment reachable after the list shrinks during deletion', () => {
    const view = render(
      <EnvironmentList environments={fixtures(1_200)} {...props} />,
    );
    fireEvent.scroll(screen.getByRole('region', { hidden: true }), {
      target: { scrollTop: 1_200 * 28 },
    });
    expect(screen.getByText('environment-1199').tagName).toBe('A');
    view.rerender(<EnvironmentList environments={fixtures(150)} {...props} />);

    expect(view.container.querySelectorAll('li').length).toBeLessThanOrEqual(20);
    expect(screen.getByText('environment-149').tagName).toBe('A');
    expect(screen.queryByText('environment-1199')).toBeNull();
    view.rerender(<EnvironmentList environments={fixtures(3)} {...props} />);
    expect(view.container.querySelectorAll('li')).toHaveLength(3);
    expect(view.container.querySelector('[role="region"]')).toBeNull();
    expect(screen.getByText('environment-2').tagName).toBe('A');
  });
});

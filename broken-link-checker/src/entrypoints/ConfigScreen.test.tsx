import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { configContext } from '../test/fixtures';
import ConfigScreen from './ConfigScreen';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

const permissionWarning = /Project scans need permission to make API calls/;

describe('config screen', () => {
  it('explains the plugin without drawing its own heading', () => {
    render(<ConfigScreen ctx={configContext()} />);
    expect(
      screen.getByText(/finds broken website links in your records/),
    ).toHaveTextContent(
      "The Link checker finds broken website links in your records. There's nothing to configure here.",
    );
    expect(
      screen.getByText(/Scan saved records from "Link checker"/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('navigates to the project page in the current environment', async () => {
    const user = userEvent.setup();
    const primary = configContext();
    const { unmount } = render(<ConfigScreen ctx={primary} />);
    await user.click(
      screen.getByRole('button', { name: 'Go to Link checker' }),
    );
    expect(primary.navigateTo).toHaveBeenCalledWith(
      '/editor/p/plugin-1/pages/link-checker',
    );
    unmount();

    const sandbox = configContext({
      isEnvironmentPrimary: false,
      environment: 'sandbox',
    });
    render(<ConfigScreen ctx={sandbox} />);
    await user.click(
      screen.getByRole('button', { name: 'Go to Link checker' }),
    );
    expect(sandbox.navigateTo).toHaveBeenCalledWith(
      '/environments/sandbox/editor/p/plugin-1/pages/link-checker',
    );
  });

  it('shows a host alert when the project page cannot be opened', async () => {
    const user = userEvent.setup();
    const ctx = configContext({
      navigateTo: vi.fn().mockRejectedValue(new Error('Navigation failed')),
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ConfigScreen ctx={ctx} />);
    await user.click(
      screen.getByRole('button', { name: 'Go to Link checker' }),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the Link checker!"),
    );
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('warns, and leads nowhere, only when the current-user API permission is missing', () => {
    const { unmount } = render(<ConfigScreen ctx={configContext()} />);
    expect(screen.queryByText(permissionWarning)).not.toBeInTheDocument();
    unmount();

    render(
      <ConfigScreen
        ctx={configContext({
          plugin: {
            id: 'plugin-1',
            type: 'plugin',
            attributes: { permissions: [], parameters: {} },
          },
        })}
      />,
    );
    expect(screen.getByText(permissionWarning)).toHaveTextContent(
      "Project scans need permission to make API calls on behalf of the logged-in user, which this plugin doesn't have. Ask a project admin to grant it, then reload the page. Checks from the record sidebar panel still work.",
    );
    // The page can't scan without it, so the screen doesn't point there.
    expect(
      screen.queryByRole('button', { name: 'Go to Link checker' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Scan saved records from "Link checker"/),
    ).not.toBeInTheDocument();
  });
});

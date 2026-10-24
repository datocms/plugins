import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { configContext } from '../test/fixtures';
import ConfigScreen from './ConfigScreen';

const permissionWarning = /needs permission to make API calls/;

const noPermission = () =>
  configContext({
    plugin: {
      id: 'plugin-1',
      type: 'plugin',
      attributes: { permissions: [], parameters: {} },
    },
  });

describe('config screen', () => {
  it('explains the two ways to check links, with nothing to configure', () => {
    render(<ConfigScreen ctx={configContext()} />);
    expect(
      screen.getByRole('heading', { name: 'Link checker' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Project scans')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Scan the saved records of this environment from “Link checker” in the content area.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Record checks')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Check the record you're editing from its “Broken links” sidebar panel.",
      ),
    ).toBeInTheDocument();
    // No form: nothing to save.
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('links to the project page in the current environment', async () => {
    const user = userEvent.setup();
    const primary = configContext();
    const { unmount } = render(<ConfigScreen ctx={primary} />);
    const link = screen.getByRole('link', { name: 'Open Link checker' });
    expect(link).toHaveAttribute(
      'href',
      '/editor/p/plugin-1/pages/link-checker',
    );
    await user.click(link);
    expect(primary.navigateTo).toHaveBeenCalledWith(
      '/editor/p/plugin-1/pages/link-checker',
    );
    unmount();

    const sandbox = configContext({
      isEnvironmentPrimary: false,
      environment: 'sandbox',
    });
    render(<ConfigScreen ctx={sandbox} />);
    await user.click(screen.getByRole('link', { name: 'Open Link checker' }));
    expect(sandbox.navigateTo).toHaveBeenCalledWith(
      '/environments/sandbox/editor/p/plugin-1/pages/link-checker',
    );
  });

  it('warns, and leads nowhere, only when the current-user API permission is missing', () => {
    const { unmount } = render(<ConfigScreen ctx={configContext()} />);
    expect(screen.queryByText(permissionWarning)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'API access' }),
    ).not.toBeInTheDocument();
    unmount();

    render(<ConfigScreen ctx={noPermission()} />);
    const problem = screen.getByRole('heading', { name: 'API access' });
    expect(problem).toBeInTheDocument();
    expect(screen.getByText('Not granted')).toBeInTheDocument();
    // The same steps as the project page: grant the permission, then reload.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Project scans are offThis plugin needs permission to make API calls on behalf of the logged-in user: ask a project admin to grant it, then reload the page. Checks from the record sidebar panel still work.',
    );
    // The page can't scan without it, so the screen doesn't point there.
    expect(
      screen.queryByRole('link', { name: 'Open Link checker' }),
    ).not.toBeInTheDocument();
    // Both ways are still described: record checks keep working, and the
    // project scans row says what they need instead of pointing to a
    // sidebar item that the content area doesn't show.
    expect(screen.getByText('Project scans')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Scanning the saved records of this environment needs the API access above.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Scan the saved records of this environment from “Link checker” in the content area.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Record checks')).toBeInTheDocument();
  });
});

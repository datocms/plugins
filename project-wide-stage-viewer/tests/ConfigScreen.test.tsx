import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigScreen from '../src/entrypoints/ConfigScreen';
import { buildConfigCtx } from './fixtures';

const client = { workflows: { list: vi.fn() } };

vi.mock('../src/lib/cma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/cma')>()),
  buildCmaClient: () => client,
}));

const workflows = [
  {
    id: 'wf1',
    name: 'Editorial',
    stages: [
      { id: 'draft', name: 'Draft' },
      { id: 'review', name: 'In review' },
    ],
  },
];

const saved = {
  otherSetting: true,
  menuItems: [
    {
      // Saved by an earlier version, before page IDs dropped the colons.
      id: 'wf:wf1__st:review',
      workflowId: 'wf1',
      workflowName: 'Editorial',
      stageId: 'review',
      stageName: 'Review (old name)',
      label: 'Reviews',
      icon: 'tasks',
    },
  ],
};

describe('ConfigScreen', () => {
  beforeEach(() => {
    client.workflows.list.mockResolvedValue(workflows);
  });

  it('shows the saved stages with Save disabled until something changes', async () => {
    render(<ConfigScreen ctx={buildConfigCtx({ parameters: saved })} />);

    const label = await screen.findByLabelText('Sidebar label');
    expect(label).toHaveValue('Reviews');
    // The stage shows its live name, with the workflow beside it.
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeDisabled();

    await userEvent.type(label, '!');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  });

  it('saves the entries, keeping other parameters and refreshing names', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    const label = await screen.findByLabelText('Sidebar label');
    await userEvent.clear(label);
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
        otherSetting: true,
        menuItems: [
          {
            id: 'wf.wf1.st.review',
            workflowId: 'wf1',
            workflowName: 'Editorial',
            stageId: 'review',
            stageName: 'In review',
          },
        ],
      }),
    );
    expect(ctx.notice).toHaveBeenCalledWith('Settings successfully saved!');
  });

  it('asks for a stage before saving a new entry', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add new stage' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );

    expect(screen.getByText('Field is required')).toBeInTheDocument();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it('removes an entry', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove In review' }),
    );
    expect(
      screen.getByText(
        'No stages in the sidebar yet. Add the first one below.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
        otherSetting: true,
        menuItems: [],
      }),
    );
  });

  it('flags entries whose stage was deleted', async () => {
    client.workflows.list.mockResolvedValue([
      { ...workflows[0], stages: [{ id: 'draft', name: 'Draft' }] },
    ]);
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    const save = await screen.findByRole('button', { name: 'Save settings' });
    await userEvent.click(save);

    expect(screen.getByText('This stage no longer exists')).toBeInTheDocument();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it('is read-only without schema permissions', async () => {
    render(
      <ConfigScreen
        ctx={buildConfigCtx({ parameters: saved, canEditSchema: false })}
      />,
    );

    expect(
      await screen.findByText(
        'You need permission to edit the schema to change these settings.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Sidebar label')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save settings' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add new stage' }),
    ).not.toBeInTheDocument();
  });

  it('explains what to do when the project has no workflows', async () => {
    client.workflows.list.mockResolvedValue([]);
    render(<ConfigScreen ctx={buildConfigCtx()} />);

    expect(
      await screen.findByText(/This project has no workflows yet/),
    ).toBeInTheDocument();
  });

  it('offers a retry when the workflows can’t be loaded', async () => {
    client.workflows.list.mockRejectedValueOnce(new Error('Offline'));
    render(<ConfigScreen ctx={buildConfigCtx({ parameters: saved })} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Try again' }),
    );
    expect(await screen.findByLabelText('Sidebar label')).toBeInTheDocument();
  });
});

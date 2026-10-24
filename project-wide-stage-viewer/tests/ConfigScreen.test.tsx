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

// A button disabled with a reason keeps the focus: it has aria-disabled
function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

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
    expect(screen.getByText('Editorial')).toBeInTheDocument();
    // The old Font Awesome 5 name shows as its Font Awesome 6 name.
    expect(screen.getByText('list-check')).toBeInTheDocument();
    expect(isDisabled(saveButton())).toBe(true);

    await userEvent.type(label, '!');
    expect(isDisabled(saveButton())).toBe(false);
  });

  it('saves the entries, keeping other parameters and refreshing names', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    const label = await screen.findByLabelText('Sidebar label');
    await userEvent.clear(label);
    // An empty label shows the name of the stage.
    expect(label).toHaveAttribute('placeholder', 'In review');
    await userEvent.click(saveButton());

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
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('Settings saved.'),
    );
  });

  it('alerts when the settings cannot be saved', async () => {
    const ctx = buildConfigCtx({
      parameters: saved,
      updatePluginParameters: async () => {
        throw new Error('Offline');
      },
    });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.type(await screen.findByLabelText('Sidebar label'), '!');
    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't save the settings."),
    );
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('adds a stage that no other entry uses, with its icon', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add stage' }),
    );
    const [, stage] = screen.getAllByLabelText('Workflow stage');
    await userEvent.click(stage);
    await userEvent.keyboard('{ArrowDown}');

    // The stage of the first entry can't be picked twice
    const taken = await screen.findByRole('option', { name: /In review/ });
    expect(taken).toHaveAttribute('aria-disabled', 'true');
    expect(taken).toHaveTextContent('Already added');
    await userEvent.click(screen.getByRole('option', { name: 'Draft' }));

    const [, icon] = screen.getAllByLabelText('Icon');
    await userEvent.click(icon);
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(await screen.findByRole('option', { name: 'flag' }));
    // Every stage is used: no more rows to add
    expect(
      screen.queryByRole('button', { name: 'Add stage' }),
    ).not.toBeInTheDocument();

    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
        otherSetting: true,
        menuItems: [
          expect.objectContaining({ id: 'wf.wf1.st.review', label: 'Reviews' }),
          {
            id: 'wf.wf1.st.draft',
            workflowId: 'wf1',
            workflowName: 'Editorial',
            stageId: 'draft',
            stageName: 'Draft',
            icon: 'flag',
          },
        ],
      }),
    );
  });

  it('asks for a stage before saving a new entry', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add stage' }),
    );
    expect(screen.getAllByLabelText('Sidebar label')).toHaveLength(2);
    // The error shows only after a save attempt.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a stage');
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it('removes an entry', async () => {
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove row' }),
    );
    expect(screen.getByText('No stages yet')).toBeInTheDocument();
    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
        otherSetting: true,
        menuItems: [],
      }),
    );
  });

  it('flags entries whose stage was deleted, and does not save them', async () => {
    client.workflows.list.mockResolvedValue([
      { ...workflows[0], stages: [{ id: 'draft', name: 'Draft' }] },
    ]);
    const ctx = buildConfigCtx({ parameters: saved });
    render(<ConfigScreen ctx={ctx} />);

    // The saved stage keeps its saved name, and its error shows at once.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This stage no longer exists',
    );
    expect(screen.getByText('Review (old name)')).toBeInTheDocument();

    await userEvent.click(saveButton());

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
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add stage' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove row' }),
    ).not.toBeInTheDocument();
  });

  it('explains what to do when the project has no workflows', async () => {
    client.workflows.list.mockResolvedValue([]);
    render(<ConfigScreen ctx={buildConfigCtx()} />);

    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Create a workflow in Settings, under Workflows/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('offers a retry when the workflows can’t be loaded', async () => {
    client.workflows.list.mockRejectedValueOnce(new Error('Offline'));
    render(<ConfigScreen ctx={buildConfigCtx({ parameters: saved })} />);

    expect(
      await screen.findByText("Couldn't load the workflows"),
    ).toBeInTheDocument();
    const calls = client.workflows.list.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Sidebar label')).toBeInTheDocument();
    // It loads again, without a reload of the plugin
    expect(client.workflows.list).toHaveBeenCalledTimes(calls + 1);
  });
});

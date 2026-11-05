import type { Client } from '@datocms/cma-client-browser';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { useEffect, useMemo, useState } from 'react';
import { CircleExclamationIcon, RefreshIcon } from '../icons';
import { describeError, retryAdvice } from '../lib/cma';
import { availableMoveDestinationIds } from '../operations/candidates';
import type { SelectionInput } from '../operations/types';
import type { WorkflowStageOption } from '../types';

export type MoveToStageMenuProps = {
  client: Client;
  /** The workflow of the page */
  workflowId: string;
  /**
   * The selection as the page knows it. The menu offers only the stages that
   * at least one of these records can move to; the move checks the pick
   * again against the current records.
   */
  selectionInput: SelectionInput;
  /** Runs with the picked stage */
  onPick: (stage: WorkflowStageOption) => void;
};

type WorkflowState =
  | { status: 'loading' }
  | { status: 'loaded'; stages: readonly WorkflowStageOption[] }
  | { status: 'failed'; error: unknown };

// The menu renders this part only while it is open, thus each opening loads
// the current stages of the workflow. "Try again" loads them again.
function StageOptions({
  client,
  workflowId,
  selectionInput,
  onPick,
}: MoveToStageMenuProps) {
  const [workflow, setWorkflow] = useState<WorkflowState>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    let active = true;
    setWorkflow({ status: 'loading' });
    client.workflows.find(workflowId).then(
      (result) => {
        if (!active) return;
        setWorkflow({
          status: 'loaded',
          stages: result.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
          })),
        });
      },
      (error: unknown) => {
        if (!active) return;
        setWorkflow({ status: 'failed', error });
      },
    );
    return () => {
      active = false;
    };
  }, [client, workflowId, attempt]);

  const destinations = useMemo(() => {
    if (workflow.status !== 'loaded') return [];
    const allowed = new Set(
      availableMoveDestinationIds({
        ...selectionInput,
        destinationStageIds: workflow.stages.map((stage) => stage.id),
      }),
    );
    return workflow.stages.filter((stage) => allowed.has(stage.id));
  }, [selectionInput, workflow]);

  if (workflow.status === 'loading') {
    return (
      <div className="Dropdown__menu__body">
        <BlankSlate
          placement="inline"
          small
          loading
          title="Loading the stages"
        />
      </div>
    );
  }

  if (workflow.status === 'failed') {
    return (
      <div className="Dropdown__menu__body">
        <BlankSlate
          placement="inline"
          small
          error
          icon={<CircleExclamationIcon />}
          title="Couldn't load the stages"
          code={describeError(workflow.error) ?? undefined}
          description={retryAdvice(workflow.error)}
          actions={
            <Button
              icon={RefreshIcon}
              label="Try again"
              onClick={() => setAttempt((value) => value + 1)}
            />
          }
        />
      </div>
    );
  }

  if (destinations.length === 0) {
    return (
      <Dropdown.Text>
        None of the selected records can move to another stage.
      </Dropdown.Text>
    );
  }

  return (
    <>
      {destinations.map((stage) => (
        <Dropdown.Option key={stage.id} onPick={() => onPick(stage)}>
          {stage.name}
        </Dropdown.Option>
      ))}
    </>
  );
}

/**
 * The menu of the "Move to stage" action of the selection bar: the stages of
 * the workflow, as a menu of choices. The pick starts the move.
 */
export function MoveToStageMenu(props: MoveToStageMenuProps) {
  return (
    <Dropdown.Menu placement="top-start">
      <StageOptions {...props} />
    </Dropdown.Menu>
  );
}

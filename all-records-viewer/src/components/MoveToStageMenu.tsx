import type { Client } from '@datocms/cma-client-browser';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { useEffect, useMemo, useState } from 'react';
import { loadError } from '../data/errors';
import { CircleExclamationIcon } from '../icons';
import { availableMoveDestinationIds } from '../operations/candidates';
import type { SelectionInput } from '../operations/types';
import type { WorkflowStageOption } from '../types';

export type MoveToStageMenuProps = {
  client: Client;
  /** The workflow of the model of the selected records */
  workflowId: string;
  /**
   * The selection as the page knows it. The menu offers only the stages that
   * at least one of these records can move to; the page checks the pick
   * again against the current records.
   */
  selectionInput: SelectionInput;
  /** Runs with the picked stage and every stage of the workflow */
  onPick: (
    stage: WorkflowStageOption,
    workflowId: string,
    workflowStageIds: readonly string[],
  ) => void;
};

type WorkflowState =
  | { status: 'loading' }
  | { status: 'loaded'; stages: readonly WorkflowStageOption[] }
  | { status: 'failed'; code: string };

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

  useEffect(() => {
    void attempt;
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
        setWorkflow({ status: 'failed', code: loadError(error).code });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, client, workflowId]);

  const stageIds = useMemo(
    () =>
      workflow.status === 'loaded'
        ? workflow.stages.map((stage) => stage.id)
        : [],
    [workflow],
  );
  const destinations = useMemo(() => {
    if (workflow.status !== 'loaded') return [];
    const allowed = new Set(
      availableMoveDestinationIds({
        ...selectionInput,
        destinationStageIds: stageIds,
      }),
    );
    return workflow.stages.filter((stage) => allowed.has(stage.id));
  }, [selectionInput, stageIds, workflow]);

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

  // "Try again" is an option of the menu: the arrow keys and Enter reach it,
  // and the menu stays open while the stages load again
  if (workflow.status === 'failed') {
    return (
      <>
        <div className="Dropdown__menu__body">
          <BlankSlate
            placement="inline"
            small
            error
            icon={<CircleExclamationIcon />}
            title="Couldn't load the stages"
            code={workflow.code}
          />
        </div>
        <Dropdown.Separator />
        <Dropdown.Option
          closeMenuOnClick={false}
          onPick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </Dropdown.Option>
      </>
    );
  }

  if (destinations.length === 0) {
    return (
      <Dropdown.Text>
        Your role can't move these records to another stage.
      </Dropdown.Text>
    );
  }

  return (
    <>
      {destinations.map((stage) => (
        <Dropdown.Option
          key={stage.id}
          onPick={() => onPick(stage, workflowId, stageIds)}
        >
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

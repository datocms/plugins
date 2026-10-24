import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, {
  type TableListColumn,
  type TableListErrors,
  type TableListTouched,
} from 'datocms-react-ui/TableList';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CircleExclamationIcon,
  iconComponent,
  ListCheckIcon,
  RefreshIcon,
} from '../icons';
import { buildCmaClient, describeError, fetchWorkflows } from '../lib/cma';
import { ICON_OPTIONS, iconByName } from '../lib/icons';
import {
  buildPageId,
  DEFAULT_ICON,
  readMenuItems,
  serializeMenuItems,
} from '../lib/parameters';
import { TEXTS } from '../texts';
import type { StageMenuItem, Workflow } from '../types';
import { useFrameSizedToContent } from '../utils/frame';
import s from './ConfigScreen.module.css';

type Props = { ctx: RenderConfigScreenCtx };

type EntryDraft = {
  /** The stage's page ID, or null until one is picked. */
  pageId: string | null;
  label: string;
  icon: string;
  /** The saved entry, kept to describe stages that no longer exist. */
  saved?: StageMenuItem;
};

type StageOption = { value: string; label: string; workflowName: string };
type StageGroup = { label: string; options: StageOption[] };
type IconOption = { value: string; label: string };

type WorkflowsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; workflows: Workflow[] };

function draftFromItem(item: StageMenuItem): EntryDraft {
  return {
    pageId: item.id,
    label: item.label ?? '',
    icon: item.icon ?? DEFAULT_ICON,
    saved: item,
  };
}

const newDraft = (): EntryDraft => ({
  pageId: null,
  label: '',
  icon: DEFAULT_ICON,
});

function findStage(workflows: Workflow[], pageId: string | null) {
  for (const workflow of workflows) {
    for (const stage of workflow.stages) {
      if (buildPageId(workflow.id, stage.id) === pageId) {
        return { workflow, stage };
      }
    }
  }
  return null;
}

/** Turns the drafts into saved entries, refreshing the workflow and stage names. */
function buildMenuItems(
  drafts: EntryDraft[],
  workflows: Workflow[],
): StageMenuItem[] {
  const items: StageMenuItem[] = [];
  for (const draft of drafts) {
    const match = findStage(workflows, draft.pageId);
    if (!match) continue;
    items.push({
      id: buildPageId(match.workflow.id, match.stage.id),
      workflowId: match.workflow.id,
      workflowName: match.workflow.name,
      stageId: match.stage.id,
      stageName: match.stage.name,
      label: draft.label.trim() || undefined,
      icon: draft.icon === DEFAULT_ICON ? undefined : draft.icon,
    });
  }
  return items;
}

function draftError(
  draft: EntryDraft,
  workflows: Workflow[],
): string | undefined {
  if (!draft.pageId) return 'Pick a stage';
  if (!findStage(workflows, draft.pageId)) return 'This stage no longer exists';
  return undefined;
}

function stageGroups(workflows: Workflow[]): StageGroup[] {
  return workflows.map((workflow) => ({
    label: workflow.name,
    options: workflow.stages.map((stage) => ({
      value: buildPageId(workflow.id, stage.id),
      label: stage.name,
      workflowName: workflow.name,
    })),
  }));
}

/** The option of a saved stage that was deleted since the settings were saved */
function savedStageOption(draft: EntryDraft, pageId: string): StageOption {
  return {
    value: pageId,
    label: draft.saved?.stageName ?? pageId,
    workflowName: draft.saved?.workflowName ?? '',
  };
}

/** The name of the stage of a row: the live one, else the saved one */
function stageName(draft: EntryDraft, workflows: Workflow[]): string | null {
  if (!draft.pageId) return null;
  const match = findStage(workflows, draft.pageId);
  return match?.stage.name ?? draft.saved?.stageName ?? draft.pageId;
}

const ICON_SELECT_OPTIONS: IconOption[] = ICON_OPTIONS.map(({ value }) => ({
  value,
  label: value,
}));

const unknownIconOption = (value: string): IconOption => ({
  value,
  label: value,
});

/** The parts people edit here; names are refreshed on every save anyway. */
function editableParts(items: StageMenuItem[]): string {
  return JSON.stringify(
    items.map(({ id, label, icon }) => [
      id,
      label ?? '',
      icon && icon !== DEFAULT_ICON ? icon : '',
    ]),
  );
}

function useWorkflows(ctx: RenderConfigScreenCtx) {
  const [state, setState] = useState<WorkflowsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    const load = async () => {
      try {
        const workflows = await fetchWorkflows(buildCmaClient(ctxRef.current));
        if (active) setState({ status: 'ready', workflows });
      } catch (error) {
        if (active) setState({ status: 'error', error });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}

function StageOptionLabel({
  option,
  context,
  taken,
}: {
  option: StageOption;
  context: 'menu' | 'value';
  taken: boolean;
}) {
  // The menu groups the stages by workflow: the value names the workflow
  if (context === 'value') {
    return (
      <span className={s.optionLabel}>
        <span className={s.optionText}>{option.label}</span>
        {option.workflowName ? (
          <span className={s.optionNote}>{option.workflowName}</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={s.optionLabel}>
      <span className={s.optionText}>{option.label}</span>
      {taken ? <span className={s.optionNote}>Already added</span> : null}
    </span>
  );
}

function IconOptionLabel({ name }: { name: string }) {
  const definition = iconByName(name);
  const Glyph = definition ? iconComponent(definition) : null;
  return (
    <span className={s.optionLabel}>
      {Glyph ? (
        <Glyph className={s.glyph} />
      ) : (
        <span className={s.glyph} aria-hidden="true" />
      )}
      <span className={s.optionText}>{name}</span>
    </span>
  );
}

function useColumns(
  workflows: Workflow[],
  drafts: EntryDraft[],
): TableListColumn<EntryDraft>[] {
  const groups = useMemo(() => stageGroups(workflows), [workflows]);
  // A stage can be in one row only. The key keeps the columns the same while
  // the user types a label.
  const takenKey = drafts.map(({ pageId }) => pageId ?? '').join('\n');
  const taken = useMemo(
    () => new Set(takenKey.split('\n').filter(Boolean)),
    [takenKey],
  );

  return useMemo<TableListColumn<EntryDraft>[]>(
    () => [
      {
        id: 'stage',
        field: 'pageId',
        label: 'Workflow stage',
        grow: 5,
        // The class of the cell input is for a text input: the select does
        // not take it
        render: ({
          item,
          index,
          value,
          onChange,
          onBlur,
          inputProps: { className: _, ...inputProps },
        }) => {
          const takenByOther = (pageId: string) =>
            pageId !== item.pageId && taken.has(pageId);
          return (
            <SelectInput<StageOption, StageGroup>
              {...inputProps}
              name={`stage-${index}`}
              value={typeof value === 'string' ? value : null}
              onChange={(pageId) => onChange(pageId)}
              onBlur={() => onBlur()}
              options={groups}
              placeholder="Pick a stage"
              clearable={false}
              variant="embedded"
              classNamePrefix="TableList__select"
              isOptionDisabled={(option) => takenByOther(option.value)}
              formatOptionLabel={(option, { context }) => (
                <StageOptionLabel
                  option={option}
                  context={context}
                  taken={takenByOther(option.value)}
                />
              )}
              acceptValueNotIncludedInOptions={(pageId) =>
                savedStageOption(item, pageId)
              }
            />
          );
        },
      },
      {
        id: 'label',
        field: 'label',
        label: 'Sidebar label',
        grow: 4,
        render: ({ item, value, onChange, onBlur, inputProps }) => (
          <StringInput
            {...inputProps}
            value={typeof value === 'string' ? value : null}
            onChange={(label) => onChange(label ?? '')}
            onBlur={() => onBlur()}
            // An empty label shows the name of the stage
            placeholder={stageName(item, workflows)}
          />
        ),
      },
      {
        id: 'icon',
        field: 'icon',
        label: 'Icon',
        grow: 4,
        render: ({
          index,
          value,
          onChange,
          onBlur,
          inputProps: { className: _, ...inputProps },
        }) => (
          <SelectInput<IconOption, { label: string; options: IconOption[] }>
            {...inputProps}
            name={`icon-${index}`}
            value={typeof value === 'string' ? value : DEFAULT_ICON}
            onChange={(icon) => onChange(icon ?? DEFAULT_ICON)}
            onBlur={() => onBlur()}
            options={ICON_SELECT_OPTIONS}
            clearable={false}
            isSearchable
            variant="embedded"
            classNamePrefix="TableList__select"
            formatOptionLabel={(option) => (
              <IconOptionLabel name={option.value} />
            )}
            acceptValueNotIncludedInOptions={unknownIconOption}
          />
        ),
      },
    ],
    [groups, taken, workflows],
  );
}

function StagePagesForm({
  ctx,
  workflows,
  savedItems,
}: {
  ctx: RenderConfigScreenCtx;
  workflows: Workflow[];
  savedItems: StageMenuItem[];
}) {
  const canEdit = ctx.currentRole.meta.final_permissions.can_edit_schema;
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    savedItems.map(draftFromItem),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const columns = useColumns(workflows, drafts);

  const errors: TableListErrors = drafts.map((draft) => ({
    pageId: draftError(draft, workflows),
  }));
  const hasErrors = drafts.some((draft) => draftError(draft, workflows));
  // A saved stage that no longer exists shows its error at once; a row with
  // no stage yet only after a save attempt
  const touched: TableListTouched = submitted
    ? true
    : drafts.map((draft) =>
        draft.pageId && !findStage(workflows, draft.pageId)
          ? { pageId: true }
          : undefined,
      );
  const nextItems = buildMenuItems(drafts, workflows);
  const dirty =
    drafts.length !== savedItems.length ||
    editableParts(nextItems) !== editableParts(savedItems);
  const takenPageIds = new Set(drafts.map(({ pageId }) => pageId));
  const someStageFree = workflows.some((workflow) =>
    workflow.stages.some(
      (stage) => !takenPageIds.has(buildPageId(workflow.id, stage.id)),
    ),
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !dirty || saving) return;

    setSubmitted(true);
    if (hasErrors) return;

    setSaving(true);
    try {
      await ctx.updatePluginParameters({
        ...ctx.plugin.attributes.parameters,
        ...serializeMenuItems(nextItems),
      });
      setDrafts(nextItems.map(draftFromItem));
      setSubmitted(false);
      ctx.notice('Settings saved.');
    } catch {
      ctx.alert("Couldn't save the settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {canEdit ? null : (
        <Callout>
          You need permission to edit the schema to change these settings.
        </Callout>
      )}
      <form onSubmit={handleSubmit}>
        <Page.Group
          title="Stage pages"
          footer={
            canEdit ? (
              <Button
                submit
                tone="primary"
                expand={false}
                label="Save"
                busy={saving}
                disabled={
                  dirty
                    ? undefined
                    : { reason: 'There are no changes to save.' }
                }
              />
            ) : undefined
          }
        >
          <FieldWrapper
            label="Stage pages"
            labelExtras={{ hidden: true }}
            hint="Each stage gets its own page in the content sidebar, listing every record in that stage across all the models that use its workflow."
          >
            <TableList<EntryDraft>
              value={drafts}
              onChange={(nextDrafts) => setDrafts(nextDrafts)}
              errors={errors}
              touched={touched}
              columns={columns}
              emptyMessage="No stages yet"
              add={
                canEdit && !saving && someStageFree
                  ? { label: 'Add stage', newItem: newDraft }
                  : undefined
              }
              disabled={!canEdit || saving}
            />
          </FieldWrapper>
        </Page.Group>
      </form>
    </>
  );
}

function ConfigContent({ ctx }: Props) {
  const savedItems = readMenuItems(ctx.plugin.attributes.parameters);
  const { state, retry } = useWorkflows(ctx);

  if (state.status === 'loading') {
    return (
      <BlankSlate placement="inline" loading title="Loading the workflows" />
    );
  }

  if (state.status === 'error') {
    return (
      <BlankSlate
        placement="inline"
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load the workflows"
        code={describeError(state.error) ?? undefined}
        description="Check your connection, then try again."
        actions={
          <Button icon={RefreshIcon} label="Try again" onClick={retry} />
        }
      />
    );
  }

  if (state.workflows.length === 0 && savedItems.length === 0) {
    return (
      <BlankSlate
        placement="inline"
        icon={<ListCheckIcon />}
        title="No workflows yet"
        description="Each workflow stage you pick here gets its own page in the content sidebar, listing every record in that stage across all models. Create a workflow in Settings, under Workflows, then come back to pick its stages."
      />
    );
  }

  return (
    <StagePagesForm
      ctx={ctx}
      workflows={state.workflows}
      savedItems={savedItems}
    />
  );
}

export default function ConfigScreen({ ctx }: Props) {
  useFrameSizedToContent();

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <Page>
        <Page.Content>
          <ConfigContent ctx={ctx} />
        </Page.Content>
      </Page>
    </Canvas>
  );
}

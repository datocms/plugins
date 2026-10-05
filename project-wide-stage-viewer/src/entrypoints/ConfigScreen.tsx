import { faTrashCan } from '@fortawesome/free-regular-svg-icons';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  FieldError,
  Form,
  FormLabel,
  SelectInput,
  Spinner,
  TextInput,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCmaClient, describeError, fetchWorkflows } from '../lib/cma';
import { ICON_OPTIONS, iconByName } from '../lib/icons';
import {
  buildPageId,
  DEFAULT_ICON,
  readMenuItems,
  serializeMenuItems,
} from '../lib/parameters';
import type { StageMenuItem, Workflow } from '../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import s from './ConfigScreen.module.css';

type Props = { ctx: RenderConfigScreenCtx };

type EntryDraft = {
  key: string;
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

let nextKey = 0;
function newKey(): string {
  nextKey += 1;
  return `entry-${nextKey}`;
}

function draftFromItem(item: StageMenuItem): EntryDraft {
  return {
    key: newKey(),
    pageId: item.id,
    label: item.label ?? '',
    icon: item.icon ?? DEFAULT_ICON,
    saved: item,
  };
}

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
  if (!draft.pageId) return 'Field is required';
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

function stageOption(
  draft: EntryDraft,
  groups: StageGroup[],
): StageOption | null {
  if (!draft.pageId) return null;
  for (const group of groups) {
    const option = group.options.find(({ value }) => value === draft.pageId);
    if (option) return option;
  }
  // A stage that was deleted since the settings were saved.
  return {
    value: draft.pageId,
    label: draft.saved?.stageName ?? draft.pageId,
    workflowName: draft.saved?.workflowName ?? '',
  };
}

/**
 * The config frame grows to fit open menus, but react-select sizes a menu to
 * the room left in the frame when it opens. Asking for the full height up
 * front opens it at full size, and the frame grows around it.
 */
const FULL_HEIGHT_MENU = { minMenuHeight: 300, maxMenuHeight: 300 };

const ICON_SELECT_OPTIONS: IconOption[] = ICON_OPTIONS.map(({ value }) => ({
  value,
  label: value,
}));

function iconOption(name: string): IconOption {
  return (
    ICON_SELECT_OPTIONS.find(({ value }) => value === name) ?? {
      value: name,
      label: name,
    }
  );
}

function IconOptionLabel({ option }: { option: IconOption }) {
  const icon = iconByName(option.value);
  return (
    <span className={s.iconOption}>
      <span className={s.iconPreview} aria-hidden="true">
        {icon ? <Icon icon={icon} /> : null}
      </span>
      <span className={s.iconName}>{option.label}</span>
    </span>
  );
}

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

type EntryRowProps = {
  draft: EntryDraft;
  index: number;
  groups: StageGroup[];
  takenPageIds: Set<string>;
  error: string | undefined;
  disabled: boolean;
  onChange: (patch: Partial<EntryDraft>) => void;
  onRemove: () => void;
};

function EntryRow({
  draft,
  index,
  groups,
  takenPageIds,
  error,
  disabled,
  onChange,
  onRemove,
}: EntryRowProps) {
  const option = stageOption(draft, groups);
  const name = option?.label ?? `entry ${index + 1}`;

  return (
    <li className={s.entry}>
      <div className={s.entryFields}>
        <SelectInput<StageOption, false, StageGroup>
          inputId={`stage-${index}`}
          aria-label={
            index === 0 ? undefined : `Workflow stage of entry ${index + 1}`
          }
          options={groups}
          value={option}
          placeholder="Select a stage…"
          {...FULL_HEIGHT_MENU}
          isDisabled={disabled}
          error={Boolean(error)}
          isOptionDisabled={(candidate) =>
            candidate.value !== draft.pageId &&
            takenPageIds.has(candidate.value)
          }
          formatOptionLabel={(candidate, { context }) => {
            if (context === 'value') {
              return (
                <span className={s.stageValue}>
                  {candidate.label}
                  <span className={s.stageWorkflow}>
                    {candidate.workflowName}
                  </span>
                </span>
              );
            }
            const taken =
              candidate.value !== draft.pageId &&
              takenPageIds.has(candidate.value);
            return taken ? (
              <span className={s.stageTaken}>
                {candidate.label} (already added)
              </span>
            ) : (
              candidate.label
            );
          }}
          onChange={(selected) => onChange({ pageId: selected?.value ?? null })}
        />
        <TextInput
          id={`label-${index}`}
          labelText={
            index === 0 ? undefined : `Sidebar label of entry ${index + 1}`
          }
          value={draft.label}
          placeholder={option?.label ?? 'Stage name'}
          disabled={disabled}
          onChange={(label) => onChange({ label })}
        />
        <SelectInput<IconOption, false>
          inputId={`icon-${index}`}
          aria-label={index === 0 ? undefined : `Icon of entry ${index + 1}`}
          options={ICON_SELECT_OPTIONS}
          {...FULL_HEIGHT_MENU}
          value={iconOption(draft.icon)}
          isDisabled={disabled}
          isSearchable
          formatOptionLabel={(candidate) => (
            <IconOptionLabel option={candidate} />
          )}
          onChange={(selected) =>
            onChange({ icon: selected?.value ?? DEFAULT_ICON })
          }
        />
        {disabled ? null : (
          <Tooltip>
            <TooltipTrigger>
              <button
                type="button"
                className={`dl-icon-button ${s.remove}`}
                aria-label={`Remove ${name}`}
                onClick={onRemove}
              >
                <Icon icon={faTrashCan} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="dl-tooltip-text">Remove</div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {error ? (
        <div className={s.entryError}>
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </li>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const savedItems = readMenuItems(ctx.plugin.attributes.parameters);
  const canEdit = ctx.currentRole.meta.final_permissions.can_edit_schema;
  const { state, retry } = useWorkflows(ctx);
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    savedItems.map(draftFromItem),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  if (state.status === 'loading') {
    return (
      <Canvas ctx={ctx}>
        <div className={s.loading}>
          <Spinner size={40} placement="centered" />
        </div>
      </Canvas>
    );
  }

  if (state.status === 'error') {
    const reason = describeError(state.error);
    return (
      <Canvas ctx={ctx}>
        <div className={s.callout} role="alert">
          <div className={s.calloutText}>
            <strong>Couldn't load the workflows.</strong>{' '}
            {reason ?? 'Check your connection and try again.'}
          </div>
          <Button buttonSize="s" onClick={retry}>
            Try again
          </Button>
        </div>
      </Canvas>
    );
  }

  const { workflows } = state;
  const groups = stageGroups(workflows);
  const errors = drafts.map((draft) => draftError(draft, workflows));
  const hasErrors = errors.some(Boolean);
  const nextItems = buildMenuItems(drafts, workflows);
  const dirty =
    drafts.length !== savedItems.length ||
    editableParts(nextItems) !== editableParts(savedItems);
  const takenPageIds = new Set(
    drafts.flatMap((draft) => (draft.pageId ? [draft.pageId] : [])),
  );
  const allStagesTaken = groups.every((group) =>
    group.options.every((option) => takenPageIds.has(option.value)),
  );

  const updateDraft = (key: string, patch: Partial<EntryDraft>) =>
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );

  const addDraft = () =>
    setDrafts((current) => [
      ...current,
      { key: newKey(), pageId: null, label: '', icon: DEFAULT_ICON },
    ]);

  const handleSubmit = async () => {
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
      ctx.notice('Settings successfully saved!');
    } catch {
      ctx.alert("Couldn't save the settings!");
    } finally {
      setSaving(false);
    }
  };

  if (workflows.length === 0 && drafts.length === 0) {
    return (
      <Canvas ctx={ctx}>
        <div className="dl-kit-form-parity">
          <p className={s.intro}>
            This plugin gives workflow stages their own page in the content
            sidebar, listing every record in the stage across all models.
          </p>
          <p className={s.empty}>
            This project has no workflows yet. Create one in Settings, under
            Workflows, then come back here to pick its stages.
          </p>
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <Form className="dl-kit-form-parity" onSubmit={handleSubmit}>
        <p className={s.intro}>
          Each stage you add gets its own page in the content sidebar, listing
          every record in that stage across all the models that use its
          workflow.
        </p>

        {canEdit ? null : (
          <div className={s.callout} role="status">
            <div className={s.calloutText}>
              You need permission to edit the schema to change these settings.
            </div>
          </div>
        )}

        {drafts.length > 0 ? (
          <div>
            <div className={s.entryFields}>
              <FormLabel htmlFor="stage-0" required>
                Workflow stage
              </FormLabel>
              <FormLabel htmlFor="label-0">Sidebar label</FormLabel>
              <FormLabel htmlFor="icon-0">Icon</FormLabel>
            </div>
            <ul className={s.entries}>
              {drafts.map((draft, index) => (
                <EntryRow
                  key={draft.key}
                  draft={draft}
                  index={index}
                  groups={groups}
                  takenPageIds={takenPageIds}
                  error={submitted ? errors[index] : undefined}
                  disabled={!canEdit || saving}
                  onChange={(patch) => updateDraft(draft.key, patch)}
                  onRemove={() =>
                    setDrafts((current) =>
                      current.filter(({ key }) => key !== draft.key),
                    )
                  }
                />
              ))}
            </ul>
          </div>
        ) : (
          <p className={s.empty}>
            No stages in the sidebar yet. Add the first one below.
          </p>
        )}

        {canEdit ? (
          <div className={s.add}>
            <Button
              buttonSize="xs"
              leftIcon={<Icon icon={faPlus} />}
              disabled={saving || allStagesTaken}
              onClick={addDraft}
            >
              Add new stage
            </Button>
          </div>
        ) : null}

        {canEdit ? (
          <Button
            type="submit"
            buttonType="primary"
            buttonSize="xl"
            fullWidth
            disabled={!dirty || saving}
          >
            {saving ? (
              <>
                Please wait&nbsp;
                <Spinner size={20} />
              </>
            ) : (
              'Save settings'
            )}
          </Button>
        ) : null}
      </Form>
    </Canvas>
  );
}

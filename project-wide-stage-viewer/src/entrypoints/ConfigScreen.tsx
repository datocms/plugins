import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Form,
  Section,
  SelectField,
  Spinner,
  TextField,
  CreatableSelectField,
} from 'datocms-react-ui';
import { buildCmaClient } from '../utils/cma';
import type { PluginParameters, StageMenuItem } from '../types';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type WorkflowStage = {
  id: string;
  name: string;
};

type WorkflowSummary = {
  id: string;
  name: string;
  stages: WorkflowStage[];
};

type SelectOption = {
  value: string;
  label: string;
};

const BasicSelectField = SelectField as unknown as (props: Record<string, unknown>) => JSX.Element;
const IconSelectField = CreatableSelectField as unknown as (props: Record<string, unknown>) => JSX.Element;

const FONT_AWESOME_LINK_ID = 'project-stage-viewer-fa';

export default function ConfigScreen({ ctx }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<StageMenuItem[]>(() => {
    const rawParams = (ctx.plugin.attributes.parameters ?? {}) as Partial<PluginParameters>;
    return rawParams.menuItems ?? [];
  });
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [labelOverride, setLabelOverride] = useState('');
  const [iconOverride, setIconOverride] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const canEditSchema = ctx.currentRole?.attributes.can_edit_schema ?? false;

  useEffect(() => {
    const rawParams = (ctx.plugin.attributes.parameters ?? {}) as Partial<PluginParameters>;
    setMenuItems(rawParams.menuItems ?? []);
  }, [ctx.plugin.attributes.parameters]);

  useEffect(() => {
    if (document.getElementById(FONT_AWESOME_LINK_ID)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = FONT_AWESOME_LINK_ID;
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
    document.head.append(link);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkflows() {
      try {
        setWorkflowsLoading(true);
        setLoadError(null);

        const client = buildCmaClient(ctx);
        const raw = await client.workflows.list();
        const workflowArray = Array.isArray(raw) ? raw : [];

        const mapped = workflowArray.map((wf) => ({
          id: wf.id,
          name: wf.name ?? wf.id,
          stages: (wf.stages ?? []).map((stage) => ({
            id: stage.id,
            name: stage.name ?? stage.id,
          })),
        }));

        if (isMounted) {
          setWorkflows(mapped);
        }
      } catch (error) {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load workflows.');
        }
      } finally {
        if (isMounted) {
          setWorkflowsLoading(false);
        }
      }
    }

    void loadWorkflows();

    return () => {
      isMounted = false;
    };
  }, [ctx]);

  const workflowOptions = useMemo<SelectOption[]>(
    () => workflows.map((wf) => ({ value: wf.id, label: wf.name })),
    [workflows],
  );

  const selectedWorkflow = useMemo(
    () => workflows.find((wf) => wf.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  );

  const stageOptions = useMemo<SelectOption[]>(
    () => selectedWorkflow?.stages.map((stage) => ({ value: stage.id, label: stage.name })) ?? [],
    [selectedWorkflow],
  );

  const selectedStage = useMemo(
    () => selectedWorkflow?.stages.find((stage) => stage.id === selectedStageId) ?? null,
    [selectedWorkflow, selectedStageId],
  );

  const handleWorkflowChange = useCallback((option: SelectOption | null) => {
    const nextWorkflowId = option?.value ?? null;
      setSelectedWorkflowId(nextWorkflowId);
      setSelectedStageId(null);
      setActionError(null);
  }, []);

  const handleStageChange = useCallback((option: SelectOption | null) => {
    setSelectedStageId(option?.value ?? null);
    setActionError(null);
  }, []);

  const resetForm = useCallback(() => {
    setSelectedWorkflowId(null);
    setSelectedStageId(null);
    setLabelOverride('');
    setIconOverride('');
  }, []);

  const iconOptions = useMemo<SelectOption[]>(
    () => [
      'tasks',
      'flag',
      'check',
      'check-circle',
      'clipboard-list',
      'clock',
      'comments',
      'edit',
      'inbox',
      'lightbulb',
      'list',
      'list-alt',
      'play-circle',
      'project-diagram',
      'rocket',
      'star',
      'sticky-note',
      'stream',
      'table',
      'thermometer-half',
      'thumbs-up',
      'tools',
      'user-check',
      'wrench',
    ].map((icon) => ({ value: icon, label: icon })),
    [],
  );

  const selectedIconOption = useMemo<SelectOption | null>(
    () => {
      if (!iconOverride) {
        return null;
      }

      const match = iconOptions.find((option) => option.value === iconOverride);
      if (match) {
        return match;
      }

      return { value: iconOverride, label: iconOverride };
    },
    [iconOptions, iconOverride],
  );

  const handleAdd = useCallback(async () => {
    if (!selectedWorkflow || !selectedStage || isSaving) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    const id = `wf:${selectedWorkflow.id}__st:${selectedStage.id}`;
    const trimmedLabel = labelOverride.trim();
    const trimmedIcon = iconOverride.trim();

    const nextItem: StageMenuItem = {
      id,
      workflowId: selectedWorkflow.id,
      workflowName: selectedWorkflow.name,
      stageId: selectedStage.id,
      stageName: selectedStage.name,
      label: trimmedLabel !== '' ? trimmedLabel : undefined,
      icon: trimmedIcon !== '' ? trimmedIcon : undefined,
    };

    const currentParams = (ctx.plugin.attributes.parameters ?? {}) as Partial<PluginParameters>;
    const filteredItems = menuItems.filter((item) => item.id !== id);
    const nextMenuItems = [...filteredItems, nextItem];

    try {
      await ctx.updatePluginParameters({
        ...currentParams,
        menuItems: nextMenuItems,
      });
      setMenuItems(nextMenuItems);
      resetForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save menu item.');
    } finally {
      setIsSaving(false);
    }
  }, [
    ctx,
    iconOverride,
    isSaving,
    labelOverride,
    menuItems,
    resetForm,
    selectedStage,
    selectedWorkflow,
  ]);

  const handleRemove = useCallback(
    async (itemId: string) => {
      if (isSaving) {
        return;
      }

      setIsSaving(true);
      setActionError(null);

      const currentParams = (ctx.plugin.attributes.parameters ?? {}) as Partial<PluginParameters>;
      const nextMenuItems = menuItems.filter((item) => item.id !== itemId);

      try {
        await ctx.updatePluginParameters({
          ...currentParams,
          menuItems: nextMenuItems,
        });
        setMenuItems(nextMenuItems);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to remove menu item.');
      } finally {
        setIsSaving(false);
      }
    },
    [ctx, isSaving, menuItems],
  );

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
        {actionError ? <p className={s.error}>{actionError}</p> : null}

        <div className={s.section}>
          <Section title="Workflow stage menu items">
            <p className={s.instructions}>
              Pick a workflow stage, optionally customise its label/icon, then add it. Each saved stage appears in the
              content sidebar and opens a paginated view of every record currently in that stage.
            </p>
            {workflowsLoading ? (
              <div className={s.loading}>
                <Spinner />
                <span className={s.loadingLabel}>Loading workflows...</span>
              </div>
            ) : loadError ? (
              <p className={s.error}>{loadError}</p>
            ) : (
              <Form className={s.form} onSubmit={(event) => event.preventDefault()}>
                {!canEditSchema ? (
                  <p className={s.notice}>
                    You need schema permissions to add or remove menu items.
                  </p>
                ) : null}
                <BasicSelectField
                  id="workflow"
                  name="workflow"
                  label="Workflow"
                  required
                  value={workflowOptions.find((option) => option.value === selectedWorkflowId) ?? null}
                  onChange={(option: SelectOption | null) => handleWorkflowChange(option)}
                  selectInputProps={{
                    options: workflowOptions,
                    isClearable: true,
                    isDisabled: !canEditSchema,
                  }}
                />
                <BasicSelectField
                  id="stage"
                  name="stage"
                  label="Stage"
                  required
                  value={stageOptions.find((option) => option.value === selectedStageId) ?? null}
                  onChange={(option: SelectOption | null) => handleStageChange(option)}
                  selectInputProps={{
                    options: stageOptions,
                    isClearable: true,
                    isDisabled: !selectedWorkflow || !canEditSchema,
                  }}
                />
                <TextField
                  id="label"
                  name="label"
                  label="Custom label"
                  placeholder="Optional label override"
                  value={labelOverride}
                  onChange={(newValue) => setLabelOverride(newValue)}
                  textInputProps={{ disabled: !canEditSchema }}
                />
                <IconSelectField
                  id="icon"
                  name="icon"
                  label="Custom icon"
                  value={selectedIconOption}
                  onChange={(option: SelectOption | null) => setIconOverride(option?.value ?? '')}
                  selectInputProps={{
                    options: iconOptions,
                    isClearable: true,
                    isSearchable: true,
                    placeholder: 'Optional FontAwesome icon name',
                    isDisabled: !canEditSchema,
                    formatOptionLabel: (option: SelectOption) => (
                      <span className={s.iconOption}>
                        <span className={s.iconPreview}>
                          <span className={`fa-solid fa-${option.value}`} aria-hidden="true" />
                        </span>
                        <span>{option.label}</span>
                      </span>
                    ),
                  }}
                />
                <div className={s.actions}>
                  <Button
                    buttonType="primary"
                    buttonSize="l"
                    disabled={!canEditSchema || !selectedWorkflow || !selectedStage || isSaving}
                    onClick={handleAdd}
                  >
                    Add this
                  </Button>
                </div>
              </Form>
            )}
          </Section>
        </div>

        <div className={s.section}>
          <Section title="Configured menu items">
            {menuItems.length === 0 ? (
              <p className={s.empty}>No menu items configured yet.</p>
            ) : (
              <ul className={s.menuItems}>
                {menuItems.map((item) => (
                  <li key={item.id} className={s.menuItem}>
                    <div className={s.menuItemDetails}>
                      <span className={s.menuItemLabel}>{
                        item.label ?? `${item.stageName} (${item.workflowName})`
                      }</span>
                      <span className={s.menuItemMeta}>
                        {item.workflowName}
                        {' -> '}
                        {item.stageName}
                      </span>
                      {item.icon ? (
                        <span className={s.menuItemMeta}>Icon: {item.icon}</span>
                      ) : null}
                    </div>
                    <Button
                      buttonType="muted"
                      buttonSize="s"
                      onClick={() => handleRemove(item.id)}
                      disabled={!canEditSchema || isSaving}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </Canvas>
  );
}

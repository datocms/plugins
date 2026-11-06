import type { SchemaTypes } from '@datocms/cma-client';
import classNames from 'classnames';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { useDebouncedValue } from 'datocms-react-ui/hooks/useDebouncedValue';
import Pane, { useFilteredList } from 'datocms-react-ui/Pane';
import { type CSSProperties, useEffect, useMemo } from 'react';
import { useHoverModelId } from '../../context/HoverItemContext';
import { EyeIcon, EyeSlashIcon, ModelIcon } from '../../icons';
import type { ActiveModels } from '../../types';
import {
  buildPermissions,
  canReadAtLeastSomeItem,
  type Permissions,
} from '../../utils/canRead';
import { colorForModel } from '../../utils/colorForModel';
import s from './styles.module.css';

type ActiveModelsPanelProps = {
  activeModels: ActiveModels;
  onChange: (newValue: ActiveModels) => void;
};

function nameId(modelId: string) {
  return `modelId-${modelId}-name`;
}

export function ActiveModelsPanel({
  activeModels,
  onChange,
}: ActiveModelsPanelProps) {
  const ctx = useCtx<RenderPageCtx>();
  const hoverModelId = useHoverModelId();
  const debouncedModelId = useDebouncedValue(hoverModelId, 250);

  // The row of the model of the record under the pointer comes into view
  useEffect(() => {
    if (!debouncedModelId) {
      return;
    }

    document.getElementById(nameId(debouncedModelId))?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [debouncedModelId]);

  const permissions = useMemo<Permissions>(
    () => buildPermissions(ctx.currentRole, ctx.environment),
    [ctx.currentRole, ctx.environment],
  );

  const allSortedModels = useMemo(
    () =>
      (Object.values(ctx.itemTypes) as SchemaTypes.ItemType[])
        .filter((model) => !model.attributes.modular_block)
        .filter((model) => canReadAtLeastSomeItem(permissions, model))
        .sort((a, b) => a.attributes.name.localeCompare(b.attributes.name)),
    [ctx.itemTypes, permissions],
  );

  const { filter, filteredItems, hasNoResults } = useFilteredList(
    allSortedModels,
    (model) => [model.attributes.name, model.attributes.api_key],
  );

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(ctx.ui.locale),
    [ctx.ui.locale],
  );

  const isActive = (model: SchemaTypes.ItemType) =>
    activeModels === 'all' || activeModels.includes(model.id);

  const toggle = (model: SchemaTypes.ItemType) => {
    const active = isActive(model);

    if (activeModels === 'all') {
      onChange(
        allSortedModels.map((m) => m.id).filter((id) => id !== model.id),
      );
    } else if (active) {
      onChange(activeModels.filter((id) => id !== model.id));
    } else {
      const newValue = [...activeModels, model.id];
      if (
        allSortedModels
          .map((m) => m.id)
          .sort()
          .join(',') === newValue.sort().join(',')
      ) {
        onChange('all');
      } else {
        onChange(newValue);
      }
    }
  };

  const hasModels = allSortedModels.length > 0;
  const modelCount =
    allSortedModels.length === 1
      ? '1 model'
      : `${numberFormat.format(allSortedModels.length)} models`;

  return (
    <Pane
      ariaLabel="Models"
      header={
        <Pane.Header filter={hasModels ? filter : undefined}>
          <Pane.Header.Title>Models</Pane.Header.Title>
          {hasModels && (
            <Pane.Header.Subtitle>{modelCount}</Pane.Header.Subtitle>
          )}
          {hasModels && (
            <Pane.Header.Menu>
              <Dropdown.Option
                icon={<EyeIcon />}
                onPick={() => onChange('all')}
                disabled={
                  activeModels === 'all'
                    ? { reason: 'All the models are already shown.' }
                    : undefined
                }
              >
                Show all models
              </Dropdown.Option>
              <Dropdown.Option
                icon={<EyeSlashIcon />}
                onPick={() => onChange([])}
                disabled={
                  activeModels !== 'all' && activeModels.length === 0
                    ? { reason: 'No model is shown.' }
                    : undefined
                }
              >
                Hide all models
              </Dropdown.Option>
            </Pane.Header.Menu>
          )}
        </Pane.Header>
      }
    >
      {!hasModels ? (
        <BlankSlate
          placement="area"
          small
          icon={<ModelIcon />}
          title="No models"
          description="Your role can't read the records of any model."
        />
      ) : hasNoResults ? (
        <Pane.FilterBlankSlate />
      ) : (
        <ul className={s.list}>
          {filteredItems.map((model) => (
            <li key={model.id}>
              <label className={s.row}>
                <input
                  type="checkbox"
                  className={s.checkbox}
                  checked={isActive(model)}
                  onChange={() => toggle(model)}
                />
                <span
                  id={nameId(model.id)}
                  className={classNames(s.modelLabel, {
                    [s.highlighted]: hoverModelId === model.id,
                  })}
                >
                  <span
                    className={s.swatch}
                    aria-hidden="true"
                    style={
                      {
                        '--model-color': colorForModel(model.id),
                      } as CSSProperties
                    }
                  />
                  <span className={s.name}>{model.attributes.name}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

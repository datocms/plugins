import classNames from 'classnames';
import { ModelBlock } from 'datocms-plugin-sdk';
import { Button, useCtx } from 'datocms-react-ui';
import { CSSProperties, useCallback } from 'react';
import { useHoverModelId } from '../../context/HoverItemContext';
import useDebouncedEffect from '../../hooks/useDebouncedEffect';
import { ActiveModels } from '../../types';
import { colorForModel } from '../../utils/colorForModel';
import s from './styles.module.css';

type ActiveModelsPanelProps = {
  activeModels: ActiveModels;
  onChange: (newValue: ActiveModels) => void;
};

export function ActiveModelsPanel({
  activeModels,
  onChange,
}: ActiveModelsPanelProps) {
  const ctx = useCtx();
  const modelId = useHoverModelId();

  useDebouncedEffect(
    () => {
      document.getElementById(`modelId-${modelId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    },
    250,
    [modelId],
  );

  const handleDeselectAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  const handleSelectAll = useCallback(() => {
    onChange('all');
  }, [onChange]);

  const allSortedModels = (Object.values(ctx.itemTypes) as ModelBlock[])
    .filter((model) => !model.attributes.modular_block)
    .sort((a, b) => a.attributes.name.localeCompare(b.attributes.name));

  return (
    <div className={s.root}>
      <div className={s.options}>
        {activeModels !== 'all' && (
          <Button
            type="button"
            fullWidth
            buttonSize="xxs"
            onClick={handleSelectAll}
          >
            Select all
          </Button>
        )}
        {(activeModels === 'all' || activeModels.length > 0) && (
          <Button
            type="button"
            fullWidth
            buttonSize="xxs"
            onClick={handleDeselectAll}
          >
            Deselect all
          </Button>
        )}
      </div>
      {allSortedModels.map((model) => {
        const active =
          activeModels === 'all' || activeModels.includes(model.id);

        return (
          <div
            key={model.id}
            className={classNames(s.model, {
              [s.modelActive]: modelId === model.id,
            })}
            id={`modelId-${model.id}`}
          >
            <label
              className={classNames(s.toggler, { [s.togglerActive]: active })}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => {
                  if (activeModels === 'all') {
                    onChange(
                      allSortedModels
                        .map((model) => model.id)
                        .filter((id) => id !== model.id),
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
                }}
              />{' '}
              {model.attributes.name}
            </label>
            <div
              className={s.color}
              style={
                {
                  '--color-rgb-components': colorForModel(model.id).join(', '),
                } as CSSProperties
              }
            />
          </div>
        );
      })}
    </div>
  );
}

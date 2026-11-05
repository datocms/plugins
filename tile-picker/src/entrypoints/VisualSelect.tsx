import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import get from 'lodash-es/get';
import { useEffect, useMemo, useRef } from 'react';
import Visualizer from '../components/visualizers/visualizer';
import lang, {
  EN_NO_OPTIONS,
  EN_NO_VALUE_MATCH,
  EN_PLEASE_SELECT_OPTION,
} from '../lang';
import s from '../lib/styles.module.css';
import type { Option } from '../lib/types';
import {
  normalizeFieldParameters,
  normalizePluginParameters,
} from '../lib/types';

type VisualSelectProps = {
  ctx: RenderFieldExtensionCtx;
};

const defaults = {
  columns: 6,
  width: '250px',
};

const VisualSelect = ({ ctx }: VisualSelectProps) => {
  const selectedTile = useRef<HTMLSpanElement>(null);

  const [options, presentation] = useMemo(() => {
    const { presets: allPresets } = normalizePluginParameters(
      ctx.plugin.attributes.parameters,
    );
    const { config } = normalizeFieldParameters(ctx.parameters);
    const presetOptions = (config.presets ?? []).flatMap(
      (key) => allPresets[key] ?? [],
    );
    return [
      [...presetOptions, ...(config.options ?? [])] as Option[],
      config.presentation ?? {},
    ];
  }, [ctx.parameters, ctx.plugin.attributes.parameters]);

  const currentValue = useMemo(
    () => get(ctx.formValues, ctx.fieldPath) as string,
    [ctx.formValues, ctx.fieldPath],
  );

  // An empty field (null, or "" in a field added after the record) has no
  // value to match: only a value that no option has gets the warning
  const hasValidValue = useMemo(
    () =>
      !currentValue || options.some((option) => option.value === currentValue),
    [options, currentValue],
  );

  const isCarousel = presentation.type === 'carousel';

  // On mount, the carousel scrolls the selected tile into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, as before
  useEffect(() => {
    if (isCarousel && selectedTile.current) {
      selectedTile.current.scrollIntoView({
        block: 'nearest',
        inline: 'center',
      });
    }
  }, []);

  const tiles = (
    <fieldset
      aria-label={ctx.field.attributes.label}
      disabled={ctx.disabled}
      className={s.tiles}
      style={
        isCarousel
          ? undefined
          : {
              gridTemplateColumns: `repeat(${presentation.columns ?? defaults.columns}, minmax(0, 1fr))`,
            }
      }
    >
      {options.map((option, index) => (
        <label
          // biome-ignore lint/suspicious/noArrayIndexKey: options have no id, and names can repeat
          key={index}
          className={s.option}
          style={
            isCarousel
              ? { width: presentation.width ?? defaults.width }
              : undefined
          }
        >
          <input
            type="radio"
            className={s.radio}
            name={ctx.fieldPath}
            value={option.value}
            checked={currentValue === option.value}
            onChange={() => ctx.setFieldValue(ctx.fieldPath, option.value)}
          />
          <span
            ref={currentValue === option.value ? selectedTile : null}
            className={s.tile}
          >
            <Visualizer option={option} />
            <span className={s.name}>{option.name}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <>
      {!hasValidValue && (
        <Callout tone="warning" title="Unknown value">
          {lang(EN_NO_VALUE_MATCH, { value: currentValue })}{' '}
          {lang(EN_PLEASE_SELECT_OPTION)}
        </Callout>
      )}
      {options.length === 0 && (
        <Callout tone="warning">{lang(EN_NO_OPTIONS)}</Callout>
      )}
      {isCarousel ? <div className={s.carousel}>{tiles}</div> : tiles}
    </>
  );
};

export default VisualSelect;

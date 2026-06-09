/**
 * TranslationConfirmModal.tsx
 * ---------------------------
 * Styled replacement for the native `ctx.openConfirm` gate shown before a
 * bulk translation starts. The native confirm only renders plain-text
 * content; this modal shows the record count and the source/target locales as
 * chips (via {@link LocaleChip}), matching the picker and progress surfaces.
 *
 * Resolves `true` when the user confirms, `false` when they cancel. Opened
 * from the items-dropdown handler (a non-modal context), so it doesn't nest
 * inside another modal.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { Fragment } from 'react';
import { renderChipOption } from './BulkTranslations/chipOption';
import { LocaleChip } from './BulkTranslations/LocaleChip';
import { ModelLabel } from './BulkTranslations/ModelLabel';
import s from './TranslationConfirmModal.module.css';

/** One model's translation summary: its name, api_key, and selected fields. */
export interface ConfirmModelSummary {
  label: string;
  code: string;
  fields: Array<{ label: string; apiKey: string }>;
}

export interface TranslationConfirmModalParams {
  recordCount: number;
  fromLocale: string;
  toLocales: string[];
  /**
   * Optional per-model breakdown of exactly which fields will be translated.
   * When present, the modal renders a "Models & fields" section so the user
   * can review arbitrary model/field combinations before starting.
   */
  models?: ConfirmModelSummary[];
}

/**
 * Validates the modal parameters at runtime, mirroring the guards used by the
 * other modals registered in `main.tsx`.
 */
export function isTranslationConfirmModalParams(
  params: unknown,
): params is TranslationConfirmModalParams {
  if (!params || typeof params !== 'object') return false;
  const p = params as Record<string, unknown>;
  return (
    typeof p.recordCount === 'number' &&
    typeof p.fromLocale === 'string' &&
    Array.isArray(p.toLocales)
  );
}

interface Props {
  ctx: RenderModalCtx;
  parameters: TranslationConfirmModalParams;
}

export default function TranslationConfirmModal({ ctx, parameters }: Props) {
  const { recordCount, fromLocale, toLocales, models } = parameters;
  const recordLabel = `${recordCount} record${recordCount === 1 ? '' : 's'}`;
  const localeLabel = `${toLocales.length} locale${
    toLocales.length === 1 ? '' : 's'
  }`;
  const hasModels = !!models && models.length > 0;
  const modelLabel = `${models?.length ?? 0} model${
    models?.length === 1 ? '' : 's'
  }`;

  return (
    <Canvas ctx={ctx}>
      <div className={s.modal}>
        <p className={s.lead}>
          This will translate <strong>{recordLabel}</strong>
          {hasModels ? (
            <>
              {' '}
              across <strong>{modelLabel}</strong>
            </>
          ) : null}{' '}
          into <strong>{localeLabel}</strong>.
        </p>

        <div className={s.summary}>
          <div className={s.row}>
            <span className={s.label}>From</span>
            <LocaleChip locale={fromLocale} />
          </div>
          <div className={s.row}>
            <span className={s.label}>To</span>
            <div className={s.chips}>
              {toLocales.map((loc) => (
                <LocaleChip key={loc} locale={loc} />
              ))}
            </div>
          </div>
        </div>

        {hasModels ? (
          <div className={s.modelsSection}>
            <div className={s.sectionLabel}>Models &amp; fields</div>
            <ul className={s.modelList}>
              {models?.map((model) => (
                <li key={model.code} className={s.modelItem}>
                  <div className={s.modelName}>
                    <ModelLabel label={model.label} code={model.code} />
                  </div>
                  {model.fields.length > 0 ? (
                    <div className={s.fieldChips}>
                      {model.fields.map((field) => (
                        <Fragment key={field.apiKey}>
                          {renderChipOption({
                            label: field.label,
                            value: field.apiKey,
                            code: field.apiKey,
                          })}
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <span className={s.noFields}>No fields selected</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={s.footer}>
          <Button
            type="button"
            buttonType="muted"
            buttonSize="s"
            onClick={() => ctx.resolve(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            buttonType="primary"
            buttonSize="s"
            onClick={() => ctx.resolve(true)}
          >
            Translate {recordLabel}
          </Button>
        </div>
      </div>
    </Canvas>
  );
}

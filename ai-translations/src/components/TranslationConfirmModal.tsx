/**
 * TranslationConfirmModal.tsx
 * ---------------------------
 * The review shown before a bulk translation starts: how many records, from
 * which locale into which locales, and which fields of each model. It is a
 * modal opened with `ctx.openModal` rather than `ctx.openConfirm`, because
 * the native confirm shows plain text only and can't hold the breakdown.
 *
 * Resolves `true` when the user starts the run, `false` when they cancel.
 * Its footer has Cancel at the left, so it opens with no host cross
 * (`closeDisabled`) and registers Escape as that Cancel, as a dialog with a
 * footer does. Opened from non-modal contexts (the items-dropdown handler
 * and the bulk page), so it never nests inside another modal.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import ApiKey from 'datocms-react-ui/ApiKey';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import { formatLocaleWithCode } from '../utils/localeUtils';
import {
  localeCount,
  modelCount,
  recordCount,
  translateRecordsLabel,
} from './BulkTranslations/bulkCopy';
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
   * When present, the modal lists the models and their fields so the user
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

/**
 * From this many record × target locale translations on, the modal warns
 * about the provider usage and asks to keep the progress window open.
 */
const LARGE_RUN_THRESHOLD = 10_000;

/** The Escape of the dialog: the Cancel of its footer. */
const CANCEL_ACTION_ID = 'translationConfirm.cancel';

interface Props {
  ctx: RenderModalCtx;
  parameters: TranslationConfirmModalParams;
}

export default function TranslationConfirmModal({ ctx, parameters }: Props) {
  const { recordCount: count, fromLocale, toLocales, models } = parameters;
  const hasModels = !!models && models.length > 0;
  // Counts get the separators of the language that the Canvas gives the kit.
  const locale = ctx.ui.locale;
  const across = hasModels
    ? ` across ${modelCount(models.length, locale)}`
    : '';
  const isLargeRun = count * toLocales.length >= LARGE_RUN_THRESHOLD;
  const cancel = () => ctx.resolve(false);

  // The host draws no cross on this dialog, so Escape is the Cancel of the
  // footer, as in the kit's dialogs. Its key only makes sense as a key.
  useRegisterActions([
    {
      id: CANCEL_ACTION_ID,
      name: 'Cancel',
      shortcut: { key: 'escape' },
      palette: 'hidden',
      run: cancel,
    },
  ]);

  return (
    <>
      <p className={s.lead}>
        This translates {recordCount(count, locale)}
        {across} into {localeCount(toLocales.length, locale)}.
      </p>

      {isLargeRun && (
        <Callout tone="warning" title="Large translation">
          Each selected field is translated into every target locale, so
          provider usage can be large. Keep the progress window open until the
          run finishes.
        </Callout>
      )}

      <InfoList>
        <InfoList.Row title="From">
          {formatLocaleWithCode(fromLocale)}
        </InfoList.Row>
        <InfoList.Row title="To">
          {toLocales.map(formatLocaleWithCode).join(', ')}
        </InfoList.Row>
        {hasModels && (
          <InfoList.Group title="Models and fields">
            {models.map((model) => (
              <InfoList.Row
                key={model.code}
                title={
                  <>
                    {model.label} <ApiKey>{model.code}</ApiKey>
                  </>
                }
              >
                {model.fields.length > 0
                  ? model.fields.map((field) => field.label).join(', ')
                  : 'No fields selected'}
              </InfoList.Row>
            ))}
          </InfoList.Group>
        )}
      </InfoList>

      <div className={s.actions}>
        <Button
          tone="ghost"
          label="Cancel"
          className={s.cancel}
          onClick={cancel}
        />
        <Button
          tone="primary"
          label={translateRecordsLabel(count, locale)}
          onClick={() => ctx.resolve(true)}
        />
      </div>
    </>
  );
}

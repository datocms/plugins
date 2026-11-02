/**
 * TranslationConfirmModal.tsx
 * ---------------------------
 * The question asked before a bulk translation of the bulk page starts: what
 * the run does to the records (it replaces the content of the picked fields
 * in the target locales, and saves each record), then from which locale into
 * which locales, and which fields of each model. It is a modal opened with
 * `ctx.openModal` rather than `ctx.openConfirm`, because the native confirm
 * shows plain text only and can't hold the breakdown.
 *
 * Resolves `true` when the user starts the run, `false` when they cancel.
 * Its footer has Cancel at the left, so it opens with no host cross
 * (`closeDisabled`) and registers Escape as that Cancel, as a dialog with a
 * footer does. Opened from the bulk page, a non-modal context, so it never
 * nests inside another modal.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import { formatLocaleWithCode } from '../utils/localeUtils';
import {
  BULK_RUN_CONSEQUENCE,
  isLargeRun,
  LARGE_RUN_TITLE,
  largeRunWarning,
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
  /** The name of the vendor ("DeepL"), for the warning of a large run. */
  vendorName?: string;
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

/** The Escape of the dialog: the Cancel of its footer. */
const CANCEL_ACTION_ID = 'translationConfirm.cancel';

interface Props {
  ctx: RenderModalCtx;
  parameters: TranslationConfirmModalParams;
}

export default function TranslationConfirmModal({ ctx, parameters }: Props) {
  const {
    recordCount: count,
    fromLocale,
    toLocales,
    vendorName,
    models,
  } = parameters;
  const hasModels = !!models && models.length > 0;
  // Counts get the separators of the language that the Canvas gives the kit.
  const locale = ctx.ui.locale;
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
      {/* The title and the button count the records: the lead says what
          the run does to them. */}
      <p className={s.lead}>{BULK_RUN_CONSEQUENCE}</p>

      {isLargeRun(count, toLocales.length) && (
        <Callout tone="warning" title={LARGE_RUN_TITLE}>
          {largeRunWarning(vendorName)}
        </Callout>
      )}

      <InfoList>
        <InfoList.Row title="Translate from">
          {formatLocaleWithCode(fromLocale)}
        </InfoList.Row>
        <InfoList.Row title="Translate into">
          {toLocales.map(formatLocaleWithCode).join(', ')}
        </InfoList.Row>
        {hasModels && (
          <InfoList.Group title="Fields">
            {models.map((model) => (
              <InfoList.Row key={model.code} title={model.label}>
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

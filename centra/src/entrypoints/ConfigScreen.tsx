import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import StringInput from 'datocms-react-ui/StringInput';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { CentraClient, CentraClientError } from '../lib/centraClient';
import {
  normalizePluginParameters,
  validateConnection,
} from '../lib/parameters';
import type { CentraPluginParametersV2 } from '../types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ConnectionErrors = Partial<Record<'endpoint' | 'token', string>>;

const READ_ONLY_REASON = "Your role can't change the plugin settings.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The error of the field that a failed check points to: the token that
 * Centra refused, or a URL that doesn't answer. Null when it could be either.
 */
function connectionError(error: unknown): ConnectionErrors | null {
  if (!(error instanceof CentraClientError)) return null;
  if (error.status === 401 || error.status === 403) {
    return { token: "Centra didn't accept this token." };
  }
  if (error.code === 'network') {
    return { endpoint: "Couldn't reach Centra at this URL." };
  }
  if (error.status === 404) {
    return { endpoint: "There's no Storefront API at this URL." };
  }
  return null;
}

export default function ConfigScreen({ ctx }: Props) {
  const incoming = useMemo(
    () => normalizePluginParameters(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const [draft, setDraft] = useState<CentraPluginParametersV2>(incoming);
  const [errors, setErrors] = useState<ConnectionErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const canEdit = ctx.currentRole.meta.final_permissions.can_edit_schema;
  const rawParameters = ctx.plugin.attributes.parameters;
  // Older parameter shapes count as a change: a Save migrates them to v2
  const needsMigration =
    !isRecord(rawParameters) || rawParameters.paramsVersion !== '2';
  const isDirty =
    needsMigration ||
    draft.endpoint !== incoming.endpoint ||
    draft.token !== incoming.token;

  useEffect(() => {
    setDraft(incoming);
    setErrors({});
  }, [incoming]);

  function update(patch: Partial<CentraPluginParametersV2>) {
    setDraft((current) => ({ ...current, ...patch, paramsVersion: '2' }));
  }

  async function saveSettings() {
    const normalized = normalizePluginParameters(draft);
    const validation = validateConnection(normalized);
    setErrors(validation.errors);
    if (!validation.valid || !canEdit) return;

    setIsSaving(true);
    try {
      // A one-product search proves the URL and the token before they're saved
      await new CentraClient(normalized).searchDisplayItems({
        kind: 'primaryProduct',
        limit: 1,
      });
      await ctx.updatePluginParameters(normalized);
      ctx.notice(
        'Centra connected. Add the Centra editor to a JSON field to use it.',
      );
    } catch (error) {
      const fieldError = connectionError(error);
      if (fieldError) {
        setErrors(fieldError);
      } else {
        // The alert stays open until the user closes it: the saving state
        // ends without waiting for it
        void ctx
          .alert(
            "Couldn't connect to Centra. Check the URL and the token, then save again.",
          )
          .catch(() => undefined);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The same cases that disable the Save button
    if (!canEdit || !isDirty || isSaving) return;
    void saveSettings();
  }

  const inputsDisabled = !canEdit || isSaving;

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      {/* noValidate: the URL errors show on their field, not in a bubble of
          the browser */}
      <form noValidate onSubmit={handleSubmit}>
        {!canEdit && <Callout>{READ_ONLY_REASON}</Callout>}
        <FieldWrapper
          label="Storefront API URL"
          required
          hint="The no-session GraphQL URL from the Storefront API plugin in Centra."
          error={errors.endpoint}
        >
          <StringInput
            type="url"
            code
            spellCheck={false}
            autoComplete="off"
            placeholder="https://example.centra.com/store-api-no-session"
            value={draft.endpoint}
            disabled={inputsDisabled}
            onChange={(endpoint) => update({ endpoint: endpoint ?? '' })}
          />
        </FieldWrapper>
        <FieldWrapper
          label="API token"
          required
          hint="A read-only no-session token. Anyone who can open this project can read it."
          error={errors.token}
        >
          <PasswordInput
            autoComplete="off"
            spellCheck={false}
            value={draft.token}
            disabled={inputsDisabled}
            onChange={(token) => update({ token: token ?? '' })}
          />
        </FieldWrapper>
        {canEdit && (
          <Button
            submit
            tone="primary"
            label="Save"
            busy={isSaving}
            disabled={
              isDirty ? undefined : { reason: 'There are no changes to save.' }
            }
          />
        )}
      </form>
    </Canvas>
  );
}

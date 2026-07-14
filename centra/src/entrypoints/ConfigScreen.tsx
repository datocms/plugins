import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, FieldGroup, Form, TextField } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import { CentraClient } from '../lib/centraClient';
import {
  normalizePluginParameters,
  validateConnection,
} from '../lib/parameters';
import type { CentraPluginParametersV2 } from '../types';
import styles from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ConnectionErrors = Partial<Record<'endpoint' | 'token', string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeErrorMessage(error: unknown, token: string): string {
  const message =
    error instanceof Error
      ? error.message
      : 'Centra could not be reached with these credentials.';
  return token ? message.split(token).join('[redacted]') : message;
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
      await new CentraClient(normalized).searchDisplayItems({
        kind: 'primaryProduct',
        limit: 1,
      });
      await ctx.updatePluginParameters(normalized);
      ctx.notice('Centra connected successfully.');
    } catch (error) {
      await ctx.alert(safeErrorMessage(error, normalized.token));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <div className={styles.page}>
        <p className={styles.intro}>
          Enter the read-only credentials from your Centra Storefront API
          plugin. Then add the <strong>Centra</strong> editor to a JSON field.
        </p>

        {!canEdit && (
          <p className={styles.notice} role="status">
            Your role can view these settings but cannot change them.
          </p>
        )}

        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings();
          }}
        >
          <FieldGroup>
            <TextField
              id="endpoint"
              name="endpoint"
              label="Storefront API URL"
              hint="The complete Centra no-session GraphQL URL."
              placeholder="https://example.centra.com/store-api-no-session"
              required
              value={draft.endpoint}
              onChange={(endpoint) => update({ endpoint })}
              error={errors.endpoint}
              textInputProps={{
                type: 'url',
                disabled: !canEdit || isSaving,
                spellCheck: false,
              }}
            />

            <TextField
              id="token"
              name="token"
              label="API token"
              hint="Use a read-only no-session token. It is stored in the plugin settings and is browser-visible."
              placeholder="Paste your token"
              required
              value={draft.token}
              onChange={(token) => update({ token })}
              error={errors.token}
              textInputProps={{
                type: 'password',
                disabled: !canEdit || isSaving,
                monospaced: true,
                autoComplete: 'off',
                spellCheck: false,
              }}
            />
          </FieldGroup>

          <Button
            type="submit"
            fullWidth
            buttonType="primary"
            disabled={!canEdit || isSaving || !isDirty}
          >
            {isSaving ? 'Connecting…' : 'Save and connect'}
          </Button>
        </Form>
      </div>
    </Canvas>
  );
}

import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import isEqual from 'lodash-es/isEqual';
import { type FormEvent, useMemo, useState } from 'react';
import type { CustomHeader, Parameters } from '../types';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type HeaderErrors = {
  name?: string;
  value?: string;
};

// Empty strings and missing keys count as no value
function readSettings(parameters: Parameters) {
  return {
    url:
      ('htmlGeneratorUrl' in parameters && parameters.htmlGeneratorUrl) || null,
    headers: ('customHeaders' in parameters && parameters.customHeaders) || [],
    autoApply:
      ('autoApplyToFieldsWithApiKey' in parameters &&
        parameters.autoApplyToFieldsWithApiKey) ||
      null,
  };
}

function validateCustomHeaders(headers: CustomHeader[]): HeaderErrors[] {
  return headers.map((header) => {
    const headerErrors: HeaderErrors = {};

    if (!header.name) {
      headerErrors.name = 'Enter a header name';
    } else if (headers.filter((h) => h.name === header.name).length > 1) {
      headerErrors.name = 'Header names must be unique';
    }

    if (!header.value) {
      headerErrors.value = 'Enter a value';
    }

    return headerErrors;
  });
}

const newHeader = (): CustomHeader => ({ name: '', value: '' });

export default function ConfigScreen({ ctx }: PropTypes) {
  const saved = readSettings(ctx.plugin.attributes.parameters as Parameters);

  const [url, setUrl] = useState<string | null>(saved.url);
  const [headers, setHeaders] = useState<CustomHeader[]>(saved.headers);
  const [autoApply, setAutoApply] = useState<string | null>(saved.autoApply);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = !isEqual({ url, headers, autoApply }, saved);
  const headerErrors = validateCustomHeaders(headers);
  const valid =
    !!url && headerErrors.every((errors) => !errors.name && !errors.value);

  const columns = useMemo<TableListColumn<CustomHeader>[]>(
    () => [
      { id: 'name', field: 'name', label: 'Header', code: true },
      { id: 'value', field: 'value', label: 'Value' },
    ],
    [],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!dirty || saving) {
      return;
    }

    if (!valid) {
      setSubmitAttempted(true);
      return;
    }

    setSaving(true);

    try {
      await ctx.updatePluginParameters({
        ...ctx.plugin.attributes.parameters,
        htmlGeneratorUrl: url,
        customHeaders: headers,
        autoApplyToFieldsWithApiKey: autoApply,
      });
      ctx.notice('Settings saved.');
      setSubmitAttempted(false);
    } finally {
      setSaving(false);
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      <form onSubmit={handleSubmit}>
        <FieldWrapper
          label="Frontend metadata endpoint"
          required
          hint="A CORS-enabled endpoint that returns the frontend metadata of a record. It can have a query string: the plugin adds the itemId, itemTypeId, itemTypeApiKey, sandboxEnvironmentId and locale parameters."
          error={submitAttempted && !url ? 'Enter the endpoint URL' : undefined}
        >
          <StringInput
            code
            placeholder="https://www.example.com/api/seo-metadata"
            value={url}
            onChange={(value) => setUrl(value || null)}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Custom headers"
          hint="Sent with every request to the endpoint."
        >
          <TableList<CustomHeader>
            value={headers}
            onChange={setHeaders}
            errors={headerErrors}
            touched={submitAttempted}
            columns={columns}
            emptyMessage="No custom headers"
            add={{ label: 'Add header', newItem: newHeader }}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Auto-apply to JSON fields with API key"
          hint="The JSON fields with this API key use this plugin as their editor."
        >
          <StringInput
            code
            placeholder="seo_analysis"
            value={autoApply}
            onChange={(value) => setAutoApply(value || null)}
          />
        </FieldWrapper>
        <Button
          submit
          tone="primary"
          label="Save"
          busy={saving}
          disabled={
            dirty ? undefined : { reason: 'There are no changes to save.' }
          }
        />
      </form>
    </Canvas>
  );
}

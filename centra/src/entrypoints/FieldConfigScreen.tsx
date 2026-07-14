import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, SelectField } from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import { normalizeFieldParameters } from '../lib/parameters';
import type {
  CentraCardinality,
  CentraFieldParametersV1,
  CentraReferenceKind,
} from '../types';
import styles from './FieldConfigScreen.module.css';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

type Option<Value extends string> = {
  value: Value;
  label: string;
};

const KIND_OPTIONS: Option<CentraReferenceKind>[] = [
  {
    value: 'primaryProduct',
    label: 'Products',
  },
  {
    value: 'variant',
    label: 'Exact product variants',
  },
  {
    value: 'item',
    label: 'SKUs / sizes',
  },
];

const CARDINALITY_OPTIONS: Option<CentraCardinality>[] = [
  {
    value: 'single',
    label: 'One',
  },
  {
    value: 'multiple',
    label: 'Multiple',
  },
];

function isOption<Value extends string>(value: unknown): value is Option<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function errorMessage(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isValidV1Parameters(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const parameters = value as Record<string, unknown>;
  return (
    parameters.paramsVersion === '1' &&
    (parameters.kind === 'primaryProduct' ||
      parameters.kind === 'variant' ||
      parameters.kind === 'item') &&
    (parameters.cardinality === 'single' ||
      parameters.cardinality === 'multiple')
  );
}

function isEmptyParameterPayload(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

export default function FieldConfigScreen({ ctx }: Props) {
  const [parameters, setLocalParameters] = useState<CentraFieldParametersV1>(
    () => normalizeFieldParameters(ctx.parameters),
  );
  const lastParametersSignatureRef = useRef<string | null>(null);
  const isJsonField = ctx.pendingField.attributes.field_type === 'json';
  const hasUnsupportedParameters =
    !isEmptyParameterPayload(ctx.parameters) &&
    !isValidV1Parameters(ctx.parameters);

  useEffect(() => {
    const signature = JSON.stringify(ctx.parameters);
    if (lastParametersSignatureRef.current === signature) return;

    lastParametersSignatureRef.current = signature;
    const normalized = normalizeFieldParameters(ctx.parameters);
    setLocalParameters(normalized);

    if (isJsonField && isEmptyParameterPayload(ctx.parameters)) {
      void ctx.setParameters(normalized);
    }
  }, [ctx.parameters, ctx.setParameters, isJsonField]);

  function updateParameters(
    patch: Partial<Pick<CentraFieldParametersV1, 'kind' | 'cardinality'>>,
  ) {
    if (!isJsonField) return;

    const nextParameters: CentraFieldParametersV1 = {
      ...parameters,
      ...patch,
      paramsVersion: '1',
    };

    setLocalParameters(nextParameters);
    void ctx.setParameters(nextParameters);
  }

  if (!isJsonField) {
    return (
      <Canvas ctx={ctx}>
        <p className={styles.warning} role="alert">
          The Centra reference editor can only be installed on JSON fields.
        </p>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <div className={styles.container}>
        {hasUnsupportedParameters && (
          <p className={styles.warning} role="alert">
            These saved Centra field settings use an unsupported version or
            shape. They have not been changed. Choose a reference type or
            selection mode to replace them with version 1 settings.
          </p>
        )}

        <SelectField
          id="kind"
          name="kind"
          label="Select"
          required
          value={KIND_OPTIONS.find((option) => option.value === parameters.kind)}
          onChange={(value) => {
            if (isOption<CentraReferenceKind>(value)) {
              updateParameters({ kind: value.value });
            }
          }}
          error={errorMessage(ctx.errors.kind)}
          selectInputProps={{
            isMulti: false,
            options: KIND_OPTIONS,
          }}
        />

        <SelectField
          id="cardinality"
          name="cardinality"
          label="Allow"
          required
          value={CARDINALITY_OPTIONS.find(
            (option) => option.value === parameters.cardinality,
          )}
          onChange={(value) => {
            if (isOption<CentraCardinality>(value)) {
              updateParameters({ cardinality: value.value });
            }
          }}
          error={errorMessage(ctx.errors.cardinality)}
          selectInputProps={{
            isMulti: false,
            options: CARDINALITY_OPTIONS,
          }}
        />

      </div>
    </Canvas>
  );
}

import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import { useEffect, useRef, useState } from 'react';
import { normalizeFieldParameters } from '../lib/parameters';
import type {
  CentraCardinality,
  CentraFieldParametersV1,
  CentraReferenceKind,
} from '../types';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

const KIND_OPTIONS: readonly RadioGroupOption<CentraReferenceKind>[] = [
  {
    value: 'primaryProduct',
    label: 'Products',
    hint: 'Stores the product through its primary variant.',
  },
  {
    value: 'variant',
    label: 'Product variants',
    hint: 'Stores one exact variant, such as a color.',
  },
  {
    value: 'item',
    label: 'SKUs',
    hint: 'Stores one size of a variant, with its SKU.',
  },
];

const CARDINALITY_OPTIONS: readonly RadioGroupOption<CentraCardinality>[] = [
  { value: 'single', label: 'One' },
  { value: 'multiple', label: 'Multiple' },
];

function isReferenceKind(value: unknown): value is CentraReferenceKind {
  return value === 'primaryProduct' || value === 'variant' || value === 'item';
}

function isCardinality(value: unknown): value is CentraCardinality {
  return value === 'single' || value === 'multiple';
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
    isReferenceKind(parameters.kind) &&
    isCardinality(parameters.cardinality)
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

    // A new field starts with empty parameters: write the defaults once, so
    // the field validates without a change
    if (isJsonField && isEmptyParameterPayload(ctx.parameters)) {
      void ctx.setParameters(normalized);
    }
  }, [ctx.parameters, ctx.setParameters, isJsonField]);

  function updateParameters(
    patch: Partial<Pick<CentraFieldParametersV1, 'kind' | 'cardinality'>>,
  ) {
    if (!isJsonField) return;

    // Always the complete payload, so unsupported settings get replaced whole
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
        <Callout tone="warning">
          The Centra editor works on JSON fields only.
        </Callout>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      {hasUnsupportedParameters && (
        <Callout tone="warning" title="Unsupported settings">
          These settings come from another version of the plugin. They stay as
          they are until you change an option below.
        </Callout>
      )}
      <FieldWrapper label="Editors pick" error={errorMessage(ctx.errors.kind)}>
        <RadioGroupInput
          options={KIND_OPTIONS}
          value={parameters.kind}
          onChange={(kind) => {
            if (isReferenceKind(kind)) updateParameters({ kind });
          }}
        />
      </FieldWrapper>
      <FieldWrapper
        label="How many"
        error={errorMessage(ctx.errors.cardinality)}
      >
        <RadioGroupInput
          options={CARDINALITY_OPTIONS}
          value={parameters.cardinality}
          onChange={(cardinality) => {
            if (isCardinality(cardinality)) updateParameters({ cardinality });
          }}
        />
      </FieldWrapper>
    </Canvas>
  );
}

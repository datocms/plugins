import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import KeyValueList, {
  type KeyValueListTexts,
  type Tuple,
} from 'datocms-react-ui/KeyValueList';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import type { TableListChange } from 'datocms-react-ui/TableList';
import type { RawFrontend } from '../../types';
import { DOCS } from './links';
import type { RowsTouched } from './useSettingsForm';
import type { FeatureSwitches, FrontendErrors } from './validation';

type CustomHeader = NonNullable<RawFrontend['customHeaders']>[number];

export type FrontendField = 'name' | 'previewWebhook' | 'draftModeUrl';

const HEADER_TEXTS: KeyValueListTexts = {
  key: 'Header',
  value: 'Value',
  add: 'Add header',
  empty: 'No custom headers',
};

// The stored headers are a list, not an object: the order and a repeated
// name stay, so the error of a repeated name can show
function toTuples(headers: CustomHeader[]): Tuple[] {
  return headers.map(({ name, value }) => ({ key: name, value }));
}

function fromTuples(tuples: Tuple[]): CustomHeader[] {
  return tuples.map(({ key, value }) => ({
    name: key ?? '',
    value: value == null ? '' : String(value),
  }));
}

type Props = {
  frontend: RawFrontend;
  switches: FeatureSwitches;
  errors: FrontendErrors;
  /** The frontend-level error shows only after a save attempt */
  submitAttempted: boolean;
  showsError: (field: FrontendField) => boolean;
  headersTouched: RowsTouched | boolean;
  onChange: (patch: Partial<RawFrontend>) => void;
  /** Turns a feature on or off: off, its URL goes too */
  onFeatureChange: (feature: keyof FeatureSwitches, on: boolean) => void;
  onBlur: (field: FrontendField) => void;
  onHeadersChange: (change: TableListChange) => void;
  onHeaderCellBlur: (cell: { index: number; field: string }) => void;
};

/** The fields of a frontend, in the body of its item */
export function FrontendFields({
  frontend,
  switches,
  errors,
  submitAttempted,
  showsError,
  headersTouched,
  onChange,
  onFeatureChange,
  onBlur,
  onHeadersChange,
  onHeaderCellBlur,
}: Props) {
  const errorOf = (field: FrontendField) =>
    showsError(field) ? errors[field] : undefined;
  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl ?? '';

  return (
    <>
      <FieldWrapper label="Name" error={errorOf('name')}>
        <StringInput
          placeholder="Staging"
          value={frontend.name}
          onChange={(name) => onChange({ name: name ?? '' })}
          onBlur={() => onBlur('name')}
        />
      </FieldWrapper>
      {/* Next to the switches that fix it */}
      {submitAttempted && errors.feature && (
        <Callout tone="danger">{errors.feature}</Callout>
      )}
      <FieldWrapper>
        <SwitchInput
          label="Enable Preview Links for this frontend"
          value={switches.previewLinks}
          // On, the field starts empty: its placeholder shows an example
          onChange={(on) => onFeatureChange('previewLinks', Boolean(on))}
        />
      </FieldWrapper>
      {switches.previewLinks && (
        <>
          <FieldWrapper
            label="Preview Links endpoint URL"
            error={errorOf('previewWebhook')}
            docs={DOCS.previewLinksEndpoint}
          >
            <StringInput
              code
              placeholder="https://www.example.com/api/preview-links"
              value={frontend.previewWebhook ?? ''}
              onChange={(url) => onChange({ previewWebhook: url ?? '' })}
              onBlur={() => onBlur('previewWebhook')}
            />
          </FieldWrapper>
          <FieldWrapper
            label="Custom headers sent to the endpoint"
            labelExtras={{ optional: true }}
          >
            <KeyValueList
              texts={HEADER_TEXTS}
              value={toTuples(frontend.customHeaders ?? [])}
              onChange={(tuples, change) => {
                onChange({ customHeaders: fromTuples(tuples) });
                onHeadersChange(change);
              }}
              errors={errors.customHeaders}
              touched={headersTouched}
              onCellBlur={onHeaderCellBlur}
            />
          </FieldWrapper>
        </>
      )}
      <FieldWrapper docs={DOCS.visualEditing}>
        <SwitchInput
          label="Enable Visual Editing for this frontend"
          value={switches.visualEditing}
          onChange={(on) => onFeatureChange('visualEditing', Boolean(on))}
        />
      </FieldWrapper>
      {switches.visualEditing && (
        <>
          <FieldWrapper
            label="Draft mode URL"
            error={errorOf('draftModeUrl')}
            docs={DOCS.draftModeRoute}
          >
            <StringInput
              code
              placeholder="https://www.example.com/api/draft"
              value={draftModeUrl}
              onChange={(url) =>
                onChange({
                  visualEditing: {
                    ...frontend.visualEditing,
                    enableDraftModeUrl: url ?? '',
                  },
                })
              }
              onBlur={() => onBlur('draftModeUrl')}
            />
          </FieldWrapper>
          <FieldWrapper label="Start page" labelExtras={{ optional: true }}>
            <StringInput
              code
              placeholder="/blog"
              value={frontend.visualEditing?.initialPath ?? ''}
              onChange={(path) =>
                onChange({
                  visualEditing: {
                    enableDraftModeUrl: draftModeUrl,
                    initialPath: path ?? '',
                  },
                })
              }
            />
          </FieldWrapper>
        </>
      )}
      <FieldWrapper>
        <SwitchInput
          label="Hide this frontend from editors"
          value={Boolean(frontend.disabled)}
          onChange={(disabled) => onChange({ disabled: Boolean(disabled) })}
        />
      </FieldWrapper>
    </>
  );
}

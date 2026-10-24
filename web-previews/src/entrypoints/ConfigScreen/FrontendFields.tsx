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
import { MARKETPLACE_URL } from './links';
import type { RowsTouched } from './useSettingsForm';
import type { FrontendErrors } from './validation';

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
  errors: FrontendErrors;
  /** The frontend-level error shows only after a save attempt */
  submitAttempted: boolean;
  showsError: (field: FrontendField) => boolean;
  headersTouched: RowsTouched | boolean;
  onChange: (patch: Partial<RawFrontend>) => void;
  onBlur: (field: FrontendField) => void;
  onHeadersChange: (change: TableListChange) => void;
  onHeaderCellBlur: (cell: { index: number; field: string }) => void;
};

/** The fields of a frontend, in the body of its item */
export function FrontendFields({
  frontend,
  errors,
  submitAttempted,
  showsError,
  headersTouched,
  onChange,
  onBlur,
  onHeadersChange,
  onHeaderCellBlur,
}: Props) {
  const errorOf = (field: FrontendField) =>
    showsError(field) ? errors[field] : undefined;
  const previewLinksOn = Boolean(frontend.previewWebhook);
  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl ?? '';
  const visualEditingOn = Boolean(draftModeUrl);

  return (
    <>
      {submitAttempted && errors.feature && (
        <Callout tone="danger">{errors.feature}</Callout>
      )}
      <FieldWrapper label="Name" required error={errorOf('name')}>
        <StringInput
          placeholder="Staging"
          value={frontend.name}
          onChange={(name) => onChange({ name: name ?? '' })}
          onBlur={() => onBlur('name')}
        />
      </FieldWrapper>
      <FieldWrapper hint="Lists the pages of the record in the sidebar. The frontend needs an endpoint that returns them.">
        <SwitchInput
          label="Preview links"
          value={previewLinksOn}
          onChange={(on) => onChange({ previewWebhook: on ? 'https://' : '' })}
        />
      </FieldWrapper>
      {previewLinksOn && (
        <>
          <FieldWrapper
            label="Preview links endpoint"
            hint="A POST endpoint that gets the record and returns the URLs of its pages."
            docs={{
              label: 'How the endpoint works',
              to: `${MARKETPLACE_URL}#the-preview-links-api-endpoint`,
            }}
            error={errorOf('previewWebhook')}
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
            label="Custom headers"
            hint="Sent with every request to the endpoint."
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
      <FieldWrapper hint="Full-screen editing next to the website, with click-to-edit overlays. The frontend needs draft mode and DatoCMS Content Link.">
        <SwitchInput
          label="Visual editing"
          value={visualEditingOn}
          onChange={(on) =>
            onChange({
              visualEditing: {
                ...frontend.visualEditing,
                enableDraftModeUrl: on ? 'https://' : '',
              },
            })
          }
        />
      </FieldWrapper>
      {visualEditingOn && (
        <>
          <FieldWrapper
            label="Draft mode route"
            hint="The route that turns on draft mode. It gets the page to open in its redirect query parameter."
            docs={{
              label: 'How the route works',
              to: `${MARKETPLACE_URL}#the-enable-draft-mode-route`,
            }}
            error={errorOf('draftModeUrl')}
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
          <FieldWrapper
            label="Initial path"
            hint="The page that the Visual tab opens first. The default is /."
          >
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
      <FieldWrapper hint="A disabled frontend keeps its settings, but editors don't see it.">
        <SwitchInput
          label="Disabled"
          value={Boolean(frontend.disabled)}
          onChange={(disabled) => onChange({ disabled: Boolean(disabled) })}
        />
      </FieldWrapper>
    </>
  );
}

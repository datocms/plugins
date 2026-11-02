import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';

type Props = {
  value: string;
  error: string | undefined;
  /** Locked after a second of saving. */
  disabled: boolean;
  /** A role that can't edit the schema: the pattern stays copyable. */
  readOnly: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

const ID = 'autoApplyToFieldsWithApiKey';

/**
 * The regex that turns the plugin on for matching fields, with the defaults
 * of the plugin's first version (1.x).
 */
export default function AutoApplySection({
  value,
  error,
  disabled,
  readOnly,
  onChange,
  onBlur,
}: Props) {
  return (
    <FieldWrapper
      id={ID}
      label="Auto-apply to fields whose API key matches"
      hint="A regular expression. Matching string and JSON fields use the plugin with the settings of its first version."
      error={error}
    >
      <StringInput
        name={ID}
        code
        placeholder="^shopify_"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(pattern) => onChange(pattern ?? '')}
        onBlur={onBlur}
      />
    </FieldWrapper>
  );
}

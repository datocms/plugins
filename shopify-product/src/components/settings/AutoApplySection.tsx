import { TextField } from 'datocms-react-ui';

type Props = {
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

const ID = 'autoApplyToFieldsWithApiKey';

/** The regex that turns the plugin on for matching fields, with 1.x defaults. */
export default function AutoApplySection({
  value,
  error,
  disabled,
  onChange,
  onBlur,
}: Props) {
  return (
    <div>
      <TextField
        id={ID}
        name={ID}
        label="Auto-apply to fields whose API key matches"
        placeholder="^shopify_"
        hint={
          <span id={`${ID}-hint`}>
            A regular expression. Matching string and JSON fields use the plugin
            with its 1.x defaults
          </span>
        }
        error={error ? <span id={`${ID}-error`}>{error}</span> : undefined}
        value={value}
        onChange={onChange}
        textInputProps={{
          monospaced: true,
          autoComplete: 'off',
          spellCheck: false,
          disabled,
          onBlur,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? `${ID}-error ${ID}-hint` : `${ID}-hint`,
        }}
      />
    </div>
  );
}

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import type { LocalizationInfo } from '../../types';
import { MAX_RADIO_OPTIONS } from '../shared/choices';

type Option = { value: string; label: string };

/**
 * The select's value for Shopify's default market (saved as `''`, which a
 * select can't hold). ISO codes are upper case, so it can't match one.
 */
const DEFAULT_VALUE = 'default';
const DEFAULT_OPTION: Option = {
  value: DEFAULT_VALUE,
  label: 'Shopify default',
};

type Props = {
  idPrefix: string;
  localization: LocalizationInfo;
  country: string;
  language: string;
  locale: string;
  disabled: boolean;
  onChange: (patch: {
    defaultCountry?: string;
    defaultLanguage?: string;
  }) => void;
};

function capitalize(value: string, locale: string): string {
  if (!value) return value;
  try {
    return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
  } catch {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

/** "Germany" for `DE`, or the code itself when the browser can't name it. */
function displayName(
  code: string,
  type: 'region' | 'language',
  locale: string,
): string {
  try {
    const query = type === 'language' ? code.replace('_', '-') : code;
    return new Intl.DisplayNames([locale], { type }).of(query) ?? code;
  } catch {
    return code;
  }
}

/** Keeps a saved code selectable even when Shopify stopped offering it. */
function withSavedValue(
  options: Option[],
  saved: string,
  name: string,
): Option[] {
  if (!saved || options.some((option) => option.value === saved)) {
    return options;
  }
  return [...options, { value: saved, label: `${name} (not available)` }];
}

function countryOptions(
  localization: LocalizationInfo,
  saved: string,
  locale: string,
): Option[] {
  const countries = [...localization.availableCountries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((country) => ({
      value: country.isoCode,
      label: `${country.name} (${country.currency.isoCode})`,
    }));
  const name = displayName(saved, 'region', locale);
  return [DEFAULT_OPTION, ...withSavedValue(countries, saved, name)];
}

function languageOptions(
  localization: LocalizationInfo,
  saved: string,
  locale: string,
): Option[] {
  const languages = localization.availableLanguages.map((language) => ({
    value: language.isoCode,
    label: capitalize(language.endonymName || language.isoCode, locale),
  }));
  const name = capitalize(displayName(saved, 'language', locale), locale);
  return [DEFAULT_OPTION, ...withSavedValue(languages, saved, name)];
}

/** `''` (Shopify's default) as the select's value, and back. */
const toValue = (code: string): string => code || DEFAULT_VALUE;
const fromValue = (value: string | null): string =>
  value && value !== DEFAULT_VALUE ? value : '';

/** A few options show as radios (short labels: the small group), a longer list as a select. */
function ChoiceInput({
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  options: Option[];
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return options.length <= MAX_RADIO_OPTIONS ? (
    <RadioGroupInput
      small
      name={name}
      value={value}
      options={options}
      disabled={disabled}
      onChange={onChange}
    />
  ) : (
    <SelectInput
      name={name}
      value={value}
      options={options}
      clearable={false}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** The store's default market: country (with currency) and language. */
export default function MarketFields({
  idPrefix,
  localization,
  country,
  language,
  locale,
  disabled,
  onChange,
}: Props) {
  return (
    <div className="form__field form__row">
      <div className="form__row__cell">
        <FieldWrapper
          id={`${idPrefix}-country`}
          label="Default country"
          hint="Prices and currencies in the record editor and the picker follow it."
        >
          <ChoiceInput
            name={`${idPrefix}-country`}
            value={toValue(country)}
            options={countryOptions(localization, country, locale)}
            disabled={disabled}
            onChange={(value) => onChange({ defaultCountry: fromValue(value) })}
          />
        </FieldWrapper>
      </div>
      <div className="form__row__cell">
        <FieldWrapper
          id={`${idPrefix}-language`}
          label="Default language"
          hint="Product titles in the record editor and the picker follow it."
        >
          <ChoiceInput
            name={`${idPrefix}-language`}
            value={toValue(language)}
            options={languageOptions(localization, language, locale)}
            disabled={disabled}
            onChange={(value) =>
              onChange({ defaultLanguage: fromValue(value) })
            }
          />
        </FieldWrapper>
      </div>
    </div>
  );
}

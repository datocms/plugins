import { FieldHint, SelectField } from 'datocms-react-ui';
import type { LocalizationInfo } from '../../types';
import styles from './MarketFields.module.css';

type Option = { value: string; label: string };

const DEFAULT_OPTION: Option = { value: '', label: 'Shopify default' };

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

function selected(options: Option[], value: string): Option {
  return options.find((option) => option.value === value) ?? DEFAULT_OPTION;
}

function optionValue(option: unknown): string {
  return option && typeof option === 'object' && 'value' in option
    ? String(option.value)
    : '';
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
  const countries = countryOptions(localization, country, locale);
  const languages = languageOptions(localization, language, locale);

  return (
    <div>
      <div className={styles.pair}>
        <div>
          <SelectField
            id={`${idPrefix}-country`}
            name={`${idPrefix}-country`}
            label="Default country"
            value={selected(countries, country)}
            onChange={(option) =>
              onChange({ defaultCountry: optionValue(option) })
            }
            selectInputProps={{
              options: countries,
              'aria-label': 'Default country',
              isDisabled: disabled,
              isClearable: false,
            }}
          />
        </div>
        <div>
          <SelectField
            id={`${idPrefix}-language`}
            name={`${idPrefix}-language`}
            label="Default language"
            value={selected(languages, language)}
            onChange={(option) =>
              onChange({ defaultLanguage: optionValue(option) })
            }
            selectInputProps={{
              options: languages,
              'aria-label': 'Default language',
              isDisabled: disabled,
              isClearable: false,
            }}
          />
        </div>
      </div>
      <FieldHint>
        Prices, currencies and product titles in the record editor and the
        picker follow this market
      </FieldHint>
    </div>
  );
}

import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import { GlobeIcon } from '../../icons';
import {
  contextLabel,
  languageOptionLabel,
  sortedCountries,
} from '../../lib/pickerSearch';
import type { LocalizationInfo, ShopifyContext } from '../../types';
import type { AsyncValue } from '../shared/useAsyncValue';
import { useTriggerFocus } from './useTriggerFocus';

type Props = {
  localization: AsyncValue<LocalizationInfo>;
  /** Collections have no prices: the trigger leaves the currency out. */
  prices: boolean;
  /** The editor's UI locale, for sorting countries by name. */
  locale: string;
  onChange: (context: ShopifyContext) => void;
};

/** Two menus of choices in one: the country, then the language. */
function MarketOptions({
  info,
  locale,
  onPick,
}: {
  info: LocalizationInfo;
  locale: string;
  onPick: (context: ShopifyContext) => void;
}) {
  const country = info.country.isoCode;
  const language = info.language.isoCode;
  return (
    <>
      <Dropdown.Group name="Country">
        {sortedCountries(info.availableCountries, locale).map((candidate) => (
          <Dropdown.Option
            key={candidate.isoCode}
            active={candidate.isoCode === country}
            keywords={[candidate.isoCode, candidate.currency.isoCode]}
            onPick={() => onPick({ country: candidate.isoCode, language })}
          >
            {candidate.name} ({candidate.currency.isoCode})
          </Dropdown.Option>
        ))}
      </Dropdown.Group>
      <Dropdown.Group name="Language">
        {info.availableLanguages.map((candidate) => (
          <Dropdown.Option
            key={candidate.isoCode}
            active={candidate.isoCode === language}
            keywords={[candidate.isoCode]}
            onPick={() => onPick({ country, language: candidate.isoCode })}
          >
            {languageOptionLabel(info, candidate.isoCode)}
          </Dropdown.Option>
        ))}
      </Dropdown.Group>
    </>
  );
}

function triggerLabel(
  localization: AsyncValue<LocalizationInfo>,
  prices: boolean,
): string {
  if (localization.value) {
    return contextLabel(localization.value, { currency: prices });
  }
  return localization.status === 'error' ? 'Country and language' : 'Loading…';
}

/**
 * The market prices and titles are shown in (`@inContext`). The trigger
 * shows what Shopify applied, which can differ from what was asked for:
 * languages a market doesn't publish fall back silently (the results explain
 * it with a notice).
 */
export default function MarketSwitcher({
  localization,
  prices,
  locale,
  onChange,
}: Props) {
  const { ref, refocus } = useTriggerFocus();
  const pick = (context: ShopifyContext) => {
    refocus();
    onChange(context);
  };

  return (
    <div ref={ref}>
      <Dropdown
        triggerComponent={ButtonTrigger}
        tone="ghost"
        icon={GlobeIcon}
        label={triggerLabel(localization, prices)}
        tooltip={
          prices
            ? 'Country and language for prices and titles'
            : 'Country and language for titles'
        }
      >
        {() => (
          <Dropdown.Menu placement="bottom-end" minWidth={240}>
            {localization.value ? (
              <MarketOptions
                info={localization.value}
                locale={locale}
                onPick={pick}
              />
            ) : (
              <Dropdown.Text>
                {localization.status === 'error'
                  ? "Couldn't load the countries and languages."
                  : 'Loading the countries and languages…'}
              </Dropdown.Text>
            )}
          </Dropdown.Menu>
        )}
      </Dropdown>
    </div>
  );
}

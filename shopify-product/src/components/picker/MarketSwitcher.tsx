import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import {
  CaretDownIcon,
  CaretUpIcon,
  DropdownGroup,
  DropdownOption,
  DropdownText,
} from 'datocms-react-ui';
import {
  contextLabel,
  languageFallbackNotice,
  languageOptionLabel,
  sortedCountries,
} from '../../lib/pickerSearch';
import type { LocalizationInfo, ShopifyContext } from '../../types';
import { Icon } from '../../ui/Icon';
import { Menu } from '../../ui/Menu';
import Tip from '../shared/Tip';
import type { AsyncValue } from '../shared/useAsyncValue';
import styles from './MarketSwitcher.module.css';

type Props = {
  localization: AsyncValue<LocalizationInfo>;
  /** What the editor asked for (undefined: the store default). */
  requested: ShopifyContext | undefined;
  /** What Shopify applied to the last priced request, when known. */
  applied: ShopifyContext | null;
  /** The editor's UI locale, for sorting countries by name. */
  locale: string;
  onChange: (context: ShopifyContext) => void;
};

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
      <DropdownGroup name="Country">
        {sortedCountries(info.availableCountries, locale).map((candidate) => (
          <DropdownOption
            key={candidate.isoCode}
            active={candidate.isoCode === country}
            onClick={() => onPick({ country: candidate.isoCode, language })}
          >
            {candidate.name} ({candidate.currency.isoCode})
          </DropdownOption>
        ))}
      </DropdownGroup>
      <DropdownGroup name="Language">
        {info.availableLanguages.map((candidate) => (
          <DropdownOption
            key={candidate.isoCode}
            active={candidate.isoCode === language}
            onClick={() => onPick({ country, language: candidate.isoCode })}
          >
            {languageOptionLabel(info, candidate.isoCode)}
          </DropdownOption>
        ))}
      </DropdownGroup>
    </>
  );
}

function triggerLabel(localization: AsyncValue<LocalizationInfo>): string {
  if (localization.value) return contextLabel(localization.value);
  return localization.status === 'error' ? 'Market' : 'Loading…';
}

/**
 * The market prices and titles are shown in (`@inContext`). The trigger
 * shows what Shopify applied, which can differ from what was asked for:
 * languages a market doesn't publish fall back silently.
 */
export default function MarketSwitcher({
  localization,
  requested,
  applied,
  locale,
  onChange,
}: Props) {
  const label = triggerLabel(localization);
  const fallback = languageFallbackNotice(
    requested ?? {},
    applied ??
      (localization.value
        ? {
            country: localization.value.country.isoCode,
            language: localization.value.language.isoCode,
          }
        : null),
  );
  const tooltip = fallback ?? 'Market for prices and translations';

  return (
    <div className={styles.market}>
      <Menu
        alignment="right"
        selection="single"
        renderTrigger={({ open, triggerProps }) => (
          <Tip tip={tooltip} placement="bottom">
            <button
              {...triggerProps}
              type="button"
              className={styles.trigger}
              aria-label={`Market: ${label}`}
            >
              <Icon icon={faGlobe} />
              <span className={styles.label}>{label}</span>
              {fallback && (
                <span className={styles.fallbackDot} aria-hidden="true" />
              )}
              {open ? <CaretUpIcon /> : <CaretDownIcon />}
            </button>
          </Tip>
        )}
      >
        {localization.value ? (
          <MarketOptions
            info={localization.value}
            locale={locale}
            onPick={onChange}
          />
        ) : (
          <DropdownText>
            {localization.status === 'error'
              ? "Couldn't load the markets"
              : 'Loading…'}
          </DropdownText>
        )}
      </Menu>
      {fallback && (
        <span className="dl-sr-only" role="status">
          {fallback}
        </span>
      )}
    </div>
  );
}

/**
 * LocaleChip.tsx
 * --------------
 * Renders a locale as a chip for display contexts (progress modal header,
 * summaries) where there's no SelectField to host it.
 *
 * It owns no styling of its own: it maps the locale to a {@link ChipOption}
 * (friendly label + code badge) and delegates to {@link renderChipOption}, the
 * same renderer the bulk-translation SelectFields use. That keeps a single
 * source of truth — markup in `chipOption.tsx`, styles in
 * `chipOption.module.css` — so a locale looks identical everywhere.
 */
import { formatLocaleLabel } from '../../utils/localeUtils';
import { type ChipOption, renderChipOption } from './chipOption';

/**
 * @param locale - BCP 47 locale tag (e.g. `"en"`, `"pt-BR"`).
 */
export function LocaleChip({ locale }: { locale: string }) {
  const option: ChipOption = {
    label: formatLocaleLabel(locale),
    value: locale,
    code: locale,
  };
  return <>{renderChipOption(option)}</>;
}

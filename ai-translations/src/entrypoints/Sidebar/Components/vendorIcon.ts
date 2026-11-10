import type { IconType } from 'react-icons';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { FaLanguage } from 'react-icons/fa6';
import {
  SiAnthropic,
  SiDeepl,
  SiGooglegemini,
  SiYandexcloud,
} from 'react-icons/si';
import type { VendorId } from '../../../utils/translation/types';

/**
 * Returns the logo of a translation vendor, used in the config screen's
 * vendor choice and, for the configured vendor, in the rows of the sidebar
 * panel. An unset vendor resolves to OpenAI, matching `getProvider`. Unknown
 * values get a neutral translation glyph.
 *
 * @param vendor - The `vendor` plugin parameter.
 * @returns The icon component to render.
 */
export function getVendorIcon(vendor: VendorId | undefined): IconType {
  switch (vendor ?? 'openai') {
    case 'openai':
      return AiOutlineOpenAI;
    case 'google':
      return SiGooglegemini;
    case 'anthropic':
      return SiAnthropic;
    case 'deepl':
      return SiDeepl;
    case 'yandex':
      return SiYandexcloud;
    default:
      return FaLanguage;
  }
}

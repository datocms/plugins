import type { IconType } from 'react-icons';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { FaLanguage } from 'react-icons/fa6';
import { SiClaude, SiDeepl, SiGooglegemini } from 'react-icons/si';
import type { VendorId } from '../../../utils/translation/types';

/**
 * Returns the icon shown in the sidebar progress bubbles for the configured
 * translation vendor. An unset vendor resolves to OpenAI, matching
 * `getProvider`. Vendors without a brand icon in react-icons (Yandex
 * Translate) and unknown values get a neutral translation glyph.
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
      return SiClaude;
    case 'deepl':
      return SiDeepl;
    default:
      return FaLanguage;
  }
}

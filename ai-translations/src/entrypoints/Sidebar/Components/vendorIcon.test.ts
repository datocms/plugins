import { AiOutlineOpenAI } from 'react-icons/ai';
import { FaLanguage } from 'react-icons/fa6';
import {
  SiAnthropic,
  SiDeepl,
  SiGooglegemini,
  SiYandexcloud,
} from 'react-icons/si';
import { describe, expect, it } from 'vitest';
import type { VendorId } from '../../../utils/translation/types';
import { getVendorIcon } from './vendorIcon';

describe('getVendorIcon', () => {
  it.each([
    ['openai', AiOutlineOpenAI],
    ['google', SiGooglegemini],
    ['anthropic', SiAnthropic],
    ['deepl', SiDeepl],
    ['yandex', SiYandexcloud],
  ] as const)('returns the %s icon', (vendor, icon) => {
    expect(getVendorIcon(vendor)).toBe(icon);
  });

  it('treats an unset vendor as OpenAI, like the provider factory', () => {
    expect(getVendorIcon(undefined)).toBe(AiOutlineOpenAI);
  });

  it('falls back to the neutral icon for unknown vendors', () => {
    expect(getVendorIcon('mistral' as VendorId)).toBe(FaLanguage);
  });
});

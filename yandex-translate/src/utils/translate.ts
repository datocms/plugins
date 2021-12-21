type TranslateOptions = {
  format: 'html' | 'plain';
  text: string | null;
  locales: string[];
  yandexApiKey: string;
};

export default async function translate({
  text,
  format,
  locales,
  yandexApiKey,
}: TranslateOptions) {
  const result = await Promise.all(
    locales.map(async (locale): Promise<[string, string]> => {
      if (!text) {
        return [locale, ''];
      }

      if (!yandexApiKey) {
        throw new Error(`Missing Yandex API key!`);
      }

      const params = new URLSearchParams();
      params.set('key', yandexApiKey);
      params.set('lang', locale.substring(0, 2));
      params.set('format', format);
      params.set('text', text);

      const request = await fetch(
        `https://translate.yandex.net/api/v1.5/tr.json/translate?${params.toString()}`,
      );

      if (request.status !== 200) {
        throw new Error(`Endpoint returned status ${request.status}`);
      }

      const response = await request.json();
      return [locale, response.text.join(' ')];
    }),
  );

  return Object.fromEntries(result);
}
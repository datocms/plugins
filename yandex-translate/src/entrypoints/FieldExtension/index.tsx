import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useState, useCallback, useEffect } from 'react';
import get from 'lodash-es/get';
import { normalizeParams } from '../../types';
import s from './styles.module.css';
import translate from '../../utils/translate';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: Props) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [pageError, setPageError] = useState<Error | null>(null);

  const mainLocale = ctx.site.attributes.locales[0];
  const configParameters = normalizeParams(ctx.plugin.attributes.parameters);

  const handleClick = useCallback(async () => {
    try {
      setIsTranslating(true);
      const format =
        ctx.field.attributes.appeareance.editor === 'wysiwyg'
          ? 'html'
          : 'plain';

      const valuesByLocale = await translate({
        text: get(ctx.formValues, ctx.fieldPath) as string | null,
        format,
        yandexApiKey: configParameters.yandexApiKey,
        locales: ctx.site.attributes.locales.slice(1),
      });

      Object.entries(valuesByLocale).forEach(([locale, text]) => {
        const path = ctx.fieldPath.replace(
          new RegExp(`\\.${mainLocale}$`),
          `.${locale}`,
        );

        ctx.setFieldValue(path, text);
      });

      if (!ctx.itemType.attributes.all_locales_required) {
        ctx.setFieldValue('internalLocales', ctx.site.attributes.locales);
      }
    } catch (error) {
      console.error(error);
      setPageError(error as Error);
    } finally {
      setIsTranslating(false);
    }
  }, [
    setIsTranslating,
    setPageError,
    ctx,
    mainLocale,
    configParameters.yandexApiKey,
  ]);

  useEffect(() => {
    if (ctx.locale !== mainLocale || !ctx.field.attributes.localized) {
      ctx.setHeight(0);
    }
  // eslint-disable-next-line
  }, []);

  if (ctx.locale !== mainLocale || !ctx.field.attributes.localized) {
    return null;
  }

  return (
    <Canvas ctx={ctx}>
      <button type="button" onClick={handleClick} className={s.link}>
        {isTranslating ? 'Translating...' : 'Translate in other languages'}
      </button>
      <div className={s.plugin__status}>
        {pageError && (
          <p className={s.plugin__error}>
            Error fetching data! More info on console
          </p>
        )}
      </div>
    </Canvas>
  );
}

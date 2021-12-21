import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import { useState, useCallback } from "react";
import get from "lodash-es/get";
// @ts-ignore
import toQueryString from "to-querystring";

import s from "./styles.module.css";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type TranslateProps = {
  format: "html" | "plain";
  text: string | null;
};

export default function FieldExtension({ ctx }: Props) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [pageError, setPageError] = useState<Error | null>(null);

  const mainLocale = ctx.site.attributes.locales[0];
  const currentLocale = ctx.locale;
  const isLocalized = ctx.field.attributes.localized;
  const { fieldPath } = ctx;
  const configParameters = ctx.parameters;

  const translate = useCallback(
    ({ text, format }: TranslateProps) =>
      Promise.all(
        ctx.site.attributes.locales.slice(1).map(async (locale) => {
          const { attributes: itemType } = ctx.itemType;

          const path = fieldPath.replace(
            new RegExp(`\\.${ctx.locale}$`),
            `.${locale}`
          );

          if (!text) {
            ctx.setFieldValue(path, "");
            return Promise.resolve();
          }

          const qs = toQueryString({
            key: configParameters.yandexApiKey,
            lang: locale.substring(0, 2),
            format,
            text,
          });

          if (configParameters.developmentMode) {
            console.log(`Fetching '${locale}' translation for '${text}'`);
          }

          const request = await fetch(
            `https://translate.yandex.net/api/v1.5/tr.json/translate?${qs}`
          );

          if (request.status !== 200) {
            throw new Error(`Endpoint returned status ${request.status}`);
          }

          const response = await request.json();

          if (!itemType.all_locales_required) {
            ctx.setFieldValue("internalLocales", ctx.site.attributes.locales);
          }

          ctx.setFieldValue(path, response.text.join(" "));
        })
      ),
    [configParameters, ctx, fieldPath]
  );

  const handleClick = useCallback(async () => {
    try {
      setIsTranslating(true);
      const { attributes: field } = ctx.field;
      const format = field.appeareance.editor === "wysiwyg" ? "html" : "plain";
      const rawFieldValue = get(ctx.formValues, ctx.fieldPath) as string | null;
      const newValue = await translate({ text: rawFieldValue, format });
      ctx.setFieldValue(ctx.fieldPath, newValue);
      setIsTranslating(false);
    } catch (error) {
      console.error(error);
      setIsTranslating(false);

      setPageError(error as Error);
    }
  }, [setIsTranslating, setPageError, ctx, translate]);

  if (currentLocale !== mainLocale || !isLocalized) {
    return null;
  }

  return (
    <Canvas ctx={ctx}>
      <button type="button" onClick={handleClick} className={s.link}>
        {isTranslating ? "Translating..." : "Translate in other languages"}
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

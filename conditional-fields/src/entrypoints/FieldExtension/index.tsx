import { useCallback, useEffect, useMemo } from "react";
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import get from "lodash/get";
import { isValidParameters, ValidManualExtensionParameters } from "../../types";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

function checkedToShow(invert: boolean, value: boolean | null) {
  return invert ? !value : !!value;
}

function FieldExtensionWithValidParams({ ctx }: Props) {
  const { invert, targetFieldsApiKey } =
    ctx.parameters as ValidManualExtensionParameters;

  const sourceField = ctx.field;

  const targetFields = useMemo(() => {
    return targetFieldsApiKey
      .map((targetFieldApiKey) => {
        const targetField = Object.values(ctx.fields).find(
          (field) => field.attributes.api_key === targetFieldApiKey
        );

        if (!targetField) {
          console.error(
            `Plugin error: The field "${targetFieldApiKey}" does not exist`
          );
          return null;
        }

        return targetField;
      })
      .filter((x) => x);
  }, [ctx.fields, targetFieldsApiKey]);

  const toggleFields = useCallback(
    (show) => {
      targetFields.forEach((targetField) => {
        const targetPath = ctx.parentField
          ? `${ctx.fieldPath.replace(/.[^.]*$/, "")}.${
              targetField.attributes.api_key
            }`
          : targetField.attributes.api_key;

        if (sourceField.attributes.localized) {
          if (targetField.attributes.localized) {
            ctx.toggleField(`${targetPath}.${ctx.locale}`, show);
          }
        } else if (targetField.attributes.localized) {
          ctx.site.attributes.locales.forEach((locale) => {
            ctx.toggleField(`${targetPath}.${locale}`, show);
          });
        } else {
          ctx.toggleField(targetPath, show);
        }
      });
    },
    [ctx, sourceField.attributes.localized, targetFields]
  );

  const currentValue = get(ctx.formValues, ctx.fieldPath);

  useEffect(() => {
    toggleFields(checkedToShow(invert, currentValue));
  }, [currentValue, toggleFields, invert]);

  return null;
}

export function FieldExtension({ ctx }: Props) {
  return isValidParameters(ctx.parameters) ? (
    <FieldExtensionWithValidParams ctx={ctx} />
  ) : null;
}

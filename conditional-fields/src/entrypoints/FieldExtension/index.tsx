import { useCallback, useEffect, useMemo } from "react";
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import get from "lodash/get";
import { Canvas } from "datocms-react-ui";
import { ManualExtensionParameters } from "../../types";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

export function FieldExtension({ ctx }: Props) {
  const parameters = ctx.parameters as ManualExtensionParameters;

  const followerFields = useMemo(
    () =>
      parameters.slaveFields ? parameters.slaveFields.split(/\s*,\s*/) : [],
    [parameters]
  );
  const { invert } = parameters;
  const leaderField = ctx.field;

  const toggleFields = useCallback(
    (value) => {
      followerFields.forEach((followerFieldApiKey) => {
        const followerField = Object.values(ctx.fields).find(
          (field) => field.attributes.api_key === followerFieldApiKey
        );

        if (followerField) {
          const followerPath = ctx.parentField
            ? `${ctx.fieldPath.replace(/.[^.]*$/, "")}.${followerFieldApiKey}`
            : followerFieldApiKey;

          if (leaderField.attributes.localized) {
            if (followerField.attributes.localized) {
              ctx.toggleField(`${followerPath}.${ctx.locale}`, value);
            }
          } else if (followerField.attributes.localized) {
            ctx.site.attributes.locales.forEach((locale) => {
              ctx.toggleField(`${followerPath}.${locale}`, value);
            });
          } else {
            ctx.toggleField(followerPath, value);
          }
        } else {
          console.error(
            `Plugin error: The field "${followerFieldApiKey}" does not exist`
          );
        }
      });
    },
    [ctx, followerFields, leaderField.attributes.localized]
  );

  const normaliseValue = useCallback(
    (value) => {
      return invert ? !value : !!value;
    },
    [invert]
  );

  const currentValue = get(ctx.formValues, ctx.fieldPath);
  const initialValue = normaliseValue(currentValue);
  toggleFields(initialValue);

  useEffect(() => {
    toggleFields(normaliseValue(currentValue));
  }, [currentValue, toggleFields, normaliseValue]);

  return (
    <Canvas ctx={ctx}>
      <div />
    </Canvas>
  );
}

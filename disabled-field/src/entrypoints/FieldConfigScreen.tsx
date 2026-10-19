import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Form, SelectField } from 'datocms-react-ui';
import { useState } from 'react';
import { normalizeDisabledLocales } from '../utils/fieldParams';

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

type LocaleOption = { label: string; value: string };

/**
 * Per-field settings for the Disabled Field add-on: picks the locales in
 * which the field is read-only.
 */
const FieldConfigScreen = ({ ctx }: PropTypes) => {
  const [disabledLocales, setDisabledLocales] = useState<string[]>(
    normalizeDisabledLocales(ctx.parameters),
  );

  const options: LocaleOption[] = ctx.site.attributes.locales.map((locale) => ({
    label: locale,
    value: locale,
  }));

  const handleChange = (selected: readonly LocaleOption[]) => {
    const locales = selected.map((option) => option.value);
    setDisabledLocales(locales);
    ctx.setParameters({ ...ctx.parameters, disabledLocales: locales });
  };

  return (
    <Canvas ctx={ctx}>
      <Form>
        <SelectField
          id="disabledLocales"
          name="disabledLocales"
          label="Disable only in these locales"
          hint="Leave empty to disable the field in all locales. Non-localized fields are always disabled."
          value={options.filter((option) =>
            disabledLocales.includes(option.value),
          )}
          selectInputProps={{ isMulti: true, options, isClearable: true }}
          onChange={(selected) =>
            handleChange(selected as readonly LocaleOption[])
          }
        />
      </Form>
    </Canvas>
  );
};

export default FieldConfigScreen;

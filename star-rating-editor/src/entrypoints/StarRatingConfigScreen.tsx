import { RenderManualFieldExtensionConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas, Form, TextField } from "datocms-react-ui";
import { CSSProperties, useCallback, useState } from "react";
type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

type Parameters = {
  maxRating: number;
  starsColor: NonNullable<CSSProperties["color"]>;
};

const StarRatingConfigScreen = ({ ctx }: PropTypes) => {
  console.log(ctx.parameters);
  const [formValues, setFormValues] = useState<Partial<Parameters>>(
    ctx.parameters
  );
  const update = useCallback(
    (field, value) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, setFormValues, ctx]
  );
  const errors = ctx.errors as Partial<Record<string, string>>;
  return (
    <Canvas ctx={ctx}>
      <Form>
        <TextField
          id="maxRating"
          name="maxRating"
          label="Maximum rating"
          required
          value={formValues.maxRating}
          onChange={update.bind(null, "maxRating")}
          error={errors.maxRating}
        />
        <TextField
          id="starsColor"
          name="starsColor"
          label="Stars color"
          required
          value={formValues.starsColor}
          onChange={update.bind(null, "starsColor")}
          error={errors.starsColor}
        />
      </Form>
    </Canvas>
  );
};

export default StarRatingConfigScreen;

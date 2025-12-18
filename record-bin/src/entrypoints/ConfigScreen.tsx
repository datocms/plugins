import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Button, Canvas, Form, TextField } from "datocms-react-ui";
import { useState } from "react";
import { automaticBinCleanupObject } from "../types/types";

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const [numberOfDays, setNumberOfDays] = useState(
    (
      ctx.plugin.attributes.parameters
        ?.automaticBinCleanup as automaticBinCleanupObject
    )?.numberOfDays || "30"
  );
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const deletionHandler = async () => {
    const userInput = parseInt(numberOfDays as string);
    if (isNaN(userInput)) {
      setError("Days must be an integerer number");
      return;
    }

    setLoading(true);

    await ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      automaticBinCleanup: { numberOfDays: userInput, timeStamp: "" },
    });

    ctx.notice(
      `All records older than ${numberOfDays} days in the bin will be daily deleted.`
    );

    setLoading(false);
  };

  return (
    <Canvas ctx={ctx}>
      <h2>Always delete all trashed records older than </h2>{" "}
      <Form>
        <TextField
          error={error}
          required
          name="numberOfDays"
          id="numberOfDays"
          label="Days"
          value={numberOfDays}
          onChange={(event) => {
            setNumberOfDays(event);
            setError("");
          }}
        />
        <Button
          onClick={deletionHandler}
          fullWidth
          buttonType={isLoading ? "muted" : "primary"}
          disabled={isLoading}
        >
          Save
        </Button>
      </Form>
    </Canvas>
  );
}

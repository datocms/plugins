import { RenderItemFormOutletCtx } from "datocms-plugin-sdk";
import { Button, Canvas, FieldGroup, Form, Section } from "datocms-react-ui";
import { useState } from "react";
import { errorObject } from "../types/types";

const BinOutlet = ({ ctx }: { ctx: RenderItemFormOutletCtx }) => {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<errorObject>();

  const restorationHandler = async () => {
    setLoading(true);

    const parsedBody = JSON.parse(ctx.formValues.record_body as string);
    parsedBody.trashRecordID = ctx.item!.id;
    const requestBody = JSON.stringify(parsedBody);

    try {
      const restoreResponse = await fetch(
        ctx.plugin.attributes.parameters.vercelURL as string,
        {
          method: "POST",
          body: requestBody,
          headers: { Accept: "*/*", "Content-Type": "application/json" },
        }
      );
      const parsedResponse = await restoreResponse.json();
      if (restoreResponse.status !== 200) {
        setError(parsedResponse.error);
        throw new Error();
      }

      ctx.notice("The record has been successfully restored!");
      ctx.navigateTo(
        "/editor/item_types/" +
          parsedResponse.restoredRecord.modelID +
          "/items/" +
          parsedResponse.restoredRecord.id
      );
    } catch (error) {
      setLoading(false);
      await ctx.alert("The record could not be restored!");
    }
  };

  const errorModalHandler = async () => {
    await ctx.openModal({
      id: "errorModal",
      title: "Restoration error",
      width: "l",
      parameters: { errorPayload: error!.fullErrorPayload },
    });
  };

  return (
    <Canvas ctx={ctx}>
      <Form>
        <FieldGroup>
          {error && (
            <Section title="Restoration error">
              <p>Couldn't restore the record because of the following error:</p>
              <p>
                {error.simplifiedError.code}:{" "}
                {error.simplifiedError.details.field ||
                  error.simplifiedError.details.extraneous_attributes}
              </p>
              <p>{error.simplifiedError.details.code}</p>
              <Button onClick={errorModalHandler}>
                See full restoration error report
              </Button>
              <p>
                You can manually correct the errors on the record body, save the
                record, and re-attempt to restore it.
              </p>
            </Section>
          )}
        </FieldGroup>
        <FieldGroup>
          <Button
            buttonType={isLoading ? "muted" : "primary"}
            disabled={isLoading}
            fullWidth
            onClick={restorationHandler}
          >
            Restore record ♻️
          </Button>
        </FieldGroup>
      </Form>
    </Canvas>
  );
};

export default BinOutlet;

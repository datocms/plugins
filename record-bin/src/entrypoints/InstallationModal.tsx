import { RenderModalCtx } from "datocms-plugin-sdk";
import { Button, Canvas, Form, TextField } from "datocms-react-ui";
import { useState } from "react";
import attemptVercelInitialization from "../utils/attemptVercelInitialization";

type PropTypes = {
  ctx: RenderModalCtx;
};

const InstallationModal = ({ ctx }: PropTypes) => {
  const [vercelURL, setVercelURL] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleDeployButtonClick = () => {
    window.open(
      `https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Frecord-bin-lambda-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-record-bin-lambda-function&repo-name=datocms-record-bin-lambda-function`
    );
  };

  const handleCancelationButtonClick = () => {
    ctx.updatePluginParameters({ installationState: "cancelled" });
    ctx.resolve("cancelled");
  };

  const handleFinishButtonClick = async () => {
    setIsLoading(true);
    try {
      await attemptVercelInitialization(vercelURL, ctx.environment);
      await ctx.updatePluginParameters({
        installationState: "installed",
        vercelURL,
        automaticBinCleanup: { numberOfDays: 30, timeStamp: "" },
      });
      ctx.resolve("installed");
    } catch {
      setIsLoading(false);
      setIsInvalid(true);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div style={{ textAlign: "center" }}>
        <h1>Before continuing:</h1>
        <p>
          Record bin requires a lambda function to manage the creation and
          restoration of the deleted records. By clicking the deploy button
          bellow you can create your own instance of that lambda function. Once
          you are finished with the setup, insert the deployment URL in the
          field bellow.
        </p>
        <p>
          If you'd like, you also can see, clone, and read the documentation on
          that lambda function on{" "}
          <a
            href="https://github.com/marcelofinamorvieira/record-bin-lambda-function"
            target="_blank"
            rel="noreferrer"
          >
            this repository
          </a>
        </p>
        <h2>You can create your instance of that lambda function here:</h2>
        <Form>
          <Button
            onClick={handleDeployButtonClick}
            fullWidth
            buttonType="muted"
          >
            Deploy on Vercel
          </Button>

          <TextField
            name="vercelURL"
            id="email"
            label="Once deployed, insert your deployed URL"
            value={vercelURL}
            placeholder="https://record-bin.vercel.app/"
            error={isInvalid ? "Please insert a valid URL" : ""}
            onChange={(newValue) => {
              setIsInvalid(false);
              setVercelURL(newValue);
            }}
          />
          <Button
            fullWidth
            buttonType={isLoading ? "muted" : "primary"}
            disabled={isLoading}
            onClick={handleFinishButtonClick}
          >
            Finish installation
          </Button>
          <Button
            fullWidth
            buttonType="negative"
            onClick={handleCancelationButtonClick}
          >
            Cancel installation
          </Button>
        </Form>
      </div>
    </Canvas>
  );
};

export default InstallationModal;

import { RenderModalCtx } from "datocms-plugin-sdk";
import { Button, Canvas } from "datocms-react-ui";
import { createDebugLogger, isDebugEnabled } from "../utils/debugLogger";

type PropTypes = {
  ctx: RenderModalCtx;
};

const ErrorModal = ({ ctx }: PropTypes) => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    "ErrorModal"
  );

  const handleCancelationButtonClick = () => {
    debugLogger.log("Closing restoration error modal");
    ctx.resolve("done");
  };

  const newString = (ctx.parameters.errorPayload as string)
    .replaceAll("\\n", "\n")
    .replaceAll("\\", "");

  debugLogger.log("Rendering error payload in modal", {
    payloadLength: newString.length,
  });

  return (
    <Canvas ctx={ctx}>
      <pre>{newString}</pre>
      <Button
        onClick={handleCancelationButtonClick}
        fullWidth
        buttonType="primary"
      >
        Done
      </Button>
    </Canvas>
  );
};

export default ErrorModal;

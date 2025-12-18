import { RenderModalCtx } from "datocms-plugin-sdk";
import { Button, Canvas } from "datocms-react-ui";

type PropTypes = {
  ctx: RenderModalCtx;
};

const ErrorModal = ({ ctx }: PropTypes) => {
  const handleCancelationButtonClick = () => {
    ctx.resolve("done");
  };

  const newString = (ctx.parameters.errorPayload as string)
    .replaceAll("\\n", "\n")
    .replaceAll("\\", "");

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

import type { RenderModalCtx } from "datocms-plugin-sdk";
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

  const copyTextToClipboard = async (text: string) => {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return;
    }

    if (typeof document === "undefined") {
      throw new Error("Clipboard API is unavailable in this environment.");
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();

    const didCopy = document.execCommand("copy");
    document.body.removeChild(textArea);

    if (!didCopy) {
      throw new Error("execCommand copy failed.");
    }
  };

  const handleCancelationButtonClick = () => {
    debugLogger.log("Closing restoration error modal");
    ctx.resolve("done");
  };

  const errorPayloadText = (ctx.parameters.errorPayload as string)
    .replaceAll("\\n", "\n")
    .replaceAll("\\", "");

  const handleCopyButtonClick = async () => {
    try {
      await copyTextToClipboard(errorPayloadText);
      debugLogger.log("Copied restoration error payload to clipboard", {
        payloadLength: errorPayloadText.length,
      });
      await ctx.notice("Restoration error copied to clipboard.");
    } catch (error) {
      debugLogger.warn("Failed to copy restoration error payload", error);
      await ctx.alert("Could not copy restoration error to clipboard.");
    }
  };

  debugLogger.log("Rendering error payload in modal", {
    payloadLength: errorPayloadText.length,
  });

  return (
    <Canvas ctx={ctx}>
      <Button onClick={handleCopyButtonClick} fullWidth buttonType="muted">
        Copy error to clipboard
      </Button>
      <div
        style={{
          marginTop: "var(--spacing-s)",
          marginBottom: "var(--spacing-s)",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          background: "#f8f9fb",
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: "var(--spacing-m)",
            maxHeight: "320px",
            overflowY: "auto",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            fontSize: "12px",
            lineHeight: "1.5",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        >
          <code>{errorPayloadText}</code>
        </pre>
      </div>
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

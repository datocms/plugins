import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import get from "lodash/get";
/* Import TinyMCE */
// To know all the available TinyMCE options and plugins go to https://www.tiny.cloud/docs/

/* Import TinyMCE */
import tinymce, { Editor } from "tinymce";

/* Default icons are required for TinyMCE 5.3 or above */
import "tinymce/icons/default";

/* A theme is also required */
import "tinymce/themes/silver";

/* Import the skin */
import "tinymce/skins/ui/oxide/skin.css";

/* Import plugins */
import "tinymce/plugins/image";
import "tinymce/plugins/advlist";
import "tinymce/plugins/code";
import "tinymce/plugins/emoticons";
import "tinymce/plugins/emoticons/js/emojis";
import "tinymce/plugins/link";
import "tinymce/plugins/lists";
import "tinymce/plugins/paste";
import "tinymce/plugins/table";
import "tinymce/plugins/autoresize";
import imgixThumbUrl from "../../utils/imgixThumbUrl";

import s from "./styles.module.css";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: Props) {
  const initialize = (editor: Editor) => {
    const handleDatoImages = () => {
      // Handles inserting Dato image in the HTML editor
      ctx.selectUpload({ multiple: true }).then((files) => {
        files &&
          files.forEach((file) => {
            const metadata = file.attributes.default_field_metadata[ctx.locale];

            let text = "<img ";

            if (metadata.alt) {
              text += `alt="${metadata.alt || ""}" `;
            }

            if (metadata.title) {
              text += `title="${metadata.title || ""}" `;
            }

            text += `src="${imgixThumbUrl({
              imageishThing: file,
              ctx,
            })}" />`;

            editor.insertContent(text);
          });
      });
    };

    editor.on("init", () => {
      const initialValue = get(ctx.formValues, ctx.fieldPath) as string;
      editor.setContent(initialValue);
    });

    editor.on("change", () => {
      // Sets the plugin value on blur
      ctx.setFieldValue(ctx.fieldPath, editor.getContent());
    });

    editor.ui.registry.addButton("customimage", {
      icon: "image",
      tooltip: "Insert image...",
      onAction: handleDatoImages,
    });

    editor.ui.registry.addButton("replaceimage", {
      icon: "browse",
      tooltip: "Replace image",
      onAction: handleDatoImages,
    });

    editor.ui.registry.addContextToolbar("imagealignment", {
      // Shows image replacement options when selecting image
      predicate: (node) => {
        if (node.nodeName.toLowerCase() === "img") {
          return true;
        }
        return false;
      },

      items: "replaceimage image",
      position: "node",
      scope: "node",
    });
  };

  tinymce.init({
    selector: "#tinymce__container",
    plugins: "image advlist code emoticons link lists table autoresize",
    toolbar:
      "undo redo | formatselect | " +
      "bold italic backcolor | link customimage |" +
      "alignleft aligncenter " +
      "alignright alignjustify | bullist numlist outdent indent | " +
      "removeformat | emoticons",
    content_style:
      "body { font-family:Helvetica,Arial,sans-serif; font-size:16px }",
    setup: initialize,
    autoresize_bottom_margin: 10,
  });

  return (
    <Canvas ctx={ctx}>
      <div id="tinymce__container" className={s.tinymce__container} />
    </Canvas>
  );
}

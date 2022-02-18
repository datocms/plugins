import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import get from 'lodash/get';
import tinymce from 'tinymce/tinymce';
import { Editor as ReactEditor } from '@tinymce/tinymce-react';
import imgixThumbUrl from '../../utils/imgixThumbUrl';
import { Editor } from 'tinymce';

(global as any).tinymce = tinymce;

require('tinymce/icons/default');
require('tinymce/themes/silver');
require('tinymce/skins/ui/oxide/skin.css');
require('tinymce/plugins/image');
require('tinymce/plugins/advlist');
require('tinymce/plugins/code');
require('tinymce/plugins/emoticons');
require('tinymce/plugins/emoticons/js/emojis');
require('tinymce/plugins/link');
require('tinymce/plugins/lists');
require('tinymce/plugins/paste');
require('tinymce/plugins/table');
require('tinymce/plugins/autoresize');

type Props = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: Props) {
  const value = (get(ctx.formValues, ctx.fieldPath) as string | null) || '';

  const handleChange = (newValue: string) => {
    ctx.setFieldValue(ctx.fieldPath, newValue);
  };

  const initialize = (editor: Editor) => {
    const handleDatoImages = () => {
      // Handles inserting Dato image in the HTML editor
      ctx.selectUpload({ multiple: true }).then((files) => {
        files &&
          files.forEach((file) => {
            const metadata = file.attributes.default_field_metadata[ctx.locale];

            let text = '<img ';

            if (metadata.alt) {
              text += `alt="${metadata.alt || ''}" `;
            }

            if (metadata.title) {
              text += `title="${metadata.title || ''}" `;
            }

            text += `src="${imgixThumbUrl({
              imageishThing: file,
              ctx,
            })}" />`;

            editor.insertContent(text);
          });
      });
    };

    editor.on('change', () => {
      console.log(editor.getContent());
      ctx.setFieldValue(ctx.fieldPath, editor.getContent());
    });

    editor.ui.registry.addButton('customimage', {
      icon: 'image',
      tooltip: 'Insert image...',
      onAction: handleDatoImages,
    });

    editor.ui.registry.addButton('replaceimage', {
      icon: 'browse',
      tooltip: 'Replace image',
      onAction: handleDatoImages,
    });

    editor.ui.registry.addContextToolbar('imagealignment', {
      // Shows image replacement options when selecting image
      predicate: (node) => {
        if (node.nodeName.toLowerCase() === 'img') {
          return true;
        }
        return false;
      },

      items: 'replaceimage image',
      position: 'node',
      scope: 'node',
    });
  };

  return (
    <Canvas ctx={ctx}>
      <ReactEditor
        disabled={ctx.disabled}
        init={{
          plugins: 'image advlist code emoticons link lists table autoresize',
          toolbar:
            'undo redo | formatselect | ' +
            'bold italic backcolor | link customimage |' +
            'alignleft aligncenter ' +
            'alignright alignjustify | bullist numlist outdent indent | ' +
            'removeformat | emoticons',
          content_style:
            'body { font-family:Helvetica,Arial,sans-serif; font-size:16px }',
          setup: initialize,
          autoresize_bottom_margin: 10,
        }}
        value={value}
        onEditorChange={handleChange}
      />
    </Canvas>
  );
}

import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import get from 'lodash/get';
import tinymce from 'tinymce/tinymce';
import { Editor as ReactEditor } from '@tinymce/tinymce-react';
import imgixThumbUrl from '../../utils/imgixThumbUrl';
import { Editor } from 'tinymce';
import { useEffect, useRef, useState } from 'react';

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

// Caution: The controlled component can have performance problems on large documents
// as it requires converting the entire document to a string on each keystroke or modification.
//
// The `onEditorChange` prop is used to provide an event handler that will be run when any change
// is made to the editor content. Changes to the editor must be applied to the `value` prop
// **within 200 milliseconds** to prevent the changes being rolled back.

export default function FieldExtension({ ctx }: Props) {
  const externalValue =
    (get(ctx.formValues, ctx.fieldPath) as string | null) || '';

  const [value, setValue] = useState(externalValue || '');
  const expectedValue = useRef<string | null>(null);

  useEffect(() => {
    if (
      expectedValue.current !== null &&
      expectedValue.current === (externalValue || '')
    ) {
      expectedValue.current = null;
    }
  }, [expectedValue, externalValue]);

  useEffect(() => {
    if (externalValue === value) return;

    if (expectedValue.current !== null) {
      return;
    }

    setValue(externalValue || '');
  }, [expectedValue, externalValue, value]);

  const handleChange = (newValue: string) => {
    setValue(newValue);

    if (newValue !== externalValue) {
      expectedValue.current = newValue;
      ctx.setFieldValue(ctx.fieldPath, newValue);
    }
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

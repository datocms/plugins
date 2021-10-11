/* Import TinyMCE */
// To know all the available TinyMCE options and plugins go to https://www.tiny.cloud/docs/

/* Import TinyMCE */
import tinymce from 'tinymce';

/* Default icons are required for TinyMCE 5.3 or above */
import 'tinymce/icons/default';

/* A theme is also required */
import 'tinymce/themes/silver';

/* Import the skin */
import 'tinymce/skins/ui/oxide/skin.css';

/* Import plugins */
import 'tinymce/plugins/image';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/code';
import 'tinymce/plugins/emoticons';
import 'tinymce/plugins/emoticons/js/emojis';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/paste';
import 'tinymce/plugins/table';

import './style.css';
import imgixThumbUrl from './imgixThumbUrl';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const container = document.createElement('div');
  container.classList.add('tiny-mce-container');
  document.body.appendChild(container);

  const listeners = (editor) => {
    const handleDatoImages = () => {
      plugin.selectUpload({ multiple: true }).then((files) => {
        files.forEach((file) => {
          const metadata = file.attributes.default_field_metadata[plugin.locale];

          let text = '<img ';

          if (metadata.alt) {
            text += `alt="${metadata.alt || ''}" `;
          }

          if (metadata.title) {
            text += `title="${metadata.title || ''}" `;
          }

          text += `src="${imgixThumbUrl({ imageishThing: file, plugin })}" />`;

          editor.insertContent(text);
        });
      });
    };

    editor.on('init', () => {
      const initialValue = plugin.getFieldValue(plugin.fieldPath);
      editor.setContent(initialValue);
    });

    editor.on('change', () => {
      // Will set the plugin value on blur
      plugin.setFieldValue(plugin.fieldPath, editor.getContent());
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

  tinymce.init({
    selector: '.tiny-mce-container',
    plugins: 'image advlist code emoticons link lists table',
    toolbar:
      'undo redo | formatselect | '
      + 'bold italic backcolor | link customimage |'
      + 'alignleft aligncenter '
      + 'alignright alignjustify | bullist numlist outdent indent | '
      + 'removeformat | emoticons',
    content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:16px }',
    setup: listeners,
  });
});

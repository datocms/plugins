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
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/code';
import 'tinymce/plugins/emoticons';
import 'tinymce/plugins/emoticons/js/emojis';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/paste';
import 'tinymce/plugins/table';

import './style.css';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const container = document.createElement('div');
  container.classList.add('tiny-mce-container');
  document.body.appendChild(container);

  tinymce.init({
    selector: '.tiny-mce-container',
    plugins: 'advlist code emoticons link lists table',
    toolbar:
      'undo redo | formatselect | '
      + 'bold italic backcolor | alignleft aligncenter '
      + 'alignright alignjustify | bullist numlist outdent indent | '
      + 'link removeformat | emoticons',
    content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:16px }',
  });
});

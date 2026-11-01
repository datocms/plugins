import { buildClient } from '@datocms/cma-client-browser';
import { Editor as ReactEditor } from '@tinymce/tinymce-react';
import type { RenderFieldExtensionCtx, Upload } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { useEditorToolbarWiring } from 'datocms-react-ui/EditorToolbar';
import get from 'lodash/get';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from 'tinymce';
import tinymce from 'tinymce/tinymce';
import imgixThumbUrl from '../../utils/imgixThumbUrl';
import s from './styles.module.css';
import Toolbar from './Toolbar';

(window as unknown as Window & { tinymce: typeof tinymce }).tinymce = tinymce;

import 'tinymce/icons/default';
import 'tinymce/models/dom';
import 'tinymce/themes/silver';
import 'tinymce/skins/ui/oxide/skin';
import 'tinymce/skins/ui/oxide/content';
import 'tinymce/skins/ui/oxide-dark/skin';
import 'tinymce/skins/ui/oxide-dark/content';
import 'tinymce/skins/content/default/content';
import 'tinymce/skins/content/dark/content';
import 'tinymce/plugins/image';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/code';
import 'tinymce/plugins/emoticons';
import 'tinymce/plugins/emoticons/js/emojis';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/table';
import 'tinymce/plugins/autoresize';

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomId(length = 8) {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}

const id = randomId();

function log(step: string, object?: Record<string, unknown>) {
  if (localStorage.getItem('DEBUG')) {
    console.log({ id, step, ...(object || {}) });
  }
}

type Props = {
  ctx: RenderFieldExtensionCtx;
};

function buildImgTagForFile(
  file: Upload,
  locale: string,
  ctx: RenderFieldExtensionCtx,
) {
  // `default_field_metadata` is field-keyed (`{ alt: { en } }`): the locale sits
  // one level below each metadata field, not above it.
  const { alt, title } = file.attributes.default_field_metadata;
  const localizedAlt = alt[locale];
  const localizedTitle = title[locale];

  let text = '<img ';

  if (localizedAlt) {
    text += `alt="${localizedAlt}" `;
  }

  if (localizedTitle) {
    text += `title="${localizedTitle}" `;
  }

  text += `src="${imgixThumbUrl({ imageishThing: file, ctx })}" />`;
  return text;
}

async function uploadBlobToClient(
  ctx: RenderFieldExtensionCtx,
  blobInfo: { blob(): Blob; filename(): string },
  progress: (percent: number) => void,
) {
  const apiToken = ctx.currentUserAccessToken;
  if (!apiToken) {
    throw new Error('No access token available');
  }
  const client = buildClient({
    apiToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
  const upload = await client.uploads.createFromFileOrBlob({
    fileOrBlob: blobInfo.blob(),
    filename: blobInfo.filename(),
    onProgress(info) {
      if (info.type === 'UPLOADING_FILE') {
        progress(Math.round(info.payload.progress * 100));
      }
    },
  });
  return upload.url;
}

function registerEditorImageButtons(editor: Editor, pickImages: () => void) {
  editor.ui.registry.addButton('replaceimage', {
    icon: 'browse',
    tooltip: 'Replace image',
    onAction: pickImages,
  });

  editor.ui.registry.addContextToolbar('imagealignment', {
    predicate: (node) => node.nodeName.toLowerCase() === 'img',
    items: 'replaceimage image',
    position: 'node',
    scope: 'node',
  });
}

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
  const isDarkMode = ctx.colorScheme === 'dark';

  // The editor after its initialization: the toolbar renders when it is ready
  const [editor, setEditor] = useState<Editor | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // A dialog of TinyMCE (link, image, table, source code, emoji)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const focusEditor = useCallback(() => editor?.focus(), [editor]);
  const { setFocused, visible } = useEditorToolbarWiring({
    busy: blockMenuOpen || moreMenuOpen || dialogOpen || picking,
    focusEditor,
  });

  useEffect(() => {
    log('BEFORE resetExpectedValue', {
      expectedValue: expectedValue.current,
      externalValue,
    });

    if (
      expectedValue.current !== null &&
      expectedValue.current === (externalValue || '')
    ) {
      log('resetExpectedValue');
      expectedValue.current = null;
    }
  }, [externalValue]);

  useEffect(() => {
    log('BEFORE setValueToExternalValue', {
      externalValue,
      expectedValue: expectedValue.current,
    });

    if (externalValue === value) return;

    if (expectedValue.current !== null) {
      return;
    }

    log('setValueToExternalValue', {
      value,
      externalValue,
      expectedValue: expectedValue.current,
    });

    setValue(externalValue || '');
  }, [externalValue, value]);

  const handleChange = (newValue: string) => {
    log('handleChange setValue', {
      newValue,
      externalValue,
      expectedValue: expectedValue.current,
    });
    setValue(newValue);

    if (newValue !== externalValue) {
      log('setExpectedValue', {
        newValue,
      });
      expectedValue.current = newValue;
      ctx.setFieldValue(ctx.fieldPath, newValue);
    }
  };

  const pickImages = (target: Editor) => {
    setPicking(true);
    ctx
      .selectUpload({ multiple: true })
      .then((files) => {
        if (!files) return;
        for (const file of files) {
          target.insertContent(buildImgTagForFile(file, ctx.locale, ctx));
        }
      })
      .finally(() => setPicking(false));
  };

  const initialize = (instance: Editor) => {
    registerEditorImageButtons(instance, () => pickImages(instance));

    instance.on('init', () => setEditor(instance));
    instance.on('remove', () => {
      setEditor((current) => (current === instance ? null : current));
      setFocused(false);
      setDialogOpen(false);
    });
    instance.on('focus', () => setFocused(true));
    instance.on('blur', () => setFocused(false));
    instance.on('OpenWindow', () => setDialogOpen(true));
    instance.on('CloseWindow', () => setDialogOpen(false));
    // A click in TinyMCE's iframe doesn't reach the frame's document, where
    // the kit closes an open toolbar menu on a click outside it
    instance.on('mousedown', () =>
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      ),
    );
  };

  // TinyMCE's iframe doesn't get the CSS variables: its content takes the
  // colors of the field from the tokens of the host
  const tokens = ctx.cssDesignTokens;
  const surface = ctx.disabled
    ? tokens['--color--disabled-field--surface']
    : tokens['--color--surface-raised'];
  const ink = ctx.disabled
    ? tokens['--color--disabled-field--ink']
    : tokens['--color--ink'];

  // content_style is read only at init: a field that gets disabled or enabled
  // again (the CMS disables the form during a slow save) keeps its editor and
  // takes the new colors on its body, which isn't part of the value
  useEffect(() => {
    editor?.dom.setStyles(editor.getBody(), {
      'background-color': surface,
      color: ink,
    });
  }, [editor, surface, ink]);

  return (
    <Canvas ctx={ctx}>
      <div className={blockMenuOpen || moreMenuOpen ? s.room : undefined}>
        <div className={ctx.disabled ? `${s.editor} ${s.disabled}` : s.editor}>
          <Toolbar
            editor={editor}
            hidden={!visible || ctx.disabled}
            onPickImages={() => editor && pickImages(editor)}
            onBlockMenuToggle={setBlockMenuOpen}
            onMoreMenuToggle={setMoreMenuOpen}
          />
          <ReactEditor
            // TinyMCE reads its skin only at init
            key={ctx.colorScheme}
            disabled={ctx.disabled}
            licenseKey="gpl"
            init={{
              plugins:
                'image advlist code emoticons link lists table autoresize',
              // The toolbar is the kit's (see Toolbar)
              toolbar: false,
              menubar: false,
              statusbar: false,
              skin: isDarkMode ? 'oxide-dark' : 'oxide',
              content_css: isDarkMode ? 'dark' : 'default',
              content_style: `body { font-family:Helvetica,Arial,sans-serif; font-size:16px; background-color:${surface}; color:${ink} }`,
              setup: initialize,
              autoresize_bottom_margin: 10,
              paste_data_images: true,
              promotion: false,
              branding: false,
              async images_upload_handler(blobInfo, progress) {
                try {
                  return await uploadBlobToClient(ctx, blobInfo, progress);
                } catch (_e) {
                  throw new Error('Could not upload image');
                }
              },
            }}
            value={value}
            onEditorChange={handleChange}
          />
        </div>
      </div>
    </Canvas>
  );
}

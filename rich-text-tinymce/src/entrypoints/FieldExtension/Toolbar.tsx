import { Dropdown } from 'datocms-react-ui/Dropdown';
import {
  EditorToolbar,
  type EditorToolbarCommands,
  useEditorToolbarState,
} from 'datocms-react-ui/EditorToolbar';
import type { Editor } from 'tinymce';
import s from './styles.module.css';

// The default block formats of TinyMCE
const BLOCKS = [
  { format: 'p', title: 'Paragraph' },
  { format: 'h1', title: 'Heading 1' },
  { format: 'h2', title: 'Heading 2' },
  { format: 'h3', title: 'Heading 3' },
  { format: 'h4', title: 'Heading 4' },
  { format: 'h5', title: 'Heading 5' },
  { format: 'h6', title: 'Heading 6' },
  { format: 'pre', title: 'Preformatted' },
];

const ALIGNMENTS = ['alignleft', 'aligncenter', 'alignright', 'alignjustify'];

// The kit's buttons around the Emoji button, which inserts and so comes
// right after the group of the link
const BUTTONS_BEFORE_EMOJI = [
  'bold',
  'italic',
  'strikethrough',
  'code',
  'unordered_list',
  'ordered_list',
  'quote',
  'link',
  'image',
  'table',
];

const BUTTONS_AFTER_EMOJI = [
  'align_left',
  'align_center',
  'align_right',
  'align_justify',
  'outdent',
  'indent',
  'undo',
  'redo',
  'show_source',
];

const COLOR_MENUS = [
  { format: 'forecolor', label: 'Text color', icon: <PaletteIcon /> },
  { format: 'hilitecolor', label: 'Background color', icon: <FillDripIcon /> },
];

type ToolbarState = {
  // undefined when the block at the cursor is none of BLOCKS
  block: string | undefined;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  quote: boolean;
  link: boolean;
  alignment: string | undefined;
  // The values of TinyMCE at the cursor, '' when there is none
  fontName: string;
  fontSize: string;
  lineHeight: string;
  // The list-style-type of the list at the cursor, '' outside a list
  listStyle: string;
  canUndo: boolean;
  canRedo: boolean;
};

const EMPTY_STATE: ToolbarState = {
  block: undefined,
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
  unorderedList: false,
  orderedList: false,
  quote: false,
  link: false,
  alignment: undefined,
  fontName: '',
  fontSize: '',
  lineHeight: '',
  listStyle: '',
  canUndo: false,
  canRedo: false,
};

function readState(editor: Editor): ToolbarState {
  const matches = (format: string) => editor.formatter.match(format);
  const fontSize = editor.queryCommandValue('FontSize');
  const list = editor.dom.getParent(editor.selection.getNode(), 'ol,ul');

  return {
    block: BLOCKS.find(({ format }) => matches(format))?.format,
    bold: matches('bold'),
    italic: matches('italic'),
    strikethrough: matches('strikethrough'),
    code: matches('code'),
    unorderedList: editor.queryCommandState('InsertUnorderedList'),
    orderedList: editor.queryCommandState('InsertOrderedList'),
    quote: matches('blockquote'),
    link: Boolean(editor.dom.getParent(editor.selection.getNode(), 'a[href]')),
    alignment: ALIGNMENTS.find((format) => matches(format)),
    // Compared as the menus of TinyMCE do: the first font, and the size in pt
    fontName: editor.queryCommandValue('FontName').split(',')[0].toLowerCase(),
    fontSize: fontSize.endsWith('px')
      ? `${Math.round(Number.parseFloat(fontSize) * 0.75)}pt`
      : fontSize,
    lineHeight: editor.queryCommandValue('LineHeight'),
    listStyle: list
      ? editor.dom.getStyle(list, 'list-style-type') || 'default'
      : '',
    canUndo: editor.undoManager.hasUndo(),
    canRedo: editor.undoManager.hasRedo(),
  };
}

// The events of TinyMCE after which a button can change its state
const STATE_EVENTS = 'NodeChange Undo Redo AddUndo TypingUndo ClearUndos';

function subscribe(editor: Editor, update: () => void) {
  const handler = () => {
    if (!editor.removed) {
      update();
    }
  };

  editor.on(STATE_EVENTS, handler);

  return () => {
    editor.off(STATE_EVENTS, handler);
  };
}

// 'Light Green' and 'lower-alpha' become 'Light green' and 'Lower alpha'
function sentenceCase(text: string) {
  const words = text.replace(/-/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Props = {
  // The editor, after its initialization
  editor: Editor | null;
  hidden: boolean;
  onPickImages: () => void;
  // Stable functions: the trigger of the kit calls them in an effect
  onBlockMenuToggle: (open: boolean) => void;
  onMoreMenuToggle: (open: boolean) => void;
};

export default function Toolbar({
  editor,
  hidden,
  onPickImages,
  onBlockMenuToggle,
  onMoreMenuToggle,
}: Props) {
  const state = useEditorToolbarState(
    editor,
    EMPTY_STATE,
    readState,
    subscribe,
  );

  if (!editor) {
    return null;
  }

  const run = (command: string, value?: unknown) => () =>
    editor.execCommand(command, false, value);

  // One undo step, as the block and color menus of TinyMCE do. Not the
  // FormatBlock command, which removes a block format the block already has
  const change = (apply: () => void) => () => {
    editor.undoManager.transact(() => {
      editor.focus();
      apply();
    });
    editor.nodeChanged();
  };

  const listStyle = (style: string) => ({
    'list-style-type': style === 'default' ? '' : style,
  });

  // The values of the More menu are the options of TinyMCE
  const colors = editor.options.get('color_map') as unknown as {
    text: string;
    value: string;
  }[];
  const fonts = (editor.options.get('font_family_formats') as string)
    .replace(/;$/, '')
    .split(';')
    .map((entry) => entry.split('='));
  const sizes = (editor.options.get('font_size_formats') as string).split(' ');
  const lineHeights = (
    editor.options.get('line_height_formats') as string
  ).split(' ');
  const bulletStyles = editor.options.get('advlist_bullet_styles') as string[];
  const numberStyles = editor.options.get('advlist_number_styles') as string[];

  const commands: EditorToolbarCommands = {
    bold: { run: run('Bold'), active: state.bold, shortcut: 'mod+b' },
    italic: { run: run('Italic'), active: state.italic, shortcut: 'mod+i' },
    strikethrough: { run: run('Strikethrough'), active: state.strikethrough },
    code: { run: run('mceToggleFormat', 'code'), active: state.code },
    unordered_list: {
      run: run('InsertUnorderedList'),
      active: state.unorderedList,
    },
    ordered_list: { run: run('InsertOrderedList'), active: state.orderedList },
    quote: { run: run('mceBlockQuote'), active: state.quote },
    link: { run: run('mceLink'), active: state.link, shortcut: 'mod+k' },
    image: { run: onPickImages },
    table: { run: run('mceInsertTableDialog') },
    align_left: {
      run: run('JustifyLeft'),
      active: state.alignment === 'alignleft',
    },
    align_center: {
      run: run('JustifyCenter'),
      active: state.alignment === 'aligncenter',
    },
    align_right: {
      run: run('JustifyRight'),
      active: state.alignment === 'alignright',
    },
    align_justify: {
      run: run('JustifyFull'),
      active: state.alignment === 'alignjustify',
    },
    outdent: { run: run('Outdent') },
    indent: { run: run('Indent') },
    undo: { run: run('Undo'), disabled: !state.canUndo, shortcut: 'mod+z' },
    redo: {
      run: run('Redo'),
      disabled: !state.canRedo,
      shortcut: 'mod+shift+z',
    },
    show_source: { run: run('mceCodeEditor') },
  };

  return (
    <EditorToolbar hidden={hidden}>
      <EditorToolbar.Group>
        <EditorToolbar.Dropdown
          wide
          label={
            BLOCKS.find(({ format }) => format === state.block)?.title ??
            'Paragraph'
          }
          onToggle={onBlockMenuToggle}
        >
          <Dropdown.Menu contextualSearch={false}>
            {BLOCKS.map(({ format, title }) => (
              <Dropdown.Option
                key={format}
                active={state.block === format}
                onPick={change(() => editor.formatter.apply(format))}
              >
                {title}
              </Dropdown.Option>
            ))}
          </Dropdown.Menu>
        </EditorToolbar.Dropdown>
      </EditorToolbar.Group>
      <EditorToolbar.Buttons
        buttons={BUTTONS_BEFORE_EMOJI}
        commands={commands}
      />
      <EditorToolbar.Group>
        <EditorToolbar.Button
          active={false}
          label="Emoji"
          onClick={run('mceEmoticons')}
        >
          <FaceSmileIcon />
        </EditorToolbar.Button>
      </EditorToolbar.Group>
      <EditorToolbar.Buttons
        buttons={BUTTONS_AFTER_EMOJI}
        commands={commands}
      />
      <EditorToolbar.Group>
        <EditorToolbar.Button
          active={false}
          label="Remove formatting"
          onClick={run('RemoveFormat')}
        >
          <EraserIcon />
        </EditorToolbar.Button>
        <EditorToolbar.Dropdown label="More" onToggle={onMoreMenuToggle}>
          <Dropdown.Menu contextualSearch={false}>
            <Dropdown.Option icon={<UnderlineIcon />} onPick={run('Underline')}>
              Underline
            </Dropdown.Option>
            <Dropdown.Option
              icon={<SuperscriptIcon />}
              onPick={run('Superscript')}
            >
              Superscript
            </Dropdown.Option>
            <Dropdown.Option icon={<SubscriptIcon />} onPick={run('Subscript')}>
              Subscript
            </Dropdown.Option>
            <Dropdown.Separator />
            {COLOR_MENUS.map(({ format, label, icon }) => (
              <Dropdown.Submenu
                key={format}
                triggerIcon={icon}
                triggerContent={label}
              >
                {colors.map(({ text, value }) => (
                  <Dropdown.Option
                    key={value}
                    icon={
                      <span
                        className={s.swatch}
                        style={{ backgroundColor: value }}
                        aria-hidden
                      />
                    }
                    onPick={change(() =>
                      editor.formatter.apply(format, { value }),
                    )}
                  >
                    {sentenceCase(text)}
                  </Dropdown.Option>
                ))}
                <Dropdown.Separator />
                <Dropdown.Option
                  onPick={change(() =>
                    editor.formatter.remove(
                      format,
                      { value: null },
                      undefined,
                      true,
                    ),
                  )}
                >
                  Remove color
                </Dropdown.Option>
              </Dropdown.Submenu>
            ))}
            <Dropdown.Submenu triggerIcon={<FontIcon />} triggerContent="Font">
              {fonts.map(([title, value = title]) => (
                <Dropdown.Option
                  key={title}
                  active={state.fontName === value.split(',')[0]}
                  onPick={run('FontName', value)}
                >
                  {title}
                </Dropdown.Option>
              ))}
            </Dropdown.Submenu>
            <Dropdown.Submenu
              triggerIcon={<TextHeightIcon />}
              triggerContent="Font size"
            >
              {sizes.map((size) => (
                <Dropdown.Option
                  key={size}
                  active={state.fontSize === size}
                  onPick={run('FontSize', size)}
                >
                  {size}
                </Dropdown.Option>
              ))}
            </Dropdown.Submenu>
            <Dropdown.Submenu
              triggerIcon={<ArrowsUpDownIcon />}
              triggerContent="Line height"
            >
              {lineHeights.map((lineHeight) => (
                <Dropdown.Option
                  key={lineHeight}
                  active={state.lineHeight === lineHeight}
                  onPick={run('LineHeight', lineHeight)}
                >
                  {lineHeight}
                </Dropdown.Option>
              ))}
            </Dropdown.Submenu>
            <Dropdown.Submenu
              triggerIcon={<CircleDotIcon />}
              triggerContent="Bulleted list style"
            >
              {bulletStyles.map((style) => (
                <Dropdown.Option
                  key={style}
                  active={state.unorderedList && state.listStyle === style}
                  onPick={run('ApplyUnorderedListStyle', listStyle(style))}
                >
                  {sentenceCase(style)}
                </Dropdown.Option>
              ))}
            </Dropdown.Submenu>
            <Dropdown.Submenu
              triggerIcon={<HashtagIcon />}
              triggerContent="Numbered list style"
            >
              {numberStyles.map((style) => (
                <Dropdown.Option
                  key={style}
                  active={state.orderedList && state.listStyle === style}
                  onPick={run('ApplyOrderedListStyle', listStyle(style))}
                >
                  {sentenceCase(style)}
                </Dropdown.Option>
              ))}
            </Dropdown.Submenu>
            <Dropdown.Separator />
            <Dropdown.Option
              icon={<MinusIcon />}
              onPick={run('InsertHorizontalRule')}
            >
              Horizontal line
            </Dropdown.Option>
            <Dropdown.Option icon={<GlobeIcon />} onPick={run('mceImage')}>
              Insert image from URL
            </Dropdown.Option>
          </Dropdown.Menu>
        </EditorToolbar.Dropdown>
      </EditorToolbar.Group>
    </EditorToolbar>
  );
}

// Font Awesome 6 solid glyphs, filled like the icons of the kit's toolbar

function EraserIcon() {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M290.7 57.4L57.4 290.7c-25 25-25 65.5 0 90.5l80 80c12 12 28.3 18.7 45.3 18.7L288 480l9.4 0L512 480c17.7 0 32-14.3 32-32s-14.3-32-32-32l-124.1 0L518.6 285.3c25-25 25-65.5 0-90.5L381.3 57.4c-25-25-65.5-25-90.5 0zM297.4 416l-9.4 0-105.4 0-80-80L227.3 211.3 364.7 348.7 297.4 416z" />
    </svg>
  );
}

function FaceSmileIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM164.1 325.5C182 346.2 212.6 368 256 368s74-21.8 91.9-42.5c5.8-6.7 15.9-7.4 22.6-1.6s7.4 15.9 1.6 22.6C349.8 372.1 311.1 400 256 400s-93.8-27.9-116.1-53.5c-5.8-6.7-5.1-16.8 1.6-22.6s16.8-5.1 22.6 1.6zM144.4 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" />
    </svg>
  );
}

function UnderlineIcon() {
  return (
    <svg
      viewBox="0 0 448 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16 64c0-17.7 14.3-32 32-32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-16 0 0 128c0 53 43 96 96 96s96-43 96-96l0-128-16 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-16 0 0 128c0 88.4-71.6 160-160 160s-160-71.6-160-160L64 96 48 96C30.3 96 16 81.7 16 64zM0 448c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 480c-17.7 0-32-14.3-32-32z" />
    </svg>
  );
}

function SuperscriptIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M480 32c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 73.5 404.3 80 416 80l0 80c-17.7 0-32 14.3-32 32s14.3 32 32 32l32 0 32 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l0-128zM32 64C14.3 64 0 78.3 0 96s14.3 32 32 32l15.3 0 89.6 128L47.3 384 32 384c-17.7 0-32 14.3-32 32s14.3 32 32 32l32 0c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6l32 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-15.3 0L215.1 256l89.6-128 15.3 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-32 0c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64L32 64z" />
    </svg>
  );
}

function SubscriptIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M32 64C14.3 64 0 78.3 0 96s14.3 32 32 32l15.3 0 89.6 128L47.3 384 32 384c-17.7 0-32 14.3-32 32s14.3 32 32 32l32 0c10.4 0 20.2-5.1 26.2-13.6L176 311.8l85.8 122.6c6 8.6 15.8 13.6 26.2 13.6l32 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-15.3 0L215.1 256l89.6-128 15.3 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-32 0c-10.4 0-20.2 5.1-26.2 13.6L176 200.2 90.2 77.6C84.2 69.1 74.4 64 64 64L32 64zM480 320c0-11.1-5.7-21.4-15.2-27.2s-21.2-6.4-31.1-1.4l-32 16c-15.8 7.9-22.2 27.1-14.3 42.9C393 361.5 404.3 368 416 368l0 80c-17.7 0-32 14.3-32 32s14.3 32 32 32l32 0 32 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l0-128z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M512 256c0 .9 0 1.8 0 2.7c-.4 36.5-33.6 61.3-70.1 61.3L344 320c-26.5 0-48 21.5-48 48c0 3.4 .4 6.7 1 9.9c2.1 10.2 6.5 20 10.8 29.9c6.1 13.8 12.1 27.5 12.1 42c0 31.8-21.6 60.7-53.4 62c-3.5 .1-7 .2-10.6 .2C114.6 512 0 397.4 0 256S114.6 0 256 0S512 114.6 512 256zM128 288a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm0-96a32 32 0 1 0 0-64 32 32 0 1 0 0 64zM288 96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm96 96a32 32 0 1 0 0-64 32 32 0 1 0 0 64z" />
    </svg>
  );
}

function FillDripIcon() {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M41.4 9.4C53.9-3.1 74.1-3.1 86.6 9.4L168 90.7l53.1-53.1c28.1-28.1 73.7-28.1 101.8 0L474.3 189.1c28.1 28.1 28.1 73.7 0 101.8L283.9 481.4c-37.5 37.5-98.3 37.5-135.8 0L30.6 363.9c-37.5-37.5-37.5-98.3 0-135.8L122.7 136 41.4 54.6c-12.5-12.5-12.5-32.8 0-45.3zm176 221.3L168 181.3 75.9 273.4c-4.2 4.2-7 9.3-8.4 14.6l319.2 0 42.3-42.3c3.1-3.1 3.1-8.2 0-11.3L277.7 82.9c-3.1-3.1-8.2-3.1-11.3 0L213.3 136l49.4 49.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0zM512 512c-35.3 0-64-28.7-64-64c0-25.2 32.6-79.6 51.2-108.7c6-9.4 19.5-9.4 25.5 0C543.4 368.4 576 422.8 576 448c0 35.3-28.7 64-64 64z" />
    </svg>
  );
}

function FontIcon() {
  return (
    <svg
      viewBox="0 0 448 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M254 52.8C249.3 40.3 237.3 32 224 32s-25.3 8.3-30 20.8L57.8 416 32 416c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-1.8 0 18-48 159.6 0 18 48-1.8 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-25.8 0L254 52.8zM279.8 304l-111.6 0L224 155.1 279.8 304z" />
    </svg>
  );
}

function TextHeightIcon() {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M64 128l0-32 64 0 0 320-32 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-32 0 0-320 64 0 0 32c0 17.7 14.3 32 32 32s32-14.3 32-32l0-48c0-26.5-21.5-48-48-48L160 32 48 32C21.5 32 0 53.5 0 80l0 48c0 17.7 14.3 32 32 32s32-14.3 32-32zM502.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-64 64c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8l32 0 0 192-32 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l64 64c12.5 12.5 32.8 12.5 45.3 0l64-64c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8l-32 0 0-192 32 0c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-64-64z" />
    </svg>
  );
}

function ArrowsUpDownIcon() {
  return (
    <svg
      viewBox="0 0 320 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M182.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L128 109.3l0 293.5L86.6 361.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l96 96c12.5 12.5 32.8 12.5 45.3 0l96-96c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 402.7l0-293.5 41.4 41.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-96-96z" />
    </svg>
  );
}

function CircleDotIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-352a96 96 0 1 1 0 192 96 96 0 1 1 0-192z" />
    </svg>
  );
}

function HashtagIcon() {
  return (
    <svg
      viewBox="0 0 448 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M181.3 32.4c17.4 2.9 29.2 19.4 26.3 36.8L197.8 128l95.1 0 11.5-69.3c2.9-17.4 19.4-29.2 36.8-26.3s29.2 19.4 26.3 36.8L357.8 128l58.2 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-68.9 0L325.8 320l58.2 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-68.9 0-11.5 69.3c-2.9 17.4-19.4 29.2-36.8 26.3s-29.2-19.4-26.3-36.8l9.8-58.7-95.1 0-11.5 69.3c-2.9 17.4-19.4 29.2-36.8 26.3s-29.2-19.4-26.3-36.8L90.2 384 32 384c-17.7 0-32-14.3-32-32s14.3-32 32-32l68.9 0 21.3-128L64 192c-17.7 0-32-14.3-32-32s14.3-32 32-32l68.9 0 11.5-69.3c2.9-17.4 19.4-29.2 36.8-26.3zM187.1 192L165.8 320l95.1 0 21.3-128-95.1 0z" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 448 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M432 256c0 17.7-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l352 0c17.7 0 32 14.3 32 32z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M352 256c0 22.2-1.2 43.6-3.3 64l-185.3 0c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64l185.3 0c2.2 20.4 3.3 41.8 3.3 64zm28.8-64l123.1 0c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64l-123.1 0c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm112.6-32l-116.7 0c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 142 77.5 171.9 151.6zm-149.1 0l-176.6 0c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.8 13.8c11.3 10.8 23 27.9 33.5 51.5c11.6 26 20.9 58.2 27 94.7zm-209 0L18.6 160C48.6 85.9 112.2 29.1 190.6 8.4C165.1 42.6 145.3 96.1 135.3 160zM8.1 192l123.1 0c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64L8.1 320C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64zM194.7 446.6c-11.6-26-20.9-58.2-27-94.6l176.6 0c-6.1 36.4-15.5 68.6-27 94.6c-10.5 23.6-22.2 40.7-33.5 51.5C272.6 508.8 263.3 512 256 512s-16.6-3.2-27.8-13.8c-11.3-10.8-23-27.9-33.5-51.5zM135.3 352c10 63.9 29.8 117.4 55.3 151.6C112.2 482.9 48.6 426.1 18.6 352l116.7 0zm358.1 0c-30 74.1-93.6 130.9-171.9 151.6c25.5-34.2 45.2-87.7 55.3-151.6l116.7 0z" />
    </svg>
  );
}

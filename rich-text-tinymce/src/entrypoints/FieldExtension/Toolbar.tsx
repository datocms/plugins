import { Dropdown } from 'datocms-react-ui/Dropdown';
import {
  EditorToolbar,
  type EditorToolbarCommands,
  useEditorToolbarState,
} from 'datocms-react-ui/EditorToolbar';
import {
  ALargeSmall,
  ArrowUpDown,
  CircleDot,
  Eraser,
  FaceSlightlySmiling,
  Globe,
  Hash,
  Minus,
  PaintBucket,
  Palette,
  Subscript,
  Superscript,
  Type,
  Underline,
} from 'lucide-react';
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
  { format: 'forecolor', label: 'Text color', icon: <Palette /> },
  { format: 'hilitecolor', label: 'Background color', icon: <PaintBucket /> },
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
          <FaceSlightlySmiling />
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
          <Eraser />
        </EditorToolbar.Button>
        <EditorToolbar.Dropdown label="More" onToggle={onMoreMenuToggle}>
          <Dropdown.Menu contextualSearch={false}>
            <Dropdown.Option icon={<Underline />} onPick={run('Underline')}>
              Underline
            </Dropdown.Option>
            <Dropdown.Option icon={<Superscript />} onPick={run('Superscript')}>
              Superscript
            </Dropdown.Option>
            <Dropdown.Option icon={<Subscript />} onPick={run('Subscript')}>
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
            <Dropdown.Submenu triggerIcon={<Type />} triggerContent="Font">
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
              triggerIcon={<ALargeSmall />}
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
              triggerIcon={<ArrowUpDown />}
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
              triggerIcon={<CircleDot />}
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
              triggerIcon={<Hash />}
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
              icon={<Minus />}
              onPick={run('InsertHorizontalRule')}
            >
              Horizontal line
            </Dropdown.Option>
            <Dropdown.Option icon={<Globe />} onPick={run('mceImage')}>
              Insert image from URL
            </Dropdown.Option>
          </Dropdown.Menu>
        </EditorToolbar.Dropdown>
      </EditorToolbar.Group>
    </EditorToolbar>
  );
}

import type { ModelInfo } from '@hooks/useMentions';
import { EditorToolbar } from 'datocms-react-ui/EditorToolbar';
import {
  AssetIcon,
  AttachIcon,
  FieldIcon,
  ModelIcon,
  UserIcon,
} from '../../../icons';
import { RecordMentionDropdown } from './RecordModelSelectorDropdown';

/** The label of a reference the user may not make: why it is disabled */
const ASSETS_UNAVAILABLE = 'Mentioning assets needs the upload permission.';
const MODELS_UNAVAILABLE = 'Mentioning models needs schema access.';

type ComposerToolbarProps = {
  onUserClick: () => void;
  onFieldClick: () => void;
  /** The models of the record dropdown: the readable ones are listed */
  recordModels: readonly ModelInfo[];
  /** The record dropdown opens or closes (useEditorToolbarWiring) */
  onRecordMenuToggle: (open: boolean) => void;
  /** A model is picked in the record dropdown */
  onRecordModelSelect: (model: ModelInfo) => void;
  onAssetClick: () => void;
  onFileClick: () => void;
  onModelClick: () => void;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  canMentionFields?: boolean;
  disabled?: boolean;
  /**
   * Hides the toolbar: it shows only while the editor has the focus, or
   * while one of its menus or pickers is open (useEditorToolbarWiring)
   */
  hidden?: boolean;
};

/**
 * The toolbar above the message: the references and the files that the
 * user can insert. Each entry opens the same menu or picker as the "/"
 * command. A press keeps the focus and the selection in the editor.
 *
 * Every entry is something to insert, so they share one group, in the order
 * of the command; the record entry is a dropdown, since it picks a model
 * first. Fields exist only next to a record; asset and model references that
 * the role may not make stay in view, disabled, and their label says why.
 *
 * Like the toolbar of any editor, it shows only while the editor has the
 * focus or one of its menus is open. Files can also be dropped anywhere in
 * the frame, with or without the toolbar.
 */
const ComposerToolbar = ({
  onUserClick,
  onFieldClick,
  recordModels,
  onRecordMenuToggle,
  onRecordModelSelect,
  onAssetClick,
  onFileClick,
  onModelClick,
  canMentionAssets = true,
  canMentionModels = true,
  canMentionFields = true,
  disabled = false,
  hidden = false,
}: ComposerToolbarProps) => {
  return (
    <EditorToolbar ariaLabel="Insert" hidden={hidden}>
      <EditorToolbar.Group>
        <EditorToolbar.Button
          active={false}
          disabled={disabled}
          label="Mention a user"
          onClick={onUserClick}
        >
          <UserIcon />
        </EditorToolbar.Button>
        {canMentionFields && (
          <EditorToolbar.Button
            active={false}
            disabled={disabled}
            label="Mention a field"
            onClick={onFieldClick}
          >
            <FieldIcon />
          </EditorToolbar.Button>
        )}
        <RecordMentionDropdown
          disabled={disabled}
          models={recordModels}
          onSelect={onRecordModelSelect}
          onToggle={onRecordMenuToggle}
        />
        <EditorToolbar.Button
          active={false}
          disabled={disabled || !canMentionAssets}
          label={canMentionAssets ? 'Mention an asset' : ASSETS_UNAVAILABLE}
          onClick={canMentionAssets ? onAssetClick : undefined}
        >
          <AssetIcon />
        </EditorToolbar.Button>
        <EditorToolbar.Button
          active={false}
          disabled={disabled || !canMentionModels}
          label={canMentionModels ? 'Mention a model' : MODELS_UNAVAILABLE}
          onClick={canMentionModels ? onModelClick : undefined}
        >
          <ModelIcon />
        </EditorToolbar.Button>
        <EditorToolbar.Button
          active={false}
          disabled={disabled}
          label="Attach files"
          onClick={onFileClick}
        >
          <AttachIcon />
        </EditorToolbar.Button>
      </EditorToolbar.Group>
    </EditorToolbar>
  );
};

export default ComposerToolbar;

import { cn } from '@/utils/cn';
import {
  UserMentionIcon,
  FieldMentionIcon,
  RecordMentionIcon,
  AssetMentionIcon,
  ModelMentionIcon,
  SendIcon,
} from './Icons';
import styles from '@styles/commentbar.module.css';
import ToolbarButton from './shared/ToolbarButton';

type ComposerToolbarProps = {
  onUserClick: () => void;
  onFieldClick: () => void;
  onRecordClick: () => void;
  onAssetClick: () => void;
  onModelClick: () => void;
  onSendClick: () => void;
  isSendDisabled: boolean;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  canMentionFields?: boolean;
};

// Module-scope icons for reference stability
const UserIcon = <UserMentionIcon />;
const FieldIcon = <FieldMentionIcon />;
const RecordIcon = <RecordMentionIcon />;
const AssetIcon = <AssetMentionIcon />;
const ModelIcon = <ModelMentionIcon />;
const SendIconElement = <SendIcon />;

const ComposerToolbar = ({
  onUserClick,
  onFieldClick,
  onRecordClick,
  onAssetClick,
  onModelClick,
  onSendClick,
  isSendDisabled,
  canMentionAssets = true,
  canMentionModels = true,
  canMentionFields = true,
}: ComposerToolbarProps) => {
  return (
    <div className={styles.composerToolbar}>
      <div className={styles.toolbarMentions}>
        <ToolbarButton
          icon={UserIcon}
          tooltipText="User"
          onClick={onUserClick}
          ariaLabel="Mention user"
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonUser)}
        />

        {canMentionFields && (
          <ToolbarButton
            icon={FieldIcon}
            tooltipText="Field"
            onClick={onFieldClick}
            ariaLabel="Mention field"
            buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonField)}
          />
        )}

        <ToolbarButton
          icon={RecordIcon}
          tooltipText="Record"
          onClick={onRecordClick}
          ariaLabel="Mention record"
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonRecord)}
        />

        <ToolbarButton
          icon={AssetIcon}
          tooltipText={canMentionAssets ? 'Asset' : 'No upload permission'}
          onClick={onAssetClick}
          disabled={!canMentionAssets}
          ariaLabel={canMentionAssets ? 'Mention asset' : 'Asset mentions unavailable - no upload permissions'}
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonAsset)}
        />

        <ToolbarButton
          icon={ModelIcon}
          tooltipText={canMentionModels ? 'Model' : 'No schema access'}
          onClick={onModelClick}
          disabled={!canMentionModels}
          ariaLabel={canMentionModels ? 'Mention model' : 'Model mentions unavailable - no schema access'}
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonModel)}
        />
      </div>

      <span className={styles.toolbarButtonWrapper}>
        <button
          type="button"
          className={styles.sendButton}
          onClick={onSendClick}
          disabled={isSendDisabled}
          aria-label="Send comment"
        >
          {SendIconElement}
        </button>
        <span className={styles.toolbarTooltip}>
          Send
          <span className={styles.toolbarTooltipArrow} />
        </span>
      </span>
    </div>
  );
};

export default ComposerToolbar;

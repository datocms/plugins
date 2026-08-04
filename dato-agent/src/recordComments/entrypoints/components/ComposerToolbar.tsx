import styles from '@styles/commentbar.module.css';
import { cn } from '@/utils/cn';
import {
  AssetMentionIcon,
  FieldMentionIcon,
  ModelMentionIcon,
  RecordMentionIcon,
  SendIcon,
  StopIcon,
  UserMentionIcon,
} from './Icons';
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
  disabled?: boolean;
  isRunning?: boolean;
  onStopClick?: () => void;
};

// Module-scope icons for reference stability
const UserIcon = <UserMentionIcon />;
const FieldIcon = <FieldMentionIcon />;
const RecordIcon = <RecordMentionIcon />;
const AssetIcon = <AssetMentionIcon />;
const ModelIcon = <ModelMentionIcon />;
const SendIconElement = <SendIcon />;
const StopIconElement = <StopIcon />;

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
  disabled = false,
  isRunning = false,
  onStopClick,
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
          disabled={disabled}
        />

        {canMentionFields && (
          <ToolbarButton
            icon={FieldIcon}
            tooltipText="Field"
            onClick={onFieldClick}
            ariaLabel="Mention field"
            buttonClassName={cn(
              styles.toolbarButton,
              styles.toolbarButtonField,
            )}
            disabled={disabled}
          />
        )}

        <ToolbarButton
          icon={RecordIcon}
          tooltipText="Record"
          onClick={onRecordClick}
          ariaLabel="Mention record"
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonRecord)}
          disabled={disabled}
        />

        <ToolbarButton
          icon={AssetIcon}
          tooltipText={canMentionAssets ? 'Asset' : 'No upload permission'}
          onClick={onAssetClick}
          disabled={disabled || !canMentionAssets}
          ariaLabel={
            canMentionAssets
              ? 'Mention asset'
              : 'Asset mentions unavailable - no upload permissions'
          }
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonAsset)}
        />

        <ToolbarButton
          icon={ModelIcon}
          tooltipText={canMentionModels ? 'Model' : 'No schema access'}
          onClick={onModelClick}
          disabled={disabled || !canMentionModels}
          ariaLabel={
            canMentionModels
              ? 'Mention model'
              : 'Model mentions unavailable - no schema access'
          }
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonModel)}
        />
      </div>

      <span className={styles.toolbarButtonWrapper}>
        <button
          type="button"
          className={cn(styles.sendButton, isRunning && styles.stopButton)}
          onClick={isRunning ? onStopClick : onSendClick}
          disabled={isRunning ? !onStopClick : disabled || isSendDisabled}
          aria-label={isRunning ? 'Stop' : 'Send'}
          title={isRunning ? 'Stop' : 'Send'}
        >
          {isRunning ? StopIconElement : SendIconElement}
        </button>
        <span className={styles.toolbarTooltip}>
          {isRunning ? 'Stop' : 'Send'}
          <span className={styles.toolbarTooltipArrow} />
        </span>
      </span>
    </div>
  );
};

export default ComposerToolbar;

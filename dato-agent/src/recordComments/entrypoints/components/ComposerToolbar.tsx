import styles from '@styles/commentbar.module.css';
import { Tooltip, TooltipContent, TooltipTrigger } from 'datocms-react-ui';
import { cn } from '@/utils/cn';
import {
  AssetMentionIcon,
  FieldMentionIcon,
  FileUploadIcon,
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
  onFileClick: () => void;
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
const FileIcon = <FileUploadIcon />;
const ModelIcon = <ModelMentionIcon />;
const SendIconElement = <SendIcon />;
const StopIconElement = <StopIcon />;

const ComposerToolbar = ({
  onUserClick,
  onFieldClick,
  onRecordClick,
  onAssetClick,
  onFileClick,
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

      <div className={styles.toolbarActions}>
        <ToolbarButton
          icon={FileIcon}
          tooltipText="File from computer"
          onClick={onFileClick}
          ariaLabel="Upload files from computer"
          buttonClassName={cn(styles.toolbarButton, styles.toolbarButtonAsset)}
          disabled={disabled}
        />

        <Tooltip placement="top">
          <TooltipTrigger>
            <span className={styles.toolbarTooltipTrigger}>
              <button
                type="button"
                className={cn(
                  styles.sendButton,
                  isRunning && styles.stopButton,
                )}
                onClick={isRunning ? onStopClick : onSendClick}
                disabled={isRunning ? !onStopClick : disabled || isSendDisabled}
                aria-label={isRunning ? 'Stop' : 'Send'}
                title={isRunning ? 'Stop' : 'Send'}
              >
                {isRunning ? StopIconElement : SendIconElement}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{isRunning ? 'Stop' : 'Send'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

export default ComposerToolbar;

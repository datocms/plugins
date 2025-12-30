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
import dashboardStyles from '@styles/dashboard.module.css';
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
  large?: boolean;
  accentColor?: string;
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
  large = false,
  accentColor,
}: ComposerToolbarProps) => {
  const s = large ? dashboardStyles : styles;

  // Use inline style for accent color when provided (for page context where CSS vars may not be available)
  const sendButtonStyle = accentColor ? { backgroundColor: accentColor } : undefined;

  return (
    <div className={s.composerToolbar}>
      <div className={s.toolbarMentions}>
        <ToolbarButton
          icon={UserIcon}
          tooltipText="User"
          onClick={onUserClick}
          ariaLabel="Mention user"
          buttonClassName={cn(s.toolbarButton, styles.toolbarButtonUser)}
        />

        {canMentionFields && (
          <ToolbarButton
            icon={FieldIcon}
            tooltipText="Field"
            onClick={onFieldClick}
            ariaLabel="Mention field"
            buttonClassName={cn(s.toolbarButton, styles.toolbarButtonField)}
          />
        )}

        <ToolbarButton
          icon={RecordIcon}
          tooltipText="Record"
          onClick={onRecordClick}
          ariaLabel="Mention record"
          buttonClassName={cn(s.toolbarButton, styles.toolbarButtonRecord)}
        />

        <ToolbarButton
          icon={AssetIcon}
          tooltipText={canMentionAssets ? 'Asset' : 'No upload permission'}
          onClick={onAssetClick}
          disabled={!canMentionAssets}
          ariaLabel={canMentionAssets ? 'Mention asset' : 'Asset mentions unavailable - no upload permissions'}
          buttonClassName={cn(s.toolbarButton, styles.toolbarButtonAsset)}
        />

        <ToolbarButton
          icon={ModelIcon}
          tooltipText={canMentionModels ? 'Model' : 'No schema access'}
          onClick={onModelClick}
          disabled={!canMentionModels}
          ariaLabel={canMentionModels ? 'Mention model' : 'Model mentions unavailable - no schema access'}
          buttonClassName={cn(s.toolbarButton, styles.toolbarButtonModel)}
        />
      </div>

      <span className={styles.toolbarButtonWrapper}>
        <button
          type="button"
          className={s.sendButton}
          style={sendButtonStyle}
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

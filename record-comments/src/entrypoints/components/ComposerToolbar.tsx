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

/**
 * Pre-created icon elements for ToolbarButton component.
 *
 * PERFORMANCE PATTERN - MODULE-SCOPE JSX ELEMENTS:
 * ------------------------------------------------
 * These icons are intentionally created at module scope rather than inside
 * the component function. This is a deliberate optimization because:
 *
 * 1. STATIC CONTENT: These icons are stateless with no props. They render
 *    identically every time, so creating them once is more efficient than
 *    creating new React elements on every render.
 *
 * 2. REFERENCE STABILITY: Passing the same element reference to ToolbarButton
 *    helps React's reconciliation - it can quickly determine nothing changed.
 *
 * 3. MEMORY EFFICIENCY: One element instance is shared across all ComposerToolbar
 *    instances in the application.
 *
 * This pattern is appropriate ONLY for truly static content. If icons ever
 * needed to accept props (e.g., color, size), they should be moved inside
 * the component or passed as component references rather than elements.
 *
 * References:
 * - React docs on "Extracting Components" (static content can be hoisted)
 * - Kent C. Dodds' "Don't over-optimize" (this is a valid micro-optimization)
 *
 * WHY NOT CONSOLIDATE INTO A FROZEN OBJECT:
 * -----------------------------------------
 * A suggestion was made to consolidate these into a single frozen object like:
 *   const TOOLBAR_ICONS = Object.freeze({ user: <UserMentionIcon />, ... });
 *
 * This was intentionally NOT done because:
 *
 * 1. NO FUNCTIONAL BENEFIT: Both patterns create stable references at module
 *    scope. Object.freeze() adds no value for React element instances.
 *
 * 2. WORSE READABILITY: `TOOLBAR_ICONS.user` is less clear than `UserIcon`
 *    when reading JSX. The current pattern reads naturally: `icon={UserIcon}`.
 *
 * 3. ADDITIONAL OVERHEAD: Object property access adds a (trivial) lookup step.
 *    While negligible, it provides zero benefit to offset it.
 *
 * 4. HARDER TO EXTEND: Adding a new icon with the object pattern requires
 *    adding to both the object AND updating usages. With separate constants,
 *    you just declare a new const and use it.
 *
 * This pattern should NOT be changed unless a concrete benefit is identified.
 * "Consolidation for consistency" is not a sufficient reason when the current
 * approach is clearer and equally performant.
 */
const UserIcon = <UserMentionIcon />;
const FieldIcon = <FieldMentionIcon />;
const RecordIcon = <RecordMentionIcon />;
const AssetIcon = <AssetMentionIcon />;
const ModelIcon = <ModelMentionIcon />;
const SendIconElement = <SendIcon />;

/**
 * Toolbar component for the comment composer
 * Contains mention trigger buttons and send button
 *
 * NOTE ON MEMOIZATION:
 * This component is intentionally NOT memoized with React.memo for the following reasons:
 *
 * 1. SHALLOW PROP COMPARISON COST: All 6 click handlers would need to be memoized by
 *    the parent with useCallback. Currently useToolbarHandlers returns fresh functions
 *    on each render. Memoizing this component would require memoizing all handlers,
 *    adding complexity without guaranteed benefit.
 *
 * 2. MINIMAL RENDER COST: This component renders ~8 DOM elements with simple conditionals.
 *    The render cost is negligible compared to the cost of prop comparison and callback
 *    memoization overhead in the parent.
 *
 * 3. MODULE-SCOPE ICONS: The expensive part (icon JSX creation) is already optimized by
 *    hoisting icons to module scope (see UserIcon, FieldIcon, etc. above).
 *
 * 4. NO HEAVY CHILDREN: Unlike Comment.tsx which has complex nested content, this component
 *    has no children that would benefit from render prevention.
 *
 * If profiling shows this component is a bottleneck (unlikely), the fix would be to:
 * 1. Memoize all handlers in useToolbarHandlers with useCallback
 * 2. Then add React.memo to this component
 *
 * Do not add React.memo without also memoizing the handlers - it would make performance
 * worse by adding prop comparison overhead without preventing any re-renders.
 */
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

/**
 * The API key for the internal model that stores comments.
 * This model is auto-created by the plugin on boot.
 */
export const COMMENTS_MODEL_API_KEY = 'project_comment';

/**
 * Special identifiers for project-wide global comments.
 * These are used to store comments that aren't tied to a specific record.
 */
export const GLOBAL_MODEL_ID = '__global__';
export const GLOBAL_RECORD_ID = '__project__';

/**
 * Mention trigger characters used in the comment composer.
 */
export const MENTION_TRIGGERS = {
  USER: '@',
  FIELD: '#',
  MODEL: '$',
  ASSET: '^',
  RECORD: '&',
} as const;

export const ALL_TRIGGERS = Object.values(MENTION_TRIGGERS);

/**
 * Timing constants for operation queue and sync behavior.
 */
export const TIMING = {
  /** Cooldown after a successful save before allowing subscription sync */
  SYNC_COOLDOWN_MS: 8000,
  /** Base delay for exponential backoff on version conflicts */
  VERSION_CONFLICT_BACKOFF_BASE: 100,
  /** Maximum delay for version conflict retries */
  VERSION_CONFLICT_BACKOFF_MAX: 5000,
  /** Base delay for exponential backoff on network errors */
  NETWORK_ERROR_BACKOFF_BASE: 500,
  /** Maximum delay for network error retries */
  NETWORK_ERROR_BACKOFF_MAX: 10000,
  /** Polling interval for aggregated comments data */
  POLLING_INTERVAL_MS: 30000,
  /** Scroll threshold for auto-scroll behavior */
  SCROLL_THRESHOLD_PX: 100,
  /** Delay before auto-deleting empty comment on blur (allows button clicks to register) */
  COMMENT_BLUR_DELAY_MS: 150,
  /** Duration to highlight a comment after navigating to it */
  HIGHLIGHT_DURATION_MS: 2000,
  /** Small delay for migration UI updates */
  MIGRATION_UI_DELAY_MS: 100,
  /** Maximum retries for network requests */
  MAX_NETWORK_RETRIES: 3,
} as const;

/**
 * Pagination settings for comments lists.
 */
export const COMMENTS_PAGE_SIZE = 30;

/**
 * UI constants for component sizing and display.
 */
export const UI = {
  /** Maximum length for names in mention chips before truncation */
  MENTION_CHIP_MAX_NAME_LENGTH: 8,
} as const;

/**
 * Field API keys for the comments model.
 */
export const COMMENT_FIELDS = {
  MODEL_ID: 'model_id',
  RECORD_ID: 'record_id',
  CONTENT: 'content',
} as const;

/**
 * Plugin UI identifiers.
 */
export const PLUGIN_IDS = {
  SIDEBAR: 'comments',
  PAGE: 'comments-dashboard',
  SETTINGS_PAGE: 'user-profile-settings',
  ICON: 'comment-dots',
  SETTINGS_ICON: 'users-cog',
} as const;

/**
 * User-facing error messages.
 */
export const ERROR_MESSAGES = {
  SAVE_FAILED: 'Failed to save comment. Please refresh and try again.',
  SAVE_RECORD_FIRST: 'Please save the record first before adding comments.',
  ASSET_PICKER_FAILED: 'Failed to open asset picker. Please try again.',
  RECORD_PICKER_FAILED: 'Failed to open record picker. Please try again.',
  COMMENTS_LOAD_FAILED: 'Failed to load comments. Please refresh the page.',
  /** Shown when version conflicts cause retries (collaboration contention) */
  VERSION_CONFLICT_RETRYING: 'Another user edited comments. Retrying...',
  /** Shown when network issues cause retries */
  NETWORK_ERROR_RETRYING: 'Connection issue. Retrying...',
  /** Shown after max retries exceeded (if we implement a limit) */
  MAX_RETRIES_EXCEEDED: 'Unable to save after multiple attempts. Please check your connection and try again.',
  /** Shown when operation times out */
  OPERATION_TIMEOUT: 'Operation timed out after 5 minutes. Please try again.',
  /** Shown when user information is missing for comment creation */
  MISSING_USER_INFO: 'Unable to add comment: user information is missing.',
} as const;

/**
 * Retry limits to prevent infinite retry loops.
 * These limits ensure operations don't retry forever in pathological cases.
 */
export const RETRY_LIMITS = {
  /** Maximum number of retry attempts before terminating */
  MAX_ATTEMPTS: 75,
  /** Maximum duration in milliseconds before terminating (5 minutes) */
  MAX_DURATION_MS: 300000,
} as const;





// Internal model for storing comments (auto-created on plugin boot)
export const COMMENTS_MODEL_API_KEY = 'project_comment';

// Identifiers for project-wide global comments (not tied to a specific record)
export const GLOBAL_MODEL_ID = '__global__';
export const GLOBAL_RECORD_ID = '__project__';

export const MENTION_TRIGGERS = {
  USER: '@',
  FIELD: '#',
  MODEL: '$',
  ASSET: '^',
  RECORD: '&',
} as const;

export const ALL_TRIGGERS = Object.values(MENTION_TRIGGERS);

export const TIMING = {
  SYNC_COOLDOWN_MS: 8000,
  VERSION_CONFLICT_BACKOFF_BASE: 100,
  VERSION_CONFLICT_BACKOFF_MAX: 5000,
  POLLING_INTERVAL_MS: 30000,
  SCROLL_THRESHOLD_PX: 100,
  COMMENT_BLUR_DELAY_MS: 150, // Allows button clicks to register before blur
  HIGHLIGHT_DURATION_MS: 2000,
  MIGRATION_UI_DELAY_MS: 100,
} as const;

export const COMMENTS_PAGE_SIZE = 30;

export const UI = {
  MENTION_CHIP_MAX_NAME_LENGTH: 8,
} as const;

export const COMMENT_FIELDS = {
  MODEL_ID: 'model_id',
  RECORD_ID: 'record_id',
  CONTENT: 'content',
} as const;

export const PLUGIN_IDS = {
  SIDEBAR: 'comments',
  PAGE: 'comments-dashboard',
  ICON: 'comment-dots',
} as const;

export const ERROR_MESSAGES = {
  SAVE_FAILED: 'Failed to save comment. Please refresh and try again.',
  SAVE_RECORD_FIRST: 'Please save the record first before adding comments.',
  ASSET_PICKER_FAILED: 'Failed to open asset picker. Please try again.',
  RECORD_PICKER_FAILED: 'Failed to open record picker. Please try again.',
  COMMENTS_LOAD_FAILED: 'Failed to load comments. Please refresh the page.',
  VERSION_CONFLICT_RETRYING: 'Another user edited comments. Retrying...',
  MAX_RETRIES_EXCEEDED: 'Unable to save after multiple attempts. Please check your connection and try again.',
  OPERATION_TIMEOUT: 'Operation timed out after 2 minutes. Please try again.',
  MISSING_USER_INFO: 'Unable to add comment: user information is missing.',
} as const;

// 15 attempts with exponential backoff (~30s) + 2-minute hard timeout
export const RETRY_LIMITS = {
  MAX_ATTEMPTS: 15,
  MAX_DURATION_MS: 120000,
} as const;





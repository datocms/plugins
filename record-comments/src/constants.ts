// Internal model for storing record comments (auto-created on plugin boot)
export const COMMENTS_MODEL_API_KEY = 'project_comment';

export const TIMING = {
  SYNC_COOLDOWN_MS: 8000,
  VERSION_CONFLICT_BACKOFF_BASE: 100,
  VERSION_CONFLICT_BACKOFF_MAX: 5000,
  POLLING_INTERVAL_MS: 30000,
  COMMENT_BLUR_DELAY_MS: 150, // Allows button clicks to register before blur
  SCROLL_AFTER_REPLY_DELAY_MS: 100, // Wait for React to render new reply before scrolling
  // If tab was hidden for longer than this, refresh subscription when tab becomes visible
  // This prevents stale WebSocket connections in long-running tabs
  VISIBILITY_REFRESH_THRESHOLD_MS: 60000, // 1 minute
} as const;

export const COMMENTS_PAGE_SIZE = 30;

export const UI = {
  MAX_VISIBLE_REPLIER_AVATARS: 3,
} as const;

export const COMMENT_FIELDS = {
  MODEL_ID: 'model_id',
  RECORD_ID: 'record_id',
  CONTENT: 'content',
} as const;

export const PLUGIN_IDS = {
  SIDEBAR: 'comments',
} as const;

export const ERROR_MESSAGES = {
  SAVE_FAILED: "The comment wasn't saved. Reload the page and try again.",
  // A new comment that failed goes back into the composer
  COMMENT_NOT_SENT: "The comment wasn't saved. Click Send to try again.",
  SAVE_RECORD_FIRST: 'Save the record before adding comments.',
  ASSET_PICKER_FAILED: "The asset picker didn't open. Try again.",
  RECORD_PICKER_FAILED: "The record picker didn't open. Try again.",
  COMMENTS_LOAD_FAILED: "The comments didn't load. Reload the page.",
  // Why a save runs again. The sidebar adds that it retries, and how often.
  VERSION_CONFLICT_RETRYING:
    'Someone else saved the comments at the same time.',
  MAX_RETRIES_EXCEEDED:
    "The comment wasn't saved after several attempts. Check your connection and try again.",
  OPERATION_TIMEOUT: 'Saving took more than 2 minutes and stopped. Try again.',
  MISSING_USER_INFO:
    "The comment wasn't added because your user information is missing.",
} as const;

// 15 attempts with exponential backoff (~30s) + 2-minute hard timeout
export const RETRY_LIMITS = {
  MAX_ATTEMPTS: 15,
  MAX_DURATION_MS: 120000,
} as const;

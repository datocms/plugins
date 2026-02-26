export type LambdaConnectionStatus = "connected" | "disconnected";

export type LambdaConnectionPhase =
  | "finish_installation"
  | "config_mount"
  | "config_connect";

export type LambdaConnectionErrorCode =
  | "INVALID_URL"
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP"
  | "INVALID_JSON"
  | "UNEXPECTED_RESPONSE";

export type LambdaConnectionState = {
  status: LambdaConnectionStatus;
  endpoint: string;
  lastCheckedAt: string;
  lastCheckPhase: LambdaConnectionPhase;
  errorCode?: LambdaConnectionErrorCode;
  errorMessage?: string;
  httpStatus?: number;
  responseSnippet?: string;
};

export type ConnectionValidationMode = "health" | "legacy";

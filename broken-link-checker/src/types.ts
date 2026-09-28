export type CheckStatus =
  | 'queued'
  | 'checking'
  | 'reachable'
  | 'broken'
  | 'unverified'
  | 'invalid'
  | 'skipped'
  | 'cancelled'
  /** The site refused the automated check (bot protection, rate limit, sign-in): not a problem with the link. */
  | 'blocked';

/** Why a check ended the way it did, when the status alone doesn't say. */
export type CheckReason =
  | 'bot-protection'
  | 'rate-limited'
  | 'sign-in'
  | 'dns'
  | 'certificate'
  | 'no-response'
  | 'server-error'
  | 'proxy-refused';

export type ContentField = {
  id: string;
  apiKey: string;
  label: string;
  type: string;
  localized: boolean;
  editor: string;
};

export type ContentModel = {
  id: string;
  name: string;
  isBlock: boolean;
  titleFieldId?: string;
  fields: ContentField[];
};

export type ContentSchema = Map<string, ContentModel>;

export type RecordInput = {
  id?: string;
  modelId: string;
  title: string;
  values: Record<string, unknown>;
};

export type LinkOccurrence = {
  id: string;
  recordId?: string;
  recordTitle: string;
  modelId: string;
  modelName: string;
  fieldPath: string;
  fieldLabel: string;
  locale?: string;
  blockPath: string[];
  url: string;
};

export type ExtractionResult = {
  occurrences: LinkOccurrence[];
  warnings: string[];
};

export type PreparedUrl = {
  key: string;
  url: string;
  hostname?: string;
  status: 'queued' | 'invalid' | 'skipped';
  message: string;
};

export type CheckResult = {
  key: string;
  url: string;
  status: CheckStatus;
  message: string;
  httpStatus?: number;
  checkedAt?: string;
  method?: 'HEAD' | 'GET';
  reason?: CheckReason;
};

export type LinkGroup = {
  key: string;
  prepared: PreparedUrl;
  result: CheckResult;
  occurrences: LinkOccurrence[];
  stale: boolean;
};

export type ScanReport = {
  state: 'running' | 'complete' | 'partial' | 'cancelled';
  stale?: boolean;
  startedAt: string;
  finishedAt?: string;
  recordsScanned: number;
  discovering: boolean;
  groups: LinkGroup[];
  warnings: string[];
  scope: string;
};

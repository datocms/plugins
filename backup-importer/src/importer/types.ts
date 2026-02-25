export const SUPPORTED_RECORD_EXPORT_VERSION = '2.1.0';

export type JsonObject = Record<string, unknown>;
export type JsonArray = unknown[];

export type ExportScope = 'bulk' | 'single-record';

export type ConfigurationResourceName =
  | 'site'
  | 'scheduledPublications'
  | 'scheduledUnpublishings'
  | 'fieldsets'
  | 'menuItems'
  | 'schemaMenuItems'
  | 'modelFilters'
  | 'plugins'
  | 'workflows'
  | 'roles'
  | 'webhooks'
  | 'buildTriggers';

export type ConfigurationExportWarning = {
  resource: string;
  message: string;
};

export type ScheduledActionSummary = {
  itemId: string;
  itemTypeId: string | null;
  scheduledAt: string;
  currentVersion: string | null;
};

export type ProjectConfigurationExport = {
  site: JsonObject | null;
  scheduledPublications: ScheduledActionSummary[];
  scheduledUnpublishings: ScheduledActionSummary[];
  fieldsets: JsonObject[];
  menuItems: JsonObject[];
  schemaMenuItems: JsonObject[];
  modelFilters: JsonObject[];
  plugins: JsonObject[];
  workflows: JsonObject[];
  roles: JsonObject[];
  webhooks: JsonObject[];
  buildTriggers: JsonObject[];
  warnings: ConfigurationExportWarning[];
};

export type SchemaFieldSummary = {
  fieldId: string;
  apiKey: string;
  fieldType: string;
  localized: boolean;
};

export type BaseReference = {
  recordSourceId: string;
  sourceBlockId: string | null;
  fieldApiKey: string;
  locale: string | null;
  jsonPath: string;
};

export type RecordReference = BaseReference & {
  targetSourceId: string;
  kind: string;
};

export type UploadReference = BaseReference & {
  targetSourceId: string;
  kind: string;
};

export type StructuredTextReference = BaseReference & {
  targetSourceId: string;
  targetType: 'record' | 'block';
  kind: 'link' | 'block';
};

export type BlockReference = BaseReference & {
  blockSourceId: string;
  blockModelId: string | null;
  parentBlockSourceId: string | null;
  kind: string;
  synthetic: boolean;
};

export type RecordExportEnvelope = {
  manifest: {
    exportVersion: string;
    pluginVersion: string;
    exportedAt: string;
    sourceProjectId: string | null;
    sourceEnvironment: string | null;
    defaultLocale: string | null;
    locales: string[];
    scope: ExportScope;
    filtersUsed: {
      modelIDs?: string[];
      textQuery?: string;
    };
    configurationExport?: {
      includedResources: ConfigurationResourceName[];
      warningCount: number;
    };
  };
  schema: {
    itemTypes: JsonObject[];
    fields: JsonObject[];
    itemTypeIdToApiKey: Record<string, string>;
    fieldIdToApiKey: Record<string, string>;
    fieldsByItemType: Record<string, SchemaFieldSummary[]>;
  };
  projectConfiguration?: ProjectConfigurationExport;
  records: JsonObject[];
  referenceIndex: {
    recordRefs: RecordReference[];
    uploadRefs: UploadReference[];
    structuredTextRefs: StructuredTextReference[];
    blockRefs: BlockReference[];
  };
  assetPackageInfo?: {
    packageVersion: string;
    zipNamingConvention: string;
    zipEntryNamingConvention: string;
    manifestFilename: string;
    chunkingDefaults: {
      maxZipBytes: number;
      maxFilesPerZip: number;
      sizeSafetyFactor: number;
    };
    lastAssetExportSnapshot: unknown;
  };
};

export type ValidationStats = {
  recordCount: number;
  itemTypeCount: number;
  fieldCount: number;
  referenceCounts: {
    recordRefs: number;
    uploadRefs: number;
    structuredTextRefs: number;
    blockRefs: number;
  };
};

export type EnvelopeValidationResult = {
  envelope: RecordExportEnvelope | null;
  errors: string[];
  warnings: string[];
  stats: ValidationStats;
};

export type UnresolvedReferenceKind = 'record' | 'upload' | 'block';

export type UnresolvedReference = {
  kind: UnresolvedReferenceKind;
  sourceId: string;
  path: string;
  reason: string;
};

export type FieldSummaryIndex = Map<string, Map<string, SchemaFieldSummary>>;
export type FieldApiKeyMapByItemType = Map<string, Map<string, string>>;

export type IdMaps = {
  recordIds: Map<string, string>;
  uploadIds: Map<string, string>;
  blockIds: Map<string, string>;
};

export type RewriteResult = {
  rewrittenRecord: JsonObject;
  unresolved: UnresolvedReference[];
};

export type RecordIdentity = {
  sourceRecordId: string;
  sourceItemTypeId: string;
};

export type PreparedRecordBootstrapJob = {
  sourceRecordId: string;
  sourceItemTypeId: string;
  targetItemTypeId: string;
  createPayload: JsonObject;
};

export type PreparedRecordPatchJob = {
  sourceRecordId: string;
  sourceItemTypeId: string;
  targetRecordId: string;
  targetItemTypeId: string;
  patchPayload: JsonObject;
  unresolved: UnresolvedReference[];
};

export type PreflightOptions = {
  strictMode: boolean;
  skipAssetFields?: boolean;
  itemTypeIdMap?: Map<string, string>;
  fieldApiKeyMapByItemType?: FieldApiKeyMapByItemType;
  recordIdMap?: Map<string, string>;
  skipSourceRecordIds?: Set<string>;
  uploadIdMap?: Map<string, string>;
  blockIdMap?: Map<string, string>;
};

export type PreflightReport = {
  ok: boolean;
  strictMode: boolean;
  errors: string[];
  warnings: string[];
  stats: ValidationStats;
  bootstrapJobs: PreparedRecordBootstrapJob[];
  patchJobs: PreparedRecordPatchJob[];
  unresolvedSummary: {
    records: number;
    uploads: number;
    blocks: number;
  };
};

export type ItemTypeMappingIssue = {
  sourceItemTypeId: string;
  sourceApiKey: string | null;
  reason: string;
};

export type ItemTypeMappingReport = {
  itemTypeIdMap: Map<string, string>;
  missing: ItemTypeMappingIssue[];
  warnings: string[];
};

export type FieldMappingIssue = {
  sourceItemTypeId: string;
  sourceItemTypeApiKey: string | null;
  sourceFieldApiKey: string;
  reason: string;
};

export type FieldMappingReport = {
  fieldApiKeyMapByItemType: FieldApiKeyMapByItemType;
  fieldIdMap: Map<string, string>;
  missing: FieldMappingIssue[];
  warnings: string[];
};

export type FieldsetMappingIssue = {
  sourceFieldsetId: string;
  sourceItemTypeId: string | null;
  reason: string;
};

export type FieldsetMappingReport = {
  fieldsetIdMap: Map<string, string>;
  missing: FieldsetMappingIssue[];
  warnings: string[];
};

export type SchemaMappingReport = {
  itemTypes: ItemTypeMappingReport;
  fieldsets: FieldsetMappingReport;
  fields: FieldMappingReport;
  addOnlySkippedByResource?: Record<string, number>;
  createdItemTypeSourceIds?: string[];
};

export type AssetZipManifestEntry = {
  sourceUploadId: string;
  zipEntryName: string;
  originalFilename: string;
  size: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  url: string | null;
  path: string | null;
  metadata: Record<string, unknown>;
};

export type AssetZipManifest = {
  manifestVersion: string;
  generatedAt: string;
  chunk: {
    index: number;
    totalChunks: number;
    filename: string;
    assetCount: number;
    estimatedBytes: number;
  };
  conventions: {
    zipEntryName: string;
    zipFilename: string;
  };
  limits: {
    maxZipBytes: number;
    maxFilesPerZip: number;
    sizeSafetyFactor: number;
  };
  assets: AssetZipManifestEntry[];
};

export type AssetImportFailure = {
  sourceUploadId?: string;
  zipFilename?: string;
  message: string;
};

export type AssetImportReport = {
  ok: boolean;
  strictMode: boolean;
  processedZipFiles: number;
  importedAssets: number;
  skippedAssets: number;
  uploadIdMap: Map<string, string>;
  errors: string[];
  warnings: string[];
  failures: AssetImportFailure[];
};

export type ImportExecutionPhase =
  | 'validate'
  | 'site-baseline'
  | 'schema-skeleton'
  | 'fieldset-import'
  | 'field-import-pass-a'
  | 'field-import-pass-b'
  | 'schema-finalize'
  | 'config-import'
  | 'asset-import'
  | 'preflight'
  | 'validation-window-discovery'
  | 'validation-window-suspend'
  | 'validation-window-restore'
  | 'bootstrap-create'
  | 'patch-update'
  | 'tree-replay'
  | 'publish-replay'
  | 'schedule-replay'
  | 'integration-import'
  | 'verify'
  | 'report-export'
  | 'done';

export type ImportExecutionProgress = {
  phase: ImportExecutionPhase;
  finished: number;
  total: number;
  message: string;
};

export type ImportExecutionOptions = {
  strictMode: boolean;
  skipAssets: boolean;
  skipSchemaImport: boolean;
  skipSiteSettingsImport: boolean;
  skipPluginImport: boolean;
  skipWorkflowImport: boolean;
  skipRoleImport: boolean;
  skipModelFilterImport: boolean;
  skipMenuItemImport: boolean;
  skipSchemaMenuItemImport: boolean;
  skipScheduledActionsImport: boolean;
  skipWebhookImport: boolean;
  skipBuildTriggerImport: boolean;
  addOnlyDifferences: boolean;
  debugLogging: boolean;
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  concurrency: {
    create: number;
    update: number;
    publish: number;
    upload: number;
  };
  publishAfterImport: boolean;
  resumeFromCheckpoint: boolean;
  downloadReportAfterRun: boolean;
  uploadIdMap?: Map<string, string>;
  blockIdMap?: Map<string, string>;
};

export type ImportFailure = {
  sourceRecordId: string;
  targetRecordId?: string;
  message: string;
};

export type ImportExecutionReport = {
  ok: boolean;
  strictMode: boolean;
  addOnlyDifferencesEnabled: boolean;
  validationWindowEnabled: boolean;
  validationFieldsInScope: number;
  validationFieldsSuspended: number;
  validationFieldsRestored: number;
  validationSuspendFailures: number;
  validationRestoreFailures: number;
  validationSuspendFailureFieldIds: string[];
  validationRestoreFailureFieldIds: string[];
  existingRecordMatches: number;
  skippedExistingRecords: number;
  skippedExistingByResource: Record<string, number>;
  errors: string[];
  warnings: string[];
  preflight: PreflightReport | null;
  schemaMapping: SchemaMappingReport | null;
  assetImport: AssetImportReport | null;
  createdCount: number;
  updatedCount: number;
  publishedCount: number;
  treeUpdatedCount: number;
  skippedPatchCount: number;
  createFailures: ImportFailure[];
  updateFailures: ImportFailure[];
  publishFailures: ImportFailure[];
  treeFailures: ImportFailure[];
  unresolvedSummary: {
    records: number;
    uploads: number;
    blocks: number;
  };
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  fieldsetIdMap: Map<string, string>;
  recordIdMap: Map<string, string>;
  uploadIdMap: Map<string, string>;
  resumedFromCheckpoint: boolean;
  checkpointFingerprint: string | null;
};

export type ImportCheckpoint = {
  fingerprint: string;
  strictMode: boolean;
  phase: ImportExecutionPhase;
  savedAt: string;
  itemTypeIdMap?: [string, string][];
  fieldIdMap?: [string, string][];
  fieldsetIdMap?: [string, string][];
  recordIdMap: [string, string][];
  uploadIdMap: [string, string][];
  blockIdMap: [string, string][];
  createdSourceRecordIds: string[];
  updatedSourceRecordIds: string[];
  publishedSourceRecordIds: string[];
  treeUpdatedSourceRecordIds: string[];
};

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

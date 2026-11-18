export type ReplacementIssueKind =
  | 'stale'
  | 'unsupported'
  | 'validation'
  | 'read'
  | 'update';

export type ReplacementChange = {
  id: string;
  rootRecordId: string;
  modelName: string;
  fieldLabel: string;
  locale: string | null;
  replacementCount: number;
  preview: {
    beforeContext: string;
    beforeTruncated: boolean;
    matchedText: string;
    replacementText: string;
    afterContext: string;
    afterTruncated: boolean;
  };
};

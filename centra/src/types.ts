export type CentraReferenceKind = 'primaryProduct' | 'variant' | 'item';

export type CentraCardinality = 'single' | 'multiple';

export type CentraDisplayItemReference = {
  displayItemId: number;
};

export type CentraItemReference = {
  displayItemId: number;
  itemId: string;
};

export type CentraReference =
  | CentraDisplayItemReference
  | CentraItemReference;

export type CentraReferenceDocumentV1 =
  | {
      version: 1;
      kind: 'primaryProduct' | 'variant';
      references: CentraDisplayItemReference[];
    }
  | {
      version: 1;
      kind: 'item';
      references: CentraItemReference[];
    };

export type CentraFieldParametersV1 = {
  paramsVersion: '1';
  kind: CentraReferenceKind;
  cardinality: CentraCardinality;
};

export type CentraConnection = {
  endpoint: string;
  token: string;
};

export type CentraPluginParametersV2 = CentraConnection & {
  paramsVersion: '2';
};

export type PickerModalParameters = {
  fieldParameters: CentraFieldParametersV1;
  references: CentraReference[];
};

export type PickerModalResult = {
  references: CentraReference[];
};

export type errorObject = {
  simplifiedError: {
    code: string;
    details: {
      code: string;
      field: string;
      field_id: string;
      field_label: string;
      field_type: string;
      extraneous_attributes: string[];
      fullPayload: string;
    };
  };
  fullErrorPayload: string;
};

export type automaticBinCleanupObject = {
  numberOfDays: number;
  timeStamp: string;
};

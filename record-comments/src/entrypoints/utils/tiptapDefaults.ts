export const TIPTAP_MENTION_DEFAULTS = {
  field: { localized: false as const },
  model: { isBlockModel: false as const },
} as const;

export const applyFieldMentionDefaults = {
  localized: (value: boolean | undefined | null): boolean =>
    value ?? TIPTAP_MENTION_DEFAULTS.field.localized,
};

export const applyModelMentionDefaults = {
  isBlockModel: (value: boolean | undefined | null): boolean =>
    value ?? TIPTAP_MENTION_DEFAULTS.model.isBlockModel,
};

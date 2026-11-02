/**
 * The texts of the plugin that hold a count, for the `texts` of Canvas: in
 * ICU syntax, thus the count gets its plural and the number separators of
 * the language of the user. A prop that takes a Message gets
 * `{ id, values: { count } }`. A plain React text and the strings for the
 * host (ctx.alert, ctx.notice, ctx.openConfirm) cannot take a Message: they
 * use formatCount.
 */
export const TEXTS = {
  'recordComments.deleteLegacyFieldsDescription':
    'Checks every comment again, then deletes the comment_log field from {count, plural, one {# model} other {# models}} for good.',
} as const satisfies Record<string, string>;

export type TextKey = keyof typeof TEXTS;

/** A Message for a key of the texts of the plugin, with its count */
export function countMessage(id: TextKey, count: number) {
  return { id, values: { count } };
}

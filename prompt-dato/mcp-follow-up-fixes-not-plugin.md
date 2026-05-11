# MCP follow-up fixes, not plugin fixes

This file tracks improvements that belong in the hosted DatoCMS MCP server or its documentation. Do not change the remote MCP server from this plugin task.

## Structured Text typing helpers

- Add reusable DAST helper types or builders in the script sandbox docs/examples.
- Show how to construct mutable DAST node arrays for `paragraph`, `heading`, `list`, `blockquote`, and embedded `block` nodes.
- Warn not to apply `as const` to full DAST node trees, because it can create readonly nested arrays that fail CMA request typing.
- Include an example that avoids literal widening for node `type` values, so TypeScript does not widen values like `"heading"` to `string`.

## Request-aware embedded block payload types

- Generate request-aware Structured Text types for create/update scripts, not only nested-response types.
- Embedded `block` DAST nodes in update payloads need to accept new block request shapes as well as existing nested-response block records.
- The current generated nested-response type can reject valid new block payloads because new records do not yet have response-only properties such as `id` and `meta`.
- Add examples showing how to create an allowed block record and insert the corresponding `block` DAST node into a Structured Text update payload.
- Fix generated field lookup consistency so retrieved record values and field-level type extraction use compatible shapes. For example, if runtime record access supports `record.content`, type extraction patterns should not fail with errors like `Property 'content' does not exist on type 'Post'`.
- Prefer examples that use `buildBlockRecord` from `@datocms/cma-client-node` for new embedded block records:

  ```ts
  import { buildBlockRecord } from '@datocms/cma-client-node';

  const blockModelId = '123';
  const block = buildBlockRecord({
    item_type: { type: 'item_type', id: blockModelId },
    __itemTypeId: blockModelId,
    title: 'Clock Town Panic Button',
  });

  const node = { type: 'block', item: block };
  ```

- Explain that generated `Schema.BlockModel` types represent field maps and should not be used directly as the `item` value of Structured Text `block` DAST nodes.
- Add official fallback examples for scripts where `Schema.*` field extraction fails: local structural request types, `buildBlockRecord`, JSON cloning into recursive JSON request interfaces, `client.items.rawUpdate`, and mandatory nested readback verification.
- The fallback examples must not cast the whole `client`, use explicit `any`/`unknown`, cast through `never`, or rely on `@ts-` directives, because the script validator rejects those patterns.

## Structured Text terminology

- Update MCP examples and docs to distinguish DAST nodes from DatoCMS block records.
- State that `paragraph`, `heading`, `list`, `blockquote`, `code`, and similar entries are DAST nodes.
- State that only `block` DAST nodes represent embedded DatoCMS block records.
- Avoid examples or success messages that call text nodes “blocks”.

## Safe localized Structured Text writes

- Add a complete example for updating one locale of a localized Structured Text field while preserving every other locale key.
- The example should fetch the current record first, preserve existing embedded `block` DAST nodes exactly, mutate only the target locale, run the update, then read back the record for verification.
- Include guidance for preserving ids, relationships, and nested attributes on existing embedded block records.

## Open editor hydration after embedded block writes

- Investigate remote writes that create embedded block records and insert matching Structured Text `block` nodes while the same record is open in the editor.
- Document the exact request/readback shape needed so the editor can resolve the embedded block record immediately after the remote update.
- Add a verification example that confirms every inserted `block` DAST node points to an existing embedded record in the nested readback before reporting success.
- If the editor cannot hydrate newly inserted embedded blocks without a reload, document that limitation clearly in the MCP examples.

## Script failure reporting

- Surface TypeScript compile errors and sandbox runtime failures as structured MCP failures instead of only returning them inside a completed tool-call output.
- Include a short machine-readable failure code plus the compiler/runtime output so clients can distinguish failed script attempts from completed writes and choose the correct recovery path.
- Add examples showing how a client should distinguish a script that ran successfully from a script call that completed transport-wise but failed compilation.

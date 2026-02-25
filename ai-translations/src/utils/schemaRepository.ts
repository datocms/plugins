/**
 * schemaRepository.ts
 * ------------------------------------------------------
 * Utility module for creating and working with DatoCMS SchemaRepository.
 *
 * SchemaRepository provides caching for schema data (models, fields, fieldsets)
 * to prevent redundant API calls during bulk translation operations.
 *
 * @see https://www.datocms.com/docs/content-management-api/using-the-nodejs-clients
 */

import { SchemaRepository } from '@datocms/cma-client-browser';
import type { buildClient } from '@datocms/cma-client-browser';

/**
 * Field metadata shape used by TranslateField.ts for block field lookups.
 */
export type BlockFieldMeta = {
  editor: string;
  id: string;
  localized?: boolean;
  validators?: unknown;
};

/**
 * Field metadata shape used by ItemsDropdownUtils.ts for field type dictionaries.
 * Extends BlockFieldMeta with localization info.
 */
export type FieldTypeDictionaryEntry = BlockFieldMeta & {
  isLocalized: boolean;
};

/**
 * Dictionary mapping field API keys to their metadata.
 */
export type FieldTypeDictionary = Record<string, FieldTypeDictionaryEntry>;

/**
 * Creates a new SchemaRepository instance for the given client.
 *
 * Use this factory function to create a SchemaRepository that can be passed
 * through translation flows. The repository caches all schema lookups,
 * so each unique request is made only once per instance.
 *
 * @param client - DatoCMS CMA client instance.
 * @returns A new SchemaRepository instance.
 *
 * @example
 * ```typescript
 * const client = buildClient({ apiToken, environment });
 * const schemaRepo = createSchemaRepository(client);
 *
 * // Use throughout bulk operations
 * const fields = await getBlockFieldsFromRepo(schemaRepo, blockModelId);
 * ```
 */
export function createSchemaRepository(
  client: ReturnType<typeof buildClient>
): SchemaRepository {
  return new SchemaRepository(client);
}

/**
 * Gets block field metadata from SchemaRepository.
 *
 * Converts the SchemaRepository field data to the shape expected by
 * TranslateField.ts (`{ editor, id }`). Uses cached data when available.
 *
 * @param schemaRepository - SchemaRepository instance with cached data.
 * @param blockModelId - The ID of the block model to get fields for.
 * @returns Dictionary mapping field API keys to editor type and ID.
 */
export async function getBlockFieldsFromRepo(
  schemaRepository: SchemaRepository,
  blockModelId: string
): Promise<Record<string, BlockFieldMeta>> {
  const itemType = await schemaRepository.getItemTypeById(blockModelId);
  const fields = await schemaRepository.getItemTypeFields(itemType);

  return fields.reduce(
    (acc, field) => {
      acc[field.api_key] = {
        editor: field.appearance.editor,
        id: field.id,
        localized: field.localized,
        validators: field.validators,
      };
      return acc;
    },
    {} as Record<string, BlockFieldMeta>
  );
}

/**
 * Builds a field type dictionary from SchemaRepository.
 *
 * Converts the SchemaRepository field data to the FieldTypeDictionary shape
 * expected by ItemsDropdownUtils.ts. Uses cached data when available.
 *
 * @param schemaRepository - SchemaRepository instance with cached data.
 * @param itemTypeId - The ID of the item type to get fields for.
 * @returns FieldTypeDictionary with editor, id, and isLocalized for each field.
 */
export async function buildFieldTypeDictionaryFromRepo(
  schemaRepository: SchemaRepository,
  itemTypeId: string
): Promise<FieldTypeDictionary> {
  const itemType = await schemaRepository.getItemTypeById(itemTypeId);
  const fields = await schemaRepository.getItemTypeFields(itemType);

  return fields.reduce((acc, field) => {
    acc[field.api_key] = {
      editor: field.appearance.editor,
      id: field.id,
      isLocalized: field.localized,
    };
    return acc;
  }, {} as FieldTypeDictionary);
}

// Re-export SchemaRepository type for consumers
export { SchemaRepository };

import type { SchemaTypes } from '@datocms/cma-client';
import { get, set } from 'lodash-es';
import {
  validatorsContainingBlocks,
  validatorsContainingLinks,
} from '@/utils/datocms/schema';

export function collectLinkValidatorPaths(
  fieldType: SchemaTypes.Field['attributes']['field_type'],
): string[] {
  return [
    ...validatorsContainingLinks.filter((i) => i.field_type === fieldType),
    ...validatorsContainingBlocks.filter((i) => i.field_type === fieldType),
  ].map((i) => i.validator);
}

export function filterValidatorIds(
  field: SchemaTypes.Field,
  allowedItemTypeIds: string[],
): NonNullable<SchemaTypes.Field['attributes']['validators']> {
  const validators = (field.attributes.validators ?? {}) as Record<
    string,
    unknown
  >;
  const paths = collectLinkValidatorPaths(field.attributes.field_type);
  for (const path of paths) {
    const ids = (get(validators, path) as string[]) || [];
    const filtered = ids.filter((id) => allowedItemTypeIds.includes(id));
    set(validators, path, filtered);
  }
  return validators as NonNullable<
    SchemaTypes.Field['attributes']['validators']
  >;
}

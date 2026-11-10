import type { FilterSchema } from './types';

// The filters that the CMA accepts on records, and the input of each operator:
// the list that the record list of the dashboard reads to build its filter
// tiles (internal.datocms.com/introspection/field-filters), without the
// deprecated operators and the descriptions.
export const FILTER_SCHEMA: FilterSchema = {
  meta: {
    _created_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    id: {
      eq: { type: 'scalar', inputType: 'item_id' },
      neq: { type: 'scalar', inputType: 'item_id' },
      in: { type: 'scalar', inputType: 'item_id', array: true },
      not_in: { type: 'scalar', inputType: 'item_id', array: true },
    },
    _first_published_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    parent: {
      eq: { type: 'scalar', inputType: 'item_id' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    position: {
      gt: { type: 'scalar', inputType: 'integer' },
      lt: { type: 'scalar', inputType: 'integer' },
      gte: { type: 'scalar', inputType: 'integer' },
      lte: { type: 'scalar', inputType: 'integer' },
      eq: { type: 'scalar', inputType: 'integer' },
      neq: { type: 'scalar', inputType: 'integer' },
    },
    _publication_scheduled_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    _unpublishing_scheduled_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    _published_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    _status: {
      eq: {
        type: 'scalar',
        inputType: 'enum',
        values: ['draft', 'updated', 'published'],
      },
      neq: {
        type: 'scalar',
        inputType: 'enum',
        values: ['draft', 'updated', 'published'],
      },
      in: {
        type: 'scalar',
        inputType: 'enum',
        array: true,
        values: ['draft', 'updated', 'published'],
      },
      not_in: {
        type: 'scalar',
        inputType: 'enum',
        array: true,
        values: ['draft', 'updated', 'published'],
      },
    },
    _updated_at: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    _is_valid: {
      eq: { type: 'scalar', inputType: 'boolean' },
    },
    _creator: {
      eq: {
        type: 'object',
        arguments: {
          type: {
            type: 'scalar',
            inputType: 'enum',
            values: [
              'user',
              'account',
              'organization',
              'sso_user',
              'access_token',
            ],
          },
          id: { type: 'scalar', inputType: 'string' },
        },
      },
      neq: {
        type: 'object',
        arguments: {
          type: {
            type: 'scalar',
            inputType: 'enum',
            values: [
              'user',
              'account',
              'organization',
              'sso_user',
              'access_token',
            ],
          },
          id: { type: 'scalar', inputType: 'string' },
        },
      },
      in: {
        type: 'object',
        arguments: {
          type: {
            type: 'scalar',
            inputType: 'enum',
            values: [
              'user',
              'account',
              'organization',
              'sso_user',
              'access_token',
            ],
          },
          id: { type: 'scalar', inputType: 'string' },
        },
        array: true,
      },
      not_in: {
        type: 'object',
        arguments: {
          type: {
            type: 'scalar',
            inputType: 'enum',
            values: [
              'user',
              'account',
              'organization',
              'sso_user',
              'access_token',
            ],
          },
          id: { type: 'scalar', inputType: 'string' },
        },
        array: true,
      },
    },
  },
  fieldTypes: {
    boolean: {
      eq: { type: 'scalar', inputType: 'boolean' },
    },
    color: {
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    date: {
      gt: { type: 'scalar', inputType: 'date' },
      lt: { type: 'scalar', inputType: 'date' },
      gte: { type: 'scalar', inputType: 'date' },
      lte: { type: 'scalar', inputType: 'date' },
      exists: { type: 'scalar', inputType: 'boolean' },
      eq: { type: 'scalar', inputType: 'date' },
      neq: { type: 'scalar', inputType: 'date' },
    },
    date_time: {
      gt: { type: 'scalar', inputType: 'date_time' },
      lt: { type: 'scalar', inputType: 'date_time' },
      gte: { type: 'scalar', inputType: 'date_time' },
      lte: { type: 'scalar', inputType: 'date_time' },
      eq: { type: 'scalar', inputType: 'date_time' },
      neq: { type: 'scalar', inputType: 'date_time' },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    file: {
      eq: { type: 'scalar', inputType: 'upload_id' },
      neq: { type: 'scalar', inputType: 'upload_id' },
      in: { type: 'scalar', inputType: 'upload_id', array: true },
      not_in: { type: 'scalar', inputType: 'upload_id', array: true },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    float: {
      gt: { type: 'scalar', inputType: 'float' },
      lt: { type: 'scalar', inputType: 'float' },
      gte: { type: 'scalar', inputType: 'float' },
      lte: { type: 'scalar', inputType: 'float' },
      exists: { type: 'scalar', inputType: 'boolean' },
      eq: { type: 'scalar', inputType: 'float' },
      neq: { type: 'scalar', inputType: 'float' },
    },
    gallery: {
      eq: { type: 'scalar', inputType: 'upload_id', array: true },
      all_in: { type: 'scalar', inputType: 'upload_id', array: true },
      any_in: { type: 'scalar', inputType: 'upload_id', array: true },
      not_in: { type: 'scalar', inputType: 'upload_id', array: true },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    integer: {
      gt: { type: 'scalar', inputType: 'integer' },
      lt: { type: 'scalar', inputType: 'integer' },
      gte: { type: 'scalar', inputType: 'integer' },
      lte: { type: 'scalar', inputType: 'integer' },
      exists: { type: 'scalar', inputType: 'boolean' },
      eq: { type: 'scalar', inputType: 'integer' },
      neq: { type: 'scalar', inputType: 'integer' },
    },
    json: {
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    lat_lon: {
      near: {
        type: 'object',
        arguments: {
          latitude: { type: 'scalar', inputType: 'float' },
          longitude: { type: 'scalar', inputType: 'float' },
          radius: { type: 'scalar', inputType: 'float' },
        },
      },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    link: {
      eq: { type: 'scalar', inputType: 'item_id' },
      neq: { type: 'scalar', inputType: 'item_id' },
      in: { type: 'scalar', inputType: 'item_id', array: true },
      not_in: { type: 'scalar', inputType: 'item_id', array: true },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    links: {
      eq: { type: 'scalar', inputType: 'item_id', array: true },
      all_in: { type: 'scalar', inputType: 'item_id', array: true },
      any_in: { type: 'scalar', inputType: 'item_id', array: true },
      not_in: { type: 'scalar', inputType: 'item_id', array: true },
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    seo: {
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    slug: {
      eq: { type: 'scalar', inputType: 'string' },
      neq: { type: 'scalar', inputType: 'string' },
      in: { type: 'scalar', inputType: 'string', array: true },
      not_in: { type: 'scalar', inputType: 'string', array: true },
    },
    string: {
      matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      not_matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      is_blank: { type: 'scalar', inputType: 'boolean' },
      is_present: { type: 'scalar', inputType: 'boolean' },
      eq: { type: 'scalar', inputType: 'string' },
      neq: { type: 'scalar', inputType: 'string' },
      in: { type: 'scalar', inputType: 'string', array: true },
      not_in: { type: 'scalar', inputType: 'string', array: true },
    },
    text: {
      matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      not_matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      is_blank: { type: 'scalar', inputType: 'boolean' },
      is_present: { type: 'scalar', inputType: 'boolean' },
    },
    video: {
      exists: { type: 'scalar', inputType: 'boolean' },
    },
    structured_text: {
      matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      not_matches: {
        type: 'object',
        arguments: {
          pattern: { type: 'scalar', inputType: 'string' },
          case_sensitive: { type: 'scalar', inputType: 'boolean' },
          regexp: { type: 'scalar', inputType: 'boolean' },
        },
      },
      is_blank: { type: 'scalar', inputType: 'boolean' },
      is_present: { type: 'scalar', inputType: 'boolean' },
    },
  },
};

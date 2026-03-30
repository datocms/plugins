# Tree-like Slugs

Automatically propagate hierarchical slugs through parent-child records in DatoCMS.

When you update a parent record's slug, all descendant records (children, grandchildren, etc.) automatically inherit the updated path prefix.

## Example

**Before updating the grandparent's slug:**

```
Grandparent: /grandparent
  └── Parent: /parent
        └── Child: /child
```

**After updating the grandparent's slug to `/grandparent-new`:**

```
Grandparent: /grandparent-new
  └── Parent: /grandparent-new/parent
        └── Child: /grandparent-new/parent/child
```

## Setup

1. Install the plugin from the DatoCMS marketplace
2. Ensure your model uses **Hierarchical sorting** as its default ordering
3. On your slug field, **disable** the "Match a specific pattern" validation (required to allow `/` characters)
4. Add this plugin as a field addon to your slug field

## Known Limitations

- **Reset button**: Clicking the reset/refresh button on the slug field will reset it to the default value, losing the hierarchical path.
- **Moving records**: Dragging a record to a new parent in the tree does not automatically update the slug. To fix this, manually edit and save the new parent record's slug.

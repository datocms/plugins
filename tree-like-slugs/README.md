# Tree-like Slugs (for models with Hierarchical Sorting)

A plugin that makes it so the slugs in models with Hierarchical Sorting (formerly "Tree-like Collections") are passed down to the child records upon the parent's update.

Add it to the slug field you want as a field addon. The model must be one that has its "Default ordering" set to "Hierarchical sorting" (formerly called "Tree-like collection").

IMPORTANT: The slug field must have the "Match a specific pattern" validation DISABLED! Otherwise the plugin won't be able to insert '/' in the slug.

From then on, whenever you update a parent record's slug, all of its descendents (children, grandchildren, etc.) will have their slugs updated as well.

Before:
* Grandparent: /grandparent
  * Parent: /parent
    * Child: /child

With the plugin, after updating the Grandparent record:
* Grandparent: /grandparent-new
  * Parent: /grandparent-new/parent
    *  Child: /grandparent-new/parent/child

## Changelog
- 0.3.1: Dependency updates and bug fixes. Migrated to newer plugin SDK version.
- 0.3.0: Previous release
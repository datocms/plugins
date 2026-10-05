# Tree-like Slugs

Keeps slugs hierarchical in tree-sorted models. When you change a parent record's slug, every descendant (children, grandchildren and so on) gets the new path prefix.

## Example

Before updating the grandparent's slug:

```
Grandparent: /grandparent
  └── Parent: /parent
        └── Child: /child
```

After changing it to `/grandparent-new`:

```
Grandparent: /grandparent-new
  └── Parent: /grandparent-new/parent
        └── Child: /grandparent-new/parent/child
```

## Setup

1. Install the plugin from the DatoCMS marketplace.
2. Make sure your model uses **Hierarchical sorting** as its default ordering.
3. On your slug field, disable the "Match a specific pattern" validation so slugs can contain `/`.
4. Add this plugin as a field addon to your slug field.

## Limitations

Clicking the reset button on the slug field resets it to the default value and loses the hierarchical path.

Dragging a record to a new parent in the tree doesn't update its slug. To fix it, edit and save the new parent's slug.

Descendants are updated before DatoCMS validates the parent's save. If updating a descendant fails, the parent isn't saved, but descendants that were already updated stay updated. If the parent save fails for another reason (a validation error, or another plugin blocking it), its descendants may already carry the new slug.

If a descendant has no slug in a locale, that branch keeps its current slugs in that locale.

Very large trees can take hours to update. Keep the browser tab open until the save finishes.

## Development

```sh
npm install
npm run dev
npm run check
```

/**
 * Tree-like Slugs Plugin
 *
 * Propagates hierarchical slugs through parent-child record relationships.
 * When a parent record's slug changes, all descendants automatically inherit
 * the updated path prefix.
 */
import { connect, type RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import SlugExtension from './entrypoints/SlugExtension';
import beforeItemUpsert from './utils/beforeItemUpsert';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  /** Registers the field addon for slug fields */
  manualFieldExtensions() {
    return [
      {
        id: 'treeLikeSlugs',
        name: 'Tree-like slugs',
        type: 'addon',
        fieldTypes: ['slug'],
      },
    ];
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      case 'treeLikeSlugs':
        return render(<SlugExtension ctx={ctx} />);
    }
  },
  onBeforeItemUpsert: beforeItemUpsert,
});

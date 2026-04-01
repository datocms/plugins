import {
  connect,
  type DropdownAction,
  type ExecuteFieldDropdownActionCtx,
} from 'datocms-plugin-sdk';
import { getValueByPath } from './getValueByPath.ts';

// Can be anything. We just use this to store data to the browser's session storage.
const SESSION_KEY = 'datocms-plugin-copy-links';

async function handleCopyLinks(
  currentValue: string | string[] | undefined,
  fieldLabel: string,
  ctx: ExecuteFieldDropdownActionCtx,
): Promise<void> {
  // Exit early if nothing to copy
  if (!currentValue?.length) {
    await ctx.alert(`Nothing to copy. Field "${fieldLabel}" is empty.`);
    return;
  }

  // Wrap in try block just in case anything goes wrong with sessionStorage or anything else
  try {
    const stringified = currentValue.toString(); // Becomes comma-separated IDs
    sessionStorage.setItem(SESSION_KEY, stringified);
    const numberOfIds = stringified.split(',').length; // Length after split
    await ctx.notice(`Copied ${numberOfIds} link(s).`);
  } catch (e) {
    await ctx.alert(
      `Error copying link(s): ${e instanceof Error ? e.message : e}`,
    );
  }
}

async function handlePasteIntoSingleLinkField(
  fieldPath: string,
  ctx: ExecuteFieldDropdownActionCtx,
): Promise<void> {
  try {
    const maybeLink = sessionStorage.getItem(SESSION_KEY);

    // Exit early if empty
    if (!maybeLink) {
      throw new Error('There was nothing to paste.');
    }

    // Try to split it by commas
    const arrayified = maybeLink.split(',');

    // If it's single-element array, go ahead and paste it
    if (arrayified.length === 1) {
      await ctx.setFieldValue(fieldPath, arrayified[0]);
      await ctx.notice('Pasted 1 link.');
      return;
    }

    // If the split string has more than one element, error out
    throw new Error(
      'You cannot paste multiple links into a single-link field.',
    );
  } catch (e) {
    await ctx.alert(
      `Error pasting link: ${e instanceof Error ? e.message : e}`,
    );
  }
}

async function handlePasteIntoMultiLinkField(
  fieldPath: string,
  currentValue: string | string[] | undefined,
  ctx: ExecuteFieldDropdownActionCtx,
): Promise<void> {
  try {
    const maybeLinks = sessionStorage.getItem(SESSION_KEY);

    // Exit early if empty
    if (!maybeLinks) {
      await ctx.alert('There was nothing to paste.');
      return;
    }

    if (!maybeLinks.length) {
      throw new Error('Unable to paste links; not sure why');
    }

    // Split it by comma and paste it.
    // Single IDs become a single-element array of that ID
    // Multiple IDs become properly split by comma
    const linksAsArray = maybeLinks.split(',');
    const currentAndNewLinks = [...(currentValue ?? []), ...linksAsArray];
    const uniqueLinks = Array.from(new Set(currentAndNewLinks));

    console.log('uniqueLinks', uniqueLinks);
    console.log('currentValue', uniqueLinks);

    // Test to see if it's the same as what's already in the field
    const allLinksAlreadyPresent =
      currentValue &&
      currentValue.length === uniqueLinks.length &&
      JSON.stringify(uniqueLinks) === JSON.stringify(currentValue);

    if (allLinksAlreadyPresent) {
      await ctx.notice(
        'No new links pasted. Field already has all the copied links.',
      );
      return;
    }

    await ctx.setFieldValue(fieldPath, uniqueLinks);
    await ctx.notice(
      `Pasted ${uniqueLinks.length - (currentValue?.length ?? 0)} new link(s).`,
    );
  } catch (e) {
    console.error('Error pasting link(s)', e);
    await ctx.alert(
      `Error pasting link(s): ${e instanceof Error ? e.message : e}`,
    );
  }
}

connect({
  // This is what defines our  context menu
  // See https://www.datocms.com/docs/plugin-sdk/dropdown-actions
  fieldDropdownActions(field) {
    // We need to differentiate between single-link fields (strings) and multi-link fields (arrays)
    switch (field.attributes.field_type) {
      // Single-link fields
      case 'link': {
        const singleLinkActions: DropdownAction[] = [
          {
            id: 'copySingleLink',
            label: 'Copy link',
            icon: 'clipboard',
          },
          {
            id: 'pasteIntoSingleLinkField',
            label: 'Paste link',
            icon: 'paste',
          },
        ];

        return singleLinkActions;
      }

      // Multi-link fields
      case 'links': {
        const multiLinkActions: DropdownAction[] = [
          {
            id: 'copyMultiLinks',
            label: 'Copy links',
            icon: 'clipboard-list',
          },
          {
            id: 'pasteIntoMultiLinkField',
            label: 'Paste link(s)',
            icon: 'paste',
          },
        ];

        return multiLinkActions;
      }

      // Ignore other field types
      default:
        return [];
    }
  },
  async executeFieldDropdownAction(actionId, ctx) {
    const { formValues, fieldPath, field } = ctx;
    // We need to normalize the fieldPath in the case of fields nested in blocks
    const currentValue = getValueByPath<string | string[]>(
      formValues,
      fieldPath,
    );

    switch (actionId) {
      case 'copySingleLink':
      case 'copyMultiLinks':
        await handleCopyLinks(currentValue, field.attributes.label, ctx);
        break;

      case 'pasteIntoSingleLinkField':
        await handlePasteIntoSingleLinkField(fieldPath, ctx);
        break;

      case 'pasteIntoMultiLinkField':
        await handlePasteIntoMultiLinkField(fieldPath, currentValue, ctx);
        break;
    }
  },
});

import {
  connect,
  type DropdownAction,
  type ExecuteFieldDropdownActionCtx,
} from 'datocms-plugin-sdk';
import { getValueByPath } from './getValueByPath.ts';

// Can be anything. We just use this to store data to the browser's session storage.
const SESSION_KEY = 'datocms-plugin-copy-links';

const linkCount = (count: number) =>
  count === 1 ? '1 link' : `${count} links`;

async function handleCopyLinks(
  currentValue: string | string[] | undefined,
  fieldLabel: string,
  ctx: ExecuteFieldDropdownActionCtx,
): Promise<void> {
  // Exit early if nothing to copy
  if (!currentValue?.length) {
    await ctx.alert(`Nothing to copy. “${fieldLabel}” is empty.`);
    return;
  }

  // Wrap in try block just in case anything goes wrong with sessionStorage or anything else
  try {
    const stringified = currentValue.toString(); // Becomes comma-separated IDs
    sessionStorage.setItem(SESSION_KEY, stringified);
    const numberOfIds = stringified.split(',').length; // Length after split
    await ctx.notice(`Copied ${linkCount(numberOfIds)}.`);
  } catch (e) {
    await ctx.alert(`Could not copy: ${e instanceof Error ? e.message : e}`);
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
      await ctx.alert('Nothing to paste. Copy a link first.');
      return;
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
    await ctx.alert(
      `Cannot paste ${linkCount(arrayified.length)} into a single-link field.`,
    );
  } catch (e) {
    await ctx.alert(`Could not paste: ${e instanceof Error ? e.message : e}`);
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
      await ctx.alert('Nothing to paste. Copy links first.');
      return;
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
      await ctx.notice('This field already has all the copied links.');
      return;
    }

    await ctx.setFieldValue(fieldPath, uniqueLinks);
    await ctx.notice(
      `Pasted ${linkCount(uniqueLinks.length - (currentValue?.length ?? 0))}.`,
    );
  } catch (e) {
    console.error('Error pasting link(s)', e);
    await ctx.alert(`Could not paste: ${e instanceof Error ? e.message : e}`);
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
            icon: 'clipboard-paste',
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
            label: 'Paste links',
            icon: 'clipboard-paste',
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

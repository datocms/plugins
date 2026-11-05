import { type IconComponent, STARTER_ICONS } from '../icons';

export type Starter = {
  /** The text that the starter puts in the composer, without sending it */
  prompt: string;
  title: string;
  hint: string;
  icon: IconComponent;
  /** It asks for changes: a provider that can only read can't do it */
  changesRecord?: boolean;
};

/**
 * The requests that an empty chat offers to start with. They fit a record of
 * any model, thus they name no field.
 */
export const STARTERS: readonly Starter[] = [
  {
    prompt: 'Summarize this record in a few short bullet points.',
    title: 'Summarize this record',
    hint: 'The main points in a few lines',
    icon: STARTER_ICONS.bullets,
  },
  {
    prompt:
      'Check the spelling and grammar of every text field of this record.',
    title: 'Check spelling and grammar',
    hint: 'In every text field',
    icon: STARTER_ICONS.check,
  },
  {
    prompt: 'Suggest clearer and shorter wording for the texts of this record.',
    title: 'Improve the wording',
    hint: 'Clearer and shorter',
    icon: STARTER_ICONS.edit,
  },
  {
    prompt:
      'Fill the empty fields of this record from the rest of its content.',
    title: 'Fill the empty fields',
    hint: 'From the rest of the record',
    icon: STARTER_ICONS.sparkle,
    changesRecord: true,
  },
];

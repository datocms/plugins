import { type IconComponent, STARTER_ICONS } from '../icons';

export type Starter = {
  /** The text that the starter puts in the composer, without sending it */
  prompt: string;
  title: string;
  hint: string;
  icon: IconComponent;
};

/** The requests that an empty chat offers to start with */
export const STARTERS: readonly Starter[] = [
  {
    prompt: 'Write a compelling excerpt from the body of this record.',
    title: 'Generate an excerpt',
    hint: 'From the body',
    icon: STARTER_ICONS.edit,
  },
  {
    prompt: 'Rewrite the title so it is more engaging and under 60 characters.',
    title: 'Improve the title',
    hint: 'For SEO and click-through',
    icon: STARTER_ICONS.title,
  },
  {
    prompt: 'Summarize the body into 5 bullet points.',
    title: 'Summarize in bullets',
    hint: 'Five key takeaways',
    icon: STARTER_ICONS.bullets,
  },
  {
    prompt: 'Prepare this record for publish.',
    title: 'Prepare for publishing',
    hint: 'Fill the meta, slug and excerpt',
    icon: STARTER_ICONS.check,
  },
];

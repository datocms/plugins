import EntityRow from 'datocms-react-ui/EntityRow';
import type { ReactNode } from 'react';

type MentionDropdownOptionContentProps = {
  /** The picture of the entity (an avatar), in the slot of the row */
  image?: ReactNode;
  /** The name of the option, on one line with an ellipsis */
  title: string;
  /** After the title, on the same line: an API key, a pill */
  afterTitle?: ReactNode;
  /** A second line in the subtle ink: an email, a description */
  details?: ReactNode;
};

/**
 * The text of an option of a mention menu. The menu option draws the
 * surface, the highlight and the glyph; the entity row (the row layout of a
 * menu option) lays out the picture, the title, what follows it and its
 * details, each only when given.
 */
export function MentionDropdownOptionContent({
  image,
  title,
  afterTitle,
  details,
}: MentionDropdownOptionContentProps) {
  return (
    <EntityRow afterTitle={afterTitle} image={image} layout="row" title={title}>
      {details}
    </EntityRow>
  );
}

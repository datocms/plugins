import {
  Image,
  RectangleHorizontal,
  RectangleVertical,
  Square,
} from 'lucide-react';

// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).

/** A generated image: the same picture as the asset source icon */
export const ImageIcon = Image;

/** The 1:1 image ratio */
export const SquareRatioIcon = Square;

/** The 2:3 image ratio */
export const PortraitRatioIcon = RectangleVertical;

/** The 3:2 image ratio */
export const LandscapeRatioIcon = RectangleHorizontal;

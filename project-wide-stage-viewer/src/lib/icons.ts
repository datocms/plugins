import {
  faBell,
  faBookmark,
  faCalendarCheck,
  faCircleCheck,
  faCirclePause,
  faCircleQuestion,
  faCircleXmark,
  faClipboard,
  faClock,
  faComments,
  faEye,
  faFileLines,
  faFlag,
  faFolderOpen,
  faHand,
  faHourglassHalf,
  faLightbulb,
  faNewspaper,
  faNoteSticky,
  faPaperPlane,
  faPenToSquare,
  faRectangleList,
  faSquareCheck,
  faStar,
  faThumbsUp,
  faUser,
} from '@fortawesome/free-regular-svg-icons';
import {
  faInbox,
  faLanguage,
  faListCheck,
  faMagnifyingGlass,
  faRocket,
  faSpellCheck,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

/**
 * Icons offered for sidebar entries. The host draws them from Font Awesome 6
 * Regular; the previews use the free Regular glyph when there is one and the
 * Solid one otherwise.
 */
const ICONS: IconDefinition[] = [
  faListCheck,
  faRectangleList,
  faInbox,
  faPenToSquare,
  faSpellCheck,
  faLanguage,
  faEye,
  faMagnifyingGlass,
  faComments,
  faClipboard,
  faFileLines,
  faNewspaper,
  faNoteSticky,
  faLightbulb,
  faClock,
  faHourglassHalf,
  faCirclePause,
  faHand,
  faCircleQuestion,
  faCircleXmark,
  faFlag,
  faBell,
  faUser,
  faThumbsUp,
  faCircleCheck,
  faSquareCheck,
  faCalendarCheck,
  faPaperPlane,
  faRocket,
  faStar,
  faBookmark,
  faFolderOpen,
];

export const ICON_OPTIONS = ICONS.map((icon) => ({
  value: icon.iconName as string,
  icon,
}));

export function iconByName(name: string): IconDefinition | undefined {
  return ICONS.find((icon) => icon.iconName === name);
}

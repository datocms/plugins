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
 * Icons offered for sidebar entries, with an everyday name for the select.
 * The host draws them from Font Awesome 6 Regular; the previews use the free
 * Regular glyph when there is one and the Solid one otherwise.
 */
const ICONS: { icon: IconDefinition; label: string }[] = [
  { icon: faListCheck, label: 'Checklist' },
  { icon: faRectangleList, label: 'List' },
  { icon: faInbox, label: 'Inbox' },
  { icon: faPenToSquare, label: 'Edit' },
  { icon: faSpellCheck, label: 'Spelling' },
  { icon: faLanguage, label: 'Language' },
  { icon: faEye, label: 'Eye' },
  { icon: faMagnifyingGlass, label: 'Search' },
  { icon: faComments, label: 'Comments' },
  { icon: faClipboard, label: 'Clipboard' },
  { icon: faFileLines, label: 'Document' },
  { icon: faNewspaper, label: 'Newspaper' },
  { icon: faNoteSticky, label: 'Note' },
  { icon: faLightbulb, label: 'Idea' },
  { icon: faClock, label: 'Clock' },
  { icon: faHourglassHalf, label: 'Hourglass' },
  { icon: faCirclePause, label: 'Pause' },
  { icon: faHand, label: 'Hand' },
  { icon: faCircleQuestion, label: 'Question' },
  { icon: faCircleXmark, label: 'Cross' },
  { icon: faFlag, label: 'Flag' },
  { icon: faBell, label: 'Bell' },
  { icon: faUser, label: 'Person' },
  { icon: faThumbsUp, label: 'Thumbs up' },
  { icon: faCircleCheck, label: 'Check' },
  { icon: faSquareCheck, label: 'Checkbox' },
  { icon: faCalendarCheck, label: 'Calendar' },
  { icon: faPaperPlane, label: 'Paper plane' },
  { icon: faRocket, label: 'Rocket' },
  { icon: faStar, label: 'Star' },
  { icon: faBookmark, label: 'Bookmark' },
  { icon: faFolderOpen, label: 'Folder' },
];

/** The options of the select: the stored value is the Font Awesome name */
export const ICON_OPTIONS = ICONS.map(({ icon, label }) => ({
  value: icon.iconName as string,
  label,
  icon,
}));

export function iconByName(name: string): IconDefinition | undefined {
  return ICONS.find(({ icon }) => icon.iconName === name)?.icon;
}

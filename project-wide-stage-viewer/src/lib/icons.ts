import type { LucideIconIdentifier } from 'datocms-plugin-sdk';
import {
  Bell,
  Bookmark,
  CalendarCheck,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleQuestionMark,
  CircleX,
  Clipboard,
  Clock,
  Eye,
  FileText,
  Flag,
  FolderOpen,
  Hand,
  Hourglass,
  Inbox,
  Languages,
  Lightbulb,
  List,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  Newspaper,
  Rocket,
  Search,
  Send,
  SpellCheck,
  SquareCheck,
  SquarePen,
  Star,
  StickyNote,
  TextAlignStart,
  Thermometer,
  ThumbsUp,
  User,
  Workflow,
  Wrench,
} from 'lucide-react';

/** The Lucide glyph of a stored icon name: its identifier for the host, its component for the previews. */
export type StageIcon = { id: LucideIconIdentifier; icon: LucideIcon };

/**
 * Icons offered for sidebar entries, with an everyday name for the select.
 * The settings store the Font Awesome 6 name that earlier versions stored
 * (`value`), so saved entries keep their icon; the host and the previews
 * draw the Lucide glyph that means the same thing.
 */
const ICONS: (StageIcon & { value: string; label: string })[] = [
  {
    value: 'list-check',
    id: 'list-checks',
    icon: ListChecks,
    label: 'Checklist',
  },
  { value: 'rectangle-list', id: 'list', icon: List, label: 'List' },
  { value: 'inbox', id: 'inbox', icon: Inbox, label: 'Inbox' },
  { value: 'pen-to-square', id: 'square-pen', icon: SquarePen, label: 'Edit' },
  {
    value: 'spell-check',
    id: 'spell-check',
    icon: SpellCheck,
    label: 'Spelling',
  },
  { value: 'language', id: 'languages', icon: Languages, label: 'Language' },
  { value: 'eye', id: 'eye', icon: Eye, label: 'Eye' },
  { value: 'magnifying-glass', id: 'search', icon: Search, label: 'Search' },
  {
    value: 'comments',
    id: 'messages-square',
    icon: MessagesSquare,
    label: 'Comments',
  },
  { value: 'clipboard', id: 'clipboard', icon: Clipboard, label: 'Clipboard' },
  { value: 'file-lines', id: 'file-text', icon: FileText, label: 'Document' },
  { value: 'newspaper', id: 'newspaper', icon: Newspaper, label: 'Newspaper' },
  { value: 'note-sticky', id: 'sticky-note', icon: StickyNote, label: 'Note' },
  { value: 'lightbulb', id: 'lightbulb', icon: Lightbulb, label: 'Idea' },
  { value: 'clock', id: 'clock', icon: Clock, label: 'Clock' },
  {
    value: 'hourglass-half',
    id: 'hourglass',
    icon: Hourglass,
    label: 'Hourglass',
  },
  {
    value: 'circle-pause',
    id: 'circle-pause',
    icon: CirclePause,
    label: 'Pause',
  },
  { value: 'hand', id: 'hand', icon: Hand, label: 'Hand' },
  {
    value: 'circle-question',
    id: 'circle-question-mark',
    icon: CircleQuestionMark,
    label: 'Question',
  },
  { value: 'circle-xmark', id: 'circle-x', icon: CircleX, label: 'Cross' },
  { value: 'flag', id: 'flag', icon: Flag, label: 'Flag' },
  { value: 'bell', id: 'bell', icon: Bell, label: 'Bell' },
  { value: 'user', id: 'user', icon: User, label: 'Person' },
  { value: 'thumbs-up', id: 'thumbs-up', icon: ThumbsUp, label: 'Thumbs up' },
  {
    value: 'circle-check',
    id: 'circle-check',
    icon: CircleCheck,
    label: 'Check',
  },
  {
    value: 'square-check',
    id: 'square-check',
    icon: SquareCheck,
    label: 'Checkbox',
  },
  {
    value: 'calendar-check',
    id: 'calendar-check',
    icon: CalendarCheck,
    label: 'Calendar',
  },
  { value: 'paper-plane', id: 'send', icon: Send, label: 'Paper plane' },
  { value: 'rocket', id: 'rocket', icon: Rocket, label: 'Rocket' },
  { value: 'star', id: 'star', icon: Star, label: 'Star' },
  { value: 'bookmark', id: 'bookmark', icon: Bookmark, label: 'Bookmark' },
  {
    value: 'folder-open',
    id: 'folder-open',
    icon: FolderOpen,
    label: 'Folder',
  },
];

/**
 * Font Awesome 6 names that the first settings screen offered (see
 * FA5_ICON_RENAMES in parameters.ts) and the select no longer does: saved
 * entries keep a glyph that means the same thing.
 */
const LEGACY_ICONS: Record<string, StageIcon> = {
  'circle-play': { id: 'circle-play', icon: CirclePlay },
  'diagram-project': { id: 'workflow', icon: Workflow },
  'bars-staggered': { id: 'text-align-start', icon: TextAlignStart },
  'temperature-half': { id: 'thermometer', icon: Thermometer },
  'screwdriver-wrench': { id: 'wrench', icon: Wrench },
};

/** The options of the select: the stored value is the Font Awesome name */
export const ICON_OPTIONS = ICONS.map(({ value, label, icon }) => ({
  value,
  label,
  icon,
}));

/** The glyph of a stored icon name, or undefined for a name the plugin doesn't know */
export function iconByName(name: string): StageIcon | undefined {
  return ICONS.find(({ value }) => value === name) ?? LEGACY_ICONS[name];
}

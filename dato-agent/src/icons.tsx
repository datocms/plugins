import {
  BotMessageSquare,
  Box,
  ChevronLeft,
  Copy,
  File,
  FileText,
  Hash,
  History,
  Image,
  Paperclip,
  Plus,
  RotateCw,
  Send,
  Square,
  TriangleAlert,
  User,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';

// The icons of the plugin, from Lucide. Like every icon that a component of
// datocms-react-ui takes, each one is an svg that takes the props of an svg.
// Like the icons of the CMS, it is 1em of the text (see the LucideProvider in
// utils/render.tsx): a button or a pill shows it at that size, and a place
// with a size of its own (a blank slate) sets it in CSS.

/** Adds something: a new chat */
export const AddIcon = Plus;

/** The past chats */
export const HistoryIcon = History;

/** Auto-approve: changes run without asking */
export const BoltIcon = Zap;

/** Auto-approve is off: the bolt with a slash through it */
export const BoltOffIcon = ZapOff;

/** Sends the message */
export const SendIcon = Send;

/** Stops the running turn */
export const StopIcon = Square;

/** Tries a failed request again */
export const RetryIcon = RotateCw;

/** Copies a value */
export const CopyIcon = Copy;

/** A problem or a risk */
export const WarningIcon = TriangleAlert;

/** The agent, its entity icon: the glyph of its navigation tab */
export const ChatIcon = BotMessageSquare;

/** A collaborator of the project */
export const UserIcon = User;

/** A field of a model */
export const FieldIcon = Hash;

/** A record */
export const RecordIcon = FileText;

/** An asset of the media area */
export const AssetIcon = Image;

/** A model or a block model */
export const ModelIcon = Box;

/** Attaches files from the computer */
export const AttachIcon = Paperclip;

/** A file from the computer, not an asset yet */
export const FileIcon = File;

/** Closes, dismisses, clears or unlinks; never deletes */
export const CloseIcon = X;

/** Goes back */
export const ChevronLeftIcon = ChevronLeft;

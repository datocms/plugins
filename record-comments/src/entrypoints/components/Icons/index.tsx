import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  EllipsisVertical,
  FileText,
  Hash,
  Image,
  LayoutGrid,
  MessageSquare,
  Pencil,
  RefreshCw,
  Reply,
  Send,
  ThumbsUp,
  Trash2,
  User,
} from 'lucide-react';

// The icons of the plugin, from Lucide. They are drawn at 1em, the size of
// the text around them (see the LucideProvider in utils/render.tsx), and a kit
// button sizes them through its font size.

export const MoreVerticalIcon = EllipsisVertical;

export const UpvoteIcon = ThumbsUp;

export const ReplyIcon = Reply;

export const EditIcon = Pencil;

export const DeleteIcon = Trash2;

export const UserMentionIcon = User;

export const FieldMentionIcon = Hash;

export const RecordMentionIcon = FileText;

export const AssetMentionIcon = Image;

export const ModelMentionIcon = LayoutGrid;

export const SendIcon = Send;

export const ChevronLeftIcon = ChevronLeft;

export const ChevronRightIcon = ChevronRight;

export const CircleExclamationIcon = CircleAlert;

export const RefreshIcon = RefreshCw;

/** The entity icon of the plugin: a speech bubble */
export const CommentsIcon = MessageSquare;

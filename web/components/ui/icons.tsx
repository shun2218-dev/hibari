/**
 * アプリで使うアイコン。lucide を直接 import せずここを経由し、線の太さと aria-hidden をそろえる。
 *
 * デザインのアイコンは lucide と同じ 24 グリッドの線画で、線はやや細い（1.75）。
 * 大きさは呼び出し側で `size-4` などの spacing トークンで指定する。
 * アイコンだけのボタンは、ボタン側に aria-label を付ける（アイコン自体は読み上げない）。
 */
import {
  AppWindow,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Code,
  Download,
  Ellipsis,
  File,
  Hash,
  Italic,
  Link,
  List,
  ListOrdered,
  Lock,
  LogOut,
  type LucideIcon,
  type LucideProps,
  Mail,
  Megaphone,
  MessagesSquare,
  Pencil,
  Monitor,
  Paperclip,
  Plus,
  Reply,
  RotateCw,
  Search,
  SendHorizontal,
  Settings,
  Smartphone,
  SmilePlus,
  SquareCode,
  Strikethrough,
  TextQuote,
  Trash2,
  Underline,
  UserMinus,
  Users,
  X,
  Eye,
  EyeOff,
} from "lucide-react";

function withDefaults(Icon: LucideIcon) {
  function AppIcon(props: LucideProps) {
    return <Icon aria-hidden strokeWidth={1.75} {...props} />;
  }
  AppIcon.displayName = Icon.displayName;
  return AppIcon;
}

export const BrowserIcon = withDefaults(AppWindow);
export const CheckIcon = withDefaults(Check);
export const ChevronDownIcon = withDefaults(ChevronDown);
export const ChevronLeftIcon = withDefaults(ChevronLeft);
export const ChevronRightIcon = withDefaults(ChevronRight);
export const AlertIcon = withDefaults(CircleAlert);
export const CheckCircleIcon = withDefaults(CircleCheck);
export const ClockIcon = withDefaults(Clock);
export const DownloadIcon = withDefaults(Download);
export const MoreIcon = withDefaults(Ellipsis);
export const FileIcon = withDefaults(File);
export const HashIcon = withDefaults(Hash);
export const LockIcon = withDefaults(Lock);
export const MailIcon = withDefaults(Mail);
export const ThreadIcon = withDefaults(MessagesSquare);
export const MonitorIcon = withDefaults(Monitor);
export const PaperclipIcon = withDefaults(Paperclip);
export const PlusIcon = withDefaults(Plus);
export const ReplyIcon = withDefaults(Reply);
export const SearchIcon = withDefaults(Search);
export const SettingsIcon = withDefaults(Settings);
export const PhoneIcon = withDefaults(Smartphone);
export const SmilePlusIcon = withDefaults(SmilePlus);
export const TrashIcon = withDefaults(Trash2);
export const UsersIcon = withDefaults(Users);
export const CloseIcon = withDefaults(X);
export const EyeIcon = withDefaults(Eye);
export const EyeOffIcon = withDefaults(EyeOff);

// ---- 入力欄の書式のツールバー（ADR 0052） ----
export const BoldIcon = withDefaults(Bold);
export const ItalicIcon = withDefaults(Italic);
export const UnderlineIcon = withDefaults(Underline);
export const StrikethroughIcon = withDefaults(Strikethrough);
export const LinkIcon = withDefaults(Link);
export const CodeIcon = withDefaults(Code);
export const CodeBlockIcon = withDefaults(SquareCode);
export const QuoteIcon = withDefaults(TextQuote);
export const OrderedListIcon = withDefaults(ListOrdered);
export const BulletListIcon = withDefaults(List);
/** `@channel` / `@here` の補完の印（Slack と同じメガホン）。 */
export const MegaphoneIcon = withDefaults(Megaphone);
/** 送信のボタン。 */
export const SendIcon = withDefaults(SendHorizontal);

// ---- メニューとボタンの操作（Slack のメニューと同じく、文字の前にアイコンを置く） ----
export const CopyIcon = withDefaults(Copy);
export const LogOutIcon = withDefaults(LogOut);
export const PencilIcon = withDefaults(Pencil);
export const RetryIcon = withDefaults(RotateCw);
export const UserMinusIcon = withDefaults(UserMinus);

/**
 * アプリで使うアイコン。lucide を直接 import せずここを経由し、線の太さと aria-hidden をそろえる。
 *
 * デザインのアイコンは lucide と同じ 24 グリッドの線画で、線はやや細い（1.75）。
 * 大きさは呼び出し側で `size-4` などの spacing トークンで指定する。
 * アイコンだけのボタンは、ボタン側に aria-label を付ける（アイコン自体は読み上げない）。
 */
import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Ellipsis,
  File,
  Hash,
  Lock,
  type LucideIcon,
  type LucideProps,
  Mail,
  Monitor,
  Paperclip,
  Plus,
  Reply,
  Search,
  Smartphone,
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
export const MoreIcon = withDefaults(Ellipsis);
export const FileIcon = withDefaults(File);
export const HashIcon = withDefaults(Hash);
export const LockIcon = withDefaults(Lock);
export const MailIcon = withDefaults(Mail);
export const MonitorIcon = withDefaults(Monitor);
export const PaperclipIcon = withDefaults(Paperclip);
export const PlusIcon = withDefaults(Plus);
export const ReplyIcon = withDefaults(Reply);
export const SearchIcon = withDefaults(Search);
export const PhoneIcon = withDefaults(Smartphone);
export const UsersIcon = withDefaults(Users);
export const CloseIcon = withDefaults(X);
export const EyeIcon = withDefaults(Eye);
export const EyeOffIcon = withDefaults(EyeOff);

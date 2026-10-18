import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  BrowserIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  MoreIcon,
  FileIcon,
  HashIcon,
  LockIcon,
  MailIcon,
  ThreadIcon,
  MonitorIcon,
  PaperclipIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  PhoneIcon,
  SmilePlusIcon,
  TrashIcon,
  UsersIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
} from "./icons";

/**
 * アプリで使うアイコン。lucide を直接 import せずここを経由し、線の太さ（1.75）と `aria-hidden` をそろえる。
 * 大きさは呼び出し側で `size-4` などの spacing トークンで指定する。
 */
const meta = {
  title: "components/ui/Icons",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const icons = [
        { name: "BrowserIcon", Icon: BrowserIcon },
        { name: "CheckIcon", Icon: CheckIcon },
        { name: "ChevronDownIcon", Icon: ChevronDownIcon },
        { name: "ChevronLeftIcon", Icon: ChevronLeftIcon },
        { name: "ChevronRightIcon", Icon: ChevronRightIcon },
        { name: "AlertIcon", Icon: AlertIcon },
        { name: "CheckCircleIcon", Icon: CheckCircleIcon },
        { name: "ClockIcon", Icon: ClockIcon },
        { name: "DownloadIcon", Icon: DownloadIcon },
        { name: "MoreIcon", Icon: MoreIcon },
        { name: "FileIcon", Icon: FileIcon },
        { name: "HashIcon", Icon: HashIcon },
        { name: "LockIcon", Icon: LockIcon },
        { name: "MailIcon", Icon: MailIcon },
        { name: "ThreadIcon", Icon: ThreadIcon },
        { name: "MonitorIcon", Icon: MonitorIcon },
        { name: "PaperclipIcon", Icon: PaperclipIcon },
        { name: "PlusIcon", Icon: PlusIcon },
        { name: "ReplyIcon", Icon: ReplyIcon },
        { name: "SearchIcon", Icon: SearchIcon },
        { name: "SettingsIcon", Icon: SettingsIcon },
        { name: "PhoneIcon", Icon: PhoneIcon },
        { name: "SmilePlusIcon", Icon: SmilePlusIcon },
        { name: "TrashIcon", Icon: TrashIcon },
        { name: "UsersIcon", Icon: UsersIcon },
        { name: "CloseIcon", Icon: CloseIcon },
        { name: "EyeIcon", Icon: EyeIcon },
        { name: "EyeOffIcon", Icon: EyeOffIcon },
] as const;

export const All: Story = {
  name: "一覧",
  render: () => (
    <div className="grid grid-cols-6 gap-4">
      {icons.map(({ name, Icon }) => (
        <div key={name} className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface p-3">
          <Icon className="size-5 text-text" />
          <span className="text-2xs break-all text-text-muted">{name.replace("Icon", "")}</span>
        </div>
      ))}
    </div>
  ),
};

/** 大きさは spacing トークンで決める（アイコンだけのボタンは、ボタン側に aria-label を付ける）。 */
export const Sizes: Story = {
  name: "大きさ",
  render: () => (
    <div className="flex items-end gap-4 text-text">
      <HashIcon className="size-3.5" />
      <HashIcon className="size-4" />
      <HashIcon className="size-5" />
      <HashIcon className="size-6" />
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ConnectionBanner } from "./connection-banner";

/**
 * WebSocket の状態を知らせる帯（ADR 0026）。**「いま起きていること」なので琥珀**にする（`docs/ui/tokens.md`）。
 * `null` のときは何も出さない（つながっているのが普通の状態なので、何も言わない）。
 */
const meta = {
  title: "components/chat/ConnectionBanner",
  component: ConnectionBanner,
  tags: ["autodocs"],
  args: { status: "reconnecting" },
  argTypes: { status: { control: "inline-radio", options: [null, "reconnecting", "syncing", "restored"] } },
  decorators: [(Story) => <div className="w-150">{Story()}</div>],
} satisfies Meta<typeof ConnectionBanner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Reconnecting: Story = { name: "再接続中" };

export const Syncing: Story = { name: "同期中（after_seq の差分取得）", args: { status: "syncing" } };

export const Restored: Story = { name: "復帰した", args: { status: "restored" } };

export const None: Story = { name: "つながっている（何も出さない）", args: { status: null } };

export const All: Story = {
  name: "状態の一覧",
  render: () => (
    <div className="flex flex-col gap-2">
      <ConnectionBanner status="reconnecting" />
      <ConnectionBanner status="syncing" />
      <ConnectionBanner status="restored" />
    </div>
  ),
};

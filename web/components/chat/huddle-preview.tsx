import type { ComponentType } from "react";

import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HashIcon,
  HeadphonesIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  SpeakerIcon,
  VideoIcon,
  VideoOffIcon,
} from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

import type { HuddlePreviewView, MediaDeviceView } from "./types";

/**
 * 参加する前のプレビュー（ADR 0066 追記 B）。ハドルのタブ（モバイルは同じタブの全画面）に最初に出す。
 *
 * Slack と同じく、自分のタイル・マイクのオンとオフ・マイクとスピーカーの選択・「キャンセル」「開始（参加）」を並べる。
 * マイクの許可はこの画面で求めるので、許可されない・マイクがないときもここで知らせ、開始を押せなくする。
 *
 * カメラ（ADR 0068 決定 1）: マイクの横にオンとオフ、機器の選択を足す。既定はオフで、オンにしたときにカメラの許可を求める。
 * カメラを使えなくても、音声だけで入れるので開始は押せる。
 */
export function HuddlePreview({
  preview,
  openMenu,
  onToggleMenu,
  onToggleMic,
  onToggleCamera,
  onSelectMic,
  onSelectSpeaker,
  onSelectCamera,
  onCancel,
  onStart,
  onJoinRoom,
}: {
  preview: HuddlePreviewView;
  /** 参加していない public のチャンネル（`blocked: "not-member"`）で、先にチャンネルに参加する（ADR 0067 決定 1）。 */
  onJoinRoom?: () => void;
  /** 開いている機器の選択（story 用に外から開ける）。 */
  openMenu?: "mic" | "speaker" | "camera";
  onToggleMenu?: (menu: "mic" | "speaker" | "camera") => void;
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
  onSelectMic?: (id: string) => void;
  onSelectSpeaker?: (id: string) => void;
  onSelectCamera?: (id: string) => void;
  onCancel?: () => void;
  onStart?: () => void;
}) {
  const { room, self, problem } = preview;
  // 「を開始する」と「に参加する」で助詞が変わるので、句ごと持つ
  const action = preview.action === "start" ? "ハドルミーティングを開始する" : "ハドルミーティングに参加する";
  const micUsable = problem === undefined;
  const { blocked, cameras, cameraProblem } = preview;
  const cameraOn = (preview.cameraOn ?? false) && cameraProblem === undefined;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-8">
      <section
        aria-labelledby="huddle-preview-title"
        className="w-full max-w-120 rounded-lg border border-border bg-surface shadow-overlay"
      >
        <h1 id="huddle-preview-title" className="flex items-center justify-center gap-1 border-b border-border px-4 py-3 text-sm text-text">
          <RoomLabel room={room} />
          <span className="shrink-0 text-text-secondary">で{action}</span>
        </h1>

        <div className="flex flex-col items-center gap-5 px-6 pt-6 pb-6">
          <div
            className={cx(
              "relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-surface-muted",
              // カメラを使えるプレビューは映像に合わせて横長にする（6.18a の音声だけの画面は正方形のまま）
              cameras ? "h-60 max-w-100" : "aspect-square max-w-60",
            )}
          >
            {cameraOn && preview.video ? (
              // 自分の映像は鏡と同じく左右を反転して映す（送る映像は反転しない）
              <div className="absolute inset-0 -scale-x-100 *:size-full *:object-cover">{preview.video}</div>
            ) : (
              <Avatar id={self.id} name={self.name} imageUrl={self.avatarUrl} size="xl" />
            )}
            <div className="absolute bottom-3 flex gap-2">
              <button
                type="button"
                onClick={onToggleMic}
                disabled={!micUsable}
                aria-pressed={!preview.micOn}
                aria-label={preview.micOn ? "マイクをオフにする" : "マイクをオンにする"}
                className={cx(
                  "flex size-10 items-center justify-center rounded-full border disabled:border-border disabled:bg-surface-muted disabled:text-text-muted",
                  preview.micOn ? "border-border bg-surface text-text-secondary hover:bg-surface-muted" : "border-primary bg-primary-subtle text-primary",
                )}
              >
                {preview.micOn && micUsable ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
              </button>
              {cameras && (
                <button
                  type="button"
                  onClick={onToggleCamera}
                  disabled={cameraProblem !== undefined}
                  aria-pressed={cameraOn}
                  aria-label={cameraOn ? "カメラをオフにする" : "カメラをオンにする"}
                  className={cx(
                    "flex size-10 items-center justify-center rounded-full border disabled:border-border disabled:bg-surface-muted disabled:text-text-muted",
                    cameraOn ? "border-primary bg-primary-subtle text-primary" : "border-border bg-surface text-text-secondary hover:bg-surface-muted",
                  )}
                >
                  {cameraOn ? <VideoIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
                </button>
              )}
            </div>
          </div>

          {/* ハドルのリンクから開いたが、そのままでは入れない（ADR 0067 決定 1）。マイクの問題より先に知らせる */}
          {blocked === "not-member" && (
            <Alert tone="locked" className="w-full">
              このチャンネルに参加すると、ハドルミーティングに参加できます。
            </Alert>
          )}
          {blocked === "archived" && (
            <Alert tone="locked" className="w-full">
              このチャンネルはアーカイブされているため、ハドルミーティングは開始できません。
            </Alert>
          )}
          {problem && !blocked && (
            <Alert tone="danger" className="w-full">
              {problem === "mic-denied"
                ? "ブラウザがマイクの使用を許可していません。アドレスバーのサイトの設定でマイクを許可してから、もう一度開いてください。"
                : "マイクが見つかりません。マイクをつないでから、もう一度開いてください。"}
            </Alert>
          )}
          {cameraProblem && !blocked && (
            // カメラを使えなくても音声だけで入れるので、止めずに知らせるだけ
            <Alert tone="locked" className="w-full">
              {cameraProblem === "camera-denied"
                ? "ブラウザがカメラの使用を許可していません。カメラを使うには、アドレスバーのサイトの設定でカメラを許可してください。"
                : "カメラが見つかりません。音声だけで参加できます。"}
            </Alert>
          )}

          <div className="flex w-full flex-wrap justify-center gap-2">
            <DeviceSelect
              icon={MicIcon}
              label="マイク"
              devices={preview.mics}
              selectedId={preview.micId}
              disabled={!micUsable}
              open={openMenu === "mic"}
              onToggle={() => onToggleMenu?.("mic")}
              onSelect={onSelectMic}
            />
            {preview.speakers && (
              <DeviceSelect
                icon={SpeakerIcon}
                label="スピーカー"
                devices={preview.speakers}
                selectedId={preview.speakerId}
                open={openMenu === "speaker"}
                onToggle={() => onToggleMenu?.("speaker")}
                onSelect={onSelectSpeaker}
              />
            )}
            {cameras && (
              <DeviceSelect
                icon={VideoIcon}
                label="カメラ"
                devices={cameras}
                selectedId={preview.cameraId}
                disabled={cameraProblem !== undefined}
                open={openMenu === "camera"}
                onToggle={() => onToggleMenu?.("camera")}
                onSelect={onSelectCamera}
              />
            )}
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onCancel}>
          <CloseIcon className="size-4" />
          キャンセル
        </Button>
        {blocked === "not-member" ? (
          <Button onClick={onJoinRoom}>チャンネルに参加する</Button>
        ) : (
          <Button onClick={onStart} disabled={!micUsable || blocked === "archived"}>
            <HeadphonesIcon className="size-4" />
            {action}
          </Button>
        )}
      </div>
    </main>
  );
}

function RoomLabel({ room }: { room: HuddlePreviewView["room"] }) {
  return (
    <span className="flex min-w-0 items-center gap-0.5 font-semibold">
      {room.kind === "public" && <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      <span className="truncate">{room.name}</span>
    </span>
  );
}

/**
 * 機器の選択。Slack と同じくアイコンと機器の名前（長ければ切る）のボタンで、押すと候補が開く。
 * 候補はブラウザが返す機器の名前（`MediaDeviceInfo.label`）をそのまま出す。
 */
function DeviceSelect({
  icon: Icon,
  label,
  devices,
  selectedId,
  disabled = false,
  open,
  onToggle,
  onSelect,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  devices: MediaDeviceView[];
  selectedId?: string;
  disabled?: boolean;
  open: boolean;
  onToggle?: () => void;
  onSelect?: (id: string) => void;
}) {
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${label}: ${selected?.label ?? "なし"}`}
        className="flex h-9 max-w-52 items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 text-sm text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-text-muted"
      >
        <Icon className="size-4 shrink-0 text-text-secondary" />
        <span className="truncate">{selected?.label ?? "なし"}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-text-secondary" />
      </button>
      {open && (
        <Popover
          label={`${label}を選ぶ`}
          onDismiss={onToggle}
          className="top-full left-0 mt-1 w-72"
        >
          <DeviceOptions label={label} devices={devices} selectedId={selected?.id} onSelect={onSelect} />
        </Popover>
      )}
    </div>
  );
}

/**
 * ハドルの画面の下の列の「⌄」で開く、マイクとスピーカーの選択（Slack と同じくマイクのボタンの横から開く）。
 * 参加した後に機器を替えるための入口。選んだものは端末ごとに覚える（追記 B）。
 */
export function HuddleDeviceMenu({
  mics,
  micId,
  speakers,
  speakerId,
  onSelectMic,
  onSelectSpeaker,
  onDismiss,
}: {
  mics: MediaDeviceView[];
  micId?: string;
  speakers?: MediaDeviceView[];
  speakerId?: string;
  onSelectMic?: (id: string) => void;
  onSelectSpeaker?: (id: string) => void;
  onDismiss?: () => void;
}) {
  return (
    <Popover label="マイクとスピーカーを選ぶ" onDismiss={onDismiss} className="bottom-full left-0 mb-2 w-72">
      <DeviceOptions label="マイク" devices={mics} selectedId={micId ?? mics[0]?.id} onSelect={onSelectMic} />
      {speakers && (
        <div className="mt-1 border-t border-border pt-1">
          <DeviceOptions label="スピーカー" devices={speakers} selectedId={speakerId ?? speakers[0]?.id} onSelect={onSelectSpeaker} />
        </div>
      )}
    </Popover>
  );
}

/** ハドルの画面の下の列のカメラの横の「⌄」で開く、カメラの選択（ADR 0068）。マイクの選択と同じ形。 */
export function HuddleCameraMenu({
  cameras,
  cameraId,
  onSelectCamera,
  onDismiss,
}: {
  cameras: MediaDeviceView[];
  cameraId?: string;
  onSelectCamera?: (id: string) => void;
  onDismiss?: () => void;
}) {
  return (
    <Popover label="カメラを選ぶ" onDismiss={onDismiss} className="bottom-full left-0 mb-2 w-72">
      <DeviceOptions label="カメラ" devices={cameras} selectedId={cameraId ?? cameras[0]?.id} onSelect={onSelectCamera} />
    </Popover>
  );
}

function DeviceOptions({
  label,
  devices,
  selectedId,
  onSelect,
}: {
  label: string;
  devices: MediaDeviceView[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      <p className="px-2.5 pt-1 pb-1.5 text-2xs font-medium text-text-secondary">{label}</p>
      <ul role="menu" aria-label={label}>
        {devices.map((device) => (
          <li key={device.id} role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={device.id === selectedId}
              onClick={() => onSelect?.(device.id)}
              className="flex h-9.5 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
            >
              <span aria-hidden className="flex w-4 shrink-0 justify-center text-primary">
                {device.id === selectedId && <CheckIcon className="size-4" />}
              </span>
              <span className="truncate">{device.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

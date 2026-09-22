import { RadioCard } from "@/components/ui/choice";

export type Theme = "light" | "dark";

export type Density = "comfortable" | "compact";

export function AppearanceSettings({
  theme,
  density,
  densityLocked = false,
  onThemeChange,
  onDensityChange,
}: {
  theme: Theme;
  density: Density;
  /** 密度を選べなくする。行送りと余白の値がデザインにないため（docs/ui/README.md の未解決）。 */
  densityLocked?: boolean;
  onThemeChange?: (theme: Theme) => void;
  onDensityChange?: (density: Density) => void;
}) {
  return (
    <div className="flex max-w-100 flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs text-text-secondary">テーマ</legend>
        <RadioCard
          name="theme"
          value="light"
          checked={theme === "light"}
          onChange={() => onThemeChange?.("light")}
          title="ライト"
          description="明るい背景。日中の作業向け"
        />
        <RadioCard
          name="theme"
          value="dark"
          checked={theme === "dark"}
          onChange={() => onThemeChange?.("dark")}
          title="ダーク"
          description="暗い背景。夜間や長時間の常時表示向け"
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs text-text-secondary">表示の密度</legend>
        <RadioCard
          name="density"
          value="comfortable"
          checked={density === "comfortable"}
          onChange={() => onDensityChange?.("comfortable")}
          disabled={densityLocked}
          title="ゆったり"
          description="行送り 1.75。長時間でも読み疲れしにくい"
        />
        <RadioCard
          name="density"
          value="compact"
          checked={density === "compact"}
          onChange={() => onDensityChange?.("compact")}
          disabled={densityLocked}
          title="詰める"
          description="1画面により多くの発言が入る"
        />
      </fieldset>
    </div>
  );
}

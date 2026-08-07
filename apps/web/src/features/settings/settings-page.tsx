import { RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, PageShell } from "@/components/rack/page-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { LOCALES, useI18n } from "@/lib/i18n";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TERMINAL_FONTS,
  resolveTheme,
  terminalFontFamily,
  usePreferences,
  type TerminalFont,
  type Theme,
} from "@/stores/preferences";
import { useWorkspace } from "@/stores/workspace";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "settings.theme.system" },
  { value: "dark", label: "settings.theme.dark" },
  { value: "light", label: "settings.theme.light" },
  { value: "hc", label: "settings.theme.hc" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-[var(--radius-panel)] border border-line bg-panel p-4"
    >
      <h2 id={id} className="silkscreen mb-3 text-ink3">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-ink">{label}</Label>
        {hint ? <p className="mt-0.5 text-xs text-ink3">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Range({
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-4 w-36 accent-[var(--accent)]"
        aria-valuetext={`${value}${unit ?? ""}`}
      />
      <span className="readout w-14 text-right text-xs text-ink2">
        {value}
        {unit ?? ""}
      </span>
    </div>
  );
}

/** Local preferences: appearance, terminal, security info, workspace. */
export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { preferences, set } = usePreferences();
  const workspace = useWorkspace();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <PageShell>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Section id="appearance" title={t("settings.appearance")}>
          <Row
            label={t("settings.theme")}
            control={
              <Select
                value={preferences.theme}
                onValueChange={(value) => set({ theme: value as Theme })}
              >
                <SelectTrigger className="w-44" aria-label={t("settings.theme")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEMES.map((theme) => (
                    <SelectItem key={theme.value} value={theme.value}>
                      {t(theme.label as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <Row
            label={t("settings.language")}
            control={
              <Select
                value={locale}
                onValueChange={(value) => setLocale(value as (typeof LOCALES)[number]["value"])}
              >
                <SelectTrigger className="w-44" aria-label={t("settings.language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </Section>

        <Section id="terminal" title={t("settings.terminal")}>
          <Row
            label={t("settings.font")}
            hint={t("settings.fontHint")}
            control={
              <Select
                value={preferences.font}
                onValueChange={(value) => set({ font: value as TerminalFont })}
              >
                <SelectTrigger className="w-44" aria-label={t("settings.font")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERMINAL_FONTS.map((font) => (
                    <SelectItem key={font.value} value={font.value}>
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <div
            className="flex items-center justify-between rounded-[var(--radius-control)] border border-line bg-panel2 px-3 py-2"
            style={{ fontFamily: terminalFontFamily(preferences.font) }}
          >
            <span className="text-xs text-ink3">{t("settings.nerdPreview")}</span>
            <span className="text-base text-ink">{"\ue0a0  \uf489  \u{f062c}"}</span>
          </div>
          <Row
            label={t("settings.fontSize")}
            control={
              <Range
                value={preferences.fontSize}
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                onChange={(fontSize) => set({ fontSize })}
              />
            }
          />
          <Row
            label={t("settings.lineHeight")}
            control={
              <Range
                value={preferences.lineHeight}
                min={100}
                max={160}
                step={5}
                onChange={(value) => set({ lineHeight: value / 100 })}
              />
            }
          />
          <Row
            label={t("settings.scrollback")}
            hint={t("settings.scrollbackUnit")}
            control={
              <Select
                value={String(preferences.scrollback)}
                onValueChange={(value) => set({ scrollback: Number(value) })}
              >
                <SelectTrigger className="w-44" aria-label={t("settings.scrollback")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1000, 5000, 10_000, 50_000, 100_000].map((rows) => (
                    <SelectItem key={rows} value={String(rows)}>
                      {rows.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <Row
            label={t("settings.bellVisual")}
            control={
              <Switch
                checked={preferences.bellVisual}
                onCheckedChange={(bellVisual) => set({ bellVisual })}
              />
            }
          />
          <Row
            label={t("settings.bellSound")}
            control={
              <Switch
                checked={preferences.bellSound}
                onCheckedChange={(bellSound) => set({ bellSound })}
              />
            }
          />
        </Section>

        <Section id="paste" title={t("settings.paste")}>
          <Row
            label={t("settings.pasteThreshold")}
            control={
              <Range
                value={preferences.pasteThreshold}
                min={80}
                max={1000}
                step={20}
                unit="ch"
                onChange={(pasteThreshold) => set({ pasteThreshold })}
              />
            }
          />
          <Row
            label={t("settings.pasteMulti")}
            control={
              <Switch
                checked={preferences.pasteAlwaysPreview}
                onCheckedChange={(pasteAlwaysPreview) => set({ pasteAlwaysPreview })}
              />
            }
          />
        </Section>

        <Section id="security" title={t("settings.security")}>
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            <div className="space-y-0.5">
              <p className="text-[13px] font-medium text-ink">{t("settings.securityModeTitle")}</p>
              <p className="text-xs leading-5 text-ink3">{t("settings.securityModeDetail")}</p>
            </div>
          </div>
        </Section>

        <Section id="workspace" title={t("settings.workspace")}>
          <Row
            label={t("settings.resetLayout")}
            hint={t("settings.resetLayoutWarn")}
            control={
              <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)}>
                <RotateCcw />
                {t("settings.resetLayout")}
              </Button>
            }
          />
        </Section>

        <Section id="about" title={t("settings.about")}>
          <Row
            label="Remote Terminal"
            hint={`${t("settings.version")} 0.1.0 · ${t("settings.fontMono")}`}
            control={<span className="readout text-xs text-ink3">web</span>}
          />
        </Section>
      </div>

      {confirmReset ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmReset(false)}>
          <DialogContent>
            <DialogHeader
              title={t("settings.resetLayout")}
              description={t("settings.resetLayoutWarn")}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  workspace.reset();
                  setConfirmReset(false);
                  toast.success(t("common.done"));
                }}
              >
                {t("common.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <span className="sr-only">{resolveTheme(preferences.theme)}</span>
    </PageShell>
  );
}

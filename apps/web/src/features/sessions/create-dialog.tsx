import { Satellite } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { errorKey } from "@/lib/errors";
import { useDevices } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { useOpenSession } from "./open-session";

export function CreateSessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: devices, isLoading } = useDevices();
  const openSession = useOpenSession();
  const online = devices?.filter((device) => device.state === "online") ?? [];
  const [deviceId, setDeviceId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedDevice = online.find((device) => device.id === deviceId);
  const profiles = selectedDevice?.profiles ?? [];

  useEffect(() => {
    if (open) {
      const first = online[0];
      setDeviceId(first?.id ?? "");
      setProfileId(first?.profiles[0]?.id ?? "");
      setCwd("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deviceId || !profileId) return;
    setBusy(true);
    try {
      await openSession(deviceId, profileId, cwd);
      onOpenChange(false);
    } catch (error) {
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={t("session.createTitle")} description={t("session.createSubtitle")} />
        <form onSubmit={start} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-device">{t("session.device")}</Label>
            {isLoading ? (
              <div className="h-8.5 rounded-[var(--radius-control)] border border-line bg-panel" />
            ) : online.length === 0 ? (
              <p className="rounded-[var(--radius-control)] border border-warn/40 bg-warn/8 px-3 py-2 text-xs text-warn">
                {t("session.offlineDevice")}
              </p>
            ) : (
              <Select
                value={deviceId}
                onValueChange={(value) => {
                  setDeviceId(value);
                  const device = online.find((entry) => entry.id === value);
                  setProfileId(device?.profiles[0]?.id ?? "");
                }}
              >
                <SelectTrigger id="session-device" aria-label={t("session.device")}>
                  <SelectValue placeholder={t("session.device")} />
                </SelectTrigger>
                <SelectContent>
                  {online.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      <span className="flex items-center gap-2">
                        <Satellite className="size-3.5 text-ink3" />
                        {device.name}
                        <span className="readout text-[11px] text-ink3">{device.platform}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {selectedDevice ? (
            <div className="space-y-1.5">
              <Label htmlFor="session-profile">{t("session.profile")}</Label>
              {profiles.length === 0 ? (
                <p className="rounded-[var(--radius-control)] border border-warn/40 bg-warn/8 px-3 py-2 text-xs text-warn">
                  {t("session.noProfile")}
                </p>
              ) : (
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger id="session-profile" aria-label={t("session.profile")}>
                    <SelectValue placeholder={t("session.profile")} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        <span className="flex items-center gap-2">
                          {profile.name}
                          <span className="readout text-[11px] text-ink3">{profile.shell}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="session-cwd">{t("session.cwd")}</Label>
            <Input
              id="session-cwd"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={t("session.cwdPlaceholder")}
              className="readout"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !deviceId || !profileId || online.length === 0}
            >
              {busy ? t("common.loading") : t("session.start")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

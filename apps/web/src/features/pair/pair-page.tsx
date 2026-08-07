import { useSearch } from "@tanstack/react-router";
import { CheckCircle2, Fingerprint, ScanLine, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, PageShell } from "@/components/rack/page-shell";
import { Readout } from "@/components/rack/readout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { errorKey } from "@/lib/errors";
import { usePairAuthorize, usePairReview } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Review } from "@/lib/types";

function normalize(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/** Device pairing review: enter the Agent's short code, verify, authorize. */
export function PairPage() {
  const { t } = useI18n();
  const search = useSearch({ from: "/shell/pair" });
  const review = usePairReview();
  const authorize = usePairAuthorize();
  const [code, setCode] = useState(search.user_code ?? "");
  const [reviewed, setReviewed] = useState<Review | null>(null);
  const [granted, setGranted] = useState(false);

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalize(code);
    if (normalized.length !== 16) return;
    try {
      const result = await review.mutateAsync(normalized);
      setReviewed(result);
    } catch (error) {
      setReviewed(null);
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    }
  };

  const confirm = async () => {
    if (!reviewed) return;
    try {
      await authorize.mutateAsync(reviewed.user_code);
      setGranted(true);
    } catch (error) {
      toast.error(t(errorKey(error instanceof ApiError ? error.code : "UNKNOWN") as never));
    }
  };

  if (granted) {
    return (
      <PageShell>
        <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-ok/40 bg-ok/10 text-ok">
            <CheckCircle2 className="size-6" />
          </div>
          <p className="text-[15px] font-semibold text-ink">{t("pair.reviewTitle")}</p>
          <p className="text-[13px] text-ink3">
            {reviewed?.name} · {reviewed?.platform}
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title={t("pair.title")} subtitle={t("pair.subtitle")} />
      <div className="mx-auto max-w-md">
        {!reviewed ? (
          <form onSubmit={lookup} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pair-code">{t("pair.codeLabel")}</Label>
              <Input
                id="pair-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="XXXXXXXX-XXXXXXXX"
                className="readout tracking-[0.08em]"
                disabled={review.isPending}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={normalize(code).length !== 16 || review.isPending}
            >
              <ScanLine />
              {review.isPending ? t("common.loading") : t("pair.lookup")}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-4">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <Fingerprint className="size-4 text-accent" />
                <span className="silkscreen text-ink2">{t("pair.reviewTitle")}</span>
                <span className="ml-auto readout text-xs text-ink3">{reviewed.user_code}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Readout label={t("pair.device")} value={reviewed.name} />
                <Readout
                  label={t("pair.platform")}
                  value={`${reviewed.platform} · v${reviewed.version}`}
                />
                <Readout
                  label={t("pair.fingerprint")}
                  value={reviewed.fingerprint.slice(0, 24) + "…"}
                  className="col-span-2"
                />
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs leading-5 text-ink3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
              {t("pair.verifyHint")}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setReviewed(null)}>
                {t("common.back")}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => void confirm()}
                disabled={authorize.isPending}
              >
                {authorize.isPending ? t("common.loading") : t("pair.authorize")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

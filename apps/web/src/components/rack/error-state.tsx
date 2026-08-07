import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { errorKey } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";

/**
 * Typed failure surface: names the problem (stable code → message key) and
 * offers retry when retryable. Never "Something went wrong".
 */
export function ErrorState({
  code,
  retryable,
  detail,
  onRetry,
  className,
}: {
  code: string;
  retryable?: boolean;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border border-bad/30",
        "bg-bad/5 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-bad/30 bg-bad/10 text-bad">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{t(errorKey(code))}</p>
        {detail ? (
          <p className="readout text-xs text-ink3" title={detail}>
            {detail}
          </p>
        ) : null}
      </div>
      {retryable && onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

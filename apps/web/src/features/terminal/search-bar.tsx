import { ArrowDown, ArrowUp, CaseSensitive, Regex, WholeWord, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface Options {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}
function OptionButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={active}
          aria-label={label}
          className={cn(active && "bg-accent/15 text-accent")}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SearchBar({
  controls,
  onClose,
}: {
  controls: {
    next: (query: string, options: Options) => boolean;
    previous: (query: string, options: Options) => boolean;
    clear: () => void;
    onResults: (callback: (current: number, total: number) => void) => () => void;
  };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Options>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [count, setCount] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return controls.onResults((current, total) => setCount({ current, total }));
  }, [controls]);

  useEffect(() => {
    if (query) controls.next(query, options);
    else controls.clear();
  }, [query, options, controls]);

  const toggle = (key: keyof Options) =>
    setOptions((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="flex items-center gap-1 border-b border-line bg-panel2 px-2 py-1.5">
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (event.shiftKey) {
              controls.previous(query, options);
            } else {
              controls.next(query, options);
            }
            event.preventDefault();
          }
          if (event.key === "Escape") onClose();
        }}
        placeholder={t("search.placeholder")}
        className="h-7 w-56 text-xs"
        aria-label={t("search.placeholder")}
      />
      <span className="readout min-w-16 px-1 text-center text-xs text-ink3">
        {query ? t("search.count", { current: count.current, total: count.total }) : ""}
      </span>
      <div className="flex items-center gap-0.5">
        <OptionButton
          label={t("search.case")}
          active={options.caseSensitive}
          onClick={() => toggle("caseSensitive")}
          icon={<CaseSensitive />}
        />
        <OptionButton
          label={t("search.word")}
          active={options.wholeWord}
          onClick={() => toggle("wholeWord")}
          icon={<WholeWord />}
        />
        <OptionButton
          label={t("search.regex")}
          active={options.regex}
          onClick={() => toggle("regex")}
          icon={<Regex />}
        />
      </div>
      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("search.prev")}
              onClick={() => controls.previous(query, options)}
            >
              <ArrowUp />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("search.prev")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("search.next")}
              onClick={() => controls.next(query, options)}
            >
              <ArrowDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("search.next")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("search.close")}
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("search.close")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

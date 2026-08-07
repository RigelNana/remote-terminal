import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import { cn } from "@/lib/cn";

/** Uniform-height virtual list (PRD §10.3.8: long lists never render invisible rows). */
export function VirtualList<T>({
  items,
  height,
  rowHeight,
  renderRow,
  className,
  overscan = 8,
}: {
  items: T[];
  height: number | string;
  rowHeight: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  className?: string;
  overscan?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });
  return (
    <div ref={parentRef} className={cn("overflow-auto", className)} style={{ height }} role="list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            role="listitem"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            {renderRow(items[item.index] as T, item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

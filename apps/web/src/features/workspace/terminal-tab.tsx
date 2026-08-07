import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { isSplit, useWorkspace, type Node, type Tab } from "@/stores/workspace";
import { PaneFrame } from "./pane-frame";

function handleClassName(dir: "row" | "col"): string {
  const base =
    "bg-line/50 transition-colors duration-150 outline-none hover:bg-accent/50 active:bg-accent/70";
  const hit = dir === "row" ? "w-1" : "h-1";
  return `${base} ${hit}`;
}
function nodeKey(node: Node): string {
  if (!isSplit(node)) return node.id;
  return `${node.dir}:${node.items.map(nodeKey).join(":")}`;
}
function containsPane(node: Node, paneId: string): boolean {
  if (!isSplit(node)) return node.id === paneId;
  return node.items.some((child) => containsPane(child, paneId));
}

function renderNode(node: Node, tab: Tab, zoomed: string | null): React.ReactNode {
  if (!isSplit(node)) {
    return <PaneFrame key={node.id} tab={tab} pane={node} />;
  }
  const targetIndex =
    zoomed === null ? -1 : node.items.findIndex((child) => containsPane(child, zoomed));
  return (
    <Group
      key={nodeKey(node)}
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
      disabled={zoomed !== null}
    >
      {node.items.map((child, index) => (
        <Fragment key={nodeKey(child)}>
          {index > 0 ? (
            <Separator
              className={handleClassName(node.dir)}
              aria-label="resize"
              data-zoom-hidden={zoomed === null ? undefined : "true"}
            />
          ) : null}
          <Panel
            defaultSize={`${(node.sizes[index] ?? 1 / node.items.length) * 100}%`}
            minSize="12%"
            disabled={zoomed !== null}
            data-zoom-hidden={zoomed !== null && index !== targetIndex ? "true" : undefined}
            data-zoom-target={zoomed !== null && index === targetIndex ? "true" : undefined}
            onPointerDown={() => {
              const first = firstPaneId(child);
              if (first) useWorkspace.getState().setActivePane(tab.id, first);
            }}
          >
            {renderNode(child, tab, zoomed)}
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

function firstPaneId(node: Node): string | null {
  if (!isSplit(node)) return node.id;
  for (const child of node.items) {
    const found = firstPaneId(child);
    if (found) return found;
  }
  return null;
}

/** Renders a tab's pane tree without unmounting hidden panes during zoom. */
export function TerminalTab({ tab }: { tab: Tab }) {
  return (
    <div className="h-full min-h-0" data-terminal-tree data-zoomed={tab.zoomed ?? undefined}>
      {renderNode(tab.tree, tab, tab.zoomed)}
    </div>
  );
}

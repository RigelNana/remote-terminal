import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Workspace layout: tabs and pane trees. Persists structure only — tab ids,
 * titles, split directions, active pane. Never terminal bytes or connection
 * state (PRD §10.2, SES-008).
 */

export type PaneId = string;

export interface Pane {
  id: PaneId;
  /** Attached session; null renders the workspace home surface. */
  session: string | null;
}

export interface Split {
  dir: "row" | "col";
  items: (Split | Pane)[];
  /** Resize ratios aligned with items (0..1). */
  sizes: number[];
}

export type Node = Split | Pane;
export function isSplit(node: Node): node is Split {
  return "dir" in node;
}

export interface Tab {
  id: string;
  title: string;
  tree: Node;
  activePane: PaneId;
  /** Pane id zoomed to full size, if any. */
  zoomed: PaneId | null;
}

export function homePane(): Pane {
  return { id: crypto.randomUUID(), session: null };
}

function terminalPane(session: string): Pane {
  return { id: crypto.randomUUID(), session };
}

export function splitNode(dir: "row" | "col", a: Node, b: Node): Split {
  return { dir, items: [a, b], sizes: [0.5, 0.5] };
}

interface WorkspaceState {
  tabs: Tab[];
  activeTab: string | null;
  addHomeTab: () => Tab;
  addTerminalTab: (session: string, title: string) => Tab;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  splitPane: (tabId: string, paneId: PaneId, dir: "row" | "col", session: string | null) => void;
  removePane: (tabId: string, paneId: PaneId) => void;
  setZoomed: (tabId: string, paneId: PaneId | null) => void;
  setActivePane: (tabId: string, paneId: PaneId) => void;
  reset: () => void;
}

function mapTree(node: Node, fn: (node: Node) => Node): Node {
  if (!isSplit(node)) return fn(node);
  const items = node.items.map((child) => mapTree(child, fn));
  const sizes = node.sizes.length === items.length ? node.sizes : items.map(() => 1 / items.length);
  return fn({ ...node, items, sizes });
}

function firstPane(node: Node): Pane | null {
  if (!isSplit(node)) return node;
  for (const child of node.items) {
    const found = firstPane(child);
    if (found) return found;
  }
  return null;
}

function findSessionPane(node: Node, session: string): Pane | null {
  if (!isSplit(node)) return node.session === session ? node : null;
  for (const child of node.items) {
    const found = findSessionPane(child, session);
    if (found) return found;
  }
  return null;
}

/** Remove a pane; a split with one remaining child collapses into that child. */
function collapse(node: Node, paneId: PaneId): Node | null {
  if (!isSplit(node)) return node.id === paneId ? null : node;

  const items: Node[] = [];
  const weights: number[] = [];
  for (const [index, child] of node.items.entries()) {
    const item = collapse(child, paneId);
    if (item === null) continue;
    items.push(item);
    weights.push(node.sizes[index] ?? 1);
  }
  if (items.length === 1) return items[0] as Node;
  if (items.length === 0) return null;

  const total = weights.reduce((sum, size) => sum + size, 0);
  const sizes = total > 0 ? weights.map((size) => size / total) : items.map(() => 1 / items.length);
  return { ...node, items, sizes };
}

function makeTab(title: string, tree: Node): Tab {
  return {
    id: crypto.randomUUID(),
    title,
    tree,
    activePane: firstPane(tree)?.id ?? (tree as Pane).id,
    zoomed: null,
  };
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTab: null,
      addHomeTab: () => {
        const tab = makeTab("workspace.home", homePane());
        set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id }));
        return tab;
      },
      addTerminalTab: (session, title) => {
        for (const existing of get().tabs) {
          const pane = findSessionPane(existing.tree, session);
          if (!pane) continue;
          if (existing.activePane === pane.id) {
            set({ activeTab: existing.id });
            return existing;
          }
          const tab = { ...existing, activePane: pane.id };
          set((state) => ({
            tabs: state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate)),
            activeTab: tab.id,
          }));
          return tab;
        }
        const tab = makeTab(title, terminalPane(session));
        set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id }));
        return tab;
      },
      removeTab: (tabId) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === tabId);
          const tabs = state.tabs.filter((tab) => tab.id !== tabId);
          const activeTab =
            state.activeTab === tabId
              ? ((tabs[index - 1] ?? tabs[index] ?? null)?.id ?? null)
              : state.activeTab;
          return { tabs, activeTab };
        }),
      setActiveTab: (tabId) => set({ activeTab: tabId }),
      renameTab: (tabId, title) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
        })),
      splitPane: (tabId, paneId, dir, session) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const tree = mapTree(tab.tree, (node) => {
              if (isSplit(node) || node.id !== paneId) return node;
              const next = session === null ? homePane() : terminalPane(session);
              return splitNode(dir, node, next);
            });
            return { ...tab, tree, zoomed: null };
          }),
        })),
      removePane: (tabId, paneId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const tree = collapse(tab.tree, paneId) ?? homePane();
            const activePane =
              tab.activePane === paneId ? (firstPane(tree)?.id ?? tab.activePane) : tab.activePane;
            return {
              ...tab,
              tree,
              activePane,
              zoomed: tab.zoomed === paneId ? null : tab.zoomed,
            };
          }),
        })),
      setZoomed: (tabId, paneId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, zoomed: paneId } : tab)),
        })),
      setActivePane: (tabId, paneId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, activePane: paneId } : tab)),
        })),
      reset: () => set({ tabs: [], activeTab: null }),
    }),
    {
      name: "rt.workspace",
      storage: createJSONStorage(() => window.localStorage),
      version: 1,
    },
  ),
);

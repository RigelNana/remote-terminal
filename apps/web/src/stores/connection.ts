import { create } from "zustand";

import type { LinkSummary } from "@/features/terminal/types";

/**
 * Per-pane connection summaries for tab badges and pane headers. Explicitly
 * allowed by PRD §10.2 ("连接摘要"); never holds terminal bytes.
 */
interface ConnectionState {
  summaries: Record<string, LinkSummary>;
  setSummary: (paneId: string, summary: LinkSummary) => void;
  clear: (paneId: string) => void;
}

export const useConnection = create<ConnectionState>()((set) => ({
  summaries: {},
  setSummary: (paneId, summary) =>
    set((state) => ({ summaries: { ...state.summaries, [paneId]: summary } })),
  clear: (paneId) =>
    set((state) => {
      if (!(paneId in state.summaries)) return state;
      const summaries = { ...state.summaries };
      delete summaries[paneId];
      return { summaries };
    }),
}));

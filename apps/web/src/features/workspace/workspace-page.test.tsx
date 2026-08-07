/** @vitest-environment jsdom */
/** @vitest-environment-options { "url": "http://localhost/" } */
import "@/test/setup-local-storage";

import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import type { Tab } from "@/stores/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "@/stores/workspace";

const lifecycle = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: vi.fn() }),
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/rack/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./tab-bar", () => ({ TabBar: () => null }));
vi.mock("./terminal-tab", () => ({
  TerminalTab: ({ tab }: { tab: { id: string } }) => {
    useEffect(() => {
      lifecycle.mounts.set(tab.id, (lifecycle.mounts.get(tab.id) ?? 0) + 1);
      return () => {
        lifecycle.unmounts.set(tab.id, (lifecycle.unmounts.get(tab.id) ?? 0) + 1);
      };
    }, [tab.id]);
    return <div data-testid={`terminal-${tab.id}`} />;
  },
}));

import { WorkspacePage } from "./workspace-page";

describe("WorkspacePage terminal lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    lifecycle.mounts.clear();
    lifecycle.unmounts.clear();
    act(() => useWorkspace.getState().reset());
  });

  afterEach(() => cleanup());

  it("keeps each terminal mounted while switching tabs", () => {
    let first!: Tab;
    act(() => {
      first = useWorkspace.getState().addTerminalTab("session-a", "A");
    });
    const { getByTestId } = render(<WorkspacePage />);

    act(() => {
      useWorkspace.getState().addTerminalTab("session-b", "B");
    });
    act(() => {
      useWorkspace.getState().setActiveTab(first.id);
    });

    expect(lifecycle.mounts.get(first.id)).toBe(1);
    expect(lifecycle.unmounts.get(first.id) ?? 0).toBe(0);
    expect(getByTestId(`terminal-${first.id}`).parentElement?.classList.contains("visible")).toBe(
      false,
    );
  });
});

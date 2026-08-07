/** @vitest-environment jsdom */
/** @vitest-environment-options { "url": "http://localhost/" } */
import "@/test/setup-local-storage";

import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "./workspace";

describe("workspace terminal tabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspace.getState().reset();
  });

  it("focuses the existing tab when the same session is opened again", () => {
    const first = useWorkspace.getState().addTerminalTab("session-a", "Shell");
    const second = useWorkspace.getState().addTerminalTab("session-a", "Shell");

    expect(second.id).toBe(first.id);
    expect(useWorkspace.getState().tabs).toHaveLength(1);
    expect(useWorkspace.getState().activeTab).toBe(first.id);
  });
});

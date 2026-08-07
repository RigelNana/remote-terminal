import { describe, expect, it } from "vitest";

import { applyTerminalModifiers, encodeTerminalKey } from "./terminal-keys";
import type { TerminalKey } from "./terminal-keys";

describe("terminal mobile keys", () => {
  it("encodes navigation and all function keys", () => {
    expect(encodeTerminalKey("arrowUp", { ctrl: false, alt: false })).toBe("\u001b[A");
    expect(encodeTerminalKey("home", { ctrl: false, alt: false })).toBe("\u001b[H");
    expect(encodeTerminalKey("pageDown", { ctrl: false, alt: false })).toBe("\u001b[6~");
    expect(
      Array.from({ length: 12 }, (_, index) =>
        encodeTerminalKey(`f${index + 1}` as TerminalKey, { ctrl: false, alt: false }),
      ),
    ).toEqual([
      "\u001bOP",
      "\u001bOQ",
      "\u001bOR",
      "\u001bOS",
      "\u001b[15~",
      "\u001b[17~",
      "\u001b[18~",
      "\u001b[19~",
      "\u001b[20~",
      "\u001b[21~",
      "\u001b[23~",
      "\u001b[24~",
    ]);
  });

  it("encodes Ctrl, Alt, and Ctrl+Alt modifiers", () => {
    expect(encodeTerminalKey("arrowLeft", { ctrl: true, alt: false })).toBe("\u001b[1;5D");
    expect(encodeTerminalKey("f12", { ctrl: false, alt: true })).toBe("\u001b[24;3~");
    expect(encodeTerminalKey("f2", { ctrl: true, alt: true })).toBe("\u001b[1;7Q");
    expect(encodeTerminalKey("escape", { ctrl: false, alt: true })).toBe("\u001b\u001b");
  });

  it("applies sticky modifiers to native keyboard input", () => {
    expect(applyTerminalModifiers("c", { ctrl: true, alt: false })).toBe("\u0003");
    expect(applyTerminalModifiers("[", { ctrl: true, alt: false })).toBe("\u001b");
    expect(applyTerminalModifiers("x", { ctrl: true, alt: true })).toBe("\u001b\u0018");
    expect(applyTerminalModifiers("字", { ctrl: true, alt: false })).toBe("字");
  });
});

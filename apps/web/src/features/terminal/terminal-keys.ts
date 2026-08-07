export interface TerminalModifiers {
  ctrl: boolean;
  alt: boolean;
}

export type TerminalKey =
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown"
  | "tab"
  | "escape"
  | `f${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

export const NO_TERMINAL_MODIFIERS: TerminalModifiers = { ctrl: false, alt: false };

const FUNCTION_KEY_CODE = ["P", "Q", "R", "S", "15", "17", "18", "19", "20", "21", "23", "24"];

/** XTerm modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4) + Meta(8). */
function modifierParameter({ ctrl, alt }: TerminalModifiers): number {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

export function encodeTerminalKey(key: TerminalKey, modifiers: TerminalModifiers): string {
  const modifier = modifierParameter(modifiers);
  const altPrefix = modifiers.alt ? "\u001b" : "";

  switch (key) {
    case "escape":
      return `${altPrefix}\u001b`;
    case "tab":
      return `${altPrefix}\t`;
    case "arrowUp":
    case "arrowDown":
    case "arrowLeft":
    case "arrowRight": {
      const final = { arrowUp: "A", arrowDown: "B", arrowRight: "C", arrowLeft: "D" }[key];
      return modifier === 1 ? `\u001b[${final}` : `\u001b[1;${modifier}${final}`;
    }
    case "home":
      return modifier === 1 ? "\u001b[H" : `\u001b[1;${modifier}H`;
    case "end":
      return modifier === 1 ? "\u001b[F" : `\u001b[1;${modifier}F`;
    case "pageUp":
    case "pageDown": {
      const code = key === "pageUp" ? 5 : 6;
      return modifier === 1 ? `\u001b[${code}~` : `\u001b[${code};${modifier}~`;
    }
    default: {
      const number = Number(key.slice(1));
      const code = FUNCTION_KEY_CODE[number - 1];
      if (!code) return "";
      if (number <= 4) return modifier === 1 ? `\u001bO${code}` : `\u001b[1;${modifier}${code}`;
      return modifier === 1 ? `\u001b[${code}~` : `\u001b[${code};${modifier}~`;
    }
  }
}

/** Applies sticky mobile Ctrl/Alt to the next native keyboard payload. */
export function applyTerminalModifiers(input: string, modifiers: TerminalModifiers): string {
  let output = input;
  if (modifiers.ctrl && [...input].length === 1) {
    const character = input.toUpperCase();
    const code = character.charCodeAt(0);
    if (input === " ") output = "\0";
    else if (input === "?") output = "\u007f";
    else if (code >= 64 && code <= 95) output = String.fromCharCode(code - 64);
  }
  return modifiers.alt ? `\u001b${output}` : output;
}

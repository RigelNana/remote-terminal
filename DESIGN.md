---
name: Remote Terminal
description: A private-observatory control room for reaching the real terminal at home.
colors:
  night-background: "#0a0e14"
  rack-face: "#0e131c"
  inset-panel: "#131a26"
  control-hover: "#1a2330"
  hairline: "rgb(148 166 196 / 0.14)"
  hairline-strong: "rgb(148 166 196 / 0.28)"
  primary-ink: "#e8edf5"
  secondary-ink: "#a9b5c8"
  tertiary-ink: "#7a87a0"
  interaction-ice: "#7cc7ff"
  interaction-ice-bright: "#a3d8ff"
  tracking-green: "#6fe3a3"
  acquiring-amber: "#ffb454"
  fault-red: "#ff7a7a"
  lamp-off: "rgb(122 135 160 / 0.35)"
  selection-ice: "rgb(124 199 255 / 0.28)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans SC, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  readout:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.02em"
  silkscreen:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
rounded:
  control: "6px"
  panel: "12px"
  dialog: "14px"
  lamp: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.interaction-ice}"
    textColor: "{colors.night-background}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.inset-panel}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "34px"
  input:
    backgroundColor: "{colors.rack-face}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "34px"
  panel:
    backgroundColor: "{colors.rack-face}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Remote Terminal

## Overview

**Creative North Star: "The Private Observatory"**

Remote Terminal behaves like a precision observatory control room: the home machine is the tracked instrument, the relay is the dome link, and the terminal is the eyepiece. Deep blue-black rack faces, hairline seams, measured spacing, and compact readouts communicate control without imitating a generic dark developer tool.

The visual system is restrained rather than sterile. One ice-blue accent owns interaction; green, amber, and red are reserved for live instrument state. The light theme becomes a warm day logbook, while high contrast preserves the same hierarchy with stronger seams. Typography separates human-facing instructions from machine measurements instead of turning every surface into monospace costume.

**Key Characteristics:**
- Precision rack geometry with quiet tonal layers and hairline seams.
- Instrument lamps and readouts whose state remains legible without color.
- Dense, keyboard-first operation around a dominant terminal viewport.
- Self-hosted typography and assets; no decorative network dependency.
- Responsive continuity: desktop instrument rail becomes a five-position mobile dock.

## Colors

The dark scene uses cool, low-luminance rack surfaces with an ice-blue interaction channel and a strictly semantic status triad.

### Primary
- **Interaction Ice:** the sole color for selected navigation, focus, primary actions, and active dividers.
- **Interaction Ice Bright:** hover emphasis for primary actions, never a second competing accent.

### Secondary
- **Tracking Green:** healthy, online, connected, and permission-safe instrument state.
- **Acquiring Amber:** reconnecting, waiting, or attention-required state.
- **Fault Red:** revoked, failed, destructive, or unavailable state.

### Neutral
- **Night Background:** the deepest application field behind every rack surface.
- **Rack Face:** persistent header, rail, terminal chrome, and card surface.
- **Inset Panel:** controls and nested surfaces that sit inside a rack face.
- **Control Hover:** the highest resting tonal layer, used for hover and active secondary controls.
- **Primary Ink:** headings and high-value content.
- **Secondary Ink:** labels and normal secondary content.
- **Tertiary Ink:** metadata and subdued explanatory copy.
- **Hairline / Hairline Strong:** structural seams and interactive border emphasis.

**The One Signal Channel Rule.** Ice blue means interaction; green, amber, and red mean state. Never exchange those responsibilities.

**The State Has Words Rule.** A status color must have a visible label or accessible name; color never carries the state alone.

## Typography

**Display Font:** the platform sans stack with Chinese system-font fallbacks.
**Body Font:** the same platform sans stack.
**Label/Mono Font:** self-hosted JetBrains Mono with a self-hosted Nerd Font symbol fallback inside terminals.

**Character:** Sans text keeps instructions natural in Chinese and English. Monospace is reserved for IDs, timestamps, offsets, RTT, commands, and tabular measurements.

### Hierarchy
- **Headline** (600, 20px, 1.25): page identity and dialog decisions.
- **Title** (600, 14–16px): card, pane, and section identity.
- **Body** (400, 14px, 1.5): instructions, labels, and explanatory copy.
- **Readout** (400, 13px, tabular figures): real measurements and machine values.
- **Silkscreen** (600, 10px, 0.14em tracking, uppercase): short rack labels only.

**The Monospace Earns Its Place Rule.** Use JetBrains Mono only where alignment or machine identity communicates useful information.

## Layout

The desktop shell is a fixed-height instrument with an 44px top rail, a compact vertical subsystem rail, and one min-width-zero routed workspace. Content pages use bounded reading widths and virtualized long lists; the workspace instead gives every remaining pixel to the terminal tree.

Spacing follows a compact 4px-derived rhythm. Rack controls favor 28–40px heights, while destructive decisions move into dialogs rather than expanding inline rows. Split panes preserve their mounted xterm instances during zoom and route changes.

At the large breakpoint, the primary navigation lives in the top rail and the subsystem rail remains visible. Below it, both collapse into a five-position bottom dock. Page headings and list rows wrap rather than forcing horizontal scrolling; terminal toolbars remain compact and the mobile status strip hides secondary telemetry before truncating critical security state.

## Elevation & Depth

The system is flat by default. Depth comes from tonal nesting and one-pixel seams; shadows appear only when a surface must leave the rack plane, such as menus, dialogs, tooltips, and command palettes. Raised controls use a compact shadow, while modal overlays use a larger, darker pop shadow.

**The Rack Plane Rule.** Persistent surfaces do not float. If a panel can be separated with tone and a seam, do not add a shadow.

## Shapes

Controls use precise, gently softened corners; panels and dialogs receive progressively larger radii without becoming pill-shaped. Only status lamps, compact security badges, and other genuinely capsule-like indicators use full rounding. Hairline borders define equipment seams, while active tabs use a single ice-blue edge rather than a filled floating capsule.

## Components

### Buttons
- **Shape:** compact controls with 6px corners and 28–40px height variants.
- **Primary:** interaction-ice fill with dark text; reserved for the page's decisive action.
- **Secondary:** inset-panel fill with a hairline border; the default operational control.
- **Ghost:** no resting box; gains a control-hover surface only on interaction.
- **Danger:** fault-red text and a restrained tinted surface, followed by explicit confirmation for consequential actions.
- **Hover / Focus:** 150ms color transitions and a one-pixel ice focus outline with offset.

### Cards / Containers
- **Corner Style:** 12px for bounded content panels; persistent rack surfaces stay square where they meet the viewport.
- **Background:** rack-face over night-background, with inset-panel for nested content.
- **Shadow Strategy:** none at rest; hairline seams provide structure.
- **Internal Padding:** 12–16px for operational surfaces and 24px for sparse authentication states.

### Inputs / Fields
- **Style:** 34px rack-face field, 6px corners, hairline border, and 13px text.
- **Focus:** border shifts to interaction ice; no glow.
- **Error / Disabled:** visible fault copy or reduced opacity; validation meaning is never color-only.

### Navigation
- **Style:** compact text in the top rail and instrument labels in the side rail. Active state uses interaction ice and the neighboring rack tone.
- **Mobile:** a fixed five-position bottom dock with the same route order and a single active edge.

### Status Lamps
An 8px circular lamp is always paired with a readable status label. Green is steady, amber may pulse or blink for acquisition, off is parked, and red is fault. Reduced-motion mode removes repeated animation without hiding state.

### Instrument Readouts
Silkscreen labels sit above tabular JetBrains Mono values. Readouts show real measurements with units or explicit empty marks; they are never decorative filler.

### Terminal Workspace
The terminal viewport dominates. Tabs, font controls, split actions, search, paste review, connection telemetry, and security mode stay in compact chrome around xterm, while terminal bytes bypass React state entirely.

## Do's and Don'ts

### Do:
- **Do** reserve interaction ice for focus, selection, and decisive actions.
- **Do** pair every lamp and semantic color with text or an accessible name.
- **Do** keep PTY measurements tabular and human guidance in the sans stack.
- **Do** remove secondary telemetry before allowing critical controls or security state to overflow on small screens.
- **Do** preserve mounted terminals across route switches, pane zoom, and split resizing.

### Don't:
- **Don't** introduce black-and-neon hacker styling, generic SaaS gradient cards, or decorative terminal gibberish.
- **Don't** use rounded floating cards for persistent rack chrome.
- **Don't** turn ordinary prose into uppercase monospace labels.
- **Don't** use green for primary actions or ice blue for health state.
- **Don't** add shadows where a tonal step and hairline seam already establish hierarchy.

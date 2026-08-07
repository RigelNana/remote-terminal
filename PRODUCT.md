# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Greenfield, pinned by the owner's brief and PRD §10.1 (not delegated):

- React 19 + TypeScript strict, Vite 8 (Rolldown/Oxc path), `@vitejs/plugin-react` v6
- Tailwind CSS tokens; Radix UI primitives composed via shadcn/ui source components
- TanStack Query (server state), TanStack Router (typed routes), TanStack Virtual (long lists)
- Zustand + persist for workspace/pane/preferences (never terminal bytes); IndexedDB only for explicitly allowed layout snapshots
- `@xterm/xterm` 6.x + official addons (fit, search, web-links, webgl, serialize, unicode11; clipboard/progress behind gates)
- `react-resizable-panels` splits, `cmdk` command palette, React Hook Form + Zod, Lucide + Sonner
- `@bufbuild/protobuf` generated wire types from `proto/terminal.proto`
- Oxlint + Oxfmt for lint/format; all static assets self-hosted, no third-party CDN

## Users

- **Owner**: a self-hosting individual who deploys the relay on their own public server, owns the home machine, and needs its real shell from any browser (borrowed laptop, tablet, phone, work machine). Single owner is the P0 scope; data model must not hard-code global uniqueness.
- **Controller / Viewer**: roles of an attachment to a session (input lease vs read-only). P2 audience; roles exist in the domain model now.

Primary situation: away from home, no inbound port on the home network, wants bash/zsh/fish with real dotfiles, vim/tmux/htop — the actual machine, not a hosted sandbox.

## Product Purpose

Let the owner reach the real Shell and PTY of their home computer from any supported browser through a relay they run on a public server. The browser and the Agent each make one outbound HTTPS/WSS connection to the relay; the home network opens zero inbound ports. Shell and PTY always run on the home device; the relay authenticates, authorizes, and forwards bytes; it never replaces the shell.

Success: a paired device is usable in under two seconds from a logged-in browser; closing the browser never ends the shell; re-attaching resumes from the last acknowledged output offset without loss or duplication.

## Positioning

The mechanism no neighbor can copy without building it: the home PTY itself, tunneled over an outbound-only WSS link to a relay the user owns, with session life decoupled from every browser connection. Browser disconnect ≠ session end; re-attach resumes the same PID. Companion web shells share screens; this one shares the machine.

## Operating Context

- Trusted-relay model at launch: TLS browser↔relay and agent↔relay; relay can read plaintext until P2 E2EE. The UI must show the active security mode and never call link TLS "end-to-end encryption".
- Owner self-hosts: single binary + SQLite WAL + Caddy/rustls TLS; backups and health checks are first-class.
- First-run: one-time bootstrap URL registers the first passkey; recovery codes are generated once and server stores only hashes.
- Pairing: OAuth 2.0 Device Authorization Grant (RFC 8628) — owner authorizes a short user code on the web app while the Agent polls.
- Terminal content is the highest-sensitivity data in the product: passwords, tokens, source. Never logs content, never persists by default, never renders untrusted sequences as HTML.
- UI language: Simplified Chinese primary, English secondary (both shipped; UX-007). [INFERENCE: PRD requires both; zh-CN chosen as default from the owner's working language.]

## Capabilities and Constraints

P0 (PRD §19): passkey onboarding/login + recovery codes + browser-session management; device pairing review/authorize, device list/rename/revoke; session create/list/attach/stop; tabs, splits, search, paste guard, OSC title with escape, link allowlist, WebGL with fallback, scrollback bounds, themes (dark/light/high-contrast), font options, bell; journal/ACK/Gap reconnection; audit list (virtualized) + export; settings; keyboard-first, screen-reader mode, reduced motion; zh + en.

Non-goals P0: file transfer, recording, collaboration invites, inline images, broadcast input, tmux persistence, SSH profiles, E2EE, OIDC — P1/P2 per PRD §7.

Hard constraints:
- PTY Output bytes go straight from the wire into xterm `write(Uint8Array, callback)` — never through React/Zustand/Query/JSON.
- ACK advances only after the xterm write callback fires.
- Output/status aggregates throttle to ≥250 ms; resize via ResizeObserver + rAF, only when cols/rows actually change.
- Terminal routes, xterm core, non-P0 addons lazy-load; login/device pages never download terminal code.
- Max 8 active WebGL terminals, LRU release; no third-party runtime scripts.
- Stable error codes (§16) with retryable flag + safe message key; never "Something went wrong" alone.
- Paste guard: multi-line/oversized/control-char paste shows a review preview first; session-scoped opt-out only.
- OSC 52 clipboard writes denied by default; per-session single-use allow.
- Browser default storage contains no terminal input/output.

## Brand Commitments

None binding. Working name "Remote Terminal" from repo/PRD; no logo, no voice contract, no existing site. [Visual world is delegated to the new-work direction process; nothing here constrains it.]

## Evidence on Hand

- `docs/PRD.md` — exhaustive product spec (features, flows, security, acceptance).
- `CONTEXT.md` — domain glossary (Session ≠ Attachment ≠ Connection; Journal ≠ Recording).
- `crates/relay`, `crates/agent`, `crates/proto`, `proto/terminal.proto` — working backend; real REST/WSS contracts verified against source.
- `docs/research/terminal-product-research.md` — library and capability research with primary sources.
- No real user content, testimonials, screenshots, or brand assets exist; nothing here may be fabricated as real.

## Product Principles

1. Terminal content is the most sensitive data; minimize, bound, and never default-persist it.
2. Disconnect ≠ exit; closing, detaching, EOF, and killing are four distinct actions with distinct UI states.
3. Control is explicit and singular: one controller per session; other attachments are viewers; UI never fakes a second controller.
4. Failures must be explainable: offline vs revoked vs expired vs gap vs relay fault are different states, not one error toast.
5. The web layer reuses mature primitives (xterm, PTY, WebAuthn, virtual lists, resizable panels) and builds only authorization, coordination, resumable forwarding, and experience.

## Accessibility & Inclusion

- Full keyboard operation for login, devices, tabs, splits, dialogs, menus, search, settings (UX-003).
- Focus returns to trigger after Radix dialogs/menus close; visible terminal focus state (UX-004).
- xterm screen-reader mode + accessible labels; disclose the performance tradeoff at high output (UX-005).
- Respect `prefers-reduced-motion`; reconnect/bell/notifications never rely on animation alone (UX-006).
- High-contrast theme; zh + en copy with location/impact/retry/next-action in errors (UX-007).

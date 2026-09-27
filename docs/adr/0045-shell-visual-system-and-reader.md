# ADR-0045: Application Shell, Visual System and Three-Pane Reader

- Status: Proposed
- Date: 2026-09-27
- Scope: v0.3 web client structure
- Supersedes: the interface part of ADR-0030 (workbench v1); its domain projections and permission boundaries stay
- Approval: in the 2026-09-27 kickoff the owner asked for:
  - a macOS-style interface;
  - a reader with three panes whose content each user chooses;
  - tools hidden until called up by command, with one command that shows all toolbars.

## Decision

- **Visual system.** macOS-style design tokens (system font stack with Chinese fallbacks, light and dark following the system, one accent color, translucent sidebar and toolbar, hairline separators) and components built on the existing Radix primitives.
- **Shell.**
  - Sidebar navigation, and one global Workspace/Space context stored in the user's server-side preferences.
  - Notifications count only items that need action.
  - Routine saves are silent.
- **Commands.**
  - A command registry drives a command palette (⌘K / Ctrl+K), keyboard shortcuts, and a "show all toolbars" toggle (`⌘\`). Browser-reserved shortcuts such as ⌘⇧T and ⌘1–3 are avoided: panes collapse with ⌥1–3 and presets switch with ⌥⇧1–4.
  - After text selection, single keys (T translate, E explain, H excerpt, Q ask, C concept) act directly; a floating menu is an opt-in setting.
- **Panes.**
  - A pane system with a content registry: PDF, outline, thumbnails, close-reading note, excerpts, AI chat, translation, quiz, local graph, source info.
  - Resizable and collapsible panes, and presets the user can save.
  - Layouts are stored server-side.
- **Mobile.** A single pane with bottom tabs for review, notes, library and graph (read-only).
- **Routes.**
  - New routes (`/today`, `/library`, `/read/[id]`, `/questions`, `/graph`, `/review`, `/plan`, `/settings`) under a route group.
  - At release, `/app/*` redirects to them.
  - Legacy `features/` code is removed in v0.3.1.
- **Code layout.** Shared code under `apps/web/src/platform/`; domain modules under `apps/web/src/modules/`.
- **New dependencies.** They must pass the license and candidate security gates:
  - `pdfjs-dist` (Apache-2.0);
  - `cmdk` (MIT);
  - `@tanstack/react-query` (MIT);
  - `@xyflow/react` (MIT), confirmed after a small comparison in R3.

## Security

- pdf.js runs with `isEvalSupported: false`; its worker is served from the same origin; the existing nonce-based CSP is kept.
- No authentication or authorization boundary changes.

## Rollback

`LOGION_RESEARCH_V3_ENABLED` off restores the legacy client at `/app/*`.

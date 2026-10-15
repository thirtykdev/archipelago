# Theming

Requirement, recorded 2026-10-15. Applies to the Archipelago web application
(the operator-facing app that ships with the first release). The Atoll
preview only needs light and dark.

## What end users get

- **Light and dark modes**, following the system by default, switchable.
- **A set of default themes** to pick from: a handful of named presets, each
  a small token set (background, surface, text, muted text, signal, accent),
  tuned for long shifts in a control room: low glare, AA contrast in both
  modes, no pure white on pure black.
- **A color picker** for each token, so a user can start from a preset and
  adjust it. Contrast is checked live and the picker warns below AA.
- **Saved themes** per user: name it, keep several, switch between them.
- **A global starting theme** set by an administrator per site: what a new
  user sees first. Users may change everything about it except identity:
  the site name, the logo and the mark stay as the administrator set them.
- Preferences are per user and stored on the edge (so they follow the user
  between browsers on the LAN), never anywhere else.

## How it is built

- One token set drives the whole app, as CSS custom properties on the root.
  Components never use a literal color. Provenance colors (imported,
  observed, inferred, question, simulated) and status colors (normal, alarm,
  fault, stale) are a separate, fixed set that themes may tint but not
  reassign, so a red alarm is red in every theme.
- A theme is data: `{ mode: 'light' | 'dark' | 'custom', preset?, tokens }`.
  Presets ship with the app; custom themes are rows in the user's settings.
- The administrator's starting theme is one row in site settings. A user's
  own choice overrides it for that user only.
- Type, spacing and density are not part of a theme in the first version;
  a density toggle (comfortable / compact) is a likely follow-up for
  operators who live in point tables.

## Not in scope

Changing the logo, the mark, the site name or the layout per user. Loading
fonts or assets from outside the edge.

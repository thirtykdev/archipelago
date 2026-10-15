# Roadmap

The living version, with status badges, is at
https://www.archipelago-project.org/roadmap/. In order:

0. Foundation: this repository, its checks and CI. In progress.
1. The website. Live.
2. Station-backup importer and CLI: read a backup offline with hardened
   archive and XML handling; station graph with native addresses and
   redacted secrets; coverage report; hostile-file corpus; network-denied
   tests. In the repository, with the controller-file importers (`.caf`,
   `.gfx`), correlation, a simulated connector and the Atoll preview
   runtime. **This is where the repository is now.**
3. Semantic engine, local runtime, BACnet/IP read-only connector, first
   release: equipment instances with provenance, questions, model-driven
   views, snapshot comparison and drift detection, web app with end-user
   theming (presets, color picker, light and dark, per-user saved themes,
   an administrator-set starting theme; see docs/design/theming.md), API,
   MCP tools, signed and checksummed release.
4. More sources: Modbus TCP and RTU; Metasys `.caf`, Distech `.gfx`, Metasys
   SCT export, equipment schedules; an optional Niagara station connector
   after legal review.
5. Operations: floor-plan views, commissioning verification, diagnostics.
6. Optional hosted services, only after an external security review.

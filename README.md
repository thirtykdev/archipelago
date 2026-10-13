# Archipelago

**The building has already been engineered. Why are we engineering it again?**

Archipelago is an open-source, vendor-neutral building automation platform.
It reads the engineering a building already has (controller programs,
station backups, equipment schedules, the network itself), builds a model
in which every fact says where it came from, asks a technician about what
it cannot establish, and generates the supervisory layer from the model.

Website: https://www.archipelago-project.org

## Status

Early. Nothing is released. The first slice of code is here:

```
packages/core             the assertion and provenance types everything else uses
importers/station-file    a hardened reader for station backup files, with a vendor mapping
apps/cli                  `archipelago inspect <file>`: what a backup contains, offline
fixtures/synthetic        generated test stations and a hostile-file corpus
```

`inspect` opens a `.bog` or `.dist` backup in memory, with caps on archive
size and entry count, an XML reader that resolves nothing, and redaction of
passwords before anything is printed. It prints devices, points, histories,
alarms, links, native addresses it found, the types it did not understand,
and what it redacted. It writes nothing and opens no socket.

```bash
npm ci
npm run archipelago -- inspect path/to/backup.dist
npm run archipelago -- inspect path/to/config.bog --json
npm run check          # typecheck, boundary check, fixture check, tests
npm run test:offline   # the test suite with the network turned off (Linux)
```

## Principles

- **Local first.** A self-hosted Archipelago works with the WAN unplugged
  and never phones home. The test suite runs with the network disabled.
- **Provenance on every fact.** Observed, imported, inferred, or confirmed.
  Nothing is overwritten; nothing is invented.
- **Read-only by default.** Connectors read. Writing is a separate
  capability that is off until a named person turns it on.
- **Vendor neutral.** Every brand is an importer or a connector behind one
  interface. None of them is the platform.
- **Clean room.** Written from scratch on synthetic fixtures. No code,
  fixtures, data or branding from any other project, including the founding
  organization's own tools. See CONTRIBUTING.

## Layout rules

`packages/*` never import from `importers/*` or `connectors/*`; the core
never names a vendor. `npm run check:boundaries` enforces it. Fixtures are
synthetic and generated; `npm run check:fixtures` refuses station, controller
and spreadsheet files anywhere else.

## License

GNU Affero General Public License v3.0 (see LICENSE and LICENSING.md). Use
it for anything; if you build on it or run a modified version as a service,
your version is open too.

Archipelago was started by [ThirtyK](https://thirtyk.dev). It is an
independent project, not produced, endorsed or supported by Tridium,
Honeywell, Johnson Controls, Distech Controls or any other manufacturer.
Product names are trademarks of their owners and identify compatible
products only.

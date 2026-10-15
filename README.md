# Archipelago

**The building has already been engineered. Why are we engineering it again?**

Archipelago is an open-source, vendor-neutral building automation platform.
It reads the engineering a building already has (controller programs,
station backups, equipment schedules, the network itself), builds a model
in which every fact says where it came from, asks a technician about what
it cannot establish, and generates the supervisory layer from the model.

Website: https://www.archipelago-project.org

## Status

Early. Nothing is released. What is here:

```
packages/core              assertion and provenance types; the connector interface (read-only by type); correlation
importers/station-file     hardened reader for station backup files (.bog, .dist) with a vendor mapping
importers/controller-file  controller application files (.caf) and graphical controller files (.gfx)
connectors/simulated       the first connector: invents labeled values for every native address, no building needed
connectors/bacnet-ip       BACnet/IP read-only: Who-Is, ReadProperty, object discovery, polling; no write encoder exists
apps/edge                  Atoll, the local runtime: import, correlate, persist, permissions, live values, web UI, first-run setup
apps/cli                   `archipelago inspect <file>` and `archipelago serve [--simulate] [files...]`
fixtures/synthetic         generated stations and controller files, and a hostile-file corpus
```

Import a station backup beside the controller files for the same job and
Atoll correlates them by device instance and object identity: what is in
both, what the controller exposes that the station never pulled in (kept
with its native address, so a local Atoll can read it directly from the
controller), and what the station has that the controller does not. Every
fact is labeled imported, observed, simulated, or a question. Passwords are
replaced before anything is shown. Nothing is written to disk and nothing
leaves the machine.

The controller-file importers are validated on synthetic fixtures only; they
report what they do not understand instead of guessing.

```bash
npm ci
npm run fixtures                                   # writes synthetic sample files to fixtures/synthetic/out
npm run archipelago -- inspect fixtures/synthetic/out/site.dist
npm run archipelago -- serve --simulate fixtures/synthetic/out/site.dist fixtures/synthetic/out/VAV_01.caf
# open http://127.0.0.1:2865
npm run check          # typecheck, boundary check, fixture check, tests
npm run test:offline   # the suite in a container with no network
npm run archipelago -- serve --installed --lab-device --open   # the installed experience: setup screen, two lab BACnet devices
npm run package        # single-file executables in dist/ for macOS, Linux and Windows (downloads Node per platform)
```

## Try it in a lab

Download the file for your platform from the latest lab pre-release, run
it, and it opens the setup screen in your browser. Turn on BACnet/IP with
your lab's broadcast address and Atoll discovers every device and object it
can see, read-only, and polls them. Import the station backup and the
controller files for the same devices and it correlates all three. Add
`--lab-device` to the command line to run two synthetic BACnet devices on
your own machine when there is no hardware around.

Data lives in your user application folder (shown on the setup screen):
an append-only model log and artifacts encrypted at rest. Delete the folder
to remove everything. Nothing leaves the machine.

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

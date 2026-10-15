# Atoll as the system of record ("version control for a building")

Recorded 2026-10-15 from the founder's note. Status: direction, with the
first increments on the roadmap.

## The idea

A building owner installs Atoll on a server they already have, gives it
read access to the BAS devices, and asks everyone who touches the building
for what they should be providing anyway: station backups, controller
programs, drawings, submittals, sequences, commissioning reports. Atoll
ingests all of it, keeps every version with a hash, a time and a name,
shows what changed between deliveries, and makes the whole record
available through a documented API and MCP tools. It runs on the owner's
network with full function forever. Connecting it to a cloud instance the
owner also controls, or to ours, is optional and outbound only.

The record comes first. Understanding the engineering (the model,
inference, generated views) is what Archipelago does with the record once
it exists. The two belong together: get the full record of the building,
then stop re-engineering it.

## Why the current design already is this

- The model is an append-only log of facts with provenance; nothing is
  overwritten; a later fact supersedes and the chain is kept.
- Every import and every answer takes a content-addressed snapshot; diff
  re-identifies renamed and re-handled components instead of reporting
  churn.
- Artifacts are content-addressed and encrypted at rest; documents attach
  to equipment as confirmed facts.
- Every write goes through one authorization function; every change
  carries who and when.
- Nothing leaves the machine unless an administrator enables it.

## What makes it a system of record, not just a store

1. **Intake with accountability.** Per site, the artifacts that are
   expected (a backup of each station, the controller files, the drawing
   set), from whom, and how often. Each delivery is a receipt: hash, size,
   time, who delivered it, what changed since the previous one. An overdue
   list. This is the leverage owners have never had, and it protects the
   contractor as much as the owner.
2. **Pulling, not only receiving.** Where a platform documents a way to
   fetch a backup or an export, Atoll fetches on the cadence, so the
   record does not depend on anyone remembering.
3. **Collateral of every kind.** Sequences, submittals, commissioning
   reports, points lists, photos, meeting notes about the building, all
   attachable to the site, a building, a floor, or a piece of equipment.
4. **Reports a person can hand over.** "Between the April and September
   backups, 23 setpoints changed, 4 alarms were disabled, 2 devices were
   renamed, 1 was removed", as a page and as a file.
5. **Export.** The owner can take the entire record, in open formats
   (JSON for facts, the original artifacts), at any time. No lock-in to
   this software or to us.
6. **Doors, not screens.** The API and the MCP tools are the main way
   other systems use the record. The web UI is a viewer and an intake
   desk.
7. **Fleet, later.** A customer-owned cloud instance mirrors several sites'
   records (outbound only) for the owner who has many buildings.

## Roadmap placement

- Phase 3 adds: expected-artifact registry per site, delivery receipts,
  overdue view, change reports between two snapshots, whole-record export.
- Phase 4 adds: scheduled pulls through documented platform mechanisms,
  per platform, read-only.
- Phase 6 (cloud) is framed as mirroring the record, not as the product.

# ADR 0007: Controller files are imported beside the station, and correlated

Status: accepted · 2026-10-15

## Context
On a job with field controllers under a supervisor, two descriptions of the
same equipment exist: the controller application (what the controller
exposes) and the station (what the supervisor pulled in). They drift. A
point the controller exposes may never have been added to the station.

## Decision
Controller application files (`.caf`, `.gfx` and later others) are
importers like any other: file in, points with native addresses out.
Correlation is vendor-neutral and keyed on native identity (device
instance, object type and instance). For each controller file the model
records: the matching station device, points present in both, points the
controller exposes that the station lacks, and points the station has that
the controller does not. Missing points keep their native address, so a
local edge runtime can read them directly from the controller when the
network routes to it. Nothing is ever added to the station by this process.

## Consequences
The "mirror" is built from both sources with a source on every fact.
Correlation can be wrong (instances renumbered, objects re-mapped) and so it
carries confidence and raises questions rather than asserting.

# ADR 0001: The core knows no vendor

Status: accepted · 2026-10-13

## Context
Archipelago reads engineering from many systems. If the model or the
runtime carried vendor types, every new source would mean changes to the
core, and the first source would become the platform's identity.

## Decision
`packages/*` contain no vendor names and never import from importers or
connectors. Vendor knowledge lives only in `importers/*` (file in, facts
out, offline) and `connectors/*` (live source in, observations out,
read-only by type). A vendor type survives only inside a provenance locator
string. CI enforces the import boundary.

## Consequences
Adding a source is adding a plug-in. The first demonstration can go live
over BACnet/IP using addresses found in any vendor's file. The cost is a
mapping layer per source and a generic model that must be expressive enough
for all of them.

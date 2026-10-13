# ADR 0005: Read-only by type

Status: accepted · 2026-10-13

## Context
Writing to a building is the most dangerous thing the platform could do,
and "a setting that defaults to off" is one misconfiguration away from on.

## Decision
The connector interface has no write method. Writing is a separate
interface that no early connector implements; a connector's descriptor
declares `write: false` and the UI shows no write control. When a writable
session is introduced, enabling it is a per-connector admin action, each
write needs a role that grants it, carries a reason, and is audited.

## Consequences
The first connectors cannot write even if asked. Write support is a visible
design change, not a flag.

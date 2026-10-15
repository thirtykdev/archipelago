# ADR 0006: Read everything, prioritize by use

Status: accepted · 2026-10-15

## Context
Every supervisor makes a technician discover a device and pick which points
to add. The reasons are licensing by point count, polling load, database
size and the habit of cleaning names at add time. None applies here, and
the pick list is itself duplicated engineering: the controller already
knows its objects.

## Decision
Importers create a point for every object a file describes, with its native
address. Connectors enumerate every object a device offers and create a
point for each, read-only, labeled observed. There is no add-points step.
Relevance is inferred by the model (points on a view, with alarm or history
configuration, named like a standard) with provenance and confidence, so it
can be corrected. Load is managed by priority, not exclusion: points in use
get change-of-value or fast polling; the rest a slow poll or on-demand
reads. Noise (device object properties, vendor-proprietary objects) is
classified and hidden by default, never discarded.

## Consequences
More rows, no missing point at two in the morning. The connector's job is
backpressure, not curation. The read-only boundary stays deliberate: reading
everything is safe; writing anything is a separate capability (ADR 0005).

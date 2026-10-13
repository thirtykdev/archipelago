# ADR 0003: Importers are pure, offline and hardened

Status: accepted · 2026-10-13

## Context
Engineering files come from customers and sometimes from strangers. They
can be large, malformed or hostile. A contractor should get value from a
backup on a laptop with nothing connected.

## Decision
An importer is a pure function from bytes to an import result. It opens no
socket, reads no second file, writes nothing to disk and touches no
database. Archives are read in memory with caps on entry count, entry size,
total size and compression ratio. XML is read by our own parser, which
refuses DOCTYPE and resolves no entities. Secrets are redacted before any
output. Formats are detected by content, never by extension.

## Consequences
The same importer runs in a browser, on the edge and in an isolated hosted
job. A hostile-file corpus is part of the test suite. Performance is
bounded by the caps, which are configurable per deployment.

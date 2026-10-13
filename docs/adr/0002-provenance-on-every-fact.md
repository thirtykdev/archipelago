# ADR 0002: Every fact carries its provenance

Status: accepted · 2026-10-13

## Context
A generated BAS is only trustworthy if it can say why it thinks what it
thinks. Importers can over-claim; inference can be wrong; people correct
things.

## Decision
The unit of knowledge is an assertion with exactly one provenance:
observed (connector, native ref, time), imported (artifact hash, locator),
inferred (rule, inputs, confidence), confirmed or rejected (person, time,
superseded assertion). Nothing is overwritten; later assertions supersede.
Inferences below a confidence threshold become questions, never facts.

## Consequences
Every screen and every API response can show the source. Re-imports produce
new snapshots and never replace confirmed facts. Storage holds more rows;
that is the price.

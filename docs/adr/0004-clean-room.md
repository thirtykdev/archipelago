# ADR 0004: Clean room, synthetic fixtures

Status: accepted · 2026-10-13

## Context
The founders have built related tools. Reusing their code or their test
data would entangle ownership, licensing and customer confidentiality with
this project.

## Decision
Archipelago is written from scratch. No code, fixtures, data, branding or
implementation details from other projects, including the founding
organization's own, are copied in. Fixtures are synthetic and generated in
the repository. Knowledge of a file format is recorded as observations with
fixtures and tests.

## Consequences
Slower at first. Unambiguous ownership, a single license story, and a test
corpus anyone can run.

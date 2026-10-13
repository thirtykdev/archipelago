# Contributing

Thank you. The project's direction is set by the work it removes for people
who engineer buildings, so the most valuable contribution is often a
description of a file you have, what it contains, and what Archipelago must
never guess about it. Open a discussion for that.

## Ground rules

1. **Clean room.** Archipelago is written from scratch. Do not copy code,
   fixtures, data, screenshots or implementation details from other
   projects, including the founding organization's own tools. Knowledge of a
   file format is recorded here as observations with synthetic fixtures,
   not as code taken from elsewhere.
2. **Synthetic fixtures only.** Never commit a real station backup,
   controller file, drawing, point list, export or screenshot from a real
   site. `fixtures/synthetic/` holds generators; `npm run check:fixtures`
   refuses station, controller and spreadsheet files anywhere else.
3. **No vendor material.** No SDK jars, no vendor documentation extracts, no
   pasted vendor source. If a change needs vendor knowledge, cite a public
   interface or an observation of a file you were authorized to read.
4. **No vendor software or documentation in AI tools.** If you use an AI
   assistant while contributing, do not feed it vendor software, SDKs or
   documentation. Our own code and fixtures are fine.
5. **Read-only by default stays by default.** A change that adds a write
   path to a building needs a design discussion first.
6. **Offline stays offline.** Nothing in `packages/*` or `importers/*` opens
   a socket. The test suite runs with the network disabled and fails if
   anything tries.

## Developer Certificate of Origin

Every commit is signed off (`git commit -s`), which certifies the
[Developer Certificate of Origin](https://developercertificate.org/): you
wrote the change or have the right to submit it under the package's license.
There is no contributor license agreement.

## Workflow

```bash
npm ci
npm run check        # typecheck, boundaries, fixtures, tests
```

Open a pull request against `main`. Small, focused changes with tests. The
core and the importers get the strictest review because they touch customer
files.

## Layout

- `packages/*`: pure libraries, no I/O, no vendor names. May not import from
  importers or connectors.
- `importers/*`: file in, facts out, offline. May import from `packages/*`.
- `connectors/*` (later): live source in, observations out, read-only by
  type.
- `apps/*`: the CLI today; the edge, web and hosted apps later.

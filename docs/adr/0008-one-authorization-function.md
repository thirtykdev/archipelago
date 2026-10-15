# ADR 0008: One authorization function; permissions are facts in the model

Status: accepted · 2026-10-15

## Context
Operators, technicians, engineers and administrators will reach the system
from the web app, the API, MCP tools and, in a multi-site deployment, from
any node. Everything should be adjustable from anywhere by anyone who holds
the right permission, and nothing should be adjustable by anyone else.
Bolting permissions onto features afterwards produces inconsistent gates.

## Decision
- **Capabilities, not feature flags.** Every action the system can take is
  named as a capability (`model.read`, `questions.answer`, `facts.confirm`,
  `config.import`, `config.connectors`, `config.theme`, `points.write`,
  `admin.users`, `admin.site`). New features add capabilities; they never
  invent their own checks.
- **One function.** `can(principal, capability, scope)` in `packages/core`
  is the only authorization decision. The web app uses it to decide what to
  show; the server, the API and MCP call it again before acting. The UI
  never being the boundary is a rule, not a convention.
- **Roles are bundles of capabilities** (viewer, operator, technician,
  engineer, administrator), and a principal may hold several, each with a
  **scope**: the whole site, or a subtree (a building, a network, a piece of
  equipment) by entity path. Scopes make "the night operator may answer
  questions on building B" expressible without a new role.
- **Permissions are facts.** A principal's roles and scopes are assertions
  on a `user|<id>` subject with `confirmed` provenance naming the
  administrator who granted them. They replicate with the model, so every
  node evaluates the same facts locally, and every grant and revocation is
  in the history with a name and a time.
- **Writes to a building stay separate** (ADR 0005): `points.write` exists
  as a capability but no connector implements writing yet; granting it is
  an explicit, audited act and each write carries a reason.
- **Identity is pluggable.** Today the preview takes an identity header;
  the first release adds local accounts and sessions; later, an identity
  provider. The authorization function does not care where the principal
  came from.

## Consequences
Every endpoint and every tool declares the capability it needs. Tests
assert that a viewer cannot do what a technician can. Adding a feature
means adding a capability and a check, which is one line each. The cost is
that "just let me click it" during development goes through the same gate.

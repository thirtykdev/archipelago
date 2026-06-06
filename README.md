# Archipelago

**An open bridge between building automation systems and the tools that should have always been able to talk to them.**

[archipelago-project.org](https://archipelago-project.org)  ·  Licensed under AGPL v3

-----

## What This Is

Building automation systems have been islands and silos for decades (many by design). Proprietary protocols, vendor-locked platforms, and closed data formats have kept building intelligence locked inside systems that were never designed to share. Getting data out - let alone acting on it - requires expensive middleware, platform licenses, or accepting that your building just won’t talk to anything outside its own ecosystem.

Archipelago is an attempt to change that.

It is a lightweight, open-source data bridge that connects Niagara Framework stations and BACnet/IP devices to the broader world: time-series databases, analytics platforms, AI agents, or anything else that speaks HTTP or MQTT. It cutrently consists of two parts: a Niagara module that runs inside the station and exposes a clean REST API, and a server-side stack that ingests that data, stores it, and makes it queryable.

The goal is not to replace your BAS. It is to make your BAS a first-class data citizen.

-----

## Why This Exists

The controls industry has a deep tradition of craftsmanship - careful point mapping, thoughtful alarm philosophy, system logic that accounts for real building behavior. That work deserves better infrastructure than it has. Analytics platforms exist, but they are expensive, opaque, and require ongoing licenses. Open-source BAS tooling is sparse. Most integrators who want to build something meaningful end up reinventing the same plumbing over and over, in isolation.

Archipelago is built on the premise that the infrastructure layer should be free, documented, and forkable - so that the people who actually understand buildings can spend their time building things that matter.

-----

## Architecture

```
Niagara Station
└── Archipelago Module (Java/Niagara)
    ├── REST API (reads, writes, point discovery)
    ├── OpenAPI spec at /api/openapi.json
    └── Swagger UI at /api/docs

        │ HTTP
        ▼

Archipelago Server (Docker)
├── Ingest layer (Python / bacpypes3)
├── Message broker (Mosquitto MQTT)
├── Time-series store (TimescaleDB)
└── Query API (FastAPI)

        │
        ▼

Your tools: dashboards, AI agents, analytics, automation
```

### The Niagara Module

A Niagara 4 module that installs as a station service. Once running, it automatically walks the station tree and exposes all discoverable points through a REST API - no manual point mapping required. Writeable points are writeable via the API. Read-only points are read-only. Metadata, units, and status come along for free.

The API is self-documenting via an OpenAPI spec, so anything that can read a Swagger definition can understand what your station exposes.

### The Server Stack

A containerized server environment that receives data from one or more stations, stores it in TimescaleDB, and makes it available through a query API. Designed to run on modest hardware - a small VM, a local server, or a machine on the OT network. Wherever *you* want to deploy it. 

-----

## Stack

|Layer               |Technology                   |
|--------------------|-----------------------------|
|Niagara module      |Java 8, Niagara Framework 4.x|
|BACnet communication|bacpypes3                    |
|Message broker      |Mosquitto MQTT               |
|Time-series database|TimescaleDB (PostgreSQL)     |
|Server API          |FastAPI (Python)             |
|Frontend (planned)  |React + Vite                 |
|Containerization    |Docker / Docker Compose      |

-----

## Goals

- **No manual point mapping.** Drop the module in, and it discovers what’s there.
- **Bidirectional.** Read present values and histories. Send commands with priority levels.
- **Self-documenting.** OpenAPI spec ships with the module. Point metadata is part of the API response.
- **Semantics-ready.** Designed to work well with Haystack and Brick tagging, but does not require them.
- **Local-first.** Everything can run on your network. No cloud dependency, no data leaving the site unless you choose.
- **Composable.** The bridge layer is deliberately thin. What you build on top is up to you.

-----

## What You Can Build With This

- A time-series record of your building’s behavior, owned by you
- Fault detection and diagnostics without a platform license
- Natural language queries against live building data
- Custom dashboards that pull from real point data
- AI agents that can reason about building state and act on it
- Multi-site aggregation without proprietary middleware

-----

## Status

Early development. The module servlet pattern and station tree traversal are proven. The server-side ingest and storage layer is in active development. Not yet production-ready.

Contributions, questions, and use cases are welcome.

-----

## For BAS Professionals

If you work in building controls and you’re not a developer - this project is still for you, eventually. The goal is a system where you configure what matters and get answers back in plain language. The data bridge is the foundation that makes that possible.

If you’re a developer who doesn’t know BAS - building automation systems are large distributed control systems managing HVAC, lighting, access, and energy across commercial and industrial buildings. The protocols are real (BACnet, LON, Modbus), the data is rich, and the tooling has been surprisingly closed for a long time. There’s meaningful work to do here.

-----

## License

GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).

This means: use it freely, modify it, deploy it. If you distribute a modified version or run it as a service, your modifications stay open. You cannot incorporate this into a closed-source proprietary product.

-----

## Code Signing

Niagara module releases are signed with a ThirtyK Development LLC code signing certificate. Unsigned builds are available for development use.

-----

*Archipelago is built by people who think the controls industry deserves better infrastructure. If that resonates, come help build it.*

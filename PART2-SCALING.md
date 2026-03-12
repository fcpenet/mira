# Part 2: Deployment and Horizontal Scaling Strategy

---

## Overview

The platform is stateless by design — any server instance can handle any request. State that must be shared across instances (real-time event routing, session presence) is delegated to Redis. This is the foundational requirement for horizontal scaling: add more servers, point them at the same Redis and PostgreSQL, and capacity increases linearly.

---

## Current Deployment (docker-compose)

Two application server instances sit behind an Nginx load balancer:

```
               ┌─────────────────┐
               │   Nginx :3000   │
               │  ip_hash sticky │
               └────────┬────────┘
               ┌─────────┴─────────┐
          ┌────┴────┐         ┌────┴────┐
          │  app1   │         │  app2   │
          │  :3001  │         │  :3002  │
          └────┬────┘         └────┬────┘
               └─────────┬─────────┘
             ┌───────────┴───────────┐
          ┌──┴──┐               ┌───┴───┐
          │Redis│               │  PG   │
          └─────┘               └───────┘
```

Both instances share:
- **Redis** — pub/sub channel `mira:events`, socket.io adapter state
- **PostgreSQL** — single source of truth for all persistent data

---

## Why Two Clients per Instance (publisher + subscriber)

Redis does not allow a client in `subscribe` mode to also issue `publish` commands — a subscribed connection enters a read-only state. Each instance therefore maintains two separate Redis clients:

| Client | Role |
|--------|------|
| `publisher` | Used by `POST /events/ingest` to publish events after writing to PostgreSQL |
| `subscriber` | Used by the socket.io Redis adapter to receive events and fan them out to local WebSocket connections |

The adapter internally handles the deduplication: if two instances are both in the same org room, Redis delivers the message once to each adapter, and each adapter emits to its local sockets only.

---

## Real-Time Fanout — How It Works Across Instances

The critical correctness requirement is: **a device event published by a request hitting instance 1 must reach a mobile client connected to instance 2**.

The mechanism:

```
MAGUS Device
    │
    ▼  POST /events/ingest → instance 1
    │
    ├─► INSERT INTO events (PostgreSQL)
    │
    └─► publisher.publish('mira:events', { event, device })
            │
            ▼  Redis broadcasts to ALL subscribers
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
instance 1      instance 2
subscriber      subscriber
    │               │
    ▼               ▼
io.to('org:X')  io.to('org:X')
.emit('event')  .emit('event')
    │               │
    ▼               ▼
clients on 1    clients on 2
 in org X room   in org X room
```

Both instances emit to their local sockets; clients connected to either instance receive the event. No inter-instance HTTP calls, no shared in-memory state.

---

## Sticky Sessions and Why They Are Required

Nginx is configured with `ip_hash` — requests from the same IP always route to the same upstream server. This is necessary for socket.io's HTTP long-polling fallback (used when WebSocket is unavailable).

The socket.io connection upgrade sequence:
1. Client opens HTTP long-poll to negotiate the session ID
2. Client upgrades the same session to WebSocket

Both requests (steps 1 and 2) must hit the same server. If they hit different instances, the second instance has no record of the session from step 1 and the upgrade fails.

**With WebSocket directly** (no polling fallback), stickiness is not strictly required — the WebSocket connection stays open on one instance for its lifetime. `ip_hash` is retained as a safety net for clients that cannot establish a direct WebSocket connection.

---

## Scaling to More Instances

To add a third server instance:

1. Add `app3` to `docker-compose.yml` (identical to `app1`, `app2`)
2. Add `server app3:3000` to the `nginx.conf` upstream block

No code changes. No Redis reconfiguration. No database schema changes. The new instance subscribes to the same Redis channel and joins the same PostgreSQL connection pool.

**The scaling ceiling** at each layer:

| Layer | Ceiling | Next action |
|-------|---------|-------------|
| Application servers | ~10K concurrent WebSocket connections per Node.js instance (tunable) | Add more instances |
| Nginx | ~50K concurrent connections (single process, 1 CPU) | Switch to HAProxy or AWS ALB |
| Redis pub/sub | ~100K messages/sec on a single node (measured) | Redis Cluster or Valkey |
| PostgreSQL | ~500–1000 concurrent connections | PgBouncer connection pooler; read replicas for query offload |

---

## Scaling PostgreSQL

PostgreSQL has a hard connection limit (~100 default, tunable to ~500 before RAM becomes the constraint). Lambda and Node.js workloads both create many short-lived connections. Two mitigations:

**Connection pooling (immediate):** The `pg.Pool` in `src/db/index.js` maintains a persistent pool per instance (default 10 connections). 10 instances × 10 connections = 100 connections — within PostgreSQL's limit for typical deployments.

**PgBouncer (at scale):** If instances scale beyond ~50, add PgBouncer in transaction-pooling mode. PgBouncer multiplexes hundreds of application connections through a small number of PostgreSQL server connections. The application sees no change — it still connects to `DB_HOST`; PgBouncer is a transparent proxy.

**Read replicas:** Event history queries (`GET /events`) are read-heavy. A PostgreSQL streaming replica can offload these queries, freeing the primary for writes. The application would route SELECT queries to the replica endpoint and writes to the primary. With connection pooling via PgBouncer, this is a two-line config change.

---

## Row-Level Security at Scale

RLS is enforced at the database layer regardless of how many application instances are running. Every query in `queryAsOrg()` sets `app.current_org_id` in the session before executing. PostgreSQL evaluates the RLS policy on every row — no application-level filtering can override it.

This means that as instances scale out, the security guarantee does not degrade. A misconfigured instance that forgets to scope a query will receive an empty result set (or an error), not another organization's data.

---

## Production Deployment Targets

The docker-compose setup maps directly to production deployment patterns:

| docker-compose component | AWS equivalent | Notes |
|--------------------------|----------------|-------|
| `app1`, `app2` | ECS Fargate tasks (auto-scaling group) | Set desired count to 2, max to N |
| Nginx | Application Load Balancer (ALB) | ALB natively supports sticky sessions via cookie |
| Redis | Amazon ElastiCache (Redis OSS) | Multi-AZ replication group for HA |
| PostgreSQL | Amazon RDS PostgreSQL | Multi-AZ standby for failover; read replica for query offload |

The only change required to move from docker-compose to ECS is replacing environment variables (currently in `.env`) with AWS Secrets Manager references in the task definition.

---

## Failure Modes

| Failure | Impact | Recovery |
|---------|--------|----------|
| One app instance crashes | Active WebSocket connections on that instance drop; clients reconnect to other instances via Nginx; no data loss | Container restart (ECS replaces failed task in ~30s) |
| Redis unavailable | New events cannot be fanned out to WebSocket clients; REST endpoints (including ingest) continue working; events are still persisted to PostgreSQL | Redis restart; clients miss events during outage window |
| PostgreSQL unavailable | All requests fail (503); no events stored | RDS Multi-AZ failover (~60s); application retries |
| Nginx unavailable | All external traffic blocked | Replace Nginx with AWS ALB in production (managed, HA) |

---

*Prepared by Kiko — MIRA Technologies Technical Exam, Part 2*

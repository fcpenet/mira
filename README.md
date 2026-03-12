# Part 2 — MIRA Real-Time Event Platform

A working prototype of MIRA's real-time event platform built with **Express.js**, **socket.io**, **PostgreSQL**, and **Redis pub/sub**.

---

## What It Does

- Devices (MAGUS sensors) POST security events to `/events/ingest` using an API key
- Events are written to PostgreSQL and published to a Redis channel
- All connected mobile clients subscribed to the same organization receive the event over WebSocket in real time — even if they are connected to a different server instance
- Two server instances run behind Nginx to demonstrate horizontal scaling

---

## Architecture

See `part2-architecture-diagram.html` for the visual diagram and `PART2-SCALING.md` for the full scaling strategy.

**Key design decisions:**
- `publisher` and `subscriber` are separate Redis clients — Redis requires this for pub/sub
- socket.io uses the `@socket.io/redis-adapter` so events reach clients on any instance
- Nginx `ip_hash` provides sticky sessions for socket.io's HTTP upgrade handshake
- PostgreSQL Row-Level Security enforces tenant isolation at the database layer; the app sets `app.current_org_id` per query via `queryAsOrg()`

---

## Running Locally

**Prerequisites:** Docker and Docker Compose

```bash
cd part2

# 1. Copy environment file
cp .env.example .env

# 2. Build and start all services
docker compose up --build

# Server is available at http://localhost:3000
# Instance 1 directly at :3001, Instance 2 at :3002
```

---

## API Reference

### Authentication

#### Register a user
```
POST /auth/register
Content-Type: application/json

{
  "email": "operator@mira.com",
  "password": "securepassword",
  "orgId": "00000000-0000-0000-0000-000000000001",
  "role": "operator"
}
```

#### Login
```
POST /auth/login
Content-Type: application/json

{ "email": "operator@mira.com", "password": "securepassword" }

→ { "token": "<jwt>", "user": { ... } }
```

All subsequent requests require: `Authorization: Bearer <token>`

---

### Devices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/devices` | JWT | List all devices in org |
| `GET` | `/devices/:id` | JWT | Get a single device |
| `POST` | `/devices` | JWT (admin) | Create device — returns `api_key` (shown once) |
| `PATCH` | `/devices/:id` | JWT (admin/operator) | Update name or status |
| `DELETE` | `/devices/:id` | JWT (admin) | Delete device |

#### Create a device
```
POST /devices
Authorization: Bearer <admin-token>

{ "name": "Front Door Sensor", "type": "sensor" }

→ { "device": { "id": "...", "api_key": "abc123...", ... } }
```

---

### Events

#### Ingest an event (device-side)
```
POST /events/ingest
X-Device-Key: <api_key from device creation>

{ "type": "motion_detected", "severity": "high", "payload": { "zone": "A1" } }

→ 202 { "eventId": "..." }
```

#### Query event history (user-side)
```
GET /events?severity=high&limit=20
Authorization: Bearer <jwt>

→ { "events": [ ... ], "limit": 20, "offset": 0 }
```

---

### WebSocket

Connect with a valid JWT:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: '<jwt>' }
});

// All events from your organization
socket.on('event', (data) => {
  console.log(data.event, data.device);
});

// High/critical severity only
socket.on('alert', (data) => {
  console.log('ALERT:', data.event.severity, data.event.type);
});
```

On connection, the server automatically joins the client to `org:{orgId}` — clients only receive events for their own organization.

---

## Project Structure

```
part2/
├── src/
│   ├── config/index.js          # Environment configuration
│   ├── db/
│   │   ├── index.js             # pg Pool + queryAsOrg (RLS scoping)
│   │   └── migrations/
│   │       └── 001_init.sql     # Schema: orgs, users, devices, events + RLS
│   ├── redis/index.js           # publisher + subscriber clients
│   ├── middleware/
│   │   ├── auth.js              # JWT verify, requireRole
│   │   └── errorHandler.js      # Express error handler
│   ├── routes/
│   │   ├── auth.js              # POST /auth/register, POST /auth/login
│   │   ├── devices.js           # CRUD /devices
│   │   └── events.js            # POST /events/ingest, GET /events
│   ├── socket/index.js          # socket.io + Redis adapter + org rooms
│   ├── app.js                   # Express app
│   └── server.js                # HTTP server + migration runner
├── Dockerfile
├── docker-compose.yml           # 2x app + Nginx + PostgreSQL + Redis
├── nginx.conf                   # ip_hash sticky sessions + WS upgrade
├── .env.example
├── PART2-SCALING.md             # Horizontal scaling strategy
└── part2-architecture-diagram.html
```

---

## Roles

| Role | Can do |
|------|--------|
| `admin` | All CRUD, create/delete devices |
| `operator` | View devices/events, update device status, ingest events |
| `viewer` | Read-only: view devices and events |

---

*Prepared by Kiko — MIRA Technologies Technical Exam, Part 2*

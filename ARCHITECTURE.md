# FleetCaring — System Architecture

This document is the source of truth for how the three FleetCaring apps
(customer app, pilot app, admin panel) and the backend fit together. It
consolidates the architecture discussion that happened before this backend
was scaffolded.

## 1. System overview

```
┌──────────────┐   ┌───────────────┐   ┌────────────────────┐
│ FleetCaring  │   │ Pilot App     │   │ Admin Panel (web)  │
│ (customer,   │   │ (React Native,│   │ (React/Next.js)    │
│  Expo/RN)    │   │ offline-first)│   │                    │
└──────┬───────┘   └──────┬────────┘   └─────────┬──────────┘
       │ REST + WS        │ REST + WS            │ REST + WS
       ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  Fastify API (modular monolith)             │
│  auth │ catalog │ zones │ timeslots │ orders │ shipments    │
│  pilots │ shifts │ admin/rbac │ payments │ notifications    │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │ REST routes│  │ WS Gateway  │  │ BullMQ workers      │   │
│  └─────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
└────────┼────────────────┼────────────────────┼──────────────┘
         │                │                    │
         ▼                ▼                    ▼
  ┌─────────────┐  ┌───────────────┐   ┌─────────────────┐
  │ Neon        │  │ Redis (TCP)   │   │ Redis (BullMQ)  │
  │ Postgres +  │  │ pub/sub for   │   │ same instance   │
  │ PostGIS     │  │ WS fan-out    │   │                 │
  └─────────────┘  └───────────────┘   └─────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  Third-party services                                      │
│  Twilio (OTP/SMS) │ Stripe (payments) │ Firebase FCM (push)│
│  Cloudflare R2 (photo/document storage, S3-compatible)     │
└────────────────────────────────────────────────────────────┘
```

**Deployment target:** Railway for the Fastify app (needs to hold
persistent WebSocket connections — rules out pure serverless/edge
platforms) + Railway Redis (real TCP, not a REST-based serverless Redis,
since both pub/sub and BullMQ need a persistent TCP connection) + Neon for
Postgres.

Single modular monolith, not microservices. Module boundaries in the
folder structure (`src/modules/*`) make it splittable later if it's ever
needed, but a monolith is the right call at this team size.

## 2. Technology stack

| Layer | Choice |
|---|---|
| API framework | Fastify + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Neon) + PostGIS extension |
| Cache / pub-sub / queues | Redis (Railway), BullMQ |
| Auth tokens | JWT (access + refresh), rotation on refresh |
| OTP / SMS | Twilio Verify API |
| Payments | Stripe (PaymentIntents + saved payment methods, webhooks) |
| Push notifications | Firebase Cloud Messaging (FCM) |
| File/photo storage | Cloudflare R2 (S3-compatible), presigned direct-upload URLs |
| Admin panel frontend | React (Next.js) + Mapbox GL Draw for zone fencing |
| Real-time transport | Native WebSockets (`@fastify/websocket`), fanned out via Redis pub/sub |

## 3. Auth architecture — three distinct actor types

Three separate identity tables (`User` for customers, `Pilot`, `AdminUser`)
rather than one unified table — they have genuinely different auth
methods, session lifetimes, and security postures.

- **Customer**: phone + OTP only (Twilio Verify)
- **Pilot**: phone + OTP *or* email + password (per the pilot app's sign-in screen)
- **Admin**: email + password only, plus a `roleId` carried in the JWT for RBAC

**Token flow (same shape for all three actor types):**
- Access token: short-lived JWT (15 min), payload `{ sub, actorType, roleId? }`
- Refresh token: opaque random string; only its SHA-256 hash is stored
  server-side; 30-day expiry; **rotated on every use** (old one revoked,
  new one issued) — protects against a leaked refresh token being reused
  silently
- Every protected route declares which `ActorType`(s) it accepts via a
  Fastify `preHandler` — a customer token can never touch a pilot route
  even if attempted, enforced at the middleware layer

**OTP via Twilio Verify** — Twilio handles code generation, expiry, and
rate-limiting server-side. The API only calls `verifications.create()` to
send and `verificationChecks.create()` to check; no custom OTP
storage/expiry logic to get wrong.

## 4. Admin panel RBAC — department-based

Permissions are stored in the database (`Permission`, `AdminRole`,
`RolePermission`) rather than hardcoded, so new departmental roles can be
added without a code deploy.

Starting roles:

| Role | Permissions (examples) |
|---|---|
| Super Admin | `*` (everything) |
| Operations Manager | `zones:*`, `timeslots:*`, `shifts:*`, `assets:*`, `pilots:read` |
| Dispatch / Support | `orders:*`, `shipments:*`, `issues:*`, `pilots:read`, `customers:read` |
| Pricing & Catalog | `catalog:*`, `pricing:*` |
| Finance | `payments:read`, `finance:refund`, `finance:reports` |
| HR | `pilots:*` (onboarding, status) — no order/financial access |
| Analytics (read-only) | `*:read` only, no write permissions anywhere |

A `preHandler` checks the admin's role permissions against the route's
required permission key before the handler runs — a Finance user cannot
hit a `zones:write` endpoint even with a valid token.

## 5. Offline sync architecture — pilot app

Actions that must survive a dead zone: shift start/end, break start/end,
order enroute, arrival confirm, pre-check/post-check submission (with
photos), issue raising, item completion.

**Client side:**
- Local action queue (WatermelonDB or SQLite via `expo-sqlite`) — every
  mutating action writes a queued row first (`{ id, actionType, payload,
  status }`) and the UI updates optimistically immediately
- Every queued action carries a **client-generated idempotency key** (the
  queue row's own `id`) — this is what makes retries safe
- Photos saved to local filesystem immediately; upload to R2 is a
  separate queued sub-task decoupled from the check submission itself
- Background sync loop listens for connectivity (`@react-native-community/netinfo`)
  and drains the queue FIFO, one request at a time per lane, on reconnect
  and periodically while online

**Server side:**
```prisma
model IdempotencyRecord {
  id           String   @id @default(uuid()) // same value as the client queue entry id
  actorType    ActorType
  actorId      String
  endpoint     String
  responseBody Json?
  createdAt    DateTime @default(now())

  @@unique([actorType, actorId, id])
}
```
Every mutating pilot endpoint requires an `Idempotency-Key` header. A
repeated key returns the *stored* response without re-executing — this is
what makes a flaky-signal retry harmless.

**Conflict handling:** the server validates state transitions (e.g.
rejects `IN_PROGRESS → COMPLETED` if `PRE_CHECK_DONE` was never recorded)
rather than trusting the client blindly. Invalid transitions are logged
and surfaced to the pilot as a sync error requiring manual resolution.

## 6. Zone fencing (admin panel)

Admin draws a polygon in Mapbox GL Draw → exported as GeoJSON →
`POST /admin/zones` with `{ name, code, boundary: GeoJSON }`. Prisma can't
write geometry columns directly, so this goes through raw SQL:

```ts
await prisma.$executeRaw`
  INSERT INTO "Zone" (id, code, name, boundary, "isActive")
  VALUES (${id}, ${code}, ${name}, ST_GeomFromGeoJSON(${JSON.stringify(boundary)}), true)
`;
```

Server-side validation before saving: reject self-intersecting polygons,
and check for overlap with existing active zones (`ST_Overlaps`) so ops
can't accidentally double-cover the same streets with two zones.

## 7. Push notifications and background jobs

BullMQ workers:
- `timeslot-materializer` — nightly, rolls the `TimeslotTemplate` window
  forward into concrete dated `Timeslot` rows
- `location-ping-downsampler` — throttles high-frequency pilot location
  pings down to the retained history cadence
- `push-dispatcher` — order/shipment status change → FCM push to the
  relevant device tokens
- `stripe-webhook-processor` — Stripe webhooks land in a queue first,
  processed idempotently, so a slow handler never risks Stripe's
  retry/timeout behavior
- `break-timer-monitor` — flags a pilot whose break countdown has expired
  but hasn't tapped back on-duty

## 8. Core domain model summary

- **Catalog**: `Vertical` → `Brand` (optional) → `OpItem` → `ItemVariation`
  (the actual priceable/bookable SKU), with `PriceRule` for zone/time-based
  overrides layered on top of the base price
- **Zones**: real PostGIS polygons, not bounding boxes
- **Timeslots**: `TimeslotTemplate` (recurring definition) materializes
  into concrete `Timeslot` rows per date, each with its own
  capacity/buffer/bookedCount and an append-only `TimeslotCapacityLog`
- **Orders vs. Shipments**: one `Order` per checkout; one `Shipment` per
  **(vehicle × item variation)** pair within that order — a single vehicle
  can have multiple line items (e.g. wash + sunshade), each tracked
  independently
- **Shipment lifecycle**: `CREATED → ASSIGNED → ON_THE_WAY → ARRIVED →
  PRE_CHECK_PENDING → PRE_CHECK_DONE → IN_PROGRESS → POST_CHECK_PENDING →
  POST_CHECK_DONE → COMPLETED` (or `ISSUE_RAISED` / `CANCELLED` as
  terminal alternatives)
- **Order completion gate**: an order can only be marked complete once
  every one of its shipments is `COMPLETED` or has an `Issue` raised
  against it — enforced server-side, not just a UI disabled-state
- **Checks**: `VehicleCheck` rows (one `PRE`, one `POST` per shipment),
  each with photos (min. 2 enforced at the API layer) and notes, and
  **immutable once confirmed** — the API rejects updates after
  `confirmedAt` is set
- **Pilots**: `Shift` (pilot + asset + zone + time range) containing
  `ShiftActivity` entries and an append-only `ShiftEvent` timeline;
  `PilotBreak` tracks break reason + countdown budget; live location split
  between `PilotLiveLocation` (current position, cheap upsert) and
  `PilotLocationPing` (throttled history for playback/audit)

## 9. Build order

1. Fastify project scaffold + full Prisma schema + Docker Compose
   (Postgres+PostGIS, Redis) + migrations — **this document's companion PR**
2. Auth module (all three actor types, JWT, refresh rotation, Twilio OTP,
   RBAC middleware)
3. Catalog + Zones + Pricing
4. Timeslots (template + materialization job)
5. Orders/Shipments/Checks/Issues (the core transactional core)
6. Pilots/Shifts/Breaks
7. Payments (Stripe)
8. Real-time layer (WS gateway + Redis pub/sub) + FCM
9. Offline sync support on the pilot app, wired against the now-idempotent
   endpoints

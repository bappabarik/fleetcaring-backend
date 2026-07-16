# FleetCaring Backend

Fastify + TypeScript + Prisma + PostgreSQL(PostGIS) + Redis. See
`ARCHITECTURE.md` for the full system design this scaffold implements.

## Progress

- ✅ **Step 1**: Project scaffold, full Prisma schema, Docker Compose, Fastify plumbing
- ✅ **Step 2**: Auth module — JWT for all 3 actor types, refresh rotation, Twilio OTP (with dev fallback), RBAC middleware
- ⬜ Step 3 onward: catalog, zones, timeslots, orders/shipments, pilots/shifts, payments, real-time — see `ARCHITECTURE.md` §9

## Setup

```bash
npm install
cp .env.example .env
# edit .env — at minimum set a real JWT_ACCESS_SECRET

docker compose up -d          # starts Postgres+PostGIS and Redis
npx prisma migrate dev --name init   # creates the database schema
npx prisma generate            # generates the typed Prisma client

npm run dev                    # starts the API on http://localhost:4000
```

Check it's working:
```bash
curl http://localhost:4000/health
curl http://localhost:4000/health/deep   # also pings Postgres + Redis
```

## Auth module — what it does

Three separate login flows, one shared token shape:

| Actor | Endpoints |
|---|---|
| Customer | `POST /auth/customer/otp/request`, `POST /auth/customer/otp/verify` |
| Pilot | `POST /auth/pilot/otp/request`, `POST /auth/pilot/otp/verify`, `POST /auth/pilot/login` (email/code + password) |
| Admin | `POST /auth/admin/login` (email + password) |
| Shared | `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (protected, any actor) |

**Twilio isn't required for local dev yet** — if `TWILIO_ACCOUNT_SID`/
`TWILIO_AUTH_TOKEN`/`TWILIO_VERIFY_SERVICE_SID` aren't set in `.env`, OTP
requests log the fixed code `0000` to the console instead of sending a
real SMS, so you can test the whole flow before setting up a Twilio
account. Once you add real Twilio credentials, it switches to sending
actual SMS automatically — no code change needed.

**RBAC**: `requireActor("CUSTOMER", "PILOT")` gates a route to only those
actor types; `requirePermission("zones:write")` gates an admin route to
only roles with that permission key (or the `"*"` wildcard). Both are
plain Fastify `preHandler`s — see `src/modules/auth/rbac.middleware.ts`.

## Verification notes (please read before reporting issues)

I tested as much of this as my sandboxed environment allows:

- **Genuinely verified, with real running services**: Postgres 16 +
  PostGIS 3.4 (installed and running locally, confirmed `SELECT
  PostGIS_version()`), Redis (full ping + set/get round-trip through the
  actual `ioredis` plugin code), bcrypt password hashing (real hash/verify
  round-trip, wrong-password rejection), refresh token generation/hashing
  (real crypto round-trip), and — most importantly — **the actual RBAC/JWT
  middleware** (`src/modules/auth/rbac.middleware.ts`) via
  `npm run smoke:rbac`, which signs real JWTs and hits the real middleware
  through a real (if temporary) Fastify instance: no-token rejection,
  correct-actor-type acceptance, wrong-actor-type rejection, missing-
  permission rejection, exact-permission acceptance, and wildcard
  super-admin acceptance — all 6 cases pass.
- **NOT verified, and this matters**: anything in `auth.service.ts` that
  calls `this.prisma.user.*`, `this.prisma.pilot.*`,
  `this.prisma.adminUser.*`, or `this.prisma.refreshToken.*`. My sandbox's
  network policy blocks `binaries.prisma.sh`, so I cannot run `prisma
  generate` and get a real typed client — the client currently installed
  is an unresolved placeholder whose types are declared as `any`, which
  means TypeScript did **not** actually check field names, `include`
  shapes, or enum values in that file against the real schema. This is a
  meaningfully different (weaker) situation than "type-checks cleanly" —
  I want to be precise about that rather than overstate confidence.

**Please run this as your real first step**, and paste me anything it
reports:
```bash
npx prisma migrate dev --name init
npx prisma generate
npm run typecheck
```
If `auth.service.ts` has any field-name or relation-shape mismatch against
the real schema, this is where it'll surface, and I'll fix it immediately.

## Project structure

```
prisma/
  schema.prisma        # the full data model
scripts/
  smoke-test-rbac.mts   # DB-independent RBAC/JWT verification (npm run smoke:rbac)
src/
  config/
    env.ts              # zod-validated environment variables
  plugins/
    prisma.ts            # decorates fastify.prisma
    redis.ts              # decorates fastify.redis
  lib/
    errors.ts             # typed error classes -> HTTP status mapping
    passwords.ts           # bcrypt hashing
    tokens.ts               # refresh token generation/hashing
    twilio.ts                # OTP send/check, with dev fallback
  modules/
    auth/
      auth.schemas.ts        # zod request validation
      auth.service.ts         # login/token logic per actor type
      auth.routes.ts           # route definitions
      rbac.middleware.ts        # requireActor / requirePermission
  types/
    auth.ts                # JwtPayload, AuthTokenPair
    fastify-jwt.d.ts        # wires JwtPayload into @fastify/jwt's typing
  app.ts                  # builds the Fastify instance, registers everything
  server.ts               # entry point, starts listening
```

## Next step

Step 3 (per `ARCHITECTURE.md`): Catalog + Zones + Pricing.


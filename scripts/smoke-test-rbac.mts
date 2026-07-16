import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { requireActor, requirePermission } from "../src/modules/auth/rbac.middleware.js";

const app = Fastify({ logger: false });
await app.register(jwt, { secret: "test-secret-at-least-16-chars" });

// Minimal routes exercising the exact same middleware used in production
app.get("/customer-only", { preHandler: requireActor("CUSTOMER") }, async (request) => {
  return { ok: true, actor: request.user };
});

app.get("/admin-zones-write", { preHandler: requirePermission("zones:write") }, async () => {
  return { ok: true };
});

await app.ready();

// --- Test 1: no token at all -> 401 ---
const noToken = await app.inject({ method: "GET", url: "/customer-only" });
console.log("No token -> 401:", noToken.statusCode === 401);

// --- Test 2: valid CUSTOMER token on customer-only route -> 200 ---
const customerToken = app.jwt.sign({ sub: "user-1", actorType: "CUSTOMER" });
const customerOk = await app.inject({
  method: "GET",
  url: "/customer-only",
  headers: { authorization: `Bearer ${customerToken}` },
});
console.log("Valid customer token on customer route -> 200:", customerOk.statusCode === 200);
console.log("  payload round-trips correctly:", JSON.parse(customerOk.body).actor.sub === "user-1");

// --- Test 3: valid PILOT token on customer-only route -> 403 (wrong actor type) ---
const pilotToken = app.jwt.sign({ sub: "pilot-1", actorType: "PILOT" });
const pilotOnCustomerRoute = await app.inject({
  method: "GET",
  url: "/customer-only",
  headers: { authorization: `Bearer ${pilotToken}` },
});
console.log("Pilot token on customer-only route -> 403:", pilotOnCustomerRoute.statusCode === 403);

// --- Test 4: admin token WITHOUT the right permission -> 403 ---
const adminNoPerm = app.jwt.sign({ sub: "admin-1", actorType: "ADMIN", roleId: "role-1", permissions: ["orders:read"] });
const adminForbidden = await app.inject({
  method: "GET",
  url: "/admin-zones-write",
  headers: { authorization: `Bearer ${adminNoPerm}` },
});
console.log("Admin without permission -> 403:", adminForbidden.statusCode === 403);

// --- Test 5: admin token WITH the right permission -> 200 ---
const adminWithPerm = app.jwt.sign({ sub: "admin-2", actorType: "ADMIN", roleId: "role-2", permissions: ["zones:write"] });
const adminOk = await app.inject({
  method: "GET",
  url: "/admin-zones-write",
  headers: { authorization: `Bearer ${adminWithPerm}` },
});
console.log("Admin with exact permission -> 200:", adminOk.statusCode === 200);

// --- Test 6: super-admin wildcard permission -> 200 ---
const superAdmin = app.jwt.sign({ sub: "admin-3", actorType: "ADMIN", roleId: "role-3", permissions: ["*"] });
const superAdminOk = await app.inject({
  method: "GET",
  url: "/admin-zones-write",
  headers: { authorization: `Bearer ${superAdmin}` },
});
console.log("Super-admin wildcard -> 200:", superAdminOk.statusCode === 200);

await app.close();

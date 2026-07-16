import type { FastifyInstance } from "fastify";
import { AuthService } from "./auth.service.js";
import {
  otpRequestSchema,
  otpVerifySchema,
  pilotLoginSchema,
  adminLoginSchema,
  refreshTokenSchema,
} from "./auth.schemas.js";
import { BadRequestError } from "../../lib/errors.js";
import { requireActor } from "./rbac.middleware.js";

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService(app);

  // ---------- Customer ----------

  app.post("/customer/otp/request", async (request, reply) => {
    const parsed = otpRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid phone number", parsed.error.flatten());

    await authService.requestCustomerOtp(parsed.data.phoneNumber);
    return reply.send({ status: "sent" });
  });

  app.post("/customer/otp/verify", async (request, reply) => {
    const parsed = otpVerifySchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    const tokens = await authService.verifyCustomerOtp(parsed.data.phoneNumber, parsed.data.code);
    return reply.send(tokens);
  });

  // ---------- Pilot ----------

  app.post("/pilot/otp/request", async (request, reply) => {
    const parsed = otpRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid phone number", parsed.error.flatten());

    await authService.requestPilotOtp(parsed.data.phoneNumber);
    return reply.send({ status: "sent" });
  });

  app.post("/pilot/otp/verify", async (request, reply) => {
    const parsed = otpVerifySchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    const tokens = await authService.verifyPilotOtp(parsed.data.phoneNumber, parsed.data.code);
    return reply.send(tokens);
  });

  app.post("/pilot/login", async (request, reply) => {
    const parsed = pilotLoginSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    const tokens = await authService.loginPilotWithPassword(parsed.data.emailOrCode, parsed.data.password);
    return reply.send(tokens);
  });

  // ---------- Admin ----------

  app.post("/admin/login", async (request, reply) => {
    const parsed = adminLoginSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    const tokens = await authService.loginAdmin(parsed.data.email, parsed.data.password);
    return reply.send(tokens);
  });

  // ---------- Shared ----------

  app.post("/refresh", async (request, reply) => {
    const parsed = refreshTokenSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    const tokens = await authService.rotateRefreshToken(parsed.data.refreshToken);
    return reply.send(tokens);
  });

  app.post("/logout", async (request, reply) => {
    const parsed = refreshTokenSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());

    await authService.revokeRefreshToken(parsed.data.refreshToken);
    return reply.send({ status: "logged_out" });
  });

  // ---------- Example of a protected route, for the pattern ----------

  app.get("/me", { preHandler: requireActor("CUSTOMER", "PILOT", "ADMIN") }, async (request, reply) => {
    return reply.send({ actor: request.user });
  });
}

import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { generateRefreshToken, hashRefreshToken } from "../../lib/tokens.js";
import { sendOtp, checkOtp } from "../../lib/twilio.js";
import { UnauthorizedError, NotFoundError, ConflictError } from "../../lib/errors.js";
import type { ActorType, AuthTokenPair, JwtPayload } from "../../types/auth.js";

export class AuthService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  // ---------- Token issuance (shared by all actor types) ----------

  private async issueTokenPair(payload: JwtPayload, actorType: ActorType, actorId: string): Promise<AuthTokenPair> {
    const accessToken = this.app.jwt.sign(payload, { expiresIn: env.JWT_ACCESS_TTL });
    const { token: refreshToken, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hash,
        actorType,
        userId: actorType === "CUSTOMER" ? actorId : null,
        pilotId: actorType === "PILOT" ? actorId : null,
        adminId: actorType === "ADMIN" ? actorId : null,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private async buildAdminPayload(adminId: string): Promise<JwtPayload> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id: adminId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    return {
      sub: admin.id,
      actorType: "ADMIN",
      roleId: admin.roleId,
      permissions: admin.role.permissions.map((rp: { permission: { key: string } }) => rp.permission.key),
    };
  }

  // ---------- Customer: phone + OTP only ----------

  async requestCustomerOtp(phoneNumber: string): Promise<void> {
    await sendOtp(phoneNumber);
  }

  async verifyCustomerOtp(phoneNumber: string, code: string): Promise<AuthTokenPair> {
    const isValid = await checkOtp(phoneNumber, code);
    if (!isValid) throw new UnauthorizedError("Invalid or expired code");

    // First-time login creates the customer record; subsequent logins reuse it.
    const user = await this.prisma.user.upsert({
      where: { phoneNumber },
      update: {},
      create: { phoneNumber },
    });

    return this.issueTokenPair({ sub: user.id, actorType: "CUSTOMER" }, "CUSTOMER", user.id);
  }

  // ---------- Pilot: phone + OTP, or email + password ----------

  async requestPilotOtp(phoneNumber: string): Promise<void> {
    // Pilots are provisioned by ops/HR, not self-registered — fail loudly
    // if the number isn't recognized, rather than silently sending an OTP
    // that can never be paired to an account.
    const pilot = await this.prisma.pilot.findUnique({ where: { phoneNumber } });
    if (!pilot) throw new NotFoundError("No pilot account found for this number");

    await sendOtp(phoneNumber);
  }

  async verifyPilotOtp(phoneNumber: string, code: string): Promise<AuthTokenPair> {
    const isValid = await checkOtp(phoneNumber, code);
    if (!isValid) throw new UnauthorizedError("Invalid or expired code");

    const pilot = await this.prisma.pilot.findUniqueOrThrow({ where: { phoneNumber } });
    return this.issueTokenPair({ sub: pilot.id, actorType: "PILOT" }, "PILOT", pilot.id);
  }

  async loginPilotWithPassword(emailOrCode: string, password: string): Promise<AuthTokenPair> {
    const pilot = await this.prisma.pilot.findFirst({
      where: { OR: [{ email: emailOrCode }, { code: emailOrCode }] },
    });
    if (!pilot || !pilot.passwordHash) throw new UnauthorizedError("Invalid credentials");

    const isValid = await verifyPassword(password, pilot.passwordHash);
    if (!isValid) throw new UnauthorizedError("Invalid credentials");

    return this.issueTokenPair({ sub: pilot.id, actorType: "PILOT" }, "PILOT", pilot.id);
  }

  // ---------- Admin: email + password only ----------

  async loginAdmin(email: string, password: string): Promise<AuthTokenPair> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) throw new UnauthorizedError("Invalid credentials");

    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) throw new UnauthorizedError("Invalid credentials");

    const payload = await this.buildAdminPayload(admin.id);
    return this.issueTokenPair(payload, "ADMIN", admin.id);
  }

  /** Used by an initial seed script / super-admin-only endpoint — never exposed publicly. */
  async createAdmin(email: string, password: string, firstName: string, lastName: string, roleId: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) throw new ConflictError("An admin with this email already exists");

    const passwordHash = await hashPassword(password);
    return this.prisma.adminUser.create({
      data: { email, passwordHash, firstName, lastName, roleId },
    });
  }

  // ---------- Shared: refresh + logout ----------

  async rotateRefreshToken(rawToken: string): Promise<AuthTokenPair> {
    const hash = hashRefreshToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Rotation: the old token is revoked the instant it's used, whether or
    // not anything goes wrong afterwards — a refresh token is single-use.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const actorType = record.actorType;
    const actorId = record.userId ?? record.pilotId ?? record.adminId;
    if (!actorId) throw new UnauthorizedError("Malformed refresh token record");

    const payload: JwtPayload =
      actorType === "ADMIN" ? await this.buildAdminPayload(actorId) : { sub: actorId, actorType };

    return this.issueTokenPair(payload, actorType, actorId);
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const hash = hashRefreshToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

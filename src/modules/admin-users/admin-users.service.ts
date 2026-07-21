import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/passwords.js";
import type { CreateAdminUserBody, UpdateAdminUserBody } from "./admin-users.schemas.js";

const SAFE_ADMIN_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  roleId: true,
  isActive: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} as const;

export class AdminUsersService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listAdminUsers() {
    return this.prisma.adminUser.findMany({ orderBy: { createdAt: "desc" }, select: SAFE_ADMIN_USER_SELECT });
  }

  async listRoles() {
    return this.prisma.adminRole.findMany({
      orderBy: { name: "asc" },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async createAdminUser(data: CreateAdminUserBody) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictError("An admin with this email already exists");

    const role = await this.prisma.adminRole.findUnique({ where: { id: data.roleId } });
    if (!role) throw new NotFoundError("Role not found");

    const passwordHash = await hashPassword(data.password);

    return this.prisma.adminUser.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        roleId: data.roleId,
      },
      select: SAFE_ADMIN_USER_SELECT,
    });
  }

  async updateAdminUser(id: string, data: UpdateAdminUserBody, actorId: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundError("Admin not found");

    if (id === actorId && data.isActive === false) {
      throw new ConflictError("You cannot deactivate your own account");
    }

    if (data.roleId) {
      const role = await this.prisma.adminRole.findUnique({ where: { id: data.roleId } });
      if (!role) throw new NotFoundError("Role not found");
    }

    return this.prisma.adminUser.update({ where: { id }, data, select: SAFE_ADMIN_USER_SELECT });
  }
}
import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import type { ListCustomersQuery, UpdateMyCustomerProfileBody } from "./customers.schemas.js";

export class CustomersService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listCustomers(filters: ListCustomersQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { phoneNumber: { contains: filters.search } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const customers = await this.prisma.user.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        email: true,
        createdAt: true,
        _count: { select: { orders: true, vehicles: true, addresses: true } },
      },
    });

    const hasMore = customers.length > filters.limit;
    const page = hasMore ? customers.slice(0, -1) : customers;

    return {
      items: page,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nextCursor: hasMore ? (page[page.length - 1] as any).id : null,
    };
  }

  async getCustomerById(id: string) {
    const customer = await this.prisma.user.findUnique({
      where: { id },
      include: {
        vehicles: true,
        addresses: { include: { zone: true } },
        orders: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: { shipments: true },
        },
      },
    });
    if (!customer) throw new NotFoundError("Customer not found");
    return customer;
  }

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("Customer not found");
    return { ...user, profileComplete: !!(user.name && user.email) };
  }

  async updateMyProfile(userId: string, data: UpdateMyCustomerProfileBody) {
    if (data.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== userId) {
        throw new ConflictError("This email is already in use by another account");
      }
    }

    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return { ...user, profileComplete: !!(user.name && user.email) };
  }
}
import type { FastifyInstance } from "fastify";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors.js";
import type { CreateVehicleBody, UpdateVehicleBody } from "./vehicles.schemas.js";

export class VehiclesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listMyVehicles(ownerId: string) {
    return this.prisma.vehicle.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
  }

  async createVehicle(ownerId: string, data: CreateVehicleBody) {
    if (data.isDefault) {
      await this.prisma.vehicle.updateMany({ where: { ownerId, isDefault: true }, data: { isDefault: false } });
    }
    return this.prisma.vehicle.create({ data: { ...data, ownerId } });
  }

  async updateVehicle(id: string, ownerId: string, data: UpdateVehicleBody) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundError("Vehicle not found");
    if (vehicle.ownerId !== ownerId) throw new ForbiddenError("Not your vehicle");

    if (data.isDefault) {
      await this.prisma.vehicle.updateMany({ where: { ownerId, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.vehicle.update({ where: { id }, data });
  }

  async deleteVehicle(id: string, ownerId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundError("Vehicle not found");
    if (vehicle.ownerId !== ownerId) throw new ForbiddenError("Not your vehicle");

    const referenced = await this.prisma.shipment.findFirst({ where: { vehicleId: id } });
    if (referenced) {
      throw new ConflictError("This vehicle is referenced by past orders and can't be deleted");
    }

    await this.prisma.vehicle.delete({ where: { id } });
  }
}
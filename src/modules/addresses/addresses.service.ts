import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors.js";
import { isGeofencingEnabled } from "../../lib/settings.js";
import type { CreateAddressBody, UpdateAddressBody } from "./addresses.schemas.js";

export class AddressesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  private async resolveZoneId(lat: number, lng: number): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT id FROM "Zone"
        WHERE "isActive" = true
          AND ST_Contains(boundary, ST_SetSRID(ST_Point(${lng}, ${lat}), 4326))
        LIMIT 1
      `
    );
    return rows.length > 0 ? rows[0].id : null;
  }

  async listMyAddresses(ownerId: string) {
    return this.prisma.address.findMany({
      where: { ownerId },
      include: { zone: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async createAddress(ownerId: string, data: CreateAddressBody) {
    const zoneId = await this.resolveZoneId(data.latitude, data.longitude);

    if (data.isDefault) {
      await this.prisma.address.updateMany({ where: { ownerId, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.address.create({ data: { ...data, ownerId, zoneId } });
  }

  async updateAddress(id: string, ownerId: string, data: UpdateAddressBody) {
    const address = await this.prisma.address.findUnique({ where: { id } });
    if (!address) throw new NotFoundError("Address not found");
    if (address.ownerId !== ownerId) throw new ForbiddenError("Not your address");

    let zoneId = address.zoneId;
    if (data.latitude !== undefined || data.longitude !== undefined) {
      const lat = data.latitude ?? address.latitude;
      const lng = data.longitude ?? address.longitude;
      zoneId = await this.resolveZoneId(lat, lng);
    }

    if (data.isDefault) {
      await this.prisma.address.updateMany({ where: { ownerId, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.address.update({ where: { id }, data: { ...data, zoneId } });
  }

  async deleteAddress(id: string, ownerId: string): Promise<void> {
    const address = await this.prisma.address.findUnique({ where: { id } });
    if (!address) throw new NotFoundError("Address not found");
    if (address.ownerId !== ownerId) throw new ForbiddenError("Not your address");

    const referenced = await this.prisma.order.findFirst({ where: { addressId: id } });
    if (referenced) {
      throw new ConflictError("This address is referenced by past orders and can't be deleted");
    }

    await this.prisma.address.delete({ where: { id } });
  }

  /**
   * Powers the customer app's home screen availability gate. Respects the
   * admin-controlled geofencing toggle — when disabled, always reports
   * available.
   */
  async checkServiceAvailability(ownerId: string) {
    const geofencingEnabled = await isGeofencingEnabled(this.prisma);
    if (!geofencingEnabled) {
      return { available: true, geofencingEnabled: false, address: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultAddress: any =
      (await this.prisma.address.findFirst({ where: { ownerId, isDefault: true }, include: { zone: true } })) ??
      (await this.prisma.address.findFirst({ where: { ownerId }, orderBy: { createdAt: "desc" }, include: { zone: true } }));

    if (!defaultAddress) {
      return { available: null, geofencingEnabled: true, address: null };
    }

    return {
      available: defaultAddress.zoneId !== null,
      geofencingEnabled: true,
      address: {
        id: defaultAddress.id,
        label: defaultAddress.label,
        zoneId: defaultAddress.zoneId,
        zoneName: defaultAddress.zone?.name ?? null,
      },
    };
  }
}
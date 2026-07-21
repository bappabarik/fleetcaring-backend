import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import type { GeoJsonPolygon } from "./zones.schemas.js";

export interface ZoneSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  boundary: GeoJsonPolygon;
}

interface ZoneRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  geojson: string;
}

interface LivePilotRow {
  pilotId: string;
  position: string;
  heading: number | null;
  speedKph: number | null;
  recordedAt: Date;
  firstName: string;
  lastName: string;
  code: string;
  status: string;
}

function rowToSummary(row: ZoneRow): ZoneSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    boundary: JSON.parse(row.geojson),
  };
}

export class ZonesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async createZone(code: string, name: string, boundary: GeoJsonPolygon): Promise<{ id: string }> {
    const boundaryJson = JSON.stringify(boundary);

    const existing = await this.prisma.zone.findUnique({ where: { code } });
    if (existing) throw new ConflictError(`A zone with code "${code}" already exists`);

    const validityCheck = await this.prisma.$queryRaw<{ is_valid: boolean }[]>(
      Prisma.sql`SELECT ST_IsValid(ST_GeomFromGeoJSON(${boundaryJson})) AS is_valid`
    );
    if (!validityCheck[0]?.is_valid) {
      throw new BadRequestError("The drawn boundary is not a valid polygon (likely self-intersecting)");
    }

    const overlapping = await this.prisma.$queryRaw<{ code: string; name: string }[]>(
      Prisma.sql`
        SELECT code, name FROM "Zone"
        WHERE "isActive" = true
          AND ST_Overlaps(boundary, ST_GeomFromGeoJSON(${boundaryJson}))
      `
    );
    if (overlapping.length > 0) {
      throw new ConflictError(
        `Boundary overlaps with existing active zone(s): ${overlapping.map((z: { name: string }) => z.name).join(", ")}`
      );
    }

    const id = randomUUID();
    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "Zone" (id, code, name, boundary, "isActive", "createdAt")
        VALUES (${id}, ${code}, ${name}, ST_GeomFromGeoJSON(${boundaryJson}), true, now())
      `
    );

    return { id };
  }

  async listZones(activeOnly = false): Promise<ZoneSummary[]> {
    const rows = activeOnly
      ? await this.prisma.$queryRaw<ZoneRow[]>(
          Prisma.sql`
            SELECT id, code, name, "isActive", ST_AsGeoJSON(boundary) AS geojson
            FROM "Zone"
            WHERE "isActive" = true
            ORDER BY name
          `
        )
      : await this.prisma.$queryRaw<ZoneRow[]>(
          Prisma.sql`
            SELECT id, code, name, "isActive", ST_AsGeoJSON(boundary) AS geojson
            FROM "Zone"
            ORDER BY name
          `
        );
    return rows.map(rowToSummary);
  }

  async getZoneById(id: string): Promise<ZoneSummary> {
    const rows = await this.prisma.$queryRaw<ZoneRow[]>(
      Prisma.sql`
        SELECT id, code, name, "isActive", ST_AsGeoJSON(boundary) AS geojson
        FROM "Zone"
        WHERE id = ${id}
      `
    );
    if (rows.length === 0) throw new NotFoundError("Zone not found");
    return rowToSummary(rows[0]);
  }

  async updateZone(id: string, data: { name?: string; isActive?: boolean }) {
    const zone = await this.prisma.zone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundError("Zone not found");
    await this.prisma.zone.update({ where: { id }, data });
    return this.getZoneById(id);
  }

  async resolveZoneForPoint(lat: number, lng: number): Promise<ZoneSummary | null> {
    const rows = await this.prisma.$queryRaw<ZoneRow[]>(
      Prisma.sql`
        SELECT id, code, name, "isActive", ST_AsGeoJSON(boundary) AS geojson
        FROM "Zone"
        WHERE "isActive" = true
          AND ST_Contains(boundary, ST_SetSRID(ST_Point(${lng}, ${lat}), 4326))
        LIMIT 1
      `
    );
    return rows.length > 0 ? rowToSummary(rows[0]) : null;
  }

  /** Snapshot of every pilot currently active (on an IN_PROGRESS shift) in
   * this zone, with their last-known position. This is what powers the
   * admin map's INITIAL render — the WebSocket layer only broadcasts
   * changes as they happen, so without this, an admin opening the
   * dashboard would see an empty map until the next pilot ping arrived. */
  async listLivePilotsInZone(zoneId: string) {
    const rows = await this.prisma.$queryRaw<LivePilotRow[]>(
      Prisma.sql`
        SELECT
          pll."pilotId",
          ST_AsGeoJSON(pll.location) AS position,
          pll.heading,
          pll."speedKph",
          pll."recordedAt",
          p."firstName",
          p."lastName",
          p.code,
          p.status
        FROM "PilotLiveLocation" pll
        JOIN "Shift" s ON s.id = pll."shiftId"
        JOIN "Pilot" p ON p.id = pll."pilotId"
        WHERE s."zoneId" = ${zoneId}
          AND s.status = 'IN_PROGRESS'
        ORDER BY pll."recordedAt" DESC
      `
    );

    return rows.map((row) => {
      const position = JSON.parse(row.position) as { type: "Point"; coordinates: [number, number] };
      return {
        pilotId: row.pilotId,
        pilotName: `${row.firstName} ${row.lastName}`,
        pilotCode: row.code,
        pilotStatus: row.status,
        lat: position.coordinates[1],
        lng: position.coordinates[0],
        heading: row.heading,
        speedKph: row.speedKph,
        recordedAt: row.recordedAt,
      };
    });
  }
}
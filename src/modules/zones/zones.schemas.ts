import { z } from "zod";

const coordinateSchema = z.tuple([z.number(), z.number()]); // [lng, lat]

export const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(coordinateSchema)).min(1),
});

export const createZoneSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  boundary: geoJsonPolygonSchema,
});

export const updateZoneSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const resolveZoneQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;
export type CreateZoneBody = z.infer<typeof createZoneSchema>;
export type UpdateZoneBody = z.infer<typeof updateZoneSchema>;
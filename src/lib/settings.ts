import type { PrismaClient } from "@prisma/client";

const GEOFENCING_SETTING_KEY = "geofencing_enabled";

export async function isGeofencingEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: GEOFENCING_SETTING_KEY } });
  return row ? row.value === "true" : true;
}

export async function setGeofencingEnabled(prisma: PrismaClient, enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: GEOFENCING_SETTING_KEY },
    update: { value: String(enabled) },
    create: { key: GEOFENCING_SETTING_KEY, value: String(enabled) },
  });
}
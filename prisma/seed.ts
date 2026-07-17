import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/passwords.js";
import { ALL_PERMISSIONS, PERMISSIONS } from "../src/lib/permissions.js";

declare const process: { env: Record<string, string | undefined> };

const prisma = new PrismaClient();

const ROLE_DEFINITIONS: Record<string, string[] | "*"> = {
  "Super Admin": "*",
  "Operations Manager": [
    PERMISSIONS.ZONES_READ,
    PERMISSIONS.ZONES_WRITE,
    PERMISSIONS.TIMESLOTS_READ,
    PERMISSIONS.TIMESLOTS_WRITE,
    PERMISSIONS.SHIFTS_READ,
    PERMISSIONS.SHIFTS_WRITE,
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.PILOTS_READ,
  ],
  "Dispatch / Support": [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.SHIPMENTS_READ,
    PERMISSIONS.SHIPMENTS_WRITE,
    PERMISSIONS.ISSUES_READ,
    PERMISSIONS.ISSUES_WRITE,
    PERMISSIONS.PILOTS_READ,
    PERMISSIONS.CUSTOMERS_READ,
  ],
  "Pricing & Catalog": [PERMISSIONS.CATALOG_READ, PERMISSIONS.CATALOG_WRITE, PERMISSIONS.PRICING_READ, PERMISSIONS.PRICING_WRITE],
  Finance: [PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_REFUND, PERMISSIONS.FINANCE_REPORTS],
  HR: [PERMISSIONS.PILOTS_READ, PERMISSIONS.PILOTS_WRITE],
  "Analytics (read-only)": ALL_PERMISSIONS.filter((p) => p.endsWith(":read")),
};


async function main() {
  console.log("Seeding permissions...");
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  console.log("Seeding roles...");
  for (const [roleName, permissionKeys] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.adminRole.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const keysToGrant = permissionKeys === "*" ? ["*"] : permissionKeys;

    for (const key of keysToGrant) {
      const permission = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log("Seeding super admin user...");
  const superAdminRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "Super Admin" } });
  const devEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@fleetcaring.dev";
  const devPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  await prisma.adminUser.upsert({
    where: { email: devEmail },
    update: {},
    create: {
      email: devEmail,
      passwordHash: await hashPassword(devPassword),
      firstName: "Super",
      lastName: "Admin",
      roleId: superAdminRole.id,
    },
  });

  console.log(`\nDone. Super admin login: ${devEmail} / ${devPassword}`);
  console.log("(Override via SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars before seeding in shared environments.)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
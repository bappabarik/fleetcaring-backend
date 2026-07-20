import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/passwords.js";
import { ALL_PERMISSIONS, PERMISSIONS } from "../src/lib/permissions.js";

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

    // The "*" wildcard itself isn't a real Permission row per-se for other
    // roles, but Super Admin needs an actual Permission row for it to
    // attach via RolePermission — create it once here.
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

  console.log("Seeding test zone...");
  let testZone = await prisma.zone.findUnique({ where: { code: "TEST_ZONE" } });
  if (!testZone) {
    const zoneId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "Zone" (id, code, name, boundary, "isActive", "createdAt")
      VALUES (
        ${zoneId}, 'TEST_ZONE', 'Test Zone',
        ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[55.10,25.10],[55.30,25.10],[55.30,25.30],[55.10,25.30],[55.10,25.10]]]}'),
        true, now()
      )
    `;
    testZone = await prisma.zone.findUniqueOrThrow({ where: { id: zoneId } });
  }

  console.log("Seeding test catalog (vertical/op item/variation)...");
  let testVertical = await prisma.vertical.findUnique({ where: { name: "Car Wash (Test)" } });
  if (!testVertical) {
    testVertical = await prisma.vertical.create({ data: { name: "Car Wash (Test)" } });
  }

  let testOpItem = await prisma.opItem.findFirst({
    where: { name: "Pressure Wash (Test)", verticalId: testVertical.id },
  });
  if (!testOpItem) {
    testOpItem = await prisma.opItem.create({
      data: { name: "Pressure Wash (Test)", verticalId: testVertical.id },
    });
  }

  let testVariation = await prisma.itemVariation.findFirst({ where: { opItemId: testOpItem.id } });
  if (!testVariation) {
    testVariation = await prisma.itemVariation.create({
      data: { opItemId: testOpItem.id, name: "Standard Wash (Test)", priceAED: 75, durationMins: 45 },
    });
  }

  console.log("Seeding a bookable timeslot for today...");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let testTemplate = await prisma.timeslotTemplate.findFirst({
    where: { opItemId: testOpItem.id, zoneId: testZone.id },
  });
  if (!testTemplate) {
    testTemplate = await prisma.timeslotTemplate.create({
      data: {
        opItemId: testOpItem.id,
        zoneId: testZone.id,
        startTime: "09:00",
        endTime: "10:00",
        recurrenceRule: "DAILY",
        capacity: 5,
        startDate: today,
      },
    });
  }

  let testSlot = await prisma.timeslot.findFirst({
    where: { opItemId: testOpItem.id, zoneId: testZone.id, date: today },
  });
  if (!testSlot) {
    testSlot = await prisma.timeslot.create({
      data: {
        templateId: testTemplate.id,
        opItemId: testOpItem.id,
        zoneId: testZone.id,
        date: today,
        startTime: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 9, 0)),
        endTime: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0)),
        capacity: 5,
        buffer: 0,
        timeslotType: "STANDARD",
      },
    });
  }

  console.log("Seeding test customer + vehicle + address...");
  const testCustomer = await prisma.user.upsert({
    where: { phoneNumber: "+918597305824" },
    update: {},
    create: { phoneNumber: "+918597305824", name: "Test Customer", email: "customer@fleetcaring.dev" },
  });

  let testVehicle = await prisma.vehicle.findFirst({ where: { ownerId: testCustomer.id } });
  if (!testVehicle) {
    testVehicle = await prisma.vehicle.create({
      data: {
        ownerId: testCustomer.id,
        make: "Toyota",
        model: "Land Cruiser",
        licensePlate: "TEST 1234",
        color: "White",
        fuelType: "PETROL",
        isDefault: true,
      },
    });
  }

  let testAddress = await prisma.address.findFirst({ where: { ownerId: testCustomer.id } });
  if (!testAddress) {
    testAddress = await prisma.address.create({
      data: {
        ownerId: testCustomer.id,
        label: "Home",
        labelType: "HOME",
        latitude: 25.2,
        longitude: 55.2,
        addressText: "Test Address, Dubai",
        zoneId: testZone.id,
      },
    });
  }

  console.log("Seeding test pilot (email+password login)...");
  const testPilot = await prisma.pilot.upsert({
    where: { email: "pilot@fleetcaring.dev" },
    update: {},
    create: {
      code: "TESTPILOT01",
      firstName: "Test",
      lastName: "Pilot",
      email: "pilot@fleetcaring.dev",
      phoneNumber: "+971500000001",
      passwordHash: await hashPassword("PilotPass123!"),
      status: "ACTIVE",
    },
  });

  let testAsset = await prisma.asset.findFirst({ where: { plateCode: "TEST-VAN-01" } });
  if (!testAsset) {
    testAsset = await prisma.asset.create({
      data: { plateCode: "TEST-VAN-01", name: "Test Van", type: "van" },
    });
  }

  console.log("\n=== Test fixture ready — copy these into your curl commands ===\n");
  console.log(`Admin login:      ${devEmail} / ${devPassword}`);
  console.log(`Pilot login:      pilot@fleetcaring.dev / PilotPass123! (or code: ${testPilot.code})`);
  console.log(`Customer phone:   +918597305824 (real OTP via SMS now that Twilio is configured)`);
  console.log(`Zone id:          ${testZone.id}`);
  console.log(`OpItem id:        ${testOpItem.id}`);
  console.log(`ItemVariation id: ${testVariation.id}`);
  console.log(`Timeslot id:      ${testSlot.id}`);
  console.log(`Vehicle id:       ${testVehicle.id}`);
  console.log(`Address id:       ${testAddress.id}`);
  console.log(`Pilot id:         ${testPilot.id}`);
  console.log(`Asset id:         ${testAsset.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
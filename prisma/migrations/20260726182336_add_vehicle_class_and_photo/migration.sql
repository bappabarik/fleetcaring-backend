-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "vehicleClass" "VehicleClass" NOT NULL DEFAULT 'SEDAN';

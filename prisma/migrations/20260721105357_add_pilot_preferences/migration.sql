-- AlterTable
ALTER TABLE "Pilot" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "preferredNavApp" TEXT NOT NULL DEFAULT 'google_maps';

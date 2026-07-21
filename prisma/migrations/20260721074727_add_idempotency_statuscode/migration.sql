-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN     "statusCode" INTEGER NOT NULL DEFAULT 200;

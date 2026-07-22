-- AlterTable
ALTER TABLE "PriceRule" ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

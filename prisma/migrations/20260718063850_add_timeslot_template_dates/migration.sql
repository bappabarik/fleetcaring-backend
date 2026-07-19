/*
  Warnings:

  - Added the required column `startDate` to the `TimeslotTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TimeslotTemplate" ADD COLUMN     "endDate" DATE,
ADD COLUMN     "startDate" DATE NOT NULL;

-- Rename currency-specific columns to currency-neutral names, so the schema
-- doesn't lock the product to AED. The actual currency (INR, AED, ...) is now
-- a deployment-level config value (CURRENCY_CODE / CURRENCY_SYMBOL env vars),
-- not baked into column names. Data-preserving renames only.

-- AlterTable
ALTER TABLE "ItemVariation" RENAME COLUMN "priceAED" TO "price";

-- AlterTable
ALTER TABLE "ShipmentAddOn" RENAME COLUMN "priceAED" TO "price";

-- AlterTable
ALTER TABLE "Order" RENAME COLUMN "totalAED" TO "total";
ALTER TABLE "Order" RENAME COLUMN "discountAED" TO "discount";

-- AlterTable
ALTER TABLE "PromoCode" RENAME COLUMN "minOrderAED" TO "minOrder";
ALTER TABLE "PromoCode" RENAME COLUMN "maxDiscountAED" TO "maxDiscount";

-- AlterTable
ALTER TABLE "Payment" RENAME COLUMN "amountAED" TO "amount";

-- AlterEnum
ALTER TYPE "PromoDiscountType" RENAME VALUE 'FIXED_AED' TO 'FIXED_AMOUNT';

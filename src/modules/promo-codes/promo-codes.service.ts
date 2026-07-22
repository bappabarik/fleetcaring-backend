import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import type { CreatePromoCodeBody, UpdatePromoCodeBody, ListPromoCodesQuery } from "./promo-codes.schemas.js";

export interface DiscountResult {
  promoCodeId: string;
  discountAED: number;
}

export class PromoCodesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listPromoCodes(filters: ListPromoCodesQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (filters.isActive === "true") where.isActive = true;
    if (filters.isActive === "false") where.isActive = false;

    const codes = await this.prisma.promoCode.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
    });

    const hasMore = codes.length > filters.limit;
    const page = hasMore ? codes.slice(0, -1) : codes;

    return {
      items: page,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nextCursor: hasMore ? (page[page.length - 1] as any).id : null,
    };
  }

  async createPromoCode(data: CreatePromoCodeBody) {
    const code = data.code.toUpperCase();
    const existing = await this.prisma.promoCode.findUnique({ where: { code } });
    if (existing) throw new ConflictError("A promo code with this code already exists");

    return this.prisma.promoCode.create({ data: { ...data, code } });
  }

  async updatePromoCode(id: string, data: UpdatePromoCodeBody) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundError("Promo code not found");
    return this.prisma.promoCode.update({ where: { id }, data });
  }

  async getRedemptions(promoCodeId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id: promoCodeId } });
    if (!promo) throw new NotFoundError("Promo code not found");

    return this.prisma.order.findMany({
      where: { promoCodeId, cancelledAt: null },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async validatePromoCode(code: string, userId: string, orderSubtotalAED: number): Promise<DiscountResult> {
    return this.computeDiscount(this.prisma, code, userId, orderSubtotalAED);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async validatePromoCodeInTransaction(
    tx: any,
    code: string,
    userId: string,
    orderSubtotalAED: number
  ): Promise<DiscountResult> {
    return this.computeDiscount(tx, code, userId, orderSubtotalAED);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async computeDiscount(
    db: any,
    code: string,
    userId: string,
    orderSubtotalAED: number
  ): Promise<DiscountResult> {
    const promo = await db.promoCode.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.isActive) throw new NotFoundError("Promo code not found");

    const now = new Date();
    if (promo.validFrom > now) throw new ConflictError("This promo code is not active yet");
    if (promo.validTo && promo.validTo < now) throw new ConflictError("This promo code has expired");

    if (promo.minOrderAED && orderSubtotalAED < Number(promo.minOrderAED)) {
      throw new ConflictError(`This promo code requires a minimum order of AED ${promo.minOrderAED}`);
    }

    if (promo.maxRedemptions !== null) {
      const totalUsed = await db.order.count({ where: { promoCodeId: promo.id, cancelledAt: null } });
      if (totalUsed >= promo.maxRedemptions) {
        throw new ConflictError("This promo code has reached its redemption limit");
      }
    }

    const usedByUser = await db.order.count({ where: { promoCodeId: promo.id, userId, cancelledAt: null } });
    if (usedByUser >= promo.maxRedemptionsPerUser) {
      throw new ConflictError("You've already used this promo code the maximum number of times");
    }

    let discountAED: number;
    if (promo.discountType === "PERCENTAGE") {
      discountAED = orderSubtotalAED * (Number(promo.discountValue) / 100);
      if (promo.maxDiscountAED) discountAED = Math.min(discountAED, Number(promo.maxDiscountAED));
    } else {
      discountAED = Number(promo.discountValue);
    }
    discountAED = Math.min(discountAED, orderSubtotalAED);
    discountAED = Math.round(discountAED * 100) / 100;

    return { promoCodeId: promo.id, discountAED };
  }
}
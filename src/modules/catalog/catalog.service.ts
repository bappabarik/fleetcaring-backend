import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../../lib/errors.js";
import type {
  CreateOpItemBody,
  UpdateOpItemBody,
  CreateVariationBody,
  UpdateVariationBody,
  CreatePriceRuleBody,
} from "./catalog.schemas.js";

export class CatalogService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  // ---------- Verticals ----------

  async listVerticals() {
    return this.prisma.vertical.findMany({ orderBy: { name: "asc" } });
  }

  async createVertical(name: string) {
    return this.prisma.vertical.create({ data: { name } });
  }

  // ---------- Brands ----------

  async createBrand(name: string) {
    return this.prisma.brand.create({ data: { name } });
  }

  // ---------- Op items (customer-facing browse + admin writes) ----------

  /** Public browse: active items + their active variations for a vertical.
   * Matches FleetCaring's guest-first philosophy — no login required to see
   * what's bookable. */
  async listActiveItemsForVertical(verticalId: string) {
    return this.prisma.opItem.findMany({
      where: { verticalId, isActive: true },
      include: {
        brand: true,
        variations: { where: { isActive: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async createOpItem(data: CreateOpItemBody) {
    return this.prisma.opItem.create({ data });
  }

  async updateOpItem(id: string, data: UpdateOpItemBody) {
    const item = await this.prisma.opItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundError("Op item not found");
    return this.prisma.opItem.update({ where: { id }, data });
  }

  // ---------- Item variations ----------

  async createVariation(opItemId: string, data: CreateVariationBody) {
    const item = await this.prisma.opItem.findUnique({ where: { id: opItemId } });
    if (!item) throw new NotFoundError("Op item not found");
    return this.prisma.itemVariation.create({ data: { opItemId, ...data } });
  }

  async updateVariation(id: string, data: UpdateVariationBody) {
    const variation = await this.prisma.itemVariation.findUnique({ where: { id } });
    if (!variation) throw new NotFoundError("Variation not found");
    return this.prisma.itemVariation.update({ where: { id }, data });
  }

  // ---------- Pricing ----------

  async createPriceRule(itemVariationId: string, data: CreatePriceRuleBody) {
    const variation = await this.prisma.itemVariation.findUnique({ where: { id: itemVariationId } });
    if (!variation) throw new NotFoundError("Variation not found");
    return this.prisma.priceRule.create({ data: { itemVariationId, ...data } });
  }

  /**
   * Resolves the effective price for a variation in a given zone at a given
   * moment, layering the best-matching PriceRule on top of the base price.
   * A zone-specific rule wins over a global (zoneId=null) rule; among
   * same-specificity matches, the most recently created rule wins.
   *
   * Priority resolution is done in plain JS rather than SQL ORDER BY with
   * nulls, since Postgres's default null-ordering (NULLS LAST for ASC,
   * NULLS FIRST for DESC) doesn't line up with "prefer non-null zoneId" in
   * a way that's obvious to read — this is easier to verify correct.
   */
  async resolveEffectivePrice(itemVariationId: string, zoneId: string | null, at: Date = new Date()): Promise<number> {
    const variation = await this.prisma.itemVariation.findUniqueOrThrow({ where: { id: itemVariationId } });

    // UTC day-of-week, matching the model's own documented convention —
    // same server-timezone-independence reasoning as the timeslot
    // materializer fix (a rule must mean the same thing regardless of
    // what timezone the server process happens to be running in).
    const currentDayOfWeek = at.getUTCDay();

    const candidateRules = await this.prisma.priceRule.findMany({
      where: {
        itemVariationId,
        OR: [{ zoneId }, { zoneId: null }],
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
          { OR: [{ validTo: null }, { validTo: { gte: at } }] },
          { OR: [{ daysOfWeek: { isEmpty: true } }, { daysOfWeek: { has: currentDayOfWeek } }] },
        ],
      },
    });

    type CandidateRule = {
      zoneId: string | null;
      daysOfWeek: number[];
      multiplier: unknown;
      fixedAdjustment: unknown;
      createdAt: Date;
    };

    // Priority: the rule matching on the MOST dimensions wins — a rule
    // scoped to both this exact zone AND this exact day beats one scoped
    // to only one of those, which in turn beats a fully general rule.
    // Ties (same specificity) go to whichever rule was created most
    // recently, matching the pre-existing tie-break behavior.
    function specificity(r: CandidateRule): number {
      let score = 0;
      if (zoneId && r.zoneId === zoneId) score += 2;
      if (r.daysOfWeek.length > 0) score += 1;
      return score;
    }

    const rule = (candidateRules as CandidateRule[]).sort((a, b) => {
      const specificityDiff = specificity(b) - specificity(a);
      if (specificityDiff !== 0) return specificityDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];

    const basePrice = Number(variation.priceAED);
    if (!rule) return basePrice;

    const multiplied = basePrice * Number(rule.multiplier);
    const adjusted = rule.fixedAdjustment ? multiplied + Number(rule.fixedAdjustment) : multiplied;
    return Math.round(adjusted * 100) / 100;
  }
}
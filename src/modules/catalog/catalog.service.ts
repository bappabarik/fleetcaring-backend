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

  async listVerticals() {
    return this.prisma.vertical.findMany({ orderBy: { name: "asc" } });
  }

  async createVertical(name: string) {
    return this.prisma.vertical.create({ data: { name } });
  }

  async createBrand(name: string) {
    return this.prisma.brand.create({ data: { name } });
  }

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

  async createPriceRule(itemVariationId: string, data: CreatePriceRuleBody) {
    const variation = await this.prisma.itemVariation.findUnique({ where: { id: itemVariationId } });
    if (!variation) throw new NotFoundError("Variation not found");
    return this.prisma.priceRule.create({ data: { itemVariationId, ...data } });
  }

  async resolveEffectivePrice(itemVariationId: string, zoneId: string | null, at: Date = new Date()): Promise<number> {
    const variation = await this.prisma.itemVariation.findUniqueOrThrow({ where: { id: itemVariationId } });

    const candidateRules = await this.prisma.priceRule.findMany({
      where: {
        itemVariationId,
        OR: [{ zoneId }, { zoneId: null }],
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
          { OR: [{ validTo: null }, { validTo: { gte: at } }] },
        ],
      },
    });

    type CandidateRule = { zoneId: string | null; multiplier: unknown; fixedAdjustment: unknown; createdAt: Date };
    const zoneSpecific = zoneId
      ? candidateRules.filter((r: CandidateRule) => r.zoneId === zoneId)
      : [];
    const global = candidateRules.filter((r: CandidateRule) => r.zoneId === null);
    const pool = zoneSpecific.length > 0 ? zoneSpecific : global;
    const rule = pool.sort((a: CandidateRule, b: CandidateRule) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const basePrice = Number(variation.priceAED);
    if (!rule) return basePrice;

    const multiplied = basePrice * Number(rule.multiplier);
    const adjusted = rule.fixedAdjustment ? multiplied + Number(rule.fixedAdjustment) : multiplied;
    return Math.round(adjusted * 100) / 100;
  }
}
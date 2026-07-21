import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../../lib/errors.js";
import type { CreateAssetBody, UpdateAssetBody, ListAssetsQuery } from "./assets.schemas.js";

export class AssetsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listAssets(filters: ListAssetsQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.isActive === "true") where.isActive = true;
    if (filters.isActive === "false") where.isActive = false;
    if (filters.search) {
      where.OR = [
        { plateCode: { contains: filters.search, mode: "insensitive" } },
        { name: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const assets = await this.prisma.asset.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { name: "asc" },
    });

    const hasMore = assets.length > filters.limit;
    const page = hasMore ? assets.slice(0, -1) : assets;

    return {
      items: page,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nextCursor: hasMore ? (page[page.length - 1] as any).id : null,
    };
  }

  async createAsset(data: CreateAssetBody) {
    return this.prisma.asset.create({ data });
  }

  async updateAsset(id: string, data: UpdateAssetBody) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError("Asset not found");
    return this.prisma.asset.update({ where: { id }, data });
  }
}
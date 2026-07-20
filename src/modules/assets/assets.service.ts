import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../../lib/errors.js";
import type { CreateAssetBody, UpdateAssetBody } from "./assets.schemas.js";

export class AssetsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listAssets() {
    return this.prisma.asset.findMany({ orderBy: { name: "asc" } });
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
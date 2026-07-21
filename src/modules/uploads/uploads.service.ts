import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createPresignedUploadUrl } from "../../lib/r2.js";
import type { PresignUploadBody } from "./uploads.schemas.js";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class UploadsService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private app: FastifyInstance) {}

  async createPresignedUpload(actorType: string, actorId: string, data: PresignUploadBody) {
    const extension = EXTENSION_BY_CONTENT_TYPE[data.contentType];
    const key = `${data.purpose}/${actorType.toLowerCase()}-${actorId}/${randomUUID()}.${extension}`;
    return createPresignedUploadUrl(key, data.contentType);
  }
}
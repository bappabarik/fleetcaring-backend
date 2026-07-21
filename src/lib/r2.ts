import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { ConflictError } from "./errors.js";

export const isR2Configured = !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

const s3Client = isR2Configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const PRESIGN_EXPIRY_SECONDS = 300;

export async function createPresignedUploadUrl(
  key: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!isR2Configured || !s3Client) {
    throw new ConflictError(
      "File uploads are not configured yet — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
    );
  }

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
  const publicUrl = env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL}/${key}` : `https://${env.R2_BUCKET_NAME}.r2.dev/${key}`;

  return { uploadUrl, publicUrl };
}
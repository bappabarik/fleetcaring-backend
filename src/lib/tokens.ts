import { randomBytes, createHash } from "node:crypto";

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString("hex");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

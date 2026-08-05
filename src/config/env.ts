import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  TWILIO_ACCOUNT_SID: z.string().optional().default(""),
  TWILIO_AUTH_TOKEN: z.string().optional().default(""),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  FCM_PROJECT_ID: z.string().optional().default(""),
  FCM_CLIENT_EMAIL: z.string().optional().default(""),
  FCM_PRIVATE_KEY: z.string().optional().default(""),
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET_NAME: z.string().optional().default("fleetcaring-uploads"),
  R2_PUBLIC_URL: z.string().optional().default(""), // e.g. "https://pub-xxxx.r2.dev" or a custom domain, no trailing slash
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("*"),

  // --- Region config — every deployment is a single country/currency/timezone
  // (India and Dubai run as separate deployments, not one multi-currency instance).
  // No defaults on purpose: forces every deployment to explicitly declare its region
  // rather than silently inheriting whatever the last market happened to be. ---
  CURRENCY_CODE: z.string().length(3), // ISO 4217, e.g. "INR", "AED"
  CURRENCY_SYMBOL: z.string().min(1), // display symbol, e.g. "₹", "AED"
  DEFAULT_COUNTRY_ISO: z.string().length(2), // ISO 3166-1 alpha-2, e.g. "IN", "AE"
  DEFAULT_COUNTRY_DIAL_CODE: z.string().regex(/^\+[1-9]\d{0,3}$/), // e.g. "+91", "+971"
  DEFAULT_TIMEZONE: z.string().min(1), // IANA zone, e.g. "Asia/Kolkata", "Asia/Dubai"
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
